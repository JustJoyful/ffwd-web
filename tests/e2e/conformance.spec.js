// The pinned conformance cases that need real media, run over ffmpeg.wasm (FFmpeg 5.1.4) in a browser: the same
// checker code and the same cases the Python tests run natively (RULES §4.8). A case runs in the browser when its
// `runtimes` include "wasm-5.1" (checker-offset.jsonl has no field: all 8 cases are portable, they run real FFmpeg
// recipes on clip_a). The rest are listed as skipped, with the reason, like Python. A wasm result that differs from
// native is REPORTED by the failing test; conformance files are never edited to make a case pass.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const cases = (file) =>
  readFileSync(`protocol/conformance/${file}`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

// Offset cases name their input `clip` (= clip_a) and give only the wanted offset; rotation cases name inputs and a spec.
const offset = cases("checker-offset.jsonl").map((c) => ({
  file: "checker-offset.jsonl",
  ...c,
  runtimes: ["native", "wasm-5.1"],
  inputs: ["clip"],
  fixtures: { clip: c.clip },
  spec: {
    id: "out1",
    kind: "video",
    container: "mp4",
    audio: { offset_ms: c.spec_offset_ms },
  },
}));
const rotation = cases("checker-rotation.jsonl").map((c) => ({
  file: "checker-rotation.jsonl",
  ...c,
  fixtures: Object.fromEntries(c.inputs.map((i) => [i, i])),
}));

test.describe.configure({ mode: "serial" });

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.ffwdReady);
  await page.evaluate(() => {
    window.rt = window.ffwd.createBrowserRuntime();
    window.inputs = {};
    // Like the Python test for offsets: no input handles, the input's own offset counts as 0. The other files
    // pass the handles, which rotation needs.
    window.runCase = async (c) => {
      const handles = {};
      for (const [id, recipe] of Object.entries(c.fixtures))
        handles[id] = window.inputs[recipe] ??= await window.ffwd.makeInput(
          window.rt,
          recipe,
        );
      window.rt.executor.setInputs(handles);
      const res = await window.rt.executor.run({
        args: c.args,
        inputs: c.inputs,
        outputs: ["out1"],
        specs: [c.spec],
      });
      if (!res.ok) return { ran: false, log: res.log.slice(-600) };
      const probes = await Promise.all(
        c.inputs.map((id) => window.rt.measure.probe(handles[id])),
      );
      const r = await window.ffwd.check(c.spec, {
        output: res.outputs.out1,
        inputProbe: probes[0],
        inputProbes: probes,
        runArgs: c.args,
        inputs:
          c.file === "checker-offset.jsonl"
            ? undefined
            : c.inputs.map((id) => handles[id]),
        measure: window.rt.measure,
      });
      return {
        ran: true,
        passed: r.passed,
        failed: r.checks.filter((x) => !x.ok).map((x) => x.field),
        measurements: r.measurements,
        error: r.error,
      };
    };
  });
});
test.afterAll(async () => {
  await page.evaluate(() => window.rt?.dispose());
  await page.close();
});

for (const c of [...offset, ...rotation]) {
  test(`${c.file}: ${c.name}`, async () => {
    test.skip(
      !c.runtimes.includes("wasm-5.1"),
      `native only (runtimes: ${c.runtimes.join(", ")})${c.note ? ": " + c.note : ""}`,
    );
    const r = await page.evaluate((c) => window.runCase(c), c);
    expect(r.ran, `FFmpeg run failed: ${r.log}`).toBe(true);
    expect(
      [r.passed, r.failed],
      JSON.stringify([r.measurements, r.error]),
    ).toEqual([c.passed, c.failed_fields]);
  });
}
