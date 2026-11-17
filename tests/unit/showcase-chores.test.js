import { expect, test } from "vitest";
import { CHORES, D, SAMPLE } from "../../app/content/showcase-chores.js";

const byId = (id) => CHORES.find((c) => c.id === id);

test("chore ids and sample length", () => {
  expect(CHORES.map((c) => c.id)).toEqual([
    "trim",
    "vertical",
    "size",
    "iphone",
    "frames",
  ]);
  expect(D).toBe(16.07);
  expect(SAMPLE.name).toBe("detective.mp4");
});

test("size chore: two runs, the first fails the size check, the second passes", () => {
  const size = byId("size");
  expect(size.runs).toHaveLength(2);
  expect(size.runs[0].checks[0]).toEqual([
    "Size",
    "3.2 MB",
    0,
    "over your 3 MB limit",
  ]);
  expect(size.runs[1].checks[0]).toEqual(["Size", "1.7 MB", 1]);
  expect(size.meter).toEqual({ input: 12.1, limit: 3, runs: [3.2, 1.7] });
});

test("trim range, frames interval", () => {
  expect(byId("trim").range).toEqual([3, D]);
  expect(byId("frames").every).toBe(2);
});

test("every chore has its required text fields", () => {
  for (const c of CHORES) {
    expect(c.ask).toBeTruthy();
    expect(c.plan.length).toBeGreaterThan(0);
    expect(c.runs.length).toBeGreaterThan(0);
    expect(c.out.name).toBeTruthy();
    expect(c.cmd).toBeTruthy();
  }
});
