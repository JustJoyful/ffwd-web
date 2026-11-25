-- One row per message the person chose to send. No IP, user agent, cookie or analytics id is ever written.
CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,   -- ISO 8601, UTC
  kind          TEXT NOT NULL,   -- failed_job | plan_wrong
  request       TEXT NOT NULL,   -- typed text, file name already replaced by {file}
  plan          TEXT,            -- JSON (allowlisted spec fields) or NULL
  failure       TEXT NOT NULL,   -- closed list, see app/lib/feedback-schema.js
  app_version   TEXT NOT NULL,
  model_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at);
