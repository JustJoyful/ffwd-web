// The per-device verdict on the model's path, kept in localStorage (main thread only: workers have none). Keyed by the
// GPU adapter, the browser's major.minor version and the model's hash, so a new model, another GPU or a browser update
// (new WebGPU driver path) asks again, and aged out after PATH_CHOICE.cacheTtlDays.
// Everything is best-effort: storage can be missing (private window, blocked site data), full, or hold nonsense, and in
// every such case the answer is "no verdict yet" and the page works. Adapter info never leaves this file's key: it is
// not sent anywhere (analytics only ever sees the coarse path and canary words).
import { PATH_CHOICE } from "./config.js";

const PREFIX = "ffwd:path:v1:";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * @typedef {import("./contract.js").Bench} Bench
 * @typedef {{ webgpu: "ok" | "broken" | null, path: "webgpu" | "cpu", canary: "pass" | "fail" | "skipped", why: null | "canary" | "replies", bench: { webgpu?: Bench, cpu?: Bench }, at: number }} PathVerdict
 */

/** Adapter facts joined into one string (vendor, architecture, description); "none" when the device has no usable adapter. */
export const adapterId = (a) =>
  a && !a.isFallbackAdapter
    ? [a.vendor, a.architecture, a.description].map((x) => x ?? "").join("|")
    : "none";

/**
 * The browser's version from the user agent, major.minor only (e.g. "159.0"), "unknown" when it cannot be read. Used in the
 * cache key only; it stays in this browser's localStorage and is never sent anywhere.
 */
export const browserVersion = (ua = globalThis.navigator?.userAgent ?? "") =>
  // Edge and Opera carry a Chrome/ token too; the last of the known tokens is the product, but any of them moves the version.
  ua
    .match(/(?:Edg|OPR|Chrome|Firefox|Version)\/(\d+)\.(\d+)/)
    ?.slice(1, 3)
    .join(".") ?? "unknown";

export const cacheKey = (adapter, modelSha256, browser = browserVersion()) =>
  `${PREFIX}${String(modelSha256).slice(0, 16)}:${browser}:${adapterId(adapter)}`;

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
    // A runtime-safety-net verdict (why "replies") lasts hours, a canary or speed verdict days. A date in the future
    // (a clock that jumped back, a hand-edited entry) would never expire, so it counts as expired too.
    const life =
      v.why === "replies"
        ? PATH_CHOICE.runtimeVerdictHours * HOUR_MS
        : PATH_CHOICE.cacheTtlDays * DAY_MS;
    const age = now() - v.at;
    if (age > life || age < -DAY_MS) {
      // Remove it, so the stored adapter description does not outlive its lifetime (the privacy page says how long).
      (storage ?? globalThis.localStorage)?.removeItem?.(key);
      return null;
    }
    return v;
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
