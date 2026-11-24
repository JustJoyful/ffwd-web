// `pnpm release:local` (D-053): test the EXACT release package with the PRODUCTION build, on this machine, before anything
// is uploaded. It
//   1. refuses to start unless the release folder passes its own SHA256SUMS (every file, and no file missing);
//   2. serves that folder on localhost like a model host would (CORS, Range, Cross-Origin-Resource-Policy: cross-origin so
//      COEP credentialless lets it through, real content types);
//   3. runs the production build with VITE_MODEL_MANIFEST_URL pointing at that server, VITE_MODEL_MANIFEST_SHA256 set to the
//      hash of the local ffwd-model.json, and VITE_MODEL_LOCAL_TEST=1, which postbuild stamps into build/build-info.json so
//      `pnpm check:release` REFUSES the build (it can never be published by accident);
//   4. serves build/client with the headers the build itself generated (build/client/_headers: COOP, COEP credentialless and
//      the CSP, which names the local model origin because postbuild builds it from the same manifest URL).
// The https and pinned-revision rules do not apply here, and ONLY here: they are what `pnpm check:release` enforces on a
// real build. Usage: pnpm release:local [--dir <release folder>] [--release-port 8765] [--app-port 4180] [--skip-build]
// (--skip-build reuses build/ if it was made by this script for the same manifest file.) Stop with Ctrl-C.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const SITE = process.cwd(); // `pnpm release:local` runs in the repo root
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const DIR = resolve(
  arg("dir", join(SITE, "../ffmpeg-agent/releases/ffwd-0.6b-v1.0.0")),
);
const RELEASE_PORT = Number(arg("release-port", "8765"));
const APP_PORT = Number(arg("app-port", "4180"));
const OUT = join(SITE, "build/client");

const die = (m) => {
  console.error(`release:local: ${m}`);
  process.exit(1);
};

/** sha256 of a file, streamed (the GGUFs are hundreds of MB). */
const hashFile = (f) =>
  new Promise((ok, bad) => {
    const h = createHash("sha256");
    createReadStream(f)
      .on("data", (c) => h.update(c))
      .on("end", () => ok(h.digest("hex")))
      .on("error", bad);
  });

/** Every `<sha256>  <path>` line of SHA256SUMS must match; returns the problems. */
export async function sumsProblems(dir) {
  const sums = join(dir, "SHA256SUMS");
  if (!existsSync(sums)) return ["SHA256SUMS is missing"];
  const problems = [];
  const lines = readFileSync(sums, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) {
      problems.push(`unreadable line: ${line}`);
      continue;
    }
    const f = resolve(dir, m[2]);
    if (!f.startsWith(dir + sep)) problems.push(`${m[2]} leaves the folder`);
    else if (!existsSync(f)) problems.push(`${m[2]} is missing`);
    else if ((await hashFile(f)) !== m[1]) problems.push(`${m[2]} differs`);
  }
  if (!lines.some((l) => l.endsWith(" ffwd-model.json")))
    problems.push("ffwd-model.json is not listed in SHA256SUMS");
  return problems;
}

const TYPES = {
  ".json": "application/json",
  ".gguf": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".jinja": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".safetensors": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};
const typeOf = (f) =>
  TYPES[extname(f).toLowerCase()] ?? "application/octet-stream";

