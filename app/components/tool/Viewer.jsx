import { useState } from "react";

/**
 * The picture. Your video until a result exists, then a switch between the two. A browser that can't decode the file
 * says so in words instead of showing a black box (the file itself is fine).
 * @param {{ originalUrl: string | null, resultUrl: string | null, name: string }} props
 */
export default function Viewer({ originalUrl, resultUrl, name }) {
  const [pick, setPick] = useState("result");
  const [failed, setFailed] = useState(null);
  const which = resultUrl && pick === "result" ? "result" : "original";
  const src = which === "result" ? resultUrl : originalUrl;
  return (
    <div className="viewer-box">
      <div className="viewer viewer--tool" data-empty={!src || undefined}>
        {src && failed !== src ? (
          <video
            key={src}
            src={`${src}#t=0.001`}
            controls
            muted
            playsInline
            preload="auto"
            aria-label={which === "result" ? `Result of ${name}` : name}
            onError={() => setFailed(src)}
          />
        ) : (
          <p className="viewer__empty">
            {src
              ? "This browser can't show a preview of this file. The file itself is fine."
              : "Your video appears here"}
          </p>
        )}
      </div>
      {resultUrl && (
        <div className="seg" role="group" aria-label="Which video to show">
          {[
            ["original", "Your video"],
            ["result", "Result"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={which === k}
              onClick={() => setPick(k)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
