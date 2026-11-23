import { readFileSync, readdirSync } from "node:fs";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeExecutor, fakeMeasure, probeFile } from "./engine-fakes.js";

// Count what the machine does so the tests can see what React did with it.
const seen = { created: 0, live: new Set() };
vi.mock("../../app/agent/machine.js", async (original) => {
  const real = await original();
  return {
    ...real,
    createMachine(deps) {
      seen.created += 1;
      const m = real.createMachine(deps);
      return {
        ...m,
        subscribe(fn) {
          seen.live.add(fn);
          const off = m.subscribe(fn);
          return () => {
            seen.live.delete(fn);
            off();
          };
        },
      };
    },
  };
});
const { useTool } = await import("../../app/tool/store.js");
const { default: App } = await import("../../app/routes/app.jsx");

const OK = () => ({ ok: true, reason: null });
/** A runtime double: the engine fakes plus a dispose counter. */
const fakeRuntime = () => ({
  executor: fakeExecutor(),
  measure: fakeMeasure(),
  probeFile,
  dispose: vi.fn(),
});
const quietPolicy = async () => "";

function Probe({ opts, onRender }) {
  const { state } = useTool(opts);
  onRender(state.name);
  return <p data-testid="state">{state.name}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  seen.created = 0;
  seen.live.clear();
});

describe("useTool", () => {
  test("every state change reaches the component, in order", async () => {
    const names = [];
    let tool;
    function Capture() {
      tool = useTool({
        runtime: fakeRuntime(),
        policy: quietPolicy,
        capability: OK,
      });
      names.push(tool.state.name);
      return null;
    }
    render(<Capture />);
    await act(async () => {
      await tool.dispatch({ type: "fileChosen", file: { name: "a.mp4" } });
    });
    await act(async () => {
      await tool.dispatch({
        type: "requestSubmitted",
        request: "make it small",
      });
    });
    const distinct = names.filter((n, i) => n !== names[i - 1]);
    expect(distinct.slice(0, 5)).toEqual([
      "checkingCapability",
      "ready",
      "probing",
      "awaitingRequest",
      "planning",
    ]);
  });

  test("it unsubscribes on unmount and stops the runtime", async () => {
    const runtime = fakeRuntime();
    const { unmount } = render(
      <Probe
        opts={{ runtime, policy: quietPolicy, capability: OK }}
        onRender={() => {}}
      />,
    );
    await screen.findByText("ready");
    expect(seen.live.size).toBe(1);
    expect(runtime.dispose).not.toHaveBeenCalled();
    unmount();
    expect(seen.live.size).toBe(0);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  test("an unsupported device ends in unsupportedDevice with the reason", async () => {
    render(
      <Probe
        opts={{
          runtime: fakeRuntime(),
          policy: quietPolicy,
          capability: () => ({ ok: false, reason: "mobile" }),
        }}
        onRender={() => {}}
      />,
    );
    await screen.findByText("unsupportedDevice");
  });

  test("a StrictMode double mount leaves exactly one live subscription", async () => {
    const runtime = fakeRuntime();
    const { unmount } = render(
      <StrictMode>
        <Probe
          opts={{ runtime, policy: quietPolicy, capability: OK }}
          onRender={() => {}}
        />
      </StrictMode>,
    );
    await screen.findByText("ready");
    expect(seen.live.size).toBe(1);
    // React runs the state initialiser twice in dev, so two machines are built and one is dropped; the dropped one has
    // no side effects (nothing loads until a command runs) and never subscribes. The dev double effect also runs
    // stop() once between the two starts; the runtime reloads lazily, so that is harmless.
    unmount();
    expect(seen.live.size).toBe(0);
  });
});

describe("the /app route", () => {
  const renderApp = (url) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>,
    );
  const capable = () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubEnv("VITE_SCRIPTED_POLICY", "1");
  };

  test("?ask= pre-fills the request field", async () => {
    capable();
    renderApp("/app?ask=make%20this%20video%20smaller");
    const field = await screen.findByLabelText(
      "What should happen to your video?",
    );
    expect(field.value).toBe("make this video smaller");
    await screen.findByText("ffwd");
  });

  test("without ?ask= the field is empty", async () => {
    capable();
    renderApp("/app");
    expect((await screen.findByLabelText(/What should happen/)).value).toBe("");
  });

  test("a device that can't run ffwd gets a plain reason, not a broken tool", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    renderApp("/app");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /video engine/,
    );
  });
});

