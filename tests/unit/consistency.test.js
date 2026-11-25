import { describe, expect, test } from "vitest";
import {
  commandEffects,
  consistencyProblems,
  specEffects,
} from "../../app/agent/consistency.js";
import { probeOf } from "./engine-fakes.js";

const P = probeOf(); // 1280x720 h264 30 fps + aac, 4 s, mp4
const spec = (o) => ({
  family: ["F4"],
  outputs: [{ id: "out1", kind: "video", ...o }],
});
const IN = ["-i", "{in:clip}"];
const PORTRAIT = spec({
  container: "mp4",
  video: { width: 1080, height: 1920 },
  audio: { loudness_lufs: -30 },
});
const OK = [
  ...IN,
  "-vf",
  "crop=ih*9/16:ih,scale=1080:1920",
  "-af",
  "volume=0.5",
  "{out:out1}",
];

describe("commandEffects", () => {
  test("geometry: scale, -2, crop expressions, transpose", () => {
    expect(
      commandEffects([...IN, "-vf", "scale=1080:1920", "{out:out1}"], P).size,
    ).toEqual([1080, 1920]);
    expect(
      commandEffects([...IN, "-vf", "scale=-2:1920", "{out:out1}"], P).size,
    ).toEqual([3414, 1920]);
    expect(
      commandEffects([...IN, "-vf", "transpose=1", "{out:out1}"], P),
    ).toMatchObject({ orientation: "portrait", rotation: 90 });
    expect(
      commandEffects([...IN, "-vf", "hflip,vflip", "{out:out1}"], P).rotation,
    ).toBe(180);
  });
  test("unknown filters and complex graphs give no verdict", () => {
    const e = commandEffects([...IN, "-vf", "zoompan=z=2", "{out:out1}"], P);
    expect([e.size, e.rotation, e.orientation]).toEqual([null, null, null]);
    expect(
      commandEffects(
        [...IN, "-filter_complex", "[0:v]scale=1:1[v]", "{out:out1}"],
        P,
      ).size,
    ).toBeNull();
  });
  test("sound, cut, speed", () => {
    expect(commandEffects([...IN, "-an", "{out:out1}"], P).audioRemoved).toBe(
      true,
    );
    expect(
      commandEffects([...IN, "-af", "volume=-6dB", "{out:out1}"], P).volume,
    ).toBe("changed");
    expect(
      commandEffects([...IN, "-af", "volume=1.0", "{out:out1}"], P).volume,
    ).toBe("none");
    expect(commandEffects(["-ss", "1", ...IN, "{out:out1}"], P).trimmed).toBe(
      true,
    );
    expect(commandEffects([...IN, "-t", "4", "{out:out1}"], P).trimmed).toBe(
      false,
    );
    expect(
      commandEffects([...IN, "-vf", "setpts=PTS/2", "{out:out1}"], P).speed,
    ).toBe(2);
  });
});

describe("specEffects.changesNothing", () => {
  test.each([
    [spec({}), true],
    [spec({ container: "mp4" }), false], // mov/mp4 cannot be told apart: a conversion
    [spec({ container: "mp3" }), false],
    [
      spec({
        video: { width: 1280, height: 720, rotation: 0 },
        audio: { present: true },
      }),
      true,
    ],
    [spec({ time: { start_s: 0, end_s: 4 } }), true],
    [spec({ size_max_bytes: 9_000_000 }), true],
    [spec({ container: "webm" }), false],
    [spec({ video: { width: 1080, height: 1920 } }), false],
    [spec({ video: { rotation: 90 } }), false],
    [spec({ time: { start_s: 1 } }), false],
    [spec({ audio: { present: false } }), false],
    [spec({ audio: { loudness_lufs: -20 } }), false],
    [spec({ size_max_bytes: 1_000_000 }), false],
    [spec({ video: { codec: "hevc" } }), false],
    [spec({ kind: "audio" }), false],
  ])("%#", (s, want) => expect(specEffects(s, P).changesNothing).toBe(want));
  test("audio-only input with an audio spec that matches", () => {
    const a = probeOf({
      container: "mp3",
      streams: [{ index: 0, type: "audio", codec: "mp3" }],
    });
    expect(
      specEffects(spec({ kind: "audio", container: "mp3" }), a).changesNothing,
    ).toBe(true);
  });
});

