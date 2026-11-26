// The small, always-loaded half of opt-in feedback: is it on, and which entry points are hidden. No imports but React, so
// the lazy panel (components/tool/FeedbackPrompt.jsx) and the schema stay out of the first-load bundle.
import { useSyncExternalStore } from "react";

/** The build-time endpoint, or null (unset or not https = feature off). Read per call so tests can stub the env.
 * A scripted build (the e2e server) may take it from `globalThis.__ffwdFeedbackUrl`, like analytics (app/config.js). */
export function feedbackUrl() {
  const env = import.meta.env;
  const u =
    env?.VITE_SCRIPTED_POLICY === "1" && globalThis.__ffwdFeedbackUrl
      ? globalThis.__ffwdFeedbackUrl
      : env?.VITE_FEEDBACK_URL;
  return typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) ? u : null;
}

const KEY = "ffwd-feedback-hidden";
let hiddenInMemory = false; // no storage (private mode, blocked): hidden for the life of the page instead
const sentJobs = new Set();
const listeners = new Set();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((f) => f());
};

/** "No thanks" was pressed: every entry point stays hidden for the rest of this browser session. */
export function hideFeedbackForSession() {
  hiddenInMemory = true;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // storage unavailable: the in-memory flag above is enough for this page's life
  }
  changed();
}

/** A message for this job was sent: its entry points go away; the next job (new request or run count) shows them again. */
export function markFeedbackSent(jobKey) {
  sentJobs.add(jobKey);
  changed();
}

function hidden(jobKey) {
  if (hiddenInMemory || sentJobs.has(jobKey)) return true;
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Tests only: forget every hide flag. */
export function resetFeedbackState() {
  hiddenInMemory = false;
  sentJobs.clear();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
  changed();
}

/** True when feedback is configured and not hidden for this session or job: the only gate for showing an entry point. */
export function useFeedbackAvailable(jobKey) {
  useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => version,
    () => 0,
  );
  return feedbackUrl() !== null && !hidden(jobKey);
}
