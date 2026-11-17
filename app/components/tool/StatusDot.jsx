// The only round element in the UI: a dot and one plain sentence about what the tool is doing.
const TEXT = {
  starting: "Starting",
  ready: "Ready, on this computer",
  busy: "Working, on this computer",
  stopped: "Stopped",
};

/** @param {{ status: "starting" | "ready" | "busy" | "stopped" }} props */
export default function StatusDot({ status }) {
  return (
    <span className="win__state" role="status" data-status={status}>
      <i className={`dot dot--${status}`} aria-hidden="true" />
      {TEXT[status] ?? TEXT.stopped}
    </span>
  );
}
