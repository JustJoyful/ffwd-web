// Copies the ffwd repo's packages/protocol into protocol/ and rewrites protocol/PIN.json.
//   node scripts/sync-protocol.mjs --from ../ffmpeg-agent           copy + pin
//   node scripts/sync-protocol.mjs --from ../ffmpeg-agent --check   drift alarm: exit 1 if the pin would change
// The source repo is only ever READ (git status / ls-files / show). It is refused when protocol/ itself has
// uncommitted changes; other dirty files in that repo (a long evaluation job writes there) are unrelated.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(here, "..");
const DEST = join(SITE, "protocol");
const SRC_SUB = "packages/protocol";
// Written by this script, not part of the snapshot, so a sync does not delete them.
const OWN_FILES = ["PIN.json", "test-real-ids.json"];

const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
if (fromIdx < 0 || !args[fromIdx + 1]) {
  console.error(
    "usage: sync-protocol.mjs --from <path to the ffwd repo> [--check]",
  );
  process.exit(2);
}
const from = resolve(process.cwd(), args[fromIdx + 1]);
const check = args.includes("--check");

const git = (...a) =>
  execFileSync("git", ["-C", from, ...a], { encoding: "utf8" });

const dirty = git("status", "--porcelain", "--", SRC_SUB).trim();
if (dirty) {
  console.error(
    `refusing: ${SRC_SUB} has uncommitted changes in ${from}:\n${dirty}`,
  );
  process.exit(1);
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const rels = git("ls-files", "--", SRC_SUB)
  .split("\n")
  .filter(Boolean)
  .map((p) => p.slice(SRC_SUB.length + 1))
  .sort();
const contents = Object.fromEntries(
  rels.map((r) => [r, readFileSync(join(from, SRC_SUB, r))]),
);
const files = Object.fromEntries(rels.map((r) => [r, sha(contents[r])]));
// The version is in every schema's $id (".../protocol/v0.3.0/action").
const version = /\/v(\d+\.\d+\.\d+)\//.exec(
  JSON.parse(contents["schemas/action.schema.json"]).$id,
)?.[1];
if (!version)
  throw new Error("cannot read protocol_version from action.schema.json $id");

if (check) {
  const pin = JSON.parse(readFileSync(join(DEST, "PIN.json"), "utf8"));
  // source_commit is ignored on purpose: it moves with every commit in the source repo.
  const same =
    pin.protocol_version === version &&
    JSON.stringify(pin.files) === JSON.stringify(files);
  if (!same) {
    console.error(
      "protocol drift: the source protocol differs from protocol/PIN.json",
    );
    process.exit(1);
  }
  console.log("protocol in sync");
  process.exit(0);
}

for (const r of rels) rmSync(join(DEST, r), { force: true });
for (const r of rels) {
  mkdirSync(dirname(join(DEST, r)), { recursive: true });
  writeFileSync(join(DEST, r), contents[r]);
}
const pin = {
  protocol_version: version,
  source_commit: git("rev-parse", "HEAD").trim(),
  files,
};
writeFileSync(join(DEST, "PIN.json"), JSON.stringify(pin, null, 2) + "\n");

// Clips held out for the real-media test split (D-027b). Ids only, never the clips. Read from the committed manifest.
const manifest = JSON.parse(git("show", "HEAD:data/corpus/manifest.json"));
const ids = manifest.filter((c) => c.role === "test-real").map((c) => c.id);
writeFileSync(join(DEST, OWN_FILES[1]), JSON.stringify(ids, null, 2) + "\n");
console.log(
  `synced protocol ${version} @ ${pin.source_commit.slice(0, 9)} (${rels.length} files)`,
);
