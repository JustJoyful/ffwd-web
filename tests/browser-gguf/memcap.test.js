// Proof that the memory cap for browser runs is real (D-051). Chromium used to move itself into its own systemd scope
// and escape any MemoryMax set on the launcher; spikes/wllama/run.mjs now strips the user-bus variables and refuses to
// run uncapped or with a stray process. This test makes the page allocate 4 GB under a 1.5 GB cap and checks that the
// browser is contained: the page dies, the kernel kills inside the cap's cgroup, and the system keeps its memory.
// Opt-in (needs Chromium, a systemd user session and about 1.5 GB of RAM):  FFWD_MEMCAP=1 pnpm test:browser-gguf
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

describe.skipIf(!process.env.FFWD_MEMCAP)("the browser memory cap", () => {
  test("allocating past the cap is contained", () => {
    const out = execFileSync(
      "systemd-run",
      [
        "--user",
        "--scope",
        "-q",
        "-p",
        "MemoryMax=1500M",
        "-p",
        "MemorySwapMax=0",
        "node",
        "spikes/wllama/memhog.mjs",
        "4096",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    const r = JSON.parse(out.trim().split("\n").at(-1));
    expect(r.crashed).toBe(true);
    expect(r.allocated_mb).toBeLessThan(1500); // died before even reaching the cap's size
    expect(r.cgroup_peak_mib).toBeLessThanOrEqual(1500);
    expect(r.oom_kill).toBeGreaterThanOrEqual(1);
    // the system never lost more than the cap plus a margin, though 4096 MB was requested
    expect(r.baseline_available_mb - r.min_available_mb).toBeLessThan(2200);
  }, 150_000);

  test("a run without a memory cap is refused", () => {
    expect(() =>
      execFileSync("node", ["spikes/wllama/memhog.mjs", "256"], {
        encoding: "utf8",
        timeout: 60_000,
        stdio: "pipe",
      }),
    ).toThrow(/no memory cap/);
  }, 90_000);
});
