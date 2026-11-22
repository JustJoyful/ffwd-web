// Builds dist/ffwd-bench-kit/: a folder a friend can run with ONE command (node bench.mjs --model <gguf>) on their own
// laptop, to measure the on-device model on an integrated GPU. It copies the kit sources, the site's chat-template
// renderer (so the kit renders prompts the way the app does), the wllama runtime files, and the replay fixture.
//   node scripts/make-bench-kit.mjs
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "ffwd-bench-kit");
const KIT = join(ROOT, "spikes", "bench-kit");
// wllama is a spike-only dependency: installed in the spike package (D-051), or in the root during the move.
const WLLAMA = [
  join(ROOT, "spikes/wllama/node_modules/@wllama/wllama"),
  join(ROOT, "node_modules/@wllama/wllama"),
].find((p) => existsSync(join(p, "esm/index.js")));
if (!WLLAMA)
  throw new Error("wllama is not installed (pnpm install in the repo)");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "vendor/wllama/wasm"), { recursive: true });
for (const f of ["bench.mjs", "bench.html", "bench.js", "prompts.json"]) {
  cpSync(join(KIT, f), join(OUT, f));
}
cpSync(join(ROOT, "app/agent/chat-template.js"), join(OUT, "chat-template.js"));
cpSync(join(WLLAMA, "esm/index.js"), join(OUT, "vendor/wllama/index.js"));
cpSync(
  join(WLLAMA, "esm/wasm/wllama.wasm"),
  join(OUT, "vendor/wllama/wasm/wllama.wasm"),
);
cpSync(join(WLLAMA, "LICENCE"), join(OUT, "vendor/wllama/LICENCE"));
const version = JSON.parse(
  readFileSync(join(WLLAMA, "package.json"), "utf8"),
).version;
writeFileSync(
  join(OUT, "README.txt"),
  `ffwd model bench (kit 1, wllama ${version})

What this does: runs the ffwd on-device model in YOUR browser on YOUR computer and writes one result file with the speed,
the memory use and the graphics adapter. Nothing is uploaded; a small server runs on 127.0.0.1 only.

You need: Node 20 or newer, a current Chrome or Edge, and the model file (grpo-m3-ckpt60-q5_k_m.gguf, 444 MB).

Run, from this folder:
    node bench.mjs --model /path/to/grpo-m3-ckpt60-q5_k_m.gguf

It opens your default browser (use Chrome or Edge: set it as default for the test, or run with --no-open and paste the
printed address into Chrome or Edge). Leave the tab in front and the computer alone, close other heavy programs, and
plug in the charger. It runs the graphics path (20 short recorded jobs) and then the processor path (5 jobs, because it
is slow on weak machines). It takes about 5 to 20 minutes. At the end it prints a summary and writes
bench-result-<date>.json. Send that one file back.

Options: --paths gpu | cpu | gpu,cpu    --tasks 20    --cpu-tasks 5    --out result.json    --no-open

What the numbers mean:
  median_turn_s            seconds for one model step (the product target is 5 s or less)
  exact_match_native       share of steps whose reply is identical to the one the reference run gave (not task success)
  well_formed_action        share of replies that are a well-formed action
  system_memory            how much of the computer's memory was used at the peak (a built-in graphics chip shares it)
  env.adapters             which graphics chip the browser picked by default, for low power, and for high performance

Not measured here: task success (there is no checker in this kit) and the video re-encode while the model runs.
The replay uses 20 recorded jobs of three model steps each, so it shows speed and agreement, not accuracy on new jobs.
`,
);
console.log(`kit built: ${OUT} (wllama ${version})`);
