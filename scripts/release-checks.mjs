// The release gate's checks (review S9, B2). Pure functions over a build folder and the facts recorded at build time, so
// tests/unit/release-checks.test.js can feed them fixtures. scripts/check-release.mjs is the command line around them.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Placeholder or mockup-only text that must be gone before publishing.
export const UNFINISHED = [
  "[contact address]",
  "[role line]",
  "[Confirm on the built site",
  "[Confirm IP capture",
  "https://ffwd.example", // the SITE_URL placeholder (app/config.js): the domain is not chosen yet
];
// Cloudflare Pages serves static files up to 25 MiB each.
export const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
// The ffmpeg.wasm core the page fetches from /ffmpeg (app/agent/config.js FFMPEG_CORE_BASE).
export const CORE_FILES = [
  "ffmpeg/ffmpeg-core.js",
  "ffmpeg/ffmpeg-core.wasm",
  "ffmpeg/ffmpeg-core.worker.js",
];
// A PostHog project key looks like this; finding one in the output means analytics is switched on in this build.
const POSTHOG_KEY = /phc_[A-Za-z0-9]{20,}/;

export function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/**
 * @param {{ out: string, info: { scripted?: boolean, modelUrl?: string | null, posthogKey?: boolean } | null, allowAnalytics?: boolean }} p
 *   `info` is what scripts/postbuild.mjs recorded at build time (null when it is missing).
 * @returns {string[]} one plain sentence per problem; empty when the build may be published
 */
export function releaseProblems({ out, info, allowAnalytics = false }) {
  const problems = [];
  if (!info)
    problems.push(
      "build/build-info.json is missing: run `pnpm build` (it is written by scripts/postbuild.mjs) before checking.",
    );
  else {
    // The model URL: without it the page says the model is "not published yet" and no job can run.
    const url = info.modelUrl;
    let u = null;
    try {
      u = new URL(url ?? "");
    } catch {
      /* reported below */
    }
    if (!url)
      problems.push(
        "VITE_MODEL_URL was not set when this was built: no model URL is in it.",
      );
    else if (!u || u.protocol !== "https:")
      problems.push(
        `VITE_MODEL_URL must be an https URL (it was built with ${JSON.stringify(url)}).`,
      );
    else if (/^(localhost|127\.|\[?::1)/.test(u.hostname))
      problems.push(
        `VITE_MODEL_URL points at this machine (${u.hostname}), not at a public host.`,
      );
    if (info.scripted)
      problems.push(
        "This is a scripted build (VITE_SCRIPTED_POLICY=1): the model is replaced by replies from the page. Never publish it.",
      );
    if (info.posthogKey && !allowAnalytics)
      problems.push(
        "A PostHog key is in this build (VITE_POSTHOG_KEY) but analytics is meant to be off. Unset it, or set FFWD_ANALYTICS_ON=1 to say that switching it on is a decision the owner made.",
      );
  }
  if (!existsSync(out))
    return [...problems, `${out} does not exist: run \`pnpm build\`.`];

  for (const f of CORE_FILES)
    if (!existsSync(join(out, f)))
      problems.push(
        `${out}/${f} is missing: the page would fetch the 404 page as its video engine (run \`pnpm copy-core\` before building, or host the core elsewhere).`,
      );

  let key = false;
  for (const f of walk(out)) {
    const name = relative(out, f);
    const size = statSync(f).size;
    if (size > PAGES_FILE_LIMIT)
      problems.push(
        `${name} is ${(size / 1048576).toFixed(1)} MiB, over the 25 MiB limit of one file on Cloudflare Pages. Serve it from R2 or split it (see docs/launch-items.txt).`,
      );
    if (f.endsWith(".js") || f.endsWith(".html")) {
      const text = readFileSync(f, "utf8");
      for (const s of UNFINISHED)
        if (text.includes(s)) problems.push(`${name}: unfinished content ${s}`);
      if (!key && POSTHOG_KEY.test(text) && !allowAnalytics) {
        key = true;
        problems.push(
          `${name} holds a PostHog project key but analytics is meant to be off.`,
        );
      }
    }
  }
  return problems;
}
