// The main-thread model client (D-050, D-051): owns the ModelState the UI and analytics read, the consent step before
// the one-time download, the worker, and the Policy the state machine calls. The API and the state are exactly those
// documented in contract.js:
//   getState() subscribe(fn)->unsubscribe  begin(path)  consent()  decline()  retry()  policy(messages)  dispose()
//
// Flow: begin() -> already in this browser's cache? yes: load it, no question asked. No: phase "needsConsent" until the
// person agrees to download `config.bytes` once (consent) or declines (the phase stays "needsConsent", and policy()
// rejects with code "aborted"). No model URL at all (it is not published yet): phase "failed", load_failed, never a
// fake download.
//
// Choosing the path (2026-11-24): the verdict for this device and model lives in localStorage (path-cache.js). No verdict:
// the worker is started in "probe" mode (canary + speed test, see model-host.js) and the verdict it reports is stored.
// A verdict: the worker just loads that path. Safety net: while on the graphics path, `invalidRepliesToSwitch` replies in a
// row that are not an action at all (isValidReply, supplied by the store; the job machine knows nothing of this) mark the
// graphics path broken, swap the worker for a processor one and answer the SAME step from the processor, so the job goes on.
import { renderChat } from "../agent/chat-template.js";
import { defaultCpuThreads, readAdapter } from "../lib/capability.js";
import { MODEL, PATH_CHOICE, modelUrl } from "./config.js";
import {
  WORKER_IN,
  WORKER_OUT,
  initialModelState,
  validateWorkerMessage,
} from "./contract.js";
import { cacheKey, readVerdict, writeVerdict } from "./path-cache.js";
import { isVerified } from "./verified.js";

const NOT_PUBLISHED =
  "The on-device model is not published yet, so ffwd cannot run jobs in this build.";

const modelError = (code, message) =>
  Object.assign(new Error(message), { code });

// Is the verified model file already in this browser's cache? Asked on the main thread, before any worker exists,
// through wllama's own cache manager (the same OPFS store the worker fills; the app's own marker in the entry's metadata,
// verified.js, is written by model-host.js only after a full hash; wllama's own sha256 field is not trusted). Loaded on demand, so the page costs nothing until a file is chosen.
export async function cacheIsVerified(cm, url, config) {
  const name = await cm.getNameFromURL(url);
  if ((await cm.getSize(name)) !== config.bytes) return false;
  return isVerified(await cm.getMetadata(name), name, config);
}
async function defaultIsCached(url, config) {
  try {
    const { CacheManager } = await import("@wllama/wllama");
    return await cacheIsVerified(new CacheManager(), url, config);
  } catch {
    return false; // when in doubt ask, never download silently
  }
}

const defaultWorkerFactory = () =>
  new Worker(new URL("./model.worker.js", import.meta.url), { type: "module" });

/**
 * @param {{ workerFactory?: () => { postMessage: (m: object) => void, terminate: () => void, onmessage: ((e: { data: any }) => void) | null, onerror: ((e: any) => void) | null }, config?: typeof MODEL, url?: string | null, getPath?: () => "webgpu" | "cpu", isCached?: (url: string, config: typeof MODEL) => Promise<boolean>, getAdapter?: typeof readAdapter, storage?: Storage, threads?: number, isValidReply?: ((reply: string) => boolean) | null, now?: () => number }} [opts]
 *   getAdapter / storage / threads / now exist for the tests; isValidReply switches the runtime safety net on.
 */
