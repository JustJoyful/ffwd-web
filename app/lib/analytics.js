// Anonymous analytics (ARCHITECTURE §9, WEB_ARCHITECTURE §10). The single door out of the page for anything about
// how the site is used. Three layers keep a prompt, file name, path or media from ever leaving:
//   1. `sanitize`: only events in EVENTS, only the property keys listed for that event, free text replaced by "other".
//   2. `guardEvent`: PostHog's own last hook (before_send) re-applies layer 1 and strips what PostHog adds by itself
//      ($current_url would carry /app?ask=..., $set_once the first URL, and so on). Events it was not asked for
//      ($pageview, $autocapture, $exception...) are dropped.
//   3. No identify() call anywhere; PostHog's anonymous id is the only identity.
// With no project key nothing loads. PostHog arrives lazily (first pointer, key or scroll, or after 3 s idle).
import {
  ANALYTICS_IDLE_MS,
  ANALYTICS_MAX_STRING,
  ANALYTICS_PERSISTENCE,
  ANALYTICS_QUEUE_MAX,
  RESPECT_DNT_GPC,
  analyticsSettings,
} from "../config.js";
import { REASON_TEXT } from "./capability.js";
import {
  COUNT_BUCKETS,
  LOAD_BUCKETS,
  SECONDS_BUCKETS,
  SIZE_BUCKETS,
} from "./buckets.js";

/** Event name to the property keys it may carry: exactly the table in ARCHITECTURE §9. The privacy page prints this. */
export const EVENTS = {
  site_visit: ["landing_page", "referrer_domain"],
  capability_checked: ["webgpu", "fail_reason"],
  model_load_started: ["model_version", "cache_hit", "ms"],
  // 2026-11-24: model_path (which hardware the model ended up on) and canary_result (what the first-visit check said about the
  // graphics path) are coarse words, never adapter names. ARCHITECTURE section 9 in the model repo does not list them yet.
  model_load_completed: [
    "model_version",
    "cache_hit",
    "ms",
    "model_path",
    "canary_result",
  ],
  edit_started: ["families", "mode", "input_size_bucket", "n_files_bucket"],
  spec_confirmed: ["edited_by_user"],
  edit_completed: [
    "passed_check",
    "runs",
    "seconds_bucket",
    "re_encoded",
    "model_version",
  ],
  edit_failed: ["reason_category"],
  ask_user_shown: ["category"],
  unsupported_shown: ["category"],
  helper_detected: ["mode"],
  helper_handoff: ["mode"],
};

/**
 * Keys PostHog needs to route an event; they carry no content. Kept by guardEvent, printed on the privacy page.
 * `$process_person_profile` is a boolean posthog-js sets to false (person_profiles: "identified_only") so the server does
 * not create a person profile for the anonymous id; stripping it would have had the opposite effect.
 */
export const TRANSPORT_KEYS = [
  "token",
  "distinct_id",
  "$process_person_profile",
];

// The fixed vocabulary of the fields that hold a category. A value outside it is sent as "other", never as itself.
// category stays empty until the protocol gives `unsupported` and `ask_user` a category of their own: today they
// carry the model's free-text sentence, which must not leave the page.
// Every string a call site sends is one of these words (review S7); the bucket lists are the ones lib/buckets.js returns.
const ENUMS = {
  landing_page: ["home", "chores", "privacy", "requirements", "app", "other"],
  // from the release manifest at run time (name-MAJOR.MINOR.PATCH), so a pattern, not a list; anything else is "other"
  model_version: /^ffwd-[0-9a-z.]+-\d+\.\d+\.\d+$/,
  ms: [...LOAD_BUCKETS, "unknown"],
  input_size_bucket: [...SIZE_BUCKETS, "unknown"],
  n_files_bucket: [...COUNT_BUCKETS, "unknown"],
  seconds_bucket: [...SECONDS_BUCKETS, "unknown"],
  fail_reason: Object.keys(REASON_TEXT),
  reason_category: ["run_budget", "turn_budget", "policy_error"],
  category: [],
  mode: ["browser", "helper"],
  model_path: ["webgpu", "cpu"],
  canary_result: ["pass", "fail", "skipped"],
};
// The one string that cannot be a fixed list: the referring site's domain (the bridge reduces it to a hostname). It must
// still look like one, so a request or file name cannot ride in it.
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const FAMILIES = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);

