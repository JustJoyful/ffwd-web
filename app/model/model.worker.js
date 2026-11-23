// Module-worker entry for the on-device model: the thin wiring around model-host.js (all logic and tests are there).
// Started by client.js as `new Worker(new URL("./model.worker.js", import.meta.url), { type: "module" })`.
import { Wllama } from "@wllama/wllama";
// `?url` makes Vite emit the wasm as an asset and give its URL (wllama's package exports allow this subpath). A bare
// specifier inside `new URL(..., import.meta.url)` is NOT resolved by Vite: it would point at a path that does not exist.
import wasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { readAdapter } from "../lib/capability.js";
import { createModelHost } from "./model-host.js";

// wllama starts its own inner worker from the wasm (multi-thread when the page is cross-origin isolated, which the
// site's COOP/COEP headers provide).
const WASM = new URL(wasmUrl, self.location.href).href;

const host = createModelHost({
  post: (m) => self.postMessage(m),
  loadWllama: async () => new Wllama({ default: WASM }),
  readAdapter,
});

self.onmessage = (e) => host.handle(e.data);
