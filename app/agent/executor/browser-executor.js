// The ONLY path from a model `run` action to ffmpeg.wasm (mirrors training/env/executor.py). Order: allowlist
// validation (again: defence in depth, the loop already did it) -> harness argument rewriting (id -> in-memory path,
// thread cap) -> exec -> every declared output must exist and be non-empty. A failed run deletes its outputs.
// The model never sees these paths: it names ids, the handles it gets back are opaque to it.
import { validateRun } from "../validator.js";
import {
  FFMPEG_FILTER_THREADS,
  RUN_TIMEOUT_MS,
  STDERR_TAIL_CHARS,
} from "../config.js";
import { harnessArgs } from "./harness-args.js";

/** Same fallback as training/env/executor.py output_path_for: the container, else mp4. */
const extensionOf = (spec) => spec?.container || "mp4";

export class BrowserExecutor {
  /**
   * @param {import("./ffmpeg-session.js").FfmpegSession} session
   * @param {Map<string, number>} sizes path -> byte size of every file the runtime knows (shared with the Measure)
   * @param {{ timeoutMs?: number }} [opts]
   */
  constructor(session, sizes, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
    this.session = session;
    this.sizes = sizes;
    this.timeoutMs = timeoutMs;
    /** @type {Record<string, string>} input id -> path */
    this.inputPaths = {};
    this.runs = 0;
  }

  /** Name the job's inputs: `{ clip: "in/1-video.mp4" }`. */
  setInputs(paths) {
    this.inputPaths = { ...paths };
  }

  /**
   * @param {{ args: string[], inputs: string[], outputs: string[], specs?: object[] }} action a validated run; `specs`
   *   are the job's output specs, which decide each output's container and kind
   * @returns {Promise<{ ok: boolean, log: string, outputs: Record<string, string>, error?: string }>}
   */
  async run({ args, inputs, outputs, specs = [] }) {
    const known = {
      inputs: new Set(Object.keys(this.inputPaths)),
      outputs: new Set(outputs),
    };
    const v = validateRun(args, inputs, outputs, known);
    if (!v.ok)
      return {
        ok: false,
        log: `rejected: ${v.reason}`,
        outputs: {},
        error: v.reason ?? "rejected",
      };

    const dir = `out/${++this.runs}`;
    await this.session.mkdir("out");
    await this.session.mkdir(dir);
    /** @type {Record<string, string>} id -> pattern or file path */
    const targets = {};
    /** @type {Record<string, string>} id -> the artifact a Measure reads: the file, or the directory of frames */
    const handles = {};
    const isDir = (id) => targets[id] !== handles[id];
    for (const id of outputs) {
      const spec = specs.find((s) => s.id === id);
      if (spec?.kind === "image_sequence") {
        const format = spec.frames?.format || "png";
        handles[id] = `${dir}/${id}`;
        targets[id] = `${handles[id]}/%04d.${format}`;
        await this.session.mkdir(handles[id]);
      } else handles[id] = targets[id] = `${dir}/${id}.${extensionOf(spec)}`;
    }

    const argv = [
      // -loglevel: see browser-measure.js (the level survives between commands in the core).
      ...["-hide_banner", "-nostdin", "-y", "-loglevel", "info"],
      ...FFMPEG_FILTER_THREADS,
      ...harnessArgs(args, this.inputPaths, targets),
    ];
    const r = await this.session.exec(argv, { timeoutMs: this.timeoutMs });
    // FFmpeg echoes the files it opened; the model gets ids back, never the in-memory paths (they carry the file name).
    const names = [
      ...Object.entries(this.inputPaths).map(([id, p]) => [p, `{in:${id}}`]),
      ...Object.entries(handles).map(([id, p]) => [p, `{out:${id}}`]),
    ].sort((a, b) => b[0].length - a[0].length);
    const tail = names.reduce(
      (t, [path, token]) => t.replaceAll(path, token),
      r.log.slice(-STDERR_TAIL_CHARS),
    );
    if (r.code !== 0) {
      await this.#discard(handles, isDir);
      const why = r.timedOut
        ? `timed out after ${Math.round(this.timeoutMs / 1000)} s`
        : `FFmpeg exited with code ${r.code}`;
      return {
        ok: false,
        log: r.timedOut ? `${tail}\n[timed out]` : tail,
        outputs: {},
        error: why,
      };
    }
    for (const id of outputs) {
      const size = await this.#size(handles[id], isDir(id));
      if (size === 0) {
        await this.#discard(handles, isDir);
        return {
          ok: false,
          log: `${tail}\n[missing or empty output]`.slice(-STDERR_TAIL_CHARS),
          outputs: {},
          error: "FFmpeg wrote no output",
        };
      }
      this.sizes.set(handles[id], size);
    }
    return { ok: true, log: tail, outputs: handles };
  }

  /** Bytes of a file (read out of the worker; shortcut: the worker exposes no stat), or of a frame directory. */
  async #size(path, isDir) {
    try {
      if (!isDir) return (await this.session.read(path)).byteLength;
      let total = 0;
      for (const e of await this.session.list(path))
        if (!e.isDir)
          total += (await this.session.read(`${path}/${e.name}`)).byteLength;
      return total;
    } catch {
      return 0; // never written
    }
  }

  /** Failed runs leave nothing behind (Python: _delete). */
  async #discard(handles, isDir) {
    for (const [id, h] of Object.entries(handles)) {
      this.sizes.delete(h);
      if (!isDir(id)) await this.session.remove(h);
      else
        for (const e of await this.session.list(h).catch(() => []))
          if (!e.isDir) await this.session.remove(`${h}/${e.name}`);
    }
  }
}
