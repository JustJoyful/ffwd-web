import { describe, expect, test } from "vitest";
import {
  FAILURE_TEXT,
  classifyFailure,
} from "../../app/agent/ffmpeg-errors.js";
import { createJob, executeRun } from "../../app/agent/loop.js";
import { SPEC_2MB, probeFile, probeOf } from "./engine-fakes.js";

describe("classifyFailure", () => {
  test.each([
    [
      "option",
      "Unrecognized option 'foo'.\nError splitting the argument list: Option not found",
    ],
    [
      "option",
      "[AVFilterGraph] No such filter: 'bogus'\nError initializing filters",
    ],
    ["option", "Error parsing filter 'scale=abc'"],
    ["stream", "Stream map '0:a' matches no streams."],
    ["stream", "{in:clip}: No such file or directory"],
    ["stream", "Output file #0 does not contain any stream"],
    ["codec", "Unknown encoder 'libfoo'"],
    ["codec", "Automatic encoder selection failed for output stream #0:0"],
    ["combination", "Filtering and streamcopy cannot be used together."],
    [
      "combination",
      "Error while opening encoder for output stream #0:0 - maybe incorrect parameters\nInvalid argument",
    ],
    ["memory", "RuntimeError: Aborted(OOM)"],
    ["memory", "Cannot allocate memory"],
    ["interrupted", "frame=10\n[timed out]"],
    ["unknown", "something else entirely"],
    ["unknown", ""],
  ])("%s: %s", (kind, log) => expect(classifyFailure(log)).toBe(kind));
  test("every class has a short sentence with no path, code or stderr", () => {
    for (const t of Object.values(FAILURE_TEXT)) {
      expect(t.length).toBeLessThan(120);
      expect(t).not.toMatch(/\/|\\|exit|code \d|\{in:|\{out:/i);
    }
  });
});

describe("executeRun on an FFmpeg failure", () => {
  test("the model gets the scrubbed tail; the entry carries the class, not the log", async () => {
    const job = createJob({
      request: "x",
      inputs: [await probeFile({ name: "a.mp4" })],
    });
    job.spec = SPEC_2MB;
    const log = "{in:clip}: Invalid data\nNo such filter: 'bogus'";
    const { obs, run } = await executeRun(
      job,
      {
        args: ["-i", "{in:clip}", "-vf", "scale=abc", "{out:out1}"],
        inputs: ["clip"],
        outputs: ["out1"],
      },
      {
        executor: {
          run: async () => ({
            ok: false,
            log,
            outputs: {},
            error: "FFmpeg exited with code 1",
          }),
        },
        measure: {},
      },
    );
    expect(obs).toEqual({ run_ok: false, rejected: null, stderr_tail: log });
    expect(run.failure).toBe("option");
    expect(probeOf).toBeTypeOf("function");
  });
});
