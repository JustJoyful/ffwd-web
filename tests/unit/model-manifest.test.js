// The release manifest ffwd-model.json (D-053): validation against the shared conformance cases, every fail-closed
// reason, the revision-pin rule, URL resolution, the fetch, the client's refusal (nothing downloaded) and the drift guard.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createModelClient } from "../../app/model/client.js";
import { ERROR_CODES, MODEL_ERROR_TEXT } from "../../app/model/contract.js";
import { APP_VERSION, PROTOCOL_VERSION } from "../../app/model/config.js";
import {
  ManifestRefused,
  canaryPrompt,
  configFromManifest,
  loadManifest,
  manifestProblem,
  semverAtLeast,
} from "../../app/model/manifest.js";
import {
  manifestUrlProblem,
  resolveFileUrl,
} from "../../app/model/manifest-url.js";
import reference from "../../app/model/canary-reference.json";
import { MANIFEST_URL, MODEL_CASES, REAL_MANIFEST } from "./model-fixture.js";

const sha = (x) => createHash("sha256").update(x).digest("hex");
const clone = (m = REAL_MANIFEST) => structuredClone(m);
const edit = (fn) => {
  const m = clone();
  fn(m);
  return m;
};

describe("conformance/model-manifest.jsonl", () => {
  test("has two valid cases (first upload, then with weights) and 15 invalid ones", () => {
    expect(MODEL_CASES).toHaveLength(17);
    expect(MODEL_CASES.filter((c) => c.ok)).toHaveLength(2);
  });
  test.each(MODEL_CASES.map((c) => [c.name, c]))(
    "%s: the app's verdict matches `ok`",
    (_n, c) => {
      expect(manifestProblem(c.manifest) === null).toBe(c.ok);
    },
  );
});

