// The four guards of the plan/run flow, with the scripted model and real ffmpeg.wasm: a plan that changes nothing, a
// command that does not match the plan (not run, fed back), an FFmpeg failure in plain words, and a failed job that
// still has a file (Download anyway, never a success).
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dropClip, makeClip, openApp } from "./app-driver.js";

test.describe.configure({ mode: "serial" });

const act = (a) => JSON.stringify(a);
const spec = (output) =>
  act({
    action: "spec",
    spec: {
      family: ["F1"],
      outputs: [{ id: "out1", kind: "video", ...output }],
    },
  });
const run = (...args) =>
  act({ action: "run", args, inputs: ["clip"], outputs: ["out1"] });
const X264 = ["-c:v", "libx264", "-preset", "ultrafast"];
const FILE = { name: "sample.mp4", type: "video/mp4" };

async function ask(page, text) {
  const field = page.getByLabel("What should happen to your video?");
  await field.fill(text);
  await field.press("Enter");
}
async function start(browser, script, text) {
  const b64 = await makeClip(browser, "e2e_sample");
  const app = await openApp(browser, script);
  await dropClip(app.page, FILE, b64);
  await ask(app.page, text);
  return app;
}

test("a plan that changes nothing warns, offers Reword, and Run anyway needs a second click", async ({
  browser,
}) => {
  const { context, page } = await start(
    browser,
    [spec({}), run("-i", "{in:clip}", ...X264, "-c:a", "aac", "{out:out1}")],
    "Do something",
  );
  await expect(page.getByRole("alert")).toHaveText(
    "This plan doesn't change anything. Reword your request?",
  );
  await expect(page.getByRole("button", { name: "Run it" })).toHaveCount(0);
  const reword = page.getByRole("button", { name: "Reword my request" });
  await expect(reword).toBeFocused();
  await expect(page.getByLabel("Keeps")).toContainText("Picture");
  await page.getByRole("button", { name: "Run anyway" }).click();
  const yes = page.getByRole("button", { name: "Yes, run it anyway" });
  await expect(yes).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });
  await context.close();
});

test("a command that does not match the plan is not run, and the corrected one is", async ({
  browser,
}) => {
  const { context, page } = await start(
    browser,
    [
      spec({ container: "mp4", video: { width: 720, height: 1280 } }),
      // landscape: the plan says portrait
      run("-i", "{in:clip}", "-vf", "scale=1280:720", ...X264, "{out:out1}"),
      run(
        "-i",
        "{in:clip}",
        "-vf",
        "crop=405:720,scale=720:1280",
        ...X264,
        "-c:a",
        "aac",
        "{out:out1}",
      ),
    ],
    "Make it portrait",
  );
  await page.getByRole("button", { name: "Run it" }).click();
  await expect(page.getByText("Done, every check passed")).toBeVisible({
    timeout: 180_000,
  });
  // only the corrected command ran: one run on screen, none "trying again"
  await expect(page.locator(".run")).toHaveCount(1);
  await expect(page.getByText("trying again")).toHaveCount(0);
  await context.close();
});

test("an FFmpeg failure is said in plain words, with no exit code, path or log", async ({
  browser,
}) => {
  const bad = run("-i", "{in:clip}", "-vf", "scale=abc:def", "{out:out1}");
  const { context, page } = await start(
    browser,
    [spec({}), bad, bad, bad, bad],
    "Do something",
  );
  await page.getByRole("button", { name: "Run anyway" }).click();
  await page.getByRole("button", { name: "Yes, run it anyway" }).click();
  const problem = page.locator(".run__problem").first();
  await expect(problem).toBeVisible({ timeout: 180_000 });
  await expect(problem).toHaveText(/\.$/);
  await expect(problem).not.toContainText(
    /exit|code \d|\/|\\|\{in:|sample\.mp4/i,
  );
  await expect(
    page.getByText("Nothing to download", { exact: true }),
  ).toBeVisible({
    timeout: 180_000,
  });
  await context.close();
});

test("every run fails its checks but a file exists: Download anyway, never success", async ({
  browser,
}, testInfo) => {
  const big = run(
    "-i",
    "{in:clip}",
    ...X264,
    "-crf",
    "23",
    "-c:a",
    "aac",
    "{out:out1}",
  );
  const { context, page } = await start(
    browser,
    [spec({ container: "mp4", size_max_bytes: 50_000 }), big, big, big, big],
    "Make it tiny",
  );
  await page.getByRole("button", { name: "Run it" }).click();
  await expect(
    page.getByText("This result doesn’t match the plan"),
  ).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".notice--bad li").first()).toContainText(/Size/);
  await expect(page.getByText(/Done|every check passed/)).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-state", "failed");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download anyway" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("sample-ffwd-unchecked.mp4");
  const path = testInfo.outputPath("unchecked.mp4");
  await download.saveAs(path);
  expect(readFileSync(path).subarray(4, 8).toString("latin1")).toBe("ftyp");
  await context.close();
});
