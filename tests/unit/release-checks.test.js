// The release gate (scripts/release-checks.mjs): each thing that would make the published site not work fails it,
// by name. Fixtures are small folders made here (a sparse file stands in for a 26 MiB one).
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  CORE_FILES,
  PAGES_FILE_LIMIT,
  releaseProblems,
} from "../../scripts/release-checks.mjs";

const dirs = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

/** A build folder that passes every check, then `edit(dir)` to break one thing. */
function build(edit = () => {}) {
  mkdirSync("scratch", { recursive: true });
  const dir = mkdtempSync(join("scratch", "rc-"));
  dirs.push(dir);
  mkdirSync(join(dir, "ffmpeg"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (const f of CORE_FILES) writeFileSync(join(dir, f), "x");
  writeFileSync(join(dir, "index.html"), "<html>fine</html>");
  writeFileSync(join(dir, "assets", "a.js"), "console.log(1)");
  edit(dir);
  return dir;
}
const GOOD = {
  modelUrl: "https://huggingface.co/x/y/resolve/main/m.gguf",
  scripted: false,
  posthogKey: false,
};
const check = (dir, info = GOOD, extra = {}) =>
  releaseProblems({ out: dir, info, ...extra });

describe("releaseProblems", () => {
  test("a build with everything in place passes", () => {
    expect(check(build())).toEqual([]);
  });
  test("no model URL, a non-https URL and a local URL each fail", () => {
    const dir = build();
    expect(check(dir, { ...GOOD, modelUrl: null }).join("\n")).toMatch(
      /VITE_MODEL_URL was not set/,
    );
    expect(
      check(dir, { ...GOOD, modelUrl: "http://example.org/m.gguf" }).join("\n"),
    ).toMatch(/must be an https URL/);
    expect(check(dir, { ...GOOD, modelUrl: "not a url" }).join("\n")).toMatch(
      /must be an https URL/,
    );
    expect(
      check(dir, { ...GOOD, modelUrl: "https://localhost:8080/m.gguf" }).join(
        "\n",
      ),
    ).toMatch(/points at this machine/);
    expect(
      check(dir, { ...GOOD, modelUrl: "https://127.0.0.1/m.gguf" }).join("\n"),
    ).toMatch(/points at this machine/);
  });
  test("a scripted (stub model) build fails", () => {
    expect(check(build(), { ...GOOD, scripted: true }).join("\n")).toMatch(
      /scripted build/,
    );
  });
  test("a PostHog key fails unless switching analytics on was decided, in the build facts and in the output", () => {
    expect(check(build(), { ...GOOD, posthogKey: true }).join("\n")).toMatch(
      /analytics is meant to be off/,
    );
    expect(
      check(build(), { ...GOOD, posthogKey: true }, { allowAnalytics: true }),
    ).toEqual([]);
    const dir = build((d) =>
      writeFileSync(
        join(d, "assets", "k.js"),
        'init("phc_abcdefghijklmnopqrstuvwxyz0123")',
      ),
    );
    expect(check(dir).join("\n")).toMatch(
      /assets\/k\.js holds a PostHog project key/,
    );
  });
  test("a missing ffmpeg core file fails and names the file", () => {
    const dir = build((d) => rmSync(join(d, "ffmpeg", "ffmpeg-core.wasm")));
    expect(check(dir).join("\n")).toMatch(
      /ffmpeg\/ffmpeg-core\.wasm is missing/,
    );
  });
  test("a file over 25 MiB fails and is named; exactly 25 MiB does not", () => {
    const big = build((d) =>
      truncateSync(join(d, "ffmpeg", "ffmpeg-core.wasm"), PAGES_FILE_LIMIT + 1),
    );
    const msg = check(big).join("\n");
    expect(msg).toMatch(
      /ffmpeg\/ffmpeg-core\.wasm is 25\.0 MiB, over the 25 MiB limit/,
    );
    const ok = build((d) =>
      truncateSync(join(d, "ffmpeg", "ffmpeg-core.wasm"), PAGES_FILE_LIMIT),
    );
    expect(check(ok)).toEqual([]);
  });
  test("missing build info is a problem of its own", () => {
    expect(check(build(), null).join("\n")).toMatch(
      /build-info\.json is missing/,
    );
  });
  test("placeholder text is still caught", () => {
    const dir = build((d) =>
      writeFileSync(join(d, "index.html"), "write to [contact address]"),
    );
    expect(check(dir).join("\n")).toMatch(
      /index\.html: unfinished content \[contact address\]/,
    );
  });
});
