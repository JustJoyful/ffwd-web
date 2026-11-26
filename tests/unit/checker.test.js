import { describe, expect, test } from "vitest";
import { check, expectedDuration } from "../../app/agent/checker/index.js";
import {
  checkFrames,
  expectedFrameRange,
} from "../../app/agent/checker/frames.js";
import {
  netRotationFromThumbs,
  rotateCw,
} from "../../app/agent/checker/orientation.js";
import { validateCheck } from "../../app/agent/protocol/validate.js";

// ---------------------------------------------------------------------------------------------------------
// Everything below runs on a fake Measure (no media). Expected values follow training/env/checker.py.
// ---------------------------------------------------------------------------------------------------------
const V = {
  index: 0,
  type: "video",
  codec: "h264",
  width: 1280,
  height: 720,
  fps: 30,
  pix_fmt: "yuv420p",
  rotation: 0,
};
const A = {
  index: 1,
  type: "audio",
  codec: "aac",
  sample_rate: 48000,
  channels: 2,
};
const probeOf = (o = {}) => ({
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  duration_s: 4,
  size_bytes: 1_000_000,
  bit_rate: 2000,
  streams: [V, A],
  ...o,
});

/** A Measure whose answers are plain data; every method records its calls. */
function fake({
  out = probeOf(),
  files = [],
  pts = {},
  lufs = null,
  q = null,
  thumbs = {},
} = {}) {
  const calls = [];
  return {
    calls,
    probe: async (h) => (calls.push(["probe", h]), out),
    listFiles: async (h) => (calls.push(["listFiles", h]), files),
    firstPacketPts: async (h, t) => (
      calls.push(["pts", h, t]),
      pts[`${h}:${t}`] ?? null
    ),
    loudness: async (h) => (calls.push(["loudness", h]), lufs),
    quality: async (...a) => (calls.push(["quality", ...a]), q),
    thumbnail: async (h) => (calls.push(["thumbnail", h]), thumbs[h] ?? null),
  };
}
const run = (spec, measure, ctx = {}) =>
  check(
    { id: "out1", kind: "video", ...spec },
    {
      output: "out",
      inputProbe: probeOf(),
      runArgs: ["-i", "{in:clip}", "{out:out1}"],
      measure,
      ...ctx,
    },
  );
const fields = (r) => r.checks.map((c) => c.field);
const byField = (r, f) => r.checks.find((c) => c.field === f);

describe("which fields are checked", () => {
  test("a spec that sets only container checks only the container, plus the implicit invariants", async () => {
    const r = await run({ container: "mp4" }, fake());
    expect(fields(r)).toEqual([
      "container",
      "implicit.video_stream",
      "implicit.audio_present",
      "implicit.duration_s",
    ]);
    expect(r.passed).toBe(true);
    expect(r.error).toBeNull();
  });
  test("null fields are never checked and never measured", async () => {
    const m = fake();
    const r = await run(
      {
        container: null,
        video: {
          codec: null,
          width: null,
          height: null,
          fps: null,
          rotation: null,
        },
        audio: {
          present: null,
          codec: null,
          loudness_lufs: null,
          offset_ms: null,
        },
        time: { start_s: null, end_s: null, tolerance_s: null },
        size_max_bytes: null,
        quality: { min_ssim: null, min_psnr_db: null },
        lossless: null,
      },
      m,
    );
    expect(fields(r)).toEqual([
      "implicit.video_stream",
      "implicit.audio_present",
      "implicit.duration_s",
    ]);
    expect(m.calls.map((c) => c[0])).toEqual(["probe"]);
  });
  test("a wrong container fails with the measured container", async () => {
    const r = await run({ container: "webm" }, fake());
    expect(byField(r, "container")).toMatchObject({
      expected: "webm",
      actual: "mov,mp4,m4a,3gp,3g2,mj2",
      ok: false,
    });
    expect(r.passed).toBe(false);
  });
  test("video fields compare against the first video stream's display size", async () => {
    const rotated = probeOf({ streams: [{ ...V, rotation: 90 }, A] });
    const r = await run(
      { video: { width: 720, height: 1280, codec: "h264", fps: 29.97 } },
      fake({ out: rotated }),
    );
    const v = r.checks.filter((c) => c.field.startsWith("video."));
    expect(v.map((c) => [c.field, c.ok])).toEqual([
      ["video.codec", true],
      ["video.width", true],
      ["video.height", true],
      ["video.fps", true], // 1 % relative tolerance: 29.97 vs 30
    ]);
    const bad = await run({ video: { fps: 25 } }, fake());
    expect(byField(bad, "video.fps").ok).toBe(false);
  });
});

