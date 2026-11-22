import { Fragment, useId, useState } from "react";
import { flagsForChip, quoteArg } from "../../tool/chips.js";

/**
 * The exact FFmpeg command, closed until asked for. Hovering or focusing a plan chip highlights the flags that
 * implement it. The text is for reading and copying only; ffwd runs the argument list, never this string.
 * @param {{ args: string[], chips: Array<[string, string, 1?]> }} props `args` are display arguments (file names filled in)
 */
export default function CommandReveal({ args, chips }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState(null);
  const [copied, setCopied] = useState(null); // null | "done" | "blocked"
  const hit = lit ? flagsForChip(lit, args) : new Set();
  const text = ["ffmpeg", ...args.map(quoteArg)].join(" ");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      // clipboard blocked: say so, the command is on screen and can be selected by hand
      setCopied("blocked");
    }
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <div
      className="reveal-cmd"
      onKeyDown={(e) => e.key === "Escape" && open && setOpen(false)}
    >
      <button
        type="button"
        className="cmdlink"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide the FFmpeg command" : "Show the FFmpeg command"}
      </button>
      {open && (
        <div id={id}>
          <ul
            className="chips chips--link"
            aria-label="Plan chips: point at one to see its flags"
          >
            {chips.map(([label, value]) => (
              <li key={label}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={lit === label}
                  onMouseEnter={() => setLit(label)}
                  onMouseLeave={() => setLit(null)}
                  onFocus={() => setLit(label)}
                  onBlur={() => setLit(null)}
                >
                  {label}
                  <b>{value}</b>
                </button>
              </li>
            ))}
          </ul>
          <pre className="cmd" aria-label="The FFmpeg command">
            <span>ffmpeg</span>
            {args.map((a, i) => (
              <Fragment key={i}>
                {" "}
                <span>
                  {hit.has(i) ? <mark>{quoteArg(a)}</mark> : quoteArg(a)}
                </span>
              </Fragment>
            ))}
          </pre>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={copy}
          >
            {copied === "done" ? "Copied" : "Copy the command"}
          </button>
          {copied === "blocked" && (
            <p className="step__hint" role="status">
              This browser blocked copying. Select the command above and copy it
              by hand.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
