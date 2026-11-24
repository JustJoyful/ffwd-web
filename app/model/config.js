// The model artifact and runtime settings (D-050, D-051). ONE source: the worker, the client, the loader and analytics
// read these, nothing else hard-codes them. The values are those of the owner-confirmed configuration.
export const MODEL = {
  version: "agent-v0.1-0.6b-q5_k_m",
  file: "grpo-m3-ckpt60-q5_k_m.gguf",
  bytes: 444411456,
  sha256: "bbf439b749c02c04b5227ab93fb1430263a7c567c15552b6e12ae3836cde1e11",
  nCtx: 8192,
  kvCache: "q8_0",
  maxTokens: 512,
};

// Where the file comes from. The public Hugging Face repo and the R2 fallback do not exist yet (the DeepSeek terms
// review comes first), so there is NO production URL: a build gets one from VITE_MODEL_URL (a localhost URL in
// development and in the real-model smoke test), and without it the loader says the model is not published yet.
export const modelUrl = () => import.meta.env?.VITE_MODEL_URL || null;

// Choosing the path (added 2026-11-24, owner decision): a canary on the graphics path, then a speed test, once per
// device and model, remembered in localStorage. ONE source for the numbers; each has its reason next to it.
export const PATH_CHOICE = {
  // The canary prompt is the whole 1333-token system prompt plus a first user turn; the native llama.cpp b12032 reply's
  // first 20 token ids are in canary-reference.json. MEASURED (reports/2026-11-24-canary/study, wllama 4.0.0, Chromium
  // 159, Q5_K_M, q8_0 KV + flash attention): NVIDIA WebGPU 20/20 (two runs), processor 20/20, Intel gen-12lp WebGPU 0/20
  // (five runs, always garbage). Every one of the 20 greedy steps has a log-probability gap of at least 4.3 between the
  // best and second-best token (stepMargins), so float noise cannot flip a correct path: it matches all 20. A pass
  // needs 18 of 20: the 2 spare ids only absorb a flip late in the reply on some other device, while a broken path
  // (0 of 20) is nowhere near. Wrong guesses cost speed (a good GPU marked broken runs on the processor), never output.
  canaryMinMatch: 18,
  // A device can pass the canary and still go wrong later (a driver update, a longer prompt): two replies in a row
  // that are not an action at all while on the graphics path switch to the processor and redo the step.
  invalidRepliesToSwitch: 2,
  // A verdict older than this is checked again, so a driver or browser update can win a device back.
  cacheTtlDays: 30,
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
