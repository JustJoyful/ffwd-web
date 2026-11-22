// The tool's store: the Plan B machine plus the browser runtime behind it, shaped for React's useSyncExternalStore.
// Creating a store has no side effects (the ffmpeg core loads on the first command), so React may create and drop
// one during a StrictMode double render without leaking anything. `start` and `stop` are the effect pair: they do
// the capability check and release the runtime.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createMachine } from "../agent/machine.js";
import { scriptedPolicy } from "../agent/scripted-policy.js";
import { createBrowserRuntime } from "../agent/browser-runtime.js";
import { checkCapability, readAdapter, readEnv } from "../lib/capability.js";

// The real check: what the page sees, plus the actual WebGPU adapter (a missing or software one means the processor path).
const realCapability = async () => {
  const env = readEnv();
  const adapter = env.gpu && !env.scripted ? await readAdapter() : undefined;
  return checkCapability({ ...env, adapter });
};

/** The model arrives with Plan E; until then a real build ends the job with a clear reason instead of hanging. */
const unavailablePolicy = async () => {
  throw new Error("the on-device model is not available in this build yet");
};

/**
 * The policy for this build. A scripted build (VITE_SCRIPTED_POLICY=1: headless Chromium has no WebGPU) plays the
 * replies a test put on `globalThis.__ffwdScript`; the branch is dead code in a normal build.
 */
export function defaultPolicy() {
  return import.meta.env.VITE_SCRIPTED_POLICY === "1"
    ? scriptedPolicy(globalThis.__ffwdScript ?? [])
    : unavailablePolicy;
}

/**
 * @param {{ policy?: import("../agent/scripted-policy.js").Policy, runtime?: ReturnType<typeof createBrowserRuntime>, capability?: () => ReturnType<typeof checkCapability> | Promise<ReturnType<typeof checkCapability>> }} [opts] injected by tests
 */
export function createToolStore({
  policy = defaultPolicy(),
  runtime = createBrowserRuntime(),
  capability = realCapability,
} = {}) {
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
    dispatch: machine.dispatch,
    /** The first event of every visit. Ignored by the machine once it has left checkingCapability. */
    start: () => {
      const go = (c) => machine.dispatch({ type: "capabilityChecked", ...c });
      const result = capability();
      // A synchronous provider (the tests, a plain env read) dispatches at once, as before.
      return result instanceof Promise ? result.then(go) : go(result);
    },
    /** Kill the ffmpeg worker; the runtime loads a fresh core if it is used again. */
    stop: () => runtime.dispose(),
  };
}

/**
 * @param {Parameters<typeof createToolStore>[0]} [opts]
 * @returns {{ state: import("../agent/machine.js").State, dispatch: (e: import("../agent/machine.js").Event) => Promise<void>, store: ReturnType<typeof createToolStore> }}
 */
export function useTool(opts) {
  const [store] = useState(() => createToolStore(opts));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return { state, dispatch: store.dispatch, store };
}
