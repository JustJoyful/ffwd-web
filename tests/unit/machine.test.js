import { describe, expect, test } from "vitest";
import { createMachine } from "../../app/agent/machine.js";
import {
  ERROR_CODES,
  MACHINE_REASON,
  MODEL_ERROR_TEXT,
} from "../../app/model/contract.js";
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

/** A machine at awaitingRequest with a file already probed. */
async function ready(steps, over = {}) {
  const policy = policyOf(steps);
  const executor = over.executor ?? fakeExecutor();
  const measure = over.measure ?? fakeMeasure();
  const m = createMachine({
    policy,
    executor,
    measure,
    probeFile: over.probeFile ?? probeFile,
  });
  const names = [m.getState().name]; // subscribe only sees changes, so start from the initial state
  m.subscribe((s) => names.push(s.name));
  await m.dispatch({ type: "capabilityChecked", ok: true });
  await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
  const states = () => names.filter((n, i) => n !== names[i - 1]);
  return { m, policy, executor, measure, states, s: () => m.getState() };
}
const submit = (m, request = "make it under 2 MB") =>
  m.dispatch({ type: "requestSubmitted", request });
const confirm = (m) => m.dispatch({ type: "confirmed" });
const lastUser = (policy) => {
  const c = policy.calls.at(-1);
  return JSON.parse(c.at(-1).content);
};

describe("start-up states", () => {
  test("checkingCapability -> ready -> probing -> awaitingRequest", async () => {
    const e = await ready([]);
    expect(e.states()).toEqual([
      "checkingCapability",
      "ready",
      "probing",
      "awaitingRequest",
    ]);
    expect(e.s().inputs[0]).toMatchObject({ id: "clip", handle: "in/a.mp4" });
  });
  test("a device that cannot run the tool ends in unsupportedDevice with the reason", async () => {
    const m = createMachine({
      policy: policyOf([]),
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile,
    });
    await m.dispatch({
      type: "capabilityChecked",
      ok: false,
      reason: "no WebGPU",
    });
    expect(m.getState()).toMatchObject({
      name: "unsupportedDevice",
      reason: "no WebGPU",
    });
  });
  test("a file that cannot be probed returns to ready with an error", async () => {
    const e = await ready([], {
      probeFile: () => Promise.reject(new Error("bad file")),
    });
    expect(e.s()).toMatchObject({
      name: "ready",
      error: expect.stringContaining("bad file"),
    });
  });
  test("an event that does not belong to the current state changes nothing", async () => {
    const e = await ready([spec()]);
    const before = e.s();
    await confirm(e.m);
    await e.m.dispatch({ type: "answered", text: "x" });
    await e.m.dispatch({ type: "bogus" });
    expect(e.s()).toBe(before);
  });
});

describe("the 3.2 MB then 1.7 MB story", () => {
  test("spec, run (crf 23) fails the size check, run (crf 26) passes", async () => {
    const e = await ready([
      spec(),
      run(["-i", "{in:clip}", "-crf", "23", "{out:out1}"]),
      run(["-i", "{in:clip}", "-crf", "26", "{out:out1}"]),
    ]);
    await submit(e.m);
    expect(e.s()).toMatchObject({ name: "awaitingConfirm", spec: SPEC_2MB });
    expect(e.s().plan).toEqual([
      "Result: a video (MP4)",
      "File size: at most 2 MB",
    ]);
    await confirm(e.m);
    expect(e.states().slice(-7)).toEqual([
      "planning",
      "awaitingConfirm",
      "running",
      "checking",
      "running",
      "checking",
      "done",
    ]);
    const s = e.s();
    expect(s.runs).toBe(2);
    expect(s.history).toHaveLength(2);
    const size = (r) => r.checks.find((c) => c.field === "size_max_bytes");
    expect(size(s.history[0])).toMatchObject({
      actual: 3_200_000,
      ok: false,
      output: "out1",
    });
    expect(size(s.history[1])).toMatchObject({ actual: 1_700_000, ok: true });
    expect(s.history.map((r) => r.passed)).toEqual([false, true]);
    expect(e.executor.calls.map((c) => c.args[3])).toEqual(["23", "26"]);
  });
  test("the model sees the failed check before its second run", async () => {
    const e = await ready([
      spec(),
      run(),
      run(["-i", "{in:clip}", "-crf", "26", "{out:out1}"]),
    ]);
    await submit(e.m);
    await confirm(e.m);
    const fed = e.policy.calls[2].at(-1);
    expect(fed.role).toBe("user");
    expect(JSON.parse(fed.content).checks.out1.failed[0]).toMatchObject({
      field: "size_max_bytes",
      actual: 3_200_000,
    });
  });
  test("check is run after every run without the model asking, and a pass ends the job", async () => {
    const e = await ready(
      [spec(), run(["-i", "{in:clip}", "-crf", "30", "{out:out1}"])],
      {
        measure: fakeMeasure({ sizes: [1_000_000] }),
      },
    );
    await submit(e.m);
    await confirm(e.m);
    expect(e.s().name).toBe("done");
    expect(e.measure.calls.some((c) => c[0] === "probe")).toBe(true);
    expect(e.policy.calls).toHaveLength(2); // spec, run: no turn spent on check or finish
  });
  test("done accepts a new request on the same file", async () => {
    const e = await ready([spec(), run()], {
      measure: fakeMeasure({ sizes: [1_000_000] }),
    });
    await submit(e.m);
    await confirm(e.m);
    await e.m.dispatch({ type: "newRequest" });
    expect(e.s()).toMatchObject({
      name: "awaitingRequest",
      runs: 0,
      history: [],
    });
    expect(e.s().inputs).toHaveLength(1);
  });
});

