// In-page side of the GGUF-in-the-browser spike (reports/2026-11-23-browser-gguf in the ffwd repo). Everything the
// runner measures goes through window.spike. The prompt is ALWAYS built here by our own renderChat and handed to the
// runtime as a plain-text completion prompt; the runtime's own chat template is never used.
import { Wllama } from "/vendor/wllama/index.js";
import { renderChat } from "/app/agent/chat-template.js";
import { FfmpegSession } from "/app/agent/executor/ffmpeg-session.js";
import { harnessArgs } from "/app/agent/executor/harness-args.js";

const logs = [];
const keep =
  (level) =>
  (...a) => {
    if (logs.length < 4000) logs.push(`${level}: ${a.join(" ")}`);
  };
const logger = {
  debug: keep("d"),
  log: keep("l"),
  warn: keep("w"),
  error: keep("e"),
};
let w = null;
let loadedCtx = 0; // n_ctx of the loaded model, for the context rule in complete()
let ff = null;
let clip = null;
const MAX_TOKENS = 512;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

async function adapterInfo(options) {
  const a = await navigator.gpu.requestAdapter(options);
  if (!a) return { adapter: null };
  const info = a.info ?? {};
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: info.isFallbackAdapter ?? a.isFallbackAdapter ?? null,
    features: [...a.features],
    maxBufferSize: a.limits.maxBufferSize,
    maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize,
  };
}

/** The adapter the page gets (optionally for a power preference) plus what each preference picks. */
async function gpuInfo(powerPreference) {
  if (!navigator.gpu) return { present: false };
  const main = await adapterInfo(
    powerPreference ? { powerPreference } : undefined,
  );
  const byPreference = {};
  for (const pp of ["low-power", "high-performance"]) {
    const i = await adapterInfo({ powerPreference: pp });
    byPreference[pp] =
      i.adapter === null
        ? null
        : `${i.vendor} ${i.architecture} ${i.description}`.trim();
  }
  return {
    present: true,
    requested: powerPreference ?? "default",
    ...main,
    byPreference,
  };
}

async function wipeOpfs() {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) {
    await root.removeEntry(name, { recursive: true });
  }
}

let hb = null;
function startHeartbeat() {
  const gaps = [];
  const longTasks = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const n = performance.now();
    gaps.push(n - last);
    last = n;
  }, 50);
  const po = new PerformanceObserver((l) =>
    longTasks.push(...l.getEntries().map((e) => e.duration)),
  );
  po.observe({ type: "longtask" });
  hb = { timer, po, gaps, longTasks };
}
function stopHeartbeat() {
  clearInterval(hb.timer);
  hb.po.disconnect();
  const g = [...hb.gaps].sort((a, b) => a - b);
  const out = {
    ticks: g.length,
    max_stall_ms: g.length ? Math.max(0, g[g.length - 1] - 50) : null, // period is 50 ms
    p99_gap_ms: g.length ? g[Math.floor(g.length * 0.99)] : null,
    long_tasks: hb.longTasks.length,
    long_task_max_ms: hb.longTasks.length ? Math.max(...hb.longTasks) : 0,
  };
  hb = null;
  return out;
}

async function complete(messages, { maxTokens = MAX_TOKENS } = {}) {
  const prompt = renderChat(messages);
  const t0 = performance.now();
  // Context rule (D-050): no history truncation. A prompt that, with the reply budget, would not fit ends the episode.
  const nPrompt = (
    await w.tokenize(prompt, { addSpecial: false, parseSpecial: true })
  ).length;
  if (nPrompt + maxTokens > loadedCtx) {
    throw new Error(
      `context_full: prompt ${nPrompt} + reply budget ${maxTokens} > n_ctx ${loadedCtx}`,
    );
  }
  const r = await w.createCompletion({
    prompt,
    max_tokens: maxTokens,
    temperature: 0,
    seed: 20261115,
  });
  const t1 = performance.now();
  return {
    text: r.choices[0].text,
    finish_reason: r.choices[0].finish_reason,
    usage: r.usage,
    timings: r.timings,
    wall_ms: t1 - t0,
    t0,
    t1,
  };
}

