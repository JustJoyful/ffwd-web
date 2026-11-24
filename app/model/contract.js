// THE CONTRACT between the model worker, the model client, the tool UI and analytics (D-050, D-051). Written first and
// frozen: a stream that needs a change asks for it, it is not edited in place. The tests in
// tests/unit/model-contract.test.js pin every shape here.
//
//   main thread                                   model worker (app/model/model.worker.js)
//   -----------                                   ---------------------------------------
//   client.js  --(init)-------------------------> loads wllama + the GGUF (OPFS cache, sha256 check)
//              <-(progress)--------------------   download / load progress
//              <-(ready)-----------------------   the model is loaded
//   policy()   --(generate: a PLAIN-TEXT prompt)-> greedy completion, no chat template inside the worker
//              <-(result | error)--------------   the reply text (or a typed error)
//              --(exit)------------------------->  frees the model
//
// 2026-11-24 (owner-approved extension, stream B2): the worker can also CHOOSE the path. On a first visit it loads the
// graphics engine, runs a canary prompt against a native reference (canary.js), benchmarks, and keeps the faster correct
// path, loading the two engines one after the other (never together). The main thread keeps the verdict in localStorage
// (path-cache.js; workers have none) and sends it back as a fixed path on later visits. New: InitMsg.probe, ProgressMsg
// phase "check", ReadyMsg.selection, ModelState.check / canary / bench / fallback.
//
// The prompt is rendered on the main thread by app/agent/chat-template.js (renderChat) and handed over as a string:
// the runtime's own chat template is never used (D-050). The worker enforces the context rule: if the prompt plus the
// reply budget does not fit in nCtx it answers with error code "context_full" and never truncates the history.

export const WORKER_IN = {
  INIT: "init",
  GENERATE: "generate",
  EXIT: "exit",
};
export const WORKER_OUT = {
  PROGRESS: "progress",
  READY: "ready",
  RESULT: "result",
  ERROR: "error",
};

/** Typed failures. The machine ends the job with a plain message for each (see MODEL_ERROR_TEXT). */
export const ERROR_CODES = [
  "load_failed",
  "hash_mismatch",
  "out_of_memory",
  "context_full",
  "generate_failed",
  "aborted",
  // 2026-11-24 (D-053): the release manifest was refused (wrong protocol, app too old, files or prompt that do not match,
  // not the pinned file). Nothing was downloaded. Added on the owner's fail-closed rule; pinned in model-contract.test.js.
  "model_refused",
];

/**
 * @typedef {"webgpu" | "cpu"} ModelPath
 *
 * main -> worker
 * `probe: true` (graphics-capable device, no verdict cached yet): `path` is "webgpu" and the worker decides (see top). With
 * `probe: true` and path "cpu" (no usable adapter) it only benchmarks the processor. Without `probe` the path is loaded as asked.
 * `threads` applies to the processor engine only.
 * @typedef {{ type: "init", modelUrl: string, sha256: string, bytes: number, nCtx: number, path: ModelPath, kvCache: "q8_0" | "f16", threads?: number, probe?: boolean, canary?: { prompt: string, tokens: number[], minMatch: number } }} InitMsg
 *   `canary` (from the release manifest, 2026-11-24) is required with `probe: true`: the worker holds no reference of its own
 * @typedef {{ type: "generate", id: number, prompt: string, maxTokens: number }} GenerateMsg
 * @typedef {{ type: "exit" }} ExitMsg
 *
 * worker -> main
 * `phase: "check"` is the first-visit canary and benchmark (`step` says which; loaded and total are 0).
 * @typedef {{ type: "progress", phase: "download" | "load" | "check", loaded: number, total: number, step?: "canary" | "benchmark" }} ProgressMsg
 * @typedef {{ ppTokS: number, genTokS: number }} Bench  prompt-processing and generation speed, tokens per second
 * @typedef {{ canary: "pass" | "fail" | "skipped", matched: number, of: number, bench: { webgpu?: Bench, cpu?: Bench } }} Selection
 *   canary: "skipped" = there was no usable adapter, so nothing was tried; matched/of = first ids equal to the native reference
 * @typedef {{ type: "ready", path: ModelPath, threads: number, nCtx: number, cached: boolean, loadMs: number, adapter?: { vendor?: string, architecture?: string, isFallbackAdapter?: boolean | null }, selection?: Selection }} ReadyMsg `path` is the path that is loaded now
 * @typedef {{ type: "result", id: number, text: string, finishReason: "stop" | "length" | null, timings: { cacheN: number, promptN: number, promptMs: number, predictedN: number, predictedMs: number }, wallMs: number }} ResultMsg
 * @typedef {{ type: "error", id?: number, code: typeof ERROR_CODES[number], message: string }} ErrorMsg
 */

