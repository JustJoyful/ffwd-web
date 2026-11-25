// ffwd opt-in feedback receiver: a Cloudflare Worker + D1. Accepts one thing: a POST of the JSON the site shows the person
// before they press Send. It validates with the SAME validateFeedback as the page, stores the six fields and returns 204.
// It stores no IP, user agent, headers or cookies, and sets none. Not deployed by this repo's tooling (see README.txt).
import {
  MAX_BODY_BYTES,
  validateFeedback,
} from "../../app/lib/feedback-schema.js";

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
  await env.DB.prepare(
    "INSERT INTO feedback (id, created_at, kind, request, plan, failure, app_version, model_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      p.kind,
      p.request,
      p.plan === null ? null : JSON.stringify(p.plan),
      p.failure,
      p.app_version,
      p.model_version,
    )
    .run();
  return json(204, cors);
}

export default { fetch: (request, env) => handle(request, env) };
