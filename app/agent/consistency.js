// Plan-vs-command consistency (product layer, JS only). Before a `run` is executed, what the ffmpeg arguments will do
// (commandEffects) is compared with what the confirmed spec requires (specEffects). Both sides are CONSERVATIVE:
// anything not understood is `null` (no verdict), and only a mismatch between two known values is reported. A
// command that does MORE work the spec is silent about is fine, except changes the person would notice and the plan
// card never mentioned: turning portrait/landscape, removing the sound or picture, cutting, speed.
import { displaySize } from "./checker/quality.js";

const FULL_EPS_S = 0.05; // a cut within this of the whole clip is not a cut
const SIZE_SLACK_PX = 2; // -2 and encoder rounding to even sizes
const FPS_REL = 0.01;
const isSet = (x) => x !== null && x !== undefined;
const num = (s) => {
  const n = Number(s);
  return s !== "" && s !== undefined && s !== null && Number.isFinite(n)
    ? n
    : null;
};
const orient = (w, h) =>
  w === h ? "square" : w > h ? "landscape" : "portrait";

/** Tiny arithmetic evaluator for filter expressions (iw, ih, + - * /, parens, trunc/floor/ceil/round/min/max). */
function evalExpr(src, vars) {
  const s = String(src).replace(/\\/g, "").replace(/'/g, "").replace(/\s/g, "");
  let i = 0;
  const fns = {
    trunc: Math.trunc,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    min: Math.min,
    max: Math.max,
  };
  const bad = new Error("unparsed");
  function primary() {
    if (s[i] === "(") {
      i++;
      const v = sum();
      if (s[i++] !== ")") throw bad;
      return v;
    }
    if (s[i] === "-") {
      i++;
      return -primary();
    }
    const m = /^(\d+\.?\d*|\.\d+)|^([a-z_]+)/.exec(s.slice(i));
    if (!m) throw bad;
    i += m[0].length;
    if (m[1] !== undefined) return Number(m[1]);
    const id = m[2];
    if (s[i] === "(") {
      if (!fns[id]) throw bad;
      i++;
      const a = [sum()];
      while (s[i] === ",") {
        i++;
        a.push(sum());
      }
      if (s[i++] !== ")") throw bad;
      return fns[id](...a);
    }
    const v = vars[id];
    if (!isSet(v)) throw bad;
    return v;
  }
  function prod() {
    let v = primary();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = primary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = prod();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = prod();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = sum();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** "90", "1.5", "00:01:02.5" -> seconds, else null. */
function seconds(t) {
  const p = String(t).split(":");
  if (p.length > 3 || p.some((x) => num(x) === null)) return null;
  return p.reduce((acc, x) => acc * 60 + Number(x), 0);
}

/** Split on `sep` at depth 0, outside quotes, honouring backslash escapes. */
function split(text, sep) {
  const out = [];
  let cur = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") cur += c + (text[++i] ?? "");
    else if (c === "'") {
      quoted = !quoted;
      cur += c;
    } else if (!quoted && c === "(") {
      depth++;
      cur += c;
    } else if (!quoted && c === ")") {
      depth--;
      cur += c;
    } else if (c === sep && !quoted && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}
const chainOf = (s) =>
  split(s, ",")
    .map((f) => f.trim())
    .filter(Boolean);
/** "w=1:h=2" and "1:2" into one lookup by the given positional names. */
function filterArgs(a, names) {
  const pos = [];
  const named = {};
  for (const part of split(a ?? "", ":")) {
    const m = /^([a-z_]+)=(.*)$/.exec(part);
    if (m) named[m[1]] = m[2];
    else pos.push(part);
  }
  names.forEach((n, i) => {
    if (!(n in named) && i < pos.length) named[n] = pos[i];
  });
  return named;
}

// Audio filters whose effect on the sound level is understood (an unlisted one makes the volume unknown).
const AUDIO_KNOWN = new Set([
  "aresample",
  "aformat",
  "anull",
  "asetpts",
  "atrim",
  "atempo",
  "volume",
  "loudnorm",
  "dynaudnorm",
  "alimiter",
  "compand",
  "pan",
  "speechnorm",
  "highpass",
  "lowpass",
]);
const LEVEL_FILTERS = [
  "loudnorm",
  "dynaudnorm",
  "alimiter",
  "compand",
  "pan",
  "speechnorm",
];
// Video filters whose effect on size and turn is known (or nil). Anything else makes the geometry unknown.
const VIDEO_KNOWN = new Set([
  "format",
  "setsar",
  "setdar",
  "fps",
  "setpts",
  "eq",
  "hue",
  "unsharp",
  "hqdn3d",
  "noise",
  "boxblur",
  "gblur",
  "yadif",
  "bwdif",
  "null",
  "fade",
  "colorbalance",
  "curves",
  "framerate",
  "trim",
  "vflip",
  "hflip",
  "transpose",
  "scale",
  "crop",
  "pad",
  "rotate",
]);
const CODECS = {
  libx264: "h264",
  h264: "h264",
  libx265: "hevc",
  hevc: "hevc",
  "libvpx-vp9": "vp9",
  vp9: "vp9",
  aac: "aac",
  libmp3lame: "mp3",
  mp3: "mp3",
  libopus: "opus",
  opus: "opus",
};
const fname = (f) => /^[A-Za-z0-9_]+/.exec(f)?.[0]?.toLowerCase() ?? "";
const fargs = (f) => (f.includes("=") ? f.slice(f.indexOf("=") + 1) : "");

/**
 * What the ffmpeg arguments will do to the first input. Every field is null when it cannot be told.
 * @param {string[]} args the run's arguments (ids still in place)
 * @param {object} probe the input's probe
 */
export function commandEffects(args, probe) {
  const vin = probe?.streams?.find((s) => s.type === "video");
  const ain = probe?.streams?.find((s) => s.type === "audio");
  const e = {
    size: null, // [w, h] of the output picture
    orientation: null,
    rotation: null, // net clockwise degrees, flips excluded
    pictureRemoved: null,
    audioRemoved: null,
    trimmed: null,
    speed: null, // factor, 1 = none
    fps: null,
    vcodec: null,
    acodec: null,
    volume: null, // "none" | "changed" | null (unknown)
  };
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) return e;
  const vf = [];
  const af = [];
  let seenInput = false;
  let ssBeforeInput = false;
  let ss = null;
  let to = null;
  let dur = null;
  let timeBad = false;
  let hasMap = false;
  let complex = false;
  let noAuto = false;
  let rotMeta = null;
  let an = false;
  let vn = false;
  let sOpt = null;
  let copyV = false;
  let copyA = false;
  const time = (v) => {
    const t = seconds(v);
    if (t === null) timeBad = true;
    return t;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "-i") {
      seenInput = true;
      i++;
    } else if (a === "-an") an = true;
    else if (a === "-vn") vn = true;
    else if (a === "-noautorotate") noAuto = true;
    else if (a === "-ss") {
      ss = time(v);
      if (!seenInput) ssBeforeInput = true;
      i++;
    } else if (a === "-to") {
      to = time(v);
      i++;
    } else if (a === "-t") {
      dur = time(v);
      i++;
    } else if (a === "-vf" || a === "-filter:v") {
      vf.push(v ?? "");
      i++;
    } else if (a === "-af" || a === "-filter:a") {
      af.push(v ?? "");
      i++;
    } else if (a === "-filter_complex" || a === "-lavfi") {
      complex = true;
      i++;
    } else if (a === "-map") {
      hasMap = true;
      i++;
    } else if (a === "-r") {
      e.fps = num(v);
      i++;
    } else if (a === "-s") {
      sOpt = String(v).split("x").map(num);
      i++;
    } else if (/^-(c|codec):v(:\d+)?$|^-vcodec$/.test(a)) {
      copyV = v === "copy";
      e.vcodec = copyV ? (vin?.codec ?? null) : (CODECS[v] ?? null);
      i++;
    } else if (/^-(c|codec):a(:\d+)?$|^-acodec$/.test(a)) {
      copyA = v === "copy";
      e.acodec = copyA ? (ain?.codec ?? null) : (CODECS[v] ?? null);
      i++;
    } else if ((a === "-c" || a === "-codec") && v === "copy") {
      copyV = copyA = true;
      e.vcodec = vin?.codec ?? null;
      e.acodec = ain?.codec ?? null;
      i++;
    } else if (/^-metadata(:s:v(:0)?)?$/.test(a) && /^rotate=/.test(v ?? "")) {
      rotMeta = num(v.slice(7));
      i++;
    }
  }

  e.pictureRemoved = vn ? true : hasMap ? null : false;
  e.audioRemoved = an ? true : hasMap ? null : false;
  const vchain = vf.flatMap(chainOf);
  const achain = af.flatMap(chainOf);

  // cut: -ss/-to/-t or trim filters, judged against the whole clip
  const d = probe?.duration_s;
  const trimFilter = [...vchain, ...achain].some((f) => /^a?trim\b/.test(f));
  if (complex || timeBad) e.trimmed = null;
  else if (trimFilter) e.trimmed = true;
  else if (ss === null && to === null && dur === null) e.trimmed = false;
  else if ((ss ?? 0) > FULL_EPS_S) e.trimmed = true;
  else if (dur === null && to === null) e.trimmed = false;
  else if (!isSet(d) || (ssBeforeInput && to !== null && dur === null))
    e.trimmed = null; // an output -to after an input -ss counts from the new start: not told
  else e.trimmed = (dur ?? to) < d - FULL_EPS_S;

  // picture size, turn, speed
  let geom = vin ? [...displaySize(vin)] : null;
  let rot = 0;
  let flipH = 0;
  let flipV = 0;
  let rotKnown = !complex && !noAuto;
  let speed = 1;
  let speedKnown = !complex;
  if (complex || noAuto) geom = null;
  if (!copyV)
    for (const f of vchain) {
      const name = fname(f);
      const a = fargs(f);
      if (!VIDEO_KNOWN.has(name)) {
        geom = null;
        rotKnown = false;
        speedKnown = false;
        continue;
      }
      if (name === "transpose") {
        const names = { cclock_flip: 0, clock: 1, cclock: 2, clock_flip: 3 };
        const raw = filterArgs(a, ["dir"]).dir ?? "0";
        const dir = raw in names ? names[raw] : num(raw);
        if (geom) geom = [geom[1], geom[0]];
        if (dir === 1) rot += 90;
        else if (dir === 2) rot += 270;
        else rotKnown = false; // a transpose with a flip: the net turn is not told
      } else if (name === "rotate") {
        const turn = { "PI/2": 90, "-PI/2": 270, PI: 180, "-PI": 180 }[
          split(a, ":")[0].replace(/\s/g, "")
        ];
        if (turn === undefined) {
          geom = null;
          rotKnown = false;
        } else {
          rot += turn;
          if (turn !== 180 && geom) geom = [geom[1], geom[0]];
        }
      } else if (name === "hflip") flipH++;
      else if (name === "vflip") flipV++;
      else if (name === "scale" || name === "crop" || name === "pad") {
        if (name === "scale" && /force_original_aspect_ratio/.test(a)) {
          geom = null;
          continue;
        }
        if (!geom) continue;
        const [iw, ih] = geom;
        const n = filterArgs(a, ["w", "h"]);
        const vars = { iw, ih, in_w: iw, in_h: ih, ow: iw, oh: ih };
        let w = isSet(n.w) ? evalExpr(n.w, vars) : iw;
        let h = isSet(n.h) ? evalExpr(n.h, vars) : ih;
        if (name === "scale") {
          // -1 and -2 keep the aspect ratio (-2 rounds to an even number)
          if (w !== null && w < 0 && h !== null && h > 0)
            w = Math.round((h * iw) / ih / 2) * 2;
          else if (h !== null && h < 0 && w !== null && w > 0)
            h = Math.round((w * ih) / iw / 2) * 2;
          if (w !== null && w < 0) w = null;
          if (h !== null && h < 0) h = null;
        }
        geom = w !== null && h !== null ? [Math.round(w), Math.round(h)] : null;
      } else if (name === "setpts") {
        const p = a.replace(/\s/g, "");
        let m;
        if (p === "PTS-STARTPTS" || p === "PTS") speed *= 1;
        else if ((m = /^PTS\/([\d.]+)$/.exec(p))) speed *= Number(m[1]);
        else if ((m = /^([\d.]+)\*PTS$/.exec(p))) speed /= Number(m[1]);
        else speedKnown = false;
      } else if (name === "fps") e.fps = num(filterArgs(a, ["fps"]).fps);
    }
  if (flipH % 2 && flipV % 2) rot += 180;
  if (rotMeta !== null) {
    if (copyV) rot += (360 - (rotMeta % 360)) % 360;
    else rotKnown = false;
  }
  if (sOpt?.length === 2 && sOpt.every(isSet)) geom = sOpt;
  if (vn) geom = null;
  e.rotation = rotKnown ? ((rot % 360) + 360) % 360 : null;
  e.size = geom;
  if (geom) e.orientation = orient(geom[0], geom[1]);

  // sound level
  let volume = complex || an ? null : "none";
  if (!copyA && !complex)
    for (const f of achain) {
      const name = fname(f);
      const a = fargs(f);
      if (!AUDIO_KNOWN.has(name)) {
        if (volume === "none") volume = null;
        speedKnown = false;
      } else if (name === "volume") {
        const raw = (filterArgs(a, ["volume"]).volume ?? "").replace(/'/g, "");
        const db = /^(-?[\d.]+)dB$/i.exec(raw);
        const g = db ? 10 ** (Number(db[1]) / 20) : num(raw);
        if (g === null || Math.abs(g - 1) > 1e-6) volume = "changed";
      } else if (LEVEL_FILTERS.includes(name)) volume = "changed";
      else if (name === "atempo") speed *= num(a) ?? NaN;
    }
  e.volume = volume;
  e.speed = speedKnown && Number.isFinite(speed) ? speed : null;
  return e;
}

/**
 * What the confirmed spec requires, compared with the input. `null` = not constrained.
 * `changesNothing` is true when every field the spec sets already equals the input (or is null): ONE video output
 * (or an audio output from a picture-less input) whose container, cut, size, turn, frame rate, codecs and sound all
 * match the probe, with no loudness target, no non-zero sync offset and no frames/gif. Quality floors, lossless and a
 * size limit the input already meets are constraints, not changes.
 * @param {{ outputs: object[] }} spec
 * @param {object} probe
 */
export function specEffects(spec, probe) {
  const o = spec?.outputs?.[0];
  const e = {
    orientation: null,
    width: null,
    height: null,
    rotation: null,
    audioPresent: null,
    loudness: false,
    trim: false,
    fps: null,
    vcodec: null,
    acodec: null,
    changesNothing: false,
  };
  if (!o) return e;
  const vin = probe?.streams?.find((s) => s.type === "video");
  const ain = probe?.streams?.find((s) => s.type === "audio");
  const v = o.video ?? {};
  const a = o.audio ?? {};
  const t = o.time ?? {};
  const [iw, ih] = vin ? displaySize(vin) : [null, null];
  e.width = v.width ?? null;
  e.height = v.height ?? null;
  e.rotation = v.rotation ?? null;
  e.fps = v.fps ?? null;
  e.vcodec = v.codec ?? null;
  e.acodec = a.codec ?? null;
  e.audioPresent = a.present ?? null;
  e.loudness = isSet(a.loudness_lufs);
  if (isSet(v.width) && isSet(v.height))
    e.orientation = orient(v.width, v.height);
  else if (isSet(v.rotation) && iw && v.rotation % 180 === 90)
    e.orientation = orient(ih, iw);
  const d = probe?.duration_s;
  e.trim =
    (isSet(t.start_s) && t.start_s > FULL_EPS_S) ||
    (isSet(t.end_s) && (!isSet(d) || t.end_s < d - FULL_EPS_S));

  const same = (x, y) => !isSet(x) || x === y;
  const containers = String(probe?.container ?? "").split(",");
  e.changesNothing =
    spec.outputs.length === 1 &&
    ((o.kind === "video" && Boolean(vin)) || (o.kind === "audio" && !vin)) &&
    same(o.container, containers.includes(o.container) ? o.container : null) &&
    !e.trim &&
    same(v.width, iw) &&
    same(v.height, ih) &&
    same(v.rotation, vin?.rotation ?? 0) &&
    (!isSet(v.fps) ||
      (Boolean(vin) && Math.abs(v.fps - vin.fps) <= vin.fps * FPS_REL)) &&
    same(v.codec, vin?.codec) &&
    same(v.pix_fmt, vin?.pix_fmt) &&
    (!isSet(a.present) || a.present === Boolean(ain)) &&
    same(a.codec, ain?.codec) &&
    !e.loudness &&
    (!isSet(a.offset_ms) || a.offset_ms === 0) &&
    (!isSet(o.size_max_bytes) ||
      (isSet(probe?.size_bytes) && o.size_max_bytes >= probe.size_bytes));
  return e;
}

/**
 * Plain-language mismatches between the confirmed spec and the command. Empty means none was found, which also
 * covers "could not tell". Never throws.
 * @param {{ outputs: object[] }} spec
 * @param {object} probe
 * @param {string[]} args
 * @returns {string[]}
 */
export function consistencyProblems(spec, probe, args) {
  try {
    const o = spec?.outputs?.[0];
    if (!o || spec.outputs.length !== 1 || !["video", "audio"].includes(o.kind))
      return [];
    const vin = probe?.streams?.find((s) => s.type === "video");
    const ain = probe?.streams?.find((s) => s.type === "audio");
    const s = specEffects(spec, probe);
    const c = commandEffects(args, probe);
    const out = [];
    const audioKind = o.kind === "audio";
    const [iw, ih] = vin ? displaySize(vin) : [null, null];

    if (vin && !audioKind) {
      if (c.pictureRemoved === true)
        out.push("The command removes the picture, but the plan keeps it.");
      if (c.size) {
        const [w, h] = c.size;
        const off = (want, got) =>
          isSet(want) && Math.abs(want - got) > SIZE_SLACK_PX;
        if (s.orientation && c.orientation && s.orientation !== c.orientation)
          out.push(
            `The plan asks for a ${s.orientation} picture, but the command makes a ${c.orientation} one.`,
          );
        else if (off(s.width, w) || off(s.height, h))
          out.push(
            `The plan asks for a picture ${s.width ?? "any width"} × ${s.height ?? "any height"}, but the command makes it ${w} × ${h}.`,
          );
        else if (
          !isSet(s.width) &&
          !isSet(s.height) &&
          !isSet(s.rotation) &&
          c.orientation !== "square" &&
          c.orientation !== orient(iw, ih)
        )
          out.push(
            `The plan keeps the picture ${orient(iw, ih)}, but the command makes it ${c.orientation}.`,
          );
      }
      if (isSet(s.rotation) && c.rotation !== null && c.rotation !== s.rotation)
        out.push(
          s.rotation === 0
            ? "The plan doesn't turn the picture, but the command does."
            : `The plan turns the picture ${s.rotation} degrees clockwise, but the command ${c.rotation === 0 ? "doesn't turn it" : `turns it ${c.rotation} degrees`}.`,
        );
      const fps = c.fps ?? vin.fps;
      if (isSet(s.fps) && isSet(fps) && Math.abs(fps - s.fps) > s.fps * FPS_REL)
        out.push(
          `The plan asks for ${s.fps} frames per second, but the command makes ${fps}.`,
        );
      if (s.vcodec && c.vcodec && c.vcodec !== s.vcodec)
        out.push(
          `The plan asks for ${s.vcodec.toUpperCase()} video, but the command makes ${c.vcodec.toUpperCase()}.`,
        );
    }
    if (ain) {
      if (c.audioRemoved === true && s.audioPresent !== false)
        out.push("The command removes the sound, but the plan keeps it.");
      if (c.audioRemoved === false && s.audioPresent === false)
        out.push("The plan removes the sound, but the command keeps it.");
      if (s.loudness && c.audioRemoved === false && c.volume === "none")
        out.push(
          "The plan changes how loud the sound is, but the command doesn't change the volume.",
        );
      if (
        s.acodec &&
        c.acodec &&
        c.audioRemoved === false &&
        c.acodec !== s.acodec
      )
        out.push(
          `The plan asks for ${s.acodec.toUpperCase()} sound, but the command makes ${c.acodec.toUpperCase()}.`,
        );
    }
    if (c.trimmed === false && s.trim)
      out.push("The plan cuts the video, but the command keeps all of it.");
    if (c.trimmed === true && !s.trim)
      out.push("The command cuts the video, but the plan keeps all of it.");
    if (
      c.speed !== null &&
      Math.abs(c.speed - 1) > 1e-6 &&
      !isSet(o.time?.start_s) &&
      !isSet(o.time?.end_s)
    )
      out.push("The command changes the speed, but the plan doesn't.");
    return out;
  } catch {
    return [];
  }
}
