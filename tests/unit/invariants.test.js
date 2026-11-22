// The agent loop's invariants (ARCHITECTURE §3.1, RULES §1), driven end to end through the state machine with scripted
// policies. Each test names the rule it pins; the fuzz at the end throws random scripts at all of them at once.
import { describe, expect, test } from "vitest";
import { MAX_ASK_USER, MAX_RUNS, MAX_TURNS } from "../../app/agent/config.js";
import { createMachine } from "../../app/agent/machine.js";
import {
  act,
  fakeExecutor,
  fakeMeasure,
  policyOf,
  probeFile,
  run,
  spec,
} from "./engine-fakes.js";

const FINISH = act({ action: "finish", outputs: ["out1"], note: "done" });
const ASK = act({ action: "ask_user", question: "Which part?" });
const REJECTED = run(["-y", "-i", "{in:clip}", "{out:out1}"]); // -y is not on the allowlist
const PASS = { sizes: [1_000_000] };
const FAIL = { sizes: [3_200_000] };

/** Drive a job to rest the way a person would: confirm every spec, answer every question. */
async function play(steps, measureOpts = FAIL) {
  const policy = policyOf(steps);
  const executor = fakeExecutor();
  const measure = fakeMeasure(measureOpts);
  const m = createMachine({ policy, executor, measure, probeFile });
  await m.dispatch({ type: "capabilityChecked", ok: true });
  await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
  await m.dispatch({ type: "requestSubmitted", request: "make it under 2 MB" });
  for (let i = 0; i < 50; i++) {
    const name = m.getState().name;
    if (name === "awaitingConfirm") await m.dispatch({ type: "confirmed" });
    else if (name === "askingUser")
      await m.dispatch({ type: "answered", text: "the start" });
    else break;
  }
  return { m, policy, executor, measure, s: m.getState() };
}

