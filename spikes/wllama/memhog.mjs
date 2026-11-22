// Test helper for the memory-cap proof (tests/browser-gguf/memcap.test.js). Launches the spike's Chromium through the
// REAL launch() path, then makes the page allocate and touch 64 MB chunks without limit. Run it under a cap, for example
//   systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 node spikes/wllama/memhog.mjs
// The last stdout line is one JSON object. Contained means: the page died (or the browser did) well before the target,
// the kernel OOM-killed something inside the cap's cgroup, and the system never lost anywhere near the target.
import { readFileSync, rmSync } from "node:fs";
import { assertContained, launch } from "./run.mjs";
import { startServer } from "./server.mjs";

const TARGET_MB = Number(process.argv[2] ?? 4096);
const profile = process.argv[3] ?? "/tmp/ffwd-memhog-profile";
const avail = () =>
  Number(
    readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s*(\d+)/)[1],
  ) / 1024;

rmSync(profile, { recursive: true, force: true });
const server = await startServer({ port: 4411 });
const b = await launch({ mode: "cpu", port: 4411 }, profile);
const cap = assertContained({ minCapBytes: 1 });
const baseline = avail();
let minAvail = baseline;
const watch = setInterval(() => (minAvail = Math.min(minAvail, avail())), 100);
let lastMb = 0;
b.page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("mb ")) lastMb = Number(t.slice(3));
});
let crashed = false;
try {
  await b.page.evaluate(async (target) => {
    const keep = [];
    for (let mb = 64; mb <= target; mb += 64) {
      const a = new Uint8Array(64 << 20);
      a.fill(7); // touch every page, or the kernel never backs it
      keep.push(a);
      console.log(`mb ${mb}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }, TARGET_MB);
} catch {
  crashed = true; // "Target crashed" / browser closed: the expected outcome under a cap
}
clearInterval(watch);
const read = (n) =>
  readFileSync(`/sys/fs/cgroup${cap.cgroup}/${n}`, "utf8").trim();
const events = Object.fromEntries(
  read("memory.events")
    .split("\n")
    .map((l) => l.split(" ")),
);
console.log(
  JSON.stringify({
    target_mb: TARGET_MB,
    cap_bytes: cap.memory_max,
    allocated_mb: lastMb,
    crashed,
    cgroup_peak_mib: Math.round(Number(read("memory.peak")) / 1048576),
    oom_kill: Number(events.oom_kill),
    baseline_available_mb: Math.round(baseline),
    min_available_mb: Math.round(minAvail),
  }),
);
await b.ctx.close().catch(() => {});
server.close();
rmSync(profile, { recursive: true, force: true });
process.exit(0);
