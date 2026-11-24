// Two guards on the spec the model writes (review S3). The person confirms a plan made of words; three numbers
// decide whether a check passes and are not in it (time.tolerance_s, quality.min_ssim, quality.min_psnr_db).
//   1. specBoundsError: those numbers must sit inside the bounds in config.js, or the spec is an invalid action.
//   2. looseningError: once the person has confirmed a spec, a later `spec` action may keep it or tighten it, never
//      loosen or change it. It is rejected as an invalid action (fed back to the model) instead of being shown for
//      a second confirmation, because the second plan card would look the same: the hidden numbers are what changed.
import {
  DEFAULT_TIME_TOLERANCE_S,
  PSNR_FLOOR_DB_DEFAULT,
  SPEC_SSIM_MAX,
  SPEC_TOLERANCE_S_MAX,
  SSIM_FLOOR_DEFAULT,
} from "./config.js";

const isNum = (x) => typeof x === "number";

/** Non-null leaves of one output as { "time.tolerance_s": 0.1, ... }. */
function leaves(o, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v))
      leaves(v, `${prefix}${k}.`, out);
    else out[prefix + k] = v;
  }
  return out;
}

const outputsById = (spec) =>
  new Map((spec?.outputs ?? []).map((o) => [o.id, leaves(o)]));

/**
 * @param {object} spec a schema-valid spec
 * @returns {string | null} what is out of bounds, in words the model can act on
 */
export function specBoundsError(spec) {
  for (const [id, l] of outputsById(spec)) {
    const tol = l["time.tolerance_s"];
    if (tol !== undefined && !(tol >= 0 && tol <= SPEC_TOLERANCE_S_MAX))
      return `output ${id}: time.tolerance_s must be between 0 and ${SPEC_TOLERANCE_S_MAX}`;
    const ssim = l["quality.min_ssim"];
    if (
      ssim !== undefined &&
      !(ssim >= SSIM_FLOOR_DEFAULT && ssim <= SPEC_SSIM_MAX)
    )
      return `output ${id}: quality.min_ssim must be between ${SSIM_FLOOR_DEFAULT} and ${SPEC_SSIM_MAX}`;
    const psnr = l["quality.min_psnr_db"];
    if (
      psnr !== undefined &&
      !(Number.isFinite(psnr) && psnr >= PSNR_FLOOR_DB_DEFAULT)
    )
      return `output ${id}: quality.min_psnr_db must be at least ${PSNR_FLOOR_DB_DEFAULT}`;
  }
  return null;
}

/**
 * @param {object} confirmed the spec the person confirmed
 * @param {object} proposed a later spec from the model
 * @returns {string | null} the first constraint the proposal loosens or changes, or null when it only keeps or tightens
 */
export function looseningError(confirmed, proposed) {
  const next = outputsById(proposed);
  for (const [id, c] of outputsById(confirmed)) {
    const p = next.get(id);
    if (!p) return `output ${id} was dropped`;
    // The checker applies the default tolerance when none is set, so compare what would be applied.
    const tolC = c["time.tolerance_s"] ?? DEFAULT_TIME_TOLERANCE_S;
    const tolP = p["time.tolerance_s"] ?? DEFAULT_TIME_TOLERANCE_S;
    if (!(tolP <= tolC)) return `output ${id}: time.tolerance_s is looser`;
    for (const [field, cv] of Object.entries(c)) {
      if (field === "time.tolerance_s") continue;
      const pv = p[field];
      const floor =
        field === "quality.min_ssim" || field === "quality.min_psnr_db";
      const kept = floor && isNum(cv) ? isNum(pv) && pv >= cv : pv === cv;
      if (!kept)
        return `output ${id}: ${field} was ${pv === undefined ? "dropped" : "changed"}`;
    }
  }
  return null;
}
