import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ids = JSON.parse(readFileSync("protocol/test-real-ids.json", "utf8"));

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

test("the test-real id list exists and is an array of strings", () => {
  expect(Array.isArray(ids)).toBe(true);
  for (const id of ids) expect(typeof id).toBe("string");
});

test("no file under app/, tests/ or public/ mentions a test-real clip id", () => {
  const self = join("tests", "unit", "no-test-real.test.js");
  const hits = [];
  for (const root of ["app", "tests", "public"]) {
    for (const f of walk(root)) {
      // Skip binaries (fonts, video, images) and this file; ids are only ever text.
      if (
        f === self ||
        /\.(woff2?|mp4|webm|png|jpe?g|webp|avif|ico|svg)$/.test(f)
      )
        continue;
      const text = readFileSync(f, "utf8");
      for (const id of ids) if (text.includes(id)) hits.push(`${f}: ${id}`);
    }
  }
  expect(hits).toEqual([]);
});
