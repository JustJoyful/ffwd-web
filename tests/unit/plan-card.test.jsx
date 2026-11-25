import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PlanCard, {
  NO_CHANGE_TEXT,
} from "../../app/components/tool/PlanCard.jsx";
import { planGroups } from "../../app/tool/chips.js";
import { probeOf } from "./engine-fakes.js";

afterEach(cleanup);
const spec = (o, kind = "video") => ({
  family: ["F1"],
  outputs: [{ id: "out1", kind, ...o }],
});
const P = probeOf();
const labels = (cs) => cs.map(([l]) => l);

describe("planGroups", () => {
  test("a trim: Keep and Length change, picture and sound are kept", () => {
    const g = planGroups(spec({ container: "mp4", time: { start_s: 1 } }), P);
    expect(labels(g.change)).toEqual(["Keep", "Length", "Format"]);
    expect(labels(g.keep)).toEqual(["Picture", "Sound"]);
    expect(g.changesNothing).toBe(false);
  });
  test("audio extraction: picture removed is a change", () => {
    const g = planGroups(
      spec(
        { container: "m4a", audio: { present: true, codec: "aac" } },
        "audio",
      ),
      P,
    );
    expect(g.change).toContainEqual(["Picture", "removed", 1]);
    expect(g.changesNothing).toBe(false);
  });
  test("a picture-less input never claims the picture is kept", () => {
    const a = probeOf({
      container: "mp3",
      streams: [{ index: 0, type: "audio", codec: "mp3" }],
    });
    const g = planGroups(spec({ container: "mp3" }, "audio"), a);
    expect(labels([...g.change, ...g.keep])).not.toContain("Picture");
    expect(labels(g.keep)).toContain("Sound");
    expect(g.changesNothing).toBe(true);
  });
  test("changes nothing: empty spec, matching values, full-length cut, limit already met", () => {
    for (const o of [
      {},
      { time: { start_s: 0, end_s: 4 } },
      { video: { width: 1280, height: 720 } },
      { size_max_bytes: 9e6 },
    ])
      expect(planGroups(spec(o), P).changesNothing, JSON.stringify(o)).toBe(
        true,
      );
    expect(
      labels(planGroups(spec({ time: { start_s: 0 } }), P).change),
    ).toEqual([]);
  });
});

describe("PlanCard", () => {
  const chips = [
    ["Picture", "unchanged"],
    ["Sound", "kept"],
  ];
  test("a normal plan shows both groups and Run it", () => {
    render(
      <PlanCard
        chips={[["Keep", "0:01 to 0:04", 1], ...chips]}
        state="proposed"
        onRun={() => {}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Will change")).toBeTruthy();
    expect(screen.getByLabelText("Keeps")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run it" })).toBeTruthy();
    expect(screen.queryByText(NO_CHANGE_TEXT)).toBeNull();
  });
  test("no change: warning, no Run it, Reword is primary and focused, Run anyway needs a second click", () => {
    const onRun = vi.fn();
    const onReword = vi.fn();
    render(
      <PlanCard
        chips={chips}
        noChange
        state="proposed"
        onRun={onRun}
        onChange={() => {}}
        onReword={onReword}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "This plan doesn't change anything. Reword your request?",
    );
    expect(screen.queryByRole("button", { name: "Run it" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reword my request" })).toBe(
      document.activeElement,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reword my request" }));
    expect(onReword).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run anyway" }));
    expect(onRun).not.toHaveBeenCalled();
    const yes = screen.getByRole("button", { name: "Yes, run it anyway" });
    expect(yes).toBe(document.activeElement);
    fireEvent.click(yes);
    expect(onRun).toHaveBeenCalledTimes(1);
  });
  test("Escape on the confirmation goes back and returns focus to Reword", () => {
    render(
      <PlanCard
        chips={chips}
        noChange
        state="proposed"
        onRun={() => {}}
        onChange={() => {}}
        onReword={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run anyway" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Escape",
    });
    expect(screen.getByRole("button", { name: "Run anyway" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reword my request" })).toBe(
      document.activeElement,
    );
  });
});
