import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  bucketCount,
  bucketLoadMs,
  bucketSeconds,
  bucketSize,
} from "../../app/lib/buckets.js";

// A stand-in for posthog-js: records what the wrapper hands it. The wrapper imports it lazily, so each test
// resets the module registry and loads a fresh copy of the wrapper.
const ph = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
};
vi.mock("posthog-js/dist/module.slim.js", () => ({ default: ph }));

async function load(settings = { key: "phc_fake", host: "https://ph.test" }) {
  vi.resetModules();
  vi.doMock("../../app/config.js", async (orig) => ({
    ...(await orig()),
    analyticsSettings: () => settings,
  }));
  return import("../../app/lib/analytics.js");
}

/** Fire the first interaction so the scheduled load runs, then let the dynamic import settle. */
async function interact() {
  window.dispatchEvent(new Event("pointerdown"));
  await vi.dynamicImportSettled();
}

beforeEach(() => {
  for (const f of Object.values(ph)) f.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sanitize", () => {
  test("an unknown event is dropped", async () => {
    const { sanitize } = await load();
    expect(sanitize("page_viewed", { landing_page: "home" })).toBeNull();
    expect(sanitize("__proto__", {})).toBeNull();
    expect(sanitize("toString", {})).toBeNull();
  });

  test("a property not in the list is dropped (prompt, file_name, path, url, email, text)", async () => {
    const { sanitize } = await load();
    const out = sanitize("site_visit", {
      landing_page: "home",
      referrer_domain: "news.example",
      prompt: "cut the first 3 seconds",
      file_name: "holiday.mp4",
      path: "/home/me/holiday.mp4",
      url: "https://x.test/app?ask=secret",
      email: "me@example.com",
      text: "hello",
    });
    expect(out).toEqual({
      landing_page: "home",
      referrer_domain: "news.example",
    });
  });

  test("the model events keep version, cache_hit and ms and drop prompt, file_name, path, url, email, text and the model URL", async () => {
    const { sanitize } = await load();
    const junk = {
      prompt: "cut the first 3 seconds",
      file_name: "holiday.mp4",
      path: "webgpu",
      adapter: "nvidia ampere",
      gpu: "NVIDIA GeForce RTX 3050",
      vendor: "nvidia",
      architecture: "ampere",
      description: "NVIDIA GeForce RTX 3050 Laptop GPU",
      tokens_per_second: 36.3,
      bench: { ppTokS: 58, genTokS: 36.3 },
      url: "https://x.test/app?ask=secret",
      model_url: "http://localhost:8080/grpo-m3-ckpt60-q5_k_m.gguf",
      modelUrl: "http://localhost:8080/grpo-m3-ckpt60-q5_k_m.gguf",
      email: "me@example.com",
      text: "hello",
      bytes: 444411456,
    };
    for (const event of ["model_load_started", "model_load_completed"])
      expect(
        sanitize(event, {
          model_version: "agent-v0.1-0.6b-q5_k_m",
          cache_hit: true,
          ms: "2 to 5 s",
          ...junk,
        }),
      ).toEqual({
        model_version: "agent-v0.1-0.6b-q5_k_m",
        cache_hit: true,
        ms: "2 to 5 s",
      });
  });

  test("model_load_completed keeps only the coarse path and canary words; anything else in those fields becomes other", async () => {
    const { sanitize } = await load();
    expect(
      sanitize("model_load_completed", {
        model_path: "cpu",
        canary: "fail",
        adapter: "intel gen-12lp",
      }),
    ).toEqual({ model_path: "cpu", canary: "fail" });
    expect(
      sanitize("model_load_completed", {
        model_path: "NVIDIA GeForce RTX 3050",
        canary: "intel gen-12lp",
      }),
    ).toEqual({ model_path: "other", canary: "other" });
    // the started event never carries them
    expect(
      sanitize("model_load_started", { model_path: "cpu", canary: "pass" }),
    ).toEqual({});
  });

  test('a free-text value in an enum field becomes "other"', async () => {
    const { sanitize } = await load();
    const text = "TypeError: cannot read /home/me/holiday.mp4";
    expect(sanitize("capability_checked", { fail_reason: text })).toEqual({
      fail_reason: "other",
    });
    expect(sanitize("edit_failed", { reason_category: text })).toEqual({
      reason_category: "other",
    });
    expect(sanitize("unsupported_shown", { category: text })).toEqual({
      category: "other",
    });
    expect(sanitize("helper_detected", { mode: text })).toEqual({
      mode: "other",
    });
    expect(
      sanitize("edit_started", { families: ["F1", "my secret", "F12"] }),
    ).toEqual({ families: ["F1", "other", "F12"] });
  });

  test("known values pass unchanged", async () => {
    const { sanitize } = await load();
    expect(
      sanitize("capability_checked", { webgpu: false, fail_reason: "mobile" }),
    ).toEqual({ webgpu: false, fail_reason: "mobile" });
    expect(sanitize("edit_failed", { reason_category: "run_budget" })).toEqual({
      reason_category: "run_budget",
    });
    expect(
      sanitize("edit_completed", {
        passed_check: true,
        runs: 2,
        seconds_bucket: "10 to 30 s",
        re_encoded: true,
      }),
    ).toEqual({
      passed_check: true,
      runs: 2,
      seconds_bucket: "10 to 30 s",
      re_encoded: true,
    });
  });

  test("a 41-character string is never sent, 40 is", async () => {
    const { sanitize } = await load();
    expect(sanitize("site_visit", { referrer_domain: "a".repeat(41) })).toEqual(
      {},
    );
    expect(sanitize("site_visit", { referrer_domain: "a".repeat(40) })).toEqual(
      { referrer_domain: "a".repeat(40) },
    );
  });

  test("objects, null and non-finite numbers are dropped", async () => {
    const { sanitize } = await load();
    expect(
      sanitize("edit_completed", {
        runs: Infinity,
        seconds_bucket: { a: 1 },
        model_version: null,
        passed_check: undefined,
      }),
    ).toEqual({});
  });
});

