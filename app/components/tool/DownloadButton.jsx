import { useState } from "react";
import { saveFile } from "../../lib/save.js";

/**
 * "Download", then "Downloaded". Disabled until the file is ready; nothing is claimed if the person closes the dialog.
 * @param {{ blob: Blob | null, name: string, label?: string }} props
 */
export default function DownloadButton({ blob, name, label = "Download" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--sm"
      disabled={!blob}
      onClick={async () => setDone(await saveFile(blob, name))}
    >
      {done ? "Downloaded" : label}
    </button>
  );
}
