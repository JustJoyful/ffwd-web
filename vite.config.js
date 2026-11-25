import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { isolation } from "./isolation-headers.js";
import { buildCsp } from "./csp.js";

// `server.headers` does not reach the HTML document that React Router's dev middleware renders,
// so the dev server would not be cross-origin isolated. This middleware sets them on every response.
const isolateDevServer = {
  name: "isolate-dev-server",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
      // FFWD_CSP=1: run the dev server under the production policy (e2e and the real-model smoke use it).
      if (process.env.FFWD_CSP === "1")
        res.setHeader(
          "Content-Security-Policy",
          buildCsp({
            modelUrl: process.env.VITE_MODEL_MANIFEST_URL,
            analyticsHost: null,
            feedbackUrl: process.env.VITE_FEEDBACK_URL,
            dev: true,
          }),
        );
      next();
    });
  },
};

export default defineConfig({
  plugins: [isolateDevServer, reactRouter()],
  server: { headers: isolation },
  preview: { headers: isolation },
  // ffmpeg.wasm starts its own module worker from a relative URL, which the dependency optimiser would break.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  worker: { format: "es" },
});
