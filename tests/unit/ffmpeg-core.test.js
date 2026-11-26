// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FFMPEG_CORE_SHA256 } from "../../app/agent/config.js";
import { FfmpegSession } from "../../app/agent/executor/ffmpeg-session.js";

// The real FFmpeg class refuses to be constructed outside a browser; the integrity check runs before `load` is ever called.
vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    loaded = false;
    async load() {
      throw new Error("load must not be reached with a bad core file");
    }
    terminate() {}
  },
}));

const DIR = "node_modules/@ffmpeg/core-mt/dist/esm";
afterEach(() => vi.unstubAllGlobals());

describe("the pinned ffmpeg core hashes", () => {
  test.skipIf(!existsSync(`${DIR}/ffmpeg-core.js`))(
    "equal the installed @ffmpeg/core-mt files (a version bump must update them)",
    () => {
      for (const [f, want] of Object.entries(FFMPEG_CORE_SHA256))
        expect(
          createHash("sha256")
            .update(readFileSync(`${DIR}/${f}`))
            .digest("hex"),
          f,
        ).toBe(want);
    },
  );
  test("cover exactly the three files the session loads", () => {
    expect(Object.keys(FFMPEG_CORE_SHA256).sort()).toEqual([
      "ffmpeg-core.js",
      "ffmpeg-core.wasm",
      "ffmpeg-core.worker.js",
    ]);
  });
});

describe("loading the core refuses a file that does not match its hash", () => {
  test("a changed core file ends as an engine start failure, naming the problem", async () => {
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:x" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
    );
    const s = new FfmpegSession({ coreBase: "https://cdn.example.org/core" });
    await expect(s.exec(["-version"])).rejects.toMatchObject({
      code: "engine_start",
      message: expect.stringMatching(/pinned sha256/),
    });
  });
});
