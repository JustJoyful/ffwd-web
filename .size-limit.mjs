// Bundle budgets (DESIGN "Performance budget", WEB_ARCHITECTURE section 9). Run after `pnpm build`: `pnpm size`.
// A .mjs file rather than .json because the files a page loads have hashed names: the page's own list of preloaded
// scripts (its modulepreload links) is read from the built HTML, so the budget measures what that page really loads
// before a video is chosen. PostHog (a lazy chunk, loaded after the first interaction or 3 s) is not preloaded and is
// reported separately. The ffmpeg core (public/ffmpeg, about 31 MB) is neither built nor measured here.
import { readFileSync } from "node:fs";

const OUT = "build/client";
const HOME_LIMIT = "120 kB"; // DESIGN: home page JS, gzipped, before a video is chosen
const FONT_LIMIT = "90 kB"; // DESIGN: both families, WOFF2
// One chore page stands for them all: every chore page is the same component with different data.
const CHORE_PAGE = `${OUT}/chores/cut-the-start-off-a-video/index.html`;

const preloaded = (htmlFile) => [
  ...new Set(
    [
      ...readFileSync(htmlFile, "utf8").matchAll(
        /<link rel="modulepreload" href="(\/assets\/[^"]+\.js)"/g,
      ),
    ].map((m) => OUT + m[1]),
  ),
];

export default [
  {
    name: "Home page JavaScript before a video is chosen (gzip)",
    path: preloaded(`${OUT}/index.html`),
    gzip: true,
    limit: HOME_LIMIT,
  },
  {
    name: "A chore page's JavaScript (gzip)",
    path: preloaded(CHORE_PAGE),
    gzip: true,
    limit: HOME_LIMIT,
  },
  {
    name: "Fonts (WOFF2, both families, every subset)",
    path: `${OUT}/assets/*.woff2`,
    gzip: false,
    limit: FONT_LIMIT,
  },
  // Reported, no limit: the tool's own chunks (loaded only on /app) and the lazy analytics chunk.
  {
    name: "The /app chunks (gzip, reported)",
    path: [`${OUT}/assets/app-*.js`, `${OUT}/assets/worker-*.js`],
    gzip: true,
  },
  {
    name: "PostHog, loaded lazily (gzip, reported)",
    path: `${OUT}/assets/module.slim-*.js`,
    gzip: true,
  },
];
