import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildFeedback,
  scrubRequest,
  sendFeedback,
} from "../../app/lib/feedback.js";
import {
  KINDS,
  MAX_NOTE,
  MAX_REQUEST,
  reducePlan,
  validateFeedback,
} from "../../app/lib/feedback-schema.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const KEYS = [
  "app_version",
  "failure",
  "kind",
  "model_version",
  "plan",
  "request",
];
const WITH_NOTE = [...KEYS, "note"].sort();
const SPEC = {
  family: ["F1"],
  outputs: [
    {
      id: "my_holiday",
      kind: "video",
      container: "mp4",
      video: { codec: "h264", width: 1280, secret: "x", pix_fmt: "C:\\me\\a" },
      time: { start_s: 1, end_s: null },
      note: "holiday-2026",
    },
  ],
};
const mk = (o = {}) =>
  buildFeedback({
    requestText: "trim it",
    spec: SPEC,
    failureCategory: "run_failed",
    kind: "failed_job",
    fileName: "a.mp4",
    ...o,
  });

describe("buildFeedback", () => {
  test("has exactly the allowed keys and validates", () => {
    const p = mk();
    expect(Object.keys(p).sort()).toEqual(KEYS);
    expect(validateFeedback(p).ok).toBe(true);
  });
  test("kind result_wrong is accepted; the kinds are a closed list of three", () => {
    expect(KINDS).toEqual(["failed_job", "plan_wrong", "result_wrong"]);
    expect(validateFeedback(mk({ kind: "result_wrong" })).ok).toBe(true);
  });
  test("an optional note: exact key order, scrubbed like the request, one line, 200 characters", () => {
    expect(Object.keys(mk({ note: "" }))).not.toContain("note");
    expect(Object.keys(mk({ note: " \n\t " }))).not.toContain("note");
    const p = mk({
      note: "  keep a.mp4\nsound at /home/me/x and https://e.com/q\u0007  ",
    });
    expect(p.note).toBe("keep {file} sound at {path} and {path}");
    expect(Object.keys(p)).toEqual([
      "kind",
      "request",
      "note",
      "plan",
      "failure",
      "app_version",
      "model_version",
    ]);
    expect(Object.keys(p).sort()).toEqual(WITH_NOTE);
    expect(validateFeedback(p).ok).toBe(true);
    expect(mk({ note: "w ".repeat(300) }).note.length).toBeLessThanOrEqual(
      MAX_NOTE,
    );
  });
  test("validateFeedback bounds the note and still rejects every unknown key", () => {
    const p = mk({ note: "ok" });
    expect(validateFeedback({ ...p, note: "x".repeat(MAX_NOTE) }).ok).toBe(
      true,
    );
    for (const bad of [
      "x".repeat(MAX_NOTE + 1),
      "",
      5,
      null,
      "a\nb",
      "a\u0000",
    ])
      expect(validateFeedback({ ...p, note: bad }).ok).toBe(false);
    expect(validateFeedback({ ...p, notes: "x" }).ok).toBe(false);
    expect(validateFeedback({ ...p, extra: 1 }).ok).toBe(false);
  });
  test("scrubs the file name and stem: case, inside longer words, with extension", () => {
    const f = "Holiday Clip.MP4";
    expect(scrubRequest("trim holiday clip.mp4 and HOLIDAY CLIP", f)).toBe(
      "trim {file} and {file}",
    );
    expect(
      scrubRequest(
        "cut myHolidayClip2 now",
        f.replace("Holiday Clip", "HolidayClip"),
      ),
    ).toBe("cut my{file}2 now");
    expect(scrubRequest("use beach.mov too", "x.mp4")).toBe("use {file} too");
  });
  test("a very short stem is replaced only as a whole word", () => {
    expect(scrubRequest("a cat at a time", "a.mp4")).toBe(
      "{file} cat at {file} time",
    );
  });
  test("path-like and URL-like tokens become {path}", () => {
    expect(
      scrubRequest(
        "see /home/me/x and C:\\Users\\me and ~/v https://e.com/a?b=1 www.e.com/x",
        "",
      ),
    ).toBe("see {path} and {path} and {path} {path} {path}");
  });
  test("trimmed and capped at 500", () => {
    expect(
      mk({ requestText: "  " + "w ".repeat(600) }).request.length,
    ).toBeLessThanOrEqual(MAX_REQUEST);
  });
  test("failure and kind come from closed lists", () => {
    expect(mk({ failureCategory: "ffmpeg said /tmp/x" }).failure).toBe("other");
    expect(validateFeedback({ ...mk(), kind: "other" }).ok).toBe(false);
  });
  test("the plan keeps allowlisted fields only: no id, unknown keys, odd strings or nulls", () => {
    expect(mk().plan).toEqual({
      family: ["F1"],
      outputs: [
        {
          kind: "video",
          container: "mp4",
          video: { codec: "h264", width: 1280 },
          time: { start_s: 1 },
        },
      ],
    });
    expect(JSON.stringify(mk())).not.toMatch(/holiday|secret|Users/);
    expect(reducePlan(null)).toBeNull();
    expect(mk({ spec: undefined }).plan).toBeNull();
  });
  test("model_version only when it looks like a release name", () => {
    expect(mk({ modelVersion: "ffwd-0.6b-1.0.0" }).model_version).toBe(
      "ffwd-0.6b-1.0.0",
    );
    expect(mk({ modelVersion: "my gpu" }).model_version).toBe("unknown");
  });
});

describe("validateFeedback", () => {
  test("rejects extra, missing and mistyped fields and plans that are not already reduced", () => {
    const p = mk();
    expect(validateFeedback({ ...p, extra: 1 }).ok).toBe(false);
    const noKind = { ...p };
    delete noKind.kind;
    expect(validateFeedback(noKind).ok).toBe(false);
    expect(validateFeedback({ ...p, request: "" }).ok).toBe(false);
    expect(validateFeedback({ ...p, request: "x".repeat(501) }).ok).toBe(false);
    expect(validateFeedback({ ...p, app_version: "1.0" }).ok).toBe(false);
    expect(
      validateFeedback({
        ...p,
        plan: { family: ["F1"], outputs: [{ kind: "video", id: "x" }] },
      }).ok,
    ).toBe(false);
    expect(validateFeedback([]).ok).toBe(false);
    expect(validateFeedback(null).ok).toBe(false);
  });
});

describe("sendFeedback", () => {
  test("off without a URL: no request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_FEEDBACK_URL", "");
    expect(await sendFeedback(mk())).toEqual({ ok: false, off: true });
    vi.stubEnv("VITE_FEEDBACK_URL", "http://insecure.test/x");
    expect((await sendFeedback(mk())).off).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  test("posts the payload with no credentials and no referrer", async () => {
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_FEEDBACK_URL", "https://fb.test/in");
    const p = mk();
    expect((await sendFeedback(p)).ok).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://fb.test/in");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(init.body)).toEqual(p);
  });
  test("a network error is a plain failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("x");
      }),
    );
    vi.stubEnv("VITE_FEEDBACK_URL", "https://fb.test/in");
    expect((await sendFeedback(mk())).ok).toBe(false);
  });
});