describe("implicit invariants (v1.2)", () => {
  const dur = async (d, ctx) =>
    byField(
      await run({}, fake({ out: probeOf({ duration_s: d }) }), ctx),
      "implicit.duration_s",
    );
  test("a 0.1 s output fails implicit.duration_s", async () => {
    const r = await run(
      { container: "mp4" },
      fake({ out: probeOf({ duration_s: 0.1 }) }),
    );
    expect(byField(r, "implicit.duration_s")).toEqual({
      field: "implicit.duration_s",
      expected: 4,
      actual: 0.1,
      ok: false,
    });
    expect(r.passed).toBe(false);
  });
  test("a duration within 0.1 s passes; beyond it fails", async () => {
    expect((await dur(4.09)).ok).toBe(true);
    expect((await dur(4.2)).ok).toBe(false);
  });
  test("several inputs expect the sum of their durations", async () => {
    const r = await dur(7, {
      inputProbes: [probeOf({ duration_s: 4 }), probeOf({ duration_s: 3 })],
    });
    expect(r).toMatchObject({ expected: 7, ok: true });
  });
  test("an audio offset request widens the duration tolerance by the shift", async () => {
    const m = fake({
      out: probeOf({ duration_s: 3.5 }),
      pts: { "out:video": 0, "out:audio": 0.5 },
    });
    const r = await run({ audio: { offset_ms: 500 } }, m);
    expect(byField(r, "implicit.duration_s").ok).toBe(true);
    expect(byField(r, "audio.offset_ms")).toMatchObject({
      expected: 500,
      actual: 500,
      ok: true,
    });
  });
  test("the input's own offset widens it too (needs the input handle)", async () => {
    const pts = {
      "in:video": 0,
      "in:audio": 0.2,
      "out:video": 0,
      "out:audio": 0,
    };
    const at = async (d) =>
      byField(
        await run(
          { audio: { offset_ms: 0 } },
          fake({ out: probeOf({ duration_s: d }), pts }),
          { inputs: ["in"] },
        ),
        "implicit.duration_s",
      );
    expect((await at(3.3)).ok).toBe(false); // 0.7 off, tolerance 0.1 + 0 + 0.2
    expect((await at(3.85)).ok).toBe(true);
  });
  test("no audio in any input: an output without audio is correct, with audio is not", async () => {
    const noAudio = probeOf({ streams: [V] });
    const ok = await run({}, fake({ out: noAudio }), { inputProbe: noAudio });
    expect(byField(ok, "implicit.audio_present")).toMatchObject({
      expected: false,
      actual: false,
      ok: true,
    });
    const bad = await run({}, fake(), { inputProbe: noAudio });
    expect(byField(bad, "implicit.audio_present").ok).toBe(false);
  });
  test("an audio request on an input with no audio fails audio.present with the measured value", async () => {
    const noAudio = probeOf({ streams: [V] });
    const r = await run({ audio: { present: true } }, fake({ out: noAudio }), {
      inputProbe: noAudio,
    });
    expect(byField(r, "audio.present")).toEqual({
      field: "audio.present",
      expected: true,
      actual: false,
      ok: false,
    });
    expect(fields(r)).not.toContain("implicit.audio_present"); // the spec states audio, so no implicit default
    expect(r.passed).toBe(false);
  });
});

