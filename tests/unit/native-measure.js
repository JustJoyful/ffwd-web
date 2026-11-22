// Test helper: a `Measure` backed by native ffmpeg/ffprobe, so the media-backed conformance cases can run in
// Node (the browser runs the same checker over ffmpeg.wasm in Plan C). Arguments are always lists, never a
// shell string. Like the Python tests, it needs ffmpeg and ffprobe: it fails loudly when they are missing
// instead of skipping, because a skipped conformance case would look like a pass.
//   FFWD_FFMPEG_BIN / FFWD_FFPROBE_BIN pick the binaries (the Python repo pins 5.1.1, D-024); default is PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG = process.env.FFWD_FFMPEG_BIN ?? "ffmpeg";
const FFPROBE = process.env.FFWD_FFPROBE_BIN ?? "ffprobe";
const OFFSET_PACKET_WINDOW = 16; // training/config.py
const PROBE_MAX_FPS = 1000; // training/config.py
const QUALITY_SAMPLE_FPS = 2; // training/config.py

const run = (bin, args) =>
  execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** The first line of `-version` for both tools; throws (never skips) when they are missing. */
export function binaries() {
  try {
    const first = (bin) => run(bin, ["-version"]).split("\n")[0];
    return { ffmpeg: first(FFMPEG), ffprobe: first(FFPROBE) };
  } catch (e) {
    throw new Error(
      `ffmpeg and ffprobe must be on PATH for these tests: ${e}`,
      {
        cause: e,
      },
    );
  }
}

