// What the page sends to analytics, on the real /app route with the scripted trim flow. PostHog gets a fake key and a
// stubbed host; the spec records every request that reaches it and asserts that nothing but the allowed categories
// and numbers goes out: no typed sentence, no file name, no path, no URL (the page was opened with ?ask=<text>).
import { expect, test } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { dropClip, makeClip, openApp } from "./app-driver.js";
import { CHORES } from "./scripts.js";

const ANALYTICS = {
  key: "phc_fake_key_for_e2e",
  host: "https://analytics.test",
};

// The allowlist, written out here from ARCHITECTURE §9 (not imported from the app) so that a key added to the app's
// EVENTS without the architecture changing fails this spec. token and distinct_id are PostHog's routing keys.
const ALLOWED = {
  site_visit: ["landing_page", "referrer_domain"],
  capability_checked: ["webgpu", "fail_reason"],
  model_load_started: ["model_version", "cache_hit", "ms"],
  // 2026-11-24 (owner decision): the coarse path and the graphics check's verdict, never adapter names or speeds. The
  // model repo's ARCHITECTURE section 9 does not list these two yet.
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
};
const TRANSPORT = ["token", "distinct_id", "$process_person_profile"];

const SECRET_ASK = "zebra-secret-sentence about my holiday";

/** Stub the analytics host. Records every request; answers anything with an empty, CORS-safe reply. */
async function stubHost(context) {
  const requests = [];
  await context.route(`${ANALYTICS.host}/**`, (route) => {
    const r = route.request();
    requests.push({
      url: r.url(),
      method: r.method(),
      body: r.postDataBuffer(),
    });
    return route.fulfill({
      status: r.method() === "OPTIONS" ? 204 : 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "cross-origin-resource-policy": "cross-origin",
        "content-type": r.url().endsWith(".js")
          ? "text/javascript"
          : "application/json",
      },
      body: r.url().endsWith(".js") ? "" : "{}",
    });
  });
  return requests;
}

/** The JSON events inside one request body: plain JSON, form-encoded base64 (`data=`), or gzip of either. */
function eventsOf(buffer) {
  if (!buffer || buffer.length === 0) return [];
  let raw =
    buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  let text = raw.toString("utf8");
  if (!/^[[{]/.test(text)) {
    const data = new URLSearchParams(text).get("data") ?? text;
    text = Buffer.from(data, "base64").toString("utf8");
    if (text.charCodeAt(0) === 0x1f)
      text = gunzipSync(Buffer.from(data, "base64")).toString("utf8");
  }
  const json = JSON.parse(text); // an undecodable body fails the spec instead of passing it
  // PostHog posts [{ api_key, batch: [event, ...] }]
  return (Array.isArray(json) ? json : [json]).flatMap((j) => j.batch ?? [j]);
}

test("the trim flow sends only allowed events, keys and values to analytics", async ({
  browser,
}) => {
  const chore = CHORES.trim;
  const b64 = await makeClip(browser, chore.recipe);
  let requests;
  const { context, page } = await openApp(browser, chore.script, {
    path: `/app?ask=${encodeURIComponent(SECRET_ASK)}`,
    analytics: ANALYTICS,
    beforeGoto: async (c) => (requests = await stubHost(c)),
  });

  await dropClip(page, chore.file, b64);
  const field = page.getByLabel("What should happen to your video?");
  await field.fill(chore.ask);
  await field.press("Enter");
  const runIt = page.getByRole("button", { name: "Run it" });
  await expect(runIt).toBeFocused();
  await runIt.press("Enter");
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });

  const sent = () =>
    requests.flatMap((r) => (r.method === "POST" ? eventsOf(r.body) : []));
  await expect
    .poll(() => sent().some((e) => e.event === "edit_completed"), {
      timeout: 30_000,
    })
    .toBe(true);

  const events = sent();
  const names = events.map((e) => e.event);
  for (const n of [
    "site_visit",
    "capability_checked",
    "edit_started",
    "spec_confirmed",
    "edit_completed",
  ])
    expect(names).toContain(n);
  for (const e of events) {
    expect(Object.keys(ALLOWED)).toContain(e.event);
    expect(
      Object.keys(e.properties).filter(
        (k) => ![...ALLOWED[e.event], ...TRANSPORT].includes(k),
      ),
    ).toEqual([]);
  }
  expect(
    events.find((e) => e.event === "edit_started").properties,
  ).toMatchObject({
    families: ["F1"],
    mode: "browser",
    input_size_bucket: "under 10 MB",
    n_files_bucket: "1",
  });
  expect(
    events.find((e) => e.event === "site_visit").properties.landing_page,
  ).toBe("app");

  // persistence is "memory": PostHog's id is not written to localStorage, sessionStorage or a cookie (review S6).
  const stored = await page.evaluate(() => ({
    keys: [...Object.keys(localStorage), ...Object.keys(sessionStorage)],
    cookie: document.cookie,
  }));
  expect(stored.keys.filter((k) => /^ph_|posthog/i.test(k))).toEqual([]);
  expect(stored.cookie).toBe("");

  // Nothing the person typed, chose or opened is anywhere in what was sent: bodies, URLs, or the files they name.
  const everything =
    requests
      .map((r) => r.url + "\n" + (r.body?.toString("latin1") ?? ""))
      .join("\n") + JSON.stringify(events);
  for (const secret of [
    SECRET_ASK,
    "zebra",
    encodeURIComponent(SECRET_ASK),
    chore.ask,
    "Cut the first",
    "sample",
    chore.file.name,
    ".mp4",
    "/app",
    "ask=",
    "localhost",
  ])
    expect(everything).not.toContain(secret);
  await context.close();
});

test("Do Not Track: PostHog is never loaded and nothing is sent", async ({
  browser,
}) => {
  let requests;
  const { context, page } = await openApp(browser, CHORES.trim.script, {
    analytics: ANALYTICS,
    dnt: true,
    beforeGoto: async (c) => (requests = await stubHost(c)),
  });
  await page.mouse.click(5, 5);
  await page.waitForTimeout(3500);
  expect(requests).toEqual([]);
  await context.close();
});
