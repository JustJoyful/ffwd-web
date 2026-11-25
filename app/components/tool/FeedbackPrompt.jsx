import { useEffect, useRef, useState } from "react";
import {
  buildFeedback,
  feedbackUrl,
  sendFeedback,
} from "../../lib/feedback.js";

/**
 * Opt-in feedback (separate from analytics, which it never touches). Renders nothing when the build has no
 * VITE_FEEDBACK_URL. Nothing is built into a request until "Send" is pressed; the exact payload is shown first.
 * `onDone(outcome)` gets "declined" | "sent" | "failed"; the panel keeps showing its last message until the parent
 * unmounts it.
 * @param {{ kind: "failed_job" | "plan_wrong", requestText: string, spec?: object | null, failureCategory?: string,
 *   fileName?: string, modelVersion?: string, onDone?: (outcome: string) => void }} props
 */
export default function FeedbackPrompt({ onDone, ...input }) {
  const [state, setState] = useState("ask"); // ask | sending | sent | failed | declined
  const status = useRef(null);
  // the buttons disappear when the answer arrives: put focus on the message so keyboard and screen-reader users land on it
  useEffect(() => {
    if (state === "sent" || state === "failed") status.current?.focus();
  }, [state]);
  if (!feedbackUrl() || state === "declined") return null;
  const payload = buildFeedback(input);
  const finish = (s) => {
    setState(s);
    onDone?.(s === "sent" ? "sent" : s === "failed" ? "failed" : "declined");
  };
  const send = async () => {
    setState("sending");
    finish((await sendFeedback(payload)).ok ? "sent" : "failed");
  };
  if (state === "sent" || state === "failed")
    return (
      <div
        className="notice"
        role="status"
        tabIndex={-1}
        ref={status}
        data-feedback={state}
      >
        <p>
          {state === "sent"
            ? "Thanks. Sent."
            : "Couldn't send. Nothing was kept."}
        </p>
      </div>
    );
  return (
    <div
      className="notice"
      role="group"
      aria-labelledby="fb-t"
      data-feedback="ask"
    >
      <p className="notice__t" id="fb-t">
        Help improve ffwd?
      </p>
      <p>
        Send this request text (not your video) anonymously to help improve
        ffwd?
      </p>
      <details>
        <summary>What gets sent</summary>
        <pre className="notice__detail" data-feedback-payload>
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
      <div className="notice__actions">
        <button
          type="button"
          className="btn btn--accent"
          onClick={send}
          disabled={state === "sending"}
        >
          Send
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => finish("declined")}
          disabled={state === "sending"}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

/** The "This plan is wrong" trigger: renders nothing when feedback is off. The parent decides what onClick opens. */
export function FeedbackButton({ onClick, children = "This plan is wrong" }) {
  if (!feedbackUrl()) return null;
  return (
    <button type="button" className="btn" onClick={onClick}>
      {children}
    </button>
  );
}
