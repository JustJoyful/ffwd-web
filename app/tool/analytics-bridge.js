// Turns the tool's state changes into analytics events (ARCHITECTURE §9). It reads the machine's state only for
// categories and numbers: which family, how many runs, a size or time bucket, a reason id. The request, the file
// name, the model's sentences and paths are never read here, and analytics.js drops anything outside its lists anyway.
// helper_* are in EVENTS but not sent yet: there is no helper until Phase 3. model_load_* come from the model client's
// state (store.model, when the build has one): only the version, whether the file was cached, and the load time as a
// range. A failed load has no event of its own: ARCHITECTURE §9 does not list one.
import { track as realTrack } from "../lib/analytics.js";
import {
  bucketCount,
  bucketLoadMs,
  bucketSeconds,
  bucketSize,
} from "../lib/buckets.js";

const FINISHED = ["done", "failed", "unsupported", "awaitingRequest"];
// `-c copy` or `-c:v copy` leaves the picture as it was; anything else re-encodes it.
const reEncoded = (args = []) =>
  !args.some((a, i) => /^-c(:v)?$/.test(a) && args[i + 1] === "copy");

/**
 * model_load_started once, when the model first starts downloading or loading; model_load_completed once, when it is
 * ready (plus the path it runs on and the graphics check's verdict). A retry after a failure is not counted again, so started and completed stay comparable per page load.
 * @param {{ getState(): import("../model/contract.js").ModelState, subscribe(fn: (s: any) => void): () => void } | undefined} model
 */
function bindModelAnalytics(model, track) {
  if (!model) return () => {};
  let started = false;
  let completed = false;
  const on = (s) => {
    if (!started && ["downloading", "loading"].includes(s.phase)) {
      started = true;
      track("model_load_started", {
        model_version: model.getConfig?.()?.version ?? "unknown",
        cache_hit: s.cached === true,
      });
    } else if (!completed && s.phase === "ready") {
      completed = true;
      track("model_load_completed", {
        model_version: model.getConfig?.()?.version ?? "unknown",
        cache_hit: s.cached === true,
        ms: bucketLoadMs(s.loadMs),
        // coarse words only: where the model runs and what the graphics check said (never the adapter or the speeds)
        model_path: s.path,
        canary_result: s.canary ?? "skipped",
      });
    }
  };
  on(model.getState());
  return model.subscribe(on);
}

/**
 * Subscribe to a tool store (or machine) and send one event per transition. Returns the unsubscribe function.
 * @param {{ getState(): import("../agent/machine.js").State, subscribe(fn: (s: any) => void): () => void, model?: any }} store
 * @param {{ track?: typeof realTrack }} [opts] injected by tests
 */
export function bindAnalytics(store, { track = realTrack } = {}) {
  const offModel = bindModelAnalytics(store.model, track);
  let prev = store.getState().name;
  let started = false; // edit_started was sent for this attempt
  let edited = false; // the person changed the request after seeing a plan
  let confirmedAt = 0;
  const off = store.subscribe((s) => {
    const name = s.name;
    if (name === prev) return;
    const from = prev;
    prev = name;

    if (from === "checkingCapability") {
      // The path the capability check chose (a real adapter), not whether navigator.gpu exists: a software adapter is "cpu".
      const props = { webgpu: s.path === "webgpu" };
      if (name === "unsupportedDevice") props.fail_reason = s.reason;
      track("capability_checked", props);
    }
    if (FINISHED.includes(name)) {
      started = false;
      edited = false;
    }
    if (name === "awaitingConfirm") {
      // The family comes from the plan, so the edit "starts" when the first plan is shown.
      if (started) edited = true;
      else {
        started = true;
        track("edit_started", {
          families: s.spec?.family,
          mode: "browser",
          input_size_bucket: bucketSize(s.inputs[0]?.probe?.size_bytes),
          n_files_bucket: bucketCount(s.inputs.length),
        });
      }
    } else if (name === "running" && from === "awaitingConfirm") {
      confirmedAt = performance.now();
      track("spec_confirmed", { edited_by_user: edited });
    } else if (name === "done") {
      const passing = s.history.findLast((r) => r.passed);
      track("edit_completed", {
        passed_check: true,
        runs: s.runs,
        seconds_bucket: bucketSeconds((performance.now() - confirmedAt) / 1000),
        re_encoded: reEncoded(passing?.args),
      });
    } else if (name === "failed") {
      track("edit_failed", { reason_category: s.reason });
    } else if (name === "askingUser") {
      track("ask_user_shown", { category: "other" }); // the question is free text; the protocol has no category yet
    } else if (name === "unsupported") {
      track("unsupported_shown", { category: "other" });
    }
  });
  return () => {
    off();
    offModel();
  };
}

/** The landing_page value for a path: a known page name, or a chore slug, never the visitor's own text. */
export function landingFromPath(path, slugs = []) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "home";
  if (parts[0] === "chores" && parts.length === 2)
    return slugs.includes(parts[1]) ? parts[1] : "other";
  return ["chores", "privacy", "requirements", "app"].includes(parts[0]) &&
    parts.length === 1
    ? parts[0]
    : "other";
}

/**
 * One site_visit per page load. The referrer is reduced to its domain: no path, no query. A referrer on this
 * site is not a visit from elsewhere, so it sends no domain.
 * @param {{ landing?: string, referrer?: string, host?: string, track?: typeof realTrack }} [opts]
 */
export function siteVisit({
  landing = "home",
  referrer = document.referrer,
  host = location.hostname,
  track = realTrack,
} = {}) {
  let domain;
  try {
    domain = new URL(referrer).hostname;
  } catch {
    domain = "";
  }
  track("site_visit", {
    landing_page: landing,
    ...(domain && domain !== host ? { referrer_domain: domain } : {}),
  });
}
