/**
 * The one-time model download. The percent is a plain numeral (not a spinner), and nothing moves, so reduced motion
 * changes nothing here.
 * @param {{ state: "not started" | "downloading" | "ready" | "failed", percent?: number, sizeMb?: number }} props
 */
export default function ModelLoader({ state, percent = 0, sizeMb }) {
  const size = sizeMb ? `${sizeMb} MB` : "the model";
  return (
    <div className="loader" data-state={state} role="status">
      {state === "not started" && (
        <p>
          ffwd needs to download {size} once. It is kept in your browser after
          that.
        </p>
      )}
      {state === "downloading" && (
        <>
          <p className="loader__n tn">{Math.round(percent)}%</p>
          <p>Downloading {size}. This happens once; it is cached after this.</p>
        </>
      )}
      {state === "ready" && <p>The model is ready, on this computer.</p>}
      {state === "failed" && (
        <p>The download stopped. Check your connection and try again.</p>
      )}
    </div>
  );
}
