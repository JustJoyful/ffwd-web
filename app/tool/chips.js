// The plan chips: what the person confirms before anything runs, built from the model's spec in the vocabulary of the
// home page (Keep, Length, Picture, Format, Size, Sound, ...). Only fields the spec sets are named as changes; the
// rest read "unchanged". The same file maps a chip to the FFmpeg flags that implement it, for the command reveal.
import { displaySize } from "../agent/checker/quality.js";
import { substitute } from "../agent/executor/harness-args.js";
import { fmt } from "../lib/format.js";

/** @typedef {[label: string, value: string, changed?: 1]} Chip */

const isSet = (x) => x !== null && x !== undefined;
const setFields = (o) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => isSet(v)));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const mb = (n) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)} MB`
    : `${Math.round(n / 1000)} KB`;
const TURN = { 0: "none", 90: "right", 180: "upside down", 270: "left" };

/**
 * @param {{ outputs: object[] }} spec a validated spec (the first output is shown)
 * @param {object} inputProbe probe of the person's video
 * @returns {Chip[]} changed chips first, then the ones that stay as they are
 */
export function chipsFromSpec(spec, inputProbe) {
  const o = spec.outputs[0];
  const changed = [];
  const same = [];
  const put = (label, value, isChange = true) =>
    (isChange ? changed : same).push(
      isChange ? [label, value, 1] : [label, value],
    );
  const d = inputProbe?.duration_s;

  if (o.kind === "image_sequence") {
    const f = setFields(o.frames);
    if ("interval_s" in f) put("Pictures", `one every ${f.interval_s} s`);
    if ("expected_count" in f) put("Count", String(f.expected_count));
    if ("format" in f) put("Format", f.format.toUpperCase(), false);
    if (spec.outputs.length > 1) put("Results", String(spec.outputs.length));
    return [...changed, ...same];
  }

  const t = setFields(o.time);
  const { start_s: a, end_s: b } = t;
  const end = isSet(b) ? b : d;
  if (isSet(a) || isSet(b)) {
    const from = a ?? 0;
    put(
      "Keep",
      isSet(end) ? `${fmt(from)} to ${fmt(end)}` : `from ${fmt(from)}`,
    );
    if (isSet(end)) put("Length", fmt(end - from));
  } else same.push(["Length", "unchanged"]);

  if (isSet(o.size_max_bytes)) put("Size", `under ${mb(o.size_max_bytes)}`);

  const v = setFields(o.video);
  const inp = inputProbe?.streams?.find((s) => s.type === "video");
  const [iw, ih] = inp ? displaySize(inp) : [null, null];
  if ("width" in v && "height" in v) {
    const same_ = v.width === iw && v.height === ih;
    put("Picture", `${v.width} × ${v.height}`, !same_);
    if (!same_ && iw && Math.abs(v.width / v.height - iw / ih) > 0.01) {
      const g = gcd(v.width, v.height);
      put("Crop", `centre, ${v.width / g}:${v.height / g}`);
    }
  } else if ("height" in v) put("Picture", `${v.height} px high`);
  else if ("width" in v) put("Picture", `${v.width} px wide`);
  else same.push(["Picture", "unchanged"]);
  if ("rotation" in v) put("Turn", TURN[v.rotation] ?? `${v.rotation}°`);
  if ("fps" in v) put("Frame rate", `${v.fps} per second`);

  const container = o.container?.toUpperCase();
  if (container && v.codec === "h264" && o.container === "mp4")
    put("Format", "MP4 that plays widely");
  else if (container) put("Format", container);
  else if (v.codec) put("Format", v.codec.toUpperCase());
  else same.push(["Format", "unchanged"]);

  const au = setFields(o.audio);
  if (au.present === false) put("Sound", "removed");
  else if (au.present === true) put("Sound", "kept", false);
  if ("loudness_lufs" in au) put("Loudness", `about ${au.loudness_lufs} LUFS`);
  if ("offset_ms" in au)
    put("Sound sync", au.offset_ms === 0 ? "in sync" : `${au.offset_ms} ms`);
  if (o.lossless) put("Quality", "untouched, no re-encoding");
  else if (Object.keys(setFields(o.quality)).length)
    put("Quality", "close to the original");
  if (spec.outputs.length > 1) put("Results", String(spec.outputs.length));
  return [...changed, ...same];
}

// Which FFmpeg flags implement a chip. A flag listed here is highlighted together with the value after it.
const FILTER = ["-vf", "-filter:v", "-filter_complex", "-s", "-aspect"];
const CHIP_FLAGS = {
  Keep: ["-ss", "-to", "-t"],
  Length: ["-ss", "-to", "-t"],
  Size: ["-crf", "-b:v", "-maxrate", "-bufsize", "-fs", "-q:v"],
  Picture: FILTER,
  Crop: FILTER,
  Turn: FILTER,
  "Frame rate": ["-r", ...FILTER],
  Format: ["-c:v", "-vcodec", "-codec:v", "-c", "-pix_fmt", "-movflags", "-f"],
  Sound: ["-an", "-c:a", "-acodec", "-b:a", "-af", "-ar", "-ac"],
  Loudness: ["-af", "-filter:a"],
  "Sound sync": ["-itsoffset", "-af", "-filter:a"],
  Quality: ["-c", "-c:v", "-crf"],
  Pictures: ["-vf", "-r", "-q:v", "-fps_mode", "-vsync"],
  Count: ["-frames:v", "-vframes", "-vf"],
};
const NO_VALUE = new Set(["-an", "-vn", "-y"]);

/**
 * Positions in `args` (display arguments, after "ffmpeg") that implement the chip.
 * @param {string} label a chip label
 * @param {string[]} args
 * @returns {Set<number>}
 */
export function flagsForChip(label, args) {
  const flags = CHIP_FLAGS[label] ?? [];
  const hit = new Set();
  args.forEach((a, i) => {
    if (!flags.includes(a)) return;
    hit.add(i);
    if (!NO_VALUE.has(a) && i + 1 < args.length) hit.add(i + 1);
  });
  return hit;
}

/**
 * The arguments as the person should read them: {in:clip} and {out:out1} become file names.
 * @param {string[]} args
 * @param {Record<string, string>} inputs id -> file name
 * @param {Record<string, string>} outputs id -> file name
 */
export const displayArgs = (args, inputs, outputs) =>
  substitute(args, inputs, outputs);

/** One argument as a shell would need it. Display and copy only: ffwd never runs this string (RULES §1). */
export const quoteArg = (a) =>
  /^[A-Za-z0-9_./:=+,%@-]+$/.test(a)
    ? a
    : `"${a.replace(/(["\\$`])/g, "\\$1")}"`;
