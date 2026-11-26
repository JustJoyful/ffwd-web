// The feedback Worker with a fake D1 and a fake rate limiter: every guard is tested on its own, and each rejection must
// write nothing. The fake D1 understands only the three statements the Worker uses (count today, insert, retention).
import { describe, expect, test } from "vitest";
import { buildFeedback } from "../../app/lib/feedback.js";
import worker, { cleanup, handle } from "../../workers/feedback/worker.js";

const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

function fakeDb(rows = []) {
  return {
    rows,
    prepare: (sql) => ({
      bind: (...a) => ({
        run: async () => {
          if (sql.startsWith("INSERT"))
            rows.push({
              id: a[0],
              created_at: a[1],
              kind: a[2],
              request: a[3],
              note: a[4],
              plan: a[5],
              failure: a[6],
              app_version: a[7],
              model_version: a[8],
            });
          else if (sql.startsWith("DELETE"))
            rows.splice(
              0,
              rows.length,
              ...rows.filter((r) => r.created_at >= a[0]),
            );
          else throw new Error(`unexpected statement: ${sql}`);
        },
        first: async () => {
          if (!sql.startsWith("SELECT COUNT"))
            throw new Error(`unexpected query: ${sql}`);
          return { n: rows.filter((r) => r.created_at >= a[0]).length };
        },
      }),
    }),
  };
}
/** Allows `max` calls per key, then says success: false, like Cloudflare's binding inside one period. */
function fakeLimiter(max) {
  const seen = {};
  return {
    keys: [],
    limit: async function ({ key }) {
      this.keys.push(key);
      seen[key] = (seen[key] ?? 0) + 1;
      return { success: seen[key] <= max };
    },
  };
}
const mkEnv = (extra = {}) => ({
  ALLOWED_ORIGIN: "https://ffwd.test, https://b.test",
  DB: fakeDb(),
  ...extra,
});
const mk = (o = {}) =>
  buildFeedback({
    requestText: "trim it",
    spec: null,
    failureCategory: "run_failed",
    kind: "failed_job",
    fileName: "a.mp4",
    ...o,
  });
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

describe("a valid message", () => {
  test("204, one insert of the nine columns, nothing about the client", async () => {
    const env = mkEnv();
    const r = await handle(
      req(mk(), {
        headers: { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "Mozilla" },
      }),
      env,
    );
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://ffwd.test",
    );
    expect(env.DB.rows).toHaveLength(1);
    expect(Object.keys(env.DB.rows[0])).toHaveLength(9);
    expect(env.DB.rows[0].note).toBeNull();
    expect(JSON.stringify(env.DB.rows)).not.toMatch(
      /ffwd\.test|Mozilla|203\.0/,
    );
  });
  test("a note and the result_wrong kind are stored", async () => {
    const env = mkEnv();
    const p = mk({ kind: "result_wrong", note: "I wanted the end" });
    expect((await handle(req(p), env)).status).toBe(204);
    expect(env.DB.rows[0]).toMatchObject({
      kind: "result_wrong",
      note: "I wanted the end",
    });
  });
  test("preflight from the site origin is 204 and writes nothing", async () => {
    const env = mkEnv();
    expect((await handle(req(null, { method: "OPTIONS" }), env)).status).toBe(
      204,
    );
    expect(env.DB.rows).toHaveLength(0);
  });
});

describe("origin allowlist", () => {
  test("another origin, or none, is 403 and writes nothing", async () => {
    const env = mkEnv();
    const p = mk();
    expect(
      (await handle(req(p, { origin: "https://evil.test" }), env)).status,
    ).toBe(403);
    expect((await handle(req(p, { origin: null }), env)).status).toBe(403);
    expect(env.DB.rows).toHaveLength(0);
    expect(
      (await handle(req(p, { origin: "https://b.test" }), env)).status,
    ).toBe(204);
  });
});

describe("payload size limit", () => {
  test("a big Content-Length, or a big body behind a small header, is 413 and writes nothing", async () => {
    const env = mkEnv();
    const p = mk();
    expect(
      (await handle(req(p, { headers: { "Content-Length": "999999" } }), env))
        .status,
    ).toBe(413);
    expect(
      (await handle(req({ ...p, request: "x".repeat(5000) }), env)).status,
    ).toBe(413);
    expect(env.DB.rows).toHaveLength(0);
  });
});

describe("strict schema validation", () => {
  test("every invalid shape is 4xx and writes nothing", async () => {
    const env = mkEnv();
    const p = mk({ note: "ok" });
    const cases = [
      [req(p, { method: "GET" }), 405],
      [req(p, { type: "text/plain" }), 415],
      [req("{nope", {}), 400],
      [req({ ...p, extra: 1 }), 422],
      [req({ ...p, kind: "x" }), 422],
      [req({ ...p, failure: "x" }), 422],
      [req({ ...p, request: "x".repeat(501) }), 422],
      [req({ ...p, plan: { evil: 1 } }), 422],
      [req({ ...p, note: "x".repeat(201) }), 422],
      [req({ ...p, note: "" }), 422],
      [req({ ...p, note: 7 }), 422],
      [req({ ...p, note: "two\nlines" }), 422],
      [req({ ...p, notes: "typo" }), 422],
      [req([]), 422],
      [req(null), 422],
    ];
    for (const [r, status] of cases)
      expect((await handle(r, env)).status).toBe(status);
    expect(env.DB.rows).toHaveLength(0);
  });
});

