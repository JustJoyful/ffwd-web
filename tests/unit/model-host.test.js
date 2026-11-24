// The worker-side host (app/model/model-host.js) against a FAKE wllama: no browser, no real model.
import { Blob } from "node:buffer"; // jsdom's Blob has no stream()
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createModelHost } from "../../app/model/model-host.js";
import { validateWorkerMessage } from "../../app/model/contract.js";
import { cacheIsVerified } from "../../app/model/client.js";

const CONTENT = new TextEncoder().encode(
  "a pretend gguf file, 40 bytes long..!!",
);
const SHA = createHash("sha256").update(CONTENT).digest("hex");
const URL_ = "http://localhost/m.gguf";
const MARKER = { name: `k_${URL_}`, sha256: SHA, bytes: CONTENT.length };
const INIT = {
  type: "init",
  modelUrl: URL_,
  sha256: SHA,
  bytes: CONTENT.length,
  nCtx: 100,
  path: "webgpu",
  kvCache: "q8_0",
};
const gen = (id, prompt = "hello", maxTokens = 10) => ({
  type: "generate",
  id,
  prompt,
  maxTokens,
});

/** A browser cache plus a wllama that behaves like the real one where the host touches it. */
function makeEnv({ cache = null, download = CONTENT, ...over } = {}) {
  const store = new Map(); // name -> { blob, meta }
  if (cache) store.set(`k_${URL_}`, cache);
  const log = {
    downloads: 0,
    loads: [],
    blobs: [],
    exits: 0,
    deletes: 0,
    completions: [],
  };
  const cacheManager = {
    getNameFromURL: async (u) => `k_${u}`,
    getSize: async (n) => store.get(n)?.blob.size ?? -1,
    getMetadata: async (n) => store.get(n)?.meta ?? null,
    download: async (u, { progressCallback }) => {
      log.downloads += 1;
      if (over.downloadFails) throw new Error("network down");
      const total = download.length;
      for (const loaded of [0, total / 2, total]) {
        progressCallback({ loaded, total });
      }
      store.set(`k_${u}`, {
        blob: new Blob([download]),
        meta: { originalSize: total },
      });
    },
    open: async (n) => store.get(n)?.blob ?? null,
    delete: async (n) => {
      log.deletes += 1;
      store.delete(n);
    },
    writeMetadata: async (n, meta) => {
      store.get(n).meta = meta;
    },
  };
  const wllama = {
    cacheManager,
    // The host loads the blob it verified, never a second lookup by URL (review S2).
    loadModel: async (blobs, o) => {
      if (over.loadFails) throw new Error(over.loadFails);
      log.loads.push({ ...o });
      log.blobs.push(blobs);
    },
    getLoadedContextInfo: () => ({ n_ctx: over.ctx ?? 100 }),
    getNumThreads: () => 4,
    tokenize: async (p) => Array.from({ length: over.tokens ?? p.length }),
    createCompletion: async (o) => {
      log.completions.push(o);
      if (over.generateFails) throw new Error(over.generateFails);
      return {
        choices: [{ text: `reply to ${o.prompt}`, finish_reason: "stop" }],
        timings: {
          cache_n: 1,
          prompt_n: 2,
          prompt_ms: 3,
          predicted_n: 4,
          predicted_ms: 5,
        },
      };
    },
    exit: async () => {
      log.exits += 1;
    },
  };
  const out = [];
  const host = createModelHost({
    post: (m) => out.push(m),
    loadWllama: async () => wllama,
    readAdapter:
      over.adapter === undefined ? undefined : async () => over.adapter,
  });
  return { host, out, log, store };
}

const types = (out) => out.map((m) => m.type);

