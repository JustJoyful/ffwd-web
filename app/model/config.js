import { protocol_version } from "../../protocol/PIN.json";

// What the app is BUILT FOR (D-053). The model itself (file, size, sha256, context, KV cache, token cap, canary) is not
// here: it is read at run time from the release manifest ffwd-model.json (manifest.js) and refused when it does not
// match these two values. ONE source each; nothing else hard-codes them.
//   APP_VERSION: the version of this site, compared with the manifest's min_app_version. It is a constant, not
//     package.json's "version" (this repo is private and its package.json version is not a release number); raise it by
//     hand when a release needs a newer app, and say so in DECISIONS.md.
//   PROTOCOL_VERSION: the protocol this site was synced to, read from protocol/PIN.json (scripts/sync-protocol.mjs), so a
//     sync that bumps the protocol changes what the site accepts without a second edit.
export const APP_VERSION = "1.0.0";
export const PROTOCOL_VERSION = protocol_version;

// Where the manifest comes from: build-time values, so a build names ONE pinned model release.
//   VITE_MODEL_MANIFEST_URL     https URL of ffwd-model.json at a pinned Hugging Face tag or commit (never main; see
//                               manifest-url.js and `pnpm check:release`). Files are the manifest's relative paths
//                               resolved against it.
//   VITE_MODEL_MANIFEST_SHA256  sha256 of that exact manifest file: a host that swaps the manifest is refused.
// Without a URL the page says the model is not published yet and downloads nothing.
export const modelManifestUrl = () =>
  import.meta.env?.VITE_MODEL_MANIFEST_URL || null;
export const modelManifestSha256 = () =>
  import.meta.env?.VITE_MODEL_MANIFEST_SHA256 || null;
/** The host the model comes from (the privacy page names it), or null when no URL is set. */
export const modelHost = () => {
  try {
    return new URL(modelManifestUrl() ?? "").hostname || null;
  } catch {
    return null;
  }
};

// Choosing the path (added 2026-11-24, owner decision): a canary on the graphics path, then a speed test, once per
// device and model, remembered in localStorage. ONE source for the numbers; each has its reason next to it.
export const PATH_CHOICE = {
  // The canary prompt, its expected token ids and the pass rule (18 of 20) come from the release manifest's canary block.
  // MEASURED (reports/2026-11-24-canary/study, wllama 4.0.0, Chromium
  // 159, Q5_K_M, q8_0 KV + flash attention): NVIDIA WebGPU 20/20 (two runs), processor 20/20, Intel gen-12lp WebGPU 0/20
  // (five runs, always garbage). Every one of the 20 greedy steps has a log-probability gap of at least 4.3 between the
  // best and second-best token (stepMargins), so float noise cannot flip a correct path. A pass needs 18 of 20: the 2
  // spare ids only absorb a flip late in the reply on some other device, while a broken path (0 of 20) is nowhere near.
  // Wrong guesses cost speed (a good GPU marked broken runs on the processor), never output.
  // A device can pass the canary and still go wrong later (a driver update, a longer prompt): two replies in a row
  // that are not an action at all while on the graphics path switch to the processor and redo the step.
  invalidRepliesToSwitch: 2,
  // A verdict older than this is checked again, so a driver or browser update can win a device back.
  cacheTtlDays: 30,
  // The verdict the runtime safety net writes (two unreadable replies in a row) lasts one day, not 30. Such replies also
  // come from a healthy graphics chip (a reply cut at the token cap, one bad turn), and a wrong "broken" costs about
  // 3.7x slower steps (capability.js MODEL_TURN_SECONDS), so it must not stick for a month. The canary's verdict is
  // measured on a fixed prompt and keeps the long lifetime.
  runtimeVerdictHours: 24,
  // What one model step costs, for choosing the faster path and for the wait estimate. From the browser row (900 tasks,
  // reports/2026-11-23-phase-1-browser-row): a typical later step reads about 200 new prompt tokens and writes about
  // 60; the first step of a page visit reads the whole prompt (1333 tokens) plus the user turn (about 170).
  step: { promptTokens: 200, genTokens: 60 },
  firstStep: { promptTokens: 1500, genTokens: 60 },
  // The speed test: a prompt of about 260 tokens that shares nothing with the canary's (so nothing is cached), and a
  // fixed number of generated tokens (the model's end-of-text is ignored so the count does not depend on the text).
  benchPromptChars: 1100,
  benchGenTokens: 24,
};
