// Real-model smoke test of /app (not part of CI: it needs a GPU and the 444 MB GGUF). It serves the GGUF from
// localhost (CORS + Range), starts the dev server with VITE_MODEL_URL pointing at it, and drives a real Chromium through
// the whole flow with screenshots: choose a video, consent to the download, download, model start (on a first visit the
// WebGPU canary and speed test, see app/model/canary.js), request, plan, run, checks, save, then a second visit that must
// use the remembered verdict. Run it under a memory cap (it refuses to start without one):
//   systemd-run --user --scope -p MemoryMax=5G -p MemorySwapMax=0 node scripts/app-smoke.mjs --model <gguf> --out <dir>
// Variants of the computer it pretends to be (--variant), each asserted on the real adapter the page sees:
//   nvidia  (default) the default adapter, which on this machine is the NVIDIA card: the canary must PASS
//   intel   --vk-icd <intel_icd.json>: only the Intel Vulkan driver is visible; the adapter must be Intel and the canary
//           must FAIL, so the app runs on the processor and the job still finishes
//   cpu     no GPU flags: no usable adapter; the canary is skipped, the processor path is used with a measured wait
// Output: <dir>/smoke.json (timings, console errors, what each step saw, the adapter, the stored verdict) and screenshots
// (--shots all|key|none, default all). A failing step is recorded and the run continues so one problem does not hide
// the rest. A low-memory watchdog stops the run when available RAM drops under 2 GB. Nothing is uploaded anywhere.
import { chromium, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// the capped launcher's own checks (the same ones the wllama spike runner uses): no cap, no browser
import { assertCapped, assertContained } from "../spikes/wllama/run.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const MODEL = resolve(arg("model"));
const OUT = resolve(arg("out"));
const VARIANT = arg("variant", "nvidia");
const VK_ICD = arg("vk-icd");
const SHOTS = arg("shots", "all");
if (!["nvidia", "intel", "cpu"].includes(VARIANT))
  throw new Error(`--variant must be nvidia, intel or cpu, not ${VARIANT}`);
if (VARIANT === "intel" && !VK_ICD)
  throw new Error("--variant intel needs --vk-icd <the Intel Vulkan ICD json>");
const cap = assertCapped(); // before anything is started
const MODEL_PORT = 4600;
const APP_PORT = 4177;
mkdirSync(OUT, { recursive: true });
// The browser profile (about 450 MB of cached model) lives in the repo's ignored test-results, never in the report.
const PROFILE = resolve("test-results", `smoke-profile-${VARIANT}`);
rmSync(PROFILE, { recursive: true, force: true });
const availMib = () =>
  Number(
    /MemAvailable:\s*(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))[1],
  ) / 1024;
