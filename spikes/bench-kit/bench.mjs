#!/usr/bin/env node
// ONE command: node bench.mjs --model m3-q5_k_m.gguf
// Starts a tiny local server (with the isolation headers the model's threads need), opens YOUR default browser on it,
// waits for the page to post its result, and writes ONE JSON file. Needs Node 20 or newer and nothing else: no npm
// install, no Playwright. Nothing leaves this computer (the server listens on 127.0.0.1 only).
//   --model <file>   the GGUF (grpo-m3-ckpt60-q5_k_m.gguf, 444 MB)
//   --out <file>     result file (default bench-result-<date>.json)
//   --paths gpu,cpu  which paths to run (default both; the CPU path runs a smaller subset, it is slow on weak machines)
//   --tasks 20       episodes on the GPU path (3 model turns each)     --cpu-tasks 5   episodes on the CPU path
//   --no-open        do not open a browser; print the address instead
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** --flag value pairs; a flag with no value is true. */
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    o[argv[i].slice(2)] =
      next === undefined || next.startsWith("--") ? true : next;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
if (!args.model || args.model === true) {
  console.error(
    "usage: node bench.mjs --model <path to the .gguf> [--out result.json] [--paths gpu,cpu] [--tasks 20] [--cpu-tasks 5] [--no-open]",
  );
  process.exit(2);
}
const MODEL = resolve(args.model);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const out = resolve(
  args.out && args.out !== true ? args.out : `bench-result-${stamp}.json`,
);
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

// System memory is shared with an integrated GPU, so the number that matters is how much of the whole computer's memory is used.
const usedMb = () => Math.round((os.totalmem() - os.freemem()) / 1048576);
const baseline = usedMb();
const mem = {
  total_mb: Math.round(os.totalmem() / 1048576),
  baseline_used_mb: baseline,
  peak_used_mb: baseline,
  timeline: [],
};
const t0 = Date.now();
const sampler = setInterval(() => {
  const u = usedMb();
  mem.peak_used_mb = Math.max(mem.peak_used_mb, u);
  if (mem.timeline.length < 4000)
    mem.timeline.push([Math.round((Date.now() - t0) / 1000), u]);
}, 1000);

console.log("hashing the model file ...");
const sha = createHash("sha256");
await new Promise((ok, no) =>
  createReadStream(MODEL)
    .on("data", (c) => sha.update(c))
    .on("end", ok)
    .on("error", no),
);
const model = {
  file: MODEL.split(/[\\/]/).pop(),
  bytes: statSync(MODEL).size,
  sha256: sha.digest("hex"),
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const hdr = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  if (req.method === "POST" && url.pathname === "/result") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      clearInterval(sampler);
      const result = JSON.parse(body);
      mem.peak_used_mb = Math.max(mem.peak_used_mb, usedMb());
      result.model = model;
      result.system_memory = {
        ...mem,
        peak_increase_mb: mem.peak_used_mb - mem.baseline_used_mb,
      };
      result.node = {
        version: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model,
        cpus: os.cpus().length,
      };
      writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
      res.writeHead(200, hdr).end("ok");
      for (const [p, r] of Object.entries(result.paths ?? {})) {
        const s = r.summary;
        console.log(
          s
            ? `  ${p}: median turn ${s.median_turn_s.toFixed(2)} s, p90 ${s.p90_turn_s.toFixed(2)} s, first turn ${s.median_first_turn_s.toFixed(2)} s, ${s.generation_tok_s.toFixed(1)} tok/s generating, agreement with native ${(100 * s.exact_match_native).toFixed(0)}%`
            : `  ${p}: ${r.skipped ?? r.error ?? "no result"}`,
        );
      }
      console.log(
        `System memory: peak ${mem.peak_used_mb} MB used, +${mem.peak_used_mb - mem.baseline_used_mb} MB over the start (of ${mem.total_mb} MB).`,
      );
      console.log(`\nResult written to ${out}\nSend that one file back.`);
      setTimeout(() => process.exit(0), 300);
    });
    return;
  }
  const isModel = url.pathname === "/model.gguf";
  const file = isModel
    ? MODEL
    : normalize(join(HERE, url.pathname === "/" ? "bench.html" : url.pathname));
  if (!isModel && !file.startsWith(HERE)) return void res.writeHead(403).end();
  let st;
  try {
    st = statSync(file);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    return void res.writeHead(404).end();
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  const start = m?.[1] ? Number(m[1]) : 0;
  const end = m?.[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
  const h = {
    ...hdr,
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  if (m)
    res.writeHead(206, {
      ...h,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Content-Length": end - start + 1,
    });
  else res.writeHead(200, { ...h, "Content-Length": st.size });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file, { start, end }).pipe(res);
});
server.listen(0, "127.0.0.1", () => {
  const q = new URLSearchParams({
    paths: args.paths && args.paths !== true ? args.paths : "gpu,cpu",
    tasks: args.tasks ?? 20,
    cpuTasks: args["cpu-tasks"] ?? 5,
  });
  const url = `http://localhost:${server.address().port}/?${q}`;
  console.log(`Bench page: ${url}`);
  if (args["no-open"]) return console.log("Open that address in your browser.");
  const [cmd, a] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, a, { stdio: "ignore", detached: true })
    .on("error", () =>
      console.log("Could not open a browser: open that address yourself."),
    )
    .unref();
  console.log(
    "Leave the browser tab in front and the computer alone until it says Done (about 5 to 20 minutes on a slow laptop).",
  );
});
