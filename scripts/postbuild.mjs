// Runs after `react-router build`: files a static host needs that the prerender does not write.
//  - 404.html: Cloudflare Pages serves /404.html for any address with no file (the prerendered 404 page).
//  - sitemap.xml and robots.txt, generated from the chore list so a new chore is listed without a second edit.
import { copyFileSync, writeFileSync } from "node:fs";
import { chores } from "../app/content/chores.js";
import { SITE_URL } from "../app/config.js";

const OUT = "build/client";
// config.js reads import.meta.env, which plain Node does not have; the build's own VITE_SITE_URL is read here.
const site = process.env.VITE_SITE_URL ?? SITE_URL;

copyFileSync(`${OUT}/404/index.html`, `${OUT}/404.html`);

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
