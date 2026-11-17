import { describe, expect, test } from "vitest";
import {
  MIN_DEVICE_MEMORY_GB,
  checkCapability,
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
    expect(checkCapability(GOOD)).toEqual({ ok: true, reason: null });
  });
  test.each([
    ["no-isolation", { crossOriginIsolated: false }],
    ["no-webgpu", { gpu: undefined }],
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
    expect(checkCapability({ ...GOOD, ...change })).toEqual({
      ok: false,
      reason,
    });
  });
  test("WebGPU is not required with a scripted policy (headless tests have none)", () => {
    expect(
      checkCapability({ ...GOOD, gpu: undefined, scripted: true }).ok,
    ).toBe(true);
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
