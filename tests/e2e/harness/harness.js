// The page the browser specs drive: it exposes the engine modules on `window.ffwd` so a spec can call them with
// page.evaluate. No UI. Fixtures are generated with FFmpeg lavfi sources only; no corpus clip is ever loaded.
import { check } from "../../../app/agent/checker/index.js";
import { createBrowserRuntime } from "../../../app/agent/browser-runtime.js";
import { makeInput } from "../fixtures.js";

window.ffwd = { check, createBrowserRuntime, makeInput };
window.ffwdReady = true;

// opt-in feedback: the real sender, so a spec can watch the request it makes (tests/e2e/feedback.spec.js)
import { buildFeedback, sendFeedback } from "../../../app/lib/feedback.js";
window.ffwd.feedback = { buildFeedback, sendFeedback };
