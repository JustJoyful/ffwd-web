// scripts/serve-release.mjs (`pnpm release:local`): the SHA256SUMS gate and the production-headers reader.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  productionHeaders,
  sumsProblems,
} from "../../scripts/serve-release.mjs";

mkdirSync("scratch", { recursive: true });
const dirs = [];
afterAll(() =>
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const sha = (s) => createHash("sha256").update(s).digest("hex");
function release(sumsFor = {}) {
  const dir = resolve(mkdtempSync(join("scratch", "rel-")));
  dirs.push(dir);
  writeFileSync(join(dir, "ffwd-model.json"), "{}");
  writeFileSync(join(dir, "m.gguf"), "model");
  const lines = {
    "ffwd-model.json": sha("{}"),
    "m.gguf": sha("model"),
    ...sumsFor,
  };
  writeFileSync(
    join(dir, "SHA256SUMS"),
    Object.entries(lines)
      .map(([f, h]) => `${h}  ${f}\n`)
      .join(""),
  );
  return dir;
}

describe("sumsProblems", () => {
  test("a folder that matches its SHA256SUMS has no problems", async () => {
    expect(await sumsProblems(release())).toEqual([]);
  });
  test("a changed file, a missing file, a path out of the folder and a missing SHA256SUMS are each reported", async () => {
    const dir = release();
    writeFileSync(join(dir, "m.gguf"), "tampered");
    expect(await sumsProblems(dir)).toEqual(["m.gguf differs"]);
    expect(await sumsProblems(release({ "gone.txt": sha("x") }))).toEqual([
      "gone.txt is missing",
    ]);
    expect(await sumsProblems(release({ "../x": sha("x") }))).toEqual([
      "../x leaves the folder",
    ]);
    const bare = resolve(mkdtempSync(join("scratch", "rel-")));
    dirs.push(bare);
    expect(await sumsProblems(bare)).toEqual(["SHA256SUMS is missing"]);
  });
  test("the manifest itself must be listed", async () => {
    const dir = release();
    writeFileSync(join(dir, "SHA256SUMS"), `${sha("model")}  m.gguf\n`);
    expect(await sumsProblems(dir)).toEqual([
      "ffwd-model.json is not listed in SHA256SUMS",
    ]);
  });
});

describe("productionHeaders", () => {
  test("reads only the /* block of a _headers file", () => {
    const dir = resolve(mkdtempSync(join("scratch", "rel-")));
    dirs.push(dir);
    writeFileSync(
      join(dir, "_headers"),
      "# c\n/*\n  A: 1\n  Content-Security-Policy: connect-src 'self' http://localhost:8765\n\n/assets/*\n  Cache-Control: x\n",
    );
    expect(productionHeaders(join(dir, "_headers"))).toEqual({
      A: "1",
      "Content-Security-Policy": "connect-src 'self' http://localhost:8765",
    });
  });
});