describe("fail closed: each reason is refused with a plain sentence", () => {
  test.each([
    [
      "protocol_version differs from the one this app is built for",
      (m) => (m.protocol_version = "9.0.0"),
      /protocol 9\.0\.0, this ffwd speaks/,
    ],
    [
      "min_app_version is newer than the app",
      (m) => (m.min_app_version = "9.9.9"),
      /needs ffwd 9\.9\.9 or newer/,
    ],
    [
      "no shipped model file",
      (m) => (m.files = m.files.filter((f) => f.role !== "shipped")),
      /no single shipped model file/,
    ],
    [
      "two shipped model files",
      (m) =>
        m.files.push({
          ...m.files.find((f) => f.role === "shipped"),
          path: "x.gguf",
        }),
      /no single shipped model file/,
    ],
    [
      "the system prompt file is not in the file list",
      (m) => (m.files = m.files.filter((f) => f.role !== "prompt")),
      /system prompt file is missing/,
    ],
    [
      "a system prompt hash that differs from the app's own prompt",
      (m) => {
        m.prompt.sha256 = "0".repeat(64);
        m.files.find((f) => f.role === "prompt").sha256 = "0".repeat(64);
      },
      /different system prompt/,
    ],
    [
      "a chat template hash that differs from the app's own template",
      (m) => {
        m.chat_template.sha256 = "1".repeat(64);
        m.files.find((f) => f.role === "template").sha256 = "1".repeat(64);
      },
      /different chat template/,
    ],
    [
      "a canary made for another file",
      (m) => (m.canary.file_sha256 = "2".repeat(64)),
      /different file/,
    ],
    [
      "a canary whose rendered prompt hash differs",
      (m) => (m.canary.rendered_prompt_sha256 = "3".repeat(64)),
      /does not match what this ffwd renders/,
    ],
    [
      "a canary whose user turn differs",
      (m) => (m.canary.user_turn += " "),
      /does not match what this ffwd renders/,
    ],
    [
      "a canary that asks for more matches than ids",
      (m) => (m.canary.match.min_matched = 21),
      /inconsistent/,
    ],
    ["canary data absent", (m) => delete m.canary, /not valid \(.*canary/],
    ["a schema violation (extra field)", (m) => (m.surprise = 1), /not valid/],
  ])("%s", (_n, fn, why) => {
    const m = edit(fn);
    expect(manifestProblem(m)).toMatch(why);
    expect(() => configFromManifest(m, MANIFEST_URL)).toThrow(ManifestRefused);
  });
  test("the real manifest is accepted by this build (protocol and app version)", () => {
    expect(REAL_MANIFEST.protocol_version).toBe(PROTOCOL_VERSION);
    expect(semverAtLeast(APP_VERSION, REAL_MANIFEST.min_app_version)).toBe(
      true,
    );
    expect(manifestProblem(REAL_MANIFEST)).toBeNull();
  });
  test("APP_VERSION is package.json's version (one source)", () => {
    expect(APP_VERSION).toBe(
      JSON.parse(readFileSync("package.json", "utf8")).version,
    );
  });
  test("semver order", () => {
    expect(semverAtLeast("1.0.0", "1.0.0")).toBe(true);
    expect(semverAtLeast("1.2.0", "1.10.0")).toBe(false);
    expect(semverAtLeast("2.0.0", "1.99.99")).toBe(true);
  });
  test("model_refused is a contract error code with a sentence and a machine reason", () => {
    expect(ERROR_CODES).toContain("model_refused");
    expect(MODEL_ERROR_TEXT.model_refused).toMatch(/nothing was downloaded/);
  });
});

describe("the config the app gets", () => {
  test("is the manifest's shipped file, resolved against the manifest URL, with its runtime and canary", () => {
    const c = configFromManifest(REAL_MANIFEST, MANIFEST_URL);
    expect(c).toMatchObject({
      version: "ffwd-0.6b-1.0.0",
      file: "ffwd-0.6b-v1.0.0-Q5_K_M.gguf",
      url: "https://huggingface.co/JustJoyful/ffwd-0.6b/resolve/v1.0.0/ffwd-0.6b-v1.0.0-Q5_K_M.gguf",
      bytes: 444411456,
      sha256:
        "bbf439b749c02c04b5227ab93fb1430263a7c567c15552b6e12ae3836cde1e11",
      nCtx: 8192,
      kvCache: "q8_0",
      maxTokens: 512,
    });
    expect(c.canary.minMatch).toBe(18);
    expect(c.canary.tokens).toHaveLength(20);
  });
});

describe("the revision pin and URL resolution", () => {
  test.each([
    "https://huggingface.co/JustJoyful/ffwd-0.6b/resolve/v1.0.0/ffwd-model.json",
    `https://huggingface.co/x/y/resolve/${"a".repeat(40)}/ffwd-model.json`,
    "https://models.example.org/ffwd-0.6b/v1.2.3/ffwd-model.json",
  ])("accepts %s", (u) => expect(manifestUrlProblem(u)).toBeNull());
  test.each([
    ["https://huggingface.co/x/y/resolve/main/ffwd-model.json", /moving/],
    ["https://huggingface.co/x/y/resolve/master/ffwd-model.json", /moving/],
    ["https://huggingface.co/x/y/resolve/latest/ffwd-model.json", /moving/],
    ["https://huggingface.co/x/y/resolve/Main/ffwd-model.json", /moving/],
    ["https://huggingface.co/x/y/resolve/v1.0.0/main/m.json", /moving/],
    [
      "https://huggingface.co/x/y/resolve/refs%2Fheads%2Fmain/m.json",
      /moving|no pinned/,
    ],
    ["https://huggingface.co/x/y/resolve/abc123/ffwd-model.json", /no pinned/],
    ["https://huggingface.co/x/y/resolve/v1/ffwd-model.json", /no pinned/],
    ["http://huggingface.co/x/y/resolve/v1.0.0/m.json", /https/],
    ["https://huggingface.co/x/y/resolve/v1.0.0/m.json?download=1", /query/],
    ["https://huggingface.co/x/y/resolve/v1.0.0/m.json#x", /query/],
    ["", /not a URL/],
    [null, /not a URL/],
  ])("refuses %s", (u, why) => expect(manifestUrlProblem(u)).toMatch(why));
  test("files resolve next to the manifest and never leave its folder", () => {
    expect(resolveFileUrl(MANIFEST_URL, "a/b.gguf")).toBe(
      "https://huggingface.co/JustJoyful/ffwd-0.6b/resolve/v1.0.0/a/b.gguf",
    );
    for (const bad of ["../x", "/x", "https://evil.test/x", "//evil.test/x"])
      expect(() => resolveFileUrl(MANIFEST_URL, bad), bad).toThrow();
  });
});

describe("loadManifest", () => {
  const body = JSON.stringify(REAL_MANIFEST);
  const ok = (text = body) =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    }));
  test("fetches the exact URL with no cookies and no referrer, checks the pinned hash, returns the config", async () => {
    const fetchFn = ok();
    const c = await loadManifest({
      url: MANIFEST_URL,
      sha256: sha(body),
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledWith(MANIFEST_URL, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-cache",
    });
    expect(c.sha256).toBe(REAL_MANIFEST.files[0].sha256);
  });
  test("a manifest that is not the pinned one is refused, even if it is valid", async () => {
    await expect(
      loadManifest({
        url: MANIFEST_URL,
        sha256: "0".repeat(64),
        fetchFn: ok(),
      }),
    ).rejects.toThrow(/not the one this ffwd was built with/);
  });
  test("not JSON, too large: refused; HTTP 404 or a network error: a plain error to retry, not a refusal", async () => {
    const refused = (text) =>
      loadManifest({ url: MANIFEST_URL, sha256: null, fetchFn: ok(text) });
    await expect(refused("<html>")).rejects.toBeInstanceOf(ManifestRefused);
    await expect(refused(" ".repeat(300 * 1024))).rejects.toThrow(/too large/);
    const e404 = loadManifest({
      url: MANIFEST_URL,
      sha256: null,
      fetchFn: async () => ({ ok: false, status: 404 }),
    });
    await expect(e404).rejects.toThrow(/\(404\)/);
    await e404.catch((e) => expect(e).not.toBeInstanceOf(ManifestRefused));
  });
});

