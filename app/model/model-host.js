// The worker side of the model contract (contract.js), as pure logic: no `self`, no wllama import. model.worker.js
// wires `post` to self.postMessage and `loadWllama` to the real runtime; the tests wire a fake. One host holds at most
// one loaded model.
//
//   init      fetch the GGUF into the browser cache if it is not there, check its sha256 once, load it into wllama.
//             With `probe` (a first visit on a graphics-capable device) it also picks the path: load the graphics engine,
//             run the canary (canary.js) and a speed test, free it, load the processor engine, speed-test that, and keep
//             the faster correct one (reloading the graphics engine if it won). Only ONE engine is alive at any time
//             (low-memory devices), and the loser is always freed first.
//   generate  greedy completion of a PLAIN-TEXT prompt (the main thread rendered it; no chat template in here)
//   exit      free the model
//
// Context rule (D-050): tokenise the prompt; if tokens + maxTokens > nCtx the answer is the error "context_full".
// The history is never truncated: a silently shortened prompt would be a different task from the one the model was
// trained on.
import {
  ERROR_CODES,
  WORKER_IN,
  WORKER_OUT,
  validateWorkerMessage,
} from "./contract.js";
import { runBenchmark, runCanary, pickPath } from "./canary.js";
import { createSha256 } from "./sha256.js";
import { VERIFIED_FIELD, isVerified, verifiedMarker } from "./verified.js";

const typed = (code, message) => Object.assign(new Error(message), { code });
const text = (e) => (e instanceof Error ? e.message : String(e));
// wasm and the browser report running out of memory in several ways; none is a clean error type.
const OOM =
  /out of memory|bad_alloc|memory access out of bounds|allocat|RangeError/i;
const classify = (e, fallback) =>
  e?.code && ERROR_CODES.includes(e.code)
    ? e.code
    : OOM.test(`${e?.name} ${text(e)}`)
      ? "out_of_memory"
      : fallback;

/** Read a Blob a chunk at a time into a sha256, so the 444 MB file is never held twice in memory. */
async function hashBlob(blob) {
  const h = createSha256();
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return h.digest();
    h.update(value);
  }
}

/**
 * @param {{ post: (m: object) => void, loadWllama: () => Promise<any>, readAdapter?: () => Promise<{ vendor?: string, architecture?: string, isFallbackAdapter?: boolean | null } | null>, now?: () => number }} deps
 *   loadWllama resolves to a (not yet loaded) Wllama; readAdapter is the WebGPU adapter lookup (the real one lives in lib/capability.js)
 */
