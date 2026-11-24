// Real-model smoke test of /app (not part of CI: it needs a GPU and the 444 MB GGUF). It serves the GGUF from
// localhost (CORS + Range), starts the dev server with VITE_MODEL_URL pointing at it, and drives a real Chromium through
// the whole flow with screenshots: choose a video, consent to the download, download, model start, request, plan, run,
// checks, save. Run it under a memory cap:
//   systemd-run --user --scope -p MemoryMax=7G -p MemorySwapMax=0 node scripts/app-smoke.mjs --model <gguf> --out <dir>
// Output: <dir>/NN-step.png and <dir>/smoke.json (timings, console errors, what each step saw). A failing step is
// recorded and the run continues so one problem does not hide the rest. Nothing is uploaded anywhere.
import { chromium, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (k) => process.argv[process.argv.indexOf(`--${k}`) + 1];
const MODEL = resolve(arg("model"));
const OUT = resolve(arg("out"));
const MODEL_PORT = 4600;
const APP_PORT = 4177;
mkdirSync(OUT, { recursive: true });

// 1. the model server: CORS for the app origin, Range, and CORP so credentialless COEP lets it through.
const size = statSync(MODEL).size;
const modelServer = createServer((req, res) => {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers":
      "Content-Range, Accept-Ranges, Content-Length",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Accept-Ranges": "bytes",
    "Content-Type": "application/octet-stream",
  };
  if (req.method === "OPTIONS") return void res.writeHead(204, h).end();
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  const start = m?.[1] ? Number(m[1]) : 0;
  const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (m) {
    res.writeHead(206, {
      ...h,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
  } else res.writeHead(200, { ...h, "Content-Length": size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(MODEL, { start, end }).pipe(res);
});
await new Promise((ok) => modelServer.listen(MODEL_PORT, "127.0.0.1", ok));

// 2. the app: the dev server with the model URL set.
const dev = spawn(
  "pnpm",
  ["exec", "react-router", "dev", "--port", String(APP_PORT), "--strictPort"],
  {
    env: {
      ...process.env,
      VITE_MODEL_URL: `http://localhost:${MODEL_PORT}/model.gguf`,
    },
    stdio: "ignore",
  },
);
const APP = `http://localhost:${APP_PORT}`;
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${APP}/app`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// 3. a small test clip (native ffmpeg: a 6 s video with sound).
const clip = join(mkdtempSync(join(tmpdir(), "ffwd-smoke-")), "smoke-clip.mp4");
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=25:duration=6",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=6",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  clip,
]);

// 4. a real Chromium, same flags and environment rule as the capped spikes (no user-bus variables: Chromium would
// otherwise leave the capped cgroup).
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"].includes(k),
  ),
);
const ctx = await chromium.launchPersistentContext(join(OUT, ".profile"), {
  channel: "chromium",
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
  ],
  env,
  viewport: { width: 1440, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
// Playwright cannot drive the browser's native save dialog, so the download goes through the <a download> path (as in
// tests/e2e/app-driver.js).
await page.addInitScript(() => {
  delete globalThis.showSaveFilePicker;
});
const report = {
  app: APP,
  steps: [],
  consoleErrors: [],
  failedRequests: [],
  started: new Date().toISOString(),
};
page.on(
  "console",
  (m) =>
    m.type() === "error" && report.consoleErrors.push(m.text().slice(0, 300)),
);
page.on("pageerror", (e) =>
  report.consoleErrors.push(`pageerror: ${e.message}`.slice(0, 300)),
);
page.on("requestfailed", (r) =>
  report.failedRequests.push(
    `${r.url().slice(0, 120)} ${r.failure()?.errorText}`,
  ),
);

let n = 0;
async function step(name, fn) {
  const t0 = Date.now();
  const rec = { name, ok: true };
  try {
    rec.detail = (await fn()) ?? null;
  } catch (e) {
    rec.ok = false;
    rec.error = String(e.message ?? e)
      .split("\n")[0]
      .slice(0, 300);
  }
  rec.seconds = (Date.now() - t0) / 1000;
  await page
    .screenshot({
      path: join(
        OUT,
        `${String(++n).padStart(2, "0")}-${name.replace(/\W+/g, "-")}.png`,
      ),
    })
    .catch(() => {});
  report.steps.push(rec);
  console.log(
    `${rec.ok ? "ok  " : "FAIL"} ${name} (${rec.seconds}s)${rec.error ? ` ${rec.error}` : ""}`,
  );
  return rec.ok;
}

await step("open /app", async () => {
  await page.goto(`${APP}/app`);
  await expect(
    page.getByText(
      "Choose a video or drop one here. It stays on this computer.",
    ),
  ).toBeVisible({ timeout: 30000 });
  return {
    crossOriginIsolated: await page.evaluate(() => self.crossOriginIsolated),
    webgpu: await page.evaluate(() => Boolean(navigator.gpu)),
  };
});
await step("choose a video", async () => {
  await page.locator('input[type="file"]').setInputFiles(clip);
  await expect(page.getByText("smoke-clip.mp4").first()).toBeVisible({
    timeout: 60000,
  });
  return {
    modelNotice: (
      await page
        .locator(".modelzone")
        .innerText()
        .catch(() => "")
    ).slice(0, 300),
  };
});
await step("model asks before downloading", async () => {
  await expect(page.getByText(/downloaded once/i)).toBeVisible({
    timeout: 30000,
  });
});
await step("consent and download starts", async () => {
  await page.getByRole("button", { name: "Download model" }).click();
  // From localhost the 444 MB can arrive in a few seconds, so the bar may already be gone: record what was seen.
  const bar = await page
    .getByRole("progressbar")
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  return { sawProgressBar: bar };
});
await step("model downloaded, checked and started", async () => {
  const t0 = Date.now();
  await expect(page.getByRole("progressbar")).toHaveCount(0, {
    timeout: 600000,
  });
  await expect(
    page.getByText("The model runs on your graphics chip."),
  ).toBeVisible({ timeout: 600000 });
  return { loadSeconds: (Date.now() - t0) / 1000 };
});
await step("type a request and make a plan", async () => {
  const field = page.getByLabel("What should happen to your video?");
  await field.fill("Cut the first 2 seconds off");
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByRole("button", { name: "Run it" })).toBeVisible({
    timeout: 180000,
  });
  return {
    plan: (
      await page
        .locator(".plan")
        .first()
        .innerText()
        .catch(() => "")
    ).slice(0, 400),
  };
});
await step("run it", async () => {
  await page.getByRole("button", { name: "Run it" }).click();
  await Promise.race([
    expect(page.getByText("Done, every check passed")).toBeVisible({
      timeout: 300000,
    }),
    expect(
      page.getByText(/Nothing to download|stopped|too long/i).first(),
    ).toBeVisible({ timeout: 300000 }),
  ]);
  return {
    done: await page
      .getByText("Done, every check passed")
      .isVisible()
      .catch(() => false),
  };
});
await step("save", async () => {
  const b = page.getByRole("button", { name: "Download" });
  if (await b.count()) {
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      b.first().click(),
    ]);
    return { file: dl.suggestedFilename() };
  }
  return { note: "no Download button (the job did not finish)" };
});

report.finished = new Date().toISOString();
report.allOk = report.steps.every((s) => s.ok);
writeFileSync(join(OUT, "smoke.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  report.allOk ? "SMOKE PASSED" : "SMOKE HAD FAILURES: see smoke.json",
);
await ctx.close().catch(() => {});
dev.kill("SIGTERM");
modelServer.close();
process.exit(report.allOk ? 0 : 1);
