// The main-thread model client (D-050, D-051): owns the ModelState the UI and analytics read, the consent step before
// the one-time download, the worker, and the Policy the state machine calls. The API and the state are exactly those
// documented in contract.js:
//   getState() subscribe(fn)->unsubscribe  begin(path)  consent()  decline()  retry()  policy(messages)  dispose()
//
// Flow: begin() -> already in this browser's cache? yes: load it, no question asked. No: phase "needsConsent" until the
// person agrees to download `config.bytes` once (consent) or declines (the phase stays "needsConsent", and policy()
// rejects with code "aborted"). No model URL at all (it is not published yet): phase "failed", load_failed, never a
// fake download.
import { renderChat } from "../agent/chat-template.js";
import { MODEL, modelUrl } from "./config.js";
import {
  WORKER_IN,
  WORKER_OUT,
  initialModelState,
  validateWorkerMessage,
} from "./contract.js";

const NOT_PUBLISHED =
  "The on-device model is not published yet, so ffwd cannot run jobs in this build.";

const modelError = (code, message) =>
  Object.assign(new Error(message), { code });

// Is the verified model file already in this browser's cache? Asked on the main thread, before any worker exists,
// through wllama's own cache manager (the same OPFS store the worker fills; the sha256 stored in the entry's metadata is
// the "verified" marker model-host.js writes). Loaded on demand, so the page costs nothing until a file is chosen.
async function defaultIsCached(url, config) {
  try {
    const { CacheManager } = await import("@wllama/wllama");
    const cm = new CacheManager();
    const name = await cm.getNameFromURL(url);
    if ((await cm.getSize(name)) !== config.bytes) return false;
    return (await cm.getMetadata(name))?.sha256 === config.sha256;
  } catch {
    return false; // when in doubt ask, never download silently
  }
}

const defaultWorkerFactory = () =>
  new Worker(new URL("./model.worker.js", import.meta.url), { type: "module" });

/**
 * @param {{ workerFactory?: () => { postMessage: (m: object) => void, terminate: () => void, onmessage: ((e: { data: any }) => void) | null, onerror: ((e: any) => void) | null }, config?: typeof MODEL, url?: string | null, getPath?: () => "webgpu" | "cpu", isCached?: (url: string, config: typeof MODEL) => Promise<boolean> }} [opts]
 */