const rate = (rs, n, ms) => {
  const tokens = sum(rs, (x) => x.timings[n]);
  const t = sum(rs, (x) => x.timings[ms]);
  return t > 0 ? (tokens / t) * 1000 : null;
};

async function ffmpegPrepare(clipUrl) {
  if (!ff) {
    ff = new FfmpegSession();
    await ff.exec(["-version"]); // loads the core
  }
  if (!clip) {
    clip = new Uint8Array(await (await fetch(clipUrl)).arrayBuffer());
    await ff.write("clip.mp4", clip.slice());
  }
}

async function ffmpegRun({ clipUrl, jobArgs }) {
  await ffmpegPrepare(clipUrl);
  const argv = [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...harnessArgs(jobArgs, { clip: "clip.mp4" }, { out1: "out.mp4" }),
  ];
  const t0 = performance.now();
  const r = await ff.exec(argv, { timeoutMs: 600000 });
  const ms = performance.now() - t0;
  let outBytes = null;
  try {
    outBytes = (await ff.read("out.mp4")).length;
    await ff.remove("out.mp4");
  } catch {
    /* the exit code and log below say what happened */
  }
  return {
    exec_ms: ms,
    code: r.code,
    timed_out: r.timedOut,
    out_bytes: outBytes,
    log_tail: r.log.slice(-300),
  };
}

