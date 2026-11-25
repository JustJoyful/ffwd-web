import { describe, expect, test } from "vitest";
import { coverageGaps, mentioned } from "../../app/agent/request-coverage.js";
import { planGroups } from "../../app/tool/chips.js";
import { containerChanges, specEffects } from "../../app/agent/consistency.js";
import { A, V, probeOf } from "./engine-fakes.js";

// The owner's real clip: 640x360, 25 fps H.264 + AAC, an mp4 named smoke-clip.mp4.
const P = probeOf({
  duration_s: 10,
  size_bytes: 800_000,
  streams: [{ ...V, width: 640, height: 360, fps: 25 }, A],
});
const FILE = { name: "smoke-clip.mp4", type: "video/mp4" };
const spec = (o, kind = "video") => ({
  family: ["F1"],
  outputs: [{ id: "out1", kind, ...o }],
});
// what the model really wrote for the owner's request
const OWNER_SPEC = spec({
  container: "mp4",
  video: { fps: 25, rotation: 0 },
  audio: { present: true, codec: "aac", offset_ms: 0 },
});
const OWNER_REQUEST = "Make the video potrait mode, lower the volume";

describe("the owner's case", () => {
  test("the plan changes nothing and names nothing under Will change", () => {
    const g = planGroups(OWNER_SPEC, P, FILE);
    expect(g.changesNothing).toBe(true);
    expect(g.change).toEqual([]);
    expect(g.keep.map(([l]) => l)).not.toContain("Turn");
  });
  test("both the portrait and the volume gaps are reported", () => {
    expect(coverageGaps(OWNER_REQUEST, OWNER_SPEC, P, FILE)).toEqual([
      "Your request mentions a portrait picture, but this plan doesn't change it.",
      "Your request mentions the volume, but this plan doesn't change it.",
    ]);
  });
  test("without the file name the container still counts as a change (old behaviour)", () => {
    expect(planGroups(OWNER_SPEC, P).changesNothing).toBe(false);
  });
});

describe("container against the input's own container", () => {
  test.each([
    ["mp4", { name: "a.mp4" }, false],
    ["mp4", { name: "a.MP4" }, false],
    ["mp4", { name: "a", type: "video/mp4" }, false],
    ["mp4", { name: "IMG.MOV", type: "video/quicktime" }, true],
    ["mp4", { name: "a", type: "video/quicktime" }, true],
    ["mov", { name: "a.mov" }, false],
    ["mp4", null, true],
    ["mp4", { name: "weird.xyz" }, true],
    ["webm", { name: "a.mp4" }, true],
  ])("%s from %j changes: %s", (c, file, want) =>
    expect(containerChanges(c, P, file)).toBe(want),
  );
  test("the iPhone .mov to mp4 chore keeps its Run it (a change)", () => {
    const g = planGroups(
      spec({ container: "mp4", video: { codec: "h264", pix_fmt: "yuv420p" } }),
      P,
      { name: "IMG_4021.MOV", type: "video/quicktime" },
    );
    expect(g.changesNothing).toBe(false);
    expect(g.change.map(([l]) => l)).toContain("Format");
  });
});

describe("chips appear under Will change only when they differ from the input", () => {
  const labels = (cs) => cs.map(([l]) => l);
  test("equal values go to Keeps", () => {
    const g = planGroups(
      spec({
        video: { fps: 25, rotation: 0, codec: "h264", pix_fmt: "yuv420p" },
        audio: { codec: "aac", offset_ms: 0 },
      }),
      P,
      FILE,
    );
    expect(g.change).toEqual([]);
    expect(labels(g.keep)).toEqual(
      expect.arrayContaining(["Frame rate", "Sound", "Sound sync"]),
    );
  });
  test("differing values stay changes; a real turn is shown", () => {
    const g = planGroups(
      spec({
        video: { fps: 30, rotation: 90 },
        audio: { codec: "opus", offset_ms: 120 },
      }),
      P,
      FILE,
    );
    expect(labels(g.change)).toEqual(
      expect.arrayContaining(["Turn", "Frame rate", "Sound", "Sound sync"]),
    );
    expect(
      specEffects(spec({ video: { rotation: 0 } }), P, FILE).changesNothing,
    ).toBe(true);
  });
});

describe("coverageGaps", () => {
  test("a clean cut request with a trim spec: no gap", () => {
    expect(
      coverageGaps(
        "Cut the first 2 seconds off",
        spec({ time: { start_s: 2 } }),
        P,
        FILE,
      ),
    ).toEqual([]);
  });
  test("make it 720p with a 720p spec: no gap; with a no-op spec: a gap", () => {
    const s = spec({ video: { width: 1280, height: 720 } });
    expect(coverageGaps("make it 720p", s, P, FILE)).toEqual([]);
    expect(coverageGaps("make it 720p", spec({}), P, FILE)).toEqual([
      "Your request mentions the size of the video, but this plan doesn't change it.",
    ]);
  });
  test("keep the sound the same, cut the first 3 seconds: the sound is ignored", () => {
    expect(
      coverageGaps(
        "keep the sound the same, cut the first 3 seconds",
        spec({ time: { start_s: 3 } }),
        P,
        FILE,
      ),
    ).toEqual([]);
    expect(
      mentioned("keep the volume the same, cut the first 3 seconds"),
    ).toEqual(new Set(["cut"]));
  });
  test("covered concepts: portrait by size or turn, volume by loudness or mute, kind", () => {
    expect(
      coverageGaps(
        "make it vertical",
        spec({ video: { width: 1080, height: 1920 } }),
        P,
        FILE,
      ),
    ).toEqual([]);
    expect(
      coverageGaps(
        "make it portrait",
        spec({ video: { rotation: 90 } }),
        P,
        FILE,
      ),
    ).toEqual([]);
    expect(
      coverageGaps(
        "lower the volume",
        spec({ audio: { loudness_lufs: -30 } }),
        P,
        FILE,
      ),
    ).toEqual([]);
    expect(
      coverageGaps("mute it", spec({ audio: { present: false } }), P, FILE),
    ).toEqual([]);
    expect(
      coverageGaps(
        "extract audio",
        spec({ kind: "audio", container: "m4a" }),
        P,
        FILE,
      ),
    ).toEqual([]);
    expect(coverageGaps("make a gif", spec({}), P, FILE)).toHaveLength(1);
    expect(coverageGaps("make a gif", spec({ kind: "gif" }), P, FILE)).toEqual(
      [],
    );
  });
  test("turn it up is the volume, not a turn; whole words only", () => {
    expect([...mentioned("turn it up")]).toEqual(["volume"]);
    expect([...mentioned("a returning tallest silence")]).toEqual([]);
    expect([...mentioned("under 2 MB")]).toEqual(["size"]);
    expect([...mentioned("last 5 seconds only")]).toEqual(["cut"]);
  });
  test("an input that is already portrait, or has no sound, needs nothing", () => {
    const tall = probeOf({ streams: [{ ...V, width: 360, height: 640 }, A] });
    expect(coverageGaps("make it portrait", spec({}), tall, FILE)).toEqual([]);
    const mute = probeOf({ streams: [V] });
    expect(coverageGaps("lower the volume", spec({}), mute, FILE)).toEqual([]);
  });
  test("never throws", () => {
    expect(coverageGaps(null, null, null)).toEqual([]);
    expect(coverageGaps(undefined, spec({}), null)).toEqual([]);
  });
});
