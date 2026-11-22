import { estimateWait } from "../../lib/capability.js";

/**
 * Which hardware runs the model, shown to the person (D-050). On the graphics chip it is one quiet line. On the
 * processor it is a notice with an honest wait, built from the speed measured on one laptop (config.js
 * MODEL_TURN_SECONDS), and it says that a slower computer takes longer. It promises nothing about a fast path:
 * the app has no rules-only shortcut yet.
 * @param {{ path: "webgpu" | "cpu" | null, notice?: string | null }} props
 */
export default function ModelPathNotice({ path }) {
  if (!path) return null;
  if (path === "webgpu") {
    return (
      <p className="step__hint" data-path="webgpu">
        The model runs on your graphics chip.
      </p>
    );
  }
  const w = estimateWait("cpu");
  return (
    <div className="notice notice--wide" role="status" data-path="cpu">
      <p className="notice__t">The model runs on your processor</p>
      <p>
        This browser has no usable graphics acceleration, so ffwd is slower
        here. On the laptop we measured, the first step took about{" "}
        <b data-const="firstStepSeconds">{w.firstStepSeconds}</b> seconds and
        each step after it about{" "}
        <b data-const="laterStepSeconds">{w.laterStepSeconds}</b> seconds. A
        typical job spends about{" "}
        <b data-const="jobModelSeconds">{w.jobModelSeconds}</b> seconds on the
        model before the video work starts. A slower computer takes longer. For
        big videos the desktop app, when it is out, will be faster.
      </p>
    </div>
  );
}
