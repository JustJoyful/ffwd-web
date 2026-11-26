// Frame-count checks for image_sequence outputs (training/env/checker.py `expected_frame_range`, `_check_frames`).
import { FRAME_COUNT_TOLERANCE, FRAME_SAMPLE_EPS_FRAMES } from "../config.js";
import { add, result } from "./result.js";
import { expectedDuration } from "./time.js";

/**
 * (min, max) accepted frame count for "one frame every interval_s" over duration_s. Samples are wanted at
 * t = k * interval, kept while t < duration - half a frame. The max is the strict count; the min is one lower
 * when the last sample is within half an interval of the end (FFmpeg's fps filter drops that slot, select keeps it).
 * @param {number} durationS
 * @param {number} intervalS
 * @param {number | null | undefined} fps unknown counts as 30
 * @returns {[number, number]}
 */
export function expectedFrameRange(durationS, intervalS, fps) {
  const last = durationS - FRAME_SAMPLE_EPS_FRAMES / (fps || 30);
  const strict = Math.max(1, Math.ceil(last / intervalS - 1e-9));
  const boundary = last - (strict - 1) * intervalS < intervalS / 2;
  return [boundary ? Math.max(1, strict - 1) : strict, strict];
}

/** Python's Path(name).suffix without the dot: "" for no dot, a leading dot only, or a trailing dot. */
const extension = (name) => {
  const i = name.lastIndexOf(".");
  return i <= 0 || i === name.length - 1 ? "" : name.slice(i + 1);
};

/**
 * @param {object} spec the output spec (kind image_sequence)
 * @param {unknown} output handle of the directory the frames were written to
 * @param {object} inputProbe probe of the first input
 * @param {Record<string, unknown>} measurements filled in as measuring goes
 * @param {{ listFiles(h: unknown): Promise<string[]> }} measure
 */
export async function checkFrames(
  spec,
  output,
  inputProbe,
  measurements,
  measure,
) {
  const frames = spec.frames ?? {};
  const files = await measure.listFiles(output);
  measurements.frame_count = files.length;
  if (!files.length) return result([], measurements, "no frames written");
  const checks = [];
  const expected = frames.expected_count;
  if (expected !== null && expected !== undefined) {
    const ok = Math.abs(files.length - expected) <= FRAME_COUNT_TOLERANCE;
    add(checks, "frames.expected_count", expected, files.length, ok);
  } else if (frames.interval_s && inputProbe.duration_s) {
    const vid = inputProbe.streams.find((s) => s.type === "video") ?? {};
    // over the part of the video the spec asks for ("a frame a second between 10 and 20 s" is 10 frames, not the whole clip)
    const span =
      expectedDuration(spec.time ?? {}, inputProbe) ?? inputProbe.duration_s;
    const [lo, hi] = expectedFrameRange(span, frames.interval_s, vid.fps);
    const n = files.length;
    add(
      checks,
      "frames.count_for_interval",
      `${lo}..${hi}`,
      n,
      lo <= n && n <= hi,
    );
  }
  if (frames.format) {
    const exts = [...new Set(files.map(extension))].sort();
    const ok = exts.length === 1 && exts[0] === frames.format;
    add(checks, "frames.format", frames.format, exts, ok);
  }
  return result(checks, measurements);
}
