// The main-thread model client (app/model/client.js) against a fake worker: every path of the contract, no browser.
import { describe, expect, test } from "vitest";
import { createModelClient } from "../../app/model/client.js";
import { MODEL } from "../../app/model/config.js";
import { renderChat } from "../../app/agent/chat-template.js";

const URL_ = "http://localhost/m.gguf";
const MSGS = [
  { role: "system", content: "s" },
  { role: "user", content: "trim it" },
];
const TIMINGS = {
  cacheN: 0,
  promptN: 1,
  promptMs: 1,
  predictedN: 1,
  predictedMs: 1,
};
const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeWorker {
  constructor() {
    this.sent = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage(m) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  // test side: a message from the worker
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
      timings: TIMINGS,
      wallMs: 1,
    });
  }
  generates() {
    return this.sent.filter((m) => m.type === "generate");
  }
}

/** A throwaway localStorage, so a verdict from one test never reaches the next. */
const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    map: m,
  };
};
const ADAPTER = { vendor: "nvidia", architecture: "ampere", description: "x" };

function make({ cached = false, url = URL_, ...over } = {}) {
  const workers = [];
  const client = createModelClient({
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    url,
    isCached: async () => cached,
    getAdapter: async () => ADAPTER, // a real graphics adapter, unless a test says otherwise
    storage: memoryStorage(),
    threads: 4,
    ...over,
  });
  return { client, workers };
}

describe("no model published", () => {
  test("begin() fails with load_failed and a message saying so; no worker, no download", async () => {
    const { client, workers } = make({ url: null });
    await client.begin("webgpu");
    expect(client.getState()).toMatchObject({
      phase: "failed",
      error: { code: "load_failed" },
    });
    expect(client.getState().error.message).toMatch(/not published yet/);
    expect(workers).toHaveLength(0);
    await expect(client.policy(MSGS)).rejects.toMatchObject({
      code: "load_failed",
    });
  });
});

describe("cached model (warm start)", () => {
  test("loads without asking, sends init with the config, ends ready", async () => {
    const { client, workers } = make({ cached: true });
    const phases = [];
    client.subscribe((s) => phases.push(s.phase));
    await client.begin("cpu");
    expect(client.getState()).toMatchObject({
      phase: "loading",
      cached: true,
      total: MODEL.bytes,
    });
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([
      {
        type: "init",
        modelUrl: URL_,
        sha256: MODEL.sha256,
        bytes: MODEL.bytes,
        nCtx: MODEL.nCtx,
        path: "cpu",
        kvCache: MODEL.kvCache,
        threads: 4,
        probe: true, // no stored verdict yet
      },
    ]);
    workers[0].ready({ path: "cpu", loadMs: 950 });
    expect(client.getState()).toMatchObject({
      phase: "ready",
      path: "cpu",
      cached: true,
      loadMs: 950,
      error: null,
    });
    expect(phases).not.toContain("needsConsent");
  });
});

describe("not cached (first visit)", () => {
  test("begin() asks first: needsConsent with the size, no worker yet", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    expect(client.getState()).toMatchObject({
      phase: "needsConsent",
      total: MODEL.bytes,
      cached: false,
    });
    expect(workers).toHaveLength(0);
  });

  test("consent() downloads: progress, then loading, then ready (cached false)", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    client.consent();
    expect(client.getState().phase).toBe("downloading");
    expect(workers[0].sent[0]).toMatchObject({ type: "init", path: "webgpu" });
    workers[0].say({
      type: "progress",
      phase: "download",
      loaded: 100,
      total: MODEL.bytes,
    });
    expect(client.getState()).toMatchObject({
      phase: "downloading",
      loaded: 100,
      total: MODEL.bytes,
    });
    workers[0].say({
      type: "progress",
      phase: "load",
      loaded: 0,
      total: MODEL.bytes,
    });
    expect(client.getState().phase).toBe("loading");
    workers[0].ready({ cached: false });
    expect(client.getState()).toMatchObject({ phase: "ready", cached: false });
  });

  test("decline() keeps needsConsent (never 'failed'), starts nothing, and policy() rejects aborted", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    const waiting = client.policy(MSGS); // a job already waiting for the model
    client.decline();
    expect(client.getState().phase).toBe("needsConsent");
    expect(workers).toHaveLength(0);
    await expect(waiting).rejects.toMatchObject({ code: "aborted" });
    await expect(client.policy(MSGS)).rejects.toMatchObject({
      code: "aborted",
    });
  });

  test("a declined person can still change their mind", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    client.decline();
    client.consent();
    expect(client.getState().phase).toBe("downloading");
    expect(workers).toHaveLength(1);
  });

  test("consent() outside needsConsent does nothing", async () => {
    const { client, workers } = make({ cached: true });
    client.consent(); // idle
    await client.begin("webgpu");
    client.consent(); // loading
    expect(workers).toHaveLength(1);
  });
});

