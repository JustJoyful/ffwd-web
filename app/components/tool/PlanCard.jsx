import { useEffect, useRef, useState } from "react";
import { COVERAGE_ADVICE } from "../../agent/request-coverage.js";

export const NO_CHANGE_TEXT =
  "This plan doesn't change anything. Reword your request?";

/**
 * The plan the person confirms, in two groups: "Will change" and "Keeps". Focus moves to the primary button when a plan
 * is proposed, so Enter is enough. Chips arrive 60 ms apart, at most six steps (CSS reads --i).
 *
 * When the plan changes nothing (`noChange`), or the request names something the plan does not touch (`gaps`, from
 * request-coverage.js), there is no plain Run button: the primary action is "Reword my request"
 * and "Run anyway" is secondary and needs a second, inline click ("Run anyway, change nothing?" then "Yes, run it" or
 * "Cancel"); focus follows each step. `strictness` goes in a closed native <details>; no lines, no panel.
 * @param {{ chips: Array<[string, string, 1?]>, strictness?: string[], noChange?: boolean, gaps?: string[], state: "proposed" | "edited" | "confirmed", onRun(): void, onChange(): void, onReword?(): void, onFeedback?(): void }} props
 */
export default function PlanCard({
  chips,
  strictness = [],
  noChange = false,
  gaps = [],
  state,
  onRun,
  onChange,
  onReword,
  onFeedback,
}) {
  const primary = useRef(null);
  const sure = useRef(null);
  const [on, setOn] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (state === "proposed") primary.current?.focus();
  }, [state]);
  useEffect(() => {
    if (asking) sure.current?.focus();
  }, [asking]);
  const warn = noChange || gaps.length > 0;
  const groups = [
    ["Will change", chips.filter((c) => c[2])],
    ["Keeps", chips.filter((c) => !c[2])],
  ];
  let i = 0;
  // opt-in feedback: a quiet link in the action row, only when the page offers feedback (never opens anything by itself)
  const notMine = onFeedback && (
    <button type="button" className="cmdlink" onClick={onFeedback}>
      Not what I meant
    </button>
  );
  return (
    <div
      className="plan"
      data-state={state}
      data-nochange={noChange || undefined}
    >
      {groups.map(
        ([title, list]) =>
          list.length > 0 && (
            <div className="plan__group" key={title}>
              <p className="plan__title">{title}</p>
              <ul className="chips" aria-label={title}>
                {list.map(([label, value, changed]) => (
                  <li
                    key={label}
                    className={`chip reveal${changed ? " is-change" : ""}${on ? " is-on" : ""}`}
                    style={{ "--i": Math.min(i++, 5) }}
                  >
                    {label}
                    <b>{value}</b>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      {warn && state !== "confirmed" && (
        <div className="notice notice--bad plan__warn" role="alert">
          {noChange && <p>{NO_CHANGE_TEXT}</p>}
          {gaps.map((g, i) => (
            <p key={g}>
              {g}
              {!noChange && i === gaps.length - 1 && ` ${COVERAGE_ADVICE}`}
            </p>
          ))}
        </div>
      )}
      {strictness.length > 0 && (
        <details className="how">
          <summary>How closely the result is checked</summary>
          {strictness.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </details>
      )}
      {state !== "confirmed" && !warn && (
        <div className="plan__actions">
          <button
            ref={primary}
            type="button"
            className="btn btn--sm btn--blue"
            disabled={state === "edited"}
            onClick={onRun}
          >
            Run it
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={onChange}
          >
            Change
          </button>
          {notMine}
        </div>
      )}
      {state !== "confirmed" && warn && (
        <div className="plan__actions">
          <button
            ref={primary}
            type="button"
            className="btn btn--sm btn--blue"
            disabled={state === "edited"}
            onClick={onReword}
          >
            Reword my request
          </button>
          {!asking ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={state === "edited"}
              onClick={() => setAsking(true)}
            >
              Run anyway
            </button>
          ) : (
            <span
              role="group"
              aria-label="Run anyway?"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAsking(false);
                  primary.current?.focus();
                }
              }}
            >
              <button
                ref={sure}
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={onRun}
              >
                Yes, run it anyway
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  setAsking(false);
                  primary.current?.focus();
                }}
              >
                Cancel
              </button>
            </span>
          )}
          {notMine}
        </div>
      )}
    </div>
  );
}
