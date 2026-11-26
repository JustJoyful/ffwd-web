import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { isolation } from "../../isolation-headers.js";

const html = () => readFileSync("build/client/index.html", "utf8");

// Parse a Cloudflare _headers file into { "/path": { Header: "value" } }.
function parseHeaders(text) {
  const out = {};
  let path = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      path = line.trim();
      out[path] = {};
    } else {
      const i = line.indexOf(":");
      out[path][line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

test('title is "ffwd: describe the chore, get a checked video" and description is verbatim', () => {
  expect(html()).toContain("<title>ffwd: describe the chore, get a checked video</title>");
  expect(html()).toContain(
    '<meta name="description" content="A free tool that cuts, converts and fixes video from one sentence. It runs on your own computer, never uploads your video, and checks every result."/>',
  );
});

test('has <meta name="color-scheme" content="dark"> and <html lang="en">', () => {
  expect(html()).toContain('<meta name="color-scheme" content="dark"/>');
  expect(html()).toContain('<html lang="en">');
});

test("loads no font from Google", () => {
  const css = readdirSync("build/client/assets")
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(`build/client/assets/${f}`, "utf8"));
  expect(css.length).toBeGreaterThan(0);
  for (const text of [html(), ...css]) {
    expect(text).not.toContain("fonts.googleapis.com");
    expect(text).not.toContain("fonts.gstatic.com");
  }
  expect(css.join("")).toContain("Funnel Sans Variable");
  expect(css.join("")).toContain("Funnel Display Variable");
});

test('inline head script adds the "js" class and handles ?theme=light and ?font=bricolage', () => {
  expect(html()).toContain("classList.add('js')");
  expect(html()).toContain("q.get('theme') === 'light'");
  expect(html()).toContain("root.dataset.theme = 'light'");
  expect(html()).toContain("q.get('font') === 'bricolage'");
  expect(html()).toContain("root.dataset.font = 'bricolage'");
});

test('_headers "/*" block equals isolation', () => {
  const h = parseHeaders(readFileSync("public/_headers", "utf8"));
  expect(h["/*"]).toMatchObject(isolation);
  expect(h["/*"]["X-Content-Type-Options"]).toBe("nosniff");
  expect(h["/*"]["Referrer-Policy"]).toBe("no-referrer");
});

test("cache headers: /assets/* immutable, /media/* one day", () => {
  const h = parseHeaders(readFileSync("public/_headers", "utf8"));
  expect(h["/assets/*"]["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  expect(h["/media/*"]["Cache-Control"]).toBe("public, max-age=86400");
});

test("build/client/_headers exists", () => {
  expect(existsSync("build/client/_headers")).toBe(true);
});

test("the built _headers carries a Content-Security-Policy with frame-ancestors none (review S5)", () => {
  const h = parseHeaders(readFileSync("build/client/_headers", "utf8"));
  const csp = h["/*"]["Content-Security-Policy"];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(h["/*"]["Cross-Origin-Embedder-Policy"]).toBe("credentialless"); // still there
});
