// Where the model runs (D-050): the notice the person sees and the path the state machine keeps.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ModelPathNotice, {
  MemoryNotice,
} from "../../app/components/tool/ModelPathNotice.jsx";
import { MEMORY_WARNING_TEXT } from "../../app/lib/capability.js";
import { initialModelState } from "../../app/model/contract.js";
import { createMachine } from "../../app/agent/machine.js";
import { estimateWait } from "../../app/lib/capability.js";
import { fakeExecutor, fakeMeasure, probeOf } from "./engine-fakes.js";

afterEach(cleanup);

describe("ModelPathNotice", () => {
  test("renders nothing before the path is known", () => {
    const { container } = render(<ModelPathNotice path={null} />);
    expect(container.innerHTML).toBe("");
  });
  test("the graphics chip is one quiet line, not an alert", () => {
    render(<ModelPathNotice path="webgpu" />);
    expect(
      screen.getByText("The model runs on your graphics chip."),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
  test("the processor says so and gives an honest wait built from the measured speed", () => {
    render(<ModelPathNotice path="cpu" />);
    const box = screen.getByRole("status");
    expect(box.textContent).toContain("The model runs on your processor");
    const w = estimateWait("cpu");
    const n = (name) =>
      Number(box.querySelector(`[data-const="${name}"]`).textContent);
    expect([
      n("firstStepSeconds"),
      n("laterStepSeconds"),
      n("jobModelSeconds"),
    ]).toEqual([w.firstStepSeconds, w.laterStepSeconds, w.jobModelSeconds]);
    expect(box.textContent).toMatch(/slower computer takes longer/);
  });
  test("it promises no rules-only fast path (the app has none yet)", () => {
    render(<ModelPathNotice path="cpu" />);
    expect(screen.getByRole("status").textContent).not.toMatch(
      /instant|fast path|rules/i,
    );
  });
});

// 2026-11-24: what the first-visit check changes in the notice
const modelState = (over) => ({
  ...initialModelState(),
  phase: "ready",
  ...over,
});
describe("ModelPathNotice with the model's own measurements", () => {
  test("while the check runs it says the first check takes a while and that the result is remembered", () => {
    render(
      <ModelPathNotice
        path="webgpu"
        model={modelState({ phase: "loading", check: "canary" })}
      />,
    );
    const box = screen.getByRole("status");
    expect(box.dataset.check).toBe("canary");
    expect(box.textContent).toMatch(/first time on a computer/i);
    expect(box.textContent).toMatch(/minute or more/);
    expect(box.textContent).toMatch(/remembered/);
  });
  test("a computer with no graphics chip is told it is only being measured, not that its graphics chip is tested", () => {
    render(
      <ModelPathNotice
        path="cpu"
        model={modelState({ phase: "loading", check: "benchmark" })}
      />,
    );
    const t = screen.getByRole("status").textContent;
    expect(t).toMatch(/measures how fast/);
    expect(t).not.toMatch(/graphics chip/i);
    expect(t).toMatch(/remembered/);
  });
  test("a measured processor speed replaces the one-laptop numbers and says it is this computer", () => {
    const bench = { ppTokS: 100, genTokS: 20 };
    render(
      <ModelPathNotice
        path="cpu"
        model={modelState({ path: "cpu", bench, canary: "skipped" })}
      />,
    );
    const box = screen.getByRole("status");
    expect(box.dataset.wait).toBe("measured");
    const w = estimateWait("cpu", bench);
    expect(w.measured).toBe(true);
    const n = (name) =>
      Number(box.querySelector(`[data-const="${name}"]`).textContent);
    expect([
      n("firstStepSeconds"),
      n("laterStepSeconds"),
      n("jobModelSeconds"),
    ]).toEqual([w.firstStepSeconds, w.laterStepSeconds, w.jobModelSeconds]);
    expect(box.textContent).toMatch(/On this computer/);
    expect(box.textContent).not.toMatch(/laptop we measured/);
  });
  test("with no measurement yet the constants are the fallback and are labelled as another laptop's", () => {
    render(<ModelPathNotice path="cpu" model={modelState({ path: "cpu" })} />);
    const box = screen.getByRole("status");
    expect(box.dataset.wait).toBe("estimated");
    expect(box.textContent).toMatch(/laptop we measured/);
  });
  test("a canary failure says the graphics chip gave wrong answers and the processor is used", () => {
    render(
      <ModelPathNotice
        path="cpu"
        model={modelState({
          path: "cpu",
          canary: "fail",
          fallback: "canary",
          bench: { ppTokS: 58, genTokS: 36 },
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(
      /gives wrong answers/,
    );
  });
  test("a runtime switch says the answers became unreadable and the step was redone", () => {
    render(
      <ModelPathNotice
        path="cpu"
        model={modelState({ path: "cpu", fallback: "replies" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/unreadable/);
  });
  test("when the processor simply won the speed test it says so, not that something is wrong", () => {
    render(
      <ModelPathNotice
        path="cpu"
        model={modelState({ path: "cpu", canary: "pass" })}
      />,
    );
    const t = screen.getByRole("status").textContent;
    expect(t).toMatch(/processor was faster/);
    expect(t).not.toMatch(/wrong answers/);
  });
  test("on the graphics chip the measured step time is a second quiet line, the first line is unchanged", () => {
    render(
      <ModelPathNotice
        path="webgpu"
        model={modelState({
          path: "webgpu",
          canary: "pass",
          bench: { ppTokS: 190, genTokS: 53 },
        })}
      />,
    );
    expect(
      screen.getByText("The model runs on your graphics chip."),
    ).toBeTruthy();
    const line = document.querySelector('[data-wait="measured"]');
    expect(line.textContent).toMatch(/On this computer a step takes about/);
  });
  test("the memory warning is a visible notice with the plain text from capability.js", () => {
    render(<MemoryNotice />);
    expect(screen.getByRole("status").textContent).toContain(
      MEMORY_WARNING_TEXT,
    );
  });
});

describe("the machine keeps the path", () => {
  const policy = {
    async next() {
      return { action: "finish", outputs: [], note: "x" };
    },
  };
  const make = () =>
    createMachine({
      policy,
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile: async () => probeOf({ duration_s: 1, streams: [] }),
    });

  test("capabilityChecked sets it, and a new file does not clear it", async () => {
    const m = make();
    await m.dispatch({
      type: "capabilityChecked",
      ok: true,
      path: "cpu",
      notice: "no-webgpu",
    });
    expect(m.getState()).toMatchObject({
      name: "ready",
      path: "cpu",
      notice: "no-webgpu",
    });
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    expect(m.getState()).toMatchObject({
      name: "awaitingRequest",
      path: "cpu",
      notice: "no-webgpu",
    });
  });
  test("an old event without a path leaves it unknown (null), not guessed", async () => {
    const m = make();
    await m.dispatch({ type: "capabilityChecked", ok: true });
    expect(m.getState().path).toBeNull();
  });
  test("a refused device is refused, whatever path it carried", async () => {
    const m = make();
    await m.dispatch({
      type: "capabilityChecked",
      ok: false,
      reason: "mobile",
      path: "cpu",
    });
    expect(m.getState().name).toBe("unsupportedDevice");
  });
});

describe("the machine keeps the memory warning like the path", () => {
  test("capabilityChecked sets it and a new file does not clear it", async () => {
    const m = createMachine({
      policy: async () => "",
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile: async () => probeOf({ duration_s: 1, streams: [] }),
    });
    await m.dispatch({
      type: "capabilityChecked",
      ok: true,
      path: "cpu",
      memoryWarning: true,
    });
    expect(m.getState().memoryWarning).toBe(true);
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    expect(m.getState().memoryWarning).toBe(true);
    const n = createMachine({
      policy: async () => "",
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile: async () => probeOf({}),
    });
    await n.dispatch({ type: "capabilityChecked", ok: true, path: "cpu" });
    expect(n.getState().memoryWarning).toBe(false);
  });
});
