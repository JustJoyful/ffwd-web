// Can this browser and device run ffwd? Answered synchronously from what the page can see, before anything heavy
// loads (WEB_ARCHITECTURE §5.3). The real WebGPU adapter request and the model's memory use are checked later, when
// the model loads (Plan E); this only turns away the cases that can never work, with a reason the page can explain.

// shortcut: a proposal, not a measurement. Qwen3 0.6B q4f16 needs about 1.4 GB of GPU memory and ffmpeg.wasm up to
// 2 GB, so under 4 GB of device RAM is refused. navigator.deviceMemory is rounded and capped (never above 8) and is
// missing in Firefox and Safari, where an unknown value is let through. Revisit with real devices (Plan E).
export const MIN_DEVICE_MEMORY_GB = 4;
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

// File intake. A file is a video when the browser says so (type video/*) or its extension is listed here (MKV and
// some MOV files arrive with no type).
export const ACCEPTED_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".mpg",
  ".mpeg",
  ".mts",
  ".m2ts",
  ".3gp",
  ".wmv",
  ".flv",
  ".ogv",
];
// shortcut: a proposal, not a measurement. The video is held in memory about three times (the file, its copy inside
// ffmpeg.wasm, and the output), so a warning starts at 128 MiB per GB of device memory (4 GB assumed when the browser
// does not say). It warns and never blocks: a file that really cannot be read ends as "can't be read". Needs real devices.
export const MAX_FILE_BYTES_PER_GB = 128 * 1024 * 1024;
/** Above this size the person is warned, not stopped. @param {number} [deviceMemoryGb] */
export const maxFileBytes = (deviceMemoryGb = 4) =>
  deviceMemoryGb * MAX_FILE_BYTES_PER_GB;

/** @typedef {"no-isolation" | "no-webgpu" | "low-memory" | "mobile"} CapabilityReason */

/** What the page sees. WebGPU is only required with the real model, so a scripted build (tests) skips it. */
export function readEnv() {
  const nav = globalThis.navigator;
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    gpu: nav?.gpu,
    deviceMemory: nav?.deviceMemory,
    userAgent: nav?.userAgent ?? "",
    scripted: import.meta.env.VITE_SCRIPTED_POLICY === "1",
  };
}

/**
 * @param {{ crossOriginIsolated?: boolean, gpu?: unknown, deviceMemory?: number, userAgent?: string, scripted?: boolean }} [env]
 * @returns {{ ok: boolean, reason: null | CapabilityReason }}
 */
export function checkCapability(env = readEnv()) {
  const reason = !env.crossOriginIsolated
    ? "no-isolation" // no SharedArrayBuffer: multithreaded ffmpeg.wasm cannot start
    : MOBILE_UA.test(env.userAgent ?? "")
      ? "mobile"
      : env.deviceMemory !== undefined &&
          env.deviceMemory < MIN_DEVICE_MEMORY_GB
        ? "low-memory"
        : !env.scripted && !env.gpu
          ? "no-webgpu"
          : null;
  return { ok: reason === null, reason };
}

/** What to tell the person, one plain sentence per reason (the CapabilityNotice component shows it). */
export const REASON_TEXT = {
  "no-isolation":
    "This page can't start the video engine here. Open it in a current version of Chrome, Edge or Firefox.",
  "no-webgpu":
    "This browser can't run the on-device model. Use a current desktop Chrome or Edge, or the desktop app.",
  "low-memory":
    "This computer doesn't have enough memory for the on-device model. Try the desktop app instead.",
  mobile:
    "ffwd runs on desktop browsers for now. Open it on a computer, or use the desktop app.",
};
