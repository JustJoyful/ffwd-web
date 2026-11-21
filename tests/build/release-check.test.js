import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("release check reports the known unfinished content", () => {
  const r = spawnSync("node", ["scripts/check-release.mjs"], { encoding: "utf8" });
  // It exits non-zero by design while placeholders remain in the built site.
  expect(r.status).not.toBe(0);
  const out = r.stdout + r.stderr;
  for (const s of ["[contact address]", "[role line]", "[Confirm on the built site", "[Confirm IP capture", "https://ffwd.example"]) {
    expect(out).toContain(s);
  }
});
