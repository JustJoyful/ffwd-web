// The one place the shared conformance suite (protocol/conformance, pinned from the ffwd repo) runs. Python and
// JavaScript must give identical results on every case (RULES §4.8). Each suite file has its case count asserted
// from the file, so a protocol sync that adds cases fails here until they are wired.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { check } from "../../app/agent/checker/index.js";
import { describeSpec } from "../../app/agent/describe-spec.js";
import { validateRun } from "../../app/agent/validator.js";
import {
  binaries,
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

// Run here, in Node.
const WIRED = {
  "validator.jsonl": 39,
  "describe-spec.jsonl": 8,
  "checker-offset.jsonl": 8,
};
// Need real media decoded by ffmpeg.wasm. Rotation runs its wasm cases in the browser (see the end of this file);
// the other three are not enabled yet.
const MEDIA_TODO = {
  "checker-frames.jsonl": 9,
  "checker-invariants.jsonl": 13,
  "checker-quality.jsonl": 6,
  "checker-rotation.jsonl": 12,
};

// Pinned with the protocol but not checker suites: the benchmark commands (Plan C/D budgets), the chat template
// (Plan E, WebLLM parity) and the timing chores.
const OTHER = [
  "bench-jobs.json",
  "chat-template.json",
  "chat-template-tokens.json",
  "timing-chores.json",
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

// The media cases run in a real browser over ffmpeg.wasm: tests/e2e/conformance.spec.js (pnpm e2e). Offset: all 8.
// Rotation: the cases whose `runtimes` include "wasm-5.1"; the rest are native-only and listed there as skipped.
describe("media cases (Plan C Task 2)", () => {
  test("checker-rotation: 5 wasm cases run in the browser, 7 are native only", () => {
    const wasm = cases("checker-rotation.jsonl").filter((c) =>
      c.runtimes.includes("wasm-5.1"),
    );
    expect(wasm).toHaveLength(5);
  });
  // Not run in the browser yet (outside the Task 2 scope: they need recipes ffmpeg.wasm cannot encode or a long clip).
  for (const file of [
    "checker-frames.jsonl",
    "checker-invariants.jsonl",
    "checker-quality.jsonl",
  ])
    test.todo(`${file} (${MEDIA_TODO[file]} cases) over ffmpeg.wasm`);
});
