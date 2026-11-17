import { useEffect, useState } from "react";
import { describeCheck } from "../../tool/checks.js";

/** The home page's tick and cross. The icon carries its own accessible text, so pass or fail is never only colour. */
export function CheckIcon({ ok }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 18 18"
      role="img"
      aria-label={ok ? "passed" : "failed"}
    >
      <circle cx="9" cy="9" r="8" />
      <path
        d={ok ? "M5.5 9.3l2.3 2.3 4.7-5" : "M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6"}
      />
    </svg>
  );
}

/**
 * Each check as a row: what was measured, the value, a tick or a cross. With `animate` the rows land 60 ms apart (at
 * most six steps, the rest arrive with the sixth) and each tick draws in; CSS reads --delay and turns it all off for
 * reduced motion, so the end state is there at once.
 * @param {{ checks: Array<{ field: string, expected: unknown, actual: unknown, ok: boolean }>, animate?: boolean }} props
 */
export default function CheckList({ checks, animate = true }) {
  const [on, setOn] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [animate]);
  return (
    <div className="checks">
      {checks.map((c, i) => {
        const { label, value, why } = describeCheck(c);
        return (
          <div
            key={`${c.output ?? ""}${c.field}`}
            className={`ck reveal${c.ok ? "" : " is-fail"}${on ? " is-on" : ""}`}
            style={{ "--delay": `${Math.min(i, 5) * 60}ms` }}
          >
            <span>{label}</span>
            <b>
              {value}
              {why && <em>{why}</em>}
            </b>
            <CheckIcon ok={c.ok} />
          </div>
        );
      })}
    </div>
  );
}
