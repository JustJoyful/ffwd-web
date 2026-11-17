import { describe, expect, test } from "vitest";
import { usesStreamCopyOnly, validateRun } from "../../app/agent/validator.js";

describe("hostile or sloppy model output is rejected with a reason, never thrown", () => {
  const ok = ["-i", "{in:clip}", "-c", "copy", "{out:out1}"];
  const run = (args, inputs = ["clip"], outputs = ["out1"], known) =>
    validateRun(args, inputs, outputs, known);

  test("the baseline command is accepted", () => {
    expect(run(ok)).toEqual({ ok: true, reason: null });
  });
  test("a non-string arg", () => {
    for (const bad of [[...ok, 5], [...ok, null], [...ok, { a: 1 }], "-i x"]) {
      const r = run(bad);
      expect(r.ok).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });
  test("10 000 args", () => {
    const junk = Array.from({ length: 10_000 }, () => "x");
    expect(run(junk).ok).toBe(false);
    // Also when every token is individually valid: the action schema's maxItems applies.
    const many = Array.from({ length: 10_000 }, () => "-an");
    expect(run([...ok, ...many]).ok).toBe(false);
  });
  test("a single 100 000 character value", () => {
    const args = [...ok.slice(0, 4), "-vf", "x".repeat(100_000), "{out:out1}"];
    expect(run(args).ok).toBe(false);
  });
  test("duplicate output ids", () => {
    expect(run(ok, ["clip"], ["out1", "out1"]).ok).toBe(false);
  });
  test("an input id the job was not given", () => {
    const r = run(ok, ["clip"], ["out1"], {
      inputs: new Set(["other"]),
      outputs: new Set(["out1"]),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unknown id: clip");
  });
  test("an output id the spec does not have", () => {
    const r = run(ok, ["clip"], ["out1"], {
      inputs: new Set(["clip"]),
      outputs: new Set(["out2"]),
    });
    expect(r.ok).toBe(false);
  });
  test("-y", () => {
    expect(run(["-y", ...ok]).ok).toBe(false);
  });
  test("-i /etc/passwd, ../x, protocol and shell values", () => {
    const mid = ["-i", "{in:clip}"];
    expect(run(["-i", "/etc/passwd", "{out:out1}"]).ok).toBe(false);
    expect(run([...mid, "../x"]).ok).toBe(false);
    expect(run(["-i", "http://x/y", "{out:out1}"]).ok).toBe(false);
    expect(run([...mid, "-f", "concat", "{out:out1}"]).ok).toBe(false);
    expect(run([...mid, "-ss", "1; touch x", "{out:out1}"]).ok).toBe(false);
    expect(run([...mid, "-vf", "movie=/etc/passwd", "{out:out1}"]).ok).toBe(
      false,
    );
  });
  test("a trailing newline on an id token is not accepted", () => {
    expect(run(["-i", "{in:clip}\n", "{out:out1}"]).ok).toBe(false);
  });
  test("empty and missing lists", () => {
    expect(run([]).ok).toBe(false);
    expect(validateRun(undefined, undefined, undefined).ok).toBe(false);
  });
});

describe("usesStreamCopyOnly", () => {
  test.each([
    [["-i", "{in:a}", "-c", "copy", "{out:o}"], true],
    [["-i", "{in:a}", "-c:v", "copy", "-c:a", "copy", "{out:o}"], true],
    [["-i", "{in:a}", "-c", "copy", "-vf", "scale=-2:480", "{out:o}"], false],
    [["-i", "{in:a}", "-c:v", "libx264", "{out:o}"], false],
    [["-i", "{in:a}", "{out:o}"], false],
    [["-i", "{in:a}", "-c:v", "copy", "-c:a", "aac", "{out:o}"], false],
  ])("%j", (args, expected) => {
    expect(usesStreamCopyOnly(args)).toBe(expected);
  });
});
