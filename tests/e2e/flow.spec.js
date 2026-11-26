// The real /app route, end to end: choose or drop a video, see it probed, type the chore, read the plan, Run it,
// watch the checks land, download the file, see the command. The model is a scripted policy (no WebGPU in headless
// Chromium); everything else is real: React, the agent machine, ffmpeg.wasm and the checker. Fixtures are made with
// FFmpeg lavfi in the engine harness page; no corpus clip is used.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { APP, dropClip, makeClip, openApp } from "./app-driver.js";
import { CHORES, UNSUPPORTED_SCRIPT } from "./scripts.js";

test.describe.configure({ mode: "serial" });

/** Nothing sticks out sideways: the page does not scroll and no element of the window passes the right edge. */
async function expectNoOverflow(page) {
  const over = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll(".win *")]
      .filter(
        (e) =>
          !e.closest(".sr, .intake__input") &&
          e.getBoundingClientRect().width > 0,
      )
      .filter((e) => e.getBoundingClientRect().right > w + 1)
      .map((e) => e.className || e.tagName);
    return { scroll: document.documentElement.scrollWidth - w, out };
  });
  expect(over).toEqual({ scroll: expect.any(Number), out: [] });
  expect(over.scroll).toBeLessThanOrEqual(0);
}

const checkRows = (page) => page.locator(".run .ck");

