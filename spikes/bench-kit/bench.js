// Browser bench kit, page side. Runs inside the person's own browser (opened by bench.mjs) and posts ONE result JSON back.
// What it measures, honestly named: it REPLAYS 20 recorded dev episodes turn by turn (the history is the recorded one,
// "teacher-forced") and compares the model's reply with the reply the native llama.cpp run gave. That is agreement with a
// reference, NOT task success (the kit has no checker). It also records timings, the WebGPU adapter, and memory.
import { Wllama } from "./vendor/wllama/index.js";
import { renderChat } from "./chat-template.js";

const q = new URLSearchParams(location.search);
const PATHS = (q.get("paths") ?? "gpu,cpu").split(",");
const GPU_TASKS = Number(q.get("tasks") ?? 20);
const CPU_TASKS = Number(q.get("cpuTasks") ?? 5);
const N_CTX = 8192;
const logEl = document.getElementById("log");
const say = (m) => {
  logEl.textContent += `${m}\n`;
  console.log(m);
};
const median = (a) =>
  a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
const pct = (a, p) =>
  a.length
    ? [...a].sort((x, y) => x - y)[
        Math.min(a.length - 1, Math.floor(a.length * p))
      ]
    : null;

async function adapterInfo(options) {
  const a = await navigator.gpu.requestAdapter(options);
  if (!a) return null;
  const i = a.info ?? {};
  return {
    vendor: i.vendor,
    architecture: i.architecture,
    device: i.device,
    description: i.description,
    isFallbackAdapter: i.isFallbackAdapter ?? a.isFallbackAdapter ?? null,
    shaderF16: a.features.has("shader-f16"),
    maxBufferSize: a.limits.maxBufferSize,
    maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize,
  };
}

async function environment() {
  const env = {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform ?? navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: navigator.deviceMemory ?? null,
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    webgpu: Boolean(navigator.gpu),
    libllama: Wllama.getLibllamaVersion(),
  };
  if (navigator.gpu) {
    env.adapters = {
      default: await adapterInfo(),
      "low-power": await adapterInfo({ powerPreference: "low-power" }),
      "high-performance": await adapterInfo({
        powerPreference: "high-performance",
      }),
    };
  }
  return env;
}

async function uaMemoryMb() {
  try {
    const m = await performance.measureUserAgentSpecificMemory();
    return Math.round(m.bytes / 1048576);
  } catch {
    return null; // needs Chrome and cross-origin isolation
  }
}

/** The path is real only if the adapter is a real one; a software adapter would make a GPU number meaningless. */
function gpuUsable(env) {
  const a = env.adapters?.default;
  if (!a) return "no WebGPU adapter";
  if (a.isFallbackAdapter) return "fallback (software) adapter";
  if (
    /swiftshader|llvmpipe|lavapipe|software/i.test(
      `${a.vendor} ${a.architecture} ${a.description}`,
    )
  )
    return "software adapter";
  return null;
}

const WELL_FORMED = new Set([
  "spec",
  "ask_user",
  "unsupported",
  "run",
  "finish",
]);
function wellFormedAction(text) {
  try {
    const o = JSON.parse(text);
    return o !== null && typeof o === "object" && WELL_FORMED.has(o.action);
  } catch {
    return false;
  }
}

