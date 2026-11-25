import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import CheckList from "../../app/components/tool/CheckList.jsx";
import CommandReveal from "../../app/components/tool/CommandReveal.jsx";
import DownloadButton from "../../app/components/tool/DownloadButton.jsx";
import RunLog from "../../app/components/tool/RunLog.jsx";
import RunProgress from "../../app/components/tool/RunProgress.jsx";
import { describeCheck } from "../../app/tool/checks.js";
import { displayArgs, flagsForChip } from "../../app/tool/chips.js";
import { saveFile } from "../../app/lib/save.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SIZE_FAIL = {
  field: "size_max_bytes",
  expected: 3_000_000,
  actual: 3_200_000,
  ok: false,
};
const SIZE_OK = {
  field: "size_max_bytes",
  expected: 3_000_000,
  actual: 1_700_000,
  ok: true,
};
const LENGTH = {
  field: "implicit.duration_s",
  expected: 16.07,
  actual: 16.07,
  ok: true,
};
const run = (n, checks, passed) => ({
  n,
  args: [],
  ok: true,
  rejected: null,
  error: null,
  passed,
  checks,
  errors: [],
});

describe("describeCheck", () => {
  test("the size row from the home page: 3.2 MB, over your 3 MB limit", () => {
    expect(describeCheck(SIZE_FAIL)).toEqual({
      label: "Size",
      value: "3.2 MB",
      why: "over your 3 MB limit",
    });
    expect(describeCheck(SIZE_OK)).toEqual({
      label: "Size",
      value: "1.7 MB",
      why: null,
    });
  });
  test("a value that was not measured says so, and an unknown field is shown as it is", () => {
    expect(
      describeCheck({
        field: "audio.loudness_lufs",
        expected: -16,
        actual: null,
        ok: false,
      }).value,
    ).toBe("not measured");
    expect(
      describeCheck({ field: "x.y", expected: 1, actual: 2, ok: false }).label,
    ).toBe("x.y");
  });
});

describe("CheckList", () => {
  const rows = () => [...document.querySelectorAll(".ck")];

  test("rows come in order, 60 ms apart: 0, 60, 120", () => {
    render(
      <CheckList
        checks={[
          SIZE_OK,
          LENGTH,
          { ...LENGTH, field: "video.width", expected: 1920, actual: 1920 },
        ]}
      />,
    );
    expect(rows().map((r) => r.style.getPropertyValue("--delay"))).toEqual([
      "0ms",
      "60ms",
      "120ms",
    ]);
    expect(rows().map((r) => r.firstChild.textContent)).toEqual([
      "Size",
      "Length",
      "Picture width",
    ]);
  });

  test("at most six steps: the rest land with the sixth", () => {
    render(
      <CheckList
        checks={Array.from({ length: 8 }, (_, i) => ({
          ...LENGTH,
          field: `f${i}`,
        }))}
      />,
    );
    expect(
      rows()
        .map((r) => r.style.getPropertyValue("--delay"))
        .slice(4),
    ).toEqual(["240ms", "300ms", "300ms", "300ms"]);
  });

  test("a failed check says 'failed' in text and carries the reason, not only a colour", () => {
    render(<CheckList checks={[SIZE_FAIL, LENGTH]} />);
    const [bad, good] = rows();
    expect(within(bad).getByRole("img", { name: "failed" })).toBeTruthy();
    expect(bad.textContent).toMatch(/over your 3 MB limit/);
    expect(within(good).getByRole("img", { name: "passed" })).toBeTruthy();
  });

  test("without animate every row is in its end state at once", () => {
    render(<CheckList checks={[SIZE_OK]} animate={false} />);
    expect(rows()[0].className).toMatch(/is-on/);
  });

  test("with animate the rows start hidden and are shown on the next frame", async () => {
    vi.stubGlobal("requestAnimationFrame", (f) => setTimeout(f, 0));
    render(<CheckList checks={[SIZE_OK]} animate />);
    expect(rows()[0].className).not.toMatch(/is-on/);
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(rows()[0].className).toMatch(/is-on/);
  });
});

