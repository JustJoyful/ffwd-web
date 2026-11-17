import { CHORES } from "../../content/showcase-chores.js";

// The chore's diagram on its own page: the same plan chips and measured checks the home page demo plays, shown
// finished. Built from the demo's data (app/content/showcase-chores.js), so the two cannot disagree. Static markup:
// nothing to load, nothing animated.

const Icon = ({ ok }) => (
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

/** @param {{ id: string }} props the showcase chore id (a chore's `diagram`) */
export default function ChoreDiagram({ id }) {
  const c = CHORES.find((x) => x.id === id);
  if (!c) return null;
  return (
    <figure
      className="chore__diagram"
      aria-label={`What ffwd does for “${c.ask}”`}
    >
      <p className="probe-line">
        {c.file.name}, {c.file.size}
      </p>
      <p className="ask">{c.ask}</p>
      <div className="chips" aria-label="The plan">
        {c.plan.map(([k, v, change]) => (
          <span key={k} className={`chip${change ? " is-change" : ""}`}>
            {k}
            <b>{v}</b>
          </span>
        ))}
      </div>
      {c.runs.map((r, i) => (
        <div className="run" key={i}>
          {r.t && <p className="run__t">{r.t}</p>}
          <div className="checks">
            {r.checks.map(([k, v, ok, why]) => (
              <div key={k} className={`ck${ok ? "" : " is-fail"}`}>
                <span>{k}</span>
                <b>
                  {v}
                  {why && <em>{why}</em>}
                </b>
                <Icon ok={Boolean(ok)} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <figcaption>
        Result: {c.out.size ? `${c.out.name}, ${c.out.size}` : c.out.name}.
        Every check passed.
      </figcaption>
    </figure>
  );
}
