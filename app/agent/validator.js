// Allowlist validator for model `run` actions (RULES §1.2, ARCHITECTURE §3.5). JavaScript port of
// training/env/validator.py (and spikes/browser/src/validator.ts). Kept in step with it ONLY by
// protocol/conformance/validator.jsonl (RULES §4.8): change both sides or neither.
//
// Anything not explicitly allowed is rejected. The model never writes paths: files appear only as {in:<id>}
// right after -i and {out:<id>} as positionals; the executor maps ids to real paths. Every branch returns a
// reason; nothing throws on hostile input.
import allowlist from "../../protocol/allowlist.json";
import action from "../../protocol/schemas/action.schema.json";

// Limits the Python loop gets from action.schema.json (parse_action validates before validate_run). Read here too
// so the allowlist is safe on its own, without a second copy of the numbers.
const RUN = action.$defs.run.properties.args;
const MAX_ARGS = RUN.maxItems;
const MAX_ARG_LEN = RUN.items.maxLength;

const IN = /^\{in:([a-z][a-z0-9_]{0,15})\}$/;
const OUT = /^\{out:([a-z][a-z0-9_]{0,15})\}$/;
const OPT = /^(-[a-z_]+)((?::[a-z0-9]+)*)$/; // base name + optional :stream-spec
// Python uses re.fullmatch; every pattern is anchored and wrapped so the alternations stay whole.
const KIND_RE = Object.fromEntries(
  Object.entries({
    time: String.raw`-?\d+(\.\d+)?|-?\d{1,2}:\d{2}(:\d{2})?(\.\d+)?`,
    number: String.raw`-?\d+(\.\d+)?(/\d+)?`,
    int: String.raw`-?\d+`,
    bitrate: String.raw`\d+(\.\d+)?[kKmM]?`,
    map: String.raw`-?\[?[A-Za-z0-9_:]+\]?\??`,
    metadata: String.raw`[a-z_]+=[A-Za-z0-9 _.:-]{0,64}`,
  }).map(([k, v]) => [k, new RegExp(`^(?:${v})$`)]),
);
const LABEL = /^[A-Za-z0-9_:]+$/;
const FILTER_NAME = /^[a-z0-9_]+$/;
const PROTOCOL_OR_PATH = /[A-Za-z][A-Za-z0-9+.-]*:\/|\.\./;
const CODEC_OPTS = ["-c", "-codec", "-vcodec", "-acodec"];
const FILTER_OPTS = ["-vf", "-af", "-filter", "-filter_complex"];

/** @typedef {{ ok: boolean, reason: string | null }} ValidationResult */

class Reject extends Error {}

/** Python's repr() for the strings that appear in reasons, so messages match the Python text. */
function pyRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replaceAll(q, `\\${q}`);
  return q + body + q;
}

/** Split on , and ; outside [labels], '...' quotes and backslash escapes (the tokenisation FFmpeg applies). */
function splitGraph(graph) {
  const parts = [];
  let buf = "";
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < graph.length; i++) {
    const ch = graph[i];
    if (ch === "\\" && i + 1 < graph.length) {
      buf += graph.slice(i, i + 2);
      i++;
      continue;
    }
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === "[") bracket = true;
    else if (!quoted && ch === "]") bracket = false;
    else if (!quoted && !bracket && (ch === "," || ch === ";")) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (quoted || bracket)
    throw new Reject("unbalanced quote or bracket in filtergraph");
  parts.push(buf);
  return parts;
}

function checkFiltergraph(graph) {
  for (const part of splitGraph(graph)) {
    // Strip leading/trailing [label] pads around the filter.
    const m = /^((?:\[[^\]]*\])*)([^[\]]*)((?:\[[^\]]*\])*)$/.exec(part.trim());
    if (!m) throw new Reject(`bad filter syntax: ${pyRepr(part)}`);
    for (const lm of (m[1] + m[3]).matchAll(/\[([^\]]*)\]/g)) {
      if (!LABEL.test(lm[1]))
        throw new Reject(`bad filter label: ${pyRepr(lm[1])}`);
    }
    const eq = m[2].indexOf("=");
    const name = eq < 0 ? m[2] : m[2].slice(0, eq);
    const fargs = eq < 0 ? "" : m[2].slice(eq + 1);
    if (!FILTER_NAME.test(name))
      throw new Reject(`bad filter syntax: ${pyRepr(part)}`);
    if (!allowlist.filters.includes(name))
      throw new Reject(`filter not allowed: ${name}`);
    if (PROTOCOL_OR_PATH.test(fargs))
      throw new Reject(`bad filter arguments for ${name}`);
  }
}

