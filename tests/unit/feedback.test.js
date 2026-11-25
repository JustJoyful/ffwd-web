import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildFeedback,
  scrubRequest,
  sendFeedback,
} from "../../app/lib/feedback.js";
import {
  MAX_REQUEST,
  reducePlan,
  validateFeedback,
} from "../../app/lib/feedback-schema.js";
import { handle } from "../../workers/feedback/worker.js";

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

describe("the Worker", () => {
  const rows = [];
  const env = {
    ALLOWED_ORIGIN: "https://ffwd.test, https://b.test",
    DB: {
      prepare: (sql) => ({
        bind: (...a) => ({ run: async () => rows.push({ sql, a }) }),
      }),
    },
  };
  const req = (
    body,
    {
      method = "POST",
      origin = "https://ffwd.test",
      type = "application/json",
      headers = {},
    } = {},
  ) =>
    new Request("https://w.test/", {
      method,
      body:
        method === "POST"
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : undefined,
      headers: {
        "Content-Type": type,
        ...(origin ? { Origin: origin } : {}),
        ...headers,
      },
    });
  afterEach(() => (rows.length = 0));

  test("a valid message: 204, one insert of the six fields, no request metadata", async () => {
    const r = await handle(req(mk()), env);
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://ffwd.test",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toHaveLength(8);
    expect(JSON.stringify(rows[0].a)).not.toMatch(/ffwd\.test|Mozilla/);
  });
  test("every invalid shape is 4xx and writes nothing", async () => {
    const p = mk();
    const cases = [
      [req(p, { origin: "https://evil.test" }), 403],
      [req(p, { origin: null }), 403],
      [req(p, { method: "GET" }), 405],
      [req(p, { type: "text/plain" }), 415],
      [req("{nope", {}), 400],
      [req({ ...p, extra: 1 }), 422],
      [req({ ...p, kind: "x" }), 422],
      [req({ ...p, request: "x".repeat(501) }), 422],
      [req({ ...p, plan: { evil: 1 } }), 422],
      [req(p, { headers: { "Content-Length": "999999" } }), 413],
      [req({ ...p, request: "x".repeat(5000) }), 413],
    ];
    for (const [r, status] of cases)
      expect((await handle(r, env)).status).toBe(status);
    expect(rows).toHaveLength(0);
  });
  test("preflight from the site origin is 204 and writes nothing", async () => {
    expect((await handle(req(null, { method: "OPTIONS" }), env)).status).toBe(
      204,
    );
    expect(rows).toHaveLength(0);
  });
});
