// Opt-in feedback (separate from analytics; never imports it). Built only after a person clicks "Send" in
// components/tool/FeedbackPrompt.jsx. With no VITE_FEEDBACK_URL the feature is off: nothing renders, nothing is sent.
import { APP_VERSION } from "../model/config.js";
import { feedbackUrl } from "./feedback-state.js";
import {
  FAILURES,
  MAX_NOTE,
  MAX_REQUEST,
  MODEL_VERSION_RE,
  reducePlan,
  validateFeedback,
} from "./feedback-schema.js";

export { feedbackUrl, validateFeedback };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MEDIA_EXT =
  "mp4|mov|mkv|webm|avi|m4v|mp3|m4a|wav|aac|flac|ogg|opus|gif|png|jpe?g";

/**
 * The typed text with anything that names a file or a place removed. Conservative: it may remove more than needed
 * (any word with a slash becomes {path}); the person sees the result before sending.
 * shortcut: a stem under 3 letters is only replaced as a whole word (inside words it would wreck the text); a different
 * word the user typed that is not the file's name is left as typed, and shown in the preview.
 */
export function scrubRequest(text, fileName = "", max = MAX_REQUEST) {
  let t = String(text ?? "")
    .trim()
    .slice(0, 2000); // cap before regexes run
  const name = String(fileName ?? "").trim();
  const stem = name.replace(/\.[^.\\/]*$/, "");
  const re = (s) =>
    new RegExp(
      s.length >= 3 ? esc(s) : `(?<![\\p{L}\\p{N}])${esc(s)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
  t = t.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S+/gi, "{path}");
  if (name) t = t.replace(re(name), "{file}");
  if (stem) t = t.replace(re(stem), "{file}");
  t = t.replace(/\S*[\\/]\S*|(?<=^|\s)~\S*|(?<=^|\s)[a-z]:\S*/gi, "{path}");
  t = t.replace(new RegExp(`\\S+\\.(?:${MEDIA_EXT})\\b`, "gi"), "{file}");
  return t.trim().slice(0, max);
}

/** The optional note: one line, control characters removed, then scrubbed like the request. "" when nothing is left. */
export const scrubNote = (text, fileName = "") =>
  scrubRequest(
    String(text ?? "").replace(/\p{Cc}+/gu, " "),
    fileName,
    MAX_NOTE,
  );

/**
 * @param {{ requestText: string, spec?: object | null, failureCategory?: string, kind: "failed_job" | "plan_wrong" | "result_wrong",
 *   note?: string, fileName?: string, modelVersion?: string }} p
 * @returns the payload: exactly the keys kind, request, note (only when not empty), plan, failure, app_version,
 *   model_version (see validateFeedback)
 */
export function buildFeedback({
  requestText,
  spec,
  failureCategory,
  kind,
  note,
  fileName,
  modelVersion,
}) {
  const n = scrubNote(note, fileName);
  return {
    kind,
    request: scrubRequest(requestText, fileName),
    ...(n && { note: n }),
    plan: reducePlan(spec),
    failure: FAILURES.includes(failureCategory) ? failureCategory : "other",
    app_version: APP_VERSION,
    model_version: MODEL_VERSION_RE.test(modelVersion ?? "")
      ? modelVersion
      : "unknown",
  };
}

/**
 * POSTs the payload. Call it only from the Send button's handler.
 * @param {object} payload from buildFeedback
 * @param {string} [url] tests only (the e2e harness); the app always uses VITE_FEEDBACK_URL. Still https only.
 * @returns {Promise<{ ok: boolean, off?: boolean }>}
 */
export async function sendFeedback(payload, url = feedbackUrl()) {
  if (!url || !/^https:\/\//.test(url)) return { ok: false, off: true };
  if (!validateFeedback(payload).ok) return { ok: false };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}
