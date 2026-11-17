import { defineConfig } from "@playwright/test";

// Headless Chromium without a GPU, one worker: ffmpeg.wasm is heavy and the machine is shared (RAM is limited).
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 240_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    launchOptions: { args: ["--disable-gpu"] },
  },
  webServer: {
    command:
      "node scripts/copy-core.mjs && pnpm exec vite --config tests/e2e/vite.config.js --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
