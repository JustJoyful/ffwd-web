import { MEMORY_WARNING_TEXT, estimateWait } from "../../lib/capability.js";

/**
 * Which hardware runs the model, and for how long a step takes (D-050). The speed is what this computer MEASURED in the
 * first-visit check (model.bench); before there is a measurement it is the numbers from one laptop, said as such. While the
 * check itself runs it says honestly that the first check on a computer takes a while and is remembered. It promises
 * nothing about a fast path: the app has no rules-only shortcut yet.
 * @param {{ path: "webgpu" | "cpu" | null, model?: import("../../model/contract.js").ModelState | null }} props
 *   `path` is where the model runs NOW (the model's, once it is loaded; the capability guess before)
 */
export default function ModelPathNotice({ path, model }) {
  if (model?.check) {
    return (
      <div
        className="notice notice--wide"
        role="status"
        data-check={model.check}
      >
        <p className="notice__t">Checking this computer's graphics chip</p>
        <p>
          The first time on a computer, ffwd tests that the on-device model
          gives the right answers on the graphics chip, and measures how fast
          each choice is. This can take a minute or more. The result is
          remembered, so it only happens once.
        </p>
      </div>
    );
  }
  if (!path) return null;
  const bench = model?.bench ?? null;
  const w = estimateWait(path, bench);
  if (path === "webgpu") {
    return (
      <>
        <p className="step__hint" data-path="webgpu">
          The model runs on your graphics chip.
        </p>
        {bench && (
          <p className="step__hint" data-wait="measured">
            On this computer a step takes about{" "}
            <b data-const="laterStepSeconds">{w.laterStepSeconds}</b> seconds,
            the first one about{" "}
            <b data-const="firstStepSeconds">{w.firstStepSeconds}</b>.
          </p>
        )}
      </>
    );
  }
  const why = {
    canary:
      "A check on this computer found that its graphics chip gives wrong answers with the model, so ffwd uses your processor instead. This is slower, but the answers are right.",
    replies:
      "The graphics chip started giving unreadable answers, so ffwd switched to your processor and redid the step. This is slower, but the answers are right.",
  }[model?.fallback ?? ""];
  const faster = !why && model?.canary === "pass";
  return (
    <div
      className="notice notice--wide"
      role="status"
      data-path="cpu"
      data-wait={bench ? "measured" : "estimated"}
    >
      <p className="notice__t">The model runs on your processor</p>
      <p>
        {why ??
          (faster
            ? "In a short test on this computer the processor was faster than the graphics chip, so ffwd uses it."
            : "This browser has no usable graphics acceleration, so ffwd is slower here.")}{" "}
        {bench ? "On this computer, " : "On the laptop we measured, "}
        the first step takes about{" "}
        <b data-const="firstStepSeconds">{w.firstStepSeconds}</b> seconds and
        each step after it about{" "}
        <b data-const="laterStepSeconds">{w.laterStepSeconds}</b> seconds. A
        typical job spends about{" "}
        <b data-const="jobModelSeconds">{w.jobModelSeconds}</b> seconds on the
        model before the video work starts.
        {bench ? "" : " A slower computer takes longer."} For big videos the
        desktop app, when it is out, will be faster.
      </p>
    </div>
  );
}

/** Shown when the browser reports less memory than recommended but at least the minimum: it runs, with a warning. */
export function MemoryNotice() {
  return (
    <div className="notice" role="status" data-warning="memory">
      <p className="notice__t">This computer has little memory</p>
      <p>{MEMORY_WARNING_TEXT}</p>
    </div>
  );
}
