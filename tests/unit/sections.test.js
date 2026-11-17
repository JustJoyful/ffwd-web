import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountSections } from "../../app/showcase/sections.js";
import {
  renderPage,
  SECTIONS_NARROW,
  stubIntersectionObserver,
  stubMatchMedia,
} from "./helpers.js";

let root;

beforeEach(() => {
  root = renderPage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("mountSections", () => {
  test("without IntersectionObserver every .rv gets is-in", () => {
    stubMatchMedia();
    delete window.IntersectionObserver;
    const cleanup = mountSections(root);
    const rv = [...root.querySelectorAll(".rv")];
    expect(rv.length).toBeGreaterThan(0);
    expect(rv.every((e) => e.classList.contains("is-in"))).toBe(true);
    cleanup();
  });

  test("reveals: an intersecting .rv gets is-in and is unobserved", () => {
    stubMatchMedia();
    const observers = stubIntersectionObserver();
    const cleanup = mountSections(root);
    const reveal = observers[0];
    const target = root.querySelector(".rv");
    reveal.fire(target);
    expect(target.classList.contains("is-in")).toBe(true);
    expect(reveal.targets.has(target)).toBe(false);
    cleanup();
  });

  test("desktop stepper: the step in view turns on its visual", () => {
    stubMatchMedia();
    const observers = stubIntersectionObserver();
    const cleanup = mountSections(root);
    expect(observers).toHaveLength(2);
    expect(root.querySelector(".ckd").classList.contains("ckd--inline")).toBe(
      false,
    );
    const step3 = root.querySelector('.cstep[data-step="3"]');
    observers[1].fire(step3);
    expect(step3.classList.contains("is-on")).toBe(true);
    expect(
      root.querySelector('.cstep[data-step="1"]').classList.contains("is-on"),
    ).toBe(false);
    expect(
      root.querySelector('[data-vis="3"]').classList.contains("is-on"),
    ).toBe(true);
    expect(
      root.querySelector('[data-vis="1"]').classList.contains("is-on"),
    ).toBe(false);
    cleanup();
  });

  test("narrow screens clone each visual inline", () => {
    stubMatchMedia({ [SECTIONS_NARROW]: true });
    stubIntersectionObserver();
    const cleanup = mountSections(root);
    expect(root.querySelector(".ckd").classList.contains("ckd--inline")).toBe(
      true,
    );
    expect(root.querySelectorAll(".vis--inline")).toHaveLength(5);
    expect(
      root.querySelector(".cstep .vis--inline").hasAttribute("data-vis"),
    ).toBe(false);
    cleanup();
  });

  test("StrictMode double mount leaves one set of inline visuals", () => {
    stubMatchMedia({ [SECTIONS_NARROW]: true });
    stubIntersectionObserver();
    mountSections(root)();
    const cleanup = mountSections(root);
    expect(root.querySelectorAll(".vis--inline")).toHaveLength(5);
    cleanup();
  });

  test("cleanup disconnects both observers and removes what it injected", () => {
    stubMatchMedia({ [SECTIONS_NARROW]: true });
    const observers = stubIntersectionObserver();
    const cleanup = mountSections(root);
    cleanup();
    expect(observers.every((o) => o.disconnected)).toBe(true);
    expect(root.querySelectorAll(".vis--inline")).toHaveLength(0);
    expect(root.querySelector(".ckd").classList.contains("ckd--inline")).toBe(
      false,
    );
  });

  test("desktop cleanup disconnects the step observer", () => {
    stubMatchMedia();
    const observers = stubIntersectionObserver();
    mountSections(root)();
    expect(observers).toHaveLength(2);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });
});