export function createModelHost({
  post,
  loadWllama,
  readAdapter,
  now = () => performance.now(),
}) {
  let wllama = null;
  let starting = false; // an init is in flight
  let ready = null; // { nCtx } once a model is loaded
  let epoch = 0; // bumped by exit(), so a load that finishes after it is dropped silently
  let busy = Promise.resolve(); // generate calls run one at a time

  const free = async (w) => {
    try {
      await w?.exit();
    } catch {
      /* already gone */
    }
  };

  /**
   * Makes sure the verified model file is in the cache and returns it: `{ cached, blob }`. `cached` is true when no
   * download happened. The blob is the one that was hashed (or that carries our own marker), and it is what gets loaded
   * (not a second lookup by URL that could download again). Throws typed errors.
   */
  async function ensureFile(w, msg) {
    const cm = w.cacheManager;
    const name = await cm.getNameFromURL(msg.modelUrl);
    const size = await cm.getSize(name);
    const meta = size >= 0 ? await cm.getMetadata(name) : null;
    // Warm path: our own marker (verified.js), written only after a full hash of these bytes. wllama's `sha256`
    // metadata is not trusted: it can be set before anything was hashed.
    if (size === msg.bytes && isVerified(meta, name, msg)) {
      const blob = await cm.open(name);
      if (blob?.size === msg.bytes) return { cached: true, blob };
    }
    // A wrong-sized entry would be reused by download() without a fetch (it matches on URL and recorded size).
    if (size >= 0 && size !== msg.bytes) await cm.delete(name).catch(() => {});

    const downloaded = size !== msg.bytes;
    if (downloaded) {
      let last = -1;
      await cm.download(msg.modelUrl, {
        progressCallback: ({ loaded, total }) => {
          const pct = total > 0 ? Math.floor((loaded * 100) / total) : 0;
          if (pct === last && loaded < total) return; // at most about 100 messages
          last = pct;
          post({ type: WORKER_OUT.PROGRESS, phase: "download", loaded, total });
        },
      });
    }
    post({
      type: WORKER_OUT.PROGRESS,
      phase: "load",
      loaded: 0,
      total: msg.bytes,
    });
    const blob = await cm.open(name);
    const bad = async (why) => {
      await cm.delete(name).catch(() => {}); // never keep a file that failed the check
      throw typed("hash_mismatch", why);
    };
    if (!blob || blob.size !== msg.bytes) {
      await bad(
        `the model file has ${blob?.size ?? 0} bytes, expected ${msg.bytes}`,
      );
    }
    if ((await hashBlob(blob)) !== msg.sha256) {
      await bad("the model file's sha256 differs");
    }
    // Only now, after the full pass: if the tab dies before this line, the next visit hashes again.
    await cm.writeMetadata(name, {
      ...(await cm.getMetadata(name)),
      [VERIFIED_FIELD]: verifiedMarker(name, msg),
    });
    return { cached: !downloaded, blob };
  }

  /** The engine settings per path (the owner-confirmed configuration, config.js). `threads` is for the processor only. */
  const loadModel = (w, msg, path, blob) =>
    w.loadModel([blob], {
      n_ctx: msg.nCtx,
      n_gpu_layers: path === "webgpu" ? 999 : 0,
      cache_type_k: msg.kvCache,
      cache_type_v: msg.kvCache,
      flash_attn: msg.kvCache === "q8_0", // a quantised V cache needs flash attention
      ...(path === "cpu" && msg.threads ? { n_threads: msg.threads } : {}),
    });

  async function init(msg) {
    if (wllama || starting) {
      throw typed("load_failed", "the model is already loaded or loading");
    }
    starting = true;
    const mine = epoch;
    const t0 = now();
    let w = null; // the engine being loaded now (freed on any failure)
    const alive = () => {
      if (mine !== epoch) throw typed("aborted", "exit arrived while loading");
    };
    const progress = (p) => post({ type: WORKER_OUT.PROGRESS, ...p });
    /** Free the current engine, then start a new unloaded one: two engines never exist together. */
    const swap = async () => {
      const old = w;
      w = null;
      wllama = null;
      await free(old);
      alive();
      w = await loadWllama();
      wllama = w;
    };
    try {
      w = await loadWllama();
      wllama = w;
      const { cached, blob } = await ensureFile(w, msg);
      let path = msg.path;
      let selection;
      if (!msg.probe) {
        await loadModel(w, msg, path, blob);
      } else {
        const bench = {};
        let canary = "skipped";
        let matched = 0;
        if (msg.path === "webgpu") {
          try {
            await loadModel(w, msg, "webgpu", blob);
            alive();
            progress({ phase: "check", loaded: 0, total: 0, step: "canary" });
            const c = await runCanary(w, msg.canary);
            alive();
            canary = c.pass ? "pass" : "fail";
            matched = c.matched;
            if (c.pass) {
              progress({
                phase: "check",
                loaded: 0,
                total: 0,
                step: "benchmark",
              });
              const b = await runBenchmark(w, msg.canary.prompt);
              if (b) bench.webgpu = b;
            }
          } catch (e) {
            if (e?.code === "aborted" || mine !== epoch) throw e;
            // shortcut: a graphics engine that cannot even start or finish the canary counts as broken for this
            // device (cached for the verdict's lifetime); a one-off out-of-memory is treated the same. Revisit with real devices.
            canary = "fail";
            matched = 0;
          }
          await swap();
        }
        progress({ phase: "check", loaded: 0, total: 0, step: "benchmark" });
        await loadModel(w, msg, "cpu", blob);
        alive();
        const b = await runBenchmark(w, msg.canary.prompt);
        if (b) bench.cpu = b;
        alive();
        path = canary === "pass" ? pickPath(bench) : "cpu";
        if (path === "webgpu") {
          await swap();
          await loadModel(w, msg, "webgpu", blob);
        }
        selection = { canary, matched, of: msg.canary.tokens.length, bench };
      }
      alive();
      ready = { nCtx: w.getLoadedContextInfo()?.n_ctx ?? msg.nCtx };
      progress({
        phase: "load",
        loaded: msg.bytes,
        total: msg.bytes,
      });
      const a =
        path === "webgpu" ? await readAdapter?.().catch(() => null) : null;
      post({
        type: WORKER_OUT.READY,
        path,
        threads: w.getNumThreads(),
        nCtx: ready.nCtx,
        cached,
        loadMs: now() - t0,
        ...(a
          ? {
              adapter: {
                vendor: a.vendor,
                architecture: a.architecture,
                isFallbackAdapter: a.isFallbackAdapter ?? null,
              },
            }
          : {}),
        ...(selection ? { selection } : {}),
      });
    } catch (e) {
      if (wllama === w) wllama = null;
      ready = null;
      await free(w);
      if (mine !== epoch) return; // exit() came first: nothing to report
      throw typed(classify(e, "load_failed"), text(e));
    } finally {
      starting = false;
    }
  }

  async function generate({ id, prompt, maxTokens }) {
    const w = wllama;
    if (!w || !ready) throw typed("generate_failed", "the model is not ready");
    const t0 = now();
    const nPrompt = (
      await w.tokenize(prompt, { addSpecial: false, parseSpecial: true })
    ).length;
    if (nPrompt + maxTokens > ready.nCtx) {
      throw typed(
        "context_full",
        `prompt ${nPrompt} + reply budget ${maxTokens} > n_ctx ${ready.nCtx}`,
      );
    }
    const r = await w.createCompletion({
      prompt,
      max_tokens: maxTokens,
      temperature: 0, // greedy
    });
    const c = r.choices[0];
    const t = r.timings ?? {};
    post({
      type: WORKER_OUT.RESULT,
      id,
      text: c.text,
      finishReason:
        c.finish_reason === "stop" || c.finish_reason === "length"
          ? c.finish_reason
          : null,
      timings: {
        cacheN: t.cache_n ?? 0,
        promptN: t.prompt_n ?? 0,
        promptMs: t.prompt_ms ?? 0,
        predictedN: t.predicted_n ?? 0,
        predictedMs: t.predicted_ms ?? 0,
      },
      wallMs: now() - t0,
    });
  }

  const fail = (e, id, fallback) =>
    post({
      type: WORKER_OUT.ERROR,
      ...(id !== undefined ? { id } : {}),
      code: classify(e, fallback),
      message: text(e),
    });

  return {
    /** Feed one message from the main thread. Never throws: every failure is posted as an error message. */
    async handle(m) {
      try {
        if (!Object.values(WORKER_IN).includes(m?.type)) {
          throw new Error(
            `worker message "${m?.type}": not a message for the worker`,
          );
        }
        validateWorkerMessage(m);
      } catch (e) {
        const gen = m?.type === WORKER_IN.GENERATE;
        const id = Number.isInteger(m?.id) && m.id >= 0 ? m.id : undefined;
        return fail(
          e,
          gen ? id : undefined,
          gen ? "generate_failed" : "load_failed",
        );
      }
      switch (m.type) {
        case WORKER_IN.INIT:
          return init(m).catch((e) => fail(e, undefined, "load_failed"));
        case WORKER_IN.GENERATE:
          busy = busy
            .then(() => generate(m))
            .catch((e) => fail(e, m.id, "generate_failed"));
          return busy;
        default: {
          epoch += 1;
          const w = wllama;
          wllama = null;
          ready = null;
          await free(w);
        }
      }
    },
  };
}
