// scripts/feedback-read.mjs (`pnpm feedback:read`): the argument checks, the SQL builder and the table formatter, with
// fixture JSON. The script's main() (which would call wrangler on the network) is never run here: importing the module
// does not run it.
import { describe, expect, test } from "vitest";
import {
  buildSql,
  formatTable,
  parseArgs,
  rowsOf,
} from "../../scripts/feedback-read.mjs";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

describe("parseArgs", () => {
  test("defaults, and every option", () => {
    expect(parseArgs([])).toEqual({
      days: 30,
      kind: null,
      limit: 50,
      counts: false,
    });
    expect(
      parseArgs([
        "--days",
        "7",
        "--kind",
        "result_wrong",
        "--limit",
        "5",
        "--counts",
      ]),
    ).toEqual({ days: 7, kind: "result_wrong", limit: 5, counts: true });
  });
  test("rejects unknown options, missing values, kinds off the list and numbers that are not whole and in range", () => {
    for (const bad of [
      ["--drop"],
      ["--days"],
      ["--days", "0"],
      ["--days", "1.5"],
      ["--days", "-3"],
      ["--days", "7; DROP TABLE feedback"],
      ["--days", "99999999"],
      ["--limit", "1001"],
      ["--limit", "ten"],
      ["--kind", "other"],
      ["--kind", "failed_job' OR '1'='1"],
      ["--kind"],
      ["extra"],
    ])
      expect(() => parseArgs(bad), bad.join(" ")).toThrow();
  });
});

describe("buildSql", () => {
  test("rows: a UTC cutoff made here, newest first, a limit", () => {
    expect(buildSql({ days: 30, limit: 50 }, NOW)).toBe(
      "SELECT created_at, kind, failure, request, note FROM feedback WHERE created_at >= '2026-10-27T12:00:00.000Z' ORDER BY created_at DESC LIMIT 50",
    );
  });
  test("a kind filter uses a value from the closed list only", () => {
    expect(buildSql({ kind: "plan_wrong", days: 1, limit: 3 }, NOW)).toContain(
      "AND kind = 'plan_wrong' ORDER BY",
    );
    expect(() => buildSql({ kind: "x'; --" }, NOW)).toThrow(/kind/);
  });
  test("counts: grouped by kind and failure, no row limit", () => {
    const q = buildSql({ counts: true, days: 7 }, NOW);
    expect(q).toMatch(
      /^SELECT kind, failure, COUNT\(\*\) AS n FROM feedback WHERE created_at >= '2026-11-19T12:00:00.000Z' GROUP BY kind, failure/,
    );
    expect(q).not.toMatch(/LIMIT/);
  });
  test("numbers must be whole and in range, even when called directly", () => {
    for (const o of [
      { days: "7 OR 1=1" },
      { days: 0 },
      { days: 2.5 },
      { limit: "9; --" },
      { limit: 100000 },
    ])
      expect(() => buildSql(o, NOW)).toThrow();
  });
});

describe("rowsOf and formatTable", () => {
  const out = `[{"results":[
    {"created_at":"2026-11-26T08:30:00.000Z","kind":"failed_job","failure":"run_failed","request":"trim {file}\\nto 10 s","note":null},
    {"created_at":"2026-11-25T08:30:00.000Z","kind":"result_wrong","failure":"other","request":"${"x".repeat(100)}","note":"I wanted the end"}
  ],"success":true,"meta":{}}]`;
  test("reads wrangler's --json output, even with a line of noise before it", () => {
    expect(rowsOf(out)).toHaveLength(2);
    expect(rowsOf(`wrangler says hi\n${out}`)).toHaveLength(2);
    expect(rowsOf("[]")).toEqual([]);
  });
  test("a table: header, rule, one line per row, long text cut, newlines flattened, null empty", () => {
    const cols = ["created_at", "kind", "failure", "request", "note"];
    const lines = formatTable(rowsOf(out), cols).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0].split(/\s{2,}/)).toEqual(cols);
    expect(lines[1]).toMatch(/^-+ +-+/);
    expect(lines[2]).toContain("trim {file} to 10 s");
    expect(lines[3]).toContain("x".repeat(69) + "…");
    expect(lines[3]).toContain("I wanted the end");
    expect(lines.every((l) => l === l.trimEnd())).toBe(true);
  });
  test("counts and an empty window", () => {
    expect(
      formatTable(
        [{ kind: "failed_job", failure: "run_failed", n: 4 }],
        ["kind", "failure", "n"],
      ),
    ).toBe(
      "kind        failure     n\n----------  ----------  -\nfailed_job  run_failed  4",
    );
    expect(formatTable([], ["kind"])).toBe("No feedback in that window.");
  });
});
