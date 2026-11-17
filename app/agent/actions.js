// Parse one model reply into one protocol action. JavaScript port of training/env/actions.py: the same parser is
// used for every system, so formatting quirks (a <think> block, a ```json fence) are handled identically.
// Unlike the Phase 0 spike (structural checks only) this validates against action.schema.json, as Python does.
import { validateAction } from "./protocol/validate.js";

/**
 * @typedef {{ action: "spec", spec: object }
 *   | { action: "ask_user", question: string }
 *   | { action: "unsupported", reason: string, nearest_supported?: string[] | null }
 *   | { action: "run", args: string[], inputs: string[], outputs: string[] }
 *   | { action: "finish", outputs: string[], note?: string }} Action
 */

const THINK = /<think>[\s\S]*?<\/think>/g;
const FENCE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
const SCALAR =
  /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|"(?:[^"\\]|\\.)*")/;

/** Index just past the first JSON value at the start of `s` (what Python's raw_decode returns), or -1. */
function firstValueEnd(s) {
  if (s[0] === "{" || s[0] === "[") {
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (--depth === 0) return i + 1;
      }
    }
    return -1;
  }
  return SCALAR.exec(s)?.[0].length ?? -1;
}

const tryParse = (s) => {
  try {
    return { value: JSON.parse(s) };
  } catch {
    return null;
  }
};

/**
 * @param {string} text the raw assistant reply
 * @returns {Action | { error: string }}
 */
export function parseAction(text) {
  if (typeof text !== "string") return { error: "reply must be text" };
  let body = text.replace(THINK, "").trim();
  const fence = FENCE.exec(body);
  if (fence) body = fence[1].trim();
  const parsed = tryParse(body);
  if (!parsed) {
    // Valid JSON followed by prose gets its own message, as in Python. For truncated or garbled JSON the
    // Python text names the exact syntax error; here it is always "Expecting value" (shortcut: text only).
    const end = firstValueEnd(body);
    if (end > 0 && tryParse(body.slice(0, end)) && body.slice(end).trim())
      return {
        error:
          "extra text after the JSON object; reply with exactly one JSON object",
      };
    return { error: "reply is not a JSON object: Expecting value" };
  }
  const obj = parsed.value;
  if (typeof obj !== "object" || obj === null || Array.isArray(obj))
    return { error: "reply must be a JSON object" };
  // Python reports one root error for a oneOf mismatch; the per-branch errors would only add noise for a model.
  if (!validateAction(obj).ok)
    return {
      error: `invalid action: <root>: ${JSON.stringify(obj)} is not valid under any of the given schemas`,
    };
  return /** @type {Action} */ (obj);
}
