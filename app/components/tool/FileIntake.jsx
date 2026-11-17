import { useId, useState } from "react";
import { pickFile } from "../../tool/intake.js";

/**
 * Choose a video. A plain file input, so keyboard and screen readers get the browser's own behaviour. The message
 * (a refused file, several files, a large one) sits below it in a polite live region.
 * @param {{ onFile(file: File): void, disabled?: boolean, notice?: string | null, label?: string, quiet?: boolean }} props `notice` carries a message from a drop elsewhere on the page
 */
export default function FileIntake({
  onFile,
  disabled = false,
  notice = null,
  label = "Choose a video",
  quiet = false,
}) {
  const id = useId();
  const [message, setMessage] = useState(null);
  const shown = message ?? notice;
  return (
    <div className="intake">
      <label
        className={`btn btn--sm ${quiet ? "btn--ghost" : "btn--accent"} intake__btn${disabled ? " is-disabled" : ""}`}
        htmlFor={id}
      >
        {label}
      </label>
      <input
        id={id}
        className="intake__input"
        type="file"
        accept="video/*,.mkv,.mov,.m4v,.mts,.m2ts"
        disabled={disabled}
        onChange={(e) => {
          const r = pickFile(e.target.files, {
            disabled,
            deviceMemory: navigator.deviceMemory,
          });
          setMessage(r.notice);
          if (r.file) onFile(r.file);
          e.target.value = ""; // choosing the same file again must still fire
        }}
      />
      <p className="intake__hint">
        {disabled
          ? "You can choose another video when this job is finished."
          : "Or drop one anywhere on this page. It stays on this computer."}
      </p>
      <p className="intake__note" role="status">
        {shown}
      </p>
    </div>
  );
}