export function createModelClient({
  workerFactory = defaultWorkerFactory,
  config = MODEL,
  url = modelUrl(),
  getPath,
  isCached = defaultIsCached,
} = {}) {
  let state = initialModelState();
  const listeners = new Set();
  let worker = null;
  let path = null;
  let begun = false;
  let consented = false; // the person agreed to the download (kept for retry)
  let declined = false;
  let disposed = false;
  let seq = 0;
  let pending = null; // { id, resolve, reject }: the one generate in flight
  let chain = Promise.resolve(); // policy calls run one at a time

  const emit = () => [...listeners].forEach((fn) => fn(state));
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };
  const stop = () => {
    if (!worker) return;
    const w = worker;
    worker = null;
    try {
      w.postMessage({ type: WORKER_IN.EXIT });
    } catch {
      /* already dead */
    }
    w.terminate();
  };
  const fail = (code, message) => {
    stop();
    set({ phase: "failed", error: { code, message } });
  };

  /** @param {boolean} warm the verified file is already cached: nothing to download, so show "loading" at once */
  function launch(warm) {
    set(
      warm
        ? { phase: "loading", loaded: 0, total: config.bytes, cached: true }
        : {
            phase: "downloading",
            loaded: 0,
            total: config.bytes,
            cached: false,
          },
    );
    worker = workerFactory();
    worker.onmessage = (e) => onMessage(e.data);
    worker.onerror = (e) => crash(e?.message || "the model worker crashed");
    worker.postMessage({
      type: WORKER_IN.INIT,
      modelUrl: url,
      sha256: config.sha256,
      bytes: config.bytes,
      nCtx: config.nCtx,
      path,
      kvCache: config.kvCache,
    });
  }

  /** The worker died or sent nonsense: end whatever was waiting on it. */
  function crash(message) {
    const wasReady = state.phase === "ready";
    if (pending) {
      const p = pending;
      pending = null;
      p.reject(modelError("generate_failed", message));
    }
    if (state.phase !== "failed") {
      fail(wasReady ? "generate_failed" : "load_failed", message);
    }
  }

  function onMessage(m) {
    try {
      validateWorkerMessage(m);
    } catch (e) {
      return crash(e.message);
    }
    switch (m.type) {
      case WORKER_OUT.PROGRESS:
        // The first "load" message means the file is in (downloaded, or it was cached) and the runtime is starting.
        return set({
          phase: m.phase === "download" ? "downloading" : "loading",
          loaded: m.loaded,
          total: m.total,
        });
      case WORKER_OUT.READY:
        return set({
          phase: "ready",
          path: m.path,
          cached: m.cached,
          loadMs: m.loadMs,
          loaded: config.bytes,
          total: config.bytes,
          error: null,
        });
      case WORKER_OUT.RESULT:
        if (pending?.id === m.id) {
          const p = pending;
          pending = null;
          p.resolve(m.text);
        }
        return;
      default: // error
        if (m.id !== undefined) {
          if (pending?.id !== m.id) return;
          const p = pending;
          pending = null;
          return p.reject(modelError(m.code, m.message));
        }
        return fail(m.code, m.message);
    }
  }

  /** Resolves when the model is ready; rejects with the load error, or "aborted" after a decline or dispose. */
  const untilReady = () =>
    new Promise((resolve, reject) => {
      const check = () => {
        const { phase, error } = state;
        let verdict = null;
        if (phase === "ready") verdict = resolve;
        else if (phase === "failed") {
          verdict = () => reject(modelError(error.code, error.message));
        } else if (disposed || (declined && phase === "needsConsent")) {
          verdict = () =>
            reject(modelError("aborted", "The model was not downloaded."));
        }
        if (!verdict) return;
        listeners.delete(check);
        verdict();
      };
      listeners.add(check);
      check();
    });

  async function start() {
    if (!url) {
      return set({
        phase: "failed",
        error: { code: "load_failed", message: NOT_PUBLISHED },
      });
    }
    const warm = await isCached(url, config);
    if (disposed) return;
    if (warm) launch(true);
    else if (consented) launch(false);
    else set({ phase: "needsConsent", total: config.bytes, cached: false });
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Called once, when the first file is chosen. `p` is the capability check's path; getPath is the fallback. */
    async begin(p) {
      if (begun || disposed) return;
      begun = true;
      path = p ?? getPath?.() ?? "cpu";
      await start();
    },
    consent() {
      if (disposed || state.phase !== "needsConsent") return;
      consented = true;
      declined = false;
      launch(false);
    },
    decline() {
      if (disposed || state.phase !== "needsConsent") return;
      declined = true;
      emit(); // the state is unchanged; waiting policy() calls re-check and reject with "aborted"
    },
    /** After a failure: try again (a person who already agreed to the download is not asked again). */
    async retry() {
      if (disposed || state.phase !== "failed") return;
      stop();
      set(initialModelState());
      await start();
    },
    /** @type {import("../agent/scripted-policy.js").Policy} */
    policy(messages) {
      const run = async () => {
        await untilReady();
        const id = ++seq;
        return new Promise((resolve, reject) => {
          pending = { id, resolve, reject };
          worker.postMessage({
            type: WORKER_IN.GENERATE,
            id,
            prompt: renderChat(messages),
            maxTokens: config.maxTokens,
          });
        });
      };
      const p = chain.then(run);
      chain = p.catch(() => {});
      return p;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pending) {
        const p = pending;
        pending = null;
        p.reject(modelError("aborted", "The model was shut down."));
      }
      stop();
      emit(); // policy() calls still waiting for the model re-check and reject
    },
  };
}
