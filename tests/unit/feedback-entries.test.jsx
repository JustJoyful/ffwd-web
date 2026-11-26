// Where the three quiet feedback links appear on /app (a fake store stands in for the model and the engine), that none of
// them opens anything by itself, and that "No thanks" and a send hide them as decided. Feedback off renders nothing.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { initialModelState } from "../../app/model/contract.js";
import { resetFeedbackState } from "../../app/lib/feedback-state.js";
import { SPEC_2MB, probeOf } from "./engine-fakes.js";

const tool = { current: null };
vi.mock("../../app/tool/store.js", () => ({ useTool: () => tool.current }));
const { default: App } = await import("../../app/routes/app.jsx");

const passed = {
  n: 1,
  args: ["-i", "{in:clip}", "{out:out1}"],
  ok: true,
  passed: true,
  checks: [],
  errors: [],
  outputs: { out1: "run1/out1.mp4" },
};
const base = {
  name: "awaitingConfirm",
  request: "make it 2 MB",
  inputs: [{ id: "clip", name: "holiday.mp4", probe: probeOf() }],
  spec: SPEC_2MB,
  plan: [],
  history: [],
  runs: 0,
  turns: 1,
  question: null,
  reason: null,
  error: null,
  path: "webgpu",
  notice: null,
};
const show = (state, model = { phase: "ready" }) => {
  tool.current = {
    state: { ...base, ...state },
    dispatch: vi.fn(),
    store: {
      runtime: { readOutput: async () => new Blob(["x"]) },
      getState: () => base,
      subscribe: () => () => {},
    },
    model: { ...initialModelState(), ...model },
  };
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  const r = render(
    <MemoryRouter initialEntries={["/app"]}>
      <App />
    </MemoryRouter>,
  );
  return r;
};
const flush = () => act(async () => {});
const STATES = {
  plan: {},
  failed: { name: "failed", reason: "run_budget", runs: 4 },
  unsupported: { name: "unsupported", reason: "I can't do that yet." },
  done: { name: "done", history: [passed], runs: 1 },
};
const LINKS = [
  "Not what I meant",
  "Send this request (not your video) to help improve ffwd",
  "Not what you asked?",
];
const PANEL = "Help improve ffwd?";
const links = () =>
  LINKS.flatMap((n) => screen.queryAllByRole("button", { name: n }));

let fetchMock;
beforeEach(() => {
  vi.stubEnv("VITE_FEEDBACK_URL", "https://fb.test/in");
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  resetFeedbackState();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("feedback off: nothing is rendered in any state", () => {
  test.each(Object.keys(STATES))("%s", async (k) => {
    vi.stubEnv("VITE_FEEDBACK_URL", "");
    show(STATES[k]);
    await flush();
    expect(links()).toEqual([]);
    expect(screen.queryByText(PANEL)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the entry points appear only in the right states, and nothing opens by itself", () => {
  test("plan card: the link sits in the action row next to Run it and Change", async () => {
    show(STATES.plan);
    await flush();
    const row = screen.getByRole("button", { name: "Run it" }).parentElement;
    expect(row.className).toContain("plan__actions");
    expect(within(row).getByRole("button", { name: "Change" })).toBeTruthy();
    expect(
      within(row).getByRole("button", { name: "Not what I meant" }).className,
    ).toBe("cmdlink");
    expect(links()).toHaveLength(1);
    expect(screen.queryByText(PANEL)).toBeNull();
  });
  test("a click opens the panel (plan_wrong) and moves focus to its heading", async () => {
    show(STATES.plan);
    fireEvent.click(screen.getByRole("button", { name: "Not what I meant" }));
    const heading = await screen.findByText(PANEL);
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      JSON.parse(document.querySelector("[data-feedback-payload]").textContent),
    ).toMatchObject({ kind: "plan_wrong", failure: "plan_wrong" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("a failed job: one quiet line under the notice; closed until clicked", async () => {
    show(STATES.failed);
    await flush();
    expect(links().map((b) => b.textContent)).toEqual([LINKS[1]]);
    expect(screen.queryByText(PANEL)).toBeNull();
    fireEvent.click(links()[0]);
    await screen.findByText(PANEL);
    expect(
      JSON.parse(document.querySelector("[data-feedback-payload]").textContent)
        .kind,
    ).toBe("failed_job");
    expect(links()).toEqual([]); // the line is replaced by the panel
  });
  test("a stopped job (aborted) gets no feedback line", async () => {
    show({ ...STATES.failed, reason: "aborted" });
    await flush();
    expect(links()).toEqual([]);
  });
  test("unsupported: the same line, closed until clicked", async () => {
    show(STATES.unsupported);
    await flush();
    expect(links().map((b) => b.textContent)).toEqual([LINKS[1]]);
    expect(screen.queryByText(PANEL)).toBeNull();
    fireEvent.click(links()[0]);
    await screen.findByText(PANEL);
    expect(
      JSON.parse(document.querySelector("[data-feedback-payload]").textContent)
        .failure,
    ).toBe("no_plan");
  });
  test("done: 'Not what you asked?' sits beside the command toggle, not in the save row or the viewer", async () => {
    show(STATES.done);
    await flush();
    const b = screen.getByRole("button", { name: "Not what you asked?" });
    expect(b.parentElement.className).toBe("reveal-cmd__row");
    expect(
      within(b.parentElement).getByRole("button", {
        name: "Show the FFmpeg command",
      }),
    ).toBeTruthy();
    expect(b.closest(".save, .viewer, .stage")).toBeNull();
    expect(screen.queryByText(PANEL)).toBeNull();
    fireEvent.click(b);
    await screen.findByText(PANEL);
    expect(
      JSON.parse(document.querySelector("[data-feedback-payload]").textContent)
        .kind,
    ).toBe("result_wrong");
  });
  test("no entry point while the model is not ready", async () => {
    for (const k of Object.keys(STATES)) {
      show(STATES[k], { phase: "needsConsent" });
      await flush();
      expect(links()).toEqual([]);
      cleanup();
    }
  });
  test("an unchecked (failed) result is not 'a result': no 'Not what you asked?'", async () => {
    show({ ...STATES.failed, history: [{ ...passed, passed: false }] });
    await flush();
    expect(screen.queryByRole("button", { name: LINKS[2] })).toBeNull();
  });
});

describe("hiding", () => {
  test("No thanks hides every entry point for the session, even in the other states", async () => {
    const { unmount } = show(STATES.failed);
    fireEvent.click(links()[0]);
    await screen.findByText(PANEL);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByText(PANEL)).toBeNull();
    expect(links()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    for (const k of Object.keys(STATES)) {
      show(STATES[k]); // "a reload in the same session": a fresh page reads sessionStorage
      await flush();
      expect(links()).toEqual([]);
      cleanup();
    }
  });
  test("a send hides the links for that job (the panel says thanks); another job shows them again", async () => {
    show(STATES.failed);
    fireEvent.click(links()[0]);
    await screen.findByText(PANEL);
    fireEvent.change(screen.getByLabelText(/What did you expect/), {
      target: { value: "a 2 MB file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Thanks. Sent.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      kind: "failed_job",
      note: "a 2 MB file",
    });
    expect(links()).toEqual([]);
    cleanup();
    show({ ...STATES.failed, request: "another request" }); // a new job
    await flush();
    expect(links()).toHaveLength(1);
  });
});
