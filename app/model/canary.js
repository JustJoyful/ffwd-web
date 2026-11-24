// The WebGPU canary and the speed test (worker side: the engine is a loaded wllama, passed in, so the tests use a fake).
//
// Why: on an Intel gen-12lp iGPU (Mesa ANV, Chromium 159, wllama 4.0.0) the model's output through WebGPU is garbage,
// for prompts of about 880 tokens and longer, in every configuration tried, while the same file on an NVIDIA card scores
// 96/100 parity (reports/2026-11-24-overnight/MORNING_REPORT.md section 2, reports/2026-11-24-canary). A path that
// computes the wrong thing must never be used, so a first visit runs the real first-turn prompt greedily and compares the
// first 20 token ids with what native llama.cpp b12032 produced (the canary block of the release manifest ffwd-model.json: prompt re-rendered by manifest.js, ids and pass rule from it). Prefill (a long batch) and decode (one token at a time) are both exercised.
import { PATH_CHOICE } from "./config.js";

/** How many leading ids of `got` equal `want`. */
export function matchedPrefix(got, want) {
  let n = 0;
  while (n < want.length && got[n] === want[n]) n++;
  return n;
}

/**
 * Run the canary on a loaded engine. The reply is tokenised the way the reference was (special tokens NOT parsed), because
 * the engine's completion does not return ids. The reference is for the model file the manifest shipped (manifest.js checks
 * that), so a canary for another file never reaches here.
 * @param {{ createCompletion: Function, tokenize: Function }} w
 * @param {{ prompt: string, tokens: number[], minMatch: number }} ref from the manifest (toModelConfig().canary)
 * @returns {Promise<{ pass: boolean, matched: number, of: number }>}
 */
export async function runCanary(w, ref) {
  const of = ref.tokens.length;
  const r = await w.createCompletion({
    prompt: ref.prompt,
    max_tokens: of,
    temperature: 0, // greedy, like the reference
    seed: 1,
  });
  const ids = await w.tokenize(r.choices[0].text, {
    addSpecial: false,
    parseSpecial: false,
  });
  const matched = matchedPrefix(ids, ref.tokens);
  return { pass: matched >= ref.minMatch, matched, of };
}

/**
 * Speed of a loaded engine: prompt-processing and generation tokens per second, from the runtime's own timings. The
 * prompt starts with another role than the canary's, so almost nothing of it is cached (promptN counts only new tokens).
 * Returns null when the runtime gave no usable timings: the caller then simply has no number for this path.
 * @param {{ createCompletion: Function }} w
 * @param {string} text any long text: the canary prompt is used (it is in the worker anyway)
 * @returns {Promise<import("./contract.js").Bench | null>}
 */
export async function runBenchmark(w, text) {
  const body = text.slice(text.indexOf("\n") + 1);
  const r = await w.createCompletion({
    prompt: `<|im_start|>user\n${body.slice(0, PATH_CHOICE.benchPromptChars)}<|im_end|>\n<|im_start|>assistant\n`,
    max_tokens: PATH_CHOICE.benchGenTokens,
    temperature: 0,
    ignore_eos: true,
  });
  const t = r.timings ?? {};
  const pp = (t.prompt_n / t.prompt_ms) * 1000;
  const gen = (t.predicted_n / t.predicted_ms) * 1000;
  return pp > 0 && gen > 0 && Number.isFinite(pp) && Number.isFinite(gen)
    ? { ppTokS: round(pp), genTokS: round(gen) }
    : null;
}
const round = (x) => Math.round(x * 10) / 10;

/** Seconds one typical model step takes at this speed (config.js PATH_CHOICE.step). */
export const stepSeconds = (b) =>
  PATH_CHOICE.step.promptTokens / b.ppTokS +
  PATH_CHOICE.step.genTokens / b.genTokS;

/**
 * The faster of two CORRECT paths. Call it only after a passing canary. A path with no measurement loses to one with.
 * @param {{ webgpu?: import("./contract.js").Bench, cpu?: import("./contract.js").Bench }} bench
 * @returns {"webgpu" | "cpu"}
 */
export function pickPath(bench) {
  if (!bench.webgpu) return "cpu";
  if (!bench.cpu) return "webgpu";
  return stepSeconds(bench.webgpu) <= stepSeconds(bench.cpu) ? "webgpu" : "cpu";
}
