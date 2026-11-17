import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { SITE_URL } from "../../app/config.js";
import { chores } from "../../app/content/chores.js";
import { page } from "./helpers.js";

const paths = chores.map((c) => `/chores/${c.slug}`);

test("the index lists every chore and has one <h1>", () => {
  const doc = page("/chores");
  expect(doc.querySelectorAll("h1")).toHaveLength(1);
  const hrefs = [...doc.querySelectorAll("main a")].map((a) =>
    a.getAttribute("href"),
  );
  for (const p of paths) expect(hrefs).toContain(p);
});

test("each chore page has one <h1>, a unique short title, a description, a canonical link and a pre-filled tool link", () => {
  const titles = new Set();
  for (const c of chores) {
    const path = `/chores/${c.slug}`;
    const doc = page(path);
    expect(doc.querySelectorAll("h1"), path).toHaveLength(1);
    expect(doc.querySelector("h1").textContent).toBe(c.title);
    expect(doc.title.length).toBeLessThanOrEqual(60);
    titles.add(doc.title);
    const d = doc.querySelector('meta[name="description"]').content;
    expect(d.length).toBeGreaterThanOrEqual(70);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(doc.querySelector('link[rel="canonical"]').href).toBe(
      SITE_URL + path,
    );
    const ask = doc.querySelector('a[href^="/app?ask="]');
    expect(
      decodeURIComponent(ask.getAttribute("href").slice("/app?ask=".length)),
    ).toBe(c.sentence);
    // three numbered steps, other ways that each fill the tool, related chores
    expect(doc.querySelectorAll(".steps-n li")).toHaveLength(3);
    expect(doc.querySelectorAll("#other-ways a")).toHaveLength(
      c.otherWays.length,
    );
    for (const r of c.related)
      expect(
        doc.querySelector(`#related a[href="/chores/${r}"]`),
      ).not.toBeNull();
  }
  expect(titles.size).toBe(chores.length);
});

test("sitemap.xml lists every page and robots.txt points at it", () => {
  const xml = readFileSync("build/client/sitemap.xml", "utf8");
  for (const p of ["/", "/chores", "/privacy", "/requirements", ...paths])
    expect(xml).toContain(`<loc>${SITE_URL}${p === "/" ? "" : p}</loc>`);
  expect(xml).not.toContain("/app");
  const robots = readFileSync("build/client/robots.txt", "utf8");
  expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
});

test("an unknown page serves the 404 page, with a link home", () => {
  // Cloudflare Pages serves /404.html for any path with no file
  expect(existsSync("build/client/404.html")).toBe(true);
  const doc = page("/404");
  expect(doc.querySelectorAll("h1")).toHaveLength(1);
  expect(doc.querySelector('main a[href="/"]')).not.toBeNull();
  expect(doc.querySelector('meta[name="robots"]').content).toContain("noindex");
});
