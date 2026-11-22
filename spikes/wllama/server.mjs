// Static server for the GGUF-in-the-browser spike: the same isolation headers as the site (isolation-headers.js, so
// SharedArrayBuffer and threads work exactly as they will in production), byte ranges (wllama downloads in parts),
// and a fixed map from URL prefix to a folder. Nothing here ships; see reports/2026-11-23-browser-gguf in the ffwd repo.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolation } from "../../isolation-headers.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SITE = resolve(HERE, "../..");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".gguf": "application/octet-stream",
};

/** URL prefix -> folder. `extra` adds entries, e.g. { "/model/": "/path/to/folder/" }. */
export function routes(extra = {}) {
  const nm = (p) => join(SITE, "node_modules", p);
  return {
    "/vendor/wllama/": nm("@wllama/wllama/esm/"),
    "/vendor/ffmpeg/": nm("@ffmpeg/ffmpeg/dist/esm/"),
    "/vendor/ffmpeg-util/": nm("@ffmpeg/util/dist/esm/"),
    "/ffmpeg/": join(SITE, "public/ffmpeg/"),
    "/app/": join(SITE, "app/"),
    "/": HERE,
    ...extra,
  };
}

export function startServer({ port, extra = {} }) {
  const map = Object.entries(routes(extra)).sort(
    (a, b) => b[0].length - a[0].length,
  );
  const stats = {
    requests: 0,
    ranged: 0,
    inflight: 0,
    peakInflight: 0,
    bytes: 0,
  };
  const server = createServer((req, res) => {
    stats.requests++;
    if (req.headers.range) stats.ranged++;
    stats.inflight++;
    stats.peakInflight = Math.max(stats.peakInflight, stats.inflight);
    res.on("close", () => stats.inflight--);
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const hit = map.find(([prefix]) => url.startsWith(prefix));
    if (!hit) return void res.writeHead(404).end();
    const file = normalize(
      join(hit[1], url.slice(hit[0].length) || "page.html"),
    );
    if (!file.startsWith(hit[1].replace(/\/$/, ""))) {
      return void res.writeHead(403).end();
    }
    let st;
    try {
      st = statSync(file);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      return void res.writeHead(404).end();
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    const start = range?.[1] ? Number(range[1]) : 0;
    const end = range?.[2]
      ? Math.min(Number(range[2]), st.size - 1)
      : st.size - 1;
    const headers = {
      ...isolation,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
    if (range) {
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${st.size}`,
        "Content-Length": end - start + 1,
      });
    } else {
      res.writeHead(200, { ...headers, "Content-Length": st.size });
    }
    if (req.method === "HEAD") return void res.end();
    const stream = createReadStream(file, { start, end });
    stream.on("data", (c) => (stats.bytes += c.length));
    stream.pipe(res);
  });
  server.stats = stats;
  return new Promise((ok) =>
    server.listen(port, "127.0.0.1", () => ok(server)),
  );
}
