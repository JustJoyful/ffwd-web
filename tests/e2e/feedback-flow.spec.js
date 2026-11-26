// Opt-in feedback on the real /app route: the three quiet links, nothing opens by itself, Send posts exactly the previewed
// JSON (with the note), "No thanks" hides every link for the session (it survives a reload), and with no feedback URL nothing
// renders. Scripted model, real ffmpeg.wasm and checker; the feedback URL is injected like the analytics key
// (app/lib/feedback-state.js) and its requests are intercepted, so nothing leaves the machine.
import { expect, test } from "@playwright/test";
import { dropClip, makeClip, openApp } from "./app-driver.js";
import { CHORES } from "./scripts.js";

test.describe.configure({ mode: "serial" });

const FB = "https://feedback.test/in";
const chore = CHORES.trim;
const PANEL = "Help improve ffwd?";

/** Answers the feedback URL (and its CORS preflight) with 204 and records every real POST. */
async function interceptFeedback(page) {
  const posts = [];
  await page.route(FB, (route) => {
    const r = route.request();
    if (r.method() === "POST") posts.push(r);
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST",
      },
    });
  });
  return posts;
}

async function toPlan(page, b64) {
  await dropClip(page, chore.file, b64);
  const field = page.getByLabel("What should happen to your video?");
  await expect(field).toBeFocused();
  await field.fill(chore.ask);
  await field.press("Enter");
  await expect(page.getByRole("button", { name: "Run it" })).toBeFocused();
}

test("the links open only on a click; Send posts the previewed JSON with the note; No thanks hides everything, also after a reload", async ({
  browser,
}) => {
  const b64 = await makeClip(browser, chore.recipe);
  const { context, page } = await openApp(browser, chore.script, {
    feedbackUrl: FB,
  });
  const posts = await interceptFeedback(page);
  await toPlan(page, b64);

  // 1. The plan card: a quiet link beside Run it and Change; the panel is closed.
  const row = page.locator(".plan__actions");
  const notMine = row.getByRole("button", { name: "Not what I meant" });
  await expect(notMine).toBeVisible();
  await expect(page.getByText(PANEL)).toHaveCount(0);
  expect(posts).toHaveLength(0);

  // 2. A click opens it (focus on its heading); the exact JSON is shown, the note is part of it.
  await notMine.click();
  await expect(page.getByText(PANEL)).toBeFocused();
  await page
    .getByLabel("What did you expect? (optional)")
    .fill("keep the sound");
  await page.getByText("What gets sent").click();
  const previewed = JSON.parse(
    await page.locator("[data-feedback-payload]").textContent(),
  );
  expect(Object.keys(previewed)).toEqual([
    "kind",
    "request",
    "note",
    "plan",
    "failure",
    "app_version",
    "model_version",
  ]);
  expect(previewed).toMatchObject({
    kind: "plan_wrong",
    request: chore.ask,
    note: "keep the sound",
  });

  // 3. Send: the body equals what was shown. The links for this job go away.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Thanks. Sent.")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].postDataJSON()).toEqual(previewed);
  await expect(
    row.getByRole("button", { name: "Not what I meant" }),
  ).toHaveCount(0);

  // 4. A clean trim ends in Done: the new job shows "Not what you asked?" beside the command toggle, closed.
  await page.getByRole("button", { name: "Run it" }).click();
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });
  const wrong = page.getByRole("button", { name: "Not what you asked?" });
  await expect(wrong).toBeVisible();
  await expect(
    page
      .locator(".reveal-cmd__row")
      .getByRole("button", { name: "Show the FFmpeg command" }),
  ).toBeVisible();
  await expect(
    page.locator(".save").getByRole("button", { name: "Not what you asked?" }),
  ).toHaveCount(0);
  await expect(page.getByText(PANEL)).toHaveCount(0);
  expect(posts).toHaveLength(1);

  // 5. It opens as result_wrong; "No thanks" sends nothing and hides every link.
  await wrong.click();
  await expect(page.getByText(PANEL)).toBeFocused();
  await expect(page.locator("[data-feedback-payload]")).toContainText(
    '"kind": "result_wrong"',
  );
  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(page.getByText(PANEL)).toHaveCount(0);
  await expect(wrong).toHaveCount(0);
  expect(posts).toHaveLength(1);

  // 6. A reload in the same session: still no link anywhere (plan card included).
  await page.reload();
  await expect(
    page.getByText(
      "Choose a video or drop one here. It stays on this computer.",
    ),
  ).toBeVisible();
  await toPlan(page, b64);
  await expect(
    page.getByRole("button", { name: "Not what I meant" }),
  ).toHaveCount(0);
  await expect(page.getByText(PANEL)).toHaveCount(0);
  expect(posts).toHaveLength(1);
  await context.close();
});

test("with no feedback URL nothing renders and nothing is requested", async ({
  browser,
}) => {
  const b64 = await makeClip(browser, chore.recipe);
  const { context, page, seen } = await openApp(browser, chore.script);
  await toPlan(page, b64);
  await expect(
    page.getByRole("button", { name: "Not what I meant" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Run it" }).click();
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });
  await expect(
    page.getByRole("button", { name: "Not what you asked?" }),
  ).toHaveCount(0);
  await expect(page.getByText(PANEL)).toHaveCount(0);
  // the lazy panel was never even fetched (feedback-state.js is the small always-loaded part), and nothing went to the endpoint
  expect(
    seen.requests.filter((u) => /FeedbackPrompt|feedback\.test/.test(u)),
  ).toEqual([]);
  await context.close();
});
