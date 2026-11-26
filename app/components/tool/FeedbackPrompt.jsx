import { useEffect, useId, useRef, useState } from "react";
import { buildFeedback, sendFeedback } from "../../lib/feedback.js";
import {
  feedbackUrl,
  hideFeedbackForSession,
  markFeedbackSent,
} from "../../lib/feedback-state.js";
import { MAX_NOTE } from "../../lib/feedback-schema.js";

export const CONSENT =
  "Send this request (not your video) anonymously. Your request text (not your video) may be used to improve ffwd's model.";

/**
 * Opt-in feedback (separate from analytics, which it never touches). It is mounted only after a person clicked one of
 * the quiet entry links in the tool (app.jsx), and takes focus then. Renders nothing when the build has no
 * VITE_FEEDBACK_URL. Nothing is built into a request until "Send" is pressed; the exact payload (with the optional
 * note) is shown first. "No thanks" hides every entry point for the session; a send hides them for this job (`jobKey`).
 * @param {{ kind: "failed_job" | "plan_wrong" | "result_wrong", requestText: string, spec?: object | null,
 *   failureCategory?: string, fileName?: string, modelVersion?: string, jobKey?: string,
 *   onDone?: (outcome: "sent" | "failed" | "declined") => void }} props
 */
export default function FeedbackPrompt({ onDone, jobKey, ...input }) {
  const [state, setState] = useState("ask"); // ask | sending | sent | failed | declined
  const [note, setNote] = useState("");
  const heading = useRef(null);
  const status = useRef(null);
  const noteId = useId();
  const hintId = useId();
  useEffect(() => {
    heading.current?.focus(); // the person just opened the panel: keyboard and screen-reader users land on it
  }, []);
  // the buttons disappear when the answer arrives: put focus on the message
  useEffect(() => {
    if (state === "sent" || state === "failed") status.current?.focus();
  }, [state]);
  if (!feedbackUrl() || state === "declined") return null;
  const payload = buildFeedback({ ...input, note });
  const send = async () => {
    setState("sending");
    const ok = (await sendFeedback(payload)).ok;
    setState(ok ? "sent" : "failed");
    if (ok) markFeedbackSent(jobKey);
    onDone?.(ok ? "sent" : "failed");
  };
  const decline = () => {
    setState("declined");
    hideFeedbackForSession();
    onDone?.("declined");
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
      className="notice fb"
      role="group"
      aria-labelledby="fb-t"
      data-feedback="ask"
    >
      <p className="notice__t" id="fb-t" tabIndex={-1} ref={heading}>
        Help improve ffwd?
      </p>
      <p>{CONSENT}</p>
      <label className="fb__note" htmlFor={noteId}>
        What did you expect? (optional)
        <input
          id={noteId}
          type="text"
          className="ask ask--field"
          maxLength={MAX_NOTE}
          value={note}
          aria-describedby={hintId}
          autoComplete="off"
          onChange={(e) => setNote(e.target.value)}
          disabled={state === "sending"}
        />
      </label>
      <small id={hintId}>Don't include names or personal details.</small>
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
          onClick={decline}
          disabled={state === "sending"}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
