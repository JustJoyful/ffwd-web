// Runner for the GGUF-in-the-browser spike. Launches Chromium (Playwright), serves page.html with the site's
// isolation headers, and drives window.spike. Modes:
//   bridge     HTTP bridge for the Python parity harness: POST /generate {messages} -> the model's reply text
//   loadtimes  cold load (empty cache), warm load (same browser), warm load after a browser restart
//   coexist    one F4 re-encode in ffmpeg.wasm while the model generates (alone / together)
//   tokcheck   the runtime's tokenizer vs llama.cpp's ids on protocol/conformance/chat-template-tokens.json
// Common flags: --model <gguf> --mode gpu|cpu --out <dir> [--ctx 8192] [--threads N] [--port 4333]
// Every run asserts that the accelerated path it claims is real (software WebGPU adapters are refused) and records
// hardware, browser and flags in env.json. Run it under `systemd-run --user --scope -p MemoryMax=...`.
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./server.mjs";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GPU_FLAGS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-angle=vulkan",
];
const NUMERIC = ["ctx", "port", "bridgePort", "threads"];

export function parseArgs(argv) {
  const o = { mode: "gpu", ctx: 8192, port: 4333, bridgePort: 8123 };
  const [cmd, ...rest] = argv;
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i]
      .replace(/^--/, "")
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = NUMERIC.includes(k) ? Number(rest[i + 1]) : rest[i + 1];
  }
  return { cmd, ...o };
}

async function launch(o, profile) {
  const args = o.mode === "gpu" ? GPU_FLAGS : [];
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const consoleLog = [];
  page.on("console", (m) =>
    consoleLog.push(`${m.type()}: ${m.text()}`.slice(0, 400)),
  );
  page.on("pageerror", (e) =>
    consoleLog.push(`pageerror: ${e.message}`.slice(0, 400)),
  );
  await page.goto(`http://127.0.0.1:${o.port}/`);
  await page.waitForFunction(() => typeof window.spike?.env === "function");
  return { ctx, page, args, consoleLog, version: ctx.browser()?.version() };
}

/** The accelerated path must be real. Throws with every reason; a run that fails here is discarded, never reported. */
export function assertPaths(mode, env, loaded, logs) {
  const bad = [];
  if (!env.crossOriginIsolated) bad.push("page is not cross-origin isolated");
  if (!env.sharedArrayBuffer) bad.push("no SharedArrayBuffer");
  if (!loaded.multithread || loaded.threads < 2) {
    bad.push(`not multithreaded (threads ${loaded.threads})`);
  }
  if (mode === "gpu") {
    const g = env.gpu;
    if (!g.present || g.adapter === null) bad.push("no WebGPU adapter");
    else {
      if (g.isFallbackAdapter) bad.push("fallback (software) adapter");
      const who = `${g.architecture} ${g.description} ${g.vendor} ${g.device}`;
      if (/swiftshader|llvmpipe|software|lavapipe/i.test(who)) {
        bad.push(`software adapter: ${who}`);
      }
    }
    if (!logs.some((l) => /webgpu/i.test(l))) {
      bad.push(
        "no WebGPU line in the runtime log (GPU backend not initialised)",
      );
    }
  }
  if (bad.length) {
    throw new Error(`path assertion failed (${mode}): ${bad.join("; ")}`);
  }
}

const GPU_LINES =
  /webgpu|wgpu|dawn|adapter|offload|backend|buffer size|layers/i;
const loadArgs = (o) => ({
  url: `http://127.0.0.1:${o.port}/model/${basename(o.model)}`,
  nGpuLayers: o.mode === "gpu" ? 999 : 0,
  nThreads: o.threads,
  nCtx: o.ctx,
  kvK: o.kvK,
  kvV: o.kvV,
  flashAttn: o.flashAttn,
});

