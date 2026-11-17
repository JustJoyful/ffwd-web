import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("prerenders / to build/client/index.html", () => {
  expect(existsSync("build/client/index.html")).toBe(true);
  expect(readFileSync("build/client/index.html", "utf8")).toContain("<h1");
});