describe("guardEvent (the last gate inside PostHog)", () => {
  test("drops every event that is not ours, and every property PostHog adds by itself", async () => {
    const { guardEvent } = await load();
    expect(guardEvent({ event: "$pageview", properties: {} })).toBeNull();
    expect(guardEvent({ event: "$autocapture", properties: {} })).toBeNull();
    expect(guardEvent({ event: "$exception", properties: {} })).toBeNull();
    const out = guardEvent({
      uuid: "u",
      event: "site_visit",
      timestamp: "t",
      $set: { email: "x" },
      $set_once: { $initial_current_url: "https://x.test/app?ask=secret" },
      properties: {
        token: "phc_fake",
        distinct_id: "d",
        $current_url: "https://x.test/app?ask=secret",
        $pathname: "/app",
        $referrer: "https://news.example/some/path",
        $screen_width: 1440,
        landing_page: "home",
        file_name: "holiday.mp4",
      },
    });
    expect(out.event).toBe("site_visit");
    expect(Object.keys(out.properties).sort()).toEqual([
      "distinct_id",
      "landing_page",
      "token",
    ]);
    expect(out.$set).toBeUndefined();
    expect(out.$set_once).toBeUndefined();
  });
});

describe("track and the loader", () => {
  test("with no key nothing is scheduled, loaded or sent, and nothing throws", async () => {
    const { track, initAnalytics } = await load({ key: "", host: "" });
    vi.useFakeTimers();
    expect(() => {
      initAnalytics();
      track("site_visit", { landing_page: "home" });
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    await interact();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  test("PostHog loads on the first interaction, with autocapture, replay and IP capture off, then sends the queued event", async () => {
    const { track, initAnalytics } = await load();
    initAnalytics();
    initAnalytics(); // idempotent
    track("site_visit", { landing_page: "home", prompt: "secret" });
    expect(ph.init).not.toHaveBeenCalled();
    await interact();
    expect(ph.init).toHaveBeenCalledTimes(1);
    const [key, opts] = ph.init.mock.calls[0];
    expect(key).toBe("phc_fake");
    expect(opts).toMatchObject({
      api_host: "https://ph.test",
      autocapture: false,
      disable_session_recording: true,
      ip: false,
      capture_pageview: false,
      persistence: "localStorage",
    });
    expect(typeof opts.before_send).toBe("function");
    expect(ph.capture).toHaveBeenCalledWith(
      "site_visit",
      { landing_page: "home" },
      { timestamp: expect.any(Date) },
    );
  });

  test("PostHog loads after 3 s idle when nobody interacts", async () => {
    vi.useFakeTimers();
    const { track, initAnalytics } = await load();
    initAnalytics();
    track("site_visit", { landing_page: "home" });
    await vi.advanceTimersByTimeAsync(2999);
    expect(ph.init).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.dynamicImportSettled();
    expect(ph.init).toHaveBeenCalledTimes(1);
  });

  test("identify is never called", async () => {
    const { track, initAnalytics } = await load();
    initAnalytics();
    track("spec_confirmed", { edited_by_user: false });
    await interact();
    track("edit_failed", { reason_category: "run_budget" });
    expect(ph.capture).toHaveBeenCalledTimes(2);
    expect(ph.identify).not.toHaveBeenCalled();
  });

  test("with Do Not Track or Global Privacy Control set, PostHog is never loaded", async () => {
    for (const nav of [
      { doNotTrack: "1" },
      { doNotTrack: "yes" },
      { doNotTrack: null, globalPrivacyControl: true },
    ]) {
      vi.stubGlobal("navigator", { ...navigator, ...nav });
      const { track, initAnalytics } = await load();
      initAnalytics();
      track("site_visit", { landing_page: "home" });
      await interact();
      expect(ph.init).not.toHaveBeenCalled();
      expect(ph.capture).not.toHaveBeenCalled();
    }
  });

  test("with localStorage throwing, or PostHog failing, track does not throw", async () => {
    const { track, initAnalytics } = await load();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    ph.init.mockImplementation(() => {
      throw new Error("posthog broke");
    });
    expect(() => {
      initAnalytics();
      track("site_visit", { landing_page: "home" });
    }).not.toThrow();
    await interact();
    expect(() => track("edit_failed", { reason_category: "x" })).not.toThrow();
  });
});

describe("buckets", () => {
  test("bucketSize(12_100_000) is one label of the documented list", () => {
    expect(bucketSize(12_100_000)).toBe("10 to 100 MB");
    expect(bucketSize(5_000)).toBe("under 10 MB");
    expect(bucketSize(2e9)).toBe("over 1 GB");
    expect(bucketSize(NaN)).toBe("unknown");
    expect(bucketSize(-1)).toBe("unknown");
  });
  test("seconds and file counts", () => {
    expect(bucketSeconds(4.2)).toBe("under 10 s");
    expect(bucketSeconds(10)).toBe("10 to 30 s");
    expect(bucketSeconds(500)).toBe("over 3 min");
    expect(bucketCount(1)).toBe("1");
    expect(bucketCount(3)).toBe("2 to 3");
    expect(bucketCount(9)).toBe("4 or more");
    expect(bucketCount(0)).toBe("unknown");
  });
  test("model load time", () => {
    expect(bucketLoadMs(900)).toBe("under 2 s");
    expect(bucketLoadMs(2000)).toBe("2 to 5 s");
    expect(bucketLoadMs(12_345)).toBe("5 to 15 s");
    expect(bucketLoadMs(59_999)).toBe("15 to 60 s");
    expect(bucketLoadMs(61_000)).toBe("over 60 s");
    expect(bucketLoadMs(null)).toBe("unknown");
    expect(bucketLoadMs(NaN)).toBe("unknown");
  });
});

describe("EVENTS", () => {
  test("is exactly the list in ARCHITECTURE section 9", async () => {
    const { EVENTS } = await load();
    expect(EVENTS).toEqual({
      site_visit: ["landing_page", "referrer_domain"],
      capability_checked: ["webgpu", "fail_reason"],
      model_load_started: ["model_version", "cache_hit", "ms"],
      model_load_completed: [
        "model_version",
        "cache_hit",
        "ms",
        "model_path",
        "canary",
      ],
      edit_started: ["families", "mode", "input_size_bucket", "n_files_bucket"],
      spec_confirmed: ["edited_by_user"],
      edit_completed: [
        "passed_check",
        "runs",
        "seconds_bucket",
        "re_encoded",
        "model_version",
      ],
      edit_failed: ["reason_category"],
      ask_user_shown: ["category"],
      unsupported_shown: ["category"],
      helper_detected: ["mode"],
      helper_handoff: ["mode"],
    });
  });
});
