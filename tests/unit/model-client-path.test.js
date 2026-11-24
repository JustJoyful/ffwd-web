// Path choice in the model client (app/model/client.js) against a fake worker: the stored verdict (hit, miss, corrupt,
// unavailable storage), the first-visit probe, and the runtime safety net (two unreadable replies -> processor, same step).
import { describe, expect, test } from "vitest";
import { createModelClient } from "../../app/model/client.js";
import { PATH_CHOICE } from "../../app/model/config.js";
import { MODEL } from "./model-fixture.js";
import { cacheKey, readVerdict } from "../../app/model/path-cache.js";
import { renderChat } from "../../app/agent/chat-template.js";

const NV = {
  vendor: "nvidia",
  architecture: "ampere",
  description: "RTX 3050",
};
const KEY = cacheKey(NV, MODEL.sha256);
const T = { cacheN: 0, promptN: 1, promptMs: 1, predictedN: 1, predictedMs: 1 };
const flush = () => new Promise((r) => setTimeout(r, 0));
const BENCH = {
  webgpu: { ppTokS: 190, genTokS: 53 },
  cpu: { ppTokS: 58, genTokS: 36 },
};

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    m,
  };
};

class FakeWorker {
  sent = [];
  terminated = false;
  onmessage = null;
  onerror = null;
  postMessage(m) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  say(m) {
    this.onmessage({ data: m });
  }
  ready(over = {}) {
    this.say({
      type: "ready",
      path: "webgpu",
      threads: 4,
      nCtx: MODEL.nCtx,
      cached: true,
      loadMs: 800,
      ...over,
    });
  }
  result(id, text) {
    this.say({
      type: "result",
      id,
      text,
      finishReason: "stop",
      timings: T,
      wallMs: 1,
    });
  }
  generates() {
    return this.sent.filter((m) => m.type === "generate");
  }
  init() {
    return this.sent.find((m) => m.type === "init");
  }
}

function make({
  storage = memoryStorage(),
  adapter = NV,
  isValidReply = null,
  ...over
} = {}) {
  const workers = [];
  const client = createModelClient({
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    config: MODEL,
    isCached: async () => true,
    getAdapter: async () => adapter,
    storage,
    threads: 3,
    isValidReply,
    ...over,
  });
  return { client, workers, storage };
}
const sel = (canary, bench = BENCH, matched = canary === "pass" ? 20 : 0) => ({
  canary,
  matched,
  of: 20,
  bench,
});

describe("first visit: no verdict, so the worker probes", () => {
  test("it asks for a probe on the graphics path with the processor thread count", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    expect(workers[0].init()).toMatchObject({
      path: "webgpu",
      probe: true,
      threads: 3,
    });
  });

  test("check progress shows inside 'loading' and is gone at the next load progress", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    workers[0].say({
      type: "progress",
      phase: "check",
      loaded: 0,
      total: 0,
      step: "canary",
    });
    expect(client.getState()).toMatchObject({
      phase: "loading",
      check: "canary",
    });
    workers[0].say({
      type: "progress",
      phase: "check",
      loaded: 0,
      total: 0,
      step: "benchmark",
    });
    expect(client.getState().check).toBe("benchmark");
    workers[0].say({
      type: "progress",
      phase: "load",
      loaded: MODEL.bytes,
      total: MODEL.bytes,
    });
    expect(client.getState().check).toBeNull();
  });

  test("canary pass: ready on webgpu, the verdict and the measured speed are kept in the state and in storage", async () => {
    const { client, workers, storage } = make();
    await client.begin("webgpu");
    workers[0].ready({ path: "webgpu", selection: sel("pass") });
    expect(client.getState()).toMatchObject({
      phase: "ready",
      path: "webgpu",
      canary: "pass",
      bench: BENCH.webgpu,
      fallback: null,
      check: null,
    });
    expect(readVerdict(KEY, { storage })).toMatchObject({
      webgpu: "ok",
      path: "webgpu",
      canary: "pass",
      why: null,
      bench: BENCH,
    });
  });

  test("canary fail: ready on the processor, fallback says canary, storage says broken", async () => {
    const { client, workers, storage } = make();
    await client.begin("webgpu");
    workers[0].ready({
      path: "cpu",
      selection: sel("fail", { cpu: BENCH.cpu }),
    });
    expect(client.getState()).toMatchObject({
      path: "cpu",
      canary: "fail",
      fallback: "canary",
      bench: BENCH.cpu,
    });
    expect(readVerdict(KEY, { storage })).toMatchObject({
      webgpu: "broken",
      path: "cpu",
      canary: "fail",
      why: "canary",
    });
  });

  test("passed but the processor was faster: no fallback reason, and the next visit stays on the processor", async () => {
    const { client, workers, storage } = make();
    await client.begin("webgpu");
    workers[0].ready({ path: "cpu", selection: sel("pass") });
    expect(client.getState()).toMatchObject({
      path: "cpu",
      canary: "pass",
      fallback: null,
    });
    expect(readVerdict(KEY, { storage })).toMatchObject({
      webgpu: "ok",
      path: "cpu",
      why: null,
    });
  });
});

