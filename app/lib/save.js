// Hand the finished file to the person. The File System Access API (a real save dialog) where the browser has it,
// otherwise a click on an <a download>. Resolves true when a file was written through the dialog, "started" when the
// download link was clicked (a browser may still block it and nothing can detect that, so it is never called "saved"),
// false when the person closed the dialog. It throws when the file could not be handed over at all.

/**
 * @param {Blob} blob
 * @param {string} name suggested file name
 * @returns {Promise<boolean | "started">}
 */
export async function saveFile(blob, name) {
  if (typeof globalThis.showSaveFilePicker === "function") {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: name,
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return false; // the person cancelled
      // anything else (a sandboxed frame, a blocked picker): use the download link instead
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "started";
}
