// Which file to take from a choose or a drop, and what to tell the person when there is none. Pure, so the input and
// the full-page drop target behave identically and the cases are testable without a browser.
import { ACCEPTED_EXTENSIONS, maxFileBytes } from "../lib/capability.js";

export const NOTICE = {
  notVideo:
    "That file isn't a video ffwd can open. Choose an MP4, MOV, MKV or WebM file.",
  empty: "That file is empty. Choose another video.",
  busy: "ffwd is working on a video right now. When it finishes, choose another one.",
};

/** @param {File} f */
export const isVideo = (f) =>
  f.type.startsWith("video/") ||
  ACCEPTED_EXTENSIONS.some((e) => f.name.toLowerCase().endsWith(e));

const gb = (n) => `${+(n / 1024 ** 3).toFixed(1)} GB`;

/**
 * @param {ArrayLike<File>} files
 * @param {{ disabled?: boolean, deviceMemory?: number }} [opts]
 * @returns {{ file: File | null, notice: string | null }} a notice can come with a file (several chosen, a large one)
 */
export function pickFile(files, { disabled = false, deviceMemory } = {}) {
  if (disabled) return { file: null, notice: NOTICE.busy };
  const list = [...files];
  if (!list.length) return { file: null, notice: null };
  const file = list[0];
  if (!isVideo(file)) return { file: null, notice: NOTICE.notVideo };
  if (file.size === 0) return { file: null, notice: NOTICE.empty };
  const notes = [];
  if (list.length > 1)
    notes.push(`You chose ${list.length} files. ffwd opened the first one.`);
  if (file.size > maxFileBytes(deviceMemory))
    notes.push(
      `This video is large (${gb(file.size)}). ffwd may be slow or run out of memory on this computer.`,
    );
  return { file, notice: notes.join(" ") || null };
}