/**
 * What the UI renders and analytics reads. The client owns it; nobody else writes it.
 *   idle         nothing started (before a file is chosen)
 *   needsConsent the model is not in this browser yet: ask before downloading `total` bytes
 *   downloading  fetching the GGUF, `loaded` of `total` bytes (cached = false)
 *   loading      reading the cached file into memory and starting the runtime
 *   ready        a job can run; `path` says where
 *   failed       `error` says why; `retry()` is offered unless the code is "out_of_memory"
 * Added 2026-11-24 (the phase list is unchanged: the check is part of "loading"):
 *   check        null, or "canary" / "benchmark" while the first-visit check runs inside "loading" (it can take a minute)
 *   canary       the verdict on the graphics path for this device: "pass", "fail" or "skipped" (no usable adapter); null until known
 *   bench        measured speed of the path that is loaded (ppTokS, genTokS), for the wait estimate; null until measured
 *   fallback     why the processor runs although the device has a graphics chip: "canary" (its output was wrong), "replies"
 *                (two unreadable replies in a row while running on it) or null
 * @typedef {{ phase: "idle" | "needsConsent" | "downloading" | "loading" | "ready" | "failed", loaded: number, total: number, cached: boolean, path: ModelPath | null, loadMs: number | null, error: null | { code: string, message: string }, check: null | "canary" | "benchmark", canary: null | "pass" | "fail" | "skipped", bench: null | Bench, fallback: null | "canary" | "replies" }} ModelState
 *
 * The client API (app/model/client.js, createModelClient): getState(), subscribe(fn) -> unsubscribe, begin(),
 * consent(), decline(), retry(), policy(messages) -> Promise<string> (a Policy: awaits "ready", renders, generates),
 * dispose(). `policy` rejects with an Error whose `.code` is one of ERROR_CODES.
 */

/** @returns {ModelState} */
export const initialModelState = () => ({
  phase: "idle",
  loaded: 0,
  total: 0,
  cached: false,
  path: null,
  loadMs: null,
  error: null,
  check: null,
  canary: null,
  bench: null,
  fallback: null,
});

/** The sentence the person reads when a job ends because of the model, per code. */
export const MODEL_ERROR_TEXT = {
  context_full:
    "This job got too long for the on-device model, so it was not done.",
  load_failed:
    "The on-device model could not start. Press Try again. If that does not help, reload the page.",
  hash_mismatch:
    "The downloaded model file did not match what was expected, so it was not used. Press Try again to download it again. If that does not help, reload the page.",
  out_of_memory:
    "This computer ran out of memory loading the model. Close other tabs and programs and reload, or try the desktop app when it is out.",
  generate_failed:
    "The on-device model stopped while working. Try the request again.",
  aborted: "The job was stopped.",
  model_refused:
    "This version of ffwd cannot use the current model, so nothing was downloaded. Reload the page; if that does not help, the site needs an update.",
};

const isObj = (m) => m !== null && typeof m === "object";
const int = (n) => Number.isInteger(n) && n >= 0;
const PATHS = ["webgpu", "cpu"];
const num = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const isBench = (b) => isObj(b) && num(b.ppTokS) && num(b.genTokS);

