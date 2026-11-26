// Picture-quality floor for size-target outputs (training/env/checker.py `_quality_applies`, `_quality_checks`).
// Without it "under 2 MB" is satisfied by a blank or tiny video. Unmeasurable fails the field (fail closed).
import { PSNR_FLOOR_DB_DEFAULT, SSIM_FLOOR_DEFAULT } from "../config.js";
import { add } from "./result.js";

/** Width/height as the viewer sees them (rotation 90/270 swaps the coded dimensions). */
export const displaySize = (s) =>
  s.rotation === 90 || s.rotation === 270
    ? [s.height, s.width]
    : [s.width, s.height];

const firstVideo = (probe) => probe.streams.find((s) => s.type === "video");
const isSet = (x) => x !== null && x !== undefined;

/**
 * Default floor applies to a size-target video that keeps the input's timeline and framing (so frames are
 * comparable). Trimmed or reframed outputs are exempt unless the spec states a quality explicitly.
 */
export function qualityApplies(spec, inputProbe) {
  const t = spec.time ?? {};
  const video = spec.video ?? {};
  const inp = firstVideo(inputProbe);
  if (!isSet(spec.size_max_bytes) || spec.kind !== "video" || !inp)
    return false;
  if (isSet(t.start_s) || isSet(t.end_s)) return false;
  const [w, h] = displaySize(inp);
  return [
    ["width", w],
    ["height", h],
  ].every(([k, v]) => !isSet(video[k]) || video[k] === v);
}

/**
 * @param {object} spec output spec
 * @param {unknown} output output handle
 * @param {object} inputProbe probe of the first input
 * @param {unknown[] | undefined} inputs input handles in task order
 * @param {import("./result.js").Check[]} checks appended to
 * @param {Record<string, unknown>} measurements filled in
 * @param {object[]} vids the output's video streams
 * @param {{ quality(ref: unknown, cand: unknown, w: number, h: number, refStartS?: number): Promise<{ ssim: number, psnr_db: number } | null> }} measure
 */
export async function qualityChecks(
  spec,
  output,
  inputProbe,
  inputs,
  checks,
  measurements,
  vids,
  measure,
) {
  let floors = Object.fromEntries(
    Object.entries(spec.quality ?? {}).filter(([, v]) => isSet(v)),
  );
  if (!Object.keys(floors).length && qualityApplies(spec, inputProbe))
    floors = {
      min_ssim: SSIM_FLOOR_DEFAULT,
      min_psnr_db: PSNR_FLOOR_DB_DEFAULT,
    };
  if (!Object.keys(floors).length) return;
  const inp = firstVideo(inputProbe);
  let q = null;
  if (vids.length && inp && inputs?.length) {
    const [w, h] = displaySize(inp);
    // A trimmed output starts at the spec's start time: compare it with the input from there, frame for frame, not from
    // the input's first frame (which would pit different parts of the video against each other).
    const startS = isSet(spec.time?.start_s) ? spec.time.start_s : 0;
    q = await measure.quality(inputs[0], output, w, h, startS);
  }
  measurements.quality = q;
  for (const [key, field] of [
    ["min_ssim", "ssim"],
    ["min_psnr_db", "psnr_db"],
  ]) {
    if (!(key in floors)) continue;
    const actual = q ? q[field] : null;
    const ok = actual !== null && actual >= floors[key];
    add(checks, `quality.${key}`, floors[key], actual, ok);
  }
}
