// One ffmpeg.wasm instance (core-mt 0.12.10, FFmpeg 5.1.4) behind a small async API. @ffmpeg/ffmpeg already runs the
// core in its own Web Worker, so the page never blocks; this wrapper adds what the agent needs on top:
//  - one command at a time (the core is not re-entrant), in call order;
//  - the log of each command, returned with its exit code;
//  - a watchdog: the core's own timeout is checked inside FFmpeg's loop, so a deadlocked core never reaches it.
//    When the watchdog fires the worker is killed and the in-memory files go with it (a command that needs an
//    earlier file then fails with FFmpeg's "No such file" text rather than hanging).
import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  FFMPEG_CORE_BASE,
  RUN_TIMEOUT_MS,
  RUN_WATCHDOG_GRACE_MS,
} from "../config.js";

/** @typedef {{ code: number, log: string, timedOut: boolean }} Exec */

/** The video engine itself did not start (core file missing, worker or memory failure): not the person's video. */
export class EngineStartError extends Error {
  code = "engine_start";
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message, { cause });
    this.name = "EngineStartError";
  }
}

/** Fetch a core file into a blob URL. @ffmpeg/util's toBlobURL never looks at response.ok, so a 404 page became "the core". */
async function coreBlobURL(url, type) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
}

export class FfmpegSession {
  /** @param {{ coreBase?: string }} [opts] */
  constructor({ coreBase = FFMPEG_CORE_BASE } = {}) {
    this.coreBase = coreBase;
    /** @type {FFmpeg | null} */
    this.ff = null;
    /** @type {Promise<unknown> | null} */
    this.loading = null;
    this.queue = Promise.resolve();
    /** @type {Set<(ratio: number) => void>} */
    this.progressListeners = new Set();
  }

  /** Listen to FFmpeg's own progress (0 to 1) while a command runs. Returns the unsubscribe function. */
  onProgress(fn) {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  /** Load the core once (blob URLs for core, wasm and the pthread worker, as the ffmpeg.wasm docs do for core-mt). */
  async #ready() {
    if (this.ff?.loaded) return this.ff;
    if (!this.loading) {
      const ff = new FFmpeg();
      const url = (f, type) => coreBlobURL(`${this.coreBase}/${f}`, type);
      this.loading = (async () => {
        try {
          await ff.load({
            coreURL: await url("ffmpeg-core.js", "text/javascript"),
            wasmURL: await url("ffmpeg-core.wasm", "application/wasm"),
            workerURL: await url("ffmpeg-core.worker.js", "text/javascript"),
          });
        } catch (e) {
          ff.terminate();
          throw new EngineStartError(
            e instanceof Error ? e.message : String(e),
            e,
          );
        }
        this.ff = ff;
      })().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    return /** @type {FFmpeg} */ (this.ff);
  }

  /** Run `fn` after every earlier call has settled; a failure does not block the ones behind it. */
  #serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Run an FFmpeg command. Never throws for a failing command: the exit code and log say what happened.
   * @param {string[]} args
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<Exec>}
   */
  exec(args, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
    return this.#serial(async () => {
      const ff = await this.#ready();
      let log = "";
      const onLog = ({ message }) => (log += message + "\n");
      ff.on("log", onLog);
      // ffmpeg.wasm derives the ratio from the log's time and the input duration; it can overshoot, so clamp it.
      const onProg = ({ progress }) => {
        const ratio = Math.min(1, Math.max(0, progress));
        for (const fn of this.progressListeners) fn(ratio);
      };
      ff.on("progress", onProg);
      const started = performance.now();
      let watchdog;
      try {
        const killed = new Promise((resolve) => {
          watchdog = setTimeout(
            () => resolve("killed"),
            timeoutMs + RUN_WATCHDOG_GRACE_MS,
          );
        });
        const code = await Promise.race([ff.exec(args, timeoutMs), killed]);
        if (code === "killed") {
          this.dispose();
          return { code: 1, log, timedOut: true };
        }
        const timedOut = code !== 0 && performance.now() - started >= timeoutMs;
        return { code, log, timedOut };
      } catch (e) {
        // A worker that died (or was terminated) mid-command.
        return { code: 1, log: log + `\n${e?.message ?? e}`, timedOut: false };
      } finally {
        clearTimeout(watchdog);
        ff.off("log", onLog);
        ff.off("progress", onProg);
      }
    });
  }

  /** shortcut: the buffer is transferred to the worker, so the caller's array is empty afterwards. */
  write(path, bytes) {
    return this.#serial(async () =>
      (await this.#ready()).writeFile(path, bytes),
    );
  }
  /** @returns {Promise<Uint8Array>} */
  read(path) {
    return this.#serial(
      async () =>
        /** @type {Uint8Array} */ (await (await this.#ready()).readFile(path)),
    );
  }
  mkdir(path) {
    return this.#serial(async () => {
      await (await this.#ready()).createDir(path).catch(() => {}); // exists already
    });
  }
  /** @returns {Promise<{ name: string, isDir: boolean }[]>} */
  list(dir) {
    return this.#serial(async () => (await this.#ready()).listDir(dir));
  }
  remove(path) {
    return this.#serial(async () => {
      await (await this.#ready()).deleteFile(path).catch(() => {});
    });
  }

  /** Kill the worker. The session can be used again; it loads a fresh, empty core. */
  dispose() {
    this.ff?.terminate();
    this.ff = null;
  }
}
