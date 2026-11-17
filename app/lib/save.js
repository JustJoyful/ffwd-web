// Hand the finished file to the person. The File System Access API (a real save dialog) where the browser has it,
// otherwise a click on an <a download>. Resolves true when a file was written or handed over, false when the person
// closed the dialog; it never throws for that.

/**
 * @param {Blob} blob
 * @param {string} name suggested file name
 * @returns {Promise<boolean>}
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
  return true;
}
