// The tool's store: the Plan B machine plus the browser runtime behind it, shaped for React's useSyncExternalStore.
// Creating a store has no side effects (the ffmpeg core loads on the first command), so React may create and drop
// one during a StrictMode double render without leaking anything. `start` and `stop` are the effect pair: they do
// the capability check and release the runtime.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createMachine } from "../agent/machine.js";
import { scriptedPolicy } from "../agent/scripted-policy.js";
import { createBrowserRuntime } from "../agent/browser-runtime.js";
import { parseAction } from "../agent/actions.js";
import { createModelClient } from "../model/client.js";
import { initialModelState } from "../model/contract.js";
import { checkCapability, readAdapter, readEnv } from "../lib/capability.js";

// The real check: what the page sees, plus the actual WebGPU adapter (a missing or software one means the processor path).
const realCapability = async () => {
  const env = readEnv();
  const adapter = env.gpu && !env.scripted ? await readAdapter() : undefined;
  return checkCapability({ ...env, adapter });
};

const scripted = () => import.meta.env.VITE_SCRIPTED_POLICY === "1";

/**
 * A model that is always ready, for scripted builds (headless Chromium has no WebGPU) and for tests that inject their
 * own policy: Playwright and unit tests need no model, and the UI shows no download step. Its actions do nothing.
 */
const READY = Object.freeze({
  ...initialModelState(),
  phase: "ready",
  path: "webgpu",
  cached: true,
  loadMs: 0,
});
export const stubModel = (policy = async () => "") => ({
  getState: () => READY,
  subscribe: () => () => {},
  begin: async () => {},
  consent: () => {},
  decline: () => {},
  retry: async () => {},
  policy,
  dispose: () => {},
});

/**
 * The policy for this build: a scripted build (VITE_SCRIPTED_POLICY=1) plays the replies a test put on
 * `globalThis.__ffwdScript`; a normal build asks the on-device model. The scripted branch is dead code in a normal build.
 * @param {ReturnType<typeof createModelClient>} model
 */
export function defaultPolicy(model) {
  return scripted()
    ? scriptedPolicy(globalThis.__ffwdScript ?? [])
    : model.policy;
}

/**
 * @param {{ policy?: import("../agent/scripted-policy.js").Policy, model?: ReturnType<typeof createModelClient>, runtime?: ReturnType<typeof createBrowserRuntime>, capability?: () => ReturnType<typeof checkCapability> | Promise<ReturnType<typeof checkCapability>> }} [opts] injected by tests
 */
export function createToolStore({
  policy,
  model,
  runtime = createBrowserRuntime(),
  capability = realCapability,
} = {}) {
  // An injected policy (tests) or a scripted build means no real model: the stub is ready and does nothing.
  model ??=
    policy || scripted()
      ? stubModel(policy)
      : createModelClient({
          // the runtime safety net: a reply that is not an action at all counts as unreadable (client.js)
          isValidReply: (reply) => !("error" in parseAction(reply)),
        });
  policy ??= defaultPolicy(model);
  let begun = false;
  const machine = createMachine({
    policy,
    executor: runtime.executor,
    measure: runtime.measure,
    probeFile: runtime.probeFile,
  });
  return {
    runtime,
    getState: machine.getState,
    subscribe: machine.subscribe,
    model,
    /**
     * The machine's dispatch, plus one side effect: the first file chosen (the machine's first move to "probing")
     * starts the model (consent, download or load). The machine queues its events, so this watches its state until the
     * event is done instead of looking right after the call.
     */
    dispatch(e) {
      if (begun || e.type !== "fileChosen") return machine.dispatch(e);
      const off = machine.subscribe((s) => {
        if (s.name !== "probing") return;
        begun = true;
        off();
        model.begin(s.path ?? undefined);
      });
      return machine.dispatch(e).finally(off);
    },
    /** The first event of every visit. Ignored by the machine once it has left checkingCapability. */
    start: () => {
      const go = (c) => machine.dispatch({ type: "capabilityChecked", ...c });
      const result = capability();
      // A synchronous provider (the tests, a plain env read) dispatches at once, as before.
      return result instanceof Promise ? result.then(go) : go(result);
    },
    /**
     * Kill the ffmpeg worker (the runtime loads a fresh core if it is used again) and free the model. The model is only
     * disposed once it has begun: StrictMode's trial unmount must not kill a client that was never started.
     */
    stop: () => {
      runtime.dispose();
      if (begun) model.dispose();
    },
  };
}

/**
 * @param {Parameters<typeof createToolStore>[0]} [opts]
 * @returns {{ state: import("../agent/machine.js").State, dispatch: (e: import("../agent/machine.js").Event) => Promise<void>, store: ReturnType<typeof createToolStore>, model: import("../model/contract.js").ModelState, modelActions: { consent: () => void, decline: () => void, retry: () => Promise<void> } }}
 */
export function useTool(opts) {
  const [store] = useState(() => createToolStore(opts));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
  const model = useSyncExternalStore(
    store.model.subscribe,
    store.model.getState,
    store.model.getState,
  );
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  // modelActions is part of the shape stream C (UI) and stream D (analytics) code against.
  const [modelActions] = useState(() => ({
    consent: () => store.model.consent(),
    decline: () => store.model.decline(),
    retry: () => store.model.retry(),
  }));
  return { state, dispatch: store.dispatch, store, model, modelActions };
}
