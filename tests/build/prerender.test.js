import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("prerenders / to build/client/index.html", () => {
  expect(existsSync("build/client/index.html")).toBe(true);
  expect(readFileSync("build/client/index.html", "utf8")).toContain("<h1");
});

// Review B1: a full page load of /app must find a file, or a static host answers it with the 404 page.
test("prerenders /app to build/client/app/index.html (the tool's loading shell)", () => {
  expect(existsSync("build/client/app/index.html")).toBe(true);
  const html = readFileSync("build/client/app/index.html", "utf8");
  expect(html).toContain("Starting ffwd");
  expect(html).toContain("entry.client"); // the browser then runs the real tool
});