window.spike = {
  logs: () => logs.slice(),
  async env(powerPreference) {
    return {
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: navigator.deviceMemory ?? null,
      userAgent: navigator.userAgent,
      gpu: await gpuInfo(powerPreference),
      libllama: Wllama.getLibllamaVersion(),
    };
  },

  async load({
    url,
    nGpuLayers,
    nThreads,
    nCtx,
    kvK,
    kvV,
    flashAttn,
    connections,
    clearCache = false,
  }) {
    if (clearCache) await wipeOpfs();
    w = new Wllama({ default: "/vendor/wllama/wasm/wllama.wasm" }, { logger });
    let loaded = 0;
    let total = 0;
    const t0 = performance.now();
    await w.loadModelFromUrl(url, {
      ...(connections ? { connections } : {}),
      n_ctx: nCtx,
      n_gpu_layers: nGpuLayers,
      ...(kvK ? { cache_type_k: kvK } : {}),
      ...(kvV ? { cache_type_v: kvV } : {}),
      ...(flashAttn ? { flash_attn: flashAttn === "true" } : {}),
      ...(nThreads ? { n_threads: nThreads } : {}),
      progressCallback: (p) => {
        loaded = p.loaded;
        total = p.total;
      },
    });
    const ms = performance.now() - t0;
    const info = w.getLoadedContextInfo();
    loadedCtx = info.n_ctx;
    const est = await navigator.storage.estimate();
    return {
      load_ms: ms,
      downloaded_bytes: loaded,
      total_bytes: total,
      multithread: w.isMultithread(),
      threads: w.getNumThreads(),
      n_ctx: info.n_ctx,
      n_batch: info.n_batch,
      n_vocab: info.n_vocab,
      eos: info.token_eos,
      eot: info.token_eot,
      eog: info.list_tokens_eog,
      storage_usage_bytes: est.usage,
    };
  },

  complete,
  /** One cross-origin ranged fetch, the way the runtime downloads: status and the CORS-visible headers. */
  async corsProbe(url) {
    const r = await fetch(url, { headers: { Range: "bytes=0-1023" } });
    const body = await r.arrayBuffer();
    return {
      status: r.status,
      type: r.type,
      bytes: body.byteLength,
      contentRange: r.headers.get("content-range"),
      acceptRanges: r.headers.get("accept-ranges"),
    };
  },
  async tokenize(text) {
    return w.tokenize(text, { addSpecial: false, parseSpecial: true });
  },

  /** Token ids from the runtime's own tokenizer AND the prompt length its completion path uses, for each case. */
  async tokcheck(cases) {
    const bad = [];
    for (const c of cases) {
      const ids = await w.tokenize(c.rendered, {
        addSpecial: false,
        parseSpecial: true,
      });
      const r = await w.createCompletion({
        prompt: c.rendered,
        max_tokens: 1,
        temperature: 0,
      });
      const i = ids.findIndex((x, k) => x !== c.token_ids[k]);
      if (
        ids.length !== c.token_ids.length ||
        i >= 0 ||
        r.usage.prompt_tokens !== c.token_ids.length
      ) {
        bad.push({
          name: c.name,
          got: ids.length,
          want: c.token_ids.length,
          first_diff: i,
          completion_prompt_tokens: r.usage.prompt_tokens,
        });
      }
    }
    return { checked: cases.length, bad };
  },

  /** Model alone, ffmpeg alone, both together; the main-thread heartbeat runs through each phase. */
  async coexist({ prompts, clipUrl, jobArgs, nAlone = 6 }) {
    const phases = {};
    startHeartbeat(); // 1. idle baseline
    await sleep(3000);
    phases.idle = stopHeartbeat();
    startHeartbeat(); // 2. model alone
    const alone = [];
    for (let i = 0; i < nAlone; i++) {
      alone.push(
        await complete(prompts[i % prompts.length], { maxTokens: 160 }),
      );
    }
    phases.model_alone = {
      hb: stopHeartbeat(),
      completions: alone.length,
      gen_tok_s: rate(alone, "predicted_n", "predicted_ms"),
      pp_tok_s: rate(alone, "prompt_n", "prompt_ms"),
      mean_wall_ms: sum(alone, (x) => x.wall_ms) / alone.length,
    };
    await ffmpegPrepare(clipUrl); // 3. ffmpeg alone (core and clip loaded first, untimed)
    startHeartbeat();
    const fAlone = await ffmpegRun({ clipUrl, jobArgs });
    phases.ffmpeg_alone = { hb: stopHeartbeat(), ...fAlone };
    startHeartbeat(); // 4. together: the model keeps generating until ffmpeg finishes
    const together = [];
    let done = false;
    const tStart = performance.now();
    const f = ffmpegRun({ clipUrl, jobArgs }).then((r) => {
      done = true;
      return { ...r, t_end: performance.now() };
    });
    for (let i = 0; !done; i++) {
      together.push(
        await complete(prompts[i % prompts.length], { maxTokens: 160 }),
      );
    }
    const fTogether = await f;
    const inside = together.filter((x) => x.t1 <= fTogether.t_end);
    phases.together = {
      hb: stopHeartbeat(),
      ffmpeg: fTogether,
      overlap_s: (fTogether.t_end - tStart) / 1000,
      completions_total: together.length,
      completions_inside: inside.length,
      gen_tok_s: inside.length
        ? rate(inside, "predicted_n", "predicted_ms")
        : null,
      pp_tok_s: inside.length ? rate(inside, "prompt_n", "prompt_ms") : null,
    };
    return phases;
  },

  /**
   * The app's REAL worker host (app/model/model-host.js, the logic model.worker.js wires up) on a real wllama: cold init,
   * one greedy turn, exit, then a warm init from the browser cache. Returns every message the host posted.
   */
  async hostSmoke({ url, sha256, bytes, nCtx, path, prompt }) {
    const { createModelHost } = await import("/app/model/model-host.js");
    const out = [];
    const host = createModelHost({
      post: (m) => out.push(m),
      loadWllama: async () =>
        new Wllama({ default: "/vendor/wllama/wasm/wllama.wasm" }, { logger }),
    });
    const init = {
      type: "init",
      modelUrl: url,
      sha256,
      bytes,
      nCtx,
      path,
      kvCache: "q8_0",
    };
    await host.handle(init);
    await host.handle({
      type: "generate",
      id: 1,
      prompt: renderChat([{ role: "user", content: prompt }]),
      maxTokens: 16,
    });
    await host.handle({ type: "exit" });
    out.push({ type: "marker", note: "warm init follows" });
    await host.handle(init);
    await host.handle({ type: "exit" });
    return out;
  },

  async unload() {
    await w?.exit();
    w = null;
  },
  cacheSize: (name) => w.cacheManager.getSize(name),
};