describe("module boundaries", () => {
  const read = (p) => readFileSync(p, "utf8");
  const imports = (src) =>
    [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

  test("/app imports nothing from the marketing-only modules", () => {
    const files = [
      "app/routes/app.jsx",
      "app/tool/store.js",
      "app/lib/capability.js",
    ];
    const all = files.flatMap((f) => imports(read(f)));
    expect(
      all.filter((i) => /showcase|content\/|routes\/home/.test(i)),
    ).toEqual([]);
  });

  test("the marketing routes and their modules never import framer-motion or the ffmpeg runtime", () => {
    const files = [
      "app/routes/home.jsx",
      ...readdirSync("app/showcase").map((f) => `app/showcase/${f}`),
      "app/root.jsx",
    ];
    const bad = files.flatMap((f) =>
      imports(read(f)).filter((i) =>
        /framer-motion|lucide-react|@ffmpeg|browser-runtime|tool\/store/.test(
          i,
        ),
      ),
    );
    expect(bad).toEqual([]);
  });
});

// The model wiring (D-050): store.model, the first file starts it, useTool exposes it. Stream C (UI) and stream D
// (analytics) code against exactly this shape.
const { createToolStore, stubModel } = await import("../../app/tool/store.js");
const { createModelClient } = await import("../../app/model/client.js");
const { checkCapability } = await import("../../app/lib/capability.js");

const fakeModel = () => ({
  ...stubModel(),
  begin: vi.fn(async () => {}),
  consent: vi.fn(),
  decline: vi.fn(),
  retry: vi.fn(async () => {}),
  dispose: vi.fn(),
});
const FILE = { type: "fileChosen", file: { name: "a.mp4" } };

describe("the model in the store", () => {
  test("begin() runs once, on the first file chosen, with the capability path", async () => {
    const model = fakeModel();
    const store = createToolStore({
      model,
      policy: quietPolicy,
      runtime: fakeRuntime(),
      capability: () => ({ ok: true, reason: null, path: "cpu" }),
    });
    store.start();
    expect(model.begin).not.toHaveBeenCalled(); // not at page load
    await store.dispatch(FILE);
    expect(model.begin).toHaveBeenCalledTimes(1);
    expect(model.begin).toHaveBeenCalledWith("cpu");
    await store.dispatch({ type: "newRequest" });
    await store.dispatch(FILE); // a second file
    expect(model.begin).toHaveBeenCalledTimes(1);
  });

  test("a file chosen on a device that cannot run ffwd does not start the model", async () => {
    const model = fakeModel();
    const store = createToolStore({
      model,
      policy: quietPolicy,
      runtime: fakeRuntime(),
      capability: () => ({ ok: false, reason: "mobile" }),
    });
    store.start();
    await store.dispatch(FILE);
    expect(model.begin).not.toHaveBeenCalled();
  });

  test("stop() frees the model only if it was started (StrictMode's trial unmount must not kill it)", async () => {
    const model = fakeModel();
    const store = createToolStore({
      model,
      policy: quietPolicy,
      runtime: fakeRuntime(),
      capability: OK,
    });
    store.start();
    store.stop();
    expect(model.dispose).not.toHaveBeenCalled();
    await store.dispatch(FILE);
    store.stop();
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });

  test("an injected policy means no real model: the stub is ready, with no-op actions", () => {
    const store = createToolStore({
      policy: quietPolicy,
      runtime: fakeRuntime(),
      capability: OK,
    });
    expect(store.model.getState()).toMatchObject({
      phase: "ready",
      path: "webgpu",
    });
    expect(store.model.getState()).toBe(store.model.getState()); // a stable snapshot
  });

  test("a scripted build gets the stub and the scripted replies", async () => {
    vi.stubEnv("VITE_SCRIPTED_POLICY", "1");
    vi.stubGlobal("__ffwdScript", ["one"]);
    const store = createToolStore({ runtime: fakeRuntime(), capability: OK });
    expect(store.model.getState().phase).toBe("ready");
    store.model.consent();
    store.model.decline();
    await store.model.retry();
    expect(await store.model.policy([])).toBe(""); // the stub model itself says nothing; the machine's policy is the script
  });

  test("a normal build gets the real client, idle until a file is chosen", () => {
    const store = createToolStore({ runtime: fakeRuntime(), capability: OK });
    expect(store.model.getState().phase).toBe("idle");
  });

  test("useTool returns { state, dispatch, store, model, modelActions } and the model snapshot follows the client", async () => {
    const model = fakeModel();
    let live = { ...model.getState(), phase: "needsConsent" };
    const subs = new Set();
    model.getState = () => live;
    model.subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));
    let tool;
    function Capture() {
      tool = useTool({
        model,
        policy: quietPolicy,
        runtime: fakeRuntime(),
        capability: OK,
      });
      return <p data-testid="phase">{tool.model.phase}</p>;
    }
    render(<Capture />);
    expect(Object.keys(tool).sort()).toEqual([
      "dispatch",
      "model",
      "modelActions",
      "state",
      "store",
    ]);
    expect(screen.getByTestId("phase").textContent).toBe("needsConsent");
    tool.modelActions.consent();
    tool.modelActions.decline();
    await tool.modelActions.retry();
    expect(
      [model.consent, model.decline, model.retry].map(
        (f) => f.mock.calls.length,
      ),
    ).toEqual([1, 1, 1]);
    act(() => {
      live = { ...live, phase: "downloading" };
      subs.forEach((f) => f());
    });
    expect(screen.getByTestId("phase").textContent).toBe("downloading");
  });
});

// A5: the capability path reaches the model client end to end.
describe("model path from the capability check", () => {
  const run = async (adapter) => {
    const workers = [];
    const model = createModelClient({
      url: "http://localhost/m.gguf",
      isCached: async () => true,
      workerFactory: () => {
        const w = {
          sent: [],
          postMessage: (m) => w.sent.push(m),
          terminate() {},
        };
        workers.push(w);
        return w;
      },
    });
    const store = createToolStore({
      model,
      policy: quietPolicy,
      runtime: fakeRuntime(),
      capability: () =>
        checkCapability({ crossOriginIsolated: true, gpu: {}, adapter }),
    });
    store.start();
    await store.dispatch(FILE);
    await new Promise((r) => setTimeout(r, 0)); // begin() probes the cache first
    return workers[0].sent[0];
  };

  test("a software adapter (SwiftShader) yields the cpu path", async () => {
    const init = await run({
      isFallbackAdapter: true,
      vendor: "google",
      architecture: "swiftshader",
    });
    expect(init).toMatchObject({ type: "init", path: "cpu" });
  });

  test("a real adapter yields the webgpu path", async () => {
    const init = await run({
      isFallbackAdapter: false,
      vendor: "nvidia",
      architecture: "ampere",
    });
    expect(init).toMatchObject({ type: "init", path: "webgpu" });
  });

  test("no adapter at all yields the cpu path", async () => {
    expect(await run(null)).toMatchObject({ path: "cpu" });
  });
});
