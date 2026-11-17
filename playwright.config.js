import { defineConfig } from "@playwright/test";

// Headless Chromium without a GPU, one worker: ffmpeg.wasm is heavy and the machine is shared (RAM is limited).
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 240_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174", // flow.spec.js uses 4175, the real app
    launchOptions: { args: ["--disable-gpu"] },
  },
  // Two servers. 4174: a bare page that exposes the engine, for the runtime and conformance specs and for building
  // fixtures with FFmpeg lavfi. 4175: the REAL /app route, served by the React Router dev server with
  // VITE_SCRIPTED_POLICY=1 (the model is replaced by the replies a spec puts on globalThis.__ffwdScript). The dev
  // server is used because the production build only prerenders "/", so a static server would answer /app with the
  // home page; the dev server routes every page.
  webServer: [
    {
      command:
        "node scripts/copy-core.mjs && pnpm exec vite --config tests/e2e/vite.config.js --port 4174 --strictPort",
      url: "http://localhost:4174",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec react-router dev --port 4175 --strictPort",
      env: { VITE_SCRIPTED_POLICY: "1" },
      url: "http://localhost:4175/app",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