async function boot(o, { clearCache, profile }) {
  const model = resolve(o.model);
  const server = await startServer({
    port: o.port,
    extra: {
      "/model/": `${dirname(model)}/`,
      "/protocol/": `${resolve(SITE, "protocol")}/`,
      ...(o.clipDir ? { "/clip/": `${resolve(o.clipDir)}/` } : {}),
    },
  });
  const b = await launch(o, profile);
  const env = await b.page.evaluate(() => window.spike.env());
  const loaded = await b.page.evaluate((a) => window.spike.load(a), {
    ...loadArgs(o),
    clearCache,
  });
  const logs = await b.page.evaluate(() => window.spike.logs());
  assertPaths(o.mode, env, loaded, logs);
  const hardware = {
    cpu: readFileSync("/proc/cpuinfo", "utf8").match(
      /model name\s*:\s*(.*)/,
    )?.[1],
    mem_total_kb: readFileSync("/proc/meminfo", "utf8").match(
      /MemTotal:\s*(\d+)/,
    )?.[1],
  };
  return {
    server,
    ...b,
    env,
    loaded,
    hardware,
    runtimeLog: logs.filter((l) => GPU_LINES.test(l)).slice(0, 80),
  };
}

async function shutdown(s) {
  await s.page.evaluate(() => window.spike.unload()).catch(() => {});
  await s.ctx.close();
  s.server.close();
}

const writeJson = (dir, name, v) =>
  writeFileSync(`${dir}/${name}`, JSON.stringify(v, null, 2) + "\n");
const pkg = (p) =>
  JSON.parse(
    readFileSync(resolve(SITE, `node_modules/${p}/package.json`), "utf8"),
  ).version;
const record = (o, s) => ({
  mode: o.mode,
  model: basename(o.model),
  n_ctx: o.ctx,
  kv_cache: {
    k: o.kvK ?? "f16",
    v: o.kvV ?? "f16",
    flash_attn: o.flashAttn ?? "default",
  },
  chromium: s.version,
  chromium_args: s.args,
  playwright: pkg("playwright"),
  wllama: pkg("@wllama/wllama"),
  env: s.env,
  load: s.loaded,
  hardware: s.hardware,
  runtime_log_gpu_lines: s.runtimeLog,
});

export async function runTokcheck(o) {
  const profile = resolve(
    o.profile ?? `${SITE}/test-results/wllama-profile-tok`,
  );
  rmSync(profile, { recursive: true, force: true });
  const s = await boot(o, { clearCache: true, profile });
  try {
    const cases = JSON.parse(
      readFileSync(
        resolve(SITE, "protocol/conformance/chat-template-tokens.json"),
        "utf8",
      ),
    ).cases;
    return await s.page.evaluate((c) => window.spike.tokcheck(c), cases);
  } finally {
    await shutdown(s);
    rmSync(profile, { recursive: true, force: true });
  }
}

/** GPU memory in use (whole device, MiB) and the resident memory of this process tree (MiB). */
export function memSample() {
  const gpu = Number(
    execFileSync(
      "nvidia-smi",
      ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
      { encoding: "utf8" },
    ).split("\n")[0],
  );
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const tree = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (tree.has(ppid) && !tree.has(pid)) (tree.add(pid), (grew = true));
    }
  }
  const rss = rows
    .filter(([pid]) => tree.has(pid))
    .reduce((a, r) => a + r[2], 0);
  return { gpu_mib: gpu, rss_mib: Math.round(rss / 1024) };
}

