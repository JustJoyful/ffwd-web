// Can this browser and device run ffwd? Answered synchronously from what the page can see, before anything heavy
// loads (WEB_ARCHITECTURE §5.3). The real WebGPU adapter request and the model's memory use are checked later, when
// the model loads (Plan E); this only turns away the cases that can never work, with a reason the page can explain.
// WebGPU is NOT required (owner decision, 23 Nov 2026, D-050): without it the model runs on the processor, which works
// but is slower, so the person is told which path they are on and roughly how long a step takes (selectModelPath).

// shortcut: a proposal, not a measurement. Qwen3 0.6B q4f16 needs about 1.4 GB of GPU memory and ffmpeg.wasm up to
// 2 GB, so under 4 GB of device RAM is refused. navigator.deviceMemory is rounded and capped (never above 8) and is
// missing in Firefox and Safari, where an unknown value is let through. Revisit with real devices (Plan E).
export const MIN_DEVICE_MEMORY_GB = 4;
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

// Model speed per path, in seconds per model turn (medians). MEASURED on one laptop (Intel i5-12450HX, NVIDIA RTX 3050
// 6 GB), Chromium 159, wllama 4.0.0, GGUF Q5_K_M, 307 turns of 100 dev tasks: reports/2026-11-23-browser-gguf/REPORT.md
// (ffwd repo). The first turn of a job reads the whole system prompt, so it is slower than the turns after it. A slower
// computer takes longer: the wait message says so, and these numbers are a floor, not a promise (D-050).
export const MODEL_TURN_SECONDS = {
  webgpu: { first: 3.5, next: 1.6 },
  cpu: { first: 10.3, next: 5.9 },
};
// Model turns in a typical job (spec, run, finish): 307 turns over 100 dev tasks = 3.07.
export const TYPICAL_MODEL_TURNS = 3;

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

/** @typedef {"no-isolation" | "low-memory" | "mobile"} CapabilityReason  why ffwd cannot run at all */
/** @typedef {"webgpu" | "cpu"} ModelPath  where the model runs */
/** @typedef {"no-webgpu"} PathNotice  why the model is on the processor (not a refusal) */

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
 * Where the model runs. WebGPU only when the page has a REAL adapter: a missing one, or a software fallback
 * (SwiftShader and the like, which is slower than the processor), means the CPU path. `adapter` is what
 * `readAdapter()` returned, or undefined before it has been asked (the synchronous first guess).
 * @param {{ gpu?: unknown, adapter?: { isFallbackAdapter?: boolean | null, architecture?: string, vendor?: string, description?: string } | null }} env
 * @returns {{ path: ModelPath, notice: null | PathNotice }}
 */
export function selectModelPath({ gpu, adapter } = {}) {
  if (!gpu) return { path: "cpu", notice: "no-webgpu" };
  if (adapter === undefined) return { path: "webgpu", notice: null }; // not asked yet
  const who = `${adapter?.vendor ?? ""} ${adapter?.architecture ?? ""} ${adapter?.description ?? ""}`;
  if (
    adapter === null ||
    adapter.isFallbackAdapter === true ||
    SOFTWARE_ADAPTER.test(who)
  )
    return { path: "cpu", notice: "no-webgpu" };
  return { path: "webgpu", notice: null };
}
const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|software/i;

/** The real adapter, asked for once the model is about to load. Resolves to null when there is none. */
export async function readAdapter() {
  try {
    const a = await globalThis.navigator?.gpu?.requestAdapter();
    if (!a) return null;
    const i = a.info ?? {};
    return {
      isFallbackAdapter: i.isFallbackAdapter ?? a.isFallbackAdapter ?? null,
      architecture: i.architecture,
      vendor: i.vendor,
      description: i.description,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ crossOriginIsolated?: boolean, gpu?: unknown, adapter?: unknown, deviceMemory?: number, userAgent?: string, scripted?: boolean }} [env]
 * @returns {{ ok: boolean, reason: null | CapabilityReason, path: ModelPath, notice: null | PathNotice }}
 */
export function checkCapability(env = readEnv()) {
  const reason = !env.crossOriginIsolated
    ? "no-isolation" // no SharedArrayBuffer: multithreaded ffmpeg.wasm cannot start
    : MOBILE_UA.test(env.userAgent ?? "")
      ? "mobile"
      : env.deviceMemory !== undefined &&
          env.deviceMemory < MIN_DEVICE_MEMORY_GB
        ? "low-memory"
        : null;
  // A scripted build (tests) has no model, so no path is claimed for it.
  const route = env.scripted
    ? { path: "webgpu", notice: null }
    : selectModelPath({ gpu: env.gpu, adapter: env.adapter });
  return { ok: reason === null, reason, ...route };
}

/**
 * How long the model takes, from the speed measured on one laptop (config.js MODEL_TURN_SECONDS). Seconds, rounded
 * up, for the first step and for a whole typical job's model time. The ffmpeg work comes on top and depends on the video.
 * @param {ModelPath} path
 */
export function estimateWait(path) {
  const t = MODEL_TURN_SECONDS[path];
  return {
    firstStepSeconds: Math.ceil(t.first),
    laterStepSeconds: Math.ceil(t.next),
    jobModelSeconds: Math.ceil(t.first + (TYPICAL_MODEL_TURNS - 1) * t.next),
  };
}

/** What to tell the person, one plain sentence per reason (the CapabilityNotice component shows it; "no-webgpu" is shown as a notice, not a refusal). */
export const REASON_TEXT = {
  "no-isolation":
    "This page can't start the video engine here. Open it in a current version of Chrome, Edge or Firefox.",
  // Not a refusal: ffwd still runs, on the processor, and says so (selectModelPath).
  "no-webgpu":
    "This browser has no usable graphics acceleration, so ffwd runs the model on your processor. It works, but it is slower.",
  "low-memory":
    "This computer doesn't have enough memory for the on-device model. Try the desktop app instead.",
  mobile:
    "ffwd runs on desktop browsers for now. Open it on a computer, or use the desktop app.",
};