/** The major version of the ffmpeg on PATH (5 for the pinned 5.1.1, D-024); null when it cannot be read. */
export function ffmpegMajor() {
  try {
    const m = /version n?(\d+)\./.exec(run(FFMPEG, ["-version"]));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** stderr of an ffmpeg run (filters such as ssim and psnr report there); a failing run still returns its text. */
const stderrOf = (args) =>
  spawnSync(FFMPEG, ["-hide_banner", "-nostdin", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stderr;

/** Make a scratch directory; call the returned cleanup when done. */
export function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "ffwd-measure-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The corpus clip_a recipe (training/corpus/make_synthetic.py): 3 s of 720p testsrc2 and a 440 Hz sine. */
export function makeClipA(path) {
  run(FFMPEG, [
    ...["-hide_banner", "-nostdin", "-y"],
    ...["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3"],
    ...[
      ...["-f", "lavfi", "-i"],
      "sine=frequency=440:sample_rate=48000:duration=3,volume=0dB",
    ],
    ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
    ...["-c:a", "aac", "-b:a", "96k", path],
  ]);
}

/** Run a model-style `run` action: {in:id}/{out:id} are swapped for real paths, like the harness does. */
export function runArgs(args, files) {
  run(FFMPEG, [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...args.map((a) => files[a] ?? a),
  ]);
}

const num = (v) =>
  v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v);
const fps = (rate) => {
  if (!rate || rate.startsWith("0/") || rate.endsWith("/0")) return null;
  const [a, b = "1"] = rate.split("/");
  return Number(a) / Number(b);
};

// Port of training/env/probe.py::probe (normalised shape of probe.schema.json).
function normalise(raw, size) {
  const fmt = raw.format ?? {};
  const streams = (raw.streams ?? []).map((s) => {
    const type = ["video", "audio", "subtitle", "data", "attachment"].includes(
      s.codec_type,
    )
      ? s.codec_type
      : "unknown";
    const out = { index: s.index, type, codec: s.codec_name ?? null };
    if (type === "video") {
      const avg = fps(s.avg_frame_rate);
      const sd = (s.side_data_list ?? []).find((d) => "rotation" in d);
      Object.assign(out, {
        width: s.width ?? null,
        height: s.height ?? null,
        fps: avg !== null && avg <= PROBE_MAX_FPS ? avg : fps(s.r_frame_rate),
        pix_fmt: s.pix_fmt ?? null,
        rotation: sd
          ? (((-Math.round(Number(sd.rotation) / 90) * 90) % 360) + 360) % 360
          : 0,
      });
    } else if (type === "audio") {
      Object.assign(out, {
        sample_rate: num(s.sample_rate),
        channels: s.channels ?? null,
      });
    }
    return {
      ...out,
      start_time_s: num(s.start_time),
      duration_s: num(s.duration),
    };
  });
  const bitRate = num(fmt.bit_rate);
  return {
    container: fmt.format_name ?? "",
    duration_s: num(fmt.duration),
    size_bytes: Number(fmt.size ?? size),
    bit_rate: bitRate === null ? null : Math.trunc(bitRate),
    streams,
  };
}

/** @returns {import("../../app/agent/checker/index.js").Measure} handles are file paths (a directory for frames) */
export function nativeMeasure() {
  return {
    async probe(path) {
      let size;
      try {
        size = statSync(path).size;
      } catch {
        return null;
      }
      if (size === 0) return null;
      const args = ["-v", "error", "-print_format", "json"];
      const raw = JSON.parse(
        run(FFPROBE, [...args, "-show_format", "-show_streams", path]),
      );
      return normalise(raw, size);
    },
    async listFiles(dir) {
      return readdirSync(dir);
    },
    async firstPacketPts(path, type) {
      const out = run(FFPROBE, [
        ...["-v", "error", "-select_streams", type[0]],
        ...["-read_intervals", `%+#${OFFSET_PACKET_WINDOW}`],
        ...["-show_entries", "packet=pts_time", "-of", "csv=p=0", path],
      ]);
      const pts = out
        .split(/\s+/)
        .map((x) => x.replace(/,$/, ""))
        .filter((x) => x !== "" && x !== "N/A")
        .map(Number);
      return pts.length ? Math.min(...pts) : null;
    },
    // The next three are the same recipes as training/env/{quality,orientation}.py and checker._integrated_loudness
    // (and browser-measure.js), run on native ffmpeg.
    async loudness(path) {
      const log = stderrOf([
        "-i",
        path,
        "-map",
        "0:a:0",
        "-af",
        "ebur128=framelog=-8",
        "-f",
        "null",
        "-",
      ]);
      const last = [...log.matchAll(/^\s+I:\s+(-?[\d.]+|-inf) LUFS/gm)].at(
        -1,
      )?.[1];
      return last === undefined || last === "-inf" ? null : Number(last);
    },
    async quality(ref, cand, width, height) {
      const prep = `fps=${QUALITY_SAMPLE_FPS},scale=${width}:${height}:flags=bicubic,format=yuv420p`;
      const graph = `[0:v]${prep},split[a1][a2];[1:v]${prep},split[b1][b2];[a1][b1]ssim;[a2][b2]psnr`;
      const log = stderrOf([
        "-i",
        cand,
        "-i",
        ref,
        "-filter_complex",
        graph,
        "-f",
        "null",
        "-",
      ]);
      const ssim = [...log.matchAll(/SSIM .*? All:([\d.]+)/g)];
      const psnr = [...log.matchAll(/PSNR .*? average:([\d.inf]+)/g)];
      if (!ssim.length || !psnr.length) return null;
      const p = psnr.at(-1)[1];
      return {
        ssim: Number(ssim.at(-1)[1]),
        psnr_db: p === "inf" ? 100 : Number(p),
      };
    },
    async thumbnail(path, size) {
      const raw = spawnSync(
        FFMPEG,
        [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-i",
          path,
          "-frames:v",
          "1",
          "-vf",
          `scale=${size}:${size}:flags=area,format=gray`,
          "-f",
          "rawvideo",
          "-",
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      ).stdout;
      if (raw.length !== size * size) return null;
      return Array.from({ length: size }, (_, y) =>
        Array.from(raw.subarray(y * size, (y + 1) * size)),
      );
    },
  };
}
