// Review S10: "Done" is only shown with a file the person can get, and a failed save says so.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DownloadButton, {
  SAVE_FAILED_TEXT,
} from "../../app/components/tool/DownloadButton.jsx";
import { SPEC_2MB, probeOf } from "./engine-fakes.js";

const tool = { current: null };
vi.mock("../../app/tool/store.js", () => ({ useTool: () => tool.current }));
const { default: App } = await import("../../app/routes/app.jsx");

const passed = (outputs) => ({
  n: 1,
  args: ["-i", "{in:clip}", "{out:out1}"],
  ok: true,
  passed: true,
  checks: [],
  errors: [],
  outputs,
});
const doneState = (outputs, spec = SPEC_2MB) => ({
  name: "done",
  request: "x",
  inputs: [{ id: "clip", name: "a.mp4", probe: probeOf() }],
  spec,
  plan: [],
  history: [passed(outputs)],
  runs: 1,
  turns: 2,
  question: null,
  reason: null,
  error: null,
  path: "webgpu",
  notice: null,
});
const show = (state, readOutput) => {
  tool.current = {
    state,
    dispatch: vi.fn(),
    store: {
      runtime: { readOutput },
      getState: () => state,
      subscribe: () => () => {},
    },
  };
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <App />
    </MemoryRouter>,
  );
};
const flush = () => act(async () => {});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the headline on done", () => {
  test("a readable file: Done, every check passed", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    show(doneState({ out1: "run1/out1.mp4" }), async () => new Blob(["x"]));
    await flush();
    expect(screen.getByText("Done, every check passed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" }).disabled).toBe(
      false,
    );
  });
  test("while the file is being read the page does not say Done", async () => {
    show(doneState({ out1: "run1/out1.mp4" }), () => new Promise(() => {}));
    await flush();
    expect(screen.queryByText("Done, every check passed")).toBeNull();
    expect(
      screen.getByText(/Every check passed\. Getting the file ready/),
    ).toBeTruthy();
  });
  test("an output that cannot be read as a file (an image sequence) is never Done", async () => {
    show(doneState({ out1: "run1/frames" }), async () => {
      throw new Error("is a directory");
    });
    await flush();
    expect(screen.queryByText("Done, every check passed")).toBeNull();
    expect(
      screen.getByText(/can't be saved as one file yet/, {
        selector: ".run__done",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" }).disabled).toBe(
      true,
    );
  });
  test("an output id other than out1 still finds its file", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const spec = structuredClone(SPEC_2MB);
    spec.outputs[0].id = "result";
    const read = vi.fn(async () => new Blob(["x"]));
    show(doneState({ result: "run1/result.mp4" }, spec), read);
    await flush();
    expect(read).toHaveBeenCalledWith("run1/result.mp4", expect.anything());
    expect(screen.getByText("Done, every check passed")).toBeTruthy();
  });
  test("no output handle at all is never Done", async () => {
    show(doneState({}), async () => new Blob(["x"]));
    await flush();
    expect(screen.queryByText("Done, every check passed")).toBeNull();
    expect(
      screen.getByText(/can't be saved as one file yet/, {
        selector: ".run__done",
      }),
    ).toBeTruthy();
  });
});

describe("DownloadButton failures", () => {
  const blob = new Blob(["x"]);
  const click = () =>
    act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Download/ })),
    );
  test("a save that throws shows a plain message and the button stays usable", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    URL.createObjectURL = vi.fn(() => {
      throw new Error("no memory");
    });
    render(<DownloadButton blob={blob} name="a.mp4" />);
    await click();
    expect(screen.getByRole("alert").textContent).toBe(SAVE_FAILED_TEXT);
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });
  test("the link fallback says Download started, the dialog says Downloaded", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { unmount } = render(<DownloadButton blob={blob} name="a.mp4" />);
    await click();
    expect(
      screen.getByRole("button", { name: "Download started" }),
    ).toBeTruthy();
    unmount();
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () => ({
        createWritable: async () => ({ write() {}, close() {} }),
      })),
    );
    render(<DownloadButton blob={blob} name="a.mp4" />);
    await click();
    expect(screen.getByRole("button", { name: "Downloaded" })).toBeTruthy();
  });
});
