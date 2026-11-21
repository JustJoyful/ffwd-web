// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The marketing pages must not pull the engine, the workers, ffmpeg or an animation library into the home or chore
// bundle (WEB_ARCHITECTURE section 9). Only routes/app.jsx and the tool's own folders may. This scans the source for
// such imports; the build's bundle-size check (pnpm size) is the second line of defence.
const TOOL = [
  "app/routes/app.jsx",
  "app/agent/",
  "app/components/tool/",
  "app/tool/",
];
const FORBIDDEN =
  /(?:\/agent\/|\/workers\/|^@ffmpeg\/|^framer-motion$|^lucide-react$)/;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(p) : [p];
  });
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** Forbidden import specifiers in a piece of source text. */
const forbiddenImports = (code) =>
  [...code.matchAll(IMPORT)].map((m) => m[1]).filter((s) => FORBIDDEN.test(s));

test("the check itself catches the imports it is for", () => {
  for (const line of [
    'import { runJob } from "../agent/loop.js";',
    'import Worker from "../workers/ffmpeg.js";',
    'import { FFmpeg } from "@ffmpeg/ffmpeg";',
    'import { motion } from "framer-motion";',
    'import { Play } from "lucide-react";',
    'const m = await import("../agent/machine.js");',
  ])
    expect(forbiddenImports(line), line).toHaveLength(1);
  expect(
    forbiddenImports('import { chores } from "../content/chores.js";'),
  ).toEqual([]);
});

test("no marketing source file imports the engine, workers, ffmpeg, framer-motion or lucide-react", () => {
  const marketing = walk("app")
    .filter((f) => /\.(js|jsx)$/.test(f))
    .filter((f) => !TOOL.some((t) => f === t || f.startsWith(t)));
  expect(marketing.length).toBeGreaterThan(10);
  const offenders = marketing
    .map((f) => [f, forbiddenImports(readFileSync(f, "utf8"))])
    .filter(([, found]) => found.length);
  expect(offenders).toEqual([]);
});