describe("the client refuses before anything is downloaded", () => {
  const make = (loadConfig) => {
    const workers = [];
    const isCached = vi.fn(async () => false);
    const client = createModelClient({
      manifestUrl: MANIFEST_URL,
      loadConfig,
      isCached,
      getAdapter: async () => null,
      storage: { getItem: () => null, setItem() {} },
      workerFactory: () => workers.push(1) && {},
    });
    return { client, workers, isCached };
  };
  test("a refused manifest -> failed/model_refused with the reason; no cache lookup, no worker, no download", async () => {
    const { client, workers, isCached } = make(async () => {
      throw new ManifestRefused(
        "the model needs ffwd 9.9.9 or newer (this is 1.0.0).",
      );
    });
    await client.begin("cpu");
    expect(client.getState()).toMatchObject({
      phase: "failed",
      error: { code: "model_refused", message: /9\.9\.9/ },
    });
    expect(workers).toHaveLength(0);
    expect(isCached).not.toHaveBeenCalled();
    await expect(client.policy([])).rejects.toMatchObject({
      code: "model_refused",
    });
  });
  test("a network failure reading the manifest -> load_failed (Try again re-reads it)", async () => {
    let n = 0;
    const { client } = make(async () => {
      if (!n++) throw new Error("offline");
      return configFromManifest(REAL_MANIFEST, MANIFEST_URL);
    });
    await client.begin("cpu");
    expect(client.getState().error.code).toBe("load_failed");
    await client.retry();
    expect(client.getState()).toMatchObject({
      phase: "needsConsent",
      total: 444411456,
    });
  });
});

describe("drift guard: the site's canary file and the manifest agree", () => {
  const c = REAL_MANIFEST.canary;
  test("canary-reference.json (still read by the model repo's release build) equals the manifest's canary", () => {
    expect(reference.tokens).toEqual(c.expected_token_ids);
    expect(reference.prompt).toBe(canaryPrompt(REAL_MANIFEST));
    expect(sha(reference.prompt)).toBe(c.rendered_prompt_sha256);
    expect(reference.model.sha256).toBe(c.file_sha256);
    expect(reference.maxTokens).toBe(c.n_predict);
    expect(reference.promptTokenCount).toBe(c.prompt_tokens);
  });
  const release = resolve(
    "../ffmpeg-agent/releases/ffwd-0.6b-v1.0.0/ffwd-model.json",
  );
  test.skipIf(!existsSync(release))(
    "the model repo's release manifest is the synced conformance one",
    () => {
      expect(JSON.parse(readFileSync(release, "utf8"))).toEqual(REAL_MANIFEST);
    },
  );
});
