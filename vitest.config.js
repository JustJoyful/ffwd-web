import { defineConfig } from "vitest/config";

// Separate from vite.config.js so the React Router plugin does not run under Vitest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.js"],
          environment: "jsdom",
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
