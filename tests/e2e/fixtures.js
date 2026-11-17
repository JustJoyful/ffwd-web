// Test inputs, built inside the browser with FFmpeg lavfi sources only (no corpus clip is loaded: the Plan B
// test-real guard stays green). Recipes are ported from training/corpus/make_synthetic.py (same sources, codecs and
// stable flags). Only recipes that ffmpeg.wasm core-mt can encode are ported: no libx265, libvpx, libopus or
// libmp3lame recipes (hevc_iphone, vp9_opus_webm, mpeg4_avi) until a case needs them and the core is confirmed to
// have the encoder.

import { FFMPEG_FILTER_THREADS } from "../../app/agent/config.js";

const video = (size, rate, seconds) => [
  ...[
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${size}:rate=${rate}:duration=${seconds}`,
  ],
];
const audio = (seconds, db = 0) => [
  ...[
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${seconds},volume=${db}dB`,
  ],
];
const H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "96k"];
// Same bytes on the same FFmpeg build: no encoder tags, no source metadata (Python _STABLE).
const STABLE = [
  "-fflags",
  "+bitexact",
  "-map_metadata",
  "-1",
  "-flags:v",
  "+bitexact",
];

/** id -> [file name, ffmpeg args between `-y` and the stable flags] */
export const RECIPES = {
  h264_aac_1080p: [
    "h264_aac_1080p.mp4",
    [...video("1920x1080", 30, 4), ...audio(4), ...H264, ...AAC],
  ],
  h264_noaudio: ["h264_noaudio.mp4", [...video("1280x720", 30, 4), ...H264]],
  h264_25fps_720p: [
    "h264_25fps_720p.mp4",
    [...video("1280x720", 25, 10), ...audio(10), ...H264, ...AAC],
  ],
  h264_long: [
    "h264_long.mp4",
    [...video("1280x720", 30, 20), ...audio(20), ...H264, ...AAC],
  ],
  clip_a: [
    "clip_a.mp4",
    [...video("1280x720", 30, 3), ...audio(3), ...H264, ...AAC],
  ],
  clip_b: [
    "clip_b.mp4",
    [...video("1280x720", 30, 3), ...audio(3), ...H264, ...AAC],
  ],
  // The flow specs drop these on the real /app page: a 4 s 720p clip, and the same picture as a .MOV named like an
  // iPhone file (h264 here: the core has no HEVC encoder, see the note above).
  e2e_sample: [
    "sample.mp4",
    [...video("1280x720", 30, 4), ...audio(4), ...H264, ...AAC],
  ],
  e2e_iphone: [
    "IMG_4021.MOV",
    [...video("1280x720", 30, 4), ...audio(4), ...H264, ...AAC],
  ],
  av_late_500: [
    "av_late_500.mp4",
    [
      ...video("1280x720", 30, 4),
      "-itsoffset",
      "0.5",
      ...audio(4),
      ...H264,
      ...AAC,
    ],
  ],
};

/**
 * Build a named input inside the page and return its handle (a path in the core's memory). Returns a handle rather
 * than bytes so a multi-megabyte clip is not copied out to the test and back.
 * @param {{ session: { exec(args: string[]): Promise<{ code: number, log: string }> }, adopt(path: string): Promise<string> }} runtime
 * @param {string} name a key of RECIPES
 * @returns {Promise<string>}
 */
export async function makeInput(runtime, name) {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`no wasm recipe for input ${name}`);
  const [file, args] = recipe;
  const path = `fixture-${file}`;
  const r = await runtime.session.exec(
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      ...FFMPEG_FILTER_THREADS,
      ...args,
      ...STABLE,
      "-threads",
      "4",
      path,
    ],
    { timeoutMs: 240_000 },
  );
  if (r.code !== 0)
    throw new Error(`could not build ${name}: ${r.log.slice(-400)}`);
  return runtime.adopt(path);
}