describe("budgets", () => {
  test("four failing runs end in failed, and a fifth run is never executed", async () => {
    const e = await ready([spec(), run(), run(), run(), run(), run()], {
      measure: fakeMeasure({ sizes: [3_200_000] }),
    });
    await submit(e.m);
    await confirm(e.m);
    expect(e.s()).toMatchObject({
      name: "failed",
      reason: "run_budget",
      runs: 4,
    });
    expect(e.executor.calls).toHaveLength(4);
    expect(e.policy.calls).toHaveLength(5); // the 5th run was never asked for
    expect(e.s().history).toHaveLength(4);
  });
  test("a run the allowlist rejects is counted like Python counts it: four rejections end the job", async () => {
    const bad = run(["-y", "-i", "{in:clip}", "{out:out1}"]);
    const e = await ready([spec(), bad, bad, bad, bad]);
    await submit(e.m);
    await confirm(e.m);
    expect(e.s()).toMatchObject({
      name: "failed",
      reason: "run_budget",
      runs: 4,
    });
    expect(e.executor.calls).toHaveLength(0);
  });
  test("a rejected run is fed back to the policy with its reason", async () => {
    const e = await ready(
      [spec(), run(["-y", "-i", "{in:clip}", "{out:out1}"]), run()],
      { measure: fakeMeasure({ sizes: [1_000_000] }) },
    );
    await submit(e.m);
    await confirm(e.m);
    const fed = JSON.parse(e.policy.calls[2].at(-1).content);
    expect(fed).toEqual({
      run_ok: false,
      rejected: "option not allowed: -y",
      stderr_tail: "rejected: option not allowed: -y",
    });
    expect(e.s()).toMatchObject({ name: "done", runs: 2 });
    expect(e.s().history[0]).toMatchObject({
      rejected: "option not allowed: -y",
      passed: false,
    });
  });
  test("an input or output id the job does not have is rejected, not run", async () => {
    const wrong = act({
      action: "run",
      args: ["-i", "{in:other}", "{out:out1}"],
      inputs: ["other"],
      outputs: ["out1"],
    });
    const e = await ready([spec(), wrong, run()], {
      measure: fakeMeasure({ sizes: [1_000_000] }),
    });
    await submit(e.m);
    await confirm(e.m);
    expect(e.s().history[0].rejected).toBe("unknown id: other");
    expect(e.executor.calls).toHaveLength(1);
  });
  test("a policy that returns garbage 8 times ends in failed (turn budget)", async () => {
    const e = await ready(Array(8).fill("not json"));
    await submit(e.m);
    expect(e.s()).toMatchObject({
      name: "failed",
      reason: "turn_budget",
      invalidTurns: 8,
    });
    expect(e.policy.calls).toHaveLength(8);
  });
  test("a policy that has nothing to say (empty replies) is garbage too", async () => {
    const e = await ready([]);
    await submit(e.m);
    expect(e.s()).toMatchObject({ name: "failed", reason: "turn_budget" });
    expect(e.policy.calls).toHaveLength(8);
  });
  test("a policy that throws ends in failed with the error, not an exception", async () => {
    const m = createMachine({
      policy: () => Promise.reject(new Error("GPU lost")),
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile,
    });
    await m.dispatch({ type: "capabilityChecked", ok: true });
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    await submit(m);
    expect(m.getState()).toMatchObject({
      name: "failed",
      reason: "policy_error",
    });
    expect(m.getState().error).toContain("GPU lost");
  });
});

/** Replies from `steps`, then throws `err` (what the model client does when the worker reports an error). */
function throwingAfter(steps, err) {
  const inner = policyOf(steps);
  const policy = async (messages) => {
    policy.seen += 1;
    if (policy.seen > steps.length) throw err;
    return inner(messages);
  };
  policy.seen = 0;
  return policy;
}
const modelError = (code) =>
  Object.assign(new Error(`worker: ${code}`), { code });

