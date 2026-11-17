import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import Home from "../../app/routes/home.jsx";

// The real page markup (Home is static), mounted into a container like the route does.
export function renderPage() {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(Home));
  document.body.append(root);
  return root;
}

// matchMedia stub. `matches` maps a query string to its result; unknown queries do not match.
// Listeners honour AbortSignal like the real thing, and `listeners` lets a test see what is still registered.
export function stubMatchMedia(matches = {}) {
  const listeners = new Set();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query) => ({
      matches: Boolean(matches[query]),
      media: query,
      addEventListener(type, fn, opts) {
        const entry = { type, fn };
        listeners.add(entry);
        opts?.signal?.addEventListener("abort", () => listeners.delete(entry));
      },
      removeEventListener(type, fn) {
        for (const e of listeners) if (e.fn === fn) listeners.delete(e);
      },
    })),
  );
  return listeners;
}

export const REDUCED = "(prefers-reduced-motion: reduce)";
export const PHONE = "(max-width: 767px)";
export const SECTIONS_NARROW = "(max-width: 59.9375em)";

// requestAnimationFrame stub with a visible queue (fake timers would otherwise spin the playhead loop forever).
export function stubFrames() {
  const pending = new Map();
  let id = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb) => {
      pending.set(++id, cb);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((i) => pending.delete(i)),
  );
  return {
    pending,
    flush() {
      const run = [...pending.values()];
      pending.clear();
      run.forEach((cb) => cb(0));
    },
  };
}

// IntersectionObserver stub that records instances so a test can fire entries and check disconnects.
export function stubIntersectionObserver() {
  const instances = [];
  class IO {
    constructor(cb, options) {
      this.cb = cb;
      this.options = options;
      this.targets = new Set();
      this.disconnected = false;
      instances.push(this);
    }
    observe(t) {
      this.targets.add(t);
    }
    unobserve(t) {
      this.targets.delete(t);
    }
    disconnect() {
      this.disconnected = true;
      this.targets.clear();
    }
    fire(target, isIntersecting = true) {
      this.cb([{ target, isIntersecting }]);
    }
  }
  vi.stubGlobal("IntersectionObserver", IO);
  return instances;
}

// jsdom has no layout, scrolling or media playback.
export function stubDomGaps() {
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  HTMLMediaElement.prototype.pause = vi.fn();
}
