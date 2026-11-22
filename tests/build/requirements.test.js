import { expect, test } from "vitest";
import {
  MAX_FILE_BYTES_PER_GB,
  MIN_DEVICE_MEMORY_GB,
  REASON_TEXT,
  estimateWait,
  maxFileBytes,
} from "../../app/lib/capability.js";
import { page } from "./helpers.js";

const doc = page("/requirements");
const $$ = (s) => [...doc.querySelectorAll(s)];
const MIB = 1024 * 1024;

test("one <h1>, a title of at most 60 characters and a description", () => {
  expect($$("h1")).toHaveLength(1);
  expect(doc.title).toMatch(/requirements/i);
  expect(doc.title.length).toBeLessThanOrEqual(60);
  const d = doc.querySelector('meta[name="description"]').content;
  expect(d.length).toBeGreaterThanOrEqual(70);
  expect(d.length).toBeLessThanOrEqual(160);
});

test("one section per capability reason, anchored by the reason's id, with a heading", () => {
  for (const id of Object.keys(REASON_TEXT)) {
    const s = doc.getElementById(id);
    expect(s, id).not.toBeNull();
    expect(s.tagName).toBe("SECTION");
    expect(s.querySelector("h2").textContent.length).toBeGreaterThan(3);
    // the sentence the tool shows is the lead of its section, so the page and the notice never disagree
    expect(s.textContent).toContain(REASON_TEXT[id]);
  }
});

test("each number on the page equals the constant it comes from", () => {
  const expected = {
    MIN_DEVICE_MEMORY_GB,
    MAX_FILE_MB_PER_GB: MAX_FILE_BYTES_PER_GB / MIB,
    MAX_FILE_MB_AT_4_GB: maxFileBytes(4) / MIB,
    CPU_FIRST_STEP_SECONDS: estimateWait("cpu").firstStepSeconds,
    CPU_LATER_STEP_SECONDS: estimateWait("cpu").laterStepSeconds,
  };
  const marked = $$("[data-const]");
  expect(marked.length).toBeGreaterThanOrEqual(3);
  for (const el of marked)
    expect(Number(el.textContent), el.dataset.const).toBe(
      expected[el.dataset.const],
    );
  // and no number sits in the page body without being tied to a constant
  const main = doc.querySelector("main").cloneNode(true);
  main.querySelectorAll("[data-const]").forEach((e) => e.remove());
  expect(main.textContent.match(/\d+/g) ?? []).toEqual([]);
});

test("no placeholder text other than the known brackets", () => {
  const body = doc.body.cloneNode(true);
  body.querySelectorAll("script").forEach((e) => e.remove());
  const brackets = body.textContent.match(/\[[^\]]*\]/g) ?? [];
  expect(brackets.filter((b) => b !== "[contact address]")).toEqual([]);
});
