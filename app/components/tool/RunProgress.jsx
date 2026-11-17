/**
 * Progress of the FFmpeg run: a plain numeral and a bar that is only ever a width, never an animation that pulses.
 * `percent` is null while nothing has been reported yet; then only the words show.
 * @param {{ percent: number | null, label: string }} props
 */
export default function RunProgress({ percent, label }) {
  const known = typeof percent === "number";
  return (
    <div className="progress">
      <p className="progress__t">
        {label}
        {known && <span className="tn"> {Math.round(percent)}%</span>}
      </p>
      {known && (
        <div
          className="bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <i className="ok" style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
    </div>
  );
}