/** cgroup memory of this process's scope: peak, current, and how often the MemoryHigh throttle fired. */
export function cgroupStats() {
  try {
    const path = readFileSync("/proc/self/cgroup", "utf8")
      .trim()
      .split("::")[1];
    const f = (n) => readFileSync(`/sys/fs/cgroup${path}/${n}`, "utf8").trim();
    return {
      path,
      peak_mib: Math.round(Number(f("memory.peak")) / 1048576),
      current_mib: Math.round(Number(f("memory.current")) / 1048576),
      events: f("memory.events").replace(/\n/g, " "),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

async function memprobe(o) {
  mkdirSync(o.out, { recursive: true });
  const profile = resolve(o.profile);
  rmSync(profile, { recursive: true, force: true });
  const before = memSample();
  const s = await boot(o, { clearCache: true, profile });
  const afterLoad = memSample();
  const msgs = JSON.parse(
    readFileSync(
      resolve(SITE, "protocol/conformance/chat-template-tokens.json"),
      "utf8",
    ),
  ).cases.find((c) => c.name.startsWith("multi-turn:")).messages;
  const r = await s.page.evaluate((m) => window.spike.complete(m), msgs);
  const afterRun = memSample();
  writeJson(o.out, "memprobe.json", {
    ...record(o, s),
    memory: {
      cgroup_at_end: cgroupStats(),
      before_launch: before,
      after_load: afterLoad,
      after_one_completion: afterRun,
    },
    completion: {
      prompt_tokens: r.usage.prompt_tokens,
      gen_tokens: r.timings.predicted_n,
      text_head: r.text.slice(0, 120),
    },
    kv_lines: s.runtimeLog.filter((l) => /kv|flash/i.test(l)),
  });
  await shutdown(s);
  rmSync(profile, { recursive: true, force: true });
}

/**
 * Cold download times: --model-url <url> (a remote host, or the local server for a split GGUF test) with
 * --connections-list 1,4,8; each value starts from an empty cache. With --tokcheck true the loaded model is also
 * checked against the llama.cpp token ids (proves a split or remote copy is the same model).
 */
async function download(o) {
  mkdirSync(o.out, { recursive: true });
  const profile = resolve(o.profile);
  rmSync(profile, { recursive: true, force: true });
  const server = await startServer({
    port: o.port,
    extra: o.model ? { "/model/": `${dirname(resolve(o.model))}/` } : {},
  });
  const b = await launch({ ...o, mode: "cpu" }, profile);
  const url = o.modelUrl;
  const cors = url.startsWith("http://127.0.0.1")
    ? null
    : await b.page
        .evaluate((u) => window.spike.corsProbe(u), url)
        .catch((e) => ({ error: String(e) }));
  const runs = [];
  for (const c of (o.connectionsList ?? "4").split(",").map(Number)) {
    const t = await b.page.evaluate((a) => window.spike.load(a), {
      url,
      nGpuLayers: 0,
      nCtx: 2048,
      connections: c,
      clearCache: true,
    });
    const rec = {
      connections: c,
      load_ms: t.load_ms,
      bytes: t.downloaded_bytes,
      MB_per_s: t.downloaded_bytes / 1e6 / (t.load_ms / 1000),
      n_vocab: t.n_vocab,
      server: { ...server.stats },
    };
    if (o.tokcheck === "true") {
      const cases = JSON.parse(
        readFileSync(
          resolve(SITE, "protocol/conformance/chat-template-tokens.json"),
          "utf8",
        ),
      ).cases;
      rec.tokcheck = await b.page.evaluate(
        (x) => window.spike.tokcheck(x),
        cases,
      );
    }
    runs.push(rec);
    await b.page.evaluate(() => window.spike.unload());
    server.stats.requests = server.stats.ranged = server.stats.bytes = 0;
    server.stats.peakInflight = 0;
  }
  writeJson(o.out, "download.json", {
    url: url.replace(/\?.*/, ""),
    cors,
    chromium: b.version,
    wllama: pkg("@wllama/wllama"),
    COEP: "credentialless",
    runs,
  });
  await b.ctx.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

async function bridge(o) {
  mkdirSync(o.out, { recursive: true });
  const profile = resolve(o.profile);
  rmSync(profile, { recursive: true, force: true });
  const s = await boot(o, { clearCache: true, profile });
  writeJson(o.out, "env.json", record(o, s));
  const peak = { ...memSample(), samples: 0 };
  const sampler = setInterval(() => {
    const m = memSample();
    peak.gpu_mib = Math.max(peak.gpu_mib, m.gpu_mib);
    peak.rss_mib = Math.max(peak.rss_mib, m.rss_mib);
    peak.samples++;
  }, 3000);
  let chain = Promise.resolve();
  const srv = createServer((req, res) => {
    const reply = (code, body) =>
      res
        .writeHead(code, { "Content-Type": "application/json" })
        .end(JSON.stringify(body));
    if (req.url === "/health") return reply(200, { ok: true });
    if (req.url === "/shutdown") {
      reply(200, { ok: true });
      return void setTimeout(async () => {
        clearInterval(sampler);
        writeJson(o.out, "memory-peak.json", peak);
        writeFileSync(`${o.out}/console.log`, s.consoleLog.join("\n") + "\n");
        await shutdown(s);
        rmSync(profile, { recursive: true, force: true });
        process.exit(0);
      }, 50);
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      chain = chain.then(async () => {
        try {
          const { messages } = JSON.parse(body);
          const r = await s.page.evaluate(
            (m) => window.spike.complete(m),
            messages,
          );
          appendFileSync(
            `${o.out}/turns.jsonl`,
            JSON.stringify({
              n_messages: messages.length,
              finish_reason: r.finish_reason,
              usage: r.usage,
              timings: r.timings,
              wall_ms: r.wall_ms,
            }) + "\n",
          );
          reply(200, { text: r.text, finish_reason: r.finish_reason });
        } catch (e) {
          reply(500, { error: String(e) });
        }
      });
    });
  });
  srv.listen(o.bridgePort, "127.0.0.1", () =>
    console.log(`bridge ready on ${o.bridgePort} (${o.mode})`),
  );
}

async function loadtimes(o) {
  mkdirSync(o.out, { recursive: true });
  const profile = resolve(o.profile);
  rmSync(profile, { recursive: true, force: true });
  const times = {};
  let s = await boot(o, { clearCache: true, profile });
  times.cold = { ...s.loaded };
  const rec = record(o, s);
  await s.page.reload(); // same browser, model already cached in OPFS
  await s.page.waitForFunction(() => typeof window.spike?.env === "function");
  times.warm_same_browser = await s.page.evaluate(
    (a) => window.spike.load(a),
    loadArgs(o),
  );
  await shutdown(s);
  s = await boot(o, { clearCache: false, profile }); // a returning visitor: new browser process, cached model
  times.warm_after_restart = { ...s.loaded };
  await shutdown(s);
  rmSync(profile, { recursive: true, force: true });
  writeJson(o.out, "loadtimes.json", { ...rec, load: undefined, times });
}

async function coexist(o) {
  mkdirSync(o.out, { recursive: true });
  const profile = resolve(o.profile);
  rmSync(profile, { recursive: true, force: true });
  const s = await boot(o, { clearCache: true, profile });
  const read = (f) =>
    JSON.parse(
      readFileSync(resolve(SITE, `protocol/conformance/${f}`), "utf8"),
    );
  const prompts = read("chat-template-tokens.json")
    .cases.filter((c) => c.name.startsWith("first-turn:"))
    .slice(0, 4)
    .map((c) => c.messages);
  const phases = await s.page.evaluate((a) => window.spike.coexist(a), {
    prompts,
    clipUrl: `http://127.0.0.1:${o.port}/clip/${o.clip}`,
    jobArgs: read("bench-jobs.json").f4Scale480,
  });
  writeJson(o.out, "coexist.json", {
    ...record(o, s),
    phases,
    job: "f4Scale480",
    clip: o.clip,
  });
  await shutdown(s);
  rmSync(profile, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = parseArgs(process.argv.slice(2));
  const run = {
    bridge,
    loadtimes,
    coexist,
    memprobe,
    download,
    tokcheck: async (x) => console.log(JSON.stringify(await runTokcheck(x))),
  }[o.cmd];
  if (!run) {
    console.error(
      "usage: run.mjs bridge|loadtimes|coexist|tokcheck --model <gguf> --mode gpu|cpu --out <dir> ...",
    );
    process.exit(2);
  }
  run(o).then(
    () => o.cmd !== "bridge" && process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
