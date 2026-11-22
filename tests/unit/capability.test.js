import { describe, expect, test } from "vitest";
import {
  MIN_DEVICE_MEMORY_GB,
  MODEL_TURN_SECONDS,
  TYPICAL_MODEL_TURNS,
  checkCapability,
  estimateWait,
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
    });
  });
  test("the processor is slower than the graphics chip at every step", () => {
    const g = estimateWait("webgpu");
    const c = estimateWait("cpu");
    expect(c.firstStepSeconds).toBeGreaterThan(g.firstStepSeconds);
    expect(c.laterStepSeconds).toBeGreaterThan(g.laterStepSeconds);
    expect(c.jobModelSeconds).toBeGreaterThan(g.jobModelSeconds);
  });
});