describe("a stored verdict is used as it is (the check runs once)", () => {
  const visit = async (storage, over = {}) => {
    const t = make({ storage, ...over });
    await t.client.begin("webgpu");
    return t;
  };
  test("cache hit, graphics chip: loads webgpu with no probe, and the state has the stored speed at once", async () => {
    const first = make();
    await first.client.begin("webgpu");
    first.workers[0].ready({ selection: sel("pass") });
    const second = await visit(first.storage);
    expect(second.workers[0].init()).toMatchObject({
      path: "webgpu",
      threads: 3,
    });
    expect(second.workers[0].init().probe).toBeUndefined();
    expect(second.client.getState()).toMatchObject({
      canary: "pass",
      bench: BENCH.webgpu,
    });
  });
  test("cache hit, broken: loads the processor directly and keeps saying why", async () => {
    const first = make();
    await first.client.begin("webgpu");
    first.workers[0].ready({
      path: "cpu",
      selection: sel("fail", { cpu: BENCH.cpu }),
    });
    const second = await visit(first.storage);
    expect(second.workers[0].init()).toMatchObject({ path: "cpu" });
    expect(second.workers[0].init().probe).toBeUndefined();
    second.workers[0].ready({ path: "cpu" });
    expect(second.client.getState()).toMatchObject({
      path: "cpu",
      fallback: "canary",
      canary: "fail",
      bench: BENCH.cpu,
    });
  });
  test("with a verdict the path is known while loading, so the notice never pairs the guess with the stored speed", async () => {
    const first = make();
    await first.client.begin("webgpu");
    first.workers[0].ready({
      path: "cpu",
      selection: sel("fail", { cpu: BENCH.cpu }),
    });
    const second = await visit(first.storage);
    expect(second.client.getState()).toMatchObject({
      phase: "loading",
      path: "cpu",
      bench: BENCH.cpu,
    });
    // and with none (a probe) the path stays unknown until the worker says
    const fresh = await visit(memoryStorage());
    expect(fresh.client.getState().path).toBeNull();
  });
  test("another adapter in the same browser asks again", async () => {
    const first = make();
    await first.client.begin("webgpu");
    first.workers[0].ready({ selection: sel("pass") });
    const other = await visit(first.storage, {
      adapter: { vendor: "intel", architecture: "gen-12lp", description: "" },
    });
    expect(other.workers[0].init().probe).toBe(true);
  });
  test("corrupt storage reads as a miss: the probe runs and the page works", async () => {
    const storage = memoryStorage({ [KEY]: "{this is not json" });
    const t = await visit(storage);
    expect(t.workers[0].init()).toMatchObject({ path: "webgpu", probe: true });
    t.workers[0].ready({ selection: sel("pass") });
    expect(t.client.getState().phase).toBe("ready");
    expect(readVerdict(KEY, { storage })).not.toBeNull(); // and it is repaired
  });
  test("storage that throws everywhere: the probe runs every visit, nothing breaks", async () => {
    const dead = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const t = await visit(dead);
    expect(t.workers[0].init().probe).toBe(true);
    t.workers[0].ready({ selection: sel("pass") });
    expect(t.client.getState().phase).toBe("ready");
  });
  test("a device with no real adapter: only the processor is measured, then remembered as skipped", async () => {
    const first = make({ adapter: null });
    await first.client.begin("cpu");
    expect(first.workers[0].init()).toMatchObject({ path: "cpu", probe: true });
    first.workers[0].ready({
      path: "cpu",
      selection: sel("skipped", { cpu: BENCH.cpu }),
    });
    expect(first.client.getState()).toMatchObject({
      canary: "skipped",
      bench: BENCH.cpu,
      fallback: null,
    });
    const second = make({ adapter: null, storage: first.storage });
    await second.client.begin("cpu");
    expect(second.workers[0].init().probe).toBeUndefined();
    expect(second.client.getState().bench).toEqual(BENCH.cpu);
  });
});