describe("time, size, loudness, offset, lossless", () => {
  test("time uses the spec's tolerance, else 0.1 s; start only keeps the rest of the input", async () => {
    const t = (time) =>
      run({ time }, fake({ out: probeOf({ duration_s: 3.05 }) }));
    expect(
      byField(await t({ start_s: 1, end_s: 4 }), "time.duration_s"),
    ).toMatchObject({ expected: 3, ok: true });
    expect(byField(await t({ start_s: 1 }), "time.duration_s")).toMatchObject({
      expected: 3,
      ok: true,
    });
    expect(byField(await t({ end_s: 3 }), "time.duration_s").ok).toBe(true);
    expect(
      byField(await t({ end_s: 3, tolerance_s: 0.01 }), "time.duration_s").ok,
    ).toBe(false);
    expect(
      byField(await t({ end_s: 3.5, tolerance_s: 0.5 }), "time.duration_s").ok,
    ).toBe(true);
    // A set time field replaces the implicit duration check.
    expect(fields(await t({ end_s: 3 }))).not.toContain("implicit.duration_s");
  });
  test("size_max_bytes is a ceiling", async () => {
    const m = () => fake({ out: probeOf({ size_bytes: 1_700_000 }) });
    expect(
      byField(await run({ size_max_bytes: 2_000_000 }, m()), "size_max_bytes")
        .ok,
    ).toBe(true);
    expect(
      byField(await run({ size_max_bytes: 1_600_000 }, m()), "size_max_bytes"),
    ).toMatchObject({ expected: 1_600_000, actual: 1_700_000, ok: false });
  });
  test("loudness: within 2 LU passes, unmeasurable fails closed", async () => {
    const l = (lufs) => run({ audio: { loudness_lufs: -16 } }, fake({ lufs }));
    expect(byField(await l(-15), "audio.loudness_lufs").ok).toBe(true);
    expect(byField(await l(-13.9), "audio.loudness_lufs").ok).toBe(false);
    expect(byField(await l(null), "audio.loudness_lufs")).toMatchObject({
      actual: null,
      ok: false,
    });
  });
  test("loudness is not measured when the output has no audio", async () => {
    const m = fake({ out: probeOf({ streams: [V] }), lufs: -16 });
    const r = await run({ audio: { loudness_lufs: -16 } }, m);
    expect(byField(r, "audio.loudness_lufs")).toMatchObject({
      actual: null,
      ok: false,
    });
    expect(m.calls.some((c) => c[0] === "loudness")).toBe(false);
  });
  test("offset: 40 ms tolerance, unmeasurable fails closed", async () => {
    const o = (a, spec = 500) =>
      run(
        { audio: { offset_ms: spec } },
        fake({ pts: { "out:video": 0, "out:audio": a } }),
      );
    expect(byField(await o(0.54), "audio.offset_ms").ok).toBe(true);
    expect(byField(await o(0.541), "audio.offset_ms").ok).toBe(false);
    expect(byField(await o(0.5, -500), "audio.offset_ms").ok).toBe(false);
    expect(
      byField(
        await run({ audio: { offset_ms: 0 } }, fake()),
        "audio.offset_ms",
      ),
    ).toMatchObject({ actual: null, ok: false });
  });
  test("lossless is true only when the command was stream copy", async () => {
    const copy = await run({ lossless: true }, fake(), {
      runArgs: ["-i", "{in:a}", "-c", "copy", "{out:o}"],
    });
    expect(byField(copy, "lossless").ok).toBe(true);
    expect(copy.measurements.re_encoded).toBe(false);
    const enc = await run({ lossless: true }, fake(), {
      runArgs: ["-i", "{in:a}", "-c:v", "libx264", "{out:o}"],
    });
    expect(byField(enc, "lossless").ok).toBe(false);
  });
});

