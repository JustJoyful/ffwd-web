// Turns one checker result (`{ field, expected, actual, ok }`) into the three things a row shows: a plain label, the
// measured value and, for a failure, why. No developer words outside the command panel (DESIGN, Copy and voice).

const mb = (n) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)} MB`
    : `${Math.round(n / 1000)} KB`;
const secs = (x) => {
  if (typeof x !== "number") return String(x);
  if (x < 60) return `${+x.toFixed(1)} s`;
  const r = Math.round(x);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};
const upper = (x) => String(x).toUpperCase();

/** field -> [label, how to show a value, how to say what was expected] */
const FIELDS = {
  size_max_bytes: ["Size", mb, (e) => `over your ${mb(e)} limit`],
  "time.duration_s": ["Length", secs, (e) => `expected ${secs(e)}`],
  "implicit.duration_s": ["Length", secs, (e) => `expected ${secs(e)}`],
  container: ["Format", upper, (e) => `expected ${upper(e)}`],
  "video.width": ["Picture width", (x) => `${x} px`, (e) => `expected ${e} px`],
  "video.height": [
    "Picture height",
    (x) => `${x} px`,
    (e) => `expected ${e} px`,
  ],
  "video.codec": ["Video format", upper, (e) => `expected ${upper(e)}`],
  "video.pix_fmt": ["Pixel format", String, (e) => `expected ${e}`],
  "video.rotation": [
    "Turn",
    (x) => `${x} degrees`,
    (e) => `expected ${e} degrees`,
  ],
  "video.fps": [
    "Frame rate",
    (x) => `${+x.toFixed(2)} per second`,
    (e) => `expected ${e} per second`,
  ],
  "audio.present": [
    "Sound",
    (x) => (x ? "Present" : "None"),
    (e) => (e ? "expected sound" : "expected no sound"),
  ],
  "implicit.audio_present": [
    "Sound",
    (x) => (x ? "Present" : "None"),
    (e) => (e ? "expected sound" : "expected no sound"),
  ],
  "implicit.audio_stream": [
    "Sound",
    (x) => (x ? "Present" : "None"),
    () => "expected sound",
  ],
  "implicit.video_stream": [
    "Picture",
    (x) => (x ? "Present" : "None"),
    () => "expected a picture",
  ],
  "audio.codec": ["Sound format", upper, (e) => `expected ${upper(e)}`],
  "audio.loudness_lufs": [
    "Loudness",
    (x) => `${+x.toFixed(1)} LUFS`,
    (e) => `expected about ${e} LUFS`,
  ],
  "audio.offset_ms": [
    "Sound sync",
    (x) => `${Math.round(x)} ms`,
    (e) => `expected ${e} ms`,
  ],
  "quality.min_ssim": [
    "Picture quality",
    (x) => `${x.toFixed(3)} similarity`,
    (e) => `needs at least ${e}`,
  ],
  "quality.min_psnr_db": [
    "Picture quality",
    (x) => `${x.toFixed(1)} dB`,
    (e) => `needs at least ${e} dB`,
  ],
  lossless: [
    "No re-encoding",
    (x) => (x ? "Yes" : "Re-encoded"),
    () => "the picture was re-encoded",
  ],
  "frames.expected_count": ["Pictures", String, (e) => `expected ${e}`],
  "frames.count_for_interval": ["Pictures", String, (e) => `expected ${e}`],
  "frames.format": [
    "Picture format",
    (x) => [].concat(x).map(upper).join(", "),
    (e) => `expected ${upper(e)}`,
  ],
  video: ["Picture", String, () => "no picture found"],
  present: ["Output", String, () => "nothing was written"],
};

/**
 * @param {{ field: string, expected: unknown, actual: unknown, ok: boolean }} c
 * @returns {{ label: string, value: string, why: string | null }}
 */
export function describeCheck({ field, expected, actual, ok }) {
  const [label, show, why] = FIELDS[field] ?? [
    field,
    String,
    (e) => `expected ${e}`,
  ];
  const missing = actual === null || actual === undefined;
  return {
    label,
    value: missing ? "not measured" : show(actual),
    why: ok ? null : why(expected),
  };
}
