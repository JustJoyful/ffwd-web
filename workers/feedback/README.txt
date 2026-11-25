ffwd feedback Worker (opt-in "send this request text" messages)

What it is: one Cloudflare Worker (worker.js) writing to one D1 table (schema.sql). The site posts to it only after a
person presses Send. It reuses app/lib/feedback-schema.js, the same validator the page uses.

D1 or KV: D1 is SQL, so you can read, filter and count the messages with one query, and its free tier is plenty for an
early preview; KV is key-value only (no query, list-and-fetch-each to read), which makes reading feedback awkward.

Stored: id, created_at, kind, request, plan (JSON), failure, app_version, model_version. NOT stored: IP, user agent,
headers, cookies, analytics id. The Worker sets no cookies.

Abuse guard: only POST of application/json from an allowed Origin, body at most 4 KB (header and actual bytes), every
field validated against closed lists, anything else gets 4xx and nothing is written. Origin is not authentication (a
script can fake it), so for more: add a Cloudflare rate-limiting rule (dashboard > Security > WAF > Rate limiting rules)
on this Worker's route, for example 10 requests per minute per IP. That is a dashboard setting, not code, and it keeps
the IP out of the database. Do not add paid features.

Commands: see docs/launch-items.txt, item "Feedback".