describe("daily row cap", () => {
  test("at DAILY_CAP the answer is 429 and nothing is inserted; earlier days do not count", async () => {
    const env = mkEnv({ DAILY_CAP: "2" });
    env.DB.rows.push(
      { created_at: iso(2 * DAY) },
      { created_at: iso(3 * DAY) },
    );
    expect((await handle(req(mk()), env)).status).toBe(204);
    expect((await handle(req(mk()), env)).status).toBe(204);
    expect(env.DB.rows).toHaveLength(4);
    expect((await handle(req(mk()), env)).status).toBe(429);
    expect(env.DB.rows).toHaveLength(4);
  });
  test("the default cap is 500 (also when the variable is missing or not a positive number)", async () => {
    for (const DAILY_CAP of [undefined, "abc", "0"]) {
      const env = mkEnv({ DAILY_CAP });
      env.DB.rows.push(
        ...Array.from({ length: 499 }, () => ({ created_at: iso(0) })),
      );
      expect((await handle(req(mk()), env)).status).toBe(204);
      expect((await handle(req(mk()), env)).status).toBe(429);
      expect(env.DB.rows).toHaveLength(500);
    }
  });
  test("an invalid message at the cap is still its own 4xx", async () => {
    const env = mkEnv({ DAILY_CAP: "1" });
    await handle(req(mk()), env);
    expect((await handle(req({ nope: 1 }), env)).status).toBe(422);
  });
});

describe("per-client rate limit", () => {
  test("the key is CF-Connecting-IP; past the limit the answer is 429 and nothing is inserted", async () => {
    const LIMITER = fakeLimiter(2);
    const env = mkEnv({ LIMITER });
    const post = (ip) =>
      handle(req(mk(), { headers: { "CF-Connecting-IP": ip } }), env);
    expect((await post("198.51.100.1")).status).toBe(204);
    expect((await post("198.51.100.1")).status).toBe(204);
    expect((await post("198.51.100.1")).status).toBe(429);
    expect(env.DB.rows).toHaveLength(2);
    expect((await post("198.51.100.2")).status).toBe(204); // another client is not affected
    expect(LIMITER.keys).toEqual([
      "198.51.100.1",
      "198.51.100.1",
      "198.51.100.1",
      "198.51.100.2",
    ]);
    expect(JSON.stringify(env.DB.rows)).not.toMatch(/198\.51/); // the IP is never stored
  });
  test("an invalid post counts against the limit too (abuse is what it is for)", async () => {
    const env = mkEnv({ LIMITER: fakeLimiter(1) });
    const h = { "CF-Connecting-IP": "198.51.100.9" };
    expect((await handle(req({ nope: 1 }, { headers: h }), env)).status).toBe(
      422,
    );
    expect((await handle(req(mk(), { headers: h }), env)).status).toBe(429);
    expect(env.DB.rows).toHaveLength(0);
  });
  test("a preflight is not counted; no binding or no header skips the limit", async () => {
    const LIMITER = fakeLimiter(0);
    const h = { "CF-Connecting-IP": "198.51.100.3" };
    expect(
      (
        await handle(
          req(null, { method: "OPTIONS", headers: h }),
          mkEnv({ LIMITER }),
        )
      ).status,
    ).toBe(204);
    expect((await handle(req(mk()), mkEnv({ LIMITER }))).status).toBe(204); // no header (local)
    expect((await handle(req(mk(), { headers: h }), mkEnv())).status).toBe(204); // no binding (local)
    expect(LIMITER.keys).toEqual([]);
  });
});

describe("daily retention", () => {
  test("cleanup removes rows older than 90 days by default and keeps the rest", async () => {
    const env = mkEnv();
    env.DB.rows.push(
      { id: "old", created_at: iso(91 * DAY) },
      { id: "edge", created_at: iso(89 * DAY) },
      { id: "new", created_at: iso(0) },
    );
    await cleanup(env);
    expect(env.DB.rows.map((r) => r.id)).toEqual(["edge", "new"]);
  });
  test("RETENTION_DAYS is honoured; a bad value falls back to 90", async () => {
    const env = mkEnv({ RETENTION_DAYS: "7" });
    env.DB.rows.push(
      { id: "a", created_at: iso(8 * DAY) },
      { id: "b", created_at: iso(6 * DAY) },
    );
    await cleanup(env);
    expect(env.DB.rows.map((r) => r.id)).toEqual(["b"]);
    const env2 = mkEnv({ RETENTION_DAYS: "soon" });
    env2.DB.rows.push({ id: "a", created_at: iso(80 * DAY) });
    await cleanup(env2);
    expect(env2.DB.rows).toHaveLength(1);
  });
  test("the scheduled handler runs the cleanup (waitUntil) at the scheduled time", async () => {
    const env = mkEnv();
    const t = Date.UTC(2026, 10, 26, 3, 17);
    env.DB.rows.push(
      { id: "old", created_at: new Date(t - 91 * DAY).toISOString() },
      { id: "new", created_at: new Date(t - 89 * DAY).toISOString() },
    );
    const waits = [];
    worker.scheduled({ scheduledTime: t }, env, {
      waitUntil: (p) => waits.push(p),
    });
    expect(waits).toHaveLength(1);
    await waits[0];
    expect(env.DB.rows.map((r) => r.id)).toEqual(["new"]);
  });
});
