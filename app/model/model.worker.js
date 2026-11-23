// Module-worker entry for the on-device model: the thin wiring around model-host.js (all logic and tests are there).
// Started by client.js as `new Worker(new URL("./model.worker.js", import.meta.url), { type: "module" })`.
import { Wllama } from "@wllama/wllama";
import { readAdapter } from "../lib/capability.js";
import { createModelHost } from "./model-host.js";

// The wasm file is referenced by URL so Vite emits it as an asset. wllama starts its own inner worker from it
// (multi-thread when the page is cross-origin isolated, which the site's COOP/COEP headers provide).
const WASM = new URL("@wllama/wllama/esm/wasm/wllama.wasm", import.meta.url)
  .href;

const host = createModelHost({
  post: (m) => self.postMessage(m),
  loadWllama: async () => new Wllama({ default: WASM }),
  readAdapter,
});

self.onmessage = (e) => host.handle(e.data);
