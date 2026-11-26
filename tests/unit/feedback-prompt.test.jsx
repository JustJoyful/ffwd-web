import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import FeedbackPrompt from "../../app/components/tool/FeedbackPrompt.jsx";
import {
  hideFeedbackForSession,
  resetFeedbackState,
  useFeedbackAvailable,
} from "../../app/lib/feedback-state.js";

afterEach(() => {
  cleanup();
  resetFeedbackState();
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
      </>,
    );
    expect(container.innerHTML).toBe("");
    expect(f).not.toHaveBeenCalled();
  });
  test("asks with the exact words, shows the payload, and sends nothing before Send", () => {
    const f = on();
    render(<FeedbackPrompt {...props} />);
    expect(screen.getByText("Help improve ffwd?")).toBeTruthy();
    // the consent sentence, word for word
    expect(
      screen.getByText(
        "Send this request (not your video) anonymously. Your request text (not your video) may be used to improve ffwd's model.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText(/What did you expect\? \(optional\)/)).toBe(
      document.querySelector("input[maxlength='200']"),
    );
    expect(
      screen.getByText("Don't include names or personal details."),
    ).toBeTruthy();
    // it was opened by a click, so focus is on its heading
    expect(document.activeElement).toBe(screen.getByText("Help improve ffwd?"));
    expect(screen.getByText("What gets sent").closest("details").open).toBe(
      false,
    );
    const shown = JSON.parse(
      document.querySelector("[data-feedback-payload]").textContent,
    );
    expect(shown.request).toBe("trim {file}");
    expect(f).not.toHaveBeenCalled();
  });
  test("the note is part of the previewed JSON, scrubbed, and sent; empty means no note key", async () => {
    const f = on();
    render(<FeedbackPrompt {...props} />);
    const shown = () =>
      JSON.parse(document.querySelector("[data-feedback-payload]").textContent);
    expect(Object.keys(shown())).not.toContain("note");
    fireEvent.change(screen.getByLabelText(/What did you expect/), {
      target: { value: "  keep holiday.mp4 sound at /home/me/x  " },
    });
    expect(shown().note).toBe("keep {file} sound at {path}");
    expect(Object.keys(shown())).toEqual([
      "kind",
      "request",
      "note",
      "plan",
      "failure",
      "app_version",
      "model_version",
    ]);
    const previewed = shown();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Thanks. Sent.")).toBeTruthy());
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual(previewed);
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
  test("No thanks sends nothing, closes the panel and hides every entry point for the session", () => {
    const f = on();
    const done = vi.fn();
    const { container } = render(
      <>
        <FeedbackPrompt {...props} onDone={done} />
        <Probe jobKey="a:0" />
      </>,
    );
    expect(screen.getByTestId("avail").textContent).toBe("yes");
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(f).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith("declined");
    expect(container.querySelector("[data-feedback]")).toBeNull();
    expect(screen.getByTestId("avail").textContent).toBe("no");
    expect(sessionStorage.getItem("ffwd-feedback-hidden")).toBe("1");
  });
  test("a send hides the entry points for that job only; a new job shows them again", async () => {
    on();
    render(
      <>
        <FeedbackPrompt {...props} jobKey="trim:1" />
        <Probe jobKey="trim:1" id="same" />
        <Probe jobKey="trim:2" id="next" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Thanks. Sent.")).toBeTruthy());
    expect(screen.getByTestId("same").textContent).toBe("no");
    expect(screen.getByTestId("next").textContent).toBe("yes");
  });
  test("a failed send does not hide anything", async () => {
    on(vi.fn(async () => ({ ok: false })));
    render(
      <>
        <FeedbackPrompt {...props} jobKey="j:1" />
        <Probe jobKey="j:1" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/Couldn't send/)).toBeTruthy());
    expect(screen.getByTestId("avail").textContent).toBe("yes");
  });
});

function Probe({ jobKey, id = "avail" }) {
  return <i data-testid={id}>{useFeedbackAvailable(jobKey) ? "yes" : "no"}</i>;
}

describe("the session hide", () => {
  test("is off without a feedback URL, and on after hideFeedbackForSession", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "");
    const { rerender } = render(<Probe jobKey="a" />);
    expect(screen.getByTestId("avail").textContent).toBe("no");
    vi.stubEnv("VITE_FEEDBACK_URL", "https://fb.test/in");
    rerender(<Probe jobKey="a" />);
    expect(screen.getByTestId("avail").textContent).toBe("yes");
    act(() => hideFeedbackForSession());
    expect(screen.getByTestId("avail").textContent).toBe("no");
  });
  test("a flag left in sessionStorage by an earlier page hides everything", () => {
    on();
    sessionStorage.setItem("ffwd-feedback-hidden", "1");
    render(<Probe jobKey="a" />);
    expect(screen.getByTestId("avail").textContent).toBe("no");
  });
  test("storage that throws never breaks anything: hidden for the life of the page, in memory", () => {
    on();
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
    });
    render(<Probe jobKey="a" />);
    expect(screen.getByTestId("avail").textContent).toBe("yes"); // reading throws: treated as "not hidden"
    act(() => hideFeedbackForSession());
    expect(screen.getByTestId("avail").textContent).toBe("no");
  });
});
