// Release gate: fails while placeholder or mockup-only text is still in the built site.
// Run after `pnpm build`. It is meant to fail until the owner supplies the real content.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "build/client";
const UNFINISHED = [
  "[contact address]",
  "[role line]",
  "[Confirm on the built site",
  "(Mockup",
];

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (p.endsWith(".js") || p === join(OUT, "index.html")) yield p;
  }
}

let hits = 0;
for (const f of files(OUT)) {
  const text = readFileSync(f, "utf8");
  for (const s of UNFINISHED) {
    if (text.includes(s)) {
      console.log(`${f}: ${s}`);
      hits++;
    }
  }
}
if (hits) {
  console.error(
    `check:release failed: ${hits} unfinished-content hit(s). Fill them in before publishing.`,
  );
  process.exit(1);
}
console.log("check:release passed");
