import { useEffect, useRef, useState } from "react";

/**
 * The plan the person confirms: chips for what will change, then "Run it" or "Change". Focus moves to "Run it" when
 * a plan is proposed, so Enter is enough. Chips arrive 60 ms apart, at most six steps (CSS reads --i).
 * `strictness` (tool/chips.js strictnessLines) goes in a closed native <details>; no lines, no panel.
 * @param {{ chips: Array<[string, string, 1?]>, strictness?: string[], state: "proposed" | "edited" | "confirmed", onRun(): void, onChange(): void }} props
 */
export default function PlanCard({
  chips,
  strictness = [],
  state,
  onRun,
  onChange,
}) {
  const run = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (state === "proposed") run.current?.focus();
  }, [state]);
  return (
    <div className="plan" data-state={state}>
      <ul className="chips" aria-label="The plan">
        {chips.map(([label, value, changed], i) => (
          <li
            key={label}
            className={`chip reveal${changed ? " is-change" : ""}${on ? " is-on" : ""}`}
            style={{ "--i": Math.min(i, 5) }}
          >
            {label}
            <b>{value}</b>
          </li>
        ))}
      </ul>
      {strictness.length > 0 && (
        <details className="how">
          <summary>How closely the result is checked</summary>
          {strictness.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </details>
      )}
      {state !== "confirmed" && (
        <div className="plan__actions">
          <button
            ref={run}
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
        </div>
      )}
    </div>
  );
}