for (const [id, chore, opts] of [
  ["trim", CHORES.trim, {}],
  ["size", CHORES.size, {}],
  ["vertical", CHORES.vertical, {}],
  ["audio", CHORES.audio, {}],
  // The iPhone chore also runs with reduced motion, in a phone-width window.
  [
    "iphone",
    CHORES.iphone,
    { reducedMotion: "reduce", viewport: { width: 390, height: 844 } },
  ],
]) {
  test(`chore ${id}: drop, ask, plan, run, every check passes, download, command`, async ({
    browser,
  }, testInfo) => {
    const b64 = await makeClip(browser, chore.recipe);
    const { context, page, seen } = await openApp(browser, chore.script, opts);
    const narrow = opts.viewport?.width === 390;

    // 1. Drop the clip. It is probed and read back in plain words.
    await dropClip(page, chore.file, b64);
    await expect(page.locator(".readout__file b")).toHaveText(chore.file.name);
    await expect(page.locator(".probe dd")).toHaveText([
      "0:04",
      "1280 × 720",
      /^(MOV|MP4), H\.264$/,
      "AAC",
    ]);

    // 2. Ask. The request field has the focus; Enter makes the plan.
    const field = page.getByLabel("What should happen to your video?");
    await expect(field).toBeFocused();
    await field.fill(chore.ask);
    await field.press("Enter");

    // 3. The plan reads in chips, the focus is on "Run it".
    const runIt = page.getByRole("button", { name: "Run it" });
    await expect(runIt).toBeFocused();
    for (const [label, value] of chore.chips)
      await expect(
        page.locator(".plan .chip", { hasText: label }),
      ).toContainText(value);
    if (narrow) await expectNoOverflow(page);

    // 4. Run it. Every check of every run lands; the last run passes.
    await runIt.press("Enter");
    await expect(page.getByText("Done, every check passed")).toBeVisible({
      timeout: 180_000,
    });
    await expect(page.locator(".run")).toHaveCount(chore.runs);
    await expect(
      page.locator(".run").last().getByRole("img", { name: "failed" }),
    ).toHaveCount(0);
    expect(
      await page
        .locator(".run")
        .last()
        .getByRole("img", { name: "passed" })
        .count(),
    ).toBeGreaterThan(1);
    if (id === "size") {
      // run 1 failed on size and stays on screen above its retry
      const first = page.locator(".run").first();
      await expect(first.getByRole("img", { name: "failed" })).toHaveCount(1);
      await expect(first.locator(".ck.is-fail")).toContainText(
        /Size.*over your 1\.5 MB limit/s,
      );
      await expect(
        page.locator(".run").last().locator(".ck", { hasText: "Size" }),
      ).toContainText(/\d(\.\d)? (KB|MB)/);
      const y = (loc) => loc.evaluate((e) => e.getBoundingClientRect().top);
      expect(await y(first)).toBeLessThan(await y(page.locator(".run").last()));
    }
    // each check row is visible in its end state, motion or not
    for (const row of await checkRows(page).all())
      await expect(row).toHaveCSS("opacity", "1");
    if (opts.reducedMotion === "reduce")
      expect(
        await page
          .locator(".run .ck .ico path")
          .first()
          .evaluate((e) => getComputedStyle(e).animationName),
      ).toBe("none");

    // 5. Download: a real mp4 with the expected name.
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(chore.download);
    const path = testInfo.outputPath(chore.download);
    await download.saveAs(path);
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
    await expect(
      page.getByRole("button", { name: /^Download(ed| started)$/ }),
    ).toBeVisible();

    // 6. The command is closed until asked for, shows real file names and the flags the script used; Escape closes it.
    const toggle = page.getByRole("button", {
      name: "Show the FFmpeg command",
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const cmd = page.locator(".cmd");
    await expect(cmd).toContainText(`ffmpeg`);
    await expect(cmd).toContainText(chore.file.name);
    await expect(cmd).not.toContainText("{in:");
    await expect(cmd).toContainText(chore.flags.join(" "));
    await page.locator(".chips--link .chip").first().focus();
    await page.keyboard.press("Escape");
    await expect(cmd).toHaveCount(0);

    // The page held together: no horizontal overflow, nothing in the console, and not one request left this origin.
    await expectNoOverflow(page);
    expect(seen.errors).toEqual([]);
    const foreign = seen.requests.filter(
      (u) => !u.startsWith(APP) && !/^(blob|data):/.test(u),
    );
    expect(foreign).toEqual([]);
    await context.close();
  });
}

test("Tab reaches every control in reading order, each with a visible 2 px focus ring", async ({
  browser,
}) => {
  const b64 = await makeClip(browser, "e2e_sample");
  const { context, page } = await openApp(browser, CHORES.trim.script);
  await dropClip(page, CHORES.trim.file, b64);
  const field = page.getByLabel("What should happen to your video?");
  await field.fill(CHORES.trim.ask);
  await field.press("Enter");
  await expect(page.getByRole("button", { name: "Run it" })).toBeFocused();

  // Start from the top of the page and Tab through the whole window, recording each stop.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  const stops = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const e = document.activeElement;
        // the file input is hidden; its label (the visible button) carries the ring
        const ringed = e.matches(".intake__input") ? e.labels[0] : e;
        const c = getComputedStyle(ringed);
        return {
          name: (
            e.getAttribute("aria-label") ||
            e.labels?.[0]?.textContent ||
            e.textContent
          ).trim(),
          ring: c.outlineStyle === "solid" ? parseFloat(c.outlineWidth) : 0,
          tag: e.tagName,
        };
      }),
    );
  }
  const names = stops.map((s) => s.name);
  const at = (n) => names.indexOf(n);
  for (const want of [
    "ffwd, home",
    "What should happen to your video?",
    "Run it",
    "Change",
  ])
    expect(names, `Tab never reached "${want}"`).toContain(want);
  // reading order: top bar, request, plan. ("Choose another video" is off while a plan waits for the answer.)
  expect([
    at("ffwd, home"),
    at("What should happen to your video?"),
    at("Run it"),
    at("Change"),
  ]).toEqual(
    [
      at("ffwd, home"),
      at("What should happen to your video?"),
      at("Run it"),
      at("Change"),
    ].toSorted((a, b) => a - b),
  );
  // every stop that is not the browser's own video player shows a 2 px ring
  for (const s of stops.filter(
    (s) => !["VIDEO", "BODY", "HTML"].includes(s.tag),
  ))
    expect(s.ring, s.name).toBeGreaterThanOrEqual(2);
  await context.close();
});

