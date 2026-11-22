// The worker side of the model contract (contract.js), as pure logic: no `self`, no wllama import. model.worker.js
// wires `post` to self.postMessage and `loadWllama` to the real runtime; the tests wire a fake. One host holds at most
// one loaded model.
//
//   init      fetch the GGUF into the browser cache if it is not there, check its sha256 once, load it into wllama
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
import { createSha256 } from "./sha256.js";

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

  /** Returns true when the file was already in the cache (no download). Throws typed errors. */
  async function ensureFile(w, msg) {
    const cm = w.cacheManager;
    const name = await cm.getNameFromURL(msg.modelUrl);
    const size = await cm.getSize(name);
    const meta = size >= 0 ? await cm.getMetadata(name) : null;
    // The verified marker is the sha256 stored in the cache entry's metadata: a warm load does not rehash 444 MB.
    if (size === msg.bytes && meta?.sha256 === msg.sha256) return true;

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
    await cm.writeMetadata(name, {
      ...(await cm.getMetadata(name)),
      sha256: msg.sha256,
    });
    return !downloaded;
  }

  async function init(msg) {
    if (wllama || starting) {
      throw typed("load_failed", "the model is already loaded or loading");
    }
    starting = true;
    const mine = epoch;
    const t0 = now();
    let w = null;
    try {
      w = await loadWllama();
      wllama = w;
      const cached = await ensureFile(w, msg);
      await w.loadModelFromUrl(msg.modelUrl, {
        n_ctx: msg.nCtx,
        n_gpu_layers: msg.path === "webgpu" ? 999 : 0,
        cache_type_k: msg.kvCache,
        cache_type_v: msg.kvCache,
        flash_attn: msg.kvCache === "q8_0", // a quantised V cache needs flash attention
        ...(msg.threads ? { n_threads: msg.threads } : {}),
      });
      if (mine !== epoch) throw typed("aborted", "exit arrived while loading");
      ready = { nCtx: w.getLoadedContextInfo()?.n_ctx ?? msg.nCtx };
      post({
        type: WORKER_OUT.PROGRESS,
        phase: "load",
        loaded: msg.bytes,
        total: msg.bytes,
      });
      const a =
        msg.path === "webgpu" ? await readAdapter?.().catch(() => null) : null;
      post({
        type: WORKER_OUT.READY,
        path: msg.path,
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
