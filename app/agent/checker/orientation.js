// Net rotation of an output relative to its input, measured from picture content (training/env/orientation.py,
// checker v1.2). Convention (spec.schema.json `video.rotation`): CLOCKWISE degrees the DISPLAYED picture of the
// output is turned relative to the input's, however it was done (metadata or re-encoded pixels).
//
// Method: first frame of each file -> 32x32 grey thumbnail (the Measure makes it); turn the input's thumbnail by
// 0/90/180/270 degrees clockwise and pick the candidate closest (mean absolute difference) to the output's.
// Ambiguous or unreadable -> null (the field then fails: fail closed).
// shortcut (same as Python): first frame only, so a heavily trimmed output whose first frame differs from the
// input's can mis-measure; the F5 rotation tasks keep the whole clip.
import { ORIENTATION_MAX_RATIO, ORIENTATION_MIN_GAP } from "../config.js";

/** Thumbnail edge in pixels (Python: ORIENTATION_THUMB). The Measure is asked for this size. */
export const ORIENTATION_THUMB = 32;

/**
 * Turn a square matrix clockwise by 0/90/180/270 degrees.
 * @param {number[][]} m
 * @param {number} degrees
 * @returns {number[][]}
 */
export function rotateCw(m, degrees) {
  const n = m.length;
  const grid = (f) =>
    Array.from({ length: n }, (_, y) =>
      Array.from({ length: n }, (_, x) => f(y, x)),
    );
  if (degrees === 0) return m;
  if (degrees === 90) return grid((y, x) => m[n - 1 - x][y]);
  if (degrees === 180) return grid((y, x) => m[n - 1 - y][n - 1 - x]);
  if (degrees === 270) return grid((y, x) => m[x][n - 1 - y]);
  throw new Error(`rotation must be 0/90/180/270, got ${degrees}`);
}

function mad(a, b) {
  const n = a.length;
  let sum = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) sum += Math.abs(a[y][x] - b[y][x]);
  return sum / (n * n);
}

/**
 * @param {number[][]} inp thumbnail of the input
 * @param {number[][]} out thumbnail of the output
 * @returns {0 | 90 | 180 | 270 | null}
 */
export function netRotationFromThumbs(inp, out) {
  // Sorted by (distance, degrees), like Python sorting the tuples.
  const scores = [0, 90, 180, 270]
    .map((d) => [mad(rotateCw(inp, d), out), d])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const [[best, degrees], [second]] = scores;
  if (
    best > ORIENTATION_MAX_RATIO * second ||
    second - best < ORIENTATION_MIN_GAP
  )
    return null;
  return /** @type {0 | 90 | 180 | 270} */ (degrees);
}

/**
 * @param {{ thumbnail(h: unknown, size: number): Promise<number[][] | null> }} measure
 * @param {unknown} inputHandle
 * @param {unknown} outputHandle
 */
export async function netRotationCw(measure, inputHandle, outputHandle) {
  const a = await measure.thumbnail(inputHandle, ORIENTATION_THUMB);
  const b = await measure.thumbnail(outputHandle, ORIENTATION_THUMB);
  return a === null || b === null ? null : netRotationFromThumbs(a, b);
}
