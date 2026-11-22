// The corpus clips the conformance cases name, built with native ffmpeg from the same recipes as
// training/corpus/make_synthetic.py (RECIPES; synthetic, CC0, nothing downloaded). Only the clips the checker suites
// need are here. Python generates them bit-exact on the pinned FFmpeg; here they only need the same content (length,
// streams, picture), so no -bitexact flags and an extra `-threads 2` to keep the CPU light.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const FFMPEG = process.env.FFWD_FFMPEG_BIN ?? "ffmpeg";

const video = (size, rate, s) => [
  "-f",
  "lavfi",
  "-i",
  `testsrc2=size=${size}:rate=${rate}:duration=${s}`,
];
const audio = (s, db = 0) => [
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=440:sample_rate=48000:duration=${s},volume=${db}dB`,
];
const H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "96k"];

/** id -> [file name, ffmpeg args between the binary and the output path] */
export const RECIPES = {
  h264_aac_1080p: [
    "h264_aac_1080p.mp4",
    [...video("1920x1080", 30, 4), ...audio(4), ...H264, ...AAC],
  ],
  hevc_iphone: [
    "hevc_iphone.mov",
    [
      ...video("1920x1080", 30, 4),
      ...audio(4),
      ...[
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-tag:v",
        "hvc1",
        "-x265-params",
        "log-level=error",
      ],
      ...AAC,
    ],
  ],
  h264_noaudio: ["h264_noaudio.mp4", [...video("1280x720", 30, 4), ...H264]],
  h264_25fps_720p: [
    "h264_25fps_720p.mp4",
    [...video("1280x720", 25, 10), ...audio(10), ...H264, ...AAC],
  ],
  vp9_opus_webm: [
    "vp9_opus_webm.webm",
    [
      ...video("640x360", 30, 4),
      ...audio(4),
      ...[
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-c:a",
        "libopus",
      ],
    ],
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
 * Build the named clips into `dir`; returns id -> path. Arguments are a list, never a shell string.
 * @param {string} dir
 * @param {string[]} ids
 */
export function makeCorpus(dir, ids) {
  const paths = {};
  for (const id of ids) {
    const recipe = RECIPES[id];
    if (!recipe) throw new Error(`no recipe for corpus clip ${id}`);
    const out = join(dir, recipe[0]);
    execFileSync(
      FFMPEG,
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-threads",
        "2",
        ...recipe[1],
        "-map_metadata",
        "-1",
        out,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    paths[id] = out;
  }
  return paths;
}