describe("begin", () => {
  test("starts only once", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("cpu");
    await client.begin("webgpu");
    expect(workers).toHaveLength(1);
    expect(workers[0].sent[0].path).toBe("cpu");
  });

  test("falls back to getPath, then to cpu", async () => {
    const a = make({ cached: true, getPath: () => "webgpu" });
    await a.client.begin();
    expect(a.workers[0].sent[0].path).toBe("webgpu");
    const b = make({ cached: true });
    await b.client.begin();
    expect(b.workers[0].sent[0].path).toBe("cpu");
  });
});

describe("failures and retry", () => {
  test("a worker error ends the load as failed with its code; the worker is stopped", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    workers[0].say({
      type: "error",
      code: "hash_mismatch",
      message: "differs",
    });
    expect(client.getState()).toMatchObject({
      phase: "failed",
      error: { code: "hash_mismatch", message: "differs" },
    });
    expect(workers[0].terminated).toBe(true);
    await expect(client.policy(MSGS)).rejects.toMatchObject({
      code: "hash_mismatch",
    });
  });

  test("retry() starts over; a person who already agreed to the download is not asked again", async () => {
    const { client, workers } = make();
    await client.begin("webgpu");
    client.consent();
    workers[0].say({ type: "error", code: "load_failed", message: "net" });
    await client.retry();
    expect(client.getState().phase).toBe("downloading");
    expect(workers).toHaveLength(2);
    workers[1].ready({ cached: false });
    expect(client.getState().phase).toBe("ready");
  });

  test("retry() before any consent asks first", async () => {
    let cached = true;
    const { client, workers } = make({ isCached: async () => cached });
    await client.begin("webgpu");
    workers[0].say({ type: "error", code: "load_failed", message: "x" });
    cached = false; // the cache was cleared meanwhile
    await client.retry();
    expect(client.getState().phase).toBe("needsConsent");
  });

  test("retry() with no published model fails the same way, with no worker", async () => {
    const { client, workers } = make({ url: null });
    await client.begin("webgpu");
    await client.retry();
    expect(client.getState()).toMatchObject({
      phase: "failed",
      error: { code: "load_failed" },
    });
    expect(workers).toHaveLength(0);
  });

  test("retry() only works from failed", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    await client.retry();
    expect(workers).toHaveLength(1);
  });

  test("worker.onerror before ready is a load_failed", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    workers[0].onerror({ message: "script error" });
    expect(client.getState()).toMatchObject({
      phase: "failed",
      error: { code: "load_failed", message: "script error" },
    });
  });

  test("worker.onerror while a generate is pending rejects it and fails the model", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    workers[0].ready();
    const p = client.policy(MSGS);
    await flush();
    workers[0].onerror({ message: "oom killed" });
    await expect(p).rejects.toMatchObject({ code: "generate_failed" });
    expect(client.getState().phase).toBe("failed");
  });

  test("a malformed worker message fails the load instead of being ignored", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    workers[0].say({ type: "ready", path: "nope" });
    expect(client.getState().phase).toBe("failed");
  });
});

