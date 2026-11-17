// Plain-language description of a spec for user confirmation (D-008). JavaScript port of
// training/env/describe_spec.py. The person reads THIS text and confirms, and only then does the checker use that
// spec. One line per field that is set; unconstrained (null) fields are not mentioned. It must reproduce
// protocol/conformance/describe-spec.jsonl line for line, so the two number formatters below copy Python's
// behaviour (round half to even, %g) rather than JavaScript's defaults.

const KIND = {
  video: "a video",
  audio: "an audio file",
  image_sequence: "a set of images",
  gif: "a GIF",
};
const ROT = {
  90: "turned 90 degrees to the right (clockwise)",
  180: "turned upside down (180 degrees)",
  270: "turned 90 degrees to the left (counterclockwise)",
  0: "not rotated",
};
const CODEC = {
  h264: "H.264",
  hevc: "HEVC (H.265)",
  vp9: "VP9",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
};

/** Python's round(): halves go to the even neighbour (12.5 -> 12, 13.5 -> 14). */
function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Python's f"{x:g}": six significant digits, trailing zeros dropped, exponent form below 1e-4 and from 1e6. */
function fmtG(x) {
  if (x === 0) return "0";
  const [mant, exp] = x.toExponential(5).split("e");
  const e = Number(exp);
  const strip = (s) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
  if (e < -4 || e >= 6) {
    const sign = e < 0 ? "-" : "+";
    return `${strip(mant)}e${sign}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  return strip(x.toFixed(Math.max(0, 5 - e)));
}

const clock = (s) => {
  const total = pyRound(s);
  const sec = ((total % 60) + 60) % 60;
  return `${Math.floor(total / 60)}:${String(sec).padStart(2, "0")}`;
};
const num = (x) => (Number.isInteger(x) ? String(x) : fmtG(x));
const size = (n) =>
  n >= 1_000_000 ? `${fmtG(n / 1_000_000)} MB` : `${fmtG(n / 1000)} KB`;

/** The entries of `o` that are set (neither null nor undefined). */
const set = (o) =>
  Object.fromEntries(
    Object.entries(o ?? {}).filter(([, x]) => x !== null && x !== undefined),
  );

/**
 * Lines for one output spec.
 * @param {object} o one entry of spec.outputs
 * @returns {string[]}
 */
export function describeOutput(o) {
  const lines = [
    `Result: ${KIND[o.kind] ?? o.kind}` +
      (o.container ? ` (${o.container.toUpperCase()})` : ""),
  ];
  const v = set(o.video);
  if ("width" in v && "height" in v)
    lines.push(`Picture size: ${v.width} x ${v.height} pixels`);
  else if ("height" in v) lines.push(`Picture height: ${v.height} pixels`);
  else if ("width" in v) lines.push(`Picture width: ${v.width} pixels`);
  // The schema allows only 0/90/180/270; Python raises on anything else, here it is shown as given.
  if ("rotation" in v)
    lines.push(`Rotation: picture ${ROT[v.rotation] ?? v.rotation}`);
  if ("fps" in v) lines.push(`Frame rate: ${num(v.fps)} frames per second`);
  if ("codec" in v)
    lines.push(`Video codec: ${CODEC[v.codec] ?? v.codec.toUpperCase()}`);
  if ("pix_fmt" in v) lines.push(`Pixel format: ${v.pix_fmt}`);
  const a = set(o.audio);
  if (a.present === false) lines.push("Sound: removed");
  else if (a.present === true) lines.push("Sound: kept");
  if ("codec" in a)
    lines.push(`Audio codec: ${CODEC[a.codec] ?? a.codec.toUpperCase()}`);
  if ("loudness_lufs" in a)
    lines.push(`Loudness: about ${num(a.loudness_lufs)} LUFS`);
  if ("offset_ms" in a) {
    const ms = a.offset_ms;
    lines.push(
      ms === 0
        ? "Sound and picture in sync"
        : `Sound starts ${num(Math.abs(ms))} ms ${ms > 0 ? "later" : "earlier"} than the picture`,
    );
  }
  const t = set(o.time);
  delete t.tolerance_s;
  if ("start_s" in t && "end_s" in t)
    lines.push(`Keep from ${clock(t.start_s)} to ${clock(t.end_s)}`);
  else if ("start_s" in t)
    lines.push(`Start at ${clock(t.start_s)} and keep the rest`);
  else if ("end_s" in t) lines.push(`Length: about ${num(t.end_s)} seconds`);
  if (o.size_max_bytes !== null && o.size_max_bytes !== undefined)
    lines.push(`File size: at most ${size(o.size_max_bytes)}`);
  const f = set(o.frames);
  if ("interval_s" in f) {
    const count = "expected_count" in f ? ` (${f.expected_count} images)` : "";
    lines.push(`One image every ${num(f.interval_s)} seconds${count}`);
  } else if ("expected_count" in f)
    lines.push(`${f.expected_count} image${f.expected_count !== 1 ? "s" : ""}`);
  if ("format" in f) lines.push(`Image format: ${f.format.toUpperCase()}`);
  if (o.lossless)
    lines.push("No re-encoding: the picture quality is untouched");
  if (Object.keys(set(o.quality)).length)
    lines.push("Picture quality must stay close to the original");
  return lines;
}

/**
 * The text the person confirms. Several outputs are numbered and indented.
 * @param {{ outputs: object[] }} spec a validated spec
 * @returns {string[]}
 */
export function describeSpec(spec) {
  const out = [];
  spec.outputs.forEach((o, i) => {
    const lines = describeOutput(o);
    if (spec.outputs.length === 1) out.push(...lines);
    else out.push(`Output ${i + 1}:`, ...lines.map((x) => "  " + x));
  });
  return out;
}
