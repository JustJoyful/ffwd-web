import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { PROTOCOL_VERSION } from "../../app/agent/config.js";

const ROOT = "protocol";
const pin = JSON.parse(readFileSync(join(ROOT, "PIN.json"), "utf8"));
// PIN.json and test-real-ids.json are this repo's own files, not part of the pinned snapshot.
const OWN = new Set(["PIN.json", "test-real-ids.json"]);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield relative(ROOT, p);
  }
}
const sha = (rel) =>
  createHash("sha256")
    .update(readFileSync(join(ROOT, rel)))
    .digest("hex");

describe("protocol snapshot", () => {
  test("every file under protocol/ hashes to its PIN entry", () => {
    const files = [...walk(ROOT)].filter((f) => !OWN.has(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(pin.files[f], f).toBe(sha(f));
  });

  test("PIN has no entry for a missing file", () => {
    const present = new Set(walk(ROOT));
    for (const f of Object.keys(pin.files))
      expect(present.has(f), f).toBe(true);
  });

  test("PIN records the source commit", () => {
    expect(pin.source_commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test('PIN.protocol_version equals config PROTOCOL_VERSION ("0.3.0")', () => {
    expect(pin.protocol_version).toBe(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe("0.3.0");
  });
});