const inList = (list, v) =>
  typeof v === "string" &&
  (list instanceof RegExp ? list.test(v) : list.includes(v));

/**
 * @param {string} event
 * @param {Record<string, unknown>} [props]
 * @returns {Record<string, string | number | boolean | string[]> | null} null when the event is not one of EVENTS
 */
export function sanitize(event, props = {}) {
  if (!Object.hasOwn(EVENTS, event)) return null;
  const out = {};
  for (const key of EVENTS[event]) {
    const v = props?.[key];
    if (key in ENUMS) {
      if (v !== undefined && v !== null)
        out[key] = inList(ENUMS[key], v) ? v : "other";
    } else if (key === "families") {
      if (Array.isArray(v))
        out[key] = v.map((f) => (inList(FAMILIES, f) ? f : "other"));
    } else if (key === "referrer_domain") {
      if (
        typeof v === "string" &&
        v.length <= ANALYTICS_MAX_STRING &&
        HOSTNAME.test(v)
      )
        out[key] = v;
    } else if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "number") {
      if (Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}

/** PostHog's before_send: the event as it will be sent, or null to send nothing. @param {any} e */
export function guardEvent(e) {
  const clean = e && sanitize(e.event, e.properties);
  if (!clean) return null;
  const properties = {};
  for (const k of TRANSPORT_KEYS) {
    const v = e.properties?.[k];
    // the person flag is only ever true or false; the other two are PostHog's own token and random id
    if (
      k === "$process_person_profile"
        ? typeof v === "boolean"
        : typeof v === "string"
    )
      properties[k] = v;
  }
  return {
    uuid: e.uuid,
    event: e.event,
    timestamp: e.timestamp,
    properties: { ...properties, ...clean },
  };
}

/** Do Not Track and Global Privacy Control, when the owner's default (RESPECT_DNT_GPC) honours them. */
function allowed() {
  if (!RESPECT_DNT_GPC) return true;
  const n = globalThis.navigator;
  return !(
    ["1", "yes"].includes(n?.doNotTrack) ||
    ["1", "yes"].includes(globalThis.doNotTrack) ||
    n?.globalPrivacyControl === true
  );
}

let scheduled = false;
let posthog = null; // set once the lazy import and init have succeeded
let dead = false; // the import or init failed (ad blocker, network): stop queueing, keep quiet
const queue = [];

const send = ([event, props, timestamp]) => {
  try {
    posthog.capture(event, props, { timestamp });
  } catch {
    dead = true;
  }
};

async function load() {
  const { key, host, scripted } = analyticsSettings();
  try {
    const mod = await import("posthog-js/dist/module.slim.js");
    const ph = mod.default;
    ph.init(key, {
      api_host: host,
      autocapture: false,
      disable_session_recording: true,
      ip: false,
      capture_pageview: false,
      capture_pageleave: false,
      persistence: ANALYTICS_PERSISTENCE,
      respect_dnt: RESPECT_DNT_GPC,
      person_profiles: "identified_only",
      advanced_disable_flags: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      before_send: guardEvent,
      // PostHog drops events from headless browsers; the e2e server (scripted build) is one.
      opt_out_useragent_filter: scripted,
    });
    posthog = ph;
    queue.splice(0).forEach(send);
  } catch {
    dead = true;
    queue.length = 0;
  }
}

/** Idempotent. Schedules the lazy load; does nothing without a key or when the browser asks not to be tracked. */
export function initAnalytics() {
  if (scheduled || !analyticsSettings().key || !allowed()) return;
  scheduled = true;
  const events = ["pointerdown", "keydown", "scroll"];
  let timer;
  const go = () => {
    clearTimeout(timer);
    for (const t of events) window.removeEventListener(t, go);
    load();
  };
  for (const t of events) window.addEventListener(t, go, { passive: true });
  timer = setTimeout(go, ANALYTICS_IDLE_MS);
}

/**
 * @param {keyof typeof EVENTS} event
 * @param {Record<string, unknown>} [props]
 */
export function track(event, props) {
  initAnalytics(); // idempotent; a no-op without a key
  if (dead || !scheduled) return;
  const clean = sanitize(event, props);
  if (!clean) return;
  const entry = [event, clean, new Date()]; // queued events keep the time they happened, not the time PostHog loaded
  if (posthog) return send(entry);
  queue.push(entry);
  if (queue.length > ANALYTICS_QUEUE_MAX) queue.shift();
}
