// Helpers shared by the /app end-to-end specs: build a clip with FFmpeg lavfi in the engine harness page, open the
// real /app route with a scripted model, and drop a file onto the window.
import { expect } from "@playwright/test";

export const APP = "http://localhost:4175";
export const HARNESS = "http://localhost:4174/";

/** Build a clip with lavfi inside the harness page and bring its bytes back as base64. Cached per recipe. */
const clips = new Map();
export async function makeClip(browser, recipe) {
  if (clips.has(recipe)) return clips.get(recipe);
  const page = await browser.newPage();
  await page.goto(HARNESS);
  await page.waitForFunction(() => window.ffwdReady);
  const b64 = await page.evaluate(async (recipe) => {
    const rt = window.ffwd.createBrowserRuntime();
    const handle = await window.ffwd.makeInput(rt, recipe);
    const bytes = await rt.readOutput(handle);
    rt.dispose();
    let s = "";
    const u8 = new Uint8Array(await bytes.arrayBuffer());
    for (let i = 0; i < u8.length; i += 0x8000)
      s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, recipe);
  await page.close();
  clips.set(recipe, b64);
  return b64;
}

/** Open /app with a scripted model; collects console errors and every request so the spec can assert on them. */
export async function openApp(
  browser,
  script,
  {
    reducedMotion = "no-preference",
    viewport = { width: 1440, height: 900 },
    path = "/app",
    dnt = false, // the browser sends Do Not Track
    beforeGoto = null, // async (context) => void, e.g. to stub a host before the page can reach it
    analytics = null, // { key, host }: gives the page a fake PostHog key (the e2e server reads it, see app/config.js)
    feedbackUrl = null, // https URL: switches opt-in feedback on (the e2e server reads it, see app/lib/feedback-state.js)
  } = {},
) {
  const context = await browser.newContext({ reducedMotion, viewport });
  const page = await context.newPage();
  const seen = { errors: [], requests: [] };
  page.on("console", (m) => m.type() === "error" && seen.errors.push(m.text()));
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("request", (r) => seen.requests.push(r.url()));
  await page.addInitScript(
    ([script, analytics, dnt, feedbackUrl]) => {
      globalThis.__ffwdScript = script;
      if (feedbackUrl) globalThis.__ffwdFeedbackUrl = feedbackUrl;
      if (dnt) Object.defineProperty(navigator, "doNotTrack", { value: "1" });
      if (analytics) globalThis.__ffwdAnalytics = analytics;
      // Playwright cannot drive the browser's native save dialog, so the download goes through the <a download> path.
      delete globalThis.showSaveFilePicker;
    },
    [script, analytics, dnt, feedbackUrl],
  );
  await beforeGoto?.(context);
  await page.goto(`${APP}${path}`);
  await expect(
    page.getByText(
      "Choose a video or drop one here. It stays on this computer.",
    ),
  ).toBeVisible();
  return { context, page, seen };
}

/** A real drag and drop onto the window: dragenter (the overlay must show), then drop. */
export async function dropClip(page, { name, type }, b64) {
  const fire = ([t]) =>
    window.dispatchEvent(
      Object.assign(new Event(t, { bubbles: true, cancelable: true }), {
        dataTransfer: globalThis.__dt,
      }),
    );
  await page.evaluate(
    ([name, type, b64]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      globalThis.__dt = new DataTransfer();
      globalThis.__dt.items.add(new File([bytes], name, { type }));
    },
    [name, type, b64],
  );
  await page.evaluate(fire, ["dragenter"]);
  await expect(
    page.getByText("Drop to open in ffwd. It stays on this computer."),
  ).toBeVisible();
  await page.evaluate(fire, ["drop"]);
  await expect(page.locator(".drop")).toHaveCount(0);
  // the video is read before the caller types: the request field only submits once the machine is waiting for it
  await expect(page.locator(".probe dd").first()).toBeVisible({
    timeout: 60_000,
  });
}
