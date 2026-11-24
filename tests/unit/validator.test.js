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

describe("filtergraph quoting follows FFmpeg's av_get_token (review S1)", () => {
  // JS-only regression cases: the shared conformance suite is owned by the model repo and is not changed here.
  // Inside '...' a backslash is a literal and the next ' closes the quote; a backslash escapes only OUTSIDE quotes.
  const vf = (graph, opt = "-vf") =>
    validateRun(["-i", "{in:a}", opt, graph, "{out:o}"], ["a"], ["o"]);
  test.each([
    // The review's exact string, plus siblings (setsar, ffmpeg opened the movie filter's file for real with these).
    String.raw`null='\',movie=in_0.mp4'`,
    String.raw`null='\',amovie=x:y=1'`,
    String.raw`setsar='\',movie=in_0.mp4'`,
    String.raw`null='\';movie=in_0.mp4'`,
    String.raw`null='\',sendcmd=f=x'`,
    String.raw`null='\',subtitles=x.srt'`,
    String.raw`null='\',ass=x.ass'`,
    String.raw`null='\',lavfi=x'`,
    String.raw`null='\',Movie=x'`,
    String.raw`null='\',mov'ie'=x'`,
    String.raw`null='\'[a],movie=x'`,
    String.raw`scale=64:64,null='\',movie=x'`,
  ])("rejects %s", (graph) => {
    for (const opt of ["-vf", "-af", "-filter", "-filter_complex"])
      expect(vf(graph, opt).ok).toBe(false);
  });
  test("a quoted backslash is a literal, so the graph splits after the closing quote", () => {
    expect(vf(String.raw`null='\',scale=64:64`).ok).toBe(true); // both on the allow-list
    expect(vf(String.raw`null='\',movie=x`).reason).toBe(
      "filter not allowed: movie",
    );
  });
  test("legitimate quoting and escaping still pass", () => {
    expect(vf(String.raw`select='not(mod(n\,10))'`).ok).toBe(true);
    expect(vf(String.raw`select='gt(scene,0.4)'`).ok).toBe(true);
    expect(vf(String.raw`select=not(mod(n\,10))`).ok).toBe(true); // escape outside quotes
    expect(vf(String.raw`scale=64:64\,null`).ok).toBe(true); // one scale filter, ffmpeg itself rejects the argument
  });
  test("file-reading filters are rejected however they are written", () => {
    for (const g of [
      "movie=x",
      "amovie=x",
      "subtitles=x",
      "ass=x",
      "sendcmd=f=x",
      "lavfi=x",
      "drawtext=textfile=x",
      "MOVIE=x",
      String.raw`mov\ie=x`,
      "'movie'=x",
      "movie\n=x",
      "[a]movie=x[b]",
      "null,\nmovie=x",
      "null;movie=x",
      "movie =x",
      "ｍovie=x",
    ])
      expect(vf(g).ok).toBe(false);
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