describe("consistencyProblems", () => {
  test("a correct portrait + lower volume command passes", () => {
    expect(consistencyProblems(PORTRAIT, P, OK)).toEqual([]);
  });
  test("the owner's example: only scaling leaves the volume alone", () => {
    const p = consistencyProblems(PORTRAIT, P, [
      ...IN,
      "-vf",
      "scale=1080:1920",
      "{out:out1}",
    ]);
    expect(p).toEqual([
      "The plan changes how loud the sound is, but the command doesn't change the volume.",
    ]);
  });
  test("a landscape command against a portrait plan", () => {
    const p = consistencyProblems(PORTRAIT, P, [
      ...IN,
      "-vf",
      "scale=1920:1080",
      "-af",
      "volume=0.5",
      "{out:out1}",
    ]);
    expect(p[0]).toMatch(
      /asks for a portrait picture, but the command makes a landscape one/,
    );
  });
  test("a plan that changes nothing against a command that turns and mutes", () => {
    const p = consistencyProblems(spec({ container: "mp4" }), P, [
      ...IN,
      "-vf",
      "transpose=1",
      "-an",
      "{out:out1}",
    ]);
    expect(p).toHaveLength(2);
  });
  test("more equivalent work is fine: extra neutral filters, other codecs, size under a size plan", () => {
    expect(
      consistencyProblems(spec({ container: "mp4", size_max_bytes: 1e6 }), P, [
        ...IN,
        "-vf",
        "scale=640:-2,format=yuv420p",
        "-crf",
        "30",
        "{out:out1}",
      ]),
    ).toEqual([]);
    expect(
      consistencyProblems(PORTRAIT, P, [
        ...IN,
        "-vf",
        "transpose=1,scale=1080:1920,eq=brightness=0.1",
        "-af",
        "loudnorm",
        "{out:out1}",
      ]),
    ).toEqual([]);
  });
  test("unknown filters and -map give no verdict", () => {
    expect(
      consistencyProblems(PORTRAIT, P, [
        ...IN,
        "-vf",
        "zoompan=z=2",
        "-map",
        "0",
        "{out:out1}",
      ]),
    ).toEqual([]);
  });
  test("cut plan vs no cut; sound removal both ways; fps", () => {
    expect(
      consistencyProblems(spec({ time: { start_s: 1 } }), P, [
        ...IN,
        "{out:out1}",
      ]),
    ).toEqual(["The plan cuts the video, but the command keeps all of it."]);
    expect(
      consistencyProblems(spec({ time: { start_s: 1 } }), P, [
        "-ss",
        "1",
        ...IN,
        "{out:out1}",
      ]),
    ).toEqual([]);
    expect(
      consistencyProblems(spec({ audio: { present: false } }), P, [
        ...IN,
        "{out:out1}",
      ]),
    ).toHaveLength(1);
    expect(
      consistencyProblems(spec({ video: { fps: 15 } }), P, [
        ...IN,
        "-r",
        "30",
        "{out:out1}",
      ]),
    ).toHaveLength(1);
  });
  test("never throws on junk", () => {
    expect(consistencyProblems(null, null, null)).toEqual([]);
    expect(consistencyProblems(PORTRAIT, P, [1, 2])).toEqual([]);
  });
});

// Through the machine: a mismatch is not run, is fed back as an error observation, costs a turn and no run.
import { createMachine } from "../../app/agent/machine.js";
import {
  act,
  fakeExecutor,
  fakeMeasure,
  policyOf,
  probeFile,
  run as runAct,
  spec as specAct,
} from "./engine-fakes.js";

describe("machine", () => {
  test("mismatch: not executed, fed back, then the corrected command runs", async () => {
    const bad = runAct([...IN, "-vf", "scale=1080:1920", "{out:out1}"]);
    const good = runAct(OK);
    const policy = policyOf([specAct(PORTRAIT), bad, good]);
    const executor = fakeExecutor();
    const m = createMachine({
      policy,
      executor,
      measure: fakeMeasure(),
      probeFile,
    });
    await m.dispatch({ type: "capabilityChecked", ok: true });
    await m.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    await m.dispatch({
      type: "requestSubmitted",
      request: "portrait, lower volume",
    });
    await m.dispatch({ type: "confirmed" });
    const s = m.getState();
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].args).toEqual(OK);
    expect(s.runs).toBe(1); // the rejected command spent a turn, not a run
    const fed = JSON.parse(policy.calls[2].at(-1).content);
    expect(fed.error).toMatch(
      /does not match the confirmed plan: The plan changes how loud/,
    );
    expect(act).toBeTypeOf("function");
  });
});