describe("init", () => {
  test("cold start: download, verify, load, ready (cached false)", async () => {
    const { host, out, log, store } = makeEnv();
    await host.handle(INIT);
    out.forEach(validateWorkerMessage); // every message follows the contract
    expect(log.downloads).toBe(1);
    const ready = out.at(-1);
    expect(ready).toMatchObject({
      type: "ready",
      path: "webgpu",
      threads: 4,
      nCtx: 100,
      cached: false,
    });
    expect(ready.loadMs).toBeGreaterThanOrEqual(0);
    // our own verified marker is stored for the next visit, after the hash
    expect(store.get(`k_${URL_}`).meta.ffwdVerified).toEqual(MARKER);
  });

  test("settings: q8_0 KV cache with flash attention, all layers on the graphics chip", async () => {
    const { host, log } = makeEnv();
    await host.handle(INIT);
    expect(log.loads).toEqual([
      {
        n_ctx: 100,
        n_gpu_layers: 999,
        cache_type_k: "q8_0",
        cache_type_v: "q8_0",
        flash_attn: true,
      },
    ]);
  });

  test("cpu path: no layers offloaded; f16 cache without flash attention; threads passed", async () => {
    const { host, log } = makeEnv();
    await host.handle({ ...INIT, path: "cpu", kvCache: "f16", threads: 3 });
    expect(log.loads[0]).toMatchObject({
      n_gpu_layers: 0,
      cache_type_k: "f16",
      flash_attn: false,
      n_threads: 3,
    });
  });

  test("progress ordering: download, then load, then ready last", async () => {
    const { host, out } = makeEnv();
    await host.handle(INIT);
    const order = out.map((m) => (m.type === "progress" ? m.phase : m.type));
    const firstLoad = order.indexOf("load");
    expect(order.slice(0, firstLoad).every((p) => p === "download")).toBe(true);
    expect(order.at(-1)).toBe("ready");
    expect(order.filter((p) => p === "download").length).toBeGreaterThan(1);
    const dl = out.filter((m) => m.phase === "download");
    expect(dl.at(-1)).toMatchObject({
      loaded: CONTENT.length,
      total: CONTENT.length,
    });
    const loads = out.filter((m) => m.phase === "load");
    expect(loads.at(-1)).toMatchObject({
      loaded: CONTENT.length,
      total: CONTENT.length,
    });
  });

  test("warm start: a verified cache entry is not downloaded or rehashed", async () => {
    // a blob that throws when read proves there is no rehash
    const trap = {
      blob: {
        size: CONTENT.length,
        stream: () => {
          throw new Error("rehashed");
        },
      },
      meta: { originalSize: CONTENT.length, ffwdVerified: MARKER },
    };
    const { host, out, log } = makeEnv({ cache: trap });
    await host.handle(INIT);
    expect(log.downloads).toBe(0);
    expect(out.at(-1)).toMatchObject({ type: "ready", cached: true });
    expect(types(out)).not.toContain("error");
  });

  test("a cached file with no verified marker is hashed once, not downloaded", async () => {
    const cache = {
      blob: new Blob([CONTENT]),
      meta: { originalSize: CONTENT.length },
    };
    const { host, out, log, store } = makeEnv({ cache });
    await host.handle(INIT);
    expect(log.downloads).toBe(0);
    expect(out.at(-1)).toMatchObject({ type: "ready", cached: true });
    expect(store.get(`k_${URL_}`).meta.ffwdVerified).toEqual(MARKER);
  });

  // Review S2: wllama writes `sha256` into the metadata from the host's claim when a download ends, before any hash. A tab
  // that died during the hash leaves exactly that, and it must not count as verified.
  test("wllama's own sha256 field is not a verified marker: the file is hashed again", async () => {
    const bad = new Uint8Array(CONTENT);
    bad[0] ^= 1; // different bytes, same size, the host-claimed hash in the metadata
    const cache = {
      blob: new Blob([bad]),
      meta: { originalSize: CONTENT.length, sha256: SHA },
    };
    const { host, out, log } = makeEnv({ cache });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({ type: "error", code: "hash_mismatch" });
    expect(log.loads).toHaveLength(0);
  });

  test("a marker for another sha256, size or file name does not count", async () => {
    for (const marker of [
      { ...MARKER, sha256: "0".repeat(64) },
      { ...MARKER, bytes: CONTENT.length + 1 },
      { ...MARKER, name: "k_other" },
    ]) {
      const bad = new Uint8Array(CONTENT);
      bad[0] ^= 1;
      const { host, out } = makeEnv({
        cache: {
          blob: new Blob([bad]),
          meta: { originalSize: CONTENT.length, ffwdVerified: marker },
        },
      });
      await host.handle(INIT);
      expect(out.at(-1)).toMatchObject({ code: "hash_mismatch" });
    }
  });

  test("the marker is written only after the hash: a tab that dies while hashing leaves none", async () => {
    const { host, store } = makeEnv();
    store.set(`k_${URL_}`, {
      blob: {
        size: CONTENT.length,
        stream: () => {
          throw new Error("tab died"); // stands in for the page going away mid-hash
        },
      },
      meta: { originalSize: CONTENT.length, sha256: SHA },
    });
    await host.handle(INIT);
    expect(store.get(`k_${URL_}`).meta.ffwdVerified).toBeUndefined();
  });

  test("the verified blob is what gets loaded, and a wrong-sized cached entry is deleted before the download", async () => {
    const { host, log, store } = makeEnv({
      cache: {
        blob: new Blob([CONTENT.slice(0, 7)]),
        meta: { originalSize: 7, originalURL: URL_ },
      },
    });
    await host.handle(INIT);
    expect(log.deletes).toBe(1); // the stale entry, not a hash failure
    expect(log.downloads).toBe(1);
    expect(log.blobs[0]).toHaveLength(1);
    expect(log.blobs[0][0]).toBe(store.get(`k_${URL_}`).blob);
  });

  test("hash mismatch: the file is deleted, error hash_mismatch, nothing loaded, the runtime freed", async () => {
    const bad = new Uint8Array(CONTENT);
    bad[0] ^= 1;
    const { host, out, log, store } = makeEnv({ download: bad });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({ type: "error", code: "hash_mismatch" });
    expect(types(out)).not.toContain("ready");
    expect(log.loads).toHaveLength(0);
    expect(log.deletes).toBe(1);
    expect(store.size).toBe(0);
    expect(log.exits).toBe(1);
  });

  test("a download of the wrong size is a hash_mismatch too", async () => {
    const { host, out } = makeEnv({ download: CONTENT.slice(0, 10) });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({ type: "error", code: "hash_mismatch" });
  });

  test("load failure: error load_failed with the reason, runtime freed", async () => {
    const { host, out, log } = makeEnv({ loadFails: "bad gguf" });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({
      type: "error",
      code: "load_failed",
      message: "bad gguf",
    });
    expect(log.exits).toBe(1);
  });

  test("download failure: load_failed", async () => {
    const { host, out } = makeEnv({ downloadFails: true });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({
      type: "error",
      code: "load_failed",
      message: "network down",
    });
  });

  test("running out of memory while loading is out_of_memory", async () => {
    const { host, out } = makeEnv({ loadFails: "std::bad_alloc" });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({ type: "error", code: "out_of_memory" });
  });

  test("the adapter is reported on the graphics path only", async () => {
    const adapter = {
      vendor: "nvidia",
      architecture: "ampere",
      isFallbackAdapter: false,
      description: "not forwarded",
    };
    const a = makeEnv({ adapter });
    await a.host.handle(INIT);
    expect(a.out.at(-1).adapter).toEqual({
      vendor: "nvidia",
      architecture: "ampere",
      isFallbackAdapter: false,
    });
    const b = makeEnv({ adapter });
    await b.host.handle({ ...INIT, path: "cpu" });
    expect(b.out.at(-1).adapter).toBeUndefined();
  });

  test("a second init is refused while a model is loaded", async () => {
    const { host, out } = makeEnv();
    await host.handle(INIT);
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({ type: "error", code: "load_failed" });
  });
});

