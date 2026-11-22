// The /app component audit (C4): states that had no test or no words, and every control of the model box named and
// reachable by keyboard.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import CommandReveal from "../../app/components/tool/CommandReveal.jsx";
import ModelLoader from "../../app/components/tool/ModelLoader.jsx";
import { initialModelState } from "../../app/model/contract.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommandReveal copy", () => {
  const open = () => {
    render(<CommandReveal args={["-i", "a.mp4", "b.mp4"]} chips={[]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Show the FFmpeg command" }),
    );
  };
  test("a blocked clipboard says so and never claims the command was copied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    open();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy the command" })),
    );
    expect(screen.getByRole("status").textContent).toMatch(/blocked copying/);
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

describe("the model box is keyboard-reachable and named in every phase", () => {
  test.each([
    ["needsConsent", ["Download", "Not now"]],
    ["failed", ["Try again"]],
  ])("%s", (phase, names) => {
    render(
      <ModelLoader
        available
        model={{
          ...initialModelState(),
          phase,
          error: { code: "load_failed", message: "x" },
        }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(names);
    for (const b of buttons) {
      b.focus();
      expect(document.activeElement).toBe(b);
    }
  });
});
