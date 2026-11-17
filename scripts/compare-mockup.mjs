// Proof that the site is mockup-v5 ported 1:1: screenshot both at two viewports and diff the pixels.
// Needs `pnpm build` first. Writes <viewport>-mockup.png, -site.png and -diff.png to .compare/.
// Exits 1 if more than THRESHOLD_PCT of the pixels differ, or if the two pages have different sizes.
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const MOCKUP_DIR = resolve("mockup-v5");
const OUT = ".compare";
const MOCKUP_PORT = 4401;
const SITE_PORT = 4402;
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];
const QUERY = "?tab=size";
const PIXEL_THRESHOLD = 0.1; // pixelmatch colour tolerance
const THRESHOLD_PCT = 0.5; // max share of differing pixels

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
};

// Tiny static server for the mockup folder.
function serveMockup() {
  const server = createServer((req, res) => {
    const path = normalize(
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    let file = join(MOCKUP_DIR, path);
    if (!file.startsWith(MOCKUP_DIR)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) =>
    server.listen(MOCKUP_PORT, "127.0.0.1", () => ok(server)),
  );
}

// `vite preview` on build/client; killed by pid in the caller's finally block.
async function servePreview() {
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(SITE_PORT),
      "--strictPort",
    ],
    {
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${SITE_PORT}/`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("vite preview did not start");
}

async function shoot(browser, url, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // Scroll the whole page once so the scroll reveals fire, then return to the top.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  const png = await page.screenshot({ fullPage: true });
  await ctx.close();
  return PNG.sync.read(png);
}

mkdirSync(OUT, { recursive: true });
const mockupServer = await serveMockup();
let preview;
let browser;
let failed = false;
try {
  preview = await servePreview();
  browser = await chromium.launch({ args: ["--disable-gpu"] });
  for (const vp of VIEWPORTS) {
    const a = await shoot(
      browser,
      `http://127.0.0.1:${MOCKUP_PORT}/${QUERY}`,
      vp,
    );
    const b = await shoot(
      browser,
      `http://127.0.0.1:${SITE_PORT}/${QUERY}`,
      vp,
    );
    writeFileSync(join(OUT, `${vp.name}-mockup.png`), PNG.sync.write(a));
    writeFileSync(join(OUT, `${vp.name}-site.png`), PNG.sync.write(b));
    if (a.width !== b.width || a.height !== b.height) {
      console.log(
        `${vp.name}: FAIL, page sizes differ (mockup ${a.width}x${a.height}, site ${b.width}x${b.height})`,
      );
      failed = true;
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: PIXEL_THRESHOLD,
    });
    writeFileSync(join(OUT, `${vp.name}-diff.png`), PNG.sync.write(diff));
    const pct = (n / (a.width * a.height)) * 100;
    const ok = pct <= THRESHOLD_PCT;
    console.log(
      `${vp.name}: ${ok ? "ok" : "FAIL"}, ${n} px differ (${pct.toFixed(3)}%), limit ${THRESHOLD_PCT}%`,
    );
    if (!ok) failed = true;
  }
} finally {
  await browser?.close();
  preview?.kill();
  mockupServer.close();
}
process.exit(failed ? 1 : 0);
