// The browser's FFmpeg: one ffmpeg.wasm session behind the engine's `Executor` and `Measure` interfaces, plus the
// file plumbing the page needs (write a chosen video in, read a result out). Nothing here knows about the model.
import { BrowserExecutor } from "./executor/browser-executor.js";
import { FfmpegSession } from "./executor/ffmpeg-session.js";
import { BrowserMeasure } from "./measure/browser-measure.js";
import { parseFfmpegProbe } from "./measure/probe-log.js";

/** The id the model uses for the person's (first) video, as in the Python corpus tasks. */
export const INPUT_ID = "clip";

const safeName = (name) =>
  String(name)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(-60) || "file";

/**
 * @param {{ coreBase?: string, timeoutMs?: number }} [opts]
 * @returns {{
 *   executor: BrowserExecutor,
 *   measure: BrowserMeasure,
 *   session: FfmpegSession,
 *   writeInput(name: string, bytes: Uint8Array): Promise<string>,
 *   probeFile(file: { name: string, arrayBuffer(): Promise<ArrayBuffer> }): Promise<{ id: string, probe: object, handle: string }>,
 *   adopt(path: string): Promise<string>,
 *   readOutput(handle: string, type?: string): Promise<Blob>,
 *   dispose(): void,
 * }}
 */
export function createBrowserRuntime({ coreBase, timeoutMs } = {}) {
  const session = new FfmpegSession({ coreBase });
  /** @type {Map<string, number>} */
  const sizes = new Map();
  const executor = new BrowserExecutor(session, sizes, { timeoutMs });
  const measure = new BrowserMeasure(session, sizes);
  let files = 0;

  /** Put bytes into the core's memory and return the handle the Measure and Executor use. */
  async function writeInput(name, bytes) {
    const path = `in/${++files}-${safeName(name)}`;
    const size = bytes.byteLength; // the buffer is transferred away by the write
    await session.mkdir("in");
    await session.write(path, bytes);
    sizes.set(path, size);
    return path;
  }

  return {
    executor,
    measure,
    session,
    writeInput,
    /** The machine's `probeFile` dependency: a chosen file becomes the job's input "clip". */
    async probeFile(file) {
      const handle = await writeInput(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      const { log } = await session.exec(["-hide_banner", "-i", handle]);
      const probe = parseFfmpegProbe(
        log,
        /** @type {number} */ (sizes.get(handle)),
      );
      executor.setInputs({ [INPUT_ID]: handle });
      return { id: INPUT_ID, probe, handle };
    },
    /** Register a file FFmpeg wrote itself outside a run (test fixtures); returns its handle. */
    async adopt(path) {
      sizes.set(path, (await session.read(path)).byteLength);
      return path;
    },
    async readOutput(handle, type = "application/octet-stream") {
      return new Blob([await session.read(handle)], { type });
    },
    dispose: () => session.dispose(),
  };
}