describe("the runtime safety net", () => {
  const MSGS = [
    { role: "system", content: "s" },
    { role: "user", content: "trim it" },
  ];
  const valid = (t) => t.startsWith("{");
  const onGraphics = async (opts = {}) => {
    const t = make({ isValidReply: valid, ...opts });
    await t.client.begin("webgpu");
    t.workers[0].ready({ selection: sel("pass") });
    return t;
  };
  /** One policy call answered by `text` on the current worker. */
  const answer = async (t, messages, text) => {
    const p = t.client.policy(messages);
    await flush();
    const w = t.workers.at(-1);
    w.result(w.generates().at(-1).id, text);
    return p;
  };

  test("one unreadable reply is returned as it is (the machine handles it as before); a good one resets the count", async () => {
    const t = await onGraphics();
    expect(await answer(t, MSGS, "@@@")).toBe("@@@");
    expect(await answer(t, MSGS, '{"action":"spec"}')).toBe(
      '{"action":"spec"}',
    );
    expect(await answer(t, MSGS, "@@@")).toBe("@@@");
    expect(t.workers).toHaveLength(1); // still the same worker
    expect(t.client.getState().path).toBe("webgpu");
  });

  test("two unreadable replies in a row: the graphics path is marked broken, the worker swapped, the same step redone on the processor", async () => {
    const t = await onGraphics();
    const first = await answer(t, MSGS, "@@@");
    expect(first).toBe("@@@");
    // what the machine sends next: the garbage and its feedback are in the conversation
    const next = [
      ...MSGS,
      { role: "assistant", content: "@@@" },
      { role: "user", content: '{"error": "not json"}' },
    ];
    const p = t.client.policy(next);
    await flush();
    t.workers[0].result(t.workers[0].generates().at(-1).id, "%%%"); // the second garbage reply
    await flush();
    // the old worker is stopped and a processor one is started, with no probe and no graphics
    expect(t.workers[0].terminated).toBe(true);
    expect(t.workers).toHaveLength(2);
    expect(t.workers[1].init()).toMatchObject({ path: "cpu", threads: 3 });
    expect(t.workers[1].init().probe).toBeUndefined();
    expect(t.client.getState()).toMatchObject({
      phase: "loading",
      fallback: "replies",
    });
    t.workers[1].ready({ path: "cpu" });
    await flush();
    // the step is asked again from the conversation WITHOUT the garbage reply and its feedback
    const redo = t.workers[1].generates();
    expect(redo).toHaveLength(1);
    expect(redo[0].prompt).toBe(renderChat(MSGS));
    t.workers[1].result(redo[0].id, '{"action":"spec"}');
    expect(await p).toBe('{"action":"spec"}');
    expect(t.client.getState()).toMatchObject({
      phase: "ready",
      path: "cpu",
      fallback: "replies",
    });
    expect(readVerdict(KEY, { storage: t.storage })).toMatchObject({
      webgpu: "broken",
      path: "cpu",
      why: "replies",
    });
  });

  test("after the switch the garbage stays out of every later turn of the job", async () => {
    const t = await onGraphics();
    await answer(t, MSGS, "@@@");
    const next = [
      ...MSGS,
      { role: "assistant", content: "@@@" },
      { role: "user", content: "fb" },
    ];
    const p = t.client.policy(next);
    await flush();
    t.workers[0].result(t.workers[0].generates().at(-1).id, "%%%");
    await flush();
    t.workers[1].ready({ path: "cpu" });
    await flush();
    t.workers[1].result(t.workers[1].generates()[0].id, '{"action":"spec"}');
    await p;
    const later = [
      ...MSGS,
      { role: "assistant", content: "@@@" },
      { role: "user", content: "fb" },
      { role: "assistant", content: '{"action":"spec"}' },
      { role: "user", content: "ok" },
    ];
    await answer(t, later, '{"action":"run"}');
    expect(t.workers[1].generates().at(-1).prompt).toBe(
      renderChat([
        ...MSGS,
        { role: "assistant", content: '{"action":"spec"}' },
        { role: "user", content: "ok" },
      ]),
    );
  });

  test("it is only on the graphics path: unreadable replies on the processor are left to the machine", async () => {
    const t = make({ isValidReply: valid });
    await t.client.begin("webgpu");
    t.workers[0].ready({
      path: "cpu",
      selection: sel("fail", { cpu: BENCH.cpu }),
    });
    for (let i = 0; i < 3; i++)
      expect(await answer(t, MSGS, "@@@")).toBe("@@@");
    expect(t.workers).toHaveLength(1);
  });

  test("without a validity check the net is off", async () => {
    const t = await onGraphics({ isValidReply: null });
    for (let i = 0; i < 3; i++) await answer(t, MSGS, "@@@");
    expect(t.workers).toHaveLength(1);
  });

  test("a new job starts the count again", async () => {
    const t = await onGraphics();
    await answer(t, MSGS, "@@@"); // the last turn of job 1 was garbage
    await answer(t, MSGS, "@@@"); // job 2, turn 1 (a fresh conversation of two messages) is garbage too: not two in a row
    expect(t.workers).toHaveLength(1);
  });

  test("the threshold is the configured number", () => {
    expect(PATH_CHOICE.invalidRepliesToSwitch).toBe(2);
  });
});