describe("policy", () => {
  async function ready(over) {
    const m = make({ cached: true, ...over });
    await m.client.begin("webgpu");
    m.workers[0].ready();
    return m;
  }

  test("renders the prompt with renderChat and asks for MODEL.maxTokens; resolves with the reply text", async () => {
    const { client, workers } = await ready();
    const p = client.policy(MSGS);
    await flush();
    const [g] = workers[0].generates();
    expect(g).toEqual({
      type: "generate",
      id: expect.any(Number),
      prompt: renderChat(MSGS),
      maxTokens: MODEL.maxTokens,
    });
    workers[0].result(g.id, '{"action":"finish"}');
    await expect(p).resolves.toBe('{"action":"finish"}');
  });

  test("waits for ready when called early", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    const p = client.policy(MSGS);
    await flush();
    expect(workers[0].generates()).toHaveLength(0);
    workers[0].ready();
    await flush();
    workers[0].result(workers[0].generates()[0].id, "ok");
    await expect(p).resolves.toBe("ok");
  });

  test("rejects with the worker's error code (context_full, generate_failed)", async () => {
    const { client, workers } = await ready();
    for (const code of ["context_full", "generate_failed"]) {
      const p = client.policy(MSGS);
      await flush();
      const g = workers[0].generates().at(-1);
      workers[0].say({ type: "error", id: g.id, code, message: `m ${code}` });
      const e = await p.catch((x) => x);
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe(code);
      expect(e.message).toBe(`m ${code}`);
    }
    expect(client.getState().phase).toBe("ready"); // a failed turn does not fail the model
  });

  test("concurrent calls are serialised: the second is sent only after the first answers", async () => {
    const { client, workers } = await ready();
    const a = client.policy(MSGS);
    const b = client.policy([{ role: "user", content: "second" }]);
    await flush();
    expect(workers[0].generates()).toHaveLength(1);
    const g1 = workers[0].generates()[0];
    workers[0].result(g1.id, "one");
    await expect(a).resolves.toBe("one");
    await flush();
    expect(workers[0].generates()).toHaveLength(2);
    const g2 = workers[0].generates()[1];
    expect(g2.id).not.toBe(g1.id);
    workers[0].result(g2.id, "two");
    await expect(b).resolves.toBe("two");
  });

  test("a failed call does not block the next one", async () => {
    const { client, workers } = await ready();
    const a = client.policy(MSGS);
    const b = client.policy(MSGS);
    await flush();
    workers[0].say({
      type: "error",
      id: workers[0].generates()[0].id,
      code: "generate_failed",
      message: "x",
    });
    await expect(a).rejects.toBeInstanceOf(Error);
    await flush();
    workers[0].result(workers[0].generates()[1].id, "fine");
    await expect(b).resolves.toBe("fine");
  });
});

describe("state subscription", () => {
  test("subscribe notifies on every change and the unsubscribe works", async () => {
    const { client, workers } = make({ cached: true });
    const seen = [];
    const off = client.subscribe((s) => seen.push(s.phase));
    await client.begin("webgpu");
    workers[0].ready();
    off();
    workers[0].say({ type: "error", code: "load_failed", message: "late" });
    expect(seen).toEqual(["loading", "ready"]);
  });

  test("each change is a new object (React snapshots)", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    const a = client.getState();
    expect(client.getState()).toBe(a);
    workers[0].ready();
    expect(client.getState()).not.toBe(a);
  });
});

describe("dispose", () => {
  test("stops the worker (exit, then terminate) and rejects the job in flight with aborted", async () => {
    const { client, workers } = make({ cached: true });
    await client.begin("webgpu");
    workers[0].ready();
    const p = client.policy(MSGS);
    await flush();
    client.dispose();
    await expect(p).rejects.toMatchObject({ code: "aborted" });
    expect(workers[0].sent.at(-1)).toEqual({ type: "exit" });
    expect(workers[0].terminated).toBe(true);
  });

  test("rejects a policy() call still waiting for the model", async () => {
    const { client } = make({ cached: true });
    await client.begin("webgpu");
    const p = client.policy(MSGS);
    client.dispose();
    await expect(p).rejects.toMatchObject({ code: "aborted" });
  });

  test("is safe twice and blocks any restart", async () => {
    const { client, workers } = make();
    client.dispose();
    client.dispose();
    await client.begin("webgpu");
    client.consent();
    expect(workers).toHaveLength(0);
  });

  test("a begin() that was still probing the cache starts no worker after dispose", async () => {
    let release;
    const { client, workers } = make({
      isCached: () => new Promise((r) => (release = r)),
    });
    const b = client.begin("webgpu");
    client.dispose();
    release(true);
    await b;
    expect(workers).toHaveLength(0);
  });
});
