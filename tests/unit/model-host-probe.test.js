// The first-visit path choice in the worker host (app/model/model-host.js, init with probe) against FAKE engines:
// canary pass and fail, the benchmark pick, one engine alive at a time with the loser freed, and exit mid-check.
import { describe, expect, test } from "vitest";
import reference from "../../app/model/canary-reference.json";
import { createModelHost } from "../../app/model/model-host.js";
import { validateWorkerMessage } from "../../app/model/contract.js";
import { MODEL } from "../../app/model/config.js";

const URL_ = "http://localhost/m.gguf";
const INIT = {
  type: "init",
  modelUrl: URL_,
  sha256: MODEL.sha256,
  bytes: 40,
  nCtx: 100,
  path: "webgpu",
  kvCache: "q8_0",
  threads: 3,
  probe: true,
};
const GOOD = reference.tokens;
const GARBAGE = [1, 2, 3];
// timings per path: [prompt tok/s, generation tok/s]
const SPEED = { webgpu: [500, 60], cpu: [58, 36] };

/**
 * Engines that know which path they were loaded for and record every step in `log` in order. `webgpu: "good" | "garbage"
 * | "throws"` is what the graphics engine does with the canary prompt. `live` counts engines that were created and not
 * yet exited: a correct host never lets it pass 1.
 */
function make({ webgpu = "good", speed = SPEED, onCompletion } = {}) {
  const log = [];
  let live = 0;
  let peak = 0;
  let n = 0;
  const posted = [];
  const loadWllama = async () => {
    const id = ++n;
    let path = null;
    live++;
    peak = Math.max(peak, live);
    log.push(`create#${id}`);
    let exited = false;
    return {
      cacheManager: {
        getNameFromURL: async () => "k",
        getSize: async () => 40,
        getMetadata: async () => ({ sha256: MODEL.sha256 }),
      },
      loadModelFromUrl: async (_u, o) => {
        path = o.n_gpu_layers > 0 ? "webgpu" : "cpu";
        log.push(
          `load#${id}:${path}${path === "cpu" ? `:t${o.n_threads}` : ""}`,
        );
        if (path === "webgpu" && webgpu === "throws")
          throw new Error("device lost");
      },
      getLoadedContextInfo: () => ({ n_ctx: 100 }),
      getNumThreads: () => 3,
      tokenize: async (t) =>
        t === "WEBGPU_TEXT" ? (webgpu === "good" ? GOOD : GARBAGE) : GOOD,
      createCompletion: async (o) => {
        const isCanary = o.prompt === reference.prompt;
        log.push(`${isCanary ? "canary" : "bench"}#${id}:${path}`);
        onCompletion?.(id, path, isCanary);
        const [pp, gen] = speed[path];
        return {
          choices: [
            {
              text: path === "webgpu" ? "WEBGPU_TEXT" : "CPU_TEXT",
              finish_reason: "length",
            },
          ],
          timings: {
            prompt_n: 200,
            prompt_ms: (200 / pp) * 1000,
            predicted_n: 24,
            predicted_ms: (24 / gen) * 1000,
          },
        };
      },
      exit: async () => {
        if (!exited) {
          exited = true;
          live--;
          log.push(`exit#${id}`);
        }
      },
    };
  };
  const host = createModelHost({
    post: (m) => posted.push(m),
    loadWllama,
    readAdapter: async () => ({ vendor: "x" }),
  });
  return { host, log, posted, peak: () => peak, live: () => live };
}
const ready = (posted) => posted.find((m) => m.type === "ready");

