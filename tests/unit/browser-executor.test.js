// BrowserExecutor against a fake FFmpeg session: ids in, ids out, and the log never names the in-memory paths.
import { describe, expect, test } from "vitest";
import { BrowserExecutor } from "../../app/agent/executor/browser-executor.js";

function fakeSession({ code = 0, log = "", size = 10 } = {}) {
  const calls = [];
  return {
    calls,
    mkdir: async () => {},
    remove: async () => {},
    list: async () => [],
    read: async () => new Uint8Array(size),
    exec: async (argv) => {
      calls.push(argv);
      return { code, log: log(argv), timedOut: false };
    },
  };
}
const action = {
  args: ["-i", "{in:clip}", "-crf", "30", "{out:out1}"],
  inputs: ["clip"],
  outputs: ["out1"],
};
const echo = (argv) =>
  `Input #0, mov,mp4, from '${argv[argv.indexOf("-i") + 1]}':\nOutput #0, mp4, to '${argv.at(-1)}':\nError opening ${argv.at(-1)}`;

describe("the log the model gets back", () => {
  test("a failed run: input and output paths are replaced by their ids", async () => {
    const x = new BrowserExecutor(
      fakeSession({ code: 1, log: echo }),
      new Map(),
    );
    x.setInputs({ clip: "in/1-holiday.mp4" });
    const r = await x.run(action);
    expect(r.ok).toBe(false);
    expect(r.log).toContain("{in:clip}");
    expect(r.log).toContain("{out:out1}");
    expect(r.log).not.toMatch(/holiday|out\/1/);
  });
  test("a successful run keeps the real handle for the harness but not in the log", async () => {
    const x = new BrowserExecutor(fakeSession({ log: echo }), new Map());
    x.setInputs({ clip: "in/1-holiday.mp4" });
    const r = await x.run(action);
    expect(r.ok).toBe(true);
    expect(r.outputs).toEqual({ out1: "out/1/out1.mp4" });
    expect(r.log).not.toMatch(/holiday|out\/1/);
  });
  test("the argv given to FFmpeg does contain the real paths (only the log is scrubbed)", async () => {
    const s = fakeSession({ log: () => "" });
    const x = new BrowserExecutor(s, new Map());
    x.setInputs({ clip: "in/1-holiday.mp4" });
    await x.run(action);
    expect(s.calls[0]).toContain("in/1-holiday.mp4");
  });
});
