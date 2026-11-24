// Runs after `react-router build`: files a static host needs that the prerender does not write.
//  - 404.html: Cloudflare Pages serves /404.html for any address with no file (the prerendered 404 page).
//  - sitemap.xml and robots.txt, generated from the chore list so a new chore is listed without a second edit.
import { copyFileSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { buildCsp } from "../csp.js";
import { chores } from "../app/content/chores.js";
import { SITE_URL } from "../app/config.js";

const OUT = "build/client";
// config.js reads import.meta.env, which plain Node does not have; the build's own VITE_SITE_URL is read here.
const site = process.env.VITE_SITE_URL ?? SITE_URL;

copyFileSync(`${OUT}/404/index.html`, `${OUT}/404.html`);

// What this build was made with, for `pnpm check:release` (outside build/client, so it is never served). Vite reads
// VITE_* from the shell and from .env files; so does this.
const env = {
  ...loadEnv("production", process.cwd(), "VITE_"),
  ...process.env,
};

// The Content-Security-Policy names this build's hosts, so it is added to the copied _headers here, in the "/*" block.
const csp = buildCsp({
  modelUrl: env.VITE_MODEL_MANIFEST_URL,
  analyticsHost: env.VITE_POSTHOG_KEY
    ? (env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com")
    : null,
});
const headers = readFileSync(`${OUT}/_headers`, "utf8");
const marker = "  Referrer-Policy: strict-origin-when-cross-origin\n";
if (!headers.includes(marker))
  throw new Error(
    "postbuild: _headers has no Referrer-Policy line to put the CSP after",
  );
writeFileSync(
  `${OUT}/_headers`,
  headers.replace(marker, `${marker}  Content-Security-Policy: ${csp}\n`),
);

writeFileSync(
  "build/build-info.json",
  JSON.stringify(
    {
      scripted: env.VITE_SCRIPTED_POLICY === "1",
      modelUrl: env.VITE_MODEL_MANIFEST_URL || null,
      modelManifestSha256: env.VITE_MODEL_MANIFEST_SHA256 || null,
      // VITE_MODEL_LOCAL_TEST=1 is `pnpm release:local` (scripts/serve-release.mjs): the stamp makes check:release refuse it
      localTest: env.VITE_MODEL_LOCAL_TEST === "1",
      posthogKey: Boolean(env.VITE_POSTHOG_KEY),
    },
    null,
    2,
  ) + "\n",
);

const pages = [
  "",
  "/chores",
  "/privacy",
  "/requirements",
  ...chores.map((c) => `/chores/${c.slug}`),
];
writeFileSync(
  `${OUT}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${site}${p}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
// /app is the tool, not a page to index; a chore page links to it with ?ask= text.
writeFileSync(
  `${OUT}/robots.txt`,
  `User-agent: *\nAllow: /\nDisallow: /app\n\nSitemap: ${site}/sitemap.xml\n`,
);
console.log(
  `postbuild: 404.html, sitemap.xml (${pages.length} pages), robots.txt`,
);
