import { afterEach, describe, expect, test, vi } from "vitest";
import { createMachine } from "../../app/agent/machine.js";
import {
  bindAnalytics,
  landingFromPath,
  siteVisit,
} from "../../app/tool/analytics-bridge.js";
import {
  act,
  fakeExecutor,
  fakeMeasure,
  policyOf,
  probeFile,
  run,
  spec,
} from "./engine-fakes.js";

const REQUEST = "make it under 2 MB for my holiday";
const FILE = { name: "holiday-2026.mp4" };

function setup(steps, measure) {
  const m = createMachine({
    policy: policyOf(steps),
    executor: fakeExecutor(),
    measure: measure ?? fakeMeasure(),
    probeFile,
  });
  const track = vi.fn();
  const off = bindAnalytics(m, { track });
  const events = () => track.mock.calls.map(([e]) => e);
  const call = (name) => track.mock.calls.find(([e]) => e === name)?.[1];
  return { m, track, off, events, call };
}
const open = async (m) => {
  await m.dispatch({ type: "capabilityChecked", ok: true });
  await m.dispatch({ type: "fileChosen", file: FILE });
};

afterEach(() => vi.unstubAllGlobals());

describe("bindAnalytics", () => {
  test("capability_checked carries the reason id, or none when the device is fine", async () => {
    const a = setup([]);
    vi.stubGlobal("navigator", { gpu: {} });
    await a.m.dispatch({ type: "capabilityChecked", ok: true });
    expect(a.track).toHaveBeenCalledWith("capability_checked", {
      webgpu: true,
    });
    const b = setup([]);
    vi.stubGlobal("navigator", {});
    await b.m.dispatch({
      type: "capabilityChecked",
      ok: false,
      reason: "no-webgpu",
    });
    expect(b.track).toHaveBeenCalledWith("capability_checked", {
      webgpu: false,
      fail_reason: "no-webgpu",
    });
  });

  test("a confirmed job that passes: edit_started, spec_confirmed, edit_completed", async () => {
    const t = setup([spec(), run(), run(), act({ action: "finish" })]);
    await open(t.m);
    await t.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    await t.m.dispatch({ type: "confirmed" });
    expect(t.events()).toEqual([
      "capability_checked",
      "edit_started",
      "spec_confirmed",
      "edit_completed",
    ]);
    expect(t.call("edit_started")).toEqual({
      families: ["F6"],
      mode: "browser",
      input_size_bucket: "under 10 MB",
      n_files_bucket: "1",
    });
    expect(t.call("spec_confirmed")).toEqual({ edited_by_user: false });
    expect(t.call("edit_completed")).toEqual({
      passed_check: true,
      runs: 2,
      seconds_bucket: "under 10 s",
      re_encoded: true,
    });
  });

  test("editing the request before confirming counts as edited_by_user, and edit_started is sent once", async () => {
    const t = setup([spec(), spec(), run(), run(), act({ action: "finish" })]);
    await open(t.m);
    await t.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    await t.m.dispatch({ type: "requestEdited", request: "under 3 MB" });
    await t.m.dispatch({ type: "confirmed" });
    expect(t.events().filter((e) => e === "edit_started")).toHaveLength(1);
    expect(t.call("spec_confirmed")).toEqual({ edited_by_user: true });
  });

  test("a stream copy is not a re-encode", async () => {
    const copy = act({
      action: "run",
      args: ["-i", "{in:clip}", "-c", "copy", "{out:out1}"],
      inputs: ["clip"],
      outputs: ["out1"],
    });
    const t = setup([spec(), copy], fakeMeasure({ sizes: [1_000_000] }));
    await open(t.m);
    await t.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    await t.m.dispatch({ type: "confirmed" });
    expect(t.call("edit_completed")).toMatchObject({ re_encoded: false });
  });

  test("running out of runs is edit_failed with its reason category", async () => {
    const t = setup(
      [spec(), run(), run(), run(), run()],
      fakeMeasure({ sizes: [3_200_000] }),
    );
    await open(t.m);
    await t.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    await t.m.dispatch({ type: "confirmed" });
    expect(t.call("edit_failed")).toEqual({ reason_category: "run_budget" });
    expect(t.events()).not.toContain("edit_completed");
  });

  test("a question and an unsupported request are counted with the generic category, never the sentence", async () => {
    const q = setup([
      act({ action: "ask_user", question: "Which part of holiday-2026?" }),
    ]);
    await open(q.m);
    await q.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    expect(q.call("ask_user_shown")).toEqual({ category: "other" });
    const u = setup([act({ action: "unsupported", reason: "no subtitles" })]);
    await open(u.m);
    await u.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    expect(u.call("unsupported_shown")).toEqual({ category: "other" });
  });

  test("no tracked payload contains the request, the file name or a path", async () => {
    const t = setup([spec(), run(), run(), act({ action: "finish" })]);
    await open(t.m);
    await t.m.dispatch({ type: "requestSubmitted", request: REQUEST });
    await t.m.dispatch({ type: "confirmed" });
    const all = JSON.stringify(t.track.mock.calls);
    for (const s of ["holiday", "2 MB", ".mp4", "in/", "run1", "/"])
      expect(all).not.toContain(s);
  });

  test("the returned function unsubscribes", async () => {
    const t = setup([]);
    t.off();
    await t.m.dispatch({ type: "capabilityChecked", ok: true });
    expect(t.track).not.toHaveBeenCalled();
  });
});

describe("siteVisit", () => {
  const visit = (opts) => {
    const track = vi.fn();
    siteVisit({ track, ...opts });
    return track.mock.calls[0];
  };
  test("landing_page is the route's slug or home, the referrer is the domain only", () => {
    expect(
      visit({
        landing: "cut-the-start-of-a-video",
        referrer: "https://www.reddit.com/r/ffmpeg/comments/abc?utm=1",
        host: "ffwd.example",
      }),
    ).toEqual([
      "site_visit",
      {
        landing_page: "cut-the-start-of-a-video",
        referrer_domain: "www.reddit.com",
      },
    ]);
    expect(visit({ landing: "home", referrer: "", host: "x" })[1]).toEqual({
      landing_page: "home",
    });
  });
  test("an internal or unreadable referrer sends no domain", () => {
    expect(
      visit({
        landing: "home",
        referrer: "https://ffwd.example/app",
        host: "ffwd.example",
      })[1],
    ).toEqual({ landing_page: "home" });
    expect(
      visit({ landing: "home", referrer: "not a url", host: "x" })[1],
    ).toEqual({
      landing_page: "home",
    });
  });
});

describe("landingFromPath", () => {
  test("a page name or a known chore slug, never the visitor's own text", () => {
    const slugs = ["trim-a-video"];
    expect(landingFromPath("/", slugs)).toBe("home");
    expect(landingFromPath("/privacy", slugs)).toBe("privacy");
    expect(landingFromPath("/chores/trim-a-video", slugs)).toBe("trim-a-video");
    expect(landingFromPath("/chores/my-secret-text", slugs)).toBe("other");
    expect(landingFromPath("/whatever/else", slugs)).toBe("other");
  });
});
