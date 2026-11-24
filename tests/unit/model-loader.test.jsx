// The on-device model in the person's words (C1): every phase, every button.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ModelLoader, {
  mb,
  modelBlocks,
} from "../../app/components/tool/ModelLoader.jsx";
import { MODEL } from "./model-fixture.js";
import {
  MODEL_ERROR_TEXT,
  initialModelState,
} from "../../app/model/contract.js";

afterEach(cleanup);

const model = (over) => ({ ...initialModelState(), ...over });
const MB = mb(MODEL.bytes);
const show = (m, extra = {}) =>
  render(<ModelLoader model={m} available {...extra} />);

describe("ModelLoader", () => {
  test("the size comes from the config, not from the component", () => {
    expect(MB).toBe("444 MB");
  });

  test("needsConsent says what happens and the buttons call back", () => {
    const onConsent = vi.fn();
    const onDecline = vi.fn();
    show(model({ phase: "needsConsent", total: MODEL.bytes }), {
      onConsent,
      onDecline,
    });
    expect(screen.getByRole("status").textContent).toContain(
      `The on-device model has to be downloaded once: ${MB}. It stays in your browser; your videos never leave your computer.`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download model" }));
    expect(onConsent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  test("Not now says the job cannot run and offers Download again, with focus kept", () => {
    const onConsent = vi.fn();
    show(model({ phase: "needsConsent" }), { onConsent });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("status").textContent).toMatch(
      /not downloaded.*can't make a plan/,
    );
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    const again = screen.getByRole("button", { name: "Download model again" });
    expect(document.activeElement).toBe(again);
    fireEvent.click(again);
    expect(onConsent).toHaveBeenCalledTimes(1);
  });

  test("a build with no model URL says the model is not published and offers no download", () => {
    show(model({ phase: "needsConsent" }), { available: false });
    expect(screen.getByRole("status").textContent).toMatch(/not published yet/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("downloading shows bytes, total, percent, a real progressbar and the saved-for-next-time note", () => {
    show(
      model({ phase: "downloading", loaded: 111_000_000, total: 444_000_000 }),
    );
    const bar = screen.getByRole("progressbar", { name: "Model download" });
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    const box = document.querySelector(".loader");
    expect(box.textContent).toContain("25%");
    expect(box.textContent).toContain("111 MB of 444 MB");
    expect(box.textContent).toContain("saved in your browser for next time");
    // the live region is the static sentence only, so a screen reader is not read every byte
    expect(screen.getByRole("status").textContent).toBe(
      "Downloading the model",
    );
  });

  test("an unknown total shows the bytes so far and no bar", () => {
    show(model({ phase: "downloading", loaded: 5_000_000, total: 0 }));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/5 MB\./)).toBeTruthy();
  });

  test("the percent never passes 100", () => {
    show(model({ phase: "downloading", loaded: 9e9, total: 1e9 }));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });

  test("a warm start shows no download wording", () => {
    show(model({ phase: "loading", cached: true }));
    expect(screen.getByRole("status").textContent).toBe("Starting the model");
    expect(document.body.textContent).not.toMatch(/download|MB/i);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("failed shows the plain sentence and Try again calls back", () => {
    const onRetry = vi.fn();
    show(
      model({
        phase: "failed",
        error: { code: "load_failed", message: "wasm trap" },
      }),
      { onRetry },
    );
    expect(screen.getByRole("alert").textContent).toContain(
      MODEL_ERROR_TEXT.load_failed,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("out of memory offers no Try again, because it would fail the same way", () => {
    show(
      model({ phase: "failed", error: { code: "out_of_memory", message: "" } }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      MODEL_ERROR_TEXT.out_of_memory,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a failed state with an unknown code falls back to its own message", () => {
    show(model({ phase: "failed", error: { code: "x", message: "odd" } }));
    expect(screen.getByRole("alert").textContent).toContain("odd");
  });

  test.each(["idle", "ready"])("%s renders nothing", (phase) => {
    const { container } = show(model({ phase }));
    expect(container.innerHTML).toBe("");
  });

  test("modelBlocks is true until the model is idle (no model wired) or ready", () => {
    for (const phase of ["needsConsent", "downloading", "loading", "failed"]) {
      expect(modelBlocks(model({ phase }))).toBe(true);
    }
    for (const phase of ["idle", "ready"]) {
      expect(modelBlocks(model({ phase }))).toBe(false);
    }
    expect(modelBlocks(undefined)).toBe(false);
  });
});
