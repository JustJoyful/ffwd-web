import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  validateAction,
  validateCheck,
  validateProbe,
  validateSpec,
} from "../../app/agent/protocol/validate.js";

const lines = (f) =>
  readFileSync(`protocol/conformance/${f}`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

const probe = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  duration_s: 4,
  size_bytes: 1000,
  bit_rate: 2000,
  streams: [
    { index: 0, type: "video", codec: "h264", width: 640, height: 360 },
  ],
};

describe("validateSpec", () => {
  test("every spec in describe-spec.jsonl validates", () => {
    for (const c of lines("describe-spec.jsonl")) {
      const r = validateSpec(c.spec);
      expect(r.errors, c.name).toEqual([]);
      expect(r.ok, c.name).toBe(true);
    }
  });
  test("a spec with no outputs does not validate", () => {
    const r = validateSpec({ family: ["F1"], outputs: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("validateAction", () => {
  test("a run action with args/inputs/outputs validates", () => {
    const r = validateAction({
      action: "run",
      args: ["-i", "{in:clip}", "-c", "copy", "{out:out1}"],
      inputs: ["clip"],
      outputs: ["out1"],
    });
    expect(r).toEqual({ ok: true, errors: [] });
  });
  test("a spec action validates", () => {
    const spec = lines("describe-spec.jsonl")[0].spec;
    expect(validateAction({ action: "spec", spec }).ok).toBe(true);
  });
  test('{"action":"check"} does not validate (check is not a model action)', () => {
    const r = validateAction({ action: "check" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  test('{"action":"bogus"} does not validate', () => {
    expect(validateAction({ action: "bogus" }).ok).toBe(false);
  });
  test("non-objects do not validate and never throw", () => {
    for (const x of [null, undefined, 3, "run", [], [{ action: "run" }]])
      expect(validateAction(x).ok).toBe(false);
  });
});

describe("validateProbe", () => {
  test("a normal probe validates", () => {
    expect(validateProbe(probe)).toEqual({ ok: true, errors: [] });
  });
  test('a probe missing "streams" does not validate', () => {
    const rest = { ...probe };
    delete rest.streams;
    const r = validateProbe(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("streams");
  });
});

describe("validateCheck", () => {
  test("a check result validates", () => {
    const c = {
      passed: false,
      checks: [{ field: "container", expected: "mp4", actual: "x", ok: false }],
      measurements: {},
      error: null,
    };
    expect(validateCheck(c)).toEqual({ ok: true, errors: [] });
  });
  test("a check result without error does not validate", () => {
    expect(
      validateCheck({ passed: true, checks: [], measurements: {} }).ok,
    ).toBe(false);
  });
});
