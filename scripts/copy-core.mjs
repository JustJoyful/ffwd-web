// Serve the ffmpeg core from our own origin (simplest way to satisfy COEP). The 31 MB wasm is git-ignored.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/ffmpeg", { recursive: true });
cpSync("node_modules/@ffmpeg/core-mt/dist/esm", "public/ffmpeg", {
  recursive: true,
});
