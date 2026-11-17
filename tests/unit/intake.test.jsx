import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import DropOverlay from "../../app/components/tool/DropOverlay.jsx";
import FileIntake from "../../app/components/tool/FileIntake.jsx";
import { NOTICE, pickFile } from "../../app/tool/intake.js";
import { maxFileBytes } from "../../app/lib/capability.js";

afterEach(cleanup);

const file = (name, type, bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type });
const video = (name = "a.mp4") => file(name, "video/mp4");
// A File whose size is whatever the test says, without allocating it.
const sized = (name, type, size) =>
  Object.defineProperty(file(name, type, 1), "size", { value: size });

describe("pickFile", () => {
  test("a .txt file is refused with the plain-language message", () => {
    expect(pickFile([file("notes.txt", "text/plain")])).toEqual({
      file: null,
      notice: NOTICE.notVideo,
    });
  });
  test("a 0-byte video is refused", () => {
    expect(pickFile([file("a.mp4", "video/mp4", 0)])).toEqual({
      file: null,
      notice: NOTICE.empty,
    });
  });
  test("a video is accepted by its type, or by its extension when the browser gives no type", () => {
    expect(pickFile([video()]).file.name).toBe("a.mp4");
    expect(pickFile([file("clip.MKV", "")]).file.name).toBe("clip.MKV");
  });
  test("two files take the first and say so", () => {
    const r = pickFile([video("one.mp4"), video("two.mp4")]);
    expect(r.file.name).toBe("one.mp4");
    expect(r.notice).toMatch(/2 files.*first one/);
  });
  test("when disabled nothing is taken and the notice says why", () => {
    expect(pickFile([video()], { disabled: true })).toEqual({
      file: null,
      notice: NOTICE.busy,
    });
  });
  test("a 4 GB file is accepted with a warning, not blocked", () => {
    const r = pickFile([sized("big.mp4", "video/mp4", 4 * 1024 ** 3)], {
      deviceMemory: 8,
    });
    expect(r.file).not.toBeNull();
    expect(r.notice).toMatch(/large \(4 GB\)/);
  });
  test("the warning limit follows the device memory; a normal file has no warning", () => {
    expect(maxFileBytes(8)).toBeGreaterThan(maxFileBytes(2));
    expect(pickFile([video()], { deviceMemory: 2 }).notice).toBeNull();
    expect(
      pickFile([sized("m.mp4", "video/mp4", 300 * 1024 ** 2)], {
        deviceMemory: 2,
      }).notice,
    ).toMatch(/large/);
  });
  test("nothing chosen is not an error", () => {
    expect(pickFile([])).toEqual({ file: null, notice: null });
  });
});

describe("FileIntake", () => {
  const input = () => document.querySelector("input[type=file]");
  const choose = (...files) => fireEvent.change(input(), { target: { files } });

  test("a video goes to onFile", () => {
    const onFile = vi.fn();
    render(<FileIntake onFile={onFile} />);
    const f = video();
    choose(f);
    expect(onFile).toHaveBeenCalledWith(f);
  });
  test("a .txt file shows the message and is not passed on", () => {
    const onFile = vi.fn();
    render(<FileIntake onFile={onFile} />);
    choose(file("notes.txt", "text/plain"));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(NOTICE.notVideo);
  });
  test("two files: the first is used and the message says so", () => {
    const onFile = vi.fn();
    render(<FileIntake onFile={onFile} />);
    choose(video("one.mp4"), video("two.mp4"));
    expect(onFile.mock.calls[0][0].name).toBe("one.mp4");
    expect(screen.getByRole("status").textContent).toMatch(/first one/);
  });
  test("disabled: the control is off", () => {
    render(<FileIntake onFile={() => {}} disabled />);
    expect(input().disabled).toBe(true);
  });
  test("the visible button is the input's label, so keyboard and screen readers get a named control", () => {
    render(<FileIntake onFile={() => {}} />);
    expect(screen.getByLabelText("Choose a video")).toBe(input());
  });
  test("a message from a drop elsewhere on the page is shown here", () => {
    render(<FileIntake onFile={() => {}} notice="From a drop" />);
    expect(screen.getByRole("status").textContent).toBe("From a drop");
  });
});

describe("DropOverlay", () => {
  const drag = (type, files = [video()]) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    e.dataTransfer = { types: ["Files"], files };
    act(() => {
      window.dispatchEvent(e);
    });
    return e;
  };
  const text = "Drop to open in ffwd. It stays on this computer.";

  test("appears on dragenter with files and goes on dragleave", () => {
    render(<DropOverlay onFile={() => {}} />);
    expect(screen.queryByText(text)).toBeNull();
    drag("dragenter");
    expect(screen.getByText(text)).toBeTruthy();
    drag("dragleave");
    expect(screen.queryByText(text)).toBeNull();
  });
  test("moving over child elements (enter, enter, leave) does not hide it early", () => {
    render(<DropOverlay onFile={() => {}} />);
    drag("dragenter");
    drag("dragenter");
    drag("dragleave");
    expect(screen.getByText(text)).toBeTruthy();
    drag("dragleave");
    expect(screen.queryByText(text)).toBeNull();
  });
  test("dragging text (no files) shows nothing", () => {
    render(<DropOverlay onFile={() => {}} />);
    const e = new Event("dragenter", { bubbles: true });
    e.dataTransfer = { types: ["text/plain"] };
    act(() => {
      window.dispatchEvent(e);
    });
    expect(screen.queryByText(text)).toBeNull();
  });
  test("a drop hands the first video over, hides the overlay and stops the browser opening the file", () => {
    const onFile = vi.fn();
    render(<DropOverlay onFile={onFile} />);
    drag("dragenter");
    const f = video("dropped.mp4");
    const e = drag("drop", [f]);
    expect(e.defaultPrevented).toBe(true);
    expect(onFile).toHaveBeenCalledWith(f);
    expect(screen.queryByText(text)).toBeNull();
  });
  test("a drop while disabled does nothing but say why", () => {
    const onFile = vi.fn();
    const onNotice = vi.fn();
    render(<DropOverlay onFile={onFile} onNotice={onNotice} disabled />);
    drag("dragenter");
    drag("drop");
    expect(onFile).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(NOTICE.busy);
  });
  test("a dropped .txt is refused with the message", () => {
    const onFile = vi.fn();
    const onNotice = vi.fn();
    render(<DropOverlay onFile={onFile} onNotice={onNotice} />);
    drag("drop", [file("a.txt", "text/plain")]);
    expect(onFile).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(NOTICE.notVideo);
  });
  test("Escape closes it", () => {
    render(<DropOverlay onFile={() => {}} />);
    drag("dragenter");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByText(text)).toBeNull();
  });
  test("it removes its listeners on unmount", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<DropOverlay onFile={() => {}} />);
    unmount();
    expect(spy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        "dragenter",
        "dragleave",
        "dragover",
        "drop",
        "keydown",
      ]),
    );
  });
});
