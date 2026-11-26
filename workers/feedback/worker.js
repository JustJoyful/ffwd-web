// ffwd opt-in feedback receiver: a Cloudflare Worker + D1. Accepts one thing: a POST of the JSON the site shows the person
// before they press Send. It validates with the SAME validateFeedback as the page, stores the fields and returns 204.
// Guards, in order: Origin allowlist (403), method and type (405/415), per-client rate limit (429), body size (413),
// strict schema (400/422), daily row cap (429). A `scheduled` handler removes rows older than RETENTION_DAYS.
// It stores no IP, user agent, headers or cookies, and sets none. Not deployed by this repo's tooling (see README.txt).
import {
  MAX_BODY_BYTES,
  validateFeedback,
} from "../../app/lib/feedback-schema.js";

const DEFAULT_DAILY_CAP = 500;
const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
/** A positive whole number from an env var (they are strings), or the default. */
const posInt = (v, d) => (Number.isInteger(+v) && +v > 0 ? +v : d);

const json = (status, extra = {}) =>
  new Response(null, { status, headers: extra });

export async function handle(request, env) {
  const allowed = String(env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get("Origin");
  if (!origin || !allowed.includes(origin)) return json(403);
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return json(204, cors);
  if (request.method !== "POST") return json(405, cors);
  if (
    !(request.headers.get("Content-Type") ?? "").startsWith("application/json")
  )
    return json(415, cors);
  // Per-client rate limit (Workers Rate Limiting binding; the account has no zone, so no WAF rules). The key is only
  // handed to Cloudflare's counter: nothing about the client is ever written to D1. No binding (local tests) = skipped.
  const client = request.headers.get("CF-Connecting-IP");
  if (
    env.LIMITER &&
    client &&
    !(await env.LIMITER.limit({ key: client })).success
  )
    return json(429, cors);
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES)
    return json(413, cors);
  // the header can lie or be absent (chunked): measure what actually arrived
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return json(413, cors);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, cors);
  }
  const v = validateFeedback(body);
  if (!v.ok) return json(422, cors);
  const p = v.value;
  // Daily cap: rows created today (UTC). Count then insert is not atomic, so a burst can overshoot by a few rows; that is
  // fine for a cost guard (the rate limit above keeps bursts small).
  const today = new Date().toISOString().slice(0, 10);
  const { n } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM feedback WHERE created_at >= ?",
  )
    .bind(today)
    .first();
  if (n >= posInt(env.DAILY_CAP, DEFAULT_DAILY_CAP)) return json(429, cors);
  await env.DB.prepare(
    "INSERT INTO feedback (id, created_at, kind, request, note, plan, failure, app_version, model_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      p.kind,
      p.request,
      p.note ?? null,
      p.plan === null ? null : JSON.stringify(p.plan),
      p.failure,
      p.app_version,
      p.model_version,
    )
    .run();
  return json(204, cors);
}

/** Daily retention: remove rows older than RETENTION_DAYS (default 90). `now` is injectable for tests. */
export async function cleanup(env, now = Date.now()) {
  const cutoff = new Date(
    now - posInt(env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS) * DAY_MS,
  ).toISOString();
  await env.DB.prepare("DELETE FROM feedback WHERE created_at < ?")
    .bind(cutoff)
    .run();
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) =>
    ctx.waitUntil(cleanup(env, event.scheduledTime)),
};
