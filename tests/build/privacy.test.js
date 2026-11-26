import { expect, test } from "vitest";
import { EVENTS } from "../../app/lib/analytics.js";
import { page } from "./helpers.js";

const doc = page("/privacy");
const $$ = (s) => [...doc.querySelectorAll(s)];
const text = doc.body.textContent;

test("one <h1>, a title of its own and a meta description", () => {
  expect($$("h1")).toHaveLength(1);
  expect(doc.title).toMatch(/privacy/i);
  expect(doc.title.length).toBeLessThanOrEqual(60);
  expect(
    doc.querySelector('meta[name="description"]').content.length,
  ).toBeGreaterThanOrEqual(70);
});

test("every event name and every property key of EVENTS is printed", () => {
  const codes = $$("code").map((c) => c.textContent);
  for (const [event, keys] of Object.entries(EVENTS)) {
    expect(codes).toContain(event);
    for (const k of keys) expect(codes).toContain(k);
  }
});

test('the not-collected list says "never" and names file names', () => {
  const list = doc.querySelector("#never-collected");
  expect(list).not.toBeNull();
  expect(list.textContent).toMatch(/never/i);
  expect(list.textContent).toContain("file names");
  expect(list.querySelectorAll("li").length).toBeGreaterThanOrEqual(4);
});

test("the five-row table of COPY_PAGE section 3 is present", () => {
  const rows = $$(".ledger tbody tr").map((r) =>
    [...r.cells].map((c) => c.textContent),
  );
  expect(rows).toEqual([
    ["Your video", "Stays on this computer"],
    ["The sentence you type", "Stays on this computer"],
    ["File names and folders", "Stays on this computer"],
    ["The model and video tools", "Downloaded once, then kept in your browser"],
    [
      "Visits, finished jobs and which kind of chore",
      "Sent as anonymous counts",
    ],
  ]);
});

test("a how-to-check list; the one placeholder left is the PostHog IP-capture note, kept until analytics is switched on", () => {
  expect($$(".how ol li").length).toBeGreaterThanOrEqual(3);
  expect(text).not.toContain("[contact address]");
  expect(text).not.toContain("[Confirm on the built site");
  expect(text).toContain("github.com/JustJoyful/ffwd-web");
  expect(text).toContain(
    "[Confirm IP capture is off in the PostHog project settings before publishing.]",
  );
});

test("the browser-storage choice and Do Not Track are stated", () => {
  expect(text).toMatch(/random anonymous ID in your browser's local storage/);
  expect(text).toMatch(/ffwd sets no cookies/);
  expect(text).toMatch(/local storage/i); // the remembered graphics-chip description
  expect(text).toMatch(/Do Not Track or Global Privacy Control, ffwd respects it/);
});

test("the feedback section is in the built page: opt-in, what is sent, where it is kept", () => {
  const s = doc.querySelector("#feedback");
  expect(s).not.toBeNull();
  expect(s.querySelector("h2").textContent).toBe("Feedback you choose to send");
  expect(s.textContent).toMatch(/Nothing is sent unless you click Send/);
  expect(s.textContent).toMatch(/Not sent: your video, your file names/);
  expect(s.textContent).toContain(
    "Your request text (not your video) may be used to improve ffwd's model.",
  );
  expect(s.textContent).toContain(
    "Requests I review and copy into the training set (cleaned of anything personal) are kept there.",
  );
  expect(s.textContent).toMatch(/raw feedback is deleted after 90 days/);
  expect(s.textContent).not.toMatch(/kept until the owner deletes it/);
  expect(s.textContent).toMatch(/no IP address, no account and no analytics ID/);
});