test("a file that isn't a video is refused in words; a broken video can't be read; the tool stays usable", async ({
  browser,
}) => {
  const { context, page } = await openApp(browser, CHORES.trim.script);
  await page.setInputFiles("input[type=file]", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.locator(".intake__note")).toHaveText(
    /isn't a video ffwd can open/,
  );
  await page.setInputFiles("input[type=file]", {
    name: "empty.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(0),
  });
  await expect(page.locator(".intake__note")).toHaveText(/file is empty/);
  // looks like a video, is not one
  await page.setInputFiles("input[type=file]", {
    name: "broken.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("this is not an mp4 file at all".repeat(40)),
  });
  await expect(page.getByRole("alert")).toContainText(
    "This video can't be read. It may be damaged or in a format ffwd doesn't support. Try another file.",
    { timeout: 60_000 },
  );
  await expect(
    page.getByRole("button", { name: "Make a plan" }),
  ).toBeDisabled();
  // and a good video still works afterwards
  const b64 = await makeClip(browser, "e2e_sample");
  await dropClip(page, CHORES.trim.file, b64);
  await expect(page.locator(".probe dd").first()).toHaveText("0:04");
  await context.close();
});

test("a request the model can't do is shown plainly, with a way to try again", async ({
  browser,
}) => {
  const b64 = await makeClip(browser, "e2e_sample");
  const { context, page } = await openApp(browser, UNSUPPORTED_SCRIPT);
  await dropClip(page, CHORES.trim.file, b64);
  const field = page.getByLabel("What should happen to your video?");
  await field.fill("Add subtitles");
  await field.press("Enter");
  await expect(page.getByText("ffwd can't do this one yet")).toBeVisible();
  await expect(page.getByText(/can't add subtitles yet/)).toBeVisible();
  await page.getByRole("button", { name: "Try another request" }).click();
  await expect(
    page.getByLabel("What should happen to your video?"),
  ).toBeFocused();
  await context.close();
});

test("a drop while a job is running changes nothing and says why", async ({
  browser,
}) => {
  const b64 = await makeClip(browser, "e2e_sample");
  const { context, page } = await openApp(browser, CHORES.size.script);
  await dropClip(page, CHORES.size.file, b64);
  const field = page.getByLabel("What should happen to your video?");
  await field.fill(CHORES.size.ask);
  await field.press("Enter");
  const runIt = page.getByRole("button", { name: "Run it" });
  await expect(runIt).toBeVisible();
  const dropOther = () =>
    page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "other.mp4", { type: "video/mp4" }));
      window.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: dt,
        }),
      );
    });
  const refused = async () => {
    await expect(page.locator(".intake__note")).toHaveText(
      /working on a video right now/,
    );
    await expect(page.locator(".readout__file b")).toHaveText("sample.mp4");
  };
  // while the plan waits for the answer, then straight after Run it (the run itself takes seconds)
  await dropOther();
  await refused();
  await runIt.click();
  await dropOther();
  await refused();
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });
  await context.close();
});

test("pictures: the frames of a clip are saved as one zip that unzips to real PNGs", async ({
  browser,
}, testInfo) => {
  const chore = CHORES.frames;
  const b64 = await makeClip(browser, chore.recipe);
  const { context, page } = await openApp(browser, chore.script, {});
  await dropClip(page, chore.file, b64);
  const field = page.getByLabel("What should happen to your video?");
  await field.fill(chore.ask);
  await field.press("Enter");
  await page.getByRole("button", { name: "Run it" }).click();
  // Done only with a file the person can get: the zip of the pictures
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });
  const button = page.getByRole("button", {
    name: "Download pictures (.zip)",
  });
  await expect(button).toBeEnabled();
  const downloading = page.waitForEvent("download");
  await button.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(chore.download);
  const path = testInfo.outputPath(chore.download);
  await download.saveAs(path);
  // checked with the system's own unzip, not our reader: the archive is sound and holds 4 PNGs
  expect(execFileSync("unzip", ["-tq", path], { encoding: "utf8" })).toMatch(
    /No errors detected/,
  );
  const names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
    .trim()
    .split("\n");
  expect(names).toEqual(["0001.png", "0002.png", "0003.png", "0004.png"]);
  const first = execFileSync("unzip", ["-p", path, "0001.png"]);
  expect([...first.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await context.close();
});