describe("canary pass and the benchmark pick", () => {
  test("webgpu passes and is faster: it ends on webgpu, loaded one engine at a time, the loser freed first", async () => {
    const t = make();
    await t.host.handle(INIT);
    t.posted.forEach(validateWorkerMessage);
    expect(t.log).toEqual([
      "create#1",
      "load#1:webgpu",
      "canary#1:webgpu",
      "bench#1:webgpu",
      "exit#1", // the graphics engine is freed BEFORE the processor one exists
      "create#2",
      "load#2:cpu:t3",
      "bench#2:cpu",
      "exit#2", // the loser is freed before the winner is loaded again
      "create#3",
      "load#3:webgpu",
    ]);
    expect(t.peak()).toBe(1);
    expect(t.live()).toBe(1); // exactly the winner
    expect(ready(t.posted)).toMatchObject({
      path: "webgpu",
      selection: {
        canary: "pass",
        matched: 20,
        of: 20,
        bench: {
          webgpu: { ppTokS: 500, genTokS: 60 },
          cpu: { ppTokS: 58, genTokS: 36 },
        },
      },
    });
  });

  test("webgpu passes but the processor is faster: the processor engine is kept, no third load", async () => {
    const t = make({ speed: { webgpu: [30, 4], cpu: [58, 36] } });
    await t.host.handle(INIT);
    expect(t.log.filter((l) => l.startsWith("load"))).toEqual([
      "load#1:webgpu",
      "load#2:cpu:t3",
    ]);
    expect(t.log).not.toContain("exit#2");
    expect(t.live()).toBe(1);
    expect(t.peak()).toBe(1);
    expect(ready(t.posted)).toMatchObject({
      path: "cpu",
      selection: { canary: "pass" },
    });
  });

  test("the progress messages say which check is running", async () => {
    const t = make();
    await t.host.handle(INIT);
    const steps = t.posted
      .filter((m) => m.type === "progress" && m.phase === "check")
      .map((m) => m.step);
    expect(steps).toEqual(["canary", "benchmark", "benchmark"]);
  });
});

describe("canary fail", () => {
  test("garbage output: webgpu is dropped before anything else is benchmarked, the processor runs, the verdict says fail", async () => {
    const t = make({ webgpu: "garbage" });
    await t.host.handle(INIT);
    expect(t.log).toEqual([
      "create#1",
      "load#1:webgpu",
      "canary#1:webgpu",
      "exit#1",
      "create#2",
      "load#2:cpu:t3",
      "bench#2:cpu",
    ]); // no benchmark of the broken path, no third engine
    expect(t.peak()).toBe(1);
    expect(ready(t.posted)).toMatchObject({
      path: "cpu",
      selection: {
        canary: "fail",
        matched: 0,
        of: 20,
        bench: { cpu: { ppTokS: 58, genTokS: 36 } },
      },
    });
  });

  test("a graphics engine that cannot even start counts as a failed canary, and the job still gets a model", async () => {
    const t = make({ webgpu: "throws" });
    await t.host.handle(INIT);
    expect(t.posted.some((m) => m.type === "error")).toBe(false);
    expect(ready(t.posted)).toMatchObject({
      path: "cpu",
      selection: { canary: "fail", matched: 0 },
    });
    expect(t.peak()).toBe(1);
  });
});

describe("no usable graphics adapter", () => {
  test("probe with path cpu: the canary is skipped, no graphics engine is ever created, the processor is measured", async () => {
    const t = make();
    await t.host.handle({ ...INIT, path: "cpu" });
    expect(t.log.some((l) => l.includes("webgpu"))).toBe(false);
    expect(ready(t.posted)).toMatchObject({
      path: "cpu",
      selection: {
        canary: "skipped",
        matched: 0,
        bench: { cpu: { ppTokS: 58, genTokS: 36 } },
      },
    });
  });
});

describe("a fixed path (a stored verdict) does none of this", () => {
  test("no probe: one engine, no canary, no benchmark, no selection in the ready message", async () => {
    const t = make();
    await t.host.handle({ ...INIT, probe: undefined, path: "cpu" });
    expect(t.log).toEqual(["create#1", "load#1:cpu:t3"]);
    expect(ready(t.posted).selection).toBeUndefined();
  });
  test("threads reach the processor engine only", async () => {
    const t = make();
    await t.host.handle({ ...INIT, probe: undefined, path: "webgpu" });
    expect(t.log).toEqual(["create#1", "load#1:webgpu"]);
  });
});

describe("exit during the check", () => {
  test("every engine is freed and nothing is reported", async () => {
    let t;
    t = make({
      onCompletion: (_id, path, isCanary) => {
        if (isCanary) t.host.handle({ type: "exit" });
      },
    });
    await t.host.handle(INIT);
    expect(t.live()).toBe(0);
    expect(t.posted.some((m) => m.type === "ready" || m.type === "error")).toBe(
      false,
    );
  });
});
