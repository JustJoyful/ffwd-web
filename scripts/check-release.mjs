// Release gate: fails while the built site is not fit to publish. Run after `pnpm build` in the same shell, so the
// build-time facts it reads (build/build-info.json, written by scripts/postbuild.mjs) are the ones of this build.
// It is meant to fail until the owner supplies the real content and the production hosts; see scripts/release-checks.mjs.
import { existsSync, readFileSync } from "node:fs";
import { releaseProblems } from "./release-checks.mjs";

const info = existsSync("build/build-info.json")
  ? JSON.parse(readFileSync("build/build-info.json", "utf8"))
  : null;
const problems = releaseProblems({
  out: "build/client",
  info,
  allowAnalytics: process.env.FFWD_ANALYTICS_ON === "1",
});
for (const p of problems) console.log(p);
if (problems.length) {
  console.error(
    `check:release failed: ${problems.length} problem(s). Fix them before publishing.`,
  );
  process.exit(1);
}
console.log("check:release passed");
