// The agent loop's turn logic (ARCHITECTURE §3.1), ported from training/env/loop.py and the spike's mini-loop.ts.
// It is a set of small steps over a mutable `job` record; machine.js decides which state the UI is in between them.
// Same decisions as Python: every policy call is a turn (invalid ones too); a `run` is counted BEFORE it is
// validated, so an allowlist rejection spends the run budget exactly as in training; `check` is never an action,
// the harness runs it after every executed run.
import { parseAction } from "./actions.js";
import { check } from "./checker/index.js";
import { STDERR_TAIL_CHARS } from "./config.js";
import { validateRun } from "./validator.js";
import SYSTEM_PROMPT from "../../protocol/prompts/system-v1.txt?raw";

/**
 * @typedef {import("./scripted-policy.js").Message} Message
 * @typedef {import("./scripted-policy.js").Policy} Policy
 * @typedef {import("./checker/index.js").Handle} Handle
 * @typedef {import("./checker/index.js").Measure} Measure
 * @typedef {{ id: string, probe: object, handle: Handle }} JobInput one input file, probed
 * @typedef {{ run(action: { args: string[], inputs: string[], outputs: string[], specs: object[] }): Promise<{ ok: boolean, log: string, outputs: Record<string, Handle>, error?: string }> }} Executor
 * @typedef {object} Run one executed (or rejected) run, kept with its checks even when they failed
 * @property {number} n 1-based
 * @property {string[]} args
 * @property {boolean} ok FFmpeg ran and wrote output
 * @property {string | null} rejected the allowlist reason, when it never ran
 * @property {string | null} error executor error text, when FFmpeg failed
 * @property {boolean} passed every spec output was produced and passed
 * @property {Array<{ output: string, field: string, expected: unknown, actual: unknown, ok: boolean }>} checks
 * @property {string[]} errors per-output check errors ("out1: output has no media")
 * @property {Record<string, Handle>} outputs what FFmpeg wrote, by output id (the page reads the passing one to save it)
 */

/**
 * Python's json.dumps(x) text: ", " and ": " separators, non-ASCII escaped. The model was trained on prompts and
 * observations in exactly this form, so the browser reproduces it instead of JSON.stringify's compact text.
 * shortcut: a number that is whole prints as "4", Python prints a float as "4.0"; JavaScript cannot tell them
 * apart. Plan E's browser parity check (A3) measures whether this matters.
 * @param {unknown} x
 * @returns {string}
 */
