// Review S4 (and the core fetch half of B2): a broken video engine is not "this video can't be read".
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  EngineStartError,
  FfmpegSession,
} from "../../app/agent/executor/ffmpeg-session.js";
import { createMachine } from "../../app/agent/machine.js";
import ProbeReadout, {
  ENGINE_TEXT,
  UNREADABLE_TEXT,
} from "../../app/components/tool/ProbeReadout.jsx";
import { fakeExecutor, fakeMeasure, policyOf } from "./engine-fakes.js";

// ffmpeg.wasm refuses to construct under node; the core download is what is under test, not the worker.
vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    loaded = false;
    load = async () => {};
    terminate() {}
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe("FfmpegSession core download", () => {
  test("a 404 for a core file is an EngineStartError naming the file, never a core made of the 404 page", async () => {
    const fetched = [];
    vi.stubGlobal("fetch", async (url) => {
      fetched.push(url);
      return new Response("<html>not found</html>", { status: 404 });
    });
    const session = new FfmpegSession({ coreBase: "/ffmpeg" });
    const e = await session.write("a", new Uint8Array(1)).catch((x) => x);
    expect(e).toBeInstanceOf(EngineStartError);
    expect(e.code).toBe("engine_start");
    expect(e.message).toMatch(/ffmpeg-core\.js: HTTP 404/);
    expect(fetched).toEqual(["/ffmpeg/ffmpeg-core.js"]); // stopped at the first bad file
    // a failed start is not remembered: the next call tries again
    await session.write("a", new Uint8Array(1)).catch(() => {});
    expect(fetched).toHaveLength(2);
  });
});

describe("the machine and the page", () => {
  const ready = async (probeFile) => {
    const m = createMachine({
      policy: policyOf([]),
      executor: fakeExecutor(),
      measure: fakeMeasure(),
      probeFile,
    });
    await m.dispatch({ type: "capabilityChecked", ok: true });
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    return m;
  };
  test("an engine start failure is errorKind engine; a file ffmpeg cannot parse is not", async () => {
    const eng = await ready(() =>
      Promise.reject(new EngineStartError("core failed")),
    );
    expect(eng.getState()).toMatchObject({
      name: "ready",
      errorKind: "engine",
    });
    const bad = await ready(() => Promise.reject(new Error("no streams")));
    expect(bad.getState()).toMatchObject({ name: "ready", errorKind: null });
    expect(bad.getState().error).toMatch(/no streams/);
  });
  test("choosing another file clears the engine error", async () => {
    let n = 0;
    const m = await ready(() =>
      ++n === 1
        ? Promise.reject(new EngineStartError("x"))
        : Promise.reject(new Error("bad file")),
    );
    await m.dispatch({ type: "fileChosen", file: { name: "b.mp4" } });
    expect(m.getState().errorKind).toBeNull();
  });
  test("the readout blames the engine, not the video", () => {
    render(<ProbeReadout name="a.mp4" size={5} probe={null} state="engine" />);
    const text = screen.getByRole("alert").textContent;
    expect(text).toBe(ENGINE_TEXT);
    expect(text).not.toMatch(/can't be read|damaged/);
    expect(UNREADABLE_TEXT).toMatch(/damaged/);
  });
});
