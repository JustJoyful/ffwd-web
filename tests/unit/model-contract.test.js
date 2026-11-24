// Pins the model contract (app/model/contract.js) and the model config (app/model/config.js).
import { describe, expect, test } from "vitest";
import {
  ERROR_CODES,
  MACHINE_REASON,
  MODEL_ERROR_TEXT,
  initialModelState,
  validateWorkerMessage,
} from "../../app/model/contract.js";
import { MODEL } from "../../app/model/config.js";

const INIT = {
  type: "init",
  modelUrl: "http://localhost/m.gguf",
  sha256: MODEL.sha256,
  bytes: MODEL.bytes,
  nCtx: MODEL.nCtx,
  path: "webgpu",
  kvCache: "q8_0",
};
const TIMINGS = {
  cacheN: 0,
  promptN: 10,
  promptMs: 5,
  predictedN: 3,
  predictedMs: 2,
};

describe("worker messages", () => {
  test.each([
    INIT,
    { ...INIT, path: "cpu", threads: 4 },
    { type: "generate", id: 1, prompt: "<|im_start|>user\nhi", maxTokens: 512 },
    { type: "exit" },
    { ...INIT, probe: true },
    { type: "progress", phase: "download", loaded: 5, total: 10 },
    { type: "progress", phase: "check", loaded: 0, total: 0, step: "canary" },
    {
      type: "ready",
      path: "cpu",
      threads: 4,
      nCtx: 8192,
      cached: true,
      loadMs: 900.5,
      selection: {
        canary: "fail",
        matched: 0,
        of: 20,
        bench: { cpu: { ppTokS: 58, genTokS: 36.3 } },
      },
    },
    {
      type: "ready",
      path: "cpu",
      threads: 4,
      nCtx: 8192,
      cached: true,
      loadMs: 900.5,
    },
    {
      type: "result",
      id: 1,
      text: "{}",
      finishReason: "stop",
      timings: TIMINGS,
      wallMs: 12,
    },
    { type: "error", id: 2, code: "context_full", message: "too long" },
    { type: "error", code: "load_failed", message: "x" },
  ])("accepts %j", (m) => {
    expect(validateWorkerMessage(m)).toBe(m);
  });

  test.each([
    ["not an object", null],
    ["no type", {}],
    ["unknown type", { type: "ping" }],
    ["init without a model url", { ...INIT, modelUrl: "" }],
    ["init with a short hash", { ...INIT, sha256: "abc" }],
    ["init with an unknown path", { ...INIT, path: "gpu" }],
    ["init with an unknown kv cache", { ...INIT, kvCache: "q4_0" }],
    [
      "generate without a prompt",
      { type: "generate", id: 1, prompt: "", maxTokens: 5 },
    ],
    [
      "generate with a fractional id",
      { type: "generate", id: 1.5, prompt: "x", maxTokens: 5 },
    ],
    [
      "progress with a bad phase",
      { type: "progress", phase: "fetch", loaded: 1, total: 2 },
    ],
    ["init with a non-boolean probe", { ...INIT, probe: "yes" }],
    [
      "a check step on a download message",
      {
        type: "progress",
        phase: "download",
        loaded: 1,
        total: 2,
        step: "canary",
      },
    ],
    [
      "an unknown check step",
      { type: "progress", phase: "check", loaded: 0, total: 0, step: "warm" },
    ],
    [
      "a selection with an unknown canary word",
      {
        type: "ready",
        path: "cpu",
        threads: 4,
        nCtx: 8192,
        cached: true,
        loadMs: 1,
        selection: { canary: "maybe", matched: 0, of: 20, bench: {} },
      },
    ],
    [
      "a selection with a bad bench number",
      {
        type: "ready",
        path: "cpu",
        threads: 4,
        nCtx: 8192,
        cached: true,
        loadMs: 1,
        selection: {
          canary: "pass",
          matched: 20,
          of: 20,
          bench: { cpu: { ppTokS: "fast", genTokS: 1 } },
        },
      },
    ],
    [
      "result with no timings",
      { type: "result", id: 1, text: "", finishReason: "stop", wallMs: 1 },
    ],
    [
      "error with an unknown code",
      { type: "error", code: "boom", message: "x" },
    ],
  ])("rejects %s", (_n, m) => {
    expect(() => validateWorkerMessage(m)).toThrow(/worker message/);
  });
});

describe("error handling is complete", () => {
  test("every error code has a plain sentence and a machine reason", () => {
    for (const c of ERROR_CODES) {
      expect(MODEL_ERROR_TEXT[c], c).toMatch(/\.$/);
      expect(MACHINE_REASON[c], c).toBeTruthy();
    }
    expect(Object.keys(MODEL_ERROR_TEXT).sort()).toEqual(
      [...ERROR_CODES].sort(),
    );
    expect(Object.keys(MACHINE_REASON).sort()).toEqual([...ERROR_CODES].sort());
  });
  test("a job that does not fit ends as too_long, never as a success", () => {
    expect(MACHINE_REASON.context_full).toBe("too_long");
    expect(MODEL_ERROR_TEXT.context_full).toMatch(/not done/);
  });
});

describe("the model state and config", () => {
  test("the initial state is idle with nothing loaded", () => {
    expect(initialModelState()).toEqual({
      phase: "idle",
      loaded: 0,
      total: 0,
      cached: false,
      path: null,
      loadMs: null,
      error: null,
      // 2026-11-24, owner-approved: the path check (canary and speed test) adds these four, all null at the start
      check: null,
      canary: null,
      bench: null,
      fallback: null,
    });
  });
  test("the config is the owner-confirmed configuration (D-050, D-051)", () => {
    expect(MODEL).toMatchObject({
      file: "grpo-m3-ckpt60-q5_k_m.gguf",
      bytes: 444411456,
      sha256:
        "bbf439b749c02c04b5227ab93fb1430263a7c567c15552b6e12ae3836cde1e11",
      nCtx: 8192,
      kvCache: "q8_0",
      maxTokens: 512,
    });
  });
});
