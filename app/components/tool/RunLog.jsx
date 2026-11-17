import CheckList from "./CheckList.jsx";

/** One sentence for a run that never produced a result. */
function problem(run) {
  if (run.rejected)
    return `This command was not allowed, so nothing ran: ${run.rejected}`;
  if (!run.ok)
    return run.error
      ? `FFmpeg stopped: ${run.error}`
      : "FFmpeg stopped before it finished";
  return run.errors[0] ?? null;
}

/**
 * Every run, oldest first, so a failed run stays on screen above its retry. The wrapper is a polite live region:
 * a screen reader hears each run's checks as they land.
 * @param {{ runs: import("../../agent/loop.js").Run[], children?: import("react").ReactNode }} props `children` renders after the runs (the progress line)
 */
export default function RunLog({ runs, children }) {
  return (
    <div className="runlog" aria-live="polite">
      {runs.map((r) => (
        <div key={r.n} className="run" data-passed={r.passed}>
          <p className="run__t">
            Run {r.n}
            {r.n > 1 ? ", trying again" : ""}
            <span className="sr">
              {r.passed ? ", every check passed" : ", did not pass"}
            </span>
          </p>
          {r.checks.length > 0 && <CheckList checks={r.checks} />}
          {r.checks.length === 0 && problem(r) && (
            <p className="run__problem">{problem(r)}</p>
          )}
        </div>
      ))}
      {children}
    </div>
  );
}