describe("quality floor", () => {
  const sized = { size_max_bytes: 2_000_000 };
  const withQ = (q) => fake({ q });
  test("a size-target video that keeps timeline and framing gets the default floors", async () => {
    const good = withQ({ ssim: 0.95, psnr_db: 30 });
    const r = await run(sized, good, { inputs: ["in"] });
    expect(byField(r, "quality.min_ssim")).toEqual({
      field: "quality.min_ssim",
      expected: 0.9,
      actual: 0.95,
      ok: true,
    });
    expect(byField(r, "quality.min_psnr_db")).toMatchObject({
      expected: 28,
      ok: true,
    });
    expect(good.calls.find((c) => c[0] === "quality")).toEqual([
      "quality",
      "in",
      "out",
      1280,
      720,
      0, // no start time: compared from the first frame
    ]);
    const poor = await run(sized, withQ({ ssim: 0.84, psnr_db: 23 }), {
      inputs: ["in"],
    });
    expect([
      byField(poor, "quality.min_ssim").ok,
      byField(poor, "quality.min_psnr_db").ok,
    ]).toEqual([false, false]);
  });
  test("unmeasurable quality fails both floors", async () => {
    const r = await run(sized, withQ(null), { inputs: ["in"] });
    const q = r.checks.filter((c) => c.field.startsWith("quality."));
    expect(q.map((c) => c.ok)).toEqual([false, false]);
    expect(r.measurements.quality).toBeNull();
  });
  test("trimmed or reframed outputs are exempt unless the spec states a quality", async () => {
    const has = async (spec) =>
      fields(
        await run(spec, withQ({ ssim: 0.5, psnr_db: 10 }), { inputs: ["in"] }),
      );
    expect(await has({ ...sized, time: { start_s: 1 } })).not.toContain(
      "quality.min_ssim",
    );
    expect(await has({ ...sized, video: { width: 640 } })).not.toContain(
      "quality.min_ssim",
    );
    expect(await has({ video: { codec: "h264" } })).not.toContain(
      "quality.min_ssim",
    );
    const explicit = await has({
      time: { start_s: 1 },
      quality: { min_ssim: 0.8 },
    });
    expect(explicit).toContain("quality.min_ssim");
    expect(explicit).not.toContain("quality.min_psnr_db");
  });
});

describe("frames (image_sequence)", () => {
  const names = (n, ext = "png") =>
    Array.from(
      { length: n },
      (_, i) => `${String(i + 1).padStart(4, "0")}.${ext}`,
    );
  const input = probeOf({ duration_s: 10, streams: [{ ...V, fps: 25 }, A] });
  const frames = (f, files) =>
    check(
      { id: "out1", kind: "image_sequence", frames: f },
      {
        output: "dir",
        inputProbe: input,
        runArgs: ["-i", "{in:a}", "-vf", "fps=1/2", "{out:out1}"],
        measure: fake({ files }),
      },
    );
  test("an explicit count has zero tolerance (checker-frames.jsonl: 'a wrong explicit count fails')", async () => {
    const at = async (expected, n) =>
      byField(
        await frames({ expected_count: expected }, names(n)),
        "frames.expected_count",
      ).ok;
    expect(await at(5, 5)).toBe(true);
    expect(await at(6, 5)).toBe(false);
    expect(await at(4, 5)).toBe(false);
  });
  test("an interval with no count accepts the computed range", async () => {
    expect(
      byField(
        await frames({ interval_s: 2 }, names(5)),
        "frames.count_for_interval",
      ),
    ).toMatchObject({ expected: "5..5", ok: true });
    expect((await frames({ interval_s: 2 }, names(4))).passed).toBe(false);
  });
  test("format is the extension of every file", async () => {
    expect(
      byField(await frames({ format: "png" }, names(2)), "frames.format"),
    ).toMatchObject({ actual: ["png"], ok: true });
    expect(
      byField(
        await frames({ format: "png" }, [...names(1), "0002.jpg"]),
        "frames.format",
      ),
    ).toMatchObject({ actual: ["jpg", "png"], ok: false });
  });
  test("no files is an error, and the count is still measured", async () => {
    const r = await frames({ expected_count: 5 }, []);
    expect(r).toMatchObject({
      passed: false,
      checks: [],
      error: "no frames written",
    });
    expect(r.measurements.frame_count).toBe(0);
  });
  test("expectedFrameRange: far from the end the count is exact, near it one lower is accepted", () => {
    expect(expectedFrameRange(10, 2, 25)).toEqual([5, 5]);
    expect(expectedFrameRange(4, 3, 30)).toEqual([1, 2]);
    expect(expectedFrameRange(0.01, 5, 30)).toEqual([1, 1]);
    expect(expectedFrameRange(10, 2, null)).toEqual([5, 5]); // unknown fps counts as 30
  });
});

