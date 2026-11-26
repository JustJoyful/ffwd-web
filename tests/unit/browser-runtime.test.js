import { expect, test, vi } from "vitest";

// A fake core: an in-memory file map that a dispose empties, like terminating the real worker.
const core = { files: new Map(), disposed: 0 };
vi.mock("../../app/agent/executor/ffmpeg-session.js", () => ({
  FfmpegSession: class {
    onProgress() {}
    async mkdir() {}
    async write(path, bytes) {
      core.files.set(path, bytes.byteLength);
    }
    async exec() {
      return {
        code: 1,
        log: "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x':\n  Duration: 00:00:02.00, start: 0.000000, bitrate: 1 kb/s\n",
      };
    }
    dispose() {
      core.disposed += 1;
      core.files.clear();
    }
  },
}));
const { createBrowserRuntime } = await import(
  "../../app/agent/browser-runtime.js"
);

const file = (name) => ({
  name,
  arrayBuffer: async () => new ArrayBuffer(8),
});

test("choosing a second video frees the first one: fresh core, no stale sizes or probes", async () => {
  const rt = createBrowserRuntime();
  const a = await rt.probeFile(file("a.mp4"));
  expect(core.disposed).toBe(0); // the first file needs no reset
  await rt.measure.probe(a.handle); // caches a probe of the old handle
  const b = await rt.probeFile(file("b.mp4"));
  expect(core.disposed).toBe(1);
  expect([...core.files.keys()]).toEqual([b.handle]);
  expect(await rt.measure.probe(a.handle)).toBeNull(); // the old handle is gone, not a cached probe
  expect(rt.measure.probes.has(a.handle)).toBe(false);
});