describe("generate", () => {
  const started = async (over) => {
    const e = makeEnv(over);
    await e.host.handle(INIT);
    e.out.length = 0;
    return e;
  };

  test("happy path: greedy, result carries text, finish reason, timings, wall time", async () => {
    const { host, out, log } = await started();
    await host.handle(gen(7, "hello", 10));
    validateWorkerMessage(out[0]);
    expect(out[0]).toMatchObject({
      type: "result",
      id: 7,
      text: "reply to hello",
      finishReason: "stop",
      timings: {
        cacheN: 1,
        promptN: 2,
        promptMs: 3,
        predictedN: 4,
        predictedMs: 5,
      },
    });
    expect(out[0].wallMs).toBeGreaterThanOrEqual(0);
    expect(log.completions).toEqual([
      { prompt: "hello", max_tokens: 10, temperature: 0 },
    ]);
  });

  test("context_full: prompt tokens + budget over n_ctx is an error, never a truncation", async () => {
    const { host, out, log } = await started({ tokens: 95 });
    await host.handle(gen(1, "x", 10)); // 95 + 10 > 100
    expect(out[0]).toMatchObject({
      type: "error",
      id: 1,
      code: "context_full",
    });
    expect(log.completions).toHaveLength(0);
  });

  test("exactly filling the context is allowed", async () => {
    const { host, out } = await started({ tokens: 90 });
    await host.handle(gen(1, "x", 10)); // 90 + 10 = 100
    expect(out[0]).toMatchObject({ type: "result", id: 1 });
  });

  test("the context rule uses the n_ctx the runtime actually loaded", async () => {
    const { host, out } = await started({ ctx: 50, tokens: 45 });
    await host.handle(gen(1, "x", 10));
    expect(out[0]).toMatchObject({ type: "error", code: "context_full" });
  });

  test("generate failure: error generate_failed with the id", async () => {
    const { host, out } = await started({ generateFails: "kernel died" });
    await host.handle(gen(3));
    expect(out[0]).toMatchObject({
      type: "error",
      id: 3,
      code: "generate_failed",
      message: "kernel died",
    });
  });

  test("a failed generate does not stop the next one", async () => {
    const { host, out } = await started({ tokens: 99 });
    await host.handle(gen(1, "x", 10));
    await host.handle(gen(2, "x", 1));
    expect(types(out)).toEqual(["error", "result"]);
  });

  test("generate before ready is generate_failed", async () => {
    const { host, out } = makeEnv();
    await host.handle(gen(1));
    expect(out[0]).toMatchObject({
      type: "error",
      id: 1,
      code: "generate_failed",
    });
  });

  test("two generates run one at a time, in order", async () => {
    const { host, out } = await started();
    await Promise.all([host.handle(gen(1)), host.handle(gen(2))]);
    expect(out.map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("exit", () => {
  test("frees the model; generate afterwards fails", async () => {
    const { host, out, log } = makeEnv();
    await host.handle(INIT);
    out.length = 0;
    await host.handle({ type: "exit" });
    expect(log.exits).toBe(1);
    await host.handle(gen(1));
    expect(out[0]).toMatchObject({ type: "error", code: "generate_failed" });
  });

  test("a model can be loaded again after exit", async () => {
    const { host, out } = makeEnv();
    await host.handle(INIT);
    await host.handle({ type: "exit" });
    await host.handle(INIT);
    expect(out.at(-1)).toMatchObject({ type: "ready" });
  });

  test("exit while loading: the loaded runtime is freed and nothing is reported", async () => {
    const { host, out, log } = makeEnv();
    const p = host.handle(INIT);
    await host.handle({ type: "exit" });
    await p;
    expect(log.exits).toBeGreaterThanOrEqual(1);
    expect(types(out)).not.toContain("ready");
    expect(types(out)).not.toContain("error");
  });
});

describe("malformed messages", () => {
  test.each([
    ["no type", {}, "load_failed"],
    ["null", null, "load_failed"],
    ["an outgoing type", { type: "ready" }, "load_failed"],
    ["init with a bad hash", { ...INIT, sha256: "zz" }, "load_failed"],
    ["init with a bad path", { ...INIT, path: "gpu" }, "load_failed"],
  ])("%s is rejected with an error message", async (_, msg, code) => {
    const { host, out, log } = makeEnv();
    await host.handle(msg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", code });
    expect(log.downloads + log.loads.length).toBe(0);
  });

  test("a malformed generate is generate_failed and keeps its id", async () => {
    const { host, out } = makeEnv();
    await host.handle({ type: "generate", id: 4, prompt: "", maxTokens: 5 });
    expect(out[0]).toMatchObject({
      type: "error",
      id: 4,
      code: "generate_failed",
    });
  });
});

describe("the main thread's warm-cache probe uses the same marker (review S2)", () => {
  const cm = (meta, size = CONTENT.length) => ({
    getNameFromURL: async () => `k_${URL_}`,
    getSize: async () => size,
    getMetadata: async () => meta,
  });
  const cfg = { sha256: SHA, bytes: CONTENT.length };
  test("only our marker counts, never wllama's sha256 field", async () => {
    expect(await cacheIsVerified(cm({ ffwdVerified: MARKER }), URL_, cfg)).toBe(
      true,
    );
    expect(await cacheIsVerified(cm({ sha256: SHA }), URL_, cfg)).toBe(false);
    expect(await cacheIsVerified(cm(null), URL_, cfg)).toBe(false);
    expect(
      await cacheIsVerified(cm({ ffwdVerified: MARKER }, 5), URL_, cfg),
    ).toBe(false);
  });
});
