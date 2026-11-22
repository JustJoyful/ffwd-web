// The token-id half of the chat-template conformance check: the runtime's OWN tokenizer (llama.cpp compiled to
// WebAssembly, inside real Chromium) must give the ids native llama.cpp gave for every fixture, and its completion
// path must count the same prompt length. Needs a GGUF of the model and a browser, so it is opt-in:
//   FFWD_GGUF=/path/to/grpo-m3-ckpt60-q5_k_m.gguf pnpm test:browser-gguf
// (the vocabulary is the same in every quant of one model). The WebGPU leg needs a real GPU and fails, on purpose, on a
// software adapter. The byte-identity half of the check runs everywhere in tests/unit/chat-template.test.js.
import { describe, expect, test } from "vitest";
import { runTokcheck } from "../../spikes/wllama/run.mjs";

const gguf = process.env.FFWD_GGUF;

describe.skipIf(!gguf)("the runtime tokenizer matches llama.cpp", () => {
  test.each(["cpu", "gpu"])(
    "every fixture, %s path",
    async (mode) => {
      const r = await runTokcheck({ model: gguf, mode, ctx: 2048, port: 4400 });
      expect(r.checked).toBeGreaterThanOrEqual(14);
      expect(r.bad).toEqual([]);
    },
    300_000,
  );
});
