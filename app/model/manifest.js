// Reads and checks the release manifest ffwd-model.json (D-053) before anything of the model is downloaded, and turns it
// into the one config object the client, the worker and the loader UI use. FAILS CLOSED: any doubt throws a
// ManifestRefused with a plain sentence; there is no fallback to built-in defaults. Loaded lazily (only when a file has
// been chosen), so the marketing pages do not carry it.
//
// What a build is pinned to (config.js): APP_VERSION and PROTOCOL_VERSION at build time, plus (optionally, and required
// by `pnpm check:release`) the sha256 of the manifest file itself. What the manifest must agree with, byte for byte, is
// the app's OWN prompt and chat template: the system prompt text and template shipped in protocol/prompts, and the
// canary prompt re-rendered here with the app's own renderChat (byte-identity tested against the golden renders).
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../protocol/schemas/model.schema.json";
import SYSTEM_PROMPT from "../../protocol/prompts/system-v1.txt?raw";
import TEMPLATE from "../../protocol/prompts/chat-template.jinja?raw";
import { renderChat } from "../agent/chat-template.js";
import {
  APP_VERSION,
  PROTOCOL_VERSION,
  modelManifestSha256,
  modelManifestUrl,
} from "./config.js";
import { resolveFileUrl } from "./manifest-url.js";
import { createSha256 } from "./sha256.js";

/** The manifest is tiny; anything bigger is not one. */
export const MANIFEST_MAX_BYTES = 256 * 1024;

/** Thrown when the manifest must not be used. `message` is a plain sentence the loader shows. */
export class ManifestRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestRefused";
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

const sha256Of = (text) =>
  createSha256()
    .update(typeof text === "string" ? new TextEncoder().encode(text) : text)
    .digest();

/** "1.2.3" -> [1,2,3]; the schema has already checked the shape. */
const parts = (v) => v.split(/[-+]/)[0].split(".").map(Number);
/** a >= b by semver precedence of the numeric parts (pre-release tags are not used by releases). */
export function semverAtLeast(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
}

/** The first thing wrong with a manifest object, or null. Pure: no network, no globals but the build's own constants. */
export function manifestProblem(m, { appVersion = APP_VERSION } = {}) {
  if (!validateSchema(m)) {
    const e = validateSchema.errors[0];
    return `the model description is not valid (${e.instancePath || "/"} ${e.message}).`;
  }
  if (m.protocol_version !== PROTOCOL_VERSION)
    return `the model speaks protocol ${m.protocol_version}, this ffwd speaks ${PROTOCOL_VERSION}.`;
  if (!semverAtLeast(appVersion, m.min_app_version))
    return `the model needs ffwd ${m.min_app_version} or newer (this is ${appVersion}).`;
  const shipped = m.files.filter(
    (f) => f.role === "shipped" && f.format === "gguf",
  );
  if (shipped.length !== 1)
    return "the model description lists no single shipped model file.";
  const byPath = new Map(m.files.map((f) => [f.path, f]));
  for (const [what, ref] of [
    ["system prompt", m.prompt],
    ["chat template", m.chat_template],
  ])
    if (byPath.get(ref.file)?.sha256 !== ref.sha256)
      return `the ${what} file is missing from the model's file list or differs from it.`;
  if (sha256Of(SYSTEM_PROMPT) !== m.prompt.sha256)
    return "the model was trained on a different system prompt than this ffwd sends.";
  if (sha256Of(TEMPLATE) !== m.chat_template.sha256)
    return "the model was trained on a different chat template than this ffwd uses.";
  const c = m.canary;
  if (c.file_sha256 !== shipped[0].sha256)
    return "the graphics-chip check in the model description is for a different file.";
  if (
    c.expected_token_ids.length !== c.match.of ||
    c.n_predict !== c.match.of ||
    c.match.min_matched > c.match.of
  )
    return "the graphics-chip check in the model description is inconsistent.";
  if (sha256Of(canaryPrompt(m)) !== c.rendered_prompt_sha256)
    return "the graphics-chip check prompt does not match what this ffwd renders.";
  return null;
}

/** The canary prompt, rendered by the app's own chat template (never stored in the manifest). */
export const canaryPrompt = (m) =>
  renderChat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: m.canary.user_turn },
  ]);

/**
 * @typedef {{ name: string, version: string, file: string, url: string, bytes: number, sha256: string, nCtx: number, kvCache: "q8_0" | "f16", maxTokens: number, canary: { prompt: string, tokens: number[], minMatch: number } }} ModelConfig
 */

/**
 * A validated manifest as the one config object the app uses.
 * @param {any} m a manifest that passed manifestProblem
 * @param {string} manifestUrl where it was fetched from; the shipped file's URL is resolved against it
 */
export function toModelConfig(m, manifestUrl) {
  const f = m.files.find((x) => x.role === "shipped" && x.format === "gguf");
  return {
    name: m.name,
    version: `${m.name}-${m.version}`,
    file: f.path,
    url: resolveFileUrl(manifestUrl, f.path),
    bytes: f.size_bytes,
    sha256: f.sha256,
    nCtx: m.runtime.n_ctx,
    kvCache: m.runtime.kv_cache_type,
    maxTokens: m.runtime.max_tokens,
    canary: {
      prompt: canaryPrompt(m),
      tokens: m.canary.expected_token_ids,
      minMatch: m.canary.match.min_matched,
    },
  };
}

/** Validate an already-parsed manifest and return the config; throws ManifestRefused. */
export function configFromManifest(m, manifestUrl, opts) {
  const why = manifestProblem(m, opts);
  if (why) throw new ManifestRefused(why);
  return toModelConfig(m, manifestUrl);
}

/**
 * Fetch the manifest and return the config. The request carries nothing of the person: no cookies, no referrer (the page
 * address may hold ?ask= text), no query string. A network failure or a non-200 is a plain Error (the person may retry);
 * everything wrong with the CONTENT is a ManifestRefused.
 * @param {{ url?: string, sha256?: string | null, fetchFn?: typeof fetch, appVersion?: string }} [o]
 */
export async function loadManifest({
  url = modelManifestUrl(),
  sha256 = modelManifestSha256(),
  fetchFn = fetch,
  appVersion,
} = {}) {
  const r = await fetchFn(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-cache",
  });
  if (!r.ok)
    throw new Error(`the model description could not be fetched (${r.status})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MANIFEST_MAX_BYTES)
    throw new ManifestRefused("the model description is too large.");
  if (sha256 && sha256Of(bytes) !== sha256)
    throw new ManifestRefused(
      "the model description is not the one this ffwd was built with.",
    );
  let m;
  try {
    m = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ManifestRefused("the model description is not readable.");
  }
  return configFromManifest(m, url, { appVersion });
}
