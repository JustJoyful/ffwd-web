// The canary and the speed test (app/model/canary.js) against FAKE engines, and the reference file's own invariants.
import { describe, expect, test } from "vitest";
import reference from "../../app/model/canary-reference.json";
import { MODEL, PATH_CHOICE } from "../../app/model/config.js";
import {
  matchedPrefix,
  pickPath,
  runBenchmark,
  runCanary,
  stepSeconds,
} from "../../app/model/canary.js";

const SHA = MODEL.sha256;
/** An engine whose reply tokenises to `ids` (the canary compares ids, so the fake maps text -> ids through a table). */
const engine = (ids, over = {}) => ({
  asked: [],
  async createCompletion(o) {
    this.asked.push(o);
    return {
      choices: [{ text: "REPLY", finish_reason: "length" }],
      timings: over.timings,
    };
  },
  async tokenize(text, o) {
    this.tokenizeOpts = o;
    return ids;
  },
});

describe("the reference file", () => {
  test("is for the app's model, from llama.cpp b12032, and survives the tokeniser round trip", () => {
    expect(reference.model.sha256).toBe(MODEL.sha256);
    expect(reference.llamaCpp.build).toMatch(/^b12032-/);
    expect(reference.ggufSha256Checked).toBe(true);
    expect(reference.roundTrips).toBe(true);
    expect(reference.tokens).toHaveLength(reference.maxTokens);
    expect(reference.maxTokens).toBe(20);
  });
  test("is the long first-turn prompt: the Intel failure starts above about 880 tokens, so a shorter canary would pass it", () => {
    expect(reference.promptTokenCount).toBeGreaterThan(1000);
    expect(reference.prompt.startsWith("<|im_start|>system\n")).toBe(true);
    expect(
      reference.prompt.endsWith(
        "<|im_start|>assistant\n<think>\n\n</think>\n\n",
      ),
    ).toBe(true);
  });
  test("every greedy step is confident (best token far ahead of the second), so float noise cannot flip a correct path", () => {
    expect(reference.stepMargins).toHaveLength(reference.maxTokens);
    expect(Math.min(...reference.stepMargins)).toBeGreaterThan(4);
  });
  test("the match rule leaves room for a late flip but is nowhere near a broken path", () => {
    expect(PATH_CHOICE.canaryMinMatch).toBeLessThanOrEqual(reference.maxTokens);
    expect(PATH_CHOICE.canaryMinMatch).toBeGreaterThanOrEqual(
      reference.maxTokens - 3,
    );
  });
});

describe("matchedPrefix", () => {
  test.each([
    [[1, 2, 3], [1, 2, 3], 3],
    [[1, 2, 9], [1, 2, 3], 2],
    [[9, 2, 3], [1, 2, 3], 0],
    [[1, 2], [1, 2, 3], 2],
    [[], [1, 2, 3], 0],
    [[1, 2, 3, 4], [1, 2, 3], 3],
  ])("%j against %j -> %i", (got, want, n) => {
    expect(matchedPrefix(got, want)).toBe(n);
  });
});

describe("runCanary", () => {
  test("pass: the greedy reply has the reference ids; the prompt and settings are the reference's", async () => {
    const w = engine([...reference.tokens]);
    const r = await runCanary(w, { modelSha256: SHA });
    expect(r).toEqual({ pass: true, matched: 20, of: 20 });
    expect(w.asked[0]).toMatchObject({
      prompt: reference.prompt,
      max_tokens: reference.maxTokens,
      temperature: 0,
    });
    // ids are taken from the TEXT with special tokens NOT parsed, the way the reference was checked
    expect(w.tokenizeOpts).toEqual({ addSpecial: false, parseSpecial: false });
  });
  test("fail: the Intel iGPU's garbage matches nothing", async () => {
    const garbage = [27700, 27700, 27700, 27700]; // a repeated word, as seen on the iGPU
    const r = await runCanary(engine(garbage), { modelSha256: SHA });
    expect(r).toEqual({ pass: false, matched: 0, of: 20 });
  });
  test("the threshold: 18 of 20 passes, 17 does not", async () => {
    const at = (n) => [...reference.tokens.slice(0, n), -1, -1, -1];
    expect((await runCanary(engine(at(18)), { modelSha256: SHA })).pass).toBe(
      true,
    );
    expect((await runCanary(engine(at(17)), { modelSha256: SHA })).pass).toBe(
      false,
    );
  });
  test("a reference made for another model cannot vouch for this one: never trusted", async () => {
    const r = await runCanary(engine([...reference.tokens]), {
      modelSha256: "0".repeat(64),
    });
    expect(r.pass).toBe(false);
  });
});

describe("runBenchmark", () => {
  const timings = {
    prompt_n: 200,
    prompt_ms: 1000,
    predicted_n: 24,
    predicted_ms: 800,
  };
  test("tokens per second from the runtime's own timings", async () => {
    const w = engine([], { timings });
    expect(await runBenchmark(w)).toEqual({ ppTokS: 200, genTokS: 30 });
    expect(w.asked[0]).toMatchObject({
      max_tokens: PATH_CHOICE.benchGenTokens,
      temperature: 0,
      ignore_eos: true,
    });
  });
  test("its prompt shares nothing with the canary's beyond the first special token, so nothing is served from the cache", async () => {
    const w = engine([], { timings });
    await runBenchmark(w);
    const p = w.asked[0].prompt;
    expect(p.startsWith("<|im_start|>user\n")).toBe(true);
    expect(reference.prompt.startsWith("<|im_start|>system\n")).toBe(true);
    expect(p.length).toBeLessThan(PATH_CHOICE.benchPromptChars + 100);
  });
  test("no usable timings -> null, not a made-up number", async () => {
    expect(await runBenchmark(engine([]))).toBeNull();
    expect(
      await runBenchmark(
        engine([], {
          timings: {
            prompt_n: 0,
            prompt_ms: 0,
            predicted_n: 1,
            predicted_ms: 1,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("pickPath: the faster CORRECT path by the time of a typical step", () => {
  const fast = { ppTokS: 500, genTokS: 60 };
  const slow = { ppTokS: 58, genTokS: 36 };
  test("the faster one wins", () => {
    expect(pickPath({ webgpu: fast, cpu: slow })).toBe("webgpu");
    expect(pickPath({ webgpu: slow, cpu: fast })).toBe("cpu");
  });
  test("a tie goes to the graphics chip (it frees the processor for ffmpeg)", () => {
    expect(pickPath({ webgpu: slow, cpu: slow })).toBe("webgpu");
  });
  test("a step needs both reading and writing: a path that reads fast but writes slowly can lose", () => {
    const readsFast = { ppTokS: 2000, genTokS: 5 };
    const balanced = { ppTokS: 100, genTokS: 40 };
    expect(stepSeconds(readsFast)).toBeGreaterThan(stepSeconds(balanced));
    expect(pickPath({ webgpu: readsFast, cpu: balanced })).toBe("cpu");
  });
  test("a path with no measurement loses to one with", () => {
    expect(pickPath({ cpu: slow })).toBe("cpu");
    expect(pickPath({ webgpu: slow })).toBe("webgpu");
    expect(pickPath({})).toBe("cpu");
  });
});