describe("a model error ends the job (the contract's MACHINE_REASON and MODEL_ERROR_TEXT)", () => {
  /** A machine whose policy answers `steps` and then throws `err`. */
  async function withThrow(steps, err, over = {}) {
    const policy = throwingAfter(steps, err);
    const m = createMachine({
      policy,
      executor: over.executor ?? fakeExecutor(),
      measure: over.measure ?? fakeMeasure(),
      probeFile,
    });
    await m.dispatch({ type: "capabilityChecked", ok: true });
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    return { m, policy, s: () => m.getState() };
  }

  test.each(ERROR_CODES)(
    "%s on the first turn: failed with its reason and sentence",
    async (code) => {
      const e = await withThrow([], modelError(code));
      await submit(e.m);
      expect(e.s()).toMatchObject({
        name: "failed",
        reason: MACHINE_REASON[code],
        error: MODEL_ERROR_TEXT[code],
        runs: 0,
        turns: 0,
      });
      expect(e.policy.seen).toBe(1); // never retried silently
    },
  );
  test("context_full reads as too_long with the 'too long ... not done' sentence", async () => {
    const e = await withThrow([], modelError("context_full"));
    await submit(e.m);
    expect(e.s().reason).toBe("too_long");
    expect(e.s().error).toMatch(/too long .* not done/);
  });
  test.each(ERROR_CODES)(
    "%s after a failed run keeps the history and run counts, and is not success",
    async (code) => {
      const e = await withThrow([spec(), run()], modelError(code), {
        measure: fakeMeasure({ sizes: [3_200_000] }),
      });
      await submit(e.m);
      await confirm(e.m);
      const s = e.s();
      expect(s).toMatchObject({
        name: "failed",
        reason: MACHINE_REASON[code],
        error: MODEL_ERROR_TEXT[code],
        runs: 1,
        turns: 2,
        spec: SPEC_2MB,
      });
      expect(s.history).toHaveLength(1);
      expect(s.history[0]).toMatchObject({ n: 1, passed: false });
      expect(e.policy.seen).toBe(3);
    },
  );
  test("an error after a run that PASSED cannot happen (the job is already done), but one on a later job still fails", async () => {
    const e = await withThrow([spec(), run()], modelError("generate_failed"), {
      measure: fakeMeasure({ sizes: [1_000_000] }),
    });
    await submit(e.m);
    await confirm(e.m);
    expect(e.s().name).toBe("done");
    await e.m.dispatch({ type: "newRequest" });
    await submit(e.m);
    expect(e.s()).toMatchObject({
      name: "failed",
      reason: "model_unavailable",
    });
  });
  test("an error whose code is not in the contract keeps policy_error", async () => {
    const e = await withThrow([], modelError("something_new"));
    await submit(e.m);
    expect(e.s()).toMatchObject({ name: "failed", reason: "policy_error" });
    expect(e.s().error).toContain("something_new");
  });
  test("a code that is an inherited property name (toString) is not a known code", async () => {
    const e = await withThrow([], modelError("toString"));
    await submit(e.m);
    expect(e.s().reason).toBe("policy_error");
  });
  test("a non-Error rejection and an Error without a code keep policy_error", async () => {
    for (const err of ["boom", new Error("plain"), { code: "context_full" }]) {
      const e = await withThrow([], err);
      await submit(e.m);
      expect(e.s()).toMatchObject({ name: "failed", reason: "policy_error" });
    }
  });
  test("a failed model job offers newRequest as before", async () => {
    const e = await withThrow([], modelError("context_full"));
    await submit(e.m);
    await e.m.dispatch({ type: "newRequest" });
    expect(e.s()).toMatchObject({
      name: "awaitingRequest",
      reason: null,
      error: null,
      runs: 0,
      history: [],
    });
    expect(e.s().inputs).toHaveLength(1);
  });
  test("an error while answering or confirming also ends the job with the typed reason", async () => {
    const ask = act({ action: "ask_user", question: "Which part?" });
    const a = await withThrow([ask], modelError("out_of_memory"));
    await submit(a.m);
    await a.m.dispatch({ type: "answered", text: "the start" });
    expect(a.s()).toMatchObject({
      name: "failed",
      reason: "model_unavailable",
      error: MODEL_ERROR_TEXT.out_of_memory,
    });
    const c = await withThrow([spec()], modelError("aborted"));
    await submit(c.m);
    await confirm(c.m);
    expect(c.s()).toMatchObject({
      name: "failed",
      reason: "aborted",
      error: "The job was stopped.",
    });
  });
});

