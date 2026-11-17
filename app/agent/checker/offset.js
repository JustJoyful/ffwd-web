// A/V offset measurement (training/env/checker.py). Container start_time is NOT the true stream offset: MP4 hides
// negative pre-roll behind an edit list. First-packet timestamps keep the real value, so offset = audio first pts
// minus video first pts, in ms.
import { pyRound } from "../numbers.js";

/**
 * Audio start minus video start of one file, in ms rounded to 0.1 (null when either stream has no packet).
 * @param {{ firstPacketPts(h: unknown, type: "video" | "audio"): Promise<number | null> }} measure
 * @param {unknown} handle
 */
export async function measureOffset(measure, handle) {
  const v0 = await measure.firstPacketPts(handle, "video");
  const a0 = await measure.firstPacketPts(handle, "audio");
  return v0 !== null && a0 !== null ? pyRound((a0 - v0) * 10_000) / 10 : null;
}

/**
 * |audio start - video start| of the first input in ms, 0 when unmeasurable or there are no input handles.
 * (Python: `_input_offset_ms`.)
 * @param {{ firstPacketPts(h: unknown, type: "video" | "audio"): Promise<number | null> }} measure
 * @param {unknown[] | undefined} inputs input handles in task order
 */
export async function inputOffsetMs(measure, inputs) {
  if (!inputs?.length) return 0;
  const v0 = await measure.firstPacketPts(inputs[0], "video");
  const a0 = await measure.firstPacketPts(inputs[0], "audio");
  return v0 !== null && a0 !== null ? Math.abs((a0 - v0) * 1000) : 0;
}
