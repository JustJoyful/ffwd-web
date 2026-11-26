ffwd feedback Worker (opt-in "send this request" messages)

What it is: one Cloudflare Worker (worker.js) writing to one D1 table (schema.sql). The site posts to it only after a
person presses Send. It reuses app/lib/feedback-schema.js, the same validator the page uses.

D1 or KV: D1 is SQL, so you can read, filter and count the messages with one query, and its free tier is plenty for an
early preview; KV is key-value only (no query, list-and-fetch-each to read), which makes reading feedback awkward.

Stored: id, created_at, kind (failed_job | plan_wrong | result_wrong), request, note (optional, one line), plan (JSON),
failure, app_version, model_version. NOT stored: IP, user agent, headers, cookies, analytics id. The Worker sets no
cookies.

Guards, in the order the Worker applies them (each has a test with a fake D1 and a fake limiter,
tests/unit/feedback-worker.test.js):
  1. Origin allowlist (ALLOWED_ORIGIN): another or missing Origin gets 403. Origin is not authentication (a script can
     fake it), so it is only the first filter.
  2. Method and type: only POST (OPTIONS answers the CORS preflight) of application/json; else 405 / 415.
  3. Per-client rate limit: the Workers Rate Limiting binding LIMITER ([[ratelimits]] in wrangler.toml, 5 posts per 60 s).
     The key is the CF-Connecting-IP header; it is given to Cloudflare's counter only and never written to D1. Over the
     limit: 429. The account has no zone, so WAF rate-limiting rules are not available; this binding is the replacement.
     Without the binding (local tests) or without the header, this step is skipped.
  4. Size: body at most 4 KB (header and actual bytes); else 413.
  5. Strict schema (validateFeedback): exactly kind, request, plan, failure, app_version, model_version plus an optional
     note (1 to 200 characters, one line); closed lists for kind and failure; anything else 400 / 422, nothing written.
  6. Daily cap: DAILY_CAP rows per UTC day (default 500, counted from D1); at the cap 429 and nothing is stored. The
     count and the insert are two statements, so a burst may overshoot by a few rows; the rate limit keeps bursts small.
Retention: a cron trigger (wrangler.toml [triggers], "17 3 * * *" = 03:17 UTC daily) runs the `scheduled` handler, which
removes rows older than RETENTION_DAYS (default 90). The privacy page states the 90 days.

Reading: `pnpm feedback:read` in the site's root folder (see scripts/feedback-read.mjs). Always pass `-c wrangler.toml`
to wrangler commands run in this folder: the site's wrangler.jsonc is above it and would otherwise be picked up.

Commands: see docs/launch-items.txt, item "Feedback". Do not add paid features.
