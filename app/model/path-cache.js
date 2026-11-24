// The per-device verdict on the model's path, kept in localStorage (main thread only: workers have none). Keyed by the
// GPU adapter and the model's hash, so a new model or another GPU asks again, and aged out after PATH_CHOICE.cacheTtlDays.
// Everything is best-effort: storage can be missing (private window, blocked site data), full, or hold nonsense, and in
// every such case the answer is "no verdict yet" and the page works. Adapter info never leaves this file's key: it is
// not sent anywhere (analytics only ever sees the coarse path and canary words).
import { PATH_CHOICE } from "./config.js";

const PREFIX = "ffwd:path:v1:";
const DAY_MS = 86_400_000;

/**
 * @typedef {import("./contract.js").Bench} Bench
 * @typedef {{ webgpu: "ok" | "broken" | null, path: "webgpu" | "cpu", canary: "pass" | "fail" | "skipped", why: null | "canary" | "replies", bench: { webgpu?: Bench, cpu?: Bench }, at: number }} PathVerdict
 */

/** Adapter facts joined into one string (vendor, architecture, description); "none" when the device has no usable adapter. */
export const adapterId = (a) =>
  a && !a.isFallbackAdapter
    ? [a.vendor, a.architecture, a.description].map((x) => x ?? "").join("|")
    : "none";

export const cacheKey = (adapter, modelSha256) =>
  `${PREFIX}${String(modelSha256).slice(0, 16)}:${adapterId(adapter)}`;

const isBench = (b) =>
  b &&
  typeof b === "object" &&
  Number.isFinite(b.ppTokS) &&
  Number.isFinite(b.genTokS) &&
  b.ppTokS > 0 &&
  b.genTokS > 0;

/** @returns {PathVerdict | null} the stored verdict, or null for missing, corrupt, wrong-shaped or expired */
export function readVerdict(key, { storage, now = Date.now } = {}) {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const ok =
      v &&
      ["webgpu", "cpu"].includes(v.path) &&
      [null, "ok", "broken"].includes(v.webgpu) &&
      ["pass", "fail", "skipped"].includes(v.canary) &&
      [null, "canary", "replies"].includes(v.why) &&
      v.bench &&
      Object.entries(v.bench).every(
        ([k, b]) => ["webgpu", "cpu"].includes(k) && isBench(b),
      ) &&
      Number.isFinite(v.at) &&
      // a webgpu verdict needs a passing canary behind it, and a cpu-for-a-reason verdict needs the reason
      (v.path !== "webgpu" || (v.webgpu === "ok" && v.canary === "pass")) &&
      (v.webgpu !== "broken" || (v.path === "cpu" && v.why !== null));
    if (!ok) return null;
    return now() - v.at > PATH_CHOICE.cacheTtlDays * DAY_MS ? null : v;
  } catch {
    return null;
  }
}

/** Best effort: a full or blocked store just means the check runs again next visit. @returns {boolean} whether it was stored */
export function writeVerdict(key, verdict, { storage, now = Date.now } = {}) {
  try {
    (storage ?? globalThis.localStorage).setItem(
      key,
      JSON.stringify({ ...verdict, at: now() }),
    );
    return true;
  } catch {
    return false;
  }
}
