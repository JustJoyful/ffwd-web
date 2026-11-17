// A plain Vite server for the runtime and conformance specs: they only need a page that imports app/agent modules and
// loads the ffmpeg core, not the React Router site. Same isolation headers as the site (D-047).
import { defineConfig } from "vite";
import { isolation } from "../../isolation-headers.js";

export default defineConfig({
  root: "tests/e2e/harness",
  publicDir: "../../../public",
  server: { headers: isolation, fs: { allow: ["../../.."] } },
  // ffmpeg.wasm starts its own module worker from a relative URL, which the dependency optimiser would break.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  worker: { format: "es" },
});
