import { expect, test } from "vitest";
import { fmt } from "../../app/lib/format.js";

test("fmt formats seconds as m:ss, flooring", () => {
  expect(fmt(0)).toBe("0:00");
  expect(fmt(3)).toBe("0:03");
  expect(fmt(16.07)).toBe("0:16");
  expect(fmt(65)).toBe("1:05");
});