describe("failures are results, never exceptions (Review Focus 3)", () => {
  test("a missing or empty output", async () => {
    const r = await run({ container: "mp4" }, fake({ out: null }));
    expect(r).toMatchObject({
      passed: false,
      checks: [],
      error: "output missing or empty",
    });
    expect(r.measurements.re_encoded).toBe(true);
  });
  test("a Measure that throws, on every method", async () => {
    const boom = () => Promise.reject(new Error("x"));
    const base = fake();
    const cases = [
      [
        "probe",
        { ...base, probe: () => Promise.reject(new TypeError("x")) },
        {},
        "probe failed: TypeError",
      ],
      [
        "loudness",
        { ...base, loudness: boom },
        { audio: { loudness_lufs: -16 } },
        "measurement failed: Error",
      ],
      [
        "firstPacketPts",
        { ...base, firstPacketPts: boom },
        { audio: { offset_ms: 0 } },
        "measurement failed: Error",
      ],
      [
        "quality",
        { ...base, quality: boom },
        { size_max_bytes: 9_999_999 },
        "measurement failed: Error",
      ],
      [
        "listFiles",
        { ...base, listFiles: boom },
        { kind: "image_sequence" },
        "measurement failed: Error",
      ],
    ];
    for (const [name, m, spec, error] of cases) {
      const r = await run(spec, m, { inputs: ["in"] });
      expect(r.error, name).toBe(error);
      expect(r.passed, name).toBe(false);
    }
  });
  test("a Measure that throws a non-Error", async () => {
    const r = await run({}, { ...fake(), probe: () => Promise.reject("nope") });
    expect(r.error).toBe("probe failed: Error");
    expect(r.passed).toBe(false);
  });
  test("an output with no streams, or zero or unknown duration, has no media", async () => {
    for (const out of [
      probeOf({ streams: [] }),
      probeOf({ duration_s: 0 }),
      probeOf({ duration_s: null }),
    ]) {
      const r = await run({}, fake({ out }));
      expect(r).toMatchObject({
        passed: false,
        checks: [],
        error: "output has no media",
      });
    }
  });
  test("an audio-only output asked to be a video fails implicit.video_stream with the measured value", async () => {
    const r = await run({}, fake({ out: probeOf({ streams: [A] }) }));
    expect(byField(r, "implicit.video_stream")).toEqual({
      field: "implicit.video_stream",
      expected: true,
      actual: false,
      ok: false,
    });
  });
  test("a video spec on an output with no video stream", async () => {
    const r = await run(
      { video: { codec: "h264" } },
      fake({ out: probeOf({ streams: [A] }) }),
    );
    expect(byField(r, "video")).toEqual({
      field: "video",
      expected: "present",
      actual: null,
      ok: false,
    });
  });
  test("an input probe with a missing duration skips the implicit duration check", async () => {
    const noDur = probeOf({ duration_s: null });
    const r = await run({}, fake(), {
      inputProbe: noDur,
      inputProbes: [noDur],
    });
    expect(fields(r)).not.toContain("implicit.duration_s");
  });
  test("every result has the shape of check.schema.json", async () => {
    for (const r of [
      await run({ container: "mp4" }, fake()),
      await run({}, fake({ out: null })),
      await run({}, { ...fake(), probe: () => Promise.reject(new Error("x")) }),
    ])
      expect(validateCheck(r)).toEqual({ ok: true, errors: [] });
  });
});