export function createModelClient({
  workerFactory = defaultWorkerFactory,
  config = MODEL,
  url = modelUrl(),
  getPath,
  isCached = defaultIsCached,
  getAdapter = readAdapter,
  storage,
  threads = defaultCpuThreads(globalThis.navigator?.hardwareConcurrency),
  isValidReply = null,
  now = Date.now,
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
  let key = null; // the verdict's storage key (this adapter + this model)
  let plan = { path: "cpu", probe: false }; // what the worker is asked to do
  let invalidRun = 0; // unreadable replies in a row on the graphics path
  let switched = false; // the safety net moved this page to the processor
  const invalidReplies = new Set(); // their texts, taken out of the conversation after the switch
  const store = { storage, now };

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
      path: plan.path,
      kvCache: config.kvCache,
      threads,
      ...(plan.probe ? { probe: true } : {}),
    });
  }

  /**
   * Which path to ask for: a stored verdict for this adapter and model is used as it is; without one, a device with a real
   * adapter is probed (canary and speed test in the worker) and any other device only gets its processor speed measured.
   */
  async function decidePlan() {
    const usable = path === "webgpu";
    const adapter = usable ? await getAdapter().catch(() => null) : null;
    const real = Boolean(adapter) && adapter.isFallbackAdapter !== true;
    key = cacheKey(real ? adapter : null, config.sha256);
    const v = readVerdict(key, store);
    plan = v
      ? { path: v.path, probe: false }
      : { path: real ? "webgpu" : "cpu", probe: true };
    // Quietly: the state is announced with the next change (needsConsent, loading), not once per detail.
    state = {
      ...state,
      // with a stored verdict the path is known before the load: the notice must not show the capability guess next to
      // the verdict's speed (it showed "graphics chip" with the processor's numbers)
      path: v ? v.path : state.path,
      canary: v?.canary ?? null,
      fallback: v?.why ?? null,
      bench: v?.bench[v.path] ?? null,
    };
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
        // "check" is the first-visit canary and speed test: still "loading" as far as the phase goes.
        return m.phase === "check"
          ? set({ phase: "loading", check: m.step ?? "canary" })
          : set({
              phase: m.phase === "download" ? "downloading" : "loading",
              loaded: m.loaded,
              total: m.total,
              check: null,
            });
      case WORKER_OUT.READY: {
        const sel = m.selection;
        if (sel) {
          // A first-visit verdict: remember it (best effort), so the next visit loads this path and nothing else.
          writeVerdict(
            key,
            {
              webgpu: { pass: "ok", fail: "broken", skipped: null }[sel.canary],
              path: m.path,
              canary: sel.canary,
              why: sel.canary === "fail" ? "canary" : null,
              bench: sel.bench,
            },
            store,
          );
        }
        return set({
          phase: "ready",
          path: m.path,
          cached: m.cached,
          loadMs: m.loadMs,
          loaded: config.bytes,
          total: config.bytes,
          error: null,
          check: null,
          ...(sel
            ? {
                canary: sel.canary,
                bench: sel.bench[m.path] ?? null,
                fallback: sel.canary === "fail" ? "canary" : null,
              }
            : {}),
        });
      }
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
    const [warm] = await Promise.all([isCached(url, config), decidePlan()]);
    if (disposed) return;
    if (warm) launch(true);
    else if (consented) launch(false);
    else set({ phase: "needsConsent", total: config.bytes, cached: false });
  }

  /** The conversation minus replies the graphics path got wrong and the harness's feedback on each (the next message). */
  function withoutInvalid(messages) {
    const out = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "assistant" && invalidReplies.has(m.content)) {
        if (messages[i + 1]?.role === "user") i++;
        continue;
      }
      out.push(m);
    }
    return out;
  }

  /** Mark the graphics path broken for this device, swap the worker for a processor one, resolve when it is ready. */
  async function switchToCpu() {
    const old = readVerdict(key, store);
    const bench = old?.bench ?? {};
    writeVerdict(
      key,
      {
        webgpu: "broken",
        path: "cpu",
        canary: old?.canary ?? "pass",
        why: "replies",
        bench,
      },
      store,
    );
    switched = true;
    invalidRun = 0;
    stop();
    plan = { path: "cpu", probe: false };
    set({
      error: null,
      path: null,
      check: null,
      fallback: "replies",
      canary: old?.canary ?? "pass",
      bench: bench.cpu ?? null,
    });
    launch(true); // the file is cached by now: straight to "loading"
    await untilReady();
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
      const generate = (msgs) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          pending = { id, resolve, reject };
          worker.postMessage({
            type: WORKER_IN.GENERATE,
            id,
            prompt: renderChat(msgs),
            maxTokens: config.maxTokens,
          });
        });
      const run = async () => {
        await untilReady();
        const msgs = switched ? withoutInvalid(messages) : messages;
        const reply = await generate(msgs);
        // The safety net: only on the graphics path, only when a validity check was supplied.
        if (!isValidReply || state.path !== "webgpu") return reply;
        if (messages.length <= 2) invalidRun = 0; // a new job starts clean
        if (isValidReply(reply)) {
          invalidRun = 0;
          return reply;
        }
        invalidReplies.add(reply);
        if (++invalidRun < PATH_CHOICE.invalidRepliesToSwitch) return reply;
        await switchToCpu();
        // The same step again, on the processor, from the conversation without the garbage.
        return generate(withoutInvalid(messages));
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
