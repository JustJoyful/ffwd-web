// `pnpm feedback:read`: read the opt-in feedback from the live D1 database as a table (the owner runs this, with
// `npx wrangler login` done once). It shells out to `wrangler d1 execute --remote` in workers/feedback and prints the rows.
//   pnpm feedback:read                         the last 30 days, newest first, 50 rows
//   pnpm feedback:read --days 7 --kind result_wrong --limit 20
//   pnpm feedback:read --counts                a count by kind and failure instead of the rows
// The SQL is built here from checked values only: the kind must be one of the closed list, numbers must be whole and in
// range, and the date is made by this script. Nothing typed on the command line is ever pasted into SQL as text.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KINDS } from "../app/lib/feedback-schema.js";

const DB = "ffwd-feedback";
const DAY_MS = 86_400_000;
const MAX_CELL = 70;
const FLAGS = ["--days", "--kind", "--limit", "--counts"];

const wholeNumber = (flag, v, min, max) => {
  if (!/^\d{1,5}$/.test(String(v)) || +v < min || +v > max)
    throw new Error(`${flag} must be a whole number from ${min} to ${max}`);
  return +v;
};

/** @returns {{ days: number, kind: string | null, limit: number, counts: boolean }} throws a plain Error on bad input */
export function parseArgs(argv) {
  const o = { days: 30, kind: null, limit: 50, counts: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!FLAGS.includes(a)) throw new Error(`unknown option ${a}`);
    if (a === "--counts") {
      o.counts = true;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    if (a === "--days") o.days = wholeNumber(a, v, 1, 3650);
    else if (a === "--limit") o.limit = wholeNumber(a, v, 1, 1000);
    else {
      if (!KINDS.includes(v))
        throw new Error(`--kind must be one of: ${KINDS.join(", ")}`);
      o.kind = v;
    }
  }
  return o;
}

/** A SQL string literal: quotes doubled. Only ever given values this file made or checked. */
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** The one SELECT to run. `now` is injectable for tests. */
export function buildSql(
  { days = 30, kind = null, limit = 50, counts = false } = {},
  now = Date.now(),
) {
  wholeNumber("days", days, 1, 3650);
  wholeNumber("limit", limit, 1, 1000);
  if (kind !== null && !KINDS.includes(kind))
    throw new Error(`kind must be one of: ${KINDS.join(", ")}`);
  const since = new Date(now - days * DAY_MS).toISOString();
  const where = `WHERE created_at >= ${lit(since)}${kind ? ` AND kind = ${lit(kind)}` : ""}`;
  return counts
    ? `SELECT kind, failure, COUNT(*) AS n FROM feedback ${where} GROUP BY kind, failure ORDER BY n DESC, kind, failure`
    : `SELECT created_at, kind, failure, request, note FROM feedback ${where} ORDER BY created_at DESC LIMIT ${limit}`;
}

const cell = (v) => {
  const t = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > MAX_CELL ? `${t.slice(0, MAX_CELL - 1)}…` : t;
};

/** Rows (objects) as a plain-text table with the given columns; long text is cut and newlines become spaces. */
export function formatTable(rows, columns) {
  if (!rows.length) return "No feedback in that window.";
  const body = rows.map((r) => columns.map((c) => cell(r[c])));
  const width = columns.map((c, i) =>
    Math.max(c.length, ...body.map((r) => r[i].length)),
  );
  const line = (cells) =>
    cells
      .map((t, i) => t.padEnd(width[i]))
      .join("  ")
      .trimEnd();
  return [
    line(columns),
    line(width.map((w) => "-".repeat(w))),
    ...body.map(line),
  ].join("\n");
}

/** wrangler's `--json` output ([{ results: [...] }]) to the rows. */
export function rowsOf(output) {
  const start = output.indexOf("[");
  const parsed = JSON.parse(start < 0 ? output : output.slice(start));
  return parsed?.[0]?.results ?? [];
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(
      `${e.message}\nusage: pnpm feedback:read [--days N] [--kind K] [--limit N] [--counts]`,
    );
    process.exit(2);
  }
  const sql = buildSql(opts);
  // -c wrangler.toml: the site's own wrangler.jsonc sits above this folder and would otherwise be picked up
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--json",
      "-c",
      "wrangler.toml",
      "--command",
      sql,
    ],
    {
      cwd: resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../workers/feedback",
      ),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  console.log(
    formatTable(
      rowsOf(out),
      opts.counts
        ? ["kind", "failure", "n"]
        : ["created_at", "kind", "failure", "request", "note"],
    ),
  );
}

if (process.argv[1]?.endsWith("feedback-read.mjs")) main();