describe("RunLog", () => {
  test("a failed run stays above the retry, and the log is a polite live region", () => {
    const { container } = render(
      <RunLog
        runs={[
          run(1, [SIZE_FAIL, LENGTH], false),
          run(2, [SIZE_OK, LENGTH], true),
        ]}
      />,
    );
    expect(container.firstChild.getAttribute("aria-live")).toBe("polite");
    const titles = [...container.querySelectorAll(".run__t")].map(
      (t) => t.textContent,
    );
    expect(titles[0]).toMatch(/^Run 1/);
    expect(titles[1]).toMatch(/^Run 2, trying again/);
    expect(titles[0]).toMatch(/did not pass/);
    expect(titles[1]).toMatch(/every check passed/);
    const sizes = [...container.querySelectorAll(".ck")]
      .filter((r) => r.firstChild.textContent === "Size")
      .map((r) => r.querySelector("b").textContent);
    expect(sizes[0]).toMatch(/^3\.2 MB/);
    expect(sizes[1]).toBe("1.7 MB");
  });

  test("a run that was refused or that FFmpeg could not finish says why", () => {
    render(
      <RunLog
        runs={[
          {
            ...run(1, [], false),
            ok: false,
            rejected: "option not allowed: -f",
          },
          {
            ...run(2, [], false),
            ok: false,
            error: "FFmpeg exited with code 1",
            failure: "option",
          },
        ]}
      />,
    );
    expect(
      screen.getByText(/nothing ran: option not allowed: -f/),
    ).toBeTruthy();
    expect(
      screen.getByText(/didn't understand part of the command/),
    ).toBeTruthy();
    expect(screen.queryByText(/exit|code 1/i)).toBeNull();
  });
});

describe("RunProgress", () => {
  test("shows the real percent as a numeral and a progressbar with its value", () => {
    render(<RunProgress percent={41.6} label="Running" />);
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "42",
    );
  });
  test("before FFmpeg reports anything there are only words", () => {
    render(<RunProgress percent={null} label="Running" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Running")).toBeTruthy();
  });
});

describe("CommandReveal", () => {
  const ARGS = displayArgs(
    ["-i", "{in:clip}", "-c:v", "libx264", "-crf", "26", "{out:out1}"],
    { clip: "detective.mp4" },
    { out1: "detective-small.mp4" },
  );
  const CHIPS = [
    ["Size", "under 3 MB", 1],
    ["Length", "unchanged"],
  ];

  test("closed by default; the toggle sets aria-expanded and Escape closes it", () => {
    render(<CommandReveal args={ARGS} chips={CHIPS} />);
    const toggle = screen.getByRole("button", {
      name: "Show the FFmpeg command",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".cmd")).toBeNull();
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: "Hide the FFmpeg command" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.querySelector(".cmd").textContent).toBe(
      "ffmpeg -i detective.mp4 -c:v libx264 -crf 26 detective-small.mp4",
    );
    fireEvent.keyDown(document.querySelector(".cmd"), { key: "Escape" });
    expect(document.querySelector(".cmd")).toBeNull();
  });

  test("hovering the Size chip highlights -crf 26; focus does the same for the keyboard", () => {
    render(<CommandReveal args={ARGS} chips={CHIPS} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Show the FFmpeg command" }),
    );
    const marks = () =>
      [...document.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks()).toEqual([]);
    const size = screen.getByRole("button", { name: /Size/ });
    fireEvent.mouseEnter(size);
    expect(marks()).toEqual(["-crf", "26"]);
    fireEvent.mouseLeave(size);
    expect(marks()).toEqual([]);
    fireEvent.focus(size);
    expect(marks()).toEqual(["-crf", "26"]);
  });

  test("a command with 40 arguments renders every one and wraps", () => {
    const args = Array.from({ length: 40 }, (_, i) => `-metadata:s:v:${i}`);
    render(<CommandReveal args={args} chips={[]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Show the FFmpeg command" }),
    );
    expect(document.querySelectorAll(".cmd span")).toHaveLength(41);
  });

  test("a name with a space or a quote is quoted so the copy is runnable", () => {
    render(<CommandReveal args={["-i", 'my "clip".mp4']} chips={[]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Show the FFmpeg command" }),
    );
    expect(document.querySelector(".cmd").textContent).toBe(
      'ffmpeg -i "my \\"clip\\".mp4"',
    );
  });

  test("copy puts the whole command on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CommandReveal args={ARGS} chips={CHIPS} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Show the FFmpeg command" }),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy the command" })),
    );
    expect(writeText).toHaveBeenCalledWith(
      "ffmpeg -i detective.mp4 -c:v libx264 -crf 26 detective-small.mp4",
    );
  });

  test("flag mapping: a flag without a value (-an) highlights alone", () => {
    expect([
      ...flagsForChip("Sound", ["-i", "a.mp4", "-an", "out.mp4"]),
    ]).toEqual([2]);
  });
});

describe("saveFile and DownloadButton", () => {
  const blob = new Blob(["x"], { type: "video/mp4" });

  test("falls back to a download link when there is no save dialog", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    expect(await saveFile(blob, "a-ffwd.mp4")).toBe("started");
    expect(click).toHaveBeenCalledTimes(1);
  });

  test("writes through the save dialog when the browser has one", async () => {
    const write = vi.fn();
    const close = vi.fn();
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () => ({ createWritable: async () => ({ write, close }) })),
    );
    expect(await saveFile(blob, "a.mp4")).toBe(true);
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalled();
  });

  test("closing the dialog is not an error and not a download", async () => {
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () =>
        Promise.reject(new DOMException("closed", "AbortError")),
      ),
    );
    expect(await saveFile(blob, "a.mp4")).toBe(false);
  });

  test("the button says Download, then Downloaded only after a save; disabled with no file", async () => {
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () =>
        Promise.reject(new DOMException("closed", "AbortError")),
      ),
    );
    const { rerender } = render(<DownloadButton blob={null} name="a.mp4" />);
    expect(screen.getByRole("button", { name: "Download" }).disabled).toBe(
      true,
    );
    rerender(<DownloadButton blob={blob} name="a.mp4" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Download" })),
    );
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy(); // cancelled: still "Download"
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () => ({
        createWritable: async () => ({ write() {}, close() {} }),
      })),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Download" })),
    );
    expect(screen.getByRole("button", { name: "Downloaded" })).toBeTruthy();
  });
});
