// The tool's state machine (WEB_ARCHITECTURE §5.2): a hand-written reducer over the turn steps in loop.js, with no
// framework, so React only subscribes (useSyncExternalStore) and the whole flow is testable in Node with a scripted
// policy. It is the only place that knows which state the person sees.
//
//   checkingCapability -> ready | unsupportedDevice
//   ready -> probing -> awaitingRequest -> planning -> awaitingConfirm | askingUser | unsupported
//   awaitingConfirm -> running -> checking -> done | running (retry) | failed
//
// dispatch(event) resolves when the machine next rests: waiting for the person (awaitingRequest, askingUser,
// awaitingConfirm) or finished (done, failed, unsupported, unsupportedDevice). Events that do not belong to the current
// state are ignored without changing it. Events are handled one at a time, in order.
import { describeSpec } from "./describe-spec.js";
import { MAX_ASK_USER, MAX_RUNS, MAX_TURNS } from "./config.js";
import { createJob, executeRun, nextAction, observe } from "./loop.js";
import { looseningError, specBoundsError } from "./spec-guard.js";
import { MACHINE_REASON, MODEL_ERROR_TEXT } from "../model/contract.js";

/**
 * @typedef {import("./loop.js").Executor} Executor
 * @typedef {import("./loop.js").JobInput} JobInput
 * @typedef {import("./loop.js").Run} Run
 * @typedef {import("./scripted-policy.js").Policy} Policy
 * @typedef {import("./checker/index.js").Measure} Measure
 * @typedef {"checkingCapability" | "ready" | "probing" | "awaitingRequest" | "planning" | "askingUser" | "awaitingConfirm" | "running" | "checking" | "done" | "failed" | "unsupported" | "unsupportedDevice"} StateName
 * @typedef {object} State a snapshot; never mutated, replaced on every change
 * @property {StateName} name
 * @property {string | null} request
 * @property {JobInput[]} inputs
 * @property {object | null} spec the model's proposed spec; the confirmed one once past awaitingConfirm
 * @property {string[]} plan describeSpec(spec): what the person reads before confirming
 * @property {Run[]} history every run, failed ones kept
 * @property {number} runs
 * @property {number} turns
 * @property {number} invalidTurns
 * @property {string | null} question the model's question, in askingUser
 * @property {"webgpu" | "cpu" | null} path where the model runs (set by the capability check; kept across resets)
 * @property {string | null} notice why the model is on the processor, when it is (not a refusal)
 * @property {boolean} memoryWarning the browser reports less memory than recommended (4 GB up to, not including, 8 GB): runs, with a warning
 * @property {string | null} reason why it ended: run_budget, turn_budget, too_long, model_unavailable, aborted (a typed
 *   model error, see MACHINE_REASON), policy_error (an untyped one), or the model's/device's words
 * @property {string | null} error a message for the person (a file that could not be read, MODEL_ERROR_TEXT for a typed
 *   model error, the raw text of an untyped policy error)
 *
 * @typedef {{ type: "capabilityChecked", ok: boolean, reason?: string, path?: "webgpu" | "cpu", notice?: string | null, memoryWarning?: boolean }
 *   | { type: "fileChosen", file: unknown }
 *   | { type: "requestSubmitted", request: string }
 *   | { type: "answered", text: string }
 *   | { type: "confirmed" }
 *   | { type: "requestEdited", request: string }
 *   | { type: "newRequest" }} Event
 */

/** @returns {State} */
const initial = () => ({
  name: "checkingCapability",
  request: null,
  inputs: [],
  spec: null,
  plan: [],
  history: [],
  runs: 0,
  turns: 0,
  invalidTurns: 0,
  question: null,
  reason: null,
  error: null,
  path: null,
  notice: null,
  memoryWarning: false,
});

const FILE_STATES = [
  "ready",
  "awaitingRequest",
  "done",
  "failed",
  "unsupported",
];
const message = (e) =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

/**
 * @param {object} deps
 * @param {Policy} deps.policy the model (or a scripted stand-in)
 * @param {Executor} deps.executor runs validated FFmpeg arguments
 * @param {Measure} deps.measure what the checker measures with
 * @param {(file: unknown) => Promise<JobInput>} deps.probeFile reads a chosen file into { id, probe, handle }
 * @param {string} [deps.systemPrompt] defaults to the pinned protocol/prompts/system-v1.txt
 * @returns {{ getState(): State, subscribe(fn: (s: State) => void): () => void, dispatch(e: Event): Promise<void> }}
 */
