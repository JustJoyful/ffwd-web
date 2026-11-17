import { describe, expect, test } from "vitest";
import {
  createJob,
  executeRun,
  initialMessages,
  nextAction,
  observe,
  pyJson,
} from "../../app/agent/loop.js";
import { MAX_RUNS, MAX_TURNS } from "../../app/agent/config.js";
import { scriptedPolicy } from "../../app/agent/scripted-policy.js";
import {
  SPEC_2MB,
  fakeExecutor,
  fakeMeasure,
  probeOf,
  run,
  spec,
} from "./engine-fakes.js";

describe("budgets come from config.js, mirroring training/config.py", () => {
  test("4 runs, 8 turns", () => {
    expect([MAX_RUNS, MAX_TURNS]).toEqual([4, 8]);
  });
});

describe("pyJson writes what Python's json.dumps writes (the model was trained on that text)", () => {
  test("separators, null/true/false, escapes non-ASCII", () => {
    expect(pyJson({ a: [1, "é"], b: null, c: true, d: false })).toBe(
      '{"a": [1, "\\u00e9"], "b": null, "c": true, "d": false}',
    );
    expect(pyJson({ error: 'é\n"q"', a: [1, 2.5, null, true] })).toBe(
      '{"error": "\\u00e9\\n\\"q\\"", "a": [1, 2.5, null, true]}',
    );
    expect(pyJson("a – b")).toBe('"a \\u2013 b"');
    expect(pyJson("😀")).toBe('"\\ud83d\\ude00"');
  });
  test("empty containers and nesting", () => {
    expect(pyJson({ a: {}, b: [], c: [[1], {}] })).toBe(
      '{"a": {}, "b": [], "c": [[1], {}]}',
    );
  });
  test("undefined values are left out, like a missing key", () => {
    expect(pyJson({ a: 1, b: undefined })).toBe('{"a": 1}');
  });
});

describe("the first user message equals Python's _first_user_message", () => {
  test("measured from training/env/loop.py (floats that are whole numbers are the one known difference)", () => {
    const probe = {
      container: "mov,mp4,m4a,3gp,3g2,mj2",
      duration_s: 4.5,
      size_bytes: 3200000,
      bit_rate: 5000,
      streams: [
        {
          index: 0,
          type: "video",
          codec: "h264",
          width: 1280,
          height: 720,
          fps: 29.97,
          pix_fmt: "yuv420p",
          rotation: 0,
          start_time_s: 0.5,
          duration_s: 4.5,
        },
      ],
    };
    const msgs = initialMessages({
      request: "shrink it – under 2 MB",
      inputs: [{ id: "clip", probe }],
      outputIds: ["out1"],
      systemPrompt: "SYS",
    });
    expect(msgs[0]).toEqual({ role: "system", content: "SYS" });
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe(
      '{"request": "shrink it \\u2013 under 2 MB", "inputs": [{"id": "clip", "probe": {"container": "mov,mp4,m4a,3gp,3g2,mj2", "duration_s": 4.5, "size_bytes": 3200000, "bit_rate": 5000, "streams": [{"index": 0, "type": "video", "codec": "h264", "width": 1280, "height": 720, "fps": 29.97, "pix_fmt": "yuv420p", "rotation": 0, "start_time_s": 0.5, "duration_s": 4.5}]}}], "outputs": ["out1"]}',
    );
  });
  test("the system prompt defaults to the pinned system-v1", () => {
    const [s] = initialMessages({
      request: "x",
      inputs: [],
      outputIds: ["out1"],
    });
    expect(s.content).toContain("You are ffmpeg-agent");
    expect(s.content).toContain("A run before a spec is rejected");
  });
});

const newJob = () =>
  createJob({
    request: "make it smaller",
    inputs: [{ id: "clip", probe: probeOf(), handle: "in/a.mp4" }],
    outputIds: ["out1"],
    systemPrompt: "SYS",
  });

describe("nextAction and observe", () => {
  test("a reply is parsed and the conversation grows by observe()", async () => {
    const job = newJob();
    const policy = scriptedPolicy([spec(), "nonsense"]);
    const a = await nextAction(job, policy);
    expect(a.action).toMatchObject({ action: "spec" });
    observe(job, a.reply, { spec: "confirmed" });
    expect(job.turns).toBe(1);
    expect(job.messages.slice(-2)).toEqual([
      { role: "assistant", content: spec() },
      { role: "user", content: '{"spec": "confirmed"}' },
    ]);
    const b = await nextAction(job, policy);
    expect(b).toMatchObject({
      error: expect.stringContaining("not a JSON object"),
    });
    expect(policy.calls[1]).toHaveLength(4); // system, user, assistant, user
  });
  test("an invalid reply counts as an invalid turn only once observed", async () => {
    const job = newJob();
    const a = await nextAction(job, scriptedPolicy(["nonsense"]));
    observe(job, a.reply, { error: a.error }, { invalid: true });
    expect(job.invalidTurns).toBe(1);
    expect(job.turns).toBe(1);
  });
});

