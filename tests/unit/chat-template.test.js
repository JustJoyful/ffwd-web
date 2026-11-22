// The JavaScript chat-template renderer must reproduce the golden prompts byte for byte (RULES §4.8, D-026). The model
// runtime only ever receives this string as a plain-text prompt. The token-id half of the check (the runtime's own
// llama.cpp tokenizer gives the same ids as native llama.cpp) needs the WebAssembly runtime, so it lives in
// tests/browser-gguf/tokenizer.test.js; here the stored ids are checked for shape only.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EMPTY_THINK, renderChat } from "../../app/agent/chat-template.js";

const load = (f) =>
  JSON.parse(readFileSync(`protocol/conformance/${f}`, "utf8")).cases;
const golden = load("chat-template.json");
const withTokens = load("chat-template-tokens.json");

describe("chat-template.json (the golden renders)", () => {
  test.each(golden.map((c) => [c.name, c]))("%s is byte-identical", (_n, c) => {
    expect(
      renderChat(c.messages, { addGenerationPrompt: c.add_generation_prompt }),
    ).toBe(c.rendered);
  });
});

describe("chat-template-tokens.json (real agent prompts)", () => {
  test("has the golden cases and the real prompts", () => {
    expect(withTokens.length).toBeGreaterThanOrEqual(14);
  });
  test.each(withTokens.map((c) => [c.name, c]))(
    "%s renders byte-identically and carries llama.cpp token ids",
    (_n, c) => {
      expect(
        renderChat(c.messages, {
          addGenerationPrompt: c.add_generation_prompt,
        }),
      ).toBe(c.rendered);
      expect(c.token_ids.length).toBeGreaterThan(0);
      expect(c.token_ids.every((i) => Number.isInteger(i) && i >= 0)).toBe(
        true,
      );
    },
  );
});

describe("the one deliberate difference from stock Qwen3", () => {
  test("every assistant turn, history included, carries the empty think block", () => {
    const conv = [
      { role: "system", content: "S" },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U2" },
      { role: "assistant", content: "A2" },
    ];
    const text = renderChat(conv, { addGenerationPrompt: true });
    expect(text.split(EMPTY_THINK).length - 1).toBe(3); // two history turns + the generation prompt
  });
  test("no generation prompt when asked not to", () => {
    expect(
      renderChat([{ role: "user", content: "x" }], {
        addGenerationPrompt: false,
      }),
    ).toBe("<|im_start|>user\nx<|im_end|>\n");
  });
});