export function pyJson(x) {
  if (x === null || typeof x !== "object")
    return JSON.stringify(x).replace(
      /[\u0080-￿]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  if (Array.isArray(x)) return "[" + x.map(pyJson).join(", ") + "]";
  const items = Object.entries(x)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${pyJson(k)}: ${pyJson(v)}`);
  return "{" + items.join(", ") + "}";
}

/**
 * System prompt + first user turn (Python: initial_messages / _first_user_message).
 * @param {{ request: string, inputs: JobInput[], outputIds: string[], systemPrompt?: string }} p
 * @returns {Message[]}
 */
export function initialMessages({
  request,
  inputs,
  outputIds,
  systemPrompt = SYSTEM_PROMPT,
}) {
  const user = {
    request,
    inputs: inputs.map(({ id, probe }) => ({ id, probe })),
    outputs: outputIds,
  };
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: pyJson(user) },
  ];
}

/**
 * A fresh job. `outputIds` are the ids the model must write ("out1" at runtime: there is no gold spec).
 * @param {{ request: string, inputs: JobInput[], outputIds?: string[], systemPrompt?: string }} p
 */
export function createJob({
  request,
  inputs,
  outputIds = ["out1"],
  systemPrompt,
}) {
  return {
    request,
    inputs,
    outputIds,
    messages: initialMessages({ request, inputs, outputIds, systemPrompt }),
    turns: 0,
    runs: 0,
    invalidTurns: 0,
    asks: 0,
    /** @type {object | null} the model's spec; once the person confirms it, the checker uses it */
    spec: null,
    confirmed: false,
    /** @type {object | null} the last spec the person confirmed; a later spec may not loosen it (spec-guard.js) */
    confirmedSpec: null,
    lastPassed: false,
    /** @type {Run[]} */
    history: [],
  };
}
/** @typedef {ReturnType<typeof createJob>} Job */

/**
 * Ask the policy for one reply and parse it. A throwing policy propagates; the machine turns that into `failed`.
 * @param {Job} job
 * @param {Policy} policy
 * @returns {Promise<{ reply: string, action: object } | { reply: string, error: string }>}
 */
export async function nextAction(job, policy) {
  const raw = await policy(job.messages);
  const reply = typeof raw === "string" ? raw : "";
  const parsed = parseAction(reply);
  return "error" in parsed
    ? { reply, error: parsed.error }
    : { reply, action: parsed };
}

/**
 * Close a turn: the assistant reply and the observation go into the conversation (Python: `ep.turns.append`).
 * @param {Job} job
 * @param {string} reply
 * @param {object} obs what the model is told next
 * @param {{ invalid?: boolean }} [opts] an invalid turn also counts toward invalidTurns
 */
export function observe(job, reply, obs, { invalid = false } = {}) {
  job.messages.push(
    { role: "assistant", content: reply },
    { role: "user", content: pyJson(obs) },
  );
  job.turns += 1;
  if (invalid) job.invalidTurns += 1;
}

const tail = (log) => String(log ?? "").slice(-STDERR_TAIL_CHARS);
const message = (e) =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

/**
 * Validate, execute and check one `run` action (Python: execute + _do_run). The check always uses the job's
 * confirmed spec, never anything the model could have changed since.
 * @param {Job} job
 * @param {{ args: string[], inputs: string[], outputs: string[] }} action
 * @param {{ executor: Executor, measure: Measure }} deps
 * @param {{ onChecking?: () => void }} [hooks] called after FFmpeg succeeded, before the checks start
 * @returns {Promise<{ obs: object, passed: boolean, run: Run }>}
 */
export async function executeRun(
  job,
  action,
  { executor, measure },
  hooks = {},
) {
  job.runs += 1; // counted even when the allowlist rejects it, as in Python
  /** @type {Run} */
  const entry = {
    n: job.runs,
    args: action.args,
    ok: false,
    rejected: null,
    error: null,
    passed: false,
    checks: [],
    errors: [],
    outputs: {},
  };
  const finish = (obs, passed) => {
    entry.passed = passed;
    job.lastPassed = passed;
    job.history.push(entry);
    return { obs, passed, run: entry };
  };

  const known = {
    inputs: new Set(job.inputs.map((i) => i.id)),
    outputs: new Set(job.spec.outputs.map((o) => o.id)),
  };
  const v = validateRun(action.args, action.inputs, action.outputs, known);
  if (!v.ok) {
    entry.rejected = v.reason;
    return finish(
      {
        run_ok: false,
        rejected: v.reason,
        stderr_tail: `rejected: ${v.reason}`,
      },
      false,
    );
  }

  let res;
  try {
    res = await executor.run({
      args: action.args,
      inputs: action.inputs,
      outputs: action.outputs,
      // The job's output specs decide each output's container and kind (Python: output_path_for(spec)).
      specs: job.spec.outputs,
    });
  } catch (e) {
    res = { ok: false, log: `executor error: ${message(e)}`, outputs: {} };
  }
  if (!res.ok) {
    entry.error = res.error ?? null;
    return finish(
      { run_ok: false, rejected: null, stderr_tail: tail(res.log) },
      false,
    );
  }
  entry.ok = true;
  entry.outputs = res.outputs;
  hooks.onChecking?.();

  const gold = new Map(job.spec.outputs.map((o) => [o.id, o]));
  const inputProbes = job.inputs.map((i) => i.probe);
  const results = {};
  for (const [id, handle] of Object.entries(res.outputs)) {
    if (!gold.has(id)) continue;
    results[id] = await check(gold.get(id), {
      output: handle,
      inputProbe: inputProbes[0],
      runArgs: action.args,
      inputProbes,
      inputs: job.inputs.map((i) => i.handle),
      measure,
    });
  }
  for (const [id, r] of Object.entries(results)) {
    for (const c of r.checks) entry.checks.push({ output: id, ...c });
    if (r.error) entry.errors.push(`${id}: ${r.error}`);
  }
  const missing = [...gold.keys()].filter((id) => !(id in results)).sort();
  const passed =
    missing.length === 0 && Object.values(results).every((r) => r.passed);
  const obs = {
    run_ok: true,
    checks: Object.fromEntries(
      Object.entries(results).map(([id, r]) => [
        id,
        {
          passed: r.passed,
          error: r.error,
          failed: r.checks.filter((c) => !c.ok),
        },
      ]),
    ),
    missing_outputs: missing,
  };
  return finish(obs, passed);
}
