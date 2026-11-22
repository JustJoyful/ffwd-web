// /app with the model in the flow (C2): a fake useTool stands in for the store, so each model phase and each way a
// job can end is shown without a browser. Nothing here can pass by hiding a failure: a failed job is never "Done".
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import {
  MODEL_ERROR_TEXT,
  initialModelState,
} from "../../app/model/contract.js";
import { probeOf } from "./engine-fakes.js";

const tool = { current: null };
vi.mock("../../app/tool/store.js", () => ({ useTool: () => tool.current }));
const { default: App } = await import("../../app/routes/app.jsx");

const base = {
  name: "awaitingRequest",
  request: null,
  inputs: [{ id: "clip", name: "a.mp4", probe: probeOf() }],
  spec: null,
  plan: [],
  history: [],
  runs: 0,
  turns: 0,
  question: null,
  reason: null,
  error: null,
  path: "webgpu",
  notice: null,
};
const setTool = (state, model, modelActions) => {
  const dispatch = vi.fn();
  tool.current = {
    state: { ...base, ...state },
    dispatch,
    store: { runtime: {}, getState: () => base, subscribe: () => () => {} },
    ...(model && { model: { ...initialModelState(), ...model } }),
    ...(modelActions && { modelActions }),
  };
  return dispatch;
};
const renderApp = (url = "/app?ask=make%20it%20small") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );
const send = () => screen.getByRole("button", { name: "Make a plan" });

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("/app without a model in the store (stream A not landed)", () => {
  test("nothing is blocked and no model box shows", () => {
    setTool({});
    renderApp();
    expect(send().disabled).toBe(false);
    expect(document.querySelector(".modelzone").children).toHaveLength(1); // only the path line
    expect(document.querySelector("[data-phase]")).toBeNull();
  });
});

describe("/app while the model is not ready", () => {
  test.each([
    ["needsConsent", /downloaded the model/],
    ["downloading", /has downloaded/],
    ["loading", /has started/],
    ["failed", /until the model has started/],
  ])(
    "%s: the request is typed but not sent, and a hint says why",
    (phase, why) => {
      vi.stubEnv("VITE_MODEL_URL", "http://localhost/m.gguf");
      const dispatch = setTool(
        {},
        {
          phase,
          loaded: 1,
          total: 2,
          error: { code: "load_failed", message: "x" },
        },
      );
      renderApp();
      const field = screen.getByLabelText("What should happen to your video?");
      expect(field.value).toBe("make it small"); // still typable
      expect(send().disabled).toBe(true);
      fireEvent.keyDown(field, { key: "Enter" });
      expect(dispatch).not.toHaveBeenCalled();
      const hint = document.getElementById(
        field.getAttribute("aria-describedby"),
      );
      expect(hint.textContent).toMatch(why);
      expect(document.querySelector(`[data-phase]`)).toBeTruthy();
    },
  );

  test("the model box offers Download and calls the store's consent", () => {
    vi.stubEnv("VITE_MODEL_URL", "http://localhost/m.gguf");
    const modelActions = { consent: vi.fn(), decline: vi.fn(), retry: vi.fn() };
    setTool({}, { phase: "needsConsent" }, modelActions);
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(modelActions.consent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(modelActions.decline).toHaveBeenCalledTimes(1);
  });

  test("a failed model offers Try again through the store", () => {
    const modelActions = { consent: vi.fn(), decline: vi.fn(), retry: vi.fn() };
    setTool(
      {},
      { phase: "failed", error: { code: "load_failed", message: "x" } },
      modelActions,
    );
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(modelActions.retry).toHaveBeenCalledTimes(1);
  });

  test("with no video chosen the request still cannot be sent, as before", () => {
    setTool({ name: "ready", inputs: [] }, { phase: "downloading", total: 9 });
    renderApp();
    expect(send().disabled).toBe(true);
  });
});

describe("/app with the model ready", () => {
  test("the request is sent, no hint, no model box", () => {
    const dispatch = setTool({}, { phase: "ready", path: "webgpu" });
    renderApp();
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(dispatch).toHaveBeenCalledWith({
      type: "requestSubmitted",
      request: "make it small",
    });
    expect(
      screen
        .getByLabelText("What should happen to your video?")
        .getAttribute("aria-describedby"),
    ).toBeNull();
    expect(document.querySelector("[data-phase]")).toBeNull();
  });
});

describe("a job that ends because of the model is never shown as a success", () => {
  test.each([
    ["too_long", "context_full"],
    ["model_unavailable", "generate_failed"],
    ["aborted", "aborted"],
  ])("reason %s shows the plain sentence and a way on", (reason, code) => {
    const dispatch = setTool(
      { name: "failed", reason, error: MODEL_ERROR_TEXT[code] },
      { phase: "ready" },
    );
    renderApp();
    const box = screen.getByText("Nothing to download").closest(".notice");
    expect(box.textContent).toContain(MODEL_ERROR_TEXT[code]);
    expect(box.textContent).not.toContain(reason); // never the raw code
    expect(screen.queryByText(/Done, every check passed/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Try another request" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "newRequest" });
  });

  test("without a sentence the fallback text is used, still not a success", () => {
    setTool({ name: "failed", reason: "too_long" }, { phase: "ready" });
    renderApp();
    expect(
      screen.getByText(/got too long for the on-device model/),
    ).toBeTruthy();
    expect(screen.queryByText(/Done, every check passed/)).toBeNull();
  });

  test("a policy_error keeps its detail line as before", () => {
    setTool(
      { name: "failed", reason: "policy_error", error: "Error: boom" },
      { phase: "ready" },
    );
    renderApp();
    expect(screen.getByText("Error: boom").className).toBe("notice__detail");
    expect(screen.getByText(/The model couldn't answer/)).toBeTruthy();
  });
});

describe("the status dot never says Ready while the model cannot answer", () => {
  test.each([
    ["ready", "Ready, on this computer"],
    ["idle", "Ready, on this computer"],
    ["needsConsent", "Starting"],
    ["downloading", "Starting"],
    ["loading", "Starting"],
    ["failed", "Stopped"],
  ])("model %s: %s", (phase, words) => {
    vi.stubEnv("VITE_MODEL_URL", "http://localhost/m.gguf");
    setTool(
      {},
      { phase, total: 5, error: { code: "load_failed", message: "" } },
    );
    renderApp();
    expect(document.querySelector(".win__state").textContent).toBe(words);
  });
});