/** Throws a clear error for a malformed message in either direction; returns the message when it is valid. */
export function validateWorkerMessage(m) {
  if (!isObj(m) || typeof m.type !== "string") {
    throw new Error("worker message: not an object with a type");
  }
  const bad = (why) => {
    throw new Error(`worker message "${m.type}": ${why}`);
  };
  switch (m.type) {
    case WORKER_IN.INIT:
      if (typeof m.modelUrl !== "string" || !m.modelUrl) bad("modelUrl");
      if (!/^[0-9a-f]{64}$/.test(m.sha256 ?? "")) {
        bad("sha256 must be 64 hex characters");
      }
      if (!int(m.bytes) || m.bytes === 0) bad("bytes");
      if (!int(m.nCtx) || m.nCtx === 0) bad("nCtx");
      if (!PATHS.includes(m.path)) bad("path");
      if (!["q8_0", "f16"].includes(m.kvCache)) bad("kvCache");
      if (m.threads !== undefined && (!int(m.threads) || m.threads === 0)) {
        bad("threads");
      }
      if (m.probe !== undefined && typeof m.probe !== "boolean") bad("probe");
      if (m.probe === true || m.canary !== undefined) {
        const k = m.canary;
        if (
          !isObj(k) ||
          typeof k.prompt !== "string" ||
          !k.prompt ||
          !Array.isArray(k.tokens) ||
          k.tokens.length === 0 ||
          !k.tokens.every(int) ||
          !int(k.minMatch) ||
          k.minMatch === 0 ||
          k.minMatch > k.tokens.length
        )
          bad("canary (prompt, tokens, minMatch) is required when probing");
      }
      return m;
    case WORKER_IN.GENERATE:
      if (!int(m.id)) bad("id");
      if (typeof m.prompt !== "string" || !m.prompt) {
        bad("prompt must be the rendered text");
      }
      if (!int(m.maxTokens) || m.maxTokens === 0) bad("maxTokens");
      return m;
    case WORKER_IN.EXIT:
      return m;
    case WORKER_OUT.PROGRESS:
      if (!["download", "load", "check"].includes(m.phase)) bad("phase");
      if (!int(m.loaded) || !int(m.total)) bad("loaded and total");
      if (
        m.step !== undefined &&
        (m.phase !== "check" || !["canary", "benchmark"].includes(m.step))
      ) {
        bad("step");
      }
      return m;
    case WORKER_OUT.READY:
      if (!PATHS.includes(m.path)) bad("path");
      if (
        !int(m.threads) ||
        !int(m.nCtx) ||
        typeof m.cached !== "boolean" ||
        typeof m.loadMs !== "number"
      ) {
        bad("threads, nCtx, cached, loadMs");
      }
      if (m.selection !== undefined) {
        const x = m.selection;
        if (
          !isObj(x) ||
          !["pass", "fail", "skipped"].includes(x.canary) ||
          !int(x.matched) ||
          !int(x.of) ||
          !isObj(x.bench) ||
          Object.entries(x.bench).some(
            ([k, b]) => !PATHS.includes(k) || !isBench(b),
          )
        ) {
          bad("selection");
        }
      }
      return m;
    case WORKER_OUT.RESULT:
      if (
        !int(m.id) ||
        typeof m.text !== "string" ||
        typeof m.wallMs !== "number"
      ) {
        bad("id, text, wallMs");
      }
      if (!["stop", "length", null].includes(m.finishReason)) {
        bad("finishReason");
      }
      if (
        !isObj(m.timings) ||
        !["cacheN", "promptN", "promptMs", "predictedN", "predictedMs"].every(
          (k) => typeof m.timings[k] === "number",
        )
      ) {
        bad("timings");
      }
      return m;
    case WORKER_OUT.ERROR:
      if (!ERROR_CODES.includes(m.code)) bad("code");
      if (typeof m.message !== "string") bad("message");
      if (m.id !== undefined && !int(m.id)) bad("id");
      return m;
    default:
      return bad("unknown type");
  }
}

/**
 * How the state machine ends a job when the policy (the model client) throws an Error with a `.code`:
 * the job goes to state "failed" with `reason` = MACHINE_REASON[code] and `error` = MODEL_ERROR_TEXT[code]. Never shown as a
 * success, never retried silently. An error with no known code ends as reason "policy_error" as before.
 */
export const MACHINE_REASON = {
  context_full: "too_long",
  load_failed: "model_unavailable",
  hash_mismatch: "model_unavailable",
  out_of_memory: "model_unavailable",
  generate_failed: "model_unavailable",
  aborted: "aborted",
  model_refused: "model_unavailable",
};
