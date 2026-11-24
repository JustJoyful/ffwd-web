import { useState } from "react";
import { saveFile } from "../../lib/save.js";

export const SAVE_FAILED_TEXT =
  "The file couldn't be saved. Try again, or pick another place to save it.";

/**
 * "Download", then "Downloaded" (written through the save dialog) or "Download started" (the browser was handed a link;
 * it may still block it). Disabled until the file is ready; nothing is claimed if the person closes the dialog, and a
 * failure says so in words instead of nothing happening.
 * @param {{ blob: Blob | null, name: string, label?: string }} props
 */
export default function DownloadButton({ blob, name, label = "Download" }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        disabled={!blob}
        onClick={async () => {
          setFailed(false);
          try {
            setDone(await saveFile(blob, name));
          } catch {
            setDone(false);
            setFailed(true);
          }
        }}
      >
        {done === "started" ? "Download started" : done ? "Downloaded" : label}
      </button>
      {failed && <small role="alert">{SAVE_FAILED_TEXT}</small>}
    </>
  );
}
