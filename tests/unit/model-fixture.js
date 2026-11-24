// The model config the unit tests share: the REAL ffwd-0.6b v1.0.0 manifest (the one valid case of the synced conformance
// file) run through the app's own manifest code, with the file URL pointed at a test host. Nothing is typed in twice.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toModelConfig } from "../../app/model/manifest.js";

export const MODEL_CASES = readFileSync(
  join(process.cwd(), "protocol/conformance/model-manifest.jsonl"),
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
export const REAL_MANIFEST = MODEL_CASES.findLast((c) => c.ok).manifest;
export const MANIFEST_URL =
  "https://huggingface.co/JustJoyful/ffwd-0.6b/resolve/v1.0.0/ffwd-model.json";
export const MODEL = {
  ...toModelConfig(REAL_MANIFEST, MANIFEST_URL),
  url: "http://localhost/m.gguf",
};
