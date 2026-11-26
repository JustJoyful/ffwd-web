import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("release check reports the known unfinished content", () => {
  const r = spawnSync("node", ["scripts/check-release.mjs"], { encoding: "utf8" });
  // It exits non-zero by design while anything unfinished remains in the built site: today that is the PostHog IP-capture
  // note (kept until analytics is switched on) and the site address placeholder (VITE_SITE_URL is set on the host).
  expect(r.status).not.toBe(0);
  const out = r.stdout + r.stderr;
  for (const s of ["[Confirm IP capture", "https://ffwd.example"]) {
    expect(out).toContain(s);
  }
  // the contact address, the role line and the "confirm on the built site" notes were removed or confirmed
  for (const s of ["[contact address]", "[role line]", "[Confirm on the built site"]) {
    expect(out).not.toContain(s);
  }
});
