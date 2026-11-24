// The one place the shared conformance suite (protocol/conformance, pinned from the ffwd repo) runs. Python and
// JavaScript must give identical results on every case (RULES §4.8). Each suite file has its case count asserted
// from the file, so a protocol sync that adds cases fails here until they are wired.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { check } from "../../app/agent/checker/index.js";
import { describeSpec } from "../../app/agent/describe-spec.js";
import { validateRun } from "../../app/agent/validator.js";
import { makeCorpus } from "./native-corpus.js";
import {
  binaries,
  ffmpegMajor,
  makeClipA,
  nativeMeasure,
  runArgs,
  scratch,
} from "./native-measure.js";

const DIR = "protocol/conformance";
const cases = (file) =>
  readFileSync(join(DIR, file), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

// Run here, in Node (the media ones on native ffmpeg: needs ffmpeg and ffprobe, see `nativeSkip`).
const WIRED = {
  "validator.jsonl": 39,
  "describe-spec.jsonl": 8,
  "checker-offset.jsonl": 8,
  "checker-frames.jsonl": 9,
  "checker-invariants.jsonl": 13,
  "checker-quality.jsonl": 6,
  "checker-rotation.jsonl": 12,
};
// Wired but run only in a browser: none (every case has a native recipe). The wasm-5.1 rotation cases run here AND in
// tests/e2e/conformance.spec.js; the case lists in the two places are checked against each other below.
const MEDIA_TODO = {};

// Pinned with the protocol but not checker suites: the benchmark commands (Plan C/D budgets), the chat template
// (Plan E, WebLLM parity) and the timing chores.
const OTHER = [
  "bench-jobs.json",
  "chat-template.json",
  "chat-template-tokens.json",
  "timing-chores.json",
  "model-manifest.jsonl", // tests/unit/model-manifest.test.js
];

describe("the pinned suite is fully accounted for", () => {
  test("every file in protocol/conformance is wired here, a media todo, or listed as not a checker suite", () => {
    const known = new Set([
      ...Object.keys(WIRED),
      ...Object.keys(MEDIA_TODO),
      ...OTHER,
    ]);
    const unknown = readdirSync(DIR).filter((f) => !known.has(f));
    expect(unknown).toEqual([]);
  });
  test.each(Object.entries({ ...WIRED, ...MEDIA_TODO }))(
    "%s has %i cases",
    (file, n) => {
      expect(cases(file)).toHaveLength(n);
    },
  );
});

describe("validator.jsonl", () => {
  test.each(cases("validator.jsonl").map((c) => [c.name, c]))(
    "%s",
    (_name, c) => {
      const r = validateRun(c.args, c.inputs, c.outputs);
      expect(r.ok, r.reason ?? "").toBe(c.ok);
      if (c.ok) expect(r.reason).toBeNull();
      else expect(r.reason).toContain(c.reason_contains);
    },
  );
});

describe("describe-spec.jsonl", () => {
  test.each(cases("describe-spec.jsonl").map((c) => [c.name, c]))(
    "%s",
    (_name, c) => {
      expect(describeSpec(c.spec)).toEqual(c.lines);
    },
  );
});

// Each case runs a real FFmpeg recipe on clip_a and the checker reads the output's first-packet timestamps. They run
// against native ffmpeg here (Measure = nativeMeasure; needs ffmpeg and ffprobe) and over ffmpeg.wasm in Plan C.
describe("checker-offset.jsonl", () => {
  const offsetCases = cases("checker-offset.jsonl");
  let tmp;
  let clip;
  const measure = nativeMeasure();
  beforeAll(() => {
    console.info("conformance FFmpeg:", JSON.stringify(binaries()));
    tmp = scratch();
    clip = join(tmp.dir, "clip_a.mp4");
    makeClipA(clip);
  });
  afterAll(() => tmp?.cleanup());

  test.each(offsetCases.map((c, i) => [c.name, c, i]))(
    "%s",
    async (_name, c, i) => {
      const dir = join(tmp.dir, String(i));
      mkdirSync(dir);
      const out = join(dir, "out1.mp4");
      runArgs(c.args, { "{in:clip}": clip, "{out:out1}": out });
      const spec = {
        id: "out1",
        kind: "video",
        container: "mp4",
        audio: { offset_ms: c.spec_offset_ms },
      };
      // Like the Python test: no input handles, so the input's own offset counts as 0.
      const res = await check(spec, {
        output: out,
        inputProbe: await measure.probe(clip),
        runArgs: c.args,
        measure,
      });
      const failed = res.checks.filter((x) => !x.ok).map((x) => x.field);
      expect([res.passed, failed], JSON.stringify(res.measurements)).toEqual([
        c.passed,
        c.failed_fields,
      ]);
    },
  );
});

// The four media suites. Each case runs its recipe on native ffmpeg over the corpus clips it names (built from the
// same recipes as the Python corpus) and the checker judges the output, exactly like tests/env/test_checker_cases.py.
// Image sequences go to a directory with a %04d pattern (training/env/executor.py output_path_for).
const MEDIA = [
  "checker-frames.jsonl",
  "checker-invariants.jsonl",
  "checker-quality.jsonl",
  "checker-rotation.jsonl",
];
const mediaCases = MEDIA.flatMap((file) =>
  cases(file).map((c) => ({ file, ...c })),
);

// A missing ffmpeg skips these with the reason on a developer machine and FAILS in CI (CI sets CI=true and pins
// FFmpeg 5.1.1), because a silently skipped conformance case looks like a pass.
function nativeSkip() {
  try {
    binaries();
    return null;
  } catch (e) {
    if (process.env.CI) throw e;
    return "ffmpeg/ffprobe not on PATH (set FFWD_FFMPEG_BIN / FFWD_FFPROBE_BIN); CI runs these";
  }
}

describe.each(MEDIA)("%s (native ffmpeg)", (file) => {
  const suite = mediaCases.filter((c) => c.file === file);
  const skip = nativeSkip();
  let tmp;
  let clips;
  const measure = nativeMeasure();
  beforeAll(() => {
    if (skip) return;
    console.info(file, "FFmpeg:", JSON.stringify(binaries()));
    tmp = scratch();
    clips = makeCorpus(tmp.dir, [...new Set(suite.flatMap((c) => c.inputs))]);
  }, 120_000);
  afterAll(() => tmp?.cleanup());

  test.skipIf(skip)(
    "every case has a native recipe (none is silently left out)",
    () => {
      expect(suite.filter((c) => !c.runtimes.includes("native"))).toEqual([]);
    },
  );
  for (const [i, c] of suite.entries()) {
    // `-metadata:s:v:0 rotate=N` is the FFmpeg 5.1 spelling of a display-matrix turn (D-024); FFmpeg 6 and later ignore
    // the tag, so on a newer local ffmpeg these cases would measure rotation 0 whatever the checker does. CI pins 5.1.1.
    const needs5 =
      c.args.some((a) => /^rotate=/.test(a)) && ffmpegMajor() !== 5;
    const why =
      skip ??
      (needs5
        ? `needs FFmpeg 5.x (found ${ffmpegMajor()}): the rotate= tag is ignored later`
        : null);
    test(
      why ? `${c.name} [skipped: ${why}]` : c.name,
      { timeout: 120_000, skip: Boolean(why) },
      async () => {
        const dir = join(tmp.dir, `${file}-${i}`);
        mkdirSync(dir);
        const frames = c.spec.kind === "image_sequence";
        const ext = frames
          ? (c.spec.frames?.format ?? "png")
          : (c.spec.container ?? "mp4");
        const artifact = frames ? join(dir, "out1") : join(dir, `out1.${ext}`);
        if (frames) mkdirSync(artifact);
        const target = frames ? join(artifact, `%04d.${ext}`) : artifact;
        const files = { "{out:out1}": target };
        for (const id of c.inputs) files[`{in:${id}}`] = clips[id];
        runArgs(c.args, files);
        const inputs = c.inputs.map((id) => clips[id]);
        const probes = await Promise.all(inputs.map((p) => measure.probe(p)));
        const res = await check(c.spec, {
          output: artifact,
          inputProbe: probes[0],
          inputProbes: probes,
          inputs,
          runArgs: c.args,
          measure,
        });
        const failed = res.checks.filter((x) => !x.ok).map((x) => x.field);
        expect(
          [res.passed, failed],
          JSON.stringify([res.measurements, res.error, ffmpegMajor()]),
        ).toEqual([c.passed, c.failed_fields]);
      },
    );
  }
});

// The browser side (tests/e2e/conformance.spec.js, `pnpm e2e`) runs checker-offset (all 8) and the rotation cases whose
// `runtimes` include "wasm-5.1". Nothing else lists wasm, so the other three suites are native only by their own data.
describe("what the browser runs", () => {
  test("rotation: 5 wasm cases (also run here), 7 native only; no other suite lists wasm", () => {
    const wasm = (f) => cases(f).filter((c) => c.runtimes.includes("wasm-5.1"));
    expect(wasm("checker-rotation.jsonl")).toHaveLength(5);
    for (const f of MEDIA.filter((f) => f !== "checker-rotation.jsonl"))
      expect(wasm(f)).toHaveLength(0);
  });
});
