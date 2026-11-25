// The real feedback sender in a real browser (the harness page; the React panel itself is covered by jsdom unit tests
// because mounting it on /app needs app.jsx). The request body must equal the payload the person was shown, with no
// cookies and no referrer; with no URL (the build has no VITE_FEEDBACK_URL) no request is made at all.
import { expect, test } from "@playwright/test";

const URL = "https://feedback.test/in";
const args = {
  requestText: "trim holiday.mp4 to 10 s",
  spec: {
    family: ["F1"],
    outputs: [
      {
        id: "o",
        kind: "video",
        container: "mp4",
        time: { start_s: 0, end_s: 10 },
      },
    ],
  },
  failureCategory: "checks_failed",
  kind: "failed_job",
  fileName: "holiday.mp4",
};

test("sends exactly the previewed payload, no credentials, no referrer", async ({
  page,
}) => {
  await page.goto("http://localhost:4174/");
  await page.waitForFunction(() => window.ffwdReady);
  const seen = [];
  await page.route(URL, (route) => {
    seen.push(route.request());
    return route.fulfill({
      status: 204,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  const previewed = await page.evaluate(
    (a) => window.ffwd.feedback.buildFeedback(a),
    args,
  );
  const r = await page.evaluate(
    ([a, u]) =>
      window.ffwd.feedback.sendFeedback(
        window.ffwd.feedback.buildFeedback(a),
        u,
      ),
    [args, URL],
  );
  expect(r.ok).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0].postDataJSON()).toEqual(previewed);
  expect(previewed.request).toBe("trim {file} to 10 s");
  const h = await seen[0].allHeaders();
  expect(h.cookie).toBeUndefined();
  expect(h.referer).toBeUndefined();
});

test("with no URL nothing is sent", async ({ page }) => {
  await page.goto("http://localhost:4174/");
  await page.waitForFunction(() => window.ffwdReady);
  const reqs = [];
  page.on("request", (q) => reqs.push(q.url()));
  const r = await page.evaluate(
    (a) =>
      window.ffwd.feedback.sendFeedback(window.ffwd.feedback.buildFeedback(a)),
    args,
  );
  expect(r).toEqual({ ok: false, off: true });
  expect(reqs.filter((u) => !u.startsWith("http://localhost"))).toEqual([]);
  expect(reqs.some((u) => u.includes("feedback"))).toBe(false);
});
