import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SITE_URL } from "../../app/config.js";
import { mountShowcase } from "../../app/showcase/showcase.js";
import {
  PHONE,
  REDUCED,
  renderPage,
  stubDomGaps,
  stubFrames,
  stubMatchMedia,
} from "./helpers.js";

let root, frames, cleanups;

// Mounts like the route does and remembers the cleanup so afterEach can always run it.
function mount(opts = {}) {
  const cleanup = mountShowcase(root, { search: "", ...opts });
  cleanups.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  frames = stubFrames();
  stubDomGaps();
  stubMatchMedia();
  cleanups = [];
  root = renderPage();
});

afterEach(() => {
  cleanups.forEach((c) => c());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const tabs = () => [...root.querySelectorAll(".tab")];
const thumbs = () => [...root.querySelectorAll("[data-track] span")];
const status = () => root.querySelector("[data-status]");

describe("mountShowcase", () => {
  test("mount builds 5 tabs and 8 thumbnails and selects the first chore", () => {
    mount();
    expect(tabs()).toHaveLength(5);
    expect(thumbs()).toHaveLength(8);
    expect(thumbs()[3].querySelector("img").getAttribute("src")).toBe(
      "/media/mer-f3.jpg",
    );
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);
    expect(root.querySelector("#win").getAttribute("aria-labelledby")).toBe(
      "tab-trim",
    );
  });

  test("StrictMode double mount leaves one set", () => {
    const first = mount();
    first();
    mount();
    expect(tabs()).toHaveLength(5);
    expect(thumbs()).toHaveLength(8);
  });

  test("cleanup leaves nothing running", () => {
    const cleanup = mount();
    // typing, the auto-cycle interval and the playhead frame loop are all live after mount
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(frames.pending.size).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    expect(frames.pending.size).toBe(0);
    expect(
      root.querySelector("[data-tabs]").classList.contains("cycling"),
    ).toBe(false);

    // the document-level click delegate is gone: nothing reacts to a click any more
    const sample = root.querySelector("[data-sample]");
    const choose = root.querySelector("[data-choose]");
    const clickChoose = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    sample.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    choose.dispatchEvent(clickChoose);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(clickChoose.defaultPrevented).toBe(false);
    expect(status().textContent).toBe("");
  });

  test("cleanup removes the media query listener", () => {
    const listeners = stubMatchMedia();
    const cleanup = mount();
    expect(listeners.size).toBeGreaterThan(0);
    cleanup();
    expect(listeners.size).toBe(0);
  });

  test("?tab=size selects the third chore and does not cycle", () => {
    mount({ search: "?tab=size" });
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    expect(
      root.querySelector("[data-tabs]").classList.contains("cycling"),
    ).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
  });

  test("?tab=bogus selects the first and starts the cycle", () => {
    mount({ search: "?tab=bogus" });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(
      root.querySelector("[data-tabs]").classList.contains("cycling"),
    ).toBe(true);
    vi.advanceTimersByTime(8500);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  });

  test("reduced motion shows the final state at once", () => {
    stubMatchMedia({ [REDUCED]: true });
    mount({ search: "?tab=size" });
    vi.runAllTimers();

    const text = root.querySelector("[data-runs]").textContent;
    expect(text).toContain("Run 1");
    expect(text).toContain("Run 2, after lowering the quality a little");
    expect(root.querySelector("[data-out]").textContent).toBe(
      "detective-small.mp4, 1.7 MB",
    );

    const vid = root.querySelector("#vid");
    expect(vid.hasAttribute("autoplay")).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(
      root.querySelector("[data-tabs]").classList.contains("cycling"),
    ).toBe(false);
  });

  test("reduced motion never starts the cycle even without ?tab", () => {
    stubMatchMedia({ [REDUCED]: true });
    mount();
    expect(
      root.querySelector("[data-tabs]").classList.contains("cycling"),
    ).toBe(false);
    vi.runAllTimers();
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  test("clicking [data-sample] shows chore 0", () => {
    mount({ search: "?tab=size" });
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    root.querySelector("[data-sample]").click();
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test("[data-choose] on a wide screen opens the tool with a full page load", () => {
    const assign = vi.fn();
    mount({ assign });
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector("[data-choose]").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(assign).toHaveBeenCalledWith("/app");
    expect(status().textContent).toBe("");
  });

  describe("narrow screens", () => {
    const click = (cta) =>
      cta.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

    test("the first call to action reads Send to my laptop, and cleanup restores it", () => {
      stubMatchMedia({ [PHONE]: true });
      const cleanup = mount();
      const cta = root.querySelector(".ctas [data-choose]");
      expect(cta.textContent).toBe("Send to my laptop");
      cleanup();
      expect(cta.textContent).toBe("Choose a video");
    });

    test("a click copies SITE_URL/app and says so; it does not navigate", async () => {
      stubMatchMedia({ [PHONE]: true });
      const assign = vi.fn();
      const writeText = vi.fn().mockResolvedValue();
      mount({ assign, clipboard: { writeText } });
      click(root.querySelector(".ctas [data-choose]"));
      await vi.waitFor(() =>
        expect(status().textContent).toBe(
          "Link copied. Open it on your laptop.",
        ),
      );
      expect(writeText).toHaveBeenCalledWith(`${SITE_URL}/app`);
      expect(assign).not.toHaveBeenCalled();
    });

    test("when the clipboard rejects, the link is shown as text", async () => {
      stubMatchMedia({ [PHONE]: true });
      mount({
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error()) },
      });
      click(root.querySelector(".ctas [data-choose]"));
      await vi.waitFor(() =>
        expect(status().textContent).toContain(`${SITE_URL}/app`),
      );
      expect(status().textContent).not.toContain("Link copied");
    });

    test("when there is no clipboard, the link is shown as text", async () => {
      stubMatchMedia({ [PHONE]: true });
      mount({ clipboard: null });
      click(root.querySelector(".ctas [data-choose]"));
      await vi.waitFor(() =>
        expect(status().textContent).toContain(`${SITE_URL}/app`),
      );
    });
  });

  test("arrow keys move between tabs and stop the cycle", () => {
    mount();
    const box = root.querySelector("[data-tabs]");
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(tabs()[4].getAttribute("aria-selected")).toBe("true");
    expect(box.classList.contains("cycling")).toBe(false);
  });

  test("the size chore draws the meter and the second run", () => {
    mount({ search: "?tab=size" });
    vi.advanceTimersByTime(20000);
    expect(root.querySelectorAll("[data-extra] .meter__row")).toHaveLength(3);
    expect(root.querySelectorAll("[data-runs] .run")).toHaveLength(2);
    expect(root.querySelector("[data-runs] .is-fail")).not.toBeNull();
  });
});