async function runPath(path, prompts, nTasks, env) {
  const out = { path, tasks: 0, turns: [] };
  const skip = path === "gpu" ? gpuUsable(env) : null;
  if (skip) return { ...out, skipped: skip };
  const logs = [];
  const keep =
    (l) =>
    (...a) =>
      logs.length < 3000 && logs.push(`${l}: ${a.join(" ")}`);
  const w = new Wllama(
    { default: "./vendor/wllama/wasm/wllama.wasm" },
    {
      logger: {
        debug: keep("d"),
        log: keep("l"),
        warn: keep("w"),
        error: keep("e"),
      },
    },
  );
  say(`[${path}] loading the model ...`);
  const t0 = performance.now();
  await w.loadModelFromUrl("/model.gguf", {
    n_ctx: N_CTX,
    n_gpu_layers: path === "gpu" ? 999 : 0,
    cache_type_k: "q8_0",
    cache_type_v: "q8_0",
    flash_attn: true,
  });
  out.load_ms = performance.now() - t0; // from a local file, so this excludes any network time
  out.threads = w.getNumThreads();
  out.multithread = w.isMultithread();
  out.runtime_log = logs
    .filter((l) => /webgpu|adapter|offload|buffer size|backend/i.test(l))
    .slice(0, 40);
  if (path === "gpu" && !logs.some((l) => /webgpu/i.test(l))) {
    await w.exit();
    return { ...out, skipped: "the runtime did not start its WebGPU backend" };
  }
  out.memory_after_load_mb = await uaMemoryMb();
  const eps = prompts.episodes.slice(0, nTasks);
  out.tasks = eps.length;
  for (const ep of eps) {
    const messages = [
      { role: "system", content: prompts.system },
      { role: "user", content: ep.user0 },
    ];
    for (const turn of ep.turns) {
      const t = performance.now();
      const r = await w.createCompletion({
        prompt: renderChat(messages),
        max_tokens: 512,
        temperature: 0,
        seed: 20261115,
      });
      const wall = performance.now() - t;
      const text = r.choices[0].text;
      out.turns.push({
        task_id: ep.task_id,
        n_messages: messages.length,
        wall_ms: wall,
        prompt_n: r.timings?.prompt_n,
        cache_n: r.timings?.cache_n,
        prompt_ms: r.timings?.prompt_ms,
        predicted_n: r.timings?.predicted_n,
        predicted_ms: r.timings?.predicted_ms,
        exact_match_native: text === turn.assistant,
        well_formed_action: wellFormedAction(text),
        finish_reason: r.choices[0].finish_reason,
      });
      messages.push(
        { role: "assistant", content: turn.assistant },
        { role: "user", content: turn.observation },
      ); // recorded history
    }
    say(`[${path}] ${ep.task_id} done (${out.turns.length} turns)`);
  }
  out.memory_after_run_mb = await uaMemoryMb();
  await w.exit();
  const T = out.turns;
  const wall = T.map((x) => x.wall_ms);
  const first = T.filter((x) => x.n_messages <= 2).map((x) => x.wall_ms);
  const sum = (k) => T.reduce((s, x) => s + (x[k] ?? 0), 0);
  out.summary = {
    turns: T.length,
    exact_match_native: T.filter((x) => x.exact_match_native).length / T.length,
    well_formed_action: T.filter((x) => x.well_formed_action).length / T.length,
    median_turn_s: median(wall) / 1000,
    p90_turn_s: pct(wall, 0.9) / 1000,
    max_turn_s: Math.max(...wall) / 1000,
    median_first_turn_s: median(first) / 1000,
    prompt_tok_s: (sum("prompt_n") / sum("prompt_ms")) * 1000,
    generation_tok_s: (sum("predicted_n") / sum("predicted_ms")) * 1000,
  };
  return out;
}

async function main() {
  const prompts = await (await fetch("/prompts.json")).json();
  const env = await environment();
  say(`browser: ${env.userAgent}`);
  say(`WebGPU adapter: ${JSON.stringify(env.adapters?.default)}`);
  say(
    `cross-origin isolated: ${env.crossOriginIsolated}, threads available: ${env.hardwareConcurrency}`,
  );
  const result = {
    kit: "ffwd-bench-kit 1",
    started: new Date().toISOString(),
    env,
    paths: {},
  };
  for (const path of PATHS) {
    try {
      result.paths[path] = await runPath(
        path,
        prompts,
        path === "gpu" ? GPU_TASKS : CPU_TASKS,
        env,
      );
    } catch (e) {
      result.paths[path] = { path, error: String(e?.stack ?? e).slice(0, 600) };
    }
    const s = result.paths[path].summary;
    say(
      `[${path}] ${s ? `median turn ${s.median_turn_s.toFixed(2)} s, agreement with native ${(100 * s.exact_match_native).toFixed(0)}%, well-formed ${(100 * s.well_formed_action).toFixed(0)}%` : (result.paths[path].skipped ?? result.paths[path].error)}`,
    );
  }
  result.finished = new Date().toISOString();
  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  say(
    "Done. The result file was written next to bench.mjs. You can close this tab.",
  );
}

main().catch(async (e) => {
  say(`FAILED: ${e}`);
  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: "ffwd-bench-kit 1",
      fatal: String(e?.stack ?? e),
    }),
  }).catch(() => {});
});
