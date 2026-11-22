// The thread cap is the safety net against the core-mt deadlock (config.js FFMPEG_THREADS): every re-encode hangs when
// FFmpeg picks its own thread count, and two inputs hang on decoder threads. The harness adds the flags; the model
// never writes them, and anything it writes is overridden.
import { describe, expect, test } from "vitest";
import {
  FFMPEG_DECODE_THREADS,
  FFMPEG_THREADS,
} from "../../app/agent/config.js";
import {
  capThreads,
  harnessArgs,
  substitute,
} from "../../app/agent/executor/harness-args.js";
import { validateRun } from "../../app/agent/validator.js";

const T = ["-threads", String(FFMPEG_THREADS)];
const D = ["-threads", String(FFMPEG_DECODE_THREADS)];

describe("capThreads", () => {
  test("the config says 4 output threads and 1 decoder thread", () => {
    expect([FFMPEG_THREADS, FFMPEG_DECODE_THREADS]).toEqual([4, 1]);
  });
  test("one input: -threads 1 before -i, -threads 4 before the output", () => {
    expect(capThreads(["-i", "{in:clip}", "-crf", "30", "{out:out1}"])).toEqual(
      [...D, "-i", "{in:clip}", "-crf", "30", ...T, "{out:out1}"],
    );
  });
  test("a stream copy is capped too (harmless, and one rule for every run)", () => {
    expect(capThreads(["-i", "{in:clip}", "-c", "copy", "{out:out1}"])).toEqual(
      [...D, "-i", "{in:clip}", "-c", "copy", ...T, "{out:out1}"],
    );
  });
  test("two inputs with a concat filter_complex: every -i gets -threads 1, the output -threads 4", () => {
    const args = [
      ...["-i", "{in:a}", "-i", "{in:b}"],
      ...["-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"],
      ...["-map", "[v]", "-map", "[a]", "{out:out1}"],
    ];
    const out = capThreads(args);
    const at = (x) => out.flatMap((a, i) => (a === x ? [i] : []));
    expect(at("-i")).toHaveLength(2);
    for (const i of at("-i")) expect(out.slice(i - 2, i)).toEqual(D);
    const o = out.indexOf("{out:out1}");
    expect(out.slice(o - 2, o)).toEqual(T);
    expect(out.filter((a) => a === "-threads")).toHaveLength(3);
  });
  test("every output of a multi-output run is capped", () => {
    const out = capThreads([
      ...["-i", "{in:clip}", "-map", "0:v", "{out:out1}"],
      ...["-map", "0:a", "{out:out2}"],
    ]);
    for (const id of ["out1", "out2"]) {
      const o = out.indexOf(`{out:${id}}`);
      expect(out.slice(o - 2, o)).toEqual(T);
    }
    expect(out.filter((a) => a === "-threads")).toHaveLength(3);
  });
  test("an image sequence output is capped like any other", () => {
    expect(
      capThreads(["-i", "{in:clip}", "-vf", "fps=1/2", "{out:frames}"]),
    ).toEqual([
      ...D,
      "-i",
      "{in:clip}",
      "-vf",
      "fps=1/2",
      ...T,
      "{out:frames}",
    ]);
  });
  test("a model-written -threads is overridden: the harness's flag comes last before the output", () => {
    const out = capThreads([
      ...["-threads", "16", "-i", "{in:clip}", "-threads", "64", "{out:out1}"],
    ]);
    // FFmpeg takes the last value for an option, so what sits right before each file decides.
    const lastBefore = (file) => {
      const upTo = out.indexOf(file);
      return out[out.lastIndexOf("-threads", upTo) + 1];
    };
    expect(lastBefore("{in:clip}")).toBe("1");
    expect(lastBefore("{out:out1}")).toBe("4");
  });
  test("a stream-specific -threads:v written by the model does not survive either", () => {
    const out = capThreads([
      "-i",
      "{in:clip}",
      "-threads:v",
      "32",
      "{out:out1}",
    ]);
    expect(out.slice(-3)).toEqual([...T, "{out:out1}"]);
  });
  test("arguments that merely contain 'out' are not outputs", () => {
    const out = capThreads([
      "-i",
      "{in:clip}",
      "-metadata",
      "title=out1",
      "{out:out1}",
    ]);
    expect(out.filter((a) => a === "-threads")).toHaveLength(2);
  });
  test("it never mutates its input, and explicit counts are honoured", () => {
    const args = ["-i", "{in:clip}", "{out:out1}"];
    const copy = [...args];
    expect(capThreads(args, 2, 3)).toEqual([
      ...["-threads", "3", "-i", "{in:clip}", "-threads", "2", "{out:out1}"],
    ]);
    expect(args).toEqual(copy);
  });
});

describe("harnessArgs", () => {
  test("substitutes the ids with in-memory paths AFTER capping, and frames get a %04d pattern", () => {
    expect(
      harnessArgs(
        ["-i", "{in:clip}", "-vf", "fps=1", "{out:out1}"],
        { clip: "in/1-a.mp4" },
        { out1: "out/1/out1/%04d.png" },
      ),
    ).toEqual([
      ...D,
      "-i",
      "in/1-a.mp4",
      "-vf",
      "fps=1",
      ...T,
      "out/1/out1/%04d.png",
    ]);
  });
  test("two inputs and two outputs: no placeholder is left and every file has its cap", () => {
    const out = harnessArgs(
      [
        ...["-i", "{in:a}", "-i", "{in:b}", "-map", "0:v", "{out:x}"],
        ...["-map", "1:a", "{out:y}"],
      ],
      { a: "in/1-a.mp4", b: "in/2-b.mp4" },
      { x: "out/1/x.mp4", y: "out/1/y.m4a" },
    );
    expect(out.some((a) => /^\{/.test(a))).toBe(false);
    for (const f of ["in/1-a.mp4", "in/2-b.mp4"])
      expect(out.slice(out.indexOf(f) - 3, out.indexOf(f))).toEqual([
        ...D,
        "-i",
      ]);
    for (const f of ["out/1/x.mp4", "out/1/y.m4a"])
      expect(out.slice(out.indexOf(f) - 2, out.indexOf(f))).toEqual(T);
  });
  test("a validated model run always comes out capped (the allowlist permits -threads, the harness wins)", () => {
    const args = [
      "-threads",
      "99",
      "-i",
      "{in:clip}",
      "-threads",
      "99",
      "{out:out1}",
    ];
    expect(validateRun(args, ["clip"], ["out1"]).ok).toBe(true);
    const out = harnessArgs(args, { clip: "in/c.mp4" }, { out1: "out/o.mp4" });
    expect(out.slice(-3)).toEqual([...T, "out/o.mp4"]);
    expect(
      out.slice(out.indexOf("in/c.mp4") - 3, out.indexOf("in/c.mp4")),
    ).toEqual([...D, "-i"]);
  });
});

describe("substitute", () => {
  test("only whole {in:id} / {out:id} tokens are replaced; an unknown id stays as written", () => {
    expect(
      substitute(
        ["-i", "{in:clip}", "{in:other}", "x{out:out1}", "{out:out1}"],
        { clip: "P" },
        { out1: "Q" },
      ),
    ).toEqual(["-i", "P", "{in:other}", "x{out:out1}", "Q"]);
  });
});
