import { describe, expect, test } from "vitest";
import {
  MIN_DEVICE_MEMORY_GB,
  MODEL_TURN_SECONDS,
  TYPICAL_MODEL_TURNS,
  checkCapability,
  defaultCpuThreads,
  estimateWait,
  memoryWarning,
  selectModelPath,
} from "../../app/lib/capability.js";

// A desktop Chromium with everything the real tool needs; each test breaks one thing.
const GOOD = {
  crossOriginIsolated: true,
  gpu: {},
  deviceMemory: 8,
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36",
  scripted: false,
};

describe("checkCapability", () => {
  test("a capable desktop is ok with no reason", () => {
    expect(checkCapability(GOOD)).toEqual({
      ok: true,
      reason: null,
      path: "webgpu",
      notice: null,
      memoryWarning: false, // 8 GB is the recommended amount: no warning
    });
  });
  test.each([
    ["no-isolation", { crossOriginIsolated: false }],
    ["low-memory", { deviceMemory: MIN_DEVICE_MEMORY_GB / 2 }],
    [
      "mobile",
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148" },
    ],
    [
      "mobile",
      {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36",
      },
    ],
  ])("%s", (reason, change) => {
    expect(checkCapability({ ...GOOD, ...change })).toMatchObject({
      ok: false,
      reason,
    });
  });
  test("no WebGPU is not a refusal: ffwd runs the model on the processor and says so", () => {
    expect(checkCapability({ ...GOOD, gpu: undefined })).toEqual({
      ok: true,
      reason: null,
      path: "cpu",
      notice: "no-webgpu",
      memoryWarning: false,
    });
  });
  test("a scripted build (tests) has no model, so it claims no processor notice", () => {
    expect(
      checkCapability({ ...GOOD, gpu: undefined, scripted: true }),
    ).toMatchObject({ ok: true, path: "webgpu", notice: null });
  });
  test("isolation is required even with a scripted policy: ffmpeg.wasm needs SharedArrayBuffer", () => {
    expect(
      checkCapability({ ...GOOD, scripted: true, crossOriginIsolated: false })
        .reason,
    ).toBe("no-isolation");
  });
  test("an unknown device memory (Firefox, Safari) is let through", () => {
    expect(checkCapability({ ...GOOD, deviceMemory: undefined }).ok).toBe(true);
  });
  test("exactly the minimum memory is enough", () => {
    expect(
      checkCapability({ ...GOOD, deviceMemory: MIN_DEVICE_MEMORY_GB }).ok,
    ).toBe(true);
  });
});

describe("selectModelPath", () => {
  const real = {
    vendor: "nvidia",
    architecture: "ampere",
    isFallbackAdapter: false,
  };
  test("a real adapter means the graphics chip", () => {
    expect(selectModelPath({ gpu: {}, adapter: real })).toEqual({
      path: "webgpu",
      notice: null,
    });
  });
  test("an integrated GPU is still a real adapter", () => {
    expect(
      selectModelPath({
        gpu: {},
        adapter: {
          vendor: "intel",
          architecture: "gen-12lp",
          isFallbackAdapter: false,
        },
      }).path,
    ).toBe("webgpu");
  });
  test.each([
    ["no navigator.gpu", { gpu: undefined, adapter: undefined }],
    ["requestAdapter gave nothing", { gpu: {}, adapter: null }],
    [
      "the browser says fallback",
      { gpu: {}, adapter: { ...real, isFallbackAdapter: true } },
    ],
    [
      "a SwiftShader software adapter",
      {
        gpu: {},
        adapter: {
          vendor: "google",
          architecture: "swiftshader",
          isFallbackAdapter: false,
        },
      },
    ],
    [
      "llvmpipe",
      {
        gpu: {},
        adapter: { description: "llvmpipe (LLVM 17)", isFallbackAdapter: null },
      },
    ],
  ])("%s means the processor", (_n, env) => {
    expect(selectModelPath(env)).toEqual({ path: "cpu", notice: "no-webgpu" });
  });
  test("before the adapter has been asked, a present navigator.gpu is a first guess of the graphics chip", () => {
    expect(selectModelPath({ gpu: {} }).path).toBe("webgpu");
  });
});

describe("estimateWait", () => {
  test("is built from the measured medians and rounds up", () => {
    const t = MODEL_TURN_SECONDS.cpu;
    expect(estimateWait("cpu")).toEqual({
      firstStepSeconds: Math.ceil(t.first),
      laterStepSeconds: Math.ceil(t.next),
      jobModelSeconds: Math.ceil(t.first + (TYPICAL_MODEL_TURNS - 1) * t.next),
      measured: false,
    });
  });
  // 2026-11-24: a computer's own speed test replaces the one-laptop numbers
  test("with a measured speed it is computed from that speed, and says it was measured", () => {
    // 100 tokens/s reading, 20 tokens/s writing: first step 1500/100 + 60/20 = 18 s, a later one 200/100 + 60/20 = 5 s
    expect(estimateWait("cpu", { ppTokS: 100, genTokS: 20 })).toEqual({
      firstStepSeconds: 18,
      laterStepSeconds: 5,
      jobModelSeconds: 28,
      measured: true,
    });
  });
  test("a faster measured computer waits less, and an unusable measurement falls back to the constants", () => {
    const slow = estimateWait("cpu", { ppTokS: 20, genTokS: 5 });
    const fast = estimateWait("cpu", { ppTokS: 200, genTokS: 50 });
    expect(fast.firstStepSeconds).toBeLessThan(slow.firstStepSeconds);
    expect(estimateWait("cpu", { ppTokS: 0, genTokS: 5 }).measured).toBe(false);
    expect(estimateWait("cpu", null)).toEqual(estimateWait("cpu"));
  });
  test("the processor is slower than the graphics chip at every step", () => {
    const g = estimateWait("webgpu");
    const c = estimateWait("cpu");
    expect(c.firstStepSeconds).toBeGreaterThan(g.firstStepSeconds);
    expect(c.laterStepSeconds).toBeGreaterThan(g.laterStepSeconds);
    expect(c.jobModelSeconds).toBeGreaterThan(g.jobModelSeconds);
  });
});

describe("memory: 4 GB is the minimum, 8 GB is recommended (owner decision, 24 Nov 2026)", () => {
  test.each([
    [undefined, false, true], // Firefox and Safari report nothing: no warning, not refused
    [2, false, false],
    [3.9, false, false],
    [4, true, true],
    [6, true, true],
    [7.9, true, true],
    [8, false, true], // navigator.deviceMemory is capped at 8, so 8 means "8 or more"
  ])("reported memory %s: warning %s, runs %s", (deviceMemory, warn, runs) => {
    expect(memoryWarning(deviceMemory)).toBe(warn);
    const c = checkCapability({ ...GOOD, deviceMemory });
    expect(c.ok).toBe(runs);
    expect(c.memoryWarning).toBe(warn);
  });
  test("below the minimum it is refused as before, with no warning on top", () => {
    expect(checkCapability({ ...GOOD, deviceMemory: 2 })).toMatchObject({
      ok: false,
      reason: "low-memory",
      memoryWarning: false,
    });
  });
});

describe("defaultCpuThreads: min(4, max(1, floor(cores / 2)))", () => {
  test.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [6, 3],
    [8, 4],
    [12, 4], // the measured laptop: 4 threads gave 36 tok/s, the default 6 gave 17
    [32, 4],
    [undefined, 1], // unknown core count: assume 2 cores
    [0, 1],
  ])("%s logical cores -> %s threads", (cores, threads) => {
    expect(defaultCpuThreads(cores)).toBe(threads);
  });
});