describe("net rotation from thumbnails (checker v1.2)", () => {
  // An asymmetric 4x4 picture so all four rotations differ.
  const pic = [
    [255, 255, 0, 0],
    [255, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 255],
  ];
  test.each([0, 90, 180, 270])(
    "a picture turned %i degrees clockwise is measured as %i",
    (deg) => {
      expect(netRotationFromThumbs(pic, rotateCw(pic, deg))).toBe(deg);
    },
  );
  test("rotateCw 90 sends the top-left corner to the top-right", () => {
    expect(rotateCw(pic, 90)[0][3]).toBe(pic[0][0]);
    expect(() => rotateCw(pic, 45)).toThrow(/0\/90\/180\/270/);
  });
  test("an ambiguous picture (all one grey) measures as unknown", () => {
    const grey = pic.map((r) => r.map(() => 128));
    expect(netRotationFromThumbs(grey, grey)).toBeNull();
  });
  test("check() measures it through Measure.thumbnail and fails closed when unreadable", async () => {
    const ok = fake({ thumbs: { in: pic, out: rotateCw(pic, 90) } });
    const r = await run({ video: { rotation: 90 } }, ok, { inputs: ["in"] });
    expect(byField(r, "video.rotation")).toEqual({
      field: "video.rotation",
      expected: 90,
      actual: 90,
      ok: true,
    });
    expect(r.measurements.net_rotation_cw).toBe(90);
    const bad = await run(
      { video: { rotation: 90 } },
      fake({ thumbs: { in: pic } }),
      { inputs: ["in"] },
    );
    expect(byField(bad, "video.rotation")).toMatchObject({
      actual: null,
      ok: false,
    });
    const noInput = await run({ video: { rotation: 90 } }, fake());
    expect(byField(noInput, "video.rotation")).toMatchObject({
      actual: null,
      ok: false,
    });
  });

  // A trim keeps the picture's turn but not its first frame: the output's first frame is the input's frame at the cut.
  const timed = (thumbs) => {
    const seen = [];
    return {
      seen,
      measure: {
        ...fake(),
        thumbnail: async (h, _size, at = 0) => (seen.push([h, at]), thumbs[h]),
      },
    };
  };
  test("the input frame is read at the spec's start time, the output's at its start", async () => {
    const { seen, measure } = timed({ in: pic, out: pic });
    const r = await run(
      { video: { rotation: 0 }, time: { start_s: 3 } },
      measure,
      { inputs: ["in"] },
    );
    expect(seen).toEqual([
      ["in", 3],
      ["out", 0],
    ]);
    expect(byField(r, "video.rotation")).toMatchObject({ actual: 0, ok: true });
  });
  test("without a start time the input's first frame is used, as before", async () => {
    const { seen, measure } = timed({ in: pic, out: rotateCw(pic, 90) });
    await run({ video: { rotation: 90 } }, measure, { inputs: ["in"] });
    expect(seen).toEqual([
      ["in", 0],
      ["out", 0],
    ]);
  });
  test("a spec with only an end time still reads the input at 0", async () => {
    const { seen, measure } = timed({ in: pic, out: pic });
    await run({ video: { rotation: 0 }, time: { end_s: 2 } }, measure, {
      inputs: ["in"],
    });
    expect(seen[0]).toEqual(["in", 0]);
  });
});

describe("a time range in the spec (found 2026-11-26)", () => {
  test("an end time past the end of the input is the input's end, not a failure", () => {
    const probe = { duration_s: 20 };
    expect(expectedDuration({ end_s: 30 }, probe)).toBe(20); // "keep the first 30 seconds" of a 20 s clip
    expect(expectedDuration({ start_s: 5, end_s: 30 }, probe)).toBe(15);
    expect(expectedDuration({ end_s: 10 }, probe)).toBe(10); // unchanged inside the clip
    expect(expectedDuration({ start_s: 4 }, probe)).toBe(16);
    expect(expectedDuration({}, probe)).toBeNull();
    expect(expectedDuration({ end_s: 30 }, { duration_s: null })).toBe(30); // unknown length: as asked
  });
  test("a quality floor on a trimmed output is measured from the cut, not from the input's first frame", async () => {
    const m = fake({ q: { ssim: 0.97, psnr_db: 35 } });
    const r = await run(
      { quality: { min_ssim: 0.9 }, time: { start_s: 3 } },
      m,
      { inputs: ["in"] },
    );
    expect(m.calls.find((c) => c[0] === "quality").at(-1)).toBe(3);
    expect(byField(r, "quality.min_ssim")).toMatchObject({ ok: true });
  });
});

describe("frames over a time range", () => {
  const probe = { duration_s: 60, streams: [{ type: "video", fps: 30 }] };
  const frames = (n, ext = "png") =>
    Array.from(
      { length: n },
      (_, i) => `${String(i + 1).padStart(4, "0")}.${ext}`,
    );
  const check = (spec, n) =>
    checkFrames(spec, "dir", probe, {}, { listFiles: async () => frames(n) });
  test("a frame a second between 10 s and 20 s is 10 frames, not 60", async () => {
    const spec = {
      kind: "image_sequence",
      frames: { interval_s: 1, format: "png" },
      time: { start_s: 10, end_s: 20 },
    };
    expect((await check(spec, 10)).passed).toBe(true);
    expect((await check(spec, 60)).passed).toBe(false); // the whole clip is not what was asked
  });
  test("without a time range the whole clip counts, as before", async () => {
    const spec = {
      kind: "image_sequence",
      frames: { interval_s: 1, format: "png" },
    };
    expect((await check(spec, 60)).passed).toBe(true);
    expect((await check(spec, 10)).passed).toBe(false);
  });
});