describe("budgets", () => {
  test("config: MAX_RUNS 4, MAX_TURNS 8, one question", () => {
    expect([MAX_RUNS, MAX_TURNS, MAX_ASK_USER]).toEqual([4, 8, 1]);
  });
  test("a long script never gets more than MAX_RUNS runs executed", async () => {
    const e = await play([spec(), ...Array(20).fill(run())]);
    expect(e.executor.calls).toHaveLength(MAX_RUNS);
    expect(e.s).toMatchObject({ name: "failed", reason: "run_budget" });
  });
  test("invalid turns between runs still end the job at MAX_TURNS, with fewer than MAX_RUNS runs", async () => {
    // turns: spec(1) run(2) then six replies that are not actions (3..8)
    const e = await play([spec(), run(), ...Array(10).fill("nope")]);
    expect(e.s).toMatchObject({
      name: "failed",
      reason: "turn_budget",
      turns: MAX_TURNS,
      runs: 1,
      invalidTurns: 6,
    });
    expect(e.policy.calls).toHaveLength(MAX_TURNS);
    expect(e.executor.calls).toHaveLength(1);
  });
  test("a policy that never stops is asked at most MAX_TURNS times", async () => {
    const e = await play(Array(100).fill(spec()));
    expect(e.policy.calls.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(e.s.name).toBe("failed");
  });
});

describe("check is the harness's, not the model's", () => {
  test("every executed run is checked (the output is measured) without any model action", async () => {
    const e = await play([spec(), run(), run(), run()], FAIL);
    expect(e.executor.calls).toHaveLength(3);
    const probed = e.measure.calls
      .filter((c) => c[0] === "probe")
      .map((c) => c[1]);
    for (let n = 1; n <= 3; n++) expect(probed).toContain(`run${n}/out1`);
    expect(e.s.history).toHaveLength(3);
    for (const r of e.s.history) expect(r.checks.length).toBeGreaterThan(0);
  });
  test("the model cannot claim a check: a check action or a fake result object is invalid and checks nothing", async () => {
    const e = await play(
      [
        spec(),
        act({ action: "check" }),
        act({
          action: "run",
          args: ["-i", "{in:clip}", "{out:out1}"],
          inputs: ["clip"],
          outputs: ["out1"],
          passed: true,
        }),
        run(),
      ],
      FAIL,
    );
    expect(e.s.history.every((r) => !r.passed)).toBe(true);
    expect(e.s.name).not.toBe("done");
    expect(e.s.history).toHaveLength(1); // only the plain run reached the harness
  });
  test("finish with no run at all is refused, and the job is not done", async () => {
    const e = await play([spec(), FINISH, FINISH, FINISH]);
    expect(e.s.name).not.toBe("done");
    expect(e.s.runs).toBe(0);
    expect(JSON.parse(e.policy.calls[2].at(-1).content)).toEqual({
      error: "finish requires a passing check",
    });
  });
  test("finish right after a FAILED check is refused and the failure stays in the history", async () => {
    const e = await play(
      [spec(), run(), FINISH, FINISH, "x", "x", "x", "x"],
      FAIL,
    );
    expect(e.s).toMatchObject({ name: "failed", reason: "turn_budget" });
    expect(e.s.history.map((r) => r.passed)).toEqual([false]);
  });
  test("a failed check never becomes done, even when the model says finish four times", async () => {
    const e = await play(
      [spec(), run(), FINISH, FINISH, FINISH, FINISH, FINISH],
      FAIL,
    );
    expect(e.s.name).toBe("failed");
  });
  test("a passing check ends the job as done without a model finish, and only a passing run does", async () => {
    const e = await play([spec(), run(), run()], {
      sizes: [3_200_000, 1_000_000],
    });
    expect(e.s.name).toBe("done");
    expect(e.s.history.at(-1).passed).toBe(true);
    expect(e.policy.calls).toHaveLength(3);
  });
});

describe("ask_user and unsupported", () => {
  test("at most one question: the second goes back as invalid and the job carries on", async () => {
    const e = await play([ASK, ASK, spec(), run()], PASS);
    const second = e.policy.calls[2].at(-1);
    expect(JSON.parse(second.content)).toEqual({
      error: "only one question is allowed per job",
    });
    expect(e.s).toMatchObject({ name: "done", invalidTurns: 1 });
    expect(e.policy.calls.filter((_, i) => i < 3)).toHaveLength(3);
  });
  test("a question after the spec was confirmed also counts against the same one-question budget", async () => {
    const e = await play([ASK, spec(), ASK, run()], PASS);
    expect(e.s.invalidTurns).toBe(1);
    expect(e.s.name).toBe("done");
  });
  test("unsupported ends cleanly: no run, no check, not done, the reason kept", async () => {
    const e = await play([
      act({ action: "unsupported", reason: "I cannot remove objects" }),
      run(),
    ]);
    expect(e.s).toMatchObject({
      name: "unsupported",
      reason: "I cannot remove objects",
      runs: 0,
    });
    expect(e.executor.calls).toHaveLength(0);
    expect(e.policy.calls).toHaveLength(1);
  });
});

describe("the model never sees real paths", () => {
  const PATHS = /in\/a\.mp4|run\d+\/out1|\/home|\/tmp|a\.mp4/;
  test("everything the policy is shown (prompt, observations) names ids, never handles or paths", async () => {
    const e = await play([spec(), run(), run(), REJECTED, run()], {
      sizes: [3_200_000, 3_200_000, 1_000_000],
    });
    const shown = e.policy.calls.at(-1).slice(1); // the system prompt describes the placeholders, not paths
    expect(shown.length).toBeGreaterThan(4);
    for (const msg of shown) expect(msg.content).not.toMatch(PATHS);
    expect(shown[0].content).toContain('"id": "clip"');
    expect(shown[0].content).not.toContain("handle");
  });
  test("a run that names a real path, a protocol or a traversal is rejected, not executed", async () => {
    const bad = (a, i = ["clip"]) =>
      act({ action: "run", args: a, inputs: i, outputs: ["out1"] });
    const e = await play([
      spec(),
      bad(["-i", "in/a.mp4", "{out:out1}"]),
      bad(["-i", "http://x/y.mp4", "{out:out1}"]),
      bad(["-i", "{in:clip}", "../escape.mp4"]),
    ]);
    expect(e.executor.calls).toHaveLength(0);
    expect(e.s.history.every((r) => r.rejected)).toBe(true);
  });
});

describe("a run the allowlist rejects", () => {
  // Python parity (training/env/loop.py: `ep.runs += 1` before `_do_run`): the rejected run SPENDS run budget, is never
  // executed, and is not an invalid turn. The invalid-turn counter is for unparseable replies and the like.
  test("is never executed, counts as a run (as in training), and is fed back with its reason", async () => {
    const e = await play([spec(), REJECTED, run()], PASS);
    expect(e.executor.calls).toHaveLength(1);
    expect(e.s).toMatchObject({ name: "done", runs: 2, invalidTurns: 0 });
    expect(e.s.history[0]).toMatchObject({
      rejected: "option not allowed: -y",
      ok: false,
      passed: false,
    });
  });
  test("four rejections use the whole run budget", async () => {
    const e = await play(
      [spec(), REJECTED, REJECTED, REJECTED, REJECTED, run()],
      PASS,
    );
    expect(e.s).toMatchObject({
      name: "failed",
      reason: "run_budget",
      runs: 4,
    });
    expect(e.executor.calls).toHaveLength(0);
  });
});

// Random scripts against every invariant at once. Seeded, so a failure is reproducible from the seed in its name.
describe("fuzz: random scripts", () => {
  const POOL = [
    spec(),
    spec(),
    run(),
    run(),
    run(),
    REJECTED,
    FINISH,
    ASK,
    "garbage",
    "",
    act({ action: "check" }),
  ];
  const lcg = (seed) => () =>
    (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  for (let seed = 1; seed <= 60; seed++) {
    test(`seed ${seed}`, async () => {
      const r = lcg(seed);
      const pick = (xs) => xs[Math.floor(r() * xs.length)];
      const steps = [spec(), ...Array.from({ length: 12 }, () => pick(POOL))];
      const sizes = Array.from({ length: 4 }, () =>
        pick([3_200_000, 1_000_000]),
      );
      const e = await play(steps, { sizes });
      const { s, executor, policy, measure } = e;
      expect(executor.calls.length).toBeLessThanOrEqual(MAX_RUNS);
      expect(s.runs).toBeLessThanOrEqual(MAX_RUNS);
      expect(s.turns).toBeLessThanOrEqual(MAX_TURNS);
      expect(policy.calls.length).toBeLessThanOrEqual(MAX_TURNS);
      expect(s.history).toHaveLength(s.runs);
      // every run that reached ffmpeg was measured by the harness
      const probed = measure.calls
        .filter((c) => c[0] === "probe")
        .map((c) => c[1]);
      for (let n = 1; n <= executor.calls.length; n++)
        expect(probed).toContain(`run${n}/out1`);
      // done means the LAST run passed every check; nothing else ends as done
      if (s.name === "done") {
        expect(s.history.at(-1).passed).toBe(true);
        expect(s.history.at(-1).checks.every((c) => c.ok)).toBe(true);
      }
      expect([
        "done",
        "failed",
        "unsupported",
        "awaitingConfirm",
        "askingUser",
      ]).toContain(s.name);
      // a rejected run was never executed
      expect(s.history.filter((h) => !h.rejected)).toHaveLength(
        executor.calls.length,
      );
      // at most one question was ever answered (a second is fed back as an error instead)
      const last = policy.calls.at(-1) ?? [];
      expect(
        last.filter(
          (m) => m.role === "user" && m.content.startsWith('{"answer"'),
        ).length,
      ).toBeLessThanOrEqual(MAX_ASK_USER);
    });
  }
});
