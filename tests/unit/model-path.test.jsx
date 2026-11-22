// Where the model runs (D-050): the notice the person sees and the path the state machine keeps.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ModelPathNotice from "../../app/components/tool/ModelPathNotice.jsx";
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
