// The agent chat template (D-026), JavaScript port of training/env/chat_template.py `render`. The browser model
// runtime gets this string as a plain-text completion prompt and never applies its own chat template: MLC's stock
// Qwen3 template differed from ours on 11 of 11 fixtures (reports/2026-11-23-mlc-parity), and the same silent
// difference in any runtime would shift the model off the token stream it was trained on.
// Qwen3 non-thinking format with ONE deliberate difference from stock Qwen3: every assistant turn, history
// included, carries the empty think block. Must reproduce protocol/conformance/chat-template*.json byte for byte.

export const EMPTY_THINK = "<think>\n\n</think>\n\n";

/**
 * @param {{ role: string, content: string }[]} messages
 * @param {{ addGenerationPrompt?: boolean }} [opts]
 * @returns {string}
 */
export function renderChat(messages, { addGenerationPrompt = true } = {}) {
  let out = "";
  for (const m of messages) {
    const think = m.role === "assistant" ? EMPTY_THINK : "";
    out += `<|im_start|>${m.role}\n${think}${m.content}<|im_end|>\n`;
  }
  if (addGenerationPrompt) out += `<|im_start|>assistant\n${EMPTY_THINK}`;
  return out;
}