export function createMachine(deps) {
  let state = initial();
  /** @type {Set<(s: State) => void>} */
  const subscribers = new Set();
  let job = null;
  /** the assistant reply waiting for the person (a spec to confirm, a question to answer) */
  let pendingReply = null;
  let queue = Promise.resolve();

  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of subscribers) {
      try {
        fn(state);
      } catch (e) {
        console.error("machine subscriber threw", e);
      }
    }
  };
  /** The job's counters and run history, for the next snapshot. */
  const snap = () => ({
    runs: job.runs,
    turns: job.turns,
    invalidTurns: job.invalidTurns,
    history: [...job.history],
    spec: job.spec,
  });
  const fail = (reason, error = null) =>
    set({ name: "failed", reason, error, ...snap() });

  /** Run turns until the machine needs the person or ends. */
  async function drive() {
    for (;;) {
      if (job.turns >= MAX_TURNS) return fail("turn_budget");
      let step;
      try {
        step = await nextAction(job, deps.policy);
      } catch (e) {
        // A typed model error (the client's `.code`) ends the job with the contract's reason and sentence. Never a
        // success, never retried here; history and counters stay in the snapshot. Anything else keeps policy_error.
        const code = e instanceof Error ? e.code : undefined;
        if (Object.hasOwn(MACHINE_REASON, code ?? "")) {
          return fail(MACHINE_REASON[code], MODEL_ERROR_TEXT[code]);
        }
        return fail("policy_error", message(e));
      }
      const { reply } = step;
      if ("error" in step) {
        observe(job, reply, { error: step.error }, { invalid: true });
        continue;
      }
      const action = step.action;
      switch (action.action) {
        case "spec": {
          // The numbers the plan card does not show are bounded, and a spec the person already confirmed is frozen
          // except for tightening (review S3). Either failure is an invalid turn; the old spec stays in force.
          const bad =
            specBoundsError(action.spec) ??
            (job.confirmedSpec &&
              looseningError(job.confirmedSpec, action.spec));
          if (bad) {
            observe(
              job,
              reply,
              {
                error: job.confirmedSpec
                  ? `the person already confirmed the spec; it cannot be loosened or changed (${bad}). Fix the command, not the spec`
                  : `invalid spec: ${bad}`,
              },
              { invalid: true },
            );
            continue;
          }
          job.spec = action.spec;
          job.confirmed = false;
          pendingReply = reply;
          return set({
            name: "awaitingConfirm",
            plan: describeSpec(action.spec),
            question: null,
            ...snap(),
          });
        }
        case "ask_user":
          job.asks += 1;
          if (job.asks > MAX_ASK_USER) {
            observe(
              job,
              reply,
              { error: "only one question is allowed per job" },
              { invalid: true },
            );
            continue;
          }
          pendingReply = reply;
          return set({
            name: "askingUser",
            question: action.question,
            ...snap(),
          });
        case "unsupported":
          observe(job, reply, { ended: "unsupported" });
          return set({ name: "unsupported", reason: action.reason, ...snap() });
        case "finish":
          if (!job.lastPassed) {
            observe(job, reply, { error: "finish requires a passing check" });
            continue;
          }
          observe(job, reply, { ended: "finish" });
          return set({ name: "done", ...snap() });
        case "run": {
          if (!job.spec) {
            // The spec is what the person confirms; a run without one has nothing to be checked against.
            observe(
              job,
              reply,
              {
                error:
                  "emit a spec action first; a run before a spec is rejected",
              },
              { invalid: true },
            );
            continue;
          }
          if (job.runs >= MAX_RUNS) {
            observe(job, reply, { error: "run budget exhausted" });
            return fail("run_budget");
          }
          const r = await executeRun(job, action, deps, {
            onChecking: () => set({ name: "checking", ...snap() }),
          });
          observe(job, reply, r.obs);
          if (r.passed) return set({ name: "done", ...snap() });
          if (job.runs >= MAX_RUNS) return fail("run_budget");
          set({ name: "running", ...snap() });
          continue;
        }
      }
    }
  }

  async function startJob(request) {
    job = createJob({
      request,
      inputs: state.inputs,
      systemPrompt: deps.systemPrompt,
    });
    pendingReply = null;
    set({
      name: "planning",
      request,
      plan: [],
      question: null,
      reason: null,
      error: null,
      ...snap(),
    });
    await drive();
  }

  /** Back to a clean slate on the same file(s). */
  const reset = () => {
    job = null;
    pendingReply = null;
    set({
      ...initial(),
      name: "awaitingRequest",
      inputs: state.inputs,
      path: state.path, // where the model runs does not change with the request
      notice: state.notice,
      memoryWarning: state.memoryWarning,
    });
  };

  /** @param {Event} e */
  async function handle(e) {
    const name = state.name;
    switch (e.type) {
      case "capabilityChecked":
        if (name === "checkingCapability")
          set(
            e.ok
              ? {
                  name: "ready",
                  path: e.path ?? null,
                  notice: e.notice ?? null,
                  memoryWarning: e.memoryWarning === true,
                }
              : {
                  name: "unsupportedDevice",
                  reason: e.reason ?? "this device is not supported",
                },
          );
        return;
      case "fileChosen":
        if (!FILE_STATES.includes(name)) return;
        set({ name: "probing", error: null });
        try {
          const input = await deps.probeFile(e.file);
          job = null;
          set({
            ...initial(),
            name: "awaitingRequest",
            inputs: [input],
            path: state.path,
            notice: state.notice,
            memoryWarning: state.memoryWarning,
          });
        } catch (err) {
          set({ name: "ready", error: message(err) });
        }
        return;
      case "requestSubmitted":
        if (name === "awaitingRequest") await startJob(e.request);
        return;
      case "requestEdited":
        // The model proposed a spec the person did not accept: plan again from a fresh conversation.
        if (name === "awaitingConfirm") await startJob(e.request);
        return;
      case "answered":
        if (name !== "askingUser") return;
        observe(job, pendingReply, { answer: e.text });
        pendingReply = null;
        set({
          name: job.confirmed ? "running" : "planning",
          question: null,
          ...snap(),
        });
        await drive();
        return;
      case "confirmed":
        if (name !== "awaitingConfirm") return;
        observe(job, pendingReply, { spec: "confirmed" });
        pendingReply = null;
        job.confirmed = true;
        job.confirmedSpec = job.spec;
        set({ name: "running", ...snap() });
        await drive();
        return;
      case "newRequest":
        if (["done", "failed", "unsupported"].includes(name)) reset();
        return;
    }
  }

  return {
    getState: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    dispatch(e) {
      const run = queue.then(() => handle(e));
      queue = run.catch(() => {}); // one failed event must not wedge the queue; the caller still sees the error
      return run;
    },
  };
}
