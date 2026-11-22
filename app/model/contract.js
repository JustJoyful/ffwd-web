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
];

/**
 * @typedef {"webgpu" | "cpu"} ModelPath
 *
 * main -> worker
 * @typedef {{ type: "init", modelUrl: string, sha256: string, bytes: number, nCtx: number, path: ModelPath, kvCache: "q8_0" | "f16", threads?: number }} InitMsg
 * @typedef {{ type: "generate", id: number, prompt: string, maxTokens: number }} GenerateMsg
 * @typedef {{ type: "exit" }} ExitMsg
 *
 * worker -> main
 * @typedef {{ type: "progress", phase: "download" | "load", loaded: number, total: number }} ProgressMsg
 * @typedef {{ type: "ready", path: ModelPath, threads: number, nCtx: number, cached: boolean, loadMs: number, adapter?: { vendor?: string, architecture?: string, isFallbackAdapter?: boolean | null } }} ReadyMsg
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
 * @typedef {{ phase: "idle" | "needsConsent" | "downloading" | "loading" | "ready" | "failed", loaded: number, total: number, cached: boolean, path: ModelPath | null, loadMs: number | null, error: null | { code: string, message: string } }} ModelState
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
});

/** The sentence the person reads when a job ends because of the model, per code. */
export const MODEL_ERROR_TEXT = {
  context_full:
    "This job got too long for the on-device model, so it was not done.",
  load_failed:
    "The on-device model could not start. Reload the page to try again.",
  hash_mismatch:
    "The downloaded model file did not match what was expected, so it was not used. Reload the page to download it again.",
  out_of_memory:
    "This computer ran out of memory loading the model. Close other tabs and programs and reload, or try the desktop app when it is out.",
  generate_failed:
    "The on-device model stopped while working. Try the request again.",
  aborted: "The job was stopped.",
};

const isObj = (m) => m !== null && typeof m === "object";
const int = (n) => Number.isInteger(n) && n >= 0;
const PATHS = ["webgpu", "cpu"];

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
      if (!["download", "load"].includes(m.phase)) bad("phase");
      if (!int(m.loaded) || !int(m.total)) bad("loaded and total");
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
};
