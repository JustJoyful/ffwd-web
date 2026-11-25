// Request coverage (an ADDITION beyond the agent's own checks; delete this file and its two call sites to remove it).
// A small, closed English vocabulary: when the person's words name something (a portrait picture, the volume, a cut ...)
// and the confirmed plan changes nothing of that kind compared with the video, say so. It only warns: the person can
// still run. It is deliberately dumb: whole words and phrases, no negation parsing beyond "keep / same / don't change"
// in the same clause as the word, and a concept the spec cannot express is simply reported as not changed.
import { displaySize } from "./checker/quality.js";
import { specEffects } from "./consistency.js";

const isSet = (x) => x !== null && x !== undefined;
const N = "\\d+(?:\\.\\d+)?";

// concept id -> [what the sentence calls it, words/phrases (regex sources, matched as whole words), covered(ctx)]
// "potrait" is the owner's own typo for portrait, kept on purpose.
export const VOCABULARY = {
  portrait: [
    "a portrait picture",
    ["portrait", "potrait", "vertical", "9:16", "tall"],
  ],
  turn: [
    "turning the picture",
    ["rotate", "rotated", "turn", "flip", "upside down", "sideways"],
  ],
  volume: [
    "the volume",
    [
      "louder",
      "quieter",
      "lower the volume",
      "raise the volume",
      "turn it up",
      "turn it down",
      "volume",
    ],
  ],
  mute: [
    "removing the sound",
    ["mute", "silent", "remove the audio", "no sound"],
  ],
  cut: [
    "cutting the video",
    [
      "cut",
      "trim",
      `first ${N} (?:seconds?|secs?|minutes?)`,
      `last ${N} (?:seconds?|secs?|minutes?)`,
      "shorter",
    ],
  ],
  size: [
    "the size of the video",
    [
      "720p",
      "1080p",
      "480p",
      "resolution",
      "smaller",
      "compress",
      `under ${N} ?(?:mb|kb|gb)`,
    ],
  ],
  kind: ["the kind of file", ["gif", "audio only", "extract audio", "mp3"]],
};
export const ORDER = Object.keys(VOCABULARY);

const KEEP = /\b(keep|same|unchanged|(?:don't|do not|dont) change)\b/;
// "turn it up/down" is about the volume, not a turn: take those out before looking for "turn"
const VOLUME_TURN = /\bturn it (?:up|down)\b/g;

const word = (w) => new RegExp(`(?<![\\w:])(?:${w})(?![\\w:])`);

/** Concepts the request mentions, outside a clause that says to keep things. */
export function mentioned(requestText) {
  const text = String(requestText ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'");
  const found = new Set();
  for (const clause of text.split(/[,;.!?\n]|\b(?:but|and|then)\b/)) {
    if (KEEP.test(clause)) continue;
    for (const id of ORDER) {
      let c = clause;
      if (id === "turn") c = c.replace(VOLUME_TURN, " ");
      if (VOCABULARY[id][1].some((w) => word(w).test(c))) found.add(id);
    }
  }
  return found;
}

/**
 * @param {string} requestText what the person typed
 * @param {{ outputs: object[] }} spec the plan
 * @param {object} probe the input's probe
 * @param {{ name?: string, type?: string } | null} [file]
 * @returns {string[]} one sentence per mentioned concept the plan does not change
 */
export function coverageGaps(requestText, spec, probe, file = null) {
  try {
    const o = spec?.outputs?.[0];
    if (!o) return [];
    const fx = specEffects(spec, probe, file);
    const vin = probe?.streams?.find((s) => s.type === "video");
    const ain = probe?.streams?.find((s) => s.type === "audio");
    const v = o.video ?? {};
    const [iw, ih] = vin ? displaySize(vin) : [null, null];
    const differs = (x, y) => isSet(x) && x !== y;
    const covered = {
      // portrait: the plan turns the picture to portrait, or it already is
      portrait: () => ih > iw || fx.orientation === "portrait",
      turn: () => isSet(v.rotation) && v.rotation !== 0,
      volume: () => fx.loudness || o.audio?.present === false || !ain,
      mute: () => o.audio?.present === false || !ain,
      cut: () => fx.trim,
      size: () =>
        differs(v.width, iw) ||
        differs(v.height, ih) ||
        (isSet(o.size_max_bytes) &&
          !(isSet(probe?.size_bytes) && o.size_max_bytes >= probe.size_bytes)),
      kind: () => o.kind !== "video",
    };
    // "mp3" or "gif" typed when the plan already is that kind of file is covered above; a gif needs kind gif
    const wantsGif = /(?<![\w:])gif(?![\w:])/i.test(String(requestText));
    covered.kind = () =>
      wantsGif ? o.kind === "gif" : o.kind === "audio" || o.kind === "gif";
    const said = mentioned(requestText);
    return ORDER.filter((id) => said.has(id) && !covered[id]()).map(
      (id) =>
        `Your request mentions ${VOCABULARY[id][0]}, but this plan doesn't change it.`,
    );
  } catch {
    return [];
  }
}

export const COVERAGE_ADVICE = "Reword your request, or run it anyway.";