describe("malformed model output is fed back, within the turn budget", () => {
  test('{"action":"check"} from the policy is rejected and fed back', async () => {
    const e = await ready([act({ action: "check" }), spec()]);
    await submit(e.m);
    expect(lastUser(e.policy).error).toMatch(/^invalid action: /);
    expect(e.s()).toMatchObject({ name: "awaitingConfirm", invalidTurns: 1 });
  });
  test("prose around the JSON is fed back with Python's message", async () => {
    const e = await ready(["Here you go: " + spec(), spec()]);
    await submit(e.m);
    expect(e.policy.calls[1].at(-1).content).toContain('"error"');
    expect(e.s().invalidTurns).toBe(1);
  });
  test("a run before any spec is an invalid turn, not a run", async () => {
    const e = await ready([run(), spec()]);
    await submit(e.m);
    expect(lastUser(e.policy)).toEqual({
      error: "emit a spec action first; a run before a spec is rejected",
    });
    expect(e.s()).toMatchObject({
      runs: 0,
      invalidTurns: 1,
      name: "awaitingConfirm",
    });
    expect(e.executor.calls).toHaveLength(0);
  });
  test("finish without a passing check is refused", async () => {
    const finish = act({ action: "finish", outputs: ["out1"], note: "done" });
    const e = await ready(
      [
        spec(),
        run(),
        finish,
        run(["-i", "{in:clip}", "-crf", "30", "{out:out1}"]),
      ],
      {
        measure: fakeMeasure({ sizes: [3_200_000, 1_000_000] }),
      },
    );
    await submit(e.m);
    await confirm(e.m);
    expect(JSON.parse(e.policy.calls[3].at(-1).content)).toEqual({
      error: "finish requires a passing check",
    });
    expect(e.s().name).toBe("done");
  });
});

describe("asking the user, unsupported, editing", () => {
  const ask = act({
    action: "ask_user",
    question: "Which part do you want to keep?",
  });
  test("ask_user pauses in askingUser until an answer is dispatched", async () => {
    const e = await ready([ask, spec()]);
    await submit(e.m);
    expect(e.s()).toMatchObject({
      name: "askingUser",
      question: "Which part do you want to keep?",
    });
    expect(e.policy.calls).toHaveLength(1);
    await e.m.dispatch({ type: "answered", text: "the first 3 seconds" });
    expect(lastUser(e.policy)).toEqual({ answer: "the first 3 seconds" });
    expect(e.s().name).toBe("awaitingConfirm");
    expect(e.states().slice(-4)).toEqual([
      "planning",
      "askingUser",
      "planning",
      "awaitingConfirm",
    ]);
  });
  test("only one question is allowed per job; the second goes back as an error", async () => {
    const e = await ready([ask, ask, spec()]);
    await submit(e.m);
    await e.m.dispatch({ type: "answered", text: "x" });
    expect(lastUser(e.policy)).toEqual({
      error: "only one question is allowed per job",
    });
    expect(e.s()).toMatchObject({ name: "awaitingConfirm", invalidTurns: 1 });
  });
  test("unsupported ends in unsupported with the reason", async () => {
    const e = await ready([
      act({ action: "unsupported", reason: "I cannot remove objects" }),
    ]);
    await submit(e.m, "remove the dog");
    expect(e.s()).toMatchObject({
      name: "unsupported",
      reason: "I cannot remove objects",
    });
    await e.m.dispatch({ type: "newRequest" });
    expect(e.s().name).toBe("awaitingRequest");
  });
  test("editing the request at the confirmation step starts planning again with the new request", async () => {
    const e = await ready([spec(), spec()]);
    await submit(e.m, "make it small");
    await e.m.dispatch({
      type: "requestEdited",
      request: "make it under 1 MB",
    });
    expect(e.s().name).toBe("awaitingConfirm");
    expect(JSON.parse(e.policy.calls[1][1].content).request).toBe(
      "make it under 1 MB",
    );
    expect(e.policy.calls[1]).toHaveLength(2); // a fresh conversation, not a continuation
  });
});

describe("subscribe", () => {
  test("is called on every state change, and unsubscribe stops it", async () => {
    const e = await ready([spec()]);
    const seen = [];
    const off = e.m.subscribe((s) => seen.push(s.name));
    await submit(e.m);
    expect(seen).toEqual(["planning", "awaitingConfirm"]);
    off();
    await confirm(e.m); // would go on to running/checking
    expect(seen).toEqual(["planning", "awaitingConfirm"]);
  });
  test("getState returns the same object until something changes", async () => {
    const e = await ready([spec()]);
    expect(e.s()).toBe(e.s());
    const before = e.s();
    await submit(e.m);
    expect(e.s()).not.toBe(before);
    expect(before.name).toBe("awaitingRequest"); // earlier snapshots are never mutated
  });
});
