import { useEffect, useRef, useState } from "react";
import { MODEL, modelUrl } from "../../model/config.js";
import { MODEL_ERROR_TEXT } from "../../model/contract.js";

/** Bytes as the megabytes a person reads ("444 MB"), from the config's size, never a typed number. */
export const mb = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;

/** True while the job cannot start: the model is not there yet, is on its way, or failed. */
export const modelBlocks = (model) =>
  ["needsConsent", "downloading", "loading", "failed"].includes(model?.phase);

/**
 * The on-device model, in the person's words: ask before the one-time download, show it arriving, say plainly when it
 * cannot start. Ready renders nothing (ModelPathNotice already says where it runs). Only the static sentence is a live
 * region; the moving numbers sit in a progressbar so a screen reader is not read every byte.
 * @param {{ model: import("../../model/contract.js").ModelState, onConsent?: () => void, onDecline?: () => void, onRetry?: () => void, available?: boolean }} props
 *   `available` is false when this build has no model URL (config.js modelUrl), so there is nothing to offer.
 */
export default function ModelLoader({
  model,
  onConsent,
  onDecline,
  onRetry,
  available = Boolean(modelUrl()),
}) {
  const { phase } = model;
  // "Not now" is a choice the person made, not a phase of the model: kept here, forgotten once the phase moves on.
  const [declined, setDeclined] = useState(false);
  if (declined && phase !== "needsConsent") setDeclined(false);
  // "Not now" removes itself; keep keyboard focus on what is left
  const primary = useRef(null);
  useEffect(() => {
    if (declined) primary.current?.focus();
  }, [declined]);

  if (phase === "needsConsent" && !available) {
    return (
      <div className="notice" role="status" data-phase="unavailable">
        <p className="notice__t">The on-device model is not published yet</p>
        <p>ffwd can't make a plan in this build until it is.</p>
      </div>
    );
  }
  if (phase === "needsConsent") {
    const size = mb(model.total || MODEL.bytes);
    return (
      <div className="notice" role="status" data-phase="needsConsent">
        <p className="notice__t">
          {declined ? "The model was not downloaded" : "Download the model"}
        </p>
        <p>
          {declined
            ? `Without it ffwd can't make a plan. It is ${size}, downloaded once. It stays in your browser; your videos never leave your computer.`
            : `The on-device model has to be downloaded once: ${size}. It stays in your browser; your videos never leave your computer.`}
        </p>
        <div className="notice__actions">
          <button
            ref={primary}
            type="button"
            className="btn btn--sm btn--blue"
            onClick={onConsent}
          >
            {declined ? "Download model again" : "Download model"}
          </button>
          {!declined && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => {
                setDeclined(true);
                onDecline?.();
              }}
            >
              Not now
            </button>
          )}
        </div>
      </div>
    );
  }
  if (phase === "downloading") {
    const known = model.total > 0;
    const percent = known
      ? Math.min(100, Math.round((model.loaded / model.total) * 100))
      : null;
    return (
      <div className="loader" data-phase="downloading">
        <p role="status">Downloading the model</p>
        {known && (
          <p className="loader__n tn" aria-hidden="true">
            {percent}%
          </p>
        )}
        <p className="tn">
          {known
            ? `${mb(model.loaded)} of ${mb(model.total)}`
            : mb(model.loaded)}
          . It is saved in your browser for next time.
        </p>
        {known && (
          <div className="progress">
            <div
              className="bar"
              role="progressbar"
              aria-label="Model download"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <i
                className="ok"
                style={{ transform: `scaleX(${percent / 100})` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
  if (phase === "loading") {
    // A warm start from the cache shows no download words: nothing is being downloaded.
    return (
      <div className="loader" data-phase="loading">
        <p role="status">Starting the model</p>
      </div>
    );
  }
  if (phase === "failed") {
    const code = model.error?.code;
    return (
      <div className="notice notice--bad" role="alert" data-phase="failed">
        <p className="notice__t">The model could not start</p>
        <p>
          {MODEL_ERROR_TEXT[code] ??
            model.error?.message ??
            "The on-device model could not start."}
        </p>
        {code !== "out_of_memory" && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
  return null;
}
