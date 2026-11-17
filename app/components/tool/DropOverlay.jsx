import { useEffect, useState } from "react";
import { pickFile } from "../../tool/intake.js";

const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");

/**
 * One full-page drop target while a file is dragged over the window. A drag fires dragenter and dragleave for every
 * element it crosses, so a counter decides when it has really left.
 * @param {{ onFile(file: File): void, onNotice?(text: string | null): void, disabled?: boolean }} props
 */
export default function DropOverlay({ onFile, onNotice, disabled = false }) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    // Without preventDefault on dragover the browser would open the dropped file in the tab.
    const dragover = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const r = pickFile(e.dataTransfer.files, {
        disabled,
        deviceMemory: navigator.deviceMemory,
      });
      onNotice?.(r.notice);
      if (r.file) onFile(r.file);
    };
    const esc = (e) => {
      if (e.key === "Escape") {
        depth = 0;
        setOver(false);
      }
    };
    const on = [
      ["dragenter", enter],
      ["dragleave", leave],
      ["dragover", dragover],
      ["drop", drop],
      ["keydown", esc],
    ];
    for (const [t, f] of on) window.addEventListener(t, f);
    return () => {
      for (const [t, f] of on) window.removeEventListener(t, f);
    };
  }, [onFile, onNotice, disabled]);

  if (!over) return null;
  return (
    <div className="drop" role="presentation" aria-hidden="true">
      <p>Drop to open in ffwd. It stays on this computer.</p>
    </div>
  );
}
