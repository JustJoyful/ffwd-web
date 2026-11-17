// Argument rewriting done by the HARNESS, never by the model (RULES §1.3: the model only names ids).
// Ported from the Phase 0 spike's harness-args.ts; the Python executor needs none of it (native FFmpeg is not
// affected by the core-mt thread deadlock).
import { FFMPEG_DECODE_THREADS, FFMPEG_THREADS } from "../config.js";

/**
 * Insert `-threads N` right before every output token and `-threads 1` right before every `-i`.
 *
 * Why: in @ffmpeg/core-mt 0.12.10 every re-encode deadlocks when FFmpeg picks its own thread count; stream copy is
 * unaffected. Placing the cap last also overrides any `-threads` the model wrote earlier (the allowlist permits the
 * option). On the input side, two video inputs with the concat filter deadlock on decoder threads.
 * @param {string[]} args
 * @param {number} [n]
 * @param {number} [decode]
 */
export function capThreads(
  args,
  n = FFMPEG_THREADS,
  decode = FFMPEG_DECODE_THREADS,
) {
  return args.flatMap((a) =>
    /^\{out:/.test(a)
      ? ["-threads", String(n), a]
      : a === "-i"
        ? ["-threads", String(decode), a]
        : [a],
  );
}

/**
 * Replace {in:id} and {out:id} with in-memory file names. Only ever called on validated args.
 * @param {string[]} args
 * @param {Record<string, string>} inputs id -> path
 * @param {Record<string, string>} outputs id -> path (a %04d pattern for image sequences)
 */
export function substitute(args, inputs, outputs) {
  return args.map((a) => {
    const m = /^\{(in|out):([a-z][a-z0-9_]*)\}$/.exec(a);
    if (!m) return a;
    return (m[1] === "in" ? inputs : outputs)[m[2]] ?? a;
  });
}

/** The exact argv for a validated model action (without the leading `-hide_banner -nostdin -y`). */
export const harnessArgs = (args, inputs, outputs) =>
  substitute(capThreads(args), inputs, outputs);
