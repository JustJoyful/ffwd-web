import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

/** The prerendered HTML of a route. Accepts "/privacy" or "/" (React Router writes <path>/index.html or <path>.html). */
export function pageHtml(path) {
  const base = path === "/" ? "build/client" : `build/client${path}`;
  const file = existsSync(`${base}/index.html`)
    ? `${base}/index.html`
    : `${base}.html`;
  return readFileSync(file, "utf8");
}
/** The same, as a DOM document. */
export const page = (path) => new JSDOM(pageHtml(path)).window.document;
