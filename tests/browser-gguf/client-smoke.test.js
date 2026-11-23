// OPT-IN, MANUAL: the app's worker host (app/model/model-host.js, what model.worker.js wires up) on a REAL wllama and a
// REAL GGUF in real Chromium. It checks that a cold init downloads, hashes and loads the file, that one greedy turn
// answers, and that a warm init (same browser profile) reuses the cache without downloading. Not run in CI and not
// part of `pnpm test`; the unit tests in tests/unit/model-host.test.js cover the logic with a fake wllama.
//   systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
//     env FFWD_GGUF=/path/to/grpo-m3-ckpt60-q5_k_m.gguf pnpm test:browser-gguf client-smoke
// (a memory cap is mandatory, spikes/wllama/run.mjs refuses to launch without one; FFWD_GGUF_MODE=gpu for the WebGPU leg).
// What it cannot show: the Vite-bundled worker entry itself (model.worker.js with the wasm URL) and the client's
// own main-thread cache probe; those need `vite build` or the dev server and are checked by hand.
import { describe, expect, test } from "vitest";
import { runHostSmoke } from "../../spikes/wllama/run.mjs";

const gguf = process.env.FFWD_GGUF;

describe.skipIf(!gguf)("the worker host on a real model", () => {
  test("cold init, one turn, warm init", async () => {
    const out = await runHostSmoke({
      model: gguf,
      mode: process.env.FFWD_GGUF_MODE ?? "cpu",
      ctx: 2048,
      port: 4401,
    });
    const at = out.findIndex((m) => m.type === "marker");
    const cold = out.slice(0, at);
    const warm = out.slice(at + 1);
    expect(cold.filter((m) => m.type === "error")).toEqual([]);
    expect(cold.find((m) => m.type === "ready")).toMatchObject({
      cached: false,
    });
    expect(cold.filter((m) => m.phase === "download").length).toBeGreaterThan(
      0,
    );
    const result = cold.find((m) => m.type === "result");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.timings.predictedN).toBeGreaterThan(0);
    expect(warm.find((m) => m.type === "ready")).toMatchObject({
      cached: true,
    });
    expect(warm.filter((m) => m.phase === "download")).toEqual([]);
  }, 900_000);
});