describe("executeRun: validate, execute, check (training/env/loop.py _do_run)", () => {
  const checkingJob = () => {
    const job = newJob();
    job.spec = SPEC_2MB;
    job.confirmed = true;
    return job;
  };
  const action = JSON.parse(run());
  test("a rejected run is counted, never executed, and fed back with Python's keys", async () => {
    const job = checkingJob();
    const ex = fakeExecutor();
    const r = await executeRun(
      job,
      { ...action, args: ["-y", ...action.args] },
      { executor: ex, measure: fakeMeasure() },
    );
    expect(ex.calls).toHaveLength(0);
    expect(job.runs).toBe(1);
    expect(r.passed).toBe(false);
    expect(r.obs).toEqual({
      run_ok: false,
      rejected: "option not allowed: -y",
      stderr_tail: "rejected: option not allowed: -y",
    });
    expect(job.history[0]).toMatchObject({
      n: 1,
      rejected: "option not allowed: -y",
      passed: false,
    });
  });
  test("an executor failure is counted and reported with the log tail", async () => {
    const job = checkingJob();
    const r = await executeRun(job, action, {
      executor: fakeExecutor({ fail: true }),
      measure: fakeMeasure(),
    });
    expect(r.obs).toEqual({
      run_ok: false,
      rejected: null,
      stderr_tail: "ffmpeg: boom",
    });
    expect(job.runs).toBe(1);
  });
  test("an executor that throws is a failed run, not an exception", async () => {
    const job = checkingJob();
    const r = await executeRun(job, action, {
      executor: { run: () => Promise.reject(new Error("worker died")) },
      measure: fakeMeasure(),
    });
    expect(r.passed).toBe(false);
    expect(r.obs.run_ok).toBe(false);
    expect(r.obs.stderr_tail).toContain("worker died");
  });
  test("a passing and a failing check are reported with only the failed fields", async () => {
    const job = checkingJob();
    const bad = await executeRun(job, action, {
      executor: fakeExecutor(),
      measure: fakeMeasure({ sizes: [3_200_000] }),
    });
    expect(bad.passed).toBe(false);
    expect(bad.obs).toEqual({
      run_ok: true,
      checks: {
        out1: {
          passed: false,
          error: null,
          failed: [
            {
              field: "size_max_bytes",
              expected: 2_000_000,
              actual: 3_200_000,
              ok: false,
            },
          ],
        },
      },
      missing_outputs: [],
    });
    const good = await executeRun(job, action, {
      executor: fakeExecutor(),
      measure: fakeMeasure({ sizes: [1_700_000] }),
    });
    expect(good.passed).toBe(true);
    expect(job.history.map((h) => h.passed)).toEqual([false, true]);
  });
  test("an output the spec lists but the run did not write is missing and fails the run", async () => {
    const job = checkingJob();
    job.spec = {
      family: ["F6"],
      outputs: [
        ...SPEC_2MB.outputs,
        { id: "out2", kind: "audio", container: "mp3" },
      ],
    };
    const r = await executeRun(job, action, {
      executor: fakeExecutor(),
      measure: fakeMeasure({ sizes: [1_700_000] }),
    });
    expect(r.passed).toBe(false);
    expect(r.obs.missing_outputs).toEqual(["out2"]);
  });
  test("the checker sees the confirmed spec and onChecking fires between run and check", async () => {
    const job = checkingJob();
    const seen = [];
    await executeRun(
      job,
      action,
      {
        executor: fakeExecutor(),
        measure: fakeMeasure({ sizes: [1_700_000] }),
      },
      { onChecking: () => seen.push("checking") },
    );
    expect(seen).toEqual(["checking"]);
  });
});

describe("scriptedPolicy", () => {
  test("replies in order, records what it was shown, then answers empty", async () => {
    const p = scriptedPolicy(["a", "b"]);
    expect(await p([{ role: "user", content: "1" }])).toBe("a");
    expect(await p([{ role: "user", content: "2" }])).toBe("b");
    expect(await p([])).toBe("");
    expect(p.calls.map((c) => c.length)).toEqual([1, 1, 0]);
  });
});
