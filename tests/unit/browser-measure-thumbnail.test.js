import { describe, expect, test } from "vitest";
import { BrowserMeasure } from "../../app/agent/measure/browser-measure.js";

/** A fake FFmpeg session that records every command and the files it "wrote". */
function session({ code = 0, bytes = new Uint8Array(32 * 32) } = {}) {
  const calls = [];
  const files = new Set();
  return {
    calls,
    files,
    exec: async (args) => {
      calls.push(args);
      if (code === 0) files.add("scratch-thumb.raw");
      else files.add("scratch-thumb.raw"); // a failed run can leave a partial file behind
      return { code, log: "", timedOut: false };
    },
    read: async () => bytes,
    remove: async (p) => {
      files.delete(p);
    },
  };
}

describe("BrowserMeasure.thumbnail", () => {
  test("seeks to the requested time before the input, and not at all for the first frame", async () => {
    const s = session();
    const m = new BrowserMeasure(s);
    await m.thumbnail("in.mp4", 32, 3);
    await m.thumbnail("in.mp4", 32);
    const [timed, first] = s.calls;
    expect(timed.indexOf("-ss")).toBeGreaterThan(-1);
    expect(timed[timed.indexOf("-ss") + 1]).toBe("3");
    expect(timed.indexOf("-ss")).toBeLessThan(timed.indexOf("-i")); // an input option: no decoding of what is skipped
    expect(first).not.toContain("-ss");
  });
  test("overwrites a leftover scratch file (-y) and removes it after success and after failure", async () => {
    const ok = session();
    await new BrowserMeasure(ok).thumbnail("in.mp4", 32);
    expect(ok.calls[0]).toContain("-y");
    expect(ok.files.size).toBe(0);
    const bad = session({ code: 1 });
    expect(await new BrowserMeasure(bad).thumbnail("in.mp4", 32)).toBeNull();
    expect(bad.files.size).toBe(0); // one failed run must not break every later thumbnail
  });
});
