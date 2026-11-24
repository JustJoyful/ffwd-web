import { describe, expect, test } from "vitest";
import { looseningError, specBoundsError } from "../../app/agent/spec-guard.js";
import { createMachine } from "../../app/agent/machine.js";
import {
  SPEC_2MB,
  act,
  fakeExecutor,
  fakeMeasure,
  policyOf,
  probeFile,
  run,
  spec,
} from "./engine-fakes.js";

const out = (o = {}) => ({
  family: ["F1"],
  outputs: [{ id: "out1", kind: "video", ...o }],
});

describe("specBoundsError (review S3: numbers the plan card does not show)", () => {
  test.each([
    [{ time: { start_s: 1, end_s: 3, tolerance_s: 0.5 } }, null],
    [{ time: { start_s: 1, end_s: 3, tolerance_s: 0.1 } }, null],
    [{ time: { tolerance_s: null } }, null],
    [{ quality: { min_ssim: 0.9, min_psnr_db: 28 } }, null],
    [{ quality: { min_ssim: 1, min_psnr_db: 40 } }, null],
    [{ time: { tolerance_s: 60 } }, /tolerance_s/],
    [{ time: { tolerance_s: 0.51 } }, /tolerance_s/],
    [{ time: { tolerance_s: -1 } }, /tolerance_s/],
    [{ quality: { min_ssim: 0.1 } }, /min_ssim/],
    [{ quality: { min_ssim: 0.899 } }, /min_ssim/],
    [{ quality: { min_ssim: 1.5 } }, /min_ssim/],
    [{ quality: { min_psnr_db: 5 } }, /min_psnr_db/],
    [{ quality: { min_psnr_db: -1e9 } }, /min_psnr_db/],
  ])("%j", (o, want) => {
    const r = specBoundsError(out(o));
    if (want === null) expect(r).toBeNull();
    else expect(r).toMatch(want);
  });
});

describe("looseningError", () => {
  const base = out({
    time: { start_s: 5, end_s: 10, tolerance_s: 0.1 },
    quality: { min_ssim: 0.95 },
    size_max_bytes: 2_000_000,
  });
  const edit = (f) => {
    const c = structuredClone(base);
    f(c.outputs[0]);
    return c;
  };
  test("the same spec, or one with more constraints, is fine", () => {
    expect(looseningError(base, structuredClone(base))).toBeNull();
    expect(
      looseningError(
        base,
        edit((o) => {
          o.container = "mp4";
          o.time.tolerance_s = 0.05;
          o.quality.min_ssim = 0.97;
          o.quality.min_psnr_db = 30;
        }),
      ),
    ).toBeNull();
  });
  test("null and a missing field mean the same", () => {
    expect(
      looseningError(
        edit((o) => (o.container = null)),
        base,
      ),
    ).toBeNull();
  });
  test.each([
    ["a looser tolerance", (o) => (o.time.tolerance_s = 60)],
    [
      "a dropped tolerance when it was tighter than the default",
      (o) => ((o.time.tolerance_s = 0.1), (o.time.tolerance_s = null)),
    ],
    ["a lower ssim floor", (o) => (o.quality.min_ssim = 0.9)],
    ["a dropped ssim floor", (o) => (o.quality = null)],
    ["a dropped time window", (o) => (o.time.end_s = null)],
    ["a moved time window", (o) => (o.time.end_s = 30)],
    ["a larger size cap", (o) => (o.size_max_bytes = 20_000_000)],
  ])("%s is refused", (_n, f) => {
    const c = structuredClone(base);
    c.outputs[0].time.tolerance_s = 0.05;
    const p = structuredClone(c);
    f(p.outputs[0]);
    expect(looseningError(c, p)).toBeTruthy();
  });
  test("a dropped output is refused", () => {
    expect(looseningError(base, { family: ["F1"], outputs: [] })).toMatch(
      /dropped/,
    );
  });
  test("a tolerance that is the default is not loosened by saying nothing", () => {
    const c = out({ time: { start_s: 1, tolerance_s: 0.1 } });
    expect(looseningError(c, out({ time: { start_s: 1 } }))).toBeNull();
  });
});

describe("in the machine", () => {
  const READY = async (steps) => {
    const policy = policyOf(steps);
    const m = createMachine({
      policy,
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile,
    });
    await m.dispatch({ type: "capabilityChecked", ok: true });
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    return { m, policy };
  };
  const loose = structuredClone(SPEC_2MB);
  loose.outputs[0].time = { tolerance_s: 60 };

  test("a first spec with an out-of-bound number is an invalid turn the model is told about", async () => {
    const { m, policy } = await READY([spec(loose), spec()]);
    await m.dispatch({ type: "requestSubmitted", request: "x" });
    const s = m.getState();
    expect(s).toMatchObject({ name: "awaitingConfirm", invalidTurns: 1 });
    expect(s.spec).toEqual(SPEC_2MB);
    expect(JSON.parse(policy.calls[1].at(-1).content).error).toMatch(
      /tolerance_s/,
    );
  });

  test("after a failed check the model cannot loosen the confirmed spec: the old spec still grades the next run", async () => {
    const tight = structuredClone(SPEC_2MB);
    tight.outputs[0].time = { tolerance_s: 0.1 };
    const looser = structuredClone(SPEC_2MB); // drops the tolerance and raises the size cap
    looser.outputs[0].size_max_bytes = 20_000_000;
    const { m, policy } = await READY([
      spec(tight),
      run(), // 3.2 MB: fails the 2 MB cap
      spec(looser), // would make the same output pass
      run(["-i", "{in:clip}", "-crf", "26", "{out:out1}"]), // 1.7 MB: passes the REAL spec
    ]);
    await m.dispatch({ type: "requestSubmitted", request: "x" });
    await m.dispatch({ type: "confirmed" });
    const s = m.getState();
    expect(s.name).toBe("done");
    expect(s.invalidTurns).toBe(1);
    expect(s.spec).toEqual(tight); // never replaced
    expect(JSON.parse(policy.calls[3].at(-1).content).error).toMatch(
      /already confirmed/,
    );
  });

  test("a later spec that only tightens still goes back to the person", async () => {
    const stricter = structuredClone(SPEC_2MB);
    stricter.outputs[0].quality = { min_ssim: 0.95 }; // a new constraint
    const { m } = await READY([spec(), run(), spec(stricter)]);
    await m.dispatch({ type: "requestSubmitted", request: "x" });
    await m.dispatch({ type: "confirmed" });
    expect(m.getState()).toMatchObject({ name: "awaitingConfirm" });
    expect(m.getState().spec).toEqual(stricter);
  });
});
