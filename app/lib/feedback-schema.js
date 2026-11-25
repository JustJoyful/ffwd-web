// The shape of an opt-in feedback message, and the ONE validator used by the page (before it shows or sends anything) and
// by the Worker (workers/feedback/worker.js) before it stores anything. Pure: no imports, so the Worker bundle stays tiny.
// Nothing here knows about analytics; feedback is a separate door (docs/launch-items.txt, the privacy page).

export const KINDS = ["failed_job", "plan_wrong"];
export const FAILURES = [
  "no_plan",
  "plan_wrong",
  "run_failed",
  "checks_failed",
  "too_long",
  "model_error",
  "other",
];
export const MAX_REQUEST = 500;
export const MAX_BODY_BYTES = 4096;
const MAX_OUTPUTS = 8;

const FAMILIES = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
// Strings inside a plan are closed lists, never free text: a model-written value could carry a name.
const CONTAINERS = [
  "mp4",
  "mkv",
  "webm",
  "mov",
  "gif",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "opus",
  "flac",
  "png",
  "jpg",
];
const CODECS = [
  "h264",
  "hevc",
  "h265",
  "vp8",
  "vp9",
  "av1",
  "mpeg4",
  "prores",
  "libx264",
  "libx265",
  "libvpx",
  "libvpx-vp9",
  "libsvtav1",
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "pcm_s16le",
  "libopus",
  "libmp3lame",
  "copy",
];
const PIX_FMTS = [
  "yuv420p",
  "yuv422p",
  "yuv444p",
  "yuv420p10le",
  "rgb24",
  "gray",
];
const num = (v) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e13;
const bool = (v) => typeof v === "boolean";
const oneOf = (list) => (v) => list.includes(v);

// field -> accepted-value test (leaf) or a nested table. Anything not listed is dropped. Order = canonical key order.
const OUTPUT = {
  kind: oneOf(["video", "audio", "image_sequence", "gif"]),
  container: oneOf(CONTAINERS),
  per_input: bool,
  video: {
    codec: oneOf(CODECS),
    width: num,
    height: num,
    fps: num,
    pix_fmt: oneOf(PIX_FMTS),
    rotation: oneOf([0, 90, 180, 270]),
  },
  audio: {
    present: bool,
    codec: oneOf(CODECS),
    loudness_lufs: num,
    offset_ms: num,
  },
  time: { start_s: num, end_s: num, tolerance_s: num },
  size_max_bytes: num,
  quality: { min_ssim: num, min_psnr_db: num },
  frames: {
    interval_s: num,
    expected_count: num,
    format: oneOf(["png", "jpg"]),
  },
  lossless: bool,
};

function pick(src, table) {
  if (!src || typeof src !== "object" || Array.isArray(src)) return {};
  const out = {};
  for (const [k, rule] of Object.entries(table)) {
    const v = src[k];
    if (typeof rule === "function") {
      if (rule(v)) out[k] = v;
    } else {
      const sub = pick(v, rule);
      if (Object.keys(sub).length) out[k] = sub;
    }
  }
  return out;
}

/** A spec (or null) reduced to the allowlist above: unknown fields, ids, nulls and any other string are dropped. */
export function reducePlan(spec) {
  if (!spec || typeof spec !== "object") return null;
  const family = (Array.isArray(spec.family) ? spec.family : [])
    .filter((f) => FAMILIES.includes(f))
    .slice(0, 12);
  const outputs = (Array.isArray(spec.outputs) ? spec.outputs : [])
    .slice(0, MAX_OUTPUTS)
    .map((o) => pick(o, OUTPUT))
    .filter((o) => Object.keys(o).length);
  return family.length || outputs.length ? { family, outputs } : null;
}

export const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const MODEL_VERSION_RE = /^(unknown|ffwd-[0-9a-z.]+-\d+\.\d+\.\d+)$/;
const KEYS = [
  "kind",
  "request",
  "plan",
  "failure",
  "app_version",
  "model_version",
];

/**
 * @returns {{ ok: true, value: object } | { ok: false, error: string }} strict: exactly the six keys, closed enums, the
 *   plan must already equal its own reduction, the request is plain text of 1..MAX_REQUEST characters.
 */
export function validateFeedback(p) {
  const bad = (error) => ({ ok: false, error });
  if (!p || typeof p !== "object" || Array.isArray(p))
    return bad("not an object");
  const keys = Object.keys(p);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k)))
    return bad("wrong keys");
  if (!KINDS.includes(p.kind)) return bad("kind");
  if (!FAILURES.includes(p.failure)) return bad("failure");
  if (
    typeof p.request !== "string" ||
    !p.request.length ||
    p.request.length > MAX_REQUEST
  )
    return bad("request");
  if (typeof p.app_version !== "string" || !APP_VERSION_RE.test(p.app_version))
    return bad("app_version");
  if (
    typeof p.model_version !== "string" ||
    !MODEL_VERSION_RE.test(p.model_version)
  )
    return bad("model_version");
  if (
    p.plan !== null &&
    JSON.stringify(reducePlan(p.plan)) !== JSON.stringify(p.plan)
  )
    return bad("plan");
  return { ok: true, value: p };
}
