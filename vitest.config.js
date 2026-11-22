import { defineConfig } from "vitest/config";

// Separate from vite.config.js so the React Router plugin does not run under Vitest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{js,jsx}"],
          environment: "jsdom",
        },
      },
      {
        // Opt-in: needs a GGUF (FFWD_GGUF) and real Chromium; see tests/browser-gguf/tokenizer.test.js.
        test: {
          name: "browser-gguf",
          include: ["tests/browser-gguf/**/*.test.js"],
          environment: "node",
        },
      },
      {
        test: {
          name: "build",
          include: ["tests/build/**/*.test.js"],
          environment: "node",
        },
      },
    ],
  },
});
