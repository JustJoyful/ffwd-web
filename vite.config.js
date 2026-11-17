import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { isolation } from "./isolation-headers.js";

export default defineConfig({
  plugins: [reactRouter()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: "es" },
});
