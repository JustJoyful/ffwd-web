import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import FeedbackPrompt, {
  FeedbackButton,
} from "../../app/components/tool/FeedbackPrompt.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const props = {
  kind: "failed_job",
  requestText: "trim holiday.mp4",
  failureCategory: "run_failed",
  fileName: "holiday.mp4",
};
const on = (fetchImpl = vi.fn(async () => ({ ok: true }))) => {
  vi.stubEnv("VITE_FEEDBACK_URL", "https://fb.test/in");
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
};

describe("FeedbackPrompt", () => {
  test("renders nothing, and never fetches, when the build has no feedback URL", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { container } = render(
      <>
        <FeedbackPrompt {...props} />
        <FeedbackButton onClick={() => {}} />
      </>,
    );
    expect(container.innerHTML).toBe("");
    expect(f).not.toHaveBeenCalled();
  });
  test("asks with the exact words, shows the payload, and sends nothing before Send", () => {
    const f = on();
    render(<FeedbackPrompt {...props} />);
    expect(screen.getByText("Help improve ffwd?")).toBeTruthy();
    expect(
      screen.getByText(
        "Send this request text (not your video) anonymously to help improve ffwd?",
      ),
    ).toBeTruthy();
    expect(screen.getByText("What gets sent").closest("details").open).toBe(
      false,
    );
    const shown = JSON.parse(
      document.querySelector("[data-feedback-payload]").textContent,
    );
    expect(shown.request).toBe("trim {file}");
    expect(f).not.toHaveBeenCalled();
  });
  test("Send posts exactly the previewed payload, then says thanks and focuses the message", async () => {
    const f = on();
    const done = vi.fn();
    render(<FeedbackPrompt {...props} onDone={done} />);
    const shown = JSON.parse(
      document.querySelector("[data-feedback-payload]").textContent,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Thanks. Sent.")).toBeTruthy());
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual(shown);
    expect(done).toHaveBeenCalledWith("sent");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status")),
    );
  });
  test("a failed send says so plainly", async () => {
    on(vi.fn(async () => ({ ok: false })));
    render(<FeedbackPrompt {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't send. Nothing was kept.")).toBeTruthy(),
    );
  });
  test("No thanks sends nothing and closes the panel", () => {
    const f = on();
    const done = vi.fn();
    const { container } = render(<FeedbackPrompt {...props} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(f).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith("declined");
    expect(container.innerHTML).toBe("");
  });
  test("FeedbackButton shows when on and calls onClick", () => {
    on();
    const click = vi.fn();
    render(<FeedbackButton onClick={click} />);
    fireEvent.click(screen.getByRole("button", { name: "This plan is wrong" }));
    expect(click).toHaveBeenCalled();
  });
});
