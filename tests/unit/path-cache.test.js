// The per-device path verdict (app/model/path-cache.js): hit, miss, corrupt, unavailable and expired storage.
import { describe, expect, test } from "vitest";
import { PATH_CHOICE } from "../../app/model/config.js";
import {
  adapterId,
  cacheKey,
  readVerdict,
  writeVerdict,
} from "../../app/model/path-cache.js";

const SHA = "bbf439b749c02c04b5227ab93fb1430263a7c567c15552b6e12ae3836cde1e11";
const NV = { vendor: "nvidia", architecture: "ampere", description: "RTX" };
const INTEL = { vendor: "intel", architecture: "gen-12lp", description: "" };
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    m,
  };
};
const OK = {
  webgpu: "ok",
  path: "webgpu",
  canary: "pass",
  why: null,
  bench: {
    webgpu: { ppTokS: 190, genTokS: 53 },
    cpu: { ppTokS: 58, genTokS: 36 },
  },
};
const BROKEN = {
  webgpu: "broken",
  path: "cpu",
  canary: "fail",
  why: "canary",
  bench: {},
};

describe("the key", () => {
  test("changes with the adapter and with the model, and is the same for the same pair", () => {
    expect(cacheKey(NV, SHA)).toBe(cacheKey({ ...NV }, SHA));
    expect(cacheKey(NV, SHA)).not.toBe(cacheKey(INTEL, SHA));
    expect(cacheKey(NV, SHA)).not.toBe(cacheKey(NV, "a".repeat(64)));
  });
  test("a device with no real adapter (none, or a software fallback) shares the key 'none'", () => {
    expect(adapterId(null)).toBe("none");
    expect(adapterId({ ...NV, isFallbackAdapter: true })).toBe("none");
    expect(cacheKey(null, SHA)).toBe(
      cacheKey({ ...INTEL, isFallbackAdapter: true }, SHA),
    );
  });
});

describe("read and write", () => {
  test("miss: nothing stored", () => {
    expect(readVerdict(cacheKey(NV, SHA), { storage: mem() })).toBeNull();
  });
  test("hit: what was written comes back (with a timestamp)", () => {
    const storage = mem();
    const key = cacheKey(NV, SHA);
    expect(writeVerdict(key, OK, { storage, now: () => 1000 })).toBe(true);
    expect(readVerdict(key, { storage, now: () => 2000 })).toEqual({
      ...OK,
      at: 1000,
    });
  });
  test("a verdict for one adapter is not a verdict for another", () => {
    const storage = mem();
    writeVerdict(cacheKey(INTEL, SHA), BROKEN, { storage });
    expect(readVerdict(cacheKey(NV, SHA), { storage })).toBeNull();
    expect(readVerdict(cacheKey(INTEL, SHA), { storage })).toMatchObject({
      path: "cpu",
      why: "canary",
    });
  });
  test.each([
    ["not JSON", "{oops"],
    ["a string", '"webgpu"'],
    ["null", "null"],
    ["an unknown path", JSON.stringify({ ...OK, path: "gpu", at: 1 })],
    [
      "a webgpu path without a passing canary",
      JSON.stringify({ ...OK, canary: "fail", at: 1 }),
    ],
    [
      "a broken verdict that is still on webgpu",
      JSON.stringify({ ...BROKEN, path: "webgpu", at: 1 }),
    ],
    [
      "a broken verdict with no reason",
      JSON.stringify({ ...BROKEN, why: null, at: 1 }),
    ],
    [
      "a bench with a text speed",
      JSON.stringify({
        ...OK,
        bench: { cpu: { ppTokS: "fast", genTokS: 1 } },
        at: 1,
      }),
    ],
    [
      "a bench with a zero speed",
      JSON.stringify({
        ...OK,
        bench: { cpu: { ppTokS: 0, genTokS: 1 } },
        at: 1,
      }),
    ],
    ["no timestamp", JSON.stringify(OK)],
  ])(
    "corrupt storage (%s) reads as no verdict, never as an error",
    (_n, raw) => {
      const key = cacheKey(NV, SHA);
      expect(
        readVerdict(key, { storage: mem({ [key]: raw }), now: () => 1 }),
      ).toBeNull();
    },
  );
  test("storage that throws (private window, blocked site data) is a miss on read and a no-op on write", () => {
    const dead = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readVerdict("k", { storage: dead })).toBeNull();
    expect(writeVerdict("k", OK, { storage: dead })).toBe(false);
  });
  test("no storage at all (globalThis.localStorage missing) is a miss", () => {
    expect(readVerdict("k", { storage: null })).toBeNull();
  });
  test("a verdict older than the lifetime is checked again", () => {
    const storage = mem();
    const key = cacheKey(NV, SHA);
    writeVerdict(key, OK, { storage, now: () => 0 });
    const day = 86_400_000;
    expect(
      readVerdict(key, {
        storage,
        now: () => (PATH_CHOICE.cacheTtlDays - 1) * day,
      }),
    ).not.toBeNull();
    expect(
      readVerdict(key, {
        storage,
        now: () => (PATH_CHOICE.cacheTtlDays + 1) * day,
      }),
    ).toBeNull();
  });
});
