import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { describeSpec } from "../../app/agent/describe-spec.js";

const cases = readFileSync("protocol/conformance/describe-spec.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

describe("describe-spec.jsonl (shared with the Python describe_spec)", () => {
  test("the file has the 8 cases this port was written against", () => {
    expect(cases).toHaveLength(8);
  });
  test.each(cases.map((c) => [c.name, c]))("%s", (_name, c) => {
    expect(describeSpec(c.spec)).toEqual(c.lines);
  });
});

// Expected values below were measured from training/env/describe_spec.py (not guessed): Python rounds half to
// even and formats with %g (six significant digits), JavaScript's defaults differ on both.
const one = (output) =>
  describeSpec({ family: ["F1"], outputs: [{ id: "out1", ...output }] });

describe("number formatting matches Python", () => {
  test("clock rounds half to even: 12.5 -> 0:12, 13.5 -> 0:14, 59.5 -> 1:00", () => {
    const t = (s) =>
      one({ kind: "video", time: { start_s: s, end_s: s + 60 } })[1];
    expect(t(12.5)).toBe("Keep from 0:12 to 1:12");
    expect(t(13.5)).toBe("Keep from 0:14 to 1:14");
    expect(t(59.5)).toBe("Keep from 1:00 to 2:00");
    expect(t(0.5)).toBe("Keep from 0:00 to 1:00");
  });
  test("sizes use six significant digits", () => {
    const s = (n) => one({ kind: "video", size_max_bytes: n })[1];
    expect(s(1_234_567)).toBe("File size: at most 1.23457 MB");
    expect(s(999)).toBe("File size: at most 0.999 KB");
    expect(s(1500)).toBe("File size: at most 1.5 KB");
    expect(s(2_000_000)).toBe("File size: at most 2 MB");
  });
  test("whole and fractional numbers", () => {
    const fps = (x) => one({ kind: "video", video: { fps: x } })[1];
    expect(fps(30)).toBe("Frame rate: 30 frames per second");
    expect(fps(29.97)).toBe("Frame rate: 29.97 frames per second");
    expect(fps(0.5)).toBe("Frame rate: 0.5 frames per second");
    expect(fps(0.00001234)).toBe("Frame rate: 1.234e-05 frames per second");
    expect(fps(10_000_000.5)).toBe("Frame rate: 1e+07 frames per second");
  });
});

describe("null fields are never mentioned", () => {
  test("a spec of only nulls says just what it is", () => {
    expect(
      one({
        kind: "video",
        container: null,
        video: { width: null, codec: null },
        audio: { present: null },
        time: { start_s: null, end_s: null, tolerance_s: 0.1 },
        size_max_bytes: null,
        lossless: null,
        quality: { min_ssim: null },
      }),
    ).toEqual(["Result: a video"]);
  });
  test("several outputs are numbered and indented", () => {
    const lines = describeSpec({
      family: ["F8"],
      outputs: [
        { id: "a", kind: "video", container: "mp4" },
        { id: "b", kind: "audio", container: "mp3" },
      ],
    });
    expect(lines).toEqual([
      "Output 1:",
      "  Result: a video (MP4)",
      "Output 2:",
      "  Result: an audio file (MP3)",
    ]);
  });
});
