// Browser probe: parses `ffmpeg -hide_banner -i <file>` output (it exits 1, "no output file", by design) into the
// normalised probe shape (protocol/schemas/probe.schema.json, same as training/env/probe.py). The log is used instead
// of the ffprobe entry point because the spike measured ffprobe in core-mt as slower and able to poison later
// commands (reports/2026-11-16-phase0-followups).
// Known differences from ffprobe, reported in Plan C Task 2: duration has 10 ms resolution (the log prints
// centiseconds), fps is the printed value, and stream start_time_s / duration_s are null.
import { PROBE_MAX_FPS } from "../config.js";

const KINDS = {
  Video: "video",
  Audio: "audio",
  Subtitle: "subtitle",
  Data: "data",
  Attachment: "attachment",
};
const LAYOUT_CHANNELS = { mono: 1, stereo: 2, 2.1: 3, 5.1: 6, 7.1: 8 };

/** Split on commas that are not inside (...) or [...]: "yuv420p(tv, progressive)" stays one part. */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

// One convention everywhere (spec.schema.json): CLOCKWISE degrees. FFmpeg logs the display matrix counterclockwise
// ("rotation of -90.00 degrees" on iPhone portrait clips), so negate it.
const normaliseRotation = (ccwDeg) =>
  (((-Math.round(ccwDeg / 90) * 90) % 360) + 360) % 360;

/**
 * @param {string} log output of `ffmpeg -hide_banner -i <file>`
 * @param {number} sizeBytes file size (the log does not print it)
 * @returns {object} a probe
 * @throws {Error} when the log has no input description (the file could not be read)
 */
export function parseFfmpegProbe(log, sizeBytes) {
  const input = /^Input #0, (.+?), from /m.exec(log);
  if (!input) throw new Error("no input description in ffmpeg log");
  const dur = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  const br = /bitrate: (\d+) kb\/s/.exec(log);
  const streams = [];
  let current = null;
  for (const line of log.split("\n")) {
    const m = /^\s*Stream #0:(\d+)[^:]*: (\w+): (.*)$/.exec(line);
    // A cover picture inside an audio or video file ("mjpeg ... 90k tbr ... (attached pic)") is a still image, not a video
    // stream: counting it made an mp3 with cover art look like it has a picture (and "fps" 90000, from its tbr).
    if (m && /\(attached pic\)\s*$/.test(line)) continue;
    if (m) {
      const type = KINDS[m[2]] ?? "unknown";
      const parts = splitTopLevel(m[3]);
      const s = {
        index: Number(m[1]),
        type,
        codec: (parts[0] ?? "").split(" ")[0] || null,
      };
      if (type === "video") {
        s.width = null;
        s.height = null;
        s.pix_fmt = (parts[1] ?? "").split("(")[0] || null;
        const size = parts
          .map((p) => /^(\d{2,5})x(\d{2,5})/.exec(p))
          .find(Boolean);
        if (size) [s.width, s.height] = [Number(size[1]), Number(size[2])];
        // Mirrors probe.py stream_fps: the average rate ("fps"), or the base rate ("tbr") when the average is
        // missing or junk (a 60 fps VP8 webm logs "30k fps, 60 tbr").
        const rate = (label) => {
          const r = parts
            .map((p) => new RegExp(`^(\\d+(?:\\.\\d+)?)(k?) ${label}`).exec(p))
            .find(Boolean);
          return r ? Number(r[1]) * (r[2] ? 1000 : 1) : null;
        };
        const avg = rate("fps");
        s.fps = avg !== null && avg <= PROBE_MAX_FPS ? avg : rate("tbr");
        s.rotation = 0;
      } else if (type === "audio") {
        const hz = parts.map((p) => /^(\d+) Hz/.exec(p)).find(Boolean);
        s.sample_rate = hz ? Number(hz[1]) : null;
        const ch = parts
          .map((p) => LAYOUT_CHANNELS[p] ?? /^(\d+) channels/.exec(p)?.[1])
          .find((x) => x !== undefined);
        s.channels = ch === undefined ? null : Number(ch);
      }
      s.start_time_s = null;
      s.duration_s = null;
      streams.push(s);
      current = s;
      continue;
    }
    const rot = /displaymatrix: rotation of (-?[\d.]+) degrees/.exec(line);
    if (rot && current?.type === "video")
      current.rotation = normaliseRotation(Number(rot[1]));
  }
  return {
    container: input[1],
    duration_s: dur
      ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
      : null,
    size_bytes: sizeBytes,
    bit_rate: br ? Number(br[1]) * 1000 : null,
    streams,
  };
}
