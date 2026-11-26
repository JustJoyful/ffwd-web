// The ffmpeg.wasm runtime in a real browser: isolation, probe, a checked-by-hand trim run, the run timeout and the
// measurements the checker relies on. Inputs come from lavfi only.
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.ffwdReady);
});
test.afterAll(async () => {
  await page.evaluate(() => window.rt?.dispose());
  await page.close();
});

/** Run `fn(rt, ffwd, arg)` inside the page against the shared runtime (created on first use). */
const inPage = (fn, arg) =>
  page.evaluate(
    async ([src, arg]) => {
      window.rt ??= window.ffwd.createBrowserRuntime();
      return new Function(
        "rt",
        "ffwd",
        "arg",
        `return (${src})(rt, ffwd, arg)`,
      )(window.rt, window.ffwd, arg);
    },
    [fn.toString(), arg],
  );

test("the page is cross-origin isolated", async () => {
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test("the core has the filters and sources the checker needs", async () => {
  // [VERIFY] from Plan C: lavfi, ebur128, ssim, psnr in @ffmpeg/core-mt 0.12.10.
  const found = await inPage(async (rt) => {
    const filters = (await rt.session.exec(["-hide_banner", "-filters"])).log;
    const devices = (await rt.session.exec(["-hide_banner", "-devices"])).log;
    const has = (text, name) => new RegExp(`\\s${name}\\s`).test(text);
    return Object.fromEntries([
      ["lavfi", has(devices, "lavfi")],
      ...[
        "ebur128",
        "ssim",
        "psnr",
        "testsrc2",
        "sine",
        "scale",
        "fps",
        "split",
      ].map((n) => [n, has(filters, n)]),
    ]);
  });
  console.log("filters:", JSON.stringify(found));
  expect(found).toEqual(
    Object.fromEntries(Object.keys(found).map((k) => [k, true])),
  );
});

test("generates a 2 s lavfi clip, probes it and reports width, height, duration within 0.05 s", async () => {
  const probe = await inPage(async (rt) => {
    const h = await rt.session
      .exec([
        ...["-hide_banner", "-nostdin", "-y", "-filter_threads", "1"],
        ...["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2"],
        ...[
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000:duration=2",
        ],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
        ...["-c:a", "aac", "-threads", "4", "gen.mp4"],
      ])
      .then(() => rt.adopt("gen.mp4"));
    window.genHandle = h;
    return rt.measure.probe(h);
  });
  const v = probe.streams.find((s) => s.type === "video");
  expect([v.width, v.height]).toEqual([640, 360]);
  expect(Math.abs(probe.duration_s - 2)).toBeLessThan(0.05);
  expect(probe.streams.map((s) => s.type)).toEqual(["video", "audio"]);
  expect(v.fps).toBe(25);
  expect(probe.size_bytes).toBeGreaterThan(0);
});

test("a trim run produces an output whose probed duration is within 0.15 s of the request", async () => {
  const r = await inPage(async (rt) => {
    rt.executor.setInputs({ clip: window.genHandle });
    const res = await rt.executor.run({
      args: [
        "-i",
        "{in:clip}",
        "-ss",
        "0.5",
        "-t",
        "1",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "{out:out1}",
      ],
      inputs: ["clip"],
      outputs: ["out1"],
      specs: [{ id: "out1", kind: "video", container: "mp4" }],
    });
    return {
      res,
      probe: res.ok ? await rt.measure.probe(res.outputs.out1) : null,
    };
  });
  expect(r.res.ok, r.res.log).toBe(true);
  expect(Math.abs(r.probe.duration_s - 1)).toBeLessThan(0.15);
});

test("a rejected run (not on the allowlist) is refused before FFmpeg", async () => {
  const res = await inPage(async (rt) =>
    rt.executor.run({
      args: ["-i", "{in:clip}", "-f", "lavfi", "{out:out1}"],
      inputs: ["clip"],
      outputs: ["out1"],
      specs: [{ id: "out1", kind: "video", container: "mp4" }],
    }),
  );
  expect(res.ok).toBe(false);
  expect(res.error).toBeTruthy();
});

test("a run that exceeds the timeout returns ok:false with a reason", async () => {
  const res = await inPage(async () => {
    const slow = window.ffwd.createBrowserRuntime({ timeoutMs: 1 });
    try {
      const h = await slow.writeInput(
        "in.mp4",
        new Uint8Array(
          await (await window.rt.readOutput(window.genHandle)).arrayBuffer(),
        ),
      );
      slow.executor.setInputs({ clip: h });
      return await slow.executor.run({
        // A 1 ms budget cannot finish any encode.
        args: ["-i", "{in:clip}", "-c:v", "libx264", "-crf", "5", "{out:out1}"],
        inputs: ["clip"],
        outputs: ["out1"],
        specs: [{ id: "out1", kind: "video", container: "mp4" }],
      });
    } finally {
      slow.dispose();
    }
  });
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/timed out/);
});

test("measure.loudness returns null for a clip with no audio", async () => {
  const [silent, withAudio] = await inPage(async (rt) => {
    const h = await window.ffwd.makeInput(rt, "h264_noaudio");
    return [
      await rt.measure.loudness(h),
      await rt.measure.loudness(window.genHandle),
    ];
  });
  expect(silent).toBeNull();
  // A 440 Hz sine at full scale from lavfi is loud but finite.
  expect(typeof withAudio).toBe("number");
});

test("measure.quality of a clip against itself is perfect, and of a re-encode it is high but not perfect", async () => {
  const [same, lossy] = await inPage(async (rt) => {
    const res = await rt.executor.run({
      args: ["-i", "{in:clip}", "-c:v", "libx264", "-crf", "35", "{out:out1}"],
      inputs: ["clip"],
      outputs: ["out1"],
      specs: [{ id: "out1", kind: "video", container: "mp4" }],
    });
    rt.executor.setInputs({ clip: window.genHandle });
    return [
      await rt.measure.quality(window.genHandle, window.genHandle, 640, 360),
      await rt.measure.quality(window.genHandle, res.outputs.out1, 640, 360),
    ];
  });
  expect(same).toEqual({ ssim: 1, psnr_db: 100 });
  expect(lossy.ssim).toBeLessThan(1);
  expect(lossy.ssim).toBeGreaterThan(0.5);
});

test("a trim whose cut-off part holds a scene change still passes the rotation check", async () => {
  // 2 s of one picture, then 3 s of a different one (a scene change at 2 s). "Cut the first 3 seconds" leaves only the
  // second picture, so the output's first frame is NOT the input's first frame: comparing those two used to fail closed.
  const r = await inPage(async (rt, ffwd) => {
    // the same thread caps as every other fixture: a filter graph that picks its own thread count deadlocks this core
    const made = await rt.session.exec(
      [
        ...["-hide_banner", "-nostdin", "-y"],
        ...["-filter_threads", "1", "-filter_complex_threads", "1"],
        ...["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2"],
        ...["-f", "lavfi", "-i", "smptebars=size=640x360:rate=25:duration=3"],
        ...[
          "-filter_complex",
          "[0:v][1:v]concat=n=2:v=1:a=0[v]",
          "-map",
          "[v]",
        ],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
        ...["-threads", "4", "scene.mp4"],
      ],
      { timeoutMs: 120_000 },
    );
    if (made.code !== 0)
      return { run: { ok: false, log: made.log.slice(-300) } };
    const handle = await rt.adopt("scene.mp4");
    rt.executor.setInputs({ clip: handle });
    const args = [
      "-i",
      "{in:clip}",
      "-ss",
      "3",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "{out:out1}",
    ];
    const run = await rt.executor.run({
      args,
      inputs: ["clip"],
      outputs: ["out1"],
      specs: [{ id: "out1", kind: "video", container: "mp4" }],
    });
    if (!run.ok) return { run };
    const spec = {
      kind: "video",
      container: "mp4",
      video: { rotation: 0 },
      time: { start_s: 3 },
    };
    const result = await ffwd.check(spec, {
      output: run.outputs.out1,
      inputProbe: await rt.measure.probe(handle),
      inputs: [handle],
      measure: rt.measure,
      runArgs: args,
    });
    return { run: { ok: true }, result };
  });
  expect(r.run.ok, JSON.stringify(r.run)).toBe(true);
  const rot = r.result.checks.find((c) => c.field === "video.rotation");
  expect(rot, JSON.stringify(r.result)).toMatchObject({
    expected: 0,
    actual: 0,
    ok: true,
  });
  expect(r.result.passed, JSON.stringify(r.result.checks)).toBe(true);
});

test("quality of a trimmed output is measured against the input from the cut, not from its first frame", async () => {
  // Same clip as the scene-change test: the first 2 s are one picture, the rest another. The output is the last 2 s.
  const r = await inPage(async (rt) => {
    const made = await rt.session.exec(
      [
        ...["-hide_banner", "-nostdin", "-y"],
        ...["-filter_threads", "1", "-filter_complex_threads", "1"],
        ...["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2"],
        ...["-f", "lavfi", "-i", "smptebars=size=640x360:rate=25:duration=3"],
        ...[
          "-filter_complex",
          "[0:v][1:v]concat=n=2:v=1:a=0[v]",
          "-map",
          "[v]",
        ],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
        ...["-threads", "4", "quality-in.mp4"],
      ],
      { timeoutMs: 120_000 },
    );
    if (made.code !== 0) return { error: made.log.slice(-300) };
    const input = await rt.adopt("quality-in.mp4");
    rt.executor.setInputs({ clip: input });
    const run = await rt.executor.run({
      args: [
        "-i",
        "{in:clip}",
        "-ss",
        "3",
        "-c:v",
        "libx264",
        "-crf",
        "12",
        "-preset",
        "ultrafast",
        "{out:out1}",
      ],
      inputs: ["clip"],
      outputs: ["out1"],
      specs: [{ id: "out1", kind: "video", container: "mp4" }],
    });
    if (!run.ok) return { error: run.log };
    const out = run.outputs.out1;
    return {
      fromFirstFrame: await rt.measure.quality(input, out, 640, 360, 0),
      fromTheCut: await rt.measure.quality(input, out, 640, 360, 3),
    };
  });
  expect(r.error, r.error).toBeUndefined();
  expect(r.fromFirstFrame.ssim).toBeLessThan(0.9); // pitting the first scene against the cut-out second one
  expect(r.fromTheCut.ssim).toBeGreaterThan(0.95); // the same picture, re-encoded at a high quality
});
