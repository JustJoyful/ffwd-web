// What duration a spec's time range asks for (training/env/checker.py `_expected_duration`), shared by the duration and the
// frame-count checks.
const isSet = (x) => x !== null && x !== undefined;

/**
 * The duration the spec asks for, or null when it does not say. An end past the end of the input is the input's end: "keep
 * the first 30 seconds" of a 20 s clip is a 20 s result, not a failure (the Python twin does not clamp: it expects 30).
 * @param {{ start_s?: number | null, end_s?: number | null }} t
 * @param {{ duration_s?: number | null }} inputProbe
 */
export function expectedDuration(t, inputProbe) {
  const { start_s: start, end_s: end } = t;
  const dur = isSet(inputProbe.duration_s) ? inputProbe.duration_s : null;
  const cap = (x) => (dur !== null ? Math.min(x, dur) : x);
  if (isSet(start) && isSet(end)) return cap(end) - start;
  if (isSet(start) && dur !== null) return dur - start;
  return isSet(end) ? cap(end) : null;
}