function checkValue(opt, kind, value) {
  const bad = () => new Reject(`bad value for ${opt}: ${pyRepr(value)}`);
  if (kind === "codec") {
    if (value !== "copy" && !allowlist.encoders.includes(value))
      throw new Reject(`codec not allowed: ${value}`);
  } else if (kind === "filtergraph") checkFiltergraph(value);
  else if (kind === "pix_fmt") {
    if (!allowlist.pix_fmts.includes(value)) throw bad();
  } else if (kind === "muxer") {
    if (!allowlist.muxers.includes(value))
      throw new Reject(`muxer not allowed: ${value}`);
  } else if (kind.startsWith("enum:")) {
    if (!kind.slice(5).split(",").includes(value)) throw bad();
  } else if (!KIND_RE[kind]?.test(value)) throw bad();
}

/** Validate every token; return the input and output ids in order of appearance. */
function walk(args) {
  const usedIn = [];
  const usedOut = [];
  let i = 0;
  while (i < args.length) {
    const tok = args[i];
    let m;
    if (tok === "-i") {
      m = i + 1 < args.length ? IN.exec(args[i + 1]) : null;
      if (!m) throw new Reject("input must be {in:<id>}");
      usedIn.push(m[1]);
      i += 2;
    } else if (tok.startsWith("-")) {
      m = OPT.exec(tok);
      if (!m || !Object.hasOwn(allowlist.options, m[1]))
        throw new Reject(`option not allowed: ${tok}`);
      const kind = allowlist.options[m[1]];
      if (kind === "flag") {
        i += 1;
        continue;
      }
      if (i + 1 >= args.length) throw new Reject(`missing value for ${tok}`);
      checkValue(tok, kind, args[i + 1]);
      i += 2;
    } else if ((m = OUT.exec(tok))) {
      usedOut.push(m[1]);
      i += 1;
    } else {
      throw new Reject(`unexpected positional argument: ${pyRepr(tok)}`);
    }
  }
  return [usedIn, usedOut];
}

function checkIds(used, declared, known, unique) {
  for (const x of used)
    if (!known.has(x) || !declared.includes(x))
      throw new Reject(`unknown id: ${x}`);
  if (unique) {
    // Python reports the first duplicate in sorted order.
    const dup = [
      ...new Set(used.filter((x, i) => used.indexOf(x) !== i)),
    ].sort()[0];
    if (dup !== undefined) throw new Reject(`used more than once: ${dup}`);
    // Stricter than Python: a duplicate DECLARED output is rejected (Python's executor would silently merge it).
    const dd = declared.find((x, i) => declared.indexOf(x) !== i);
    if (dd !== undefined) throw new Reject(`declared more than once: ${dd}`);
  }
  for (const x of declared)
    if (!used.includes(x)) throw new Reject(`declared but not used: ${x}`);
}

const isStrList = (x) =>
  Array.isArray(x) && x.every((s) => typeof s === "string");

/**
 * Validate one model `run` action against the allowlist.
 * @param {string[]} args FFmpeg arguments exactly as the model wrote them (never a shell string)
 * @param {string[]} inputs input ids the action declares
 * @param {string[]} outputs output ids the action declares
 * @param {{ inputs: Set<string>, outputs: Set<string> }} [known] the ids this job really has; defaults to the
 *   declared lists (the conformance cases), the machine always passes the job's real ids
 * @returns {ValidationResult}
 */
export function validateRun(args, inputs, outputs, known) {
  try {
    if (!isStrList(args)) throw new Reject("args must be a list of strings");
    if (!isStrList(inputs) || !isStrList(outputs))
      throw new Reject("inputs and outputs must be lists of strings");
    if (args.length > MAX_ARGS)
      throw new Reject(`too many arguments (at most ${MAX_ARGS})`);
    if (args.some((a) => a.length > MAX_ARG_LEN))
      throw new Reject(`argument too long (at most ${MAX_ARG_LEN} characters)`);
    const k = known ?? { inputs: new Set(inputs), outputs: new Set(outputs) };
    const [usedIn, usedOut] = walk(args);
    // Inputs may repeat (`-i x -itsoffset 0.5 -i x` is the A/V-offset idiom); outputs may not.
    checkIds(usedIn, inputs, k.inputs, false);
    checkIds(usedOut, outputs, k.outputs, true);
    return { ok: true, reason: null };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    throw e;
  }
}

/**
 * True when every codec option is `copy` and no filter is applied (no re-encode).
 * @param {string[]} args
 * @returns {boolean}
 */
export function usesStreamCopyOnly(args) {
  const codecs = [];
  let filtered = false;
  args.forEach((opt, i) => {
    const base = String(opt).split(":")[0];
    if (CODEC_OPTS.includes(base)) codecs.push(args[i + 1] ?? "");
    else if (FILTER_OPTS.includes(base)) filtered = true;
  });
  return codecs.length > 0 && codecs.every((c) => c === "copy") && !filtered;
}
