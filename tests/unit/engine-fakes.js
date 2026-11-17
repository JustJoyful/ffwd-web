// Shared fakes for the machine and loop tests: a scripted policy, an executor that records its calls, and a Measure
// that answers from plain data. The checker itself is the real one.
import { scriptedPolicy } from "../../app/agent/scripted-policy.js";

export const V = {
  index: 0,
  type: "video",
  codec: "h264",
  width: 1280,
  height: 720,
  fps: 30,
  pix_fmt: "yuv420p",
  rotation: 0,
};
export const A = {
  index: 1,
  type: "audio",
  codec: "aac",
  sample_rate: 48000,
  channels: 2,
};
export const probeOf = (o = {}) => ({
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  duration_s: 4,
  size_bytes: 3_200_000,
  bit_rate: 6000,
  streams: [V, A],
  ...o,
});

export const SPEC_2MB = {
  family: ["F6"],
  outputs: [
    { id: "out1", kind: "video", container: "mp4", size_max_bytes: 2_000_000 },
  ],
};
export const act = (a) => JSON.stringify(a);
export const spec = (s = SPEC_2MB) => act({ action: "spec", spec: s });
export const run = (args = ["-i", "{in:clip}", "-crf", "23", "{out:out1}"]) =>
  act({ action: "run", args, inputs: ["clip"], outputs: ["out1"] });

/** Sizes per run: handle "run<N>/out1" gets sizes[N-1] (the last one repeats). */
export function fakeMeasure({ sizes = [3_200_000, 1_700_000], q } = {}) {
  const calls = [];
  const sizeOf = (h) => {
    const n = Number(/run(\d+)/.exec(String(h))?.[1] ?? 1);
    return sizes[Math.min(n, sizes.length) - 1];
  };
  return {
    calls,
    probe: async (h) => (
      calls.push(["probe", h]),
      probeOf({ size_bytes: sizeOf(h) })
    ),
    listFiles: async () => [],
    firstPacketPts: async () => null,
    loudness: async () => null,
    quality: async () => q ?? { ssim: 0.95, psnr_db: 35 },
    thumbnail: async () => null,
  };
}

export function fakeExecutor(over = {}) {
  const calls = [];
  return {
    calls,
    async run(action) {
      calls.push(action);
      const n = calls.length;
      if (over.fail) return { ok: false, log: "ffmpeg: boom", outputs: {} };
      return {
        ok: true,
        log: "",
        outputs: Object.fromEntries(
          action.outputs.map((id) => [id, `run${n}/${id}`]),
        ),
      };
    },
  };
}

export const probeFile = async (file) => ({
  id: "clip",
  probe: probeOf(),
  handle: `in/${file.name}`,
});

/** A policy that logs every conversation it is shown, on top of scriptedPolicy. */
export const policyOf = (steps) => scriptedPolicy(steps);