/** Send one file with Range support. `extra` are headers added to every response. */
function sendFile(req, res, file, extra) {
  const size = statSync(file).size;
  const h = {
    ...extra,
    "Content-Type": typeOf(file),
    "Accept-Ranges": "bytes",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (m && (m[1] || m[2])) {
    // "bytes=-N" is the last N bytes
    start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size)
      return void res
        .writeHead(416, { ...h, "Content-Range": `bytes */${size}` })
        .end();
    status = 206;
    h["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  h["Content-Length"] = end - start + 1;
  res.writeHead(status, h);
  if (req.method === "HEAD") return void res.end();
  createReadStream(file, { start, end }).pipe(res);
}

/** The file a request path names under `root` (no traversal), or null. */
function locate(root, urlPath, { pretty }) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const f = resolve(root, "." + p);
  if (f !== root && !f.startsWith(root + sep)) return null;
  const tries = pretty ? [f, join(f, "index.html"), f + ".html"] : [f];
  return tries.find((t) => existsSync(t) && statSync(t).isFile()) ?? null;
}

/** The `/*` block of the build's own _headers file: what production sends on every response. */
export function productionHeaders(headersFile) {
  const out = {};
  let inAll = false;
  for (const line of readFileSync(headersFile, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) inAll = line.trim() === "/*";
    else if (inAll) {
      const i = line.indexOf(":");
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("serve-release.mjs")) {
  const manifestFile = join(DIR, "ffwd-model.json");
  if (!existsSync(manifestFile)) die(`${manifestFile} does not exist`);
  console.log(`checking ${DIR} against its SHA256SUMS ...`);
  const bad = await sumsProblems(DIR);
  if (bad.length)
    die(`the release folder does not verify:\n  ${bad.join("\n  ")}`);
  console.log("release folder verified");

  // 2. the release server
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers":
      "Content-Range, Accept-Ranges, Content-Length",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "no-store",
  };
  const releaseServer = createServer((req, res) => {
    if (req.method === "OPTIONS") return void res.writeHead(204, CORS).end();
    const f = locate(DIR, req.url, { pretty: false });
    if (!f) return void res.writeHead(404, CORS).end("not found");
    sendFile(req, res, f, CORS);
  });
  await new Promise((ok) =>
    releaseServer.listen(RELEASE_PORT, "127.0.0.1", ok),
  );
  const MANIFEST_URL = `http://localhost:${RELEASE_PORT}/ffwd-model.json`;
  const manifestSha = await hashFile(manifestFile);

  // 3. the production build
  const info = join(SITE, "build/build-info.json");
  const reusable =
    process.argv.includes("--skip-build") &&
    existsSync(info) &&
    (() => {
      const i = JSON.parse(readFileSync(info, "utf8"));
      return (
        i.localTest === true &&
        i.modelUrl === MANIFEST_URL &&
        i.modelManifestSha256 === manifestSha
      );
    })();
  if (reusable) console.log("reusing the build in build/ (same manifest)");
  else {
    const env = {
      ...process.env,
      VITE_MODEL_MANIFEST_URL: MANIFEST_URL,
      VITE_MODEL_MANIFEST_SHA256: manifestSha,
      VITE_MODEL_LOCAL_TEST: "1",
    };
    for (const cmd of [
      ["node", ["scripts/copy-core.mjs"]],
      ["pnpm", ["build"]],
    ]) {
      const r = spawnSync(cmd[0], cmd[1], { cwd: SITE, env, stdio: "inherit" });
      if (r.status !== 0) die(`${cmd.join(" ")} failed`);
    }
  }

  // 4. the production build, with the headers the build generated
  const HEAD = productionHeaders(join(OUT, "_headers"));
  if (!HEAD["Content-Security-Policy"] || !HEAD["Cross-Origin-Embedder-Policy"])
    die("build/client/_headers has no CSP or isolation headers");
  const appServer = createServer((req, res) => {
    const f = locate(OUT, req.url, { pretty: true });
    if (f) return sendFile(req, res, f, HEAD);
    const nf = join(OUT, "404.html");
    res.writeHead(404, { ...HEAD, "Content-Type": "text/html; charset=utf-8" });
    res.end(existsSync(nf) ? readFileSync(nf) : "not found");
  });
  await new Promise((ok) => appServer.listen(APP_PORT, "127.0.0.1", ok));

  console.log(`
release:local READY
  release package  ${MANIFEST_URL}   (manifest sha256 ${manifestSha})
  production build http://localhost:${APP_PORT}/app
This is a LOCAL TEST build: build-info.json says so and \`pnpm check:release\` refuses it. Ctrl-C to stop.`);
}