const MIN_AVAIL_MIB = 2000;
if (availMib() < MIN_AVAIL_MIB + 500)
  throw new Error(`only ${Math.round(availMib())} MiB available: not starting`);

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
// intel: the ONLY Vulkan driver Chromium can see is the Intel one (as eval/browser_parity.py does); cpu: no GPU flags
if (VARIANT === "intel") {
  env.VK_ICD_FILENAMES = resolve(VK_ICD);
  env.VK_DRIVER_FILES = resolve(VK_ICD);
}
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium",
  headless: true,
  args:
    VARIANT === "cpu"
      ? []
      : [
          "--enable-unsafe-webgpu",
          "--enable-features=Vulkan",
          "--use-angle=vulkan",
        ],
  env,
  viewport: { width: 1280, height: 800 },
});
const contained = assertContained(); // every browser process is inside the capped cgroup
const page = ctx.pages()[0] ?? (await ctx.newPage());
// Playwright cannot drive the browser's native save dialog, so the download goes through the <a download> path (as in
// tests/e2e/app-driver.js).
await page.addInitScript(() => {
  delete globalThis.showSaveFilePicker;
  // main-thread heartbeat: the longest gap between two 50 ms ticks says whether the page ever froze (the first-visit
  // check must not freeze it, or the "this takes a while" notice could not even be drawn)
  let last = performance.now();
  globalThis.__hb = { maxGapMs: 0, ticks: 0 };
  // what the first-check notice said and when, recorded IN the page: during a WebGPU check the browser's remote-control
  // channel can stall for seconds (measured), so polling from outside would miss a notice the person did see
  globalThis.__check = [];
  new MutationObserver(() => {
    const el = document.querySelector("[data-check]");
    const step = el?.getAttribute("data-check") ?? null;
    if (step && globalThis.__check.at(-1)?.step !== step)
      globalThis.__check.push({
        step,
        at: new Date().toISOString(),
        text: el.innerText.slice(0, 300),
      });
  }).observe(document, { subtree: true, childList: true, attributes: true });
  setInterval(() => {
    const n = performance.now();
    globalThis.__hb.maxGapMs = Math.max(globalThis.__hb.maxGapMs, n - last);
    globalThis.__hb.ticks += 1;
    last = n;
  }, 50);
});
const report = {
  app: APP,
  variant: VARIANT,
  memoryCap: { ...cap, contained },
  steps: [],
  consoleErrors: [],
  failedRequests: [],
  started: new Date().toISOString(),
};
// Low-memory watchdog: below the floor the run is stopped and written up, never pushed on.
report.minAvailMib = Math.round(availMib());
const watchdog = setInterval(async () => {
  const a = availMib();
  report.minAvailMib = Math.min(report.minAvailMib, Math.round(a));
  if (a < MIN_AVAIL_MIB) {
    report.aborted = `available memory fell to ${Math.round(a)} MiB (floor ${MIN_AVAIL_MIB})`;
    writeFileSync(
      join(OUT, "smoke.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.error(`ABORT: ${report.aborted}`);
    await ctx.close().catch(() => {});
    dev.kill("SIGTERM");
    process.exit(3);
  }
}, 3000);
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
async function step(name, fn, key = false) {
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
  n += 1;
  if (SHOTS === "all" || (SHOTS === "key" && key))
    await page
      .screenshot({
        path: join(
          OUT,
          `${String(n).padStart(2, "0")}-${name.replace(/\W+/g, "-")}.png`,
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
// What the page itself sees as its WebGPU adapter. A run on the wrong adapter is discarded, never reported as a result.
const adapterInfo = await page.evaluate(async () => {
  if (!navigator.gpu) return { gpu: false, adapter: null };
  const a = await navigator.gpu.requestAdapter().catch(() => null);
  if (!a) return { gpu: true, adapter: null };
  const i = a.info ?? {};
  return {
    gpu: true,
    adapter: {
      vendor: i.vendor,
      architecture: i.architecture,
      description: i.description,
      isFallbackAdapter: i.isFallbackAdapter ?? a.isFallbackAdapter ?? null,
    },
  };
});
report.adapter = adapterInfo;
{
  const a = adapterInfo.adapter;
  const software = /swiftshader|llvmpipe|lavapipe|software/i.test(
    `${a?.vendor} ${a?.architecture} ${a?.description}`,
  );
  const wrong =
    VARIANT === "cpu"
      ? a && !a.isFallbackAdapter && !software
        ? "a real adapter is visible, so this is not a computer without one"
        : null
      : !a || a.isFallbackAdapter || software
        ? "no real WebGPU adapter"
        : !String(a.vendor)
              .toLowerCase()
              .includes(VARIANT === "intel" ? "intel" : "nvidia")
          ? `adapter vendor is ${a.vendor}, expected ${VARIANT}`
          : null;
  if (wrong) {
    report.aborted = `adapter assertion failed (${VARIANT}): ${wrong}`;
    writeFileSync(
      join(OUT, "smoke.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.error(`DISCARDED: ${report.aborted}`);
    await ctx.close().catch(() => {});
    dev.kill("SIGTERM");
    process.exit(2);
  }
}
console.log("adapter:", JSON.stringify(adapterInfo.adapter));

/** Poll the page for a selector from now on: whether it ever appeared, when, and what it said. */
const watchFor = (selector) => {
  const r = {
    seen: false,
    firstAt: null,
    text: null,
    zone: [],
    samples: 0,
    maxGapMs: 0,
  };
  let last = Date.now();
  const t = setInterval(async () => {
    try {
      // one in-page read (no auto-waiting): what the model area says now, and whether the selector matches
      const x = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return {
          zone: (document.querySelector(".modelzone")?.innerText ?? "").slice(
            0,
            160,
          ),
          hit: el ? el.innerText.slice(0, 400) : null,
        };
      }, selector);
      r.samples += 1;
      r.maxGapMs = Math.max(r.maxGapMs, Date.now() - last);
      last = Date.now();
      // each time the model area changed: evidence of what the person saw while waiting
      if (x.zone !== r.zone.at(-1)?.text)
        r.zone.push({ at: new Date().toISOString(), text: x.zone });
      if (!r.seen && x.hit !== null) {
        r.seen = true;
        r.firstAt = new Date().toISOString();
        r.text = x.hit;
      }
    } catch {
      /* the page is navigating */
    }
  }, 300);
  return { r, stop: () => clearInterval(t) };
};
const verdictFromStorage = () =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("ffwd:path:"))
        .map((k) => [k, JSON.parse(localStorage.getItem(k))]),
    ),
  );
/**
 * The model is ready when no progress bar and no check notice is left and the path notice shows a MEASURED wait (before
 * the model starts the notice shows the capability guess, with no measurement behind it).
 */
const waitReady = async (timeout) => {
  try {
    await expect(page.getByRole("progressbar")).toHaveCount(0, { timeout });
    await expect(page.locator("[data-check]")).toHaveCount(0, { timeout });
    await expect(page.locator('[data-wait="measured"]').first()).toBeVisible({
      timeout,
    });
  } catch (e) {
    // say what the person would be looking at, not just that a wait ran out
    const zone = await page
      .locator(".modelzone")
      .innerText({ timeout: 2000 })
      .catch(() => "(no model area)");
    throw new Error(
      `model not ready in ${timeout} ms; the model area says: ${zone.replace(/\s+/g, " ")}`,
      { cause: e },
    );
  }
};
const pathNotice = async () => ({
  path: await page.locator("[data-path]").first().getAttribute("data-path"),
  wait: await page.locator("[data-wait]").first().getAttribute("data-wait"),
  text: (await page.locator(".modelzone").innerText()).slice(0, 700),
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
let firstVisit = null;
await step(
  "model downloaded, checked and started",
  async () => {
    const t0 = Date.now();
    const check = watchFor("[data-check]");
    try {
      await waitReady(VARIANT === "intel" ? 1_200_000 : 300_000); // an Intel first check can take minutes
    } finally {
      check.stop();
    }
    const notice = await pathNotice();
    const hb = await page.evaluate(() => globalThis.__hb);
    check.r.inPage = await page.evaluate(() => globalThis.__check);
    check.r.seen = check.r.seen || check.r.inPage.length > 0;
    firstVisit = {
      mainThread: { maxGapMs: Math.round(hb.maxGapMs), ticks: hb.ticks },
      loadSeconds: (Date.now() - t0) / 1000,
      sawCheckNotice: check.r,
      notice,
      verdict: await verdictFromStorage(),
    };
    return firstVisit;
  },
  true,
);
await step("what this variant must show", async () => {
  const v = Object.values(firstVisit?.verdict ?? {})[0];
  const n = firstVisit?.notice;
  const want = {
    nvidia: () => v?.canary === "pass" && v?.webgpu === "ok",
    intel: () =>
      v?.canary === "fail" &&
      v?.webgpu === "broken" &&
      v?.path === "cpu" &&
      n?.path === "cpu" &&
      /wrong answers/.test(n?.text ?? ""),
    cpu: () =>
      v?.canary === "skipped" && v?.path === "cpu" && n?.path === "cpu",
  }[VARIANT]();
  const common =
    firstVisit?.sawCheckNotice.seen === true ||
    (VARIANT === "cpu" && n?.wait === "measured");
  if (!want)
    throw new Error(
      `the ${VARIANT} verdict is not what it must be: ${JSON.stringify(v)} / ${n?.path}`,
    );
  if (n?.wait !== "measured")
    throw new Error(`the wait estimate is not measured: ${n?.wait}`);
  if (!common) throw new Error("the first-check notice was never seen");
  return { verdict: v, uiPath: n.path, wait: n.wait };
});
await step(
  "type a request and make a plan",
  async () => {
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
  },
  true,
);
await step(
  "run it",
  async () => {
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
  },
  true,
);
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

await step(
  "second visit uses the remembered verdict",
  async () => {
    await page.goto(`${APP}/app`);
    await expect(
      page.getByText(
        "Choose a video or drop one here. It stays on this computer.",
      ),
    ).toBeVisible({ timeout: 30000 });
    // A file chosen before the capability check has finished is ignored by the machine (it is not ready for one), so
    // choose again until the video is read.
    for (let i = 0; ; i++) {
      await page.locator('input[type="file"]').setInputFiles(clip);
      if (
        await page
          .getByText("smoke-clip.mp4")
          .first()
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false)
      )
        break;
      if (i >= 3)
        throw new Error("the video was never read on the second visit");
    }
    const check = watchFor("[data-check]");
    const t0 = Date.now();
    try {
      await waitReady(300000);
    } finally {
      check.stop();
    }
    const notice = await pathNotice();
    check.r.inPage = await page.evaluate(() => globalThis.__check);
    check.r.seen = check.r.seen || check.r.inPage.length > 0;
    if (check.r.seen)
      throw new Error("the first-check notice came back on the second visit");
    if (notice.path !== firstVisit?.notice.path)
      throw new Error(
        `the path changed: ${firstVisit?.notice.path} -> ${notice.path}`,
      );
    return {
      loadSeconds: (Date.now() - t0) / 1000,
      sawCheckNotice: false,
      path: notice.path,
      wait: notice.wait,
    };
  },
  true,
);
clearInterval(watchdog);

report.finished = new Date().toISOString();
report.allOk = report.steps.every((s) => s.ok);
writeFileSync(join(OUT, "smoke.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  report.allOk ? "SMOKE PASSED" : "SMOKE HAD FAILURES: see smoke.json",
);
await ctx.close().catch(() => {});
rmSync(PROFILE, { recursive: true, force: true });
dev.kill("SIGTERM");
modelServer.close();
process.exit(report.allOk ? 0 : 1);
