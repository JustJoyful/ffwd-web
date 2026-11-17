// Everything the checker measures, over ffmpeg.wasm (the `Measure` interface in checker/index.js). The filter graphs
// and arguments are the Python ones (training/env/{probe,quality,orientation}.py and checker.py::_integrated_loudness)
// so a given file is judged the same in both runtimes; tests/e2e/conformance.spec.js is where that is checked.
// Handles are in-memory paths ("in/1-clip.mp4", "out/2/out1.mp4", a directory for frames).
import {
  FFMPEG_FILTER_THREADS,
  OFFSET_PACKET_WINDOW,
  QUALITY_SAMPLE_FPS,
} from "../config.js";
import { parseFfmpegProbe } from "./probe-log.js";

const HEAD = ["-hide_banner", "-nostdin", ...FFMPEG_FILTER_THREADS];
// Decoder threads capped on every input, as for runs (see executor/harness-args.js).
const IN = (h) => ["-threads", "1", "-i", h];
const NULL_OUT = ["-f", "null", "-"];

export class BrowserMeasure {
  /**
   * @param {import("../executor/ffmpeg-session.js").FfmpegSession} session
   * @param {Map<string, number>} sizes path -> byte size; a path missing here is a file that does not exist
   */
  constructor(session, sizes) {
    this.session = session;
    this.sizes = sizes;
    /** @type {Map<string, Promise<object>>} */
    this.probes = new Map(); // handles are write-once, so a probe never goes stale
  }

  async probe(h) {
    const size = this.sizes.get(h);
    if (!size) return null; // missing or empty (Python: stat + probe)
    if (!this.probes.has(h))
      this.probes.set(
        h,
        this.session.exec([...HEAD, "-i", h]).then(({ log }) => {
          return parseFfmpegProbe(log, size); // exit code is 1 by design ("no output file")
        }),
      );
    try {
      return await this.probes.get(h);
    } catch (e) {
      this.probes.delete(h);
      throw e;
    }
  }

  async listFiles(dir) {
    return (await this.session.list(dir))
      .filter((e) => !e.isDir)
      .map((e) => e.name);
  }

  /**
   * Earliest pts (s) among a stream's first packets. ffprobe is unusable in core-mt (it aborts and can poison later
   * commands), so the packets come from stream-copy to the framecrc muxer with -copyts: that keeps the demuxer's
   * real timestamps (an audio advance hidden behind an MP4 edit list stays negative) and writes one line per packet.
   */
  async firstPacketPts(h, type) {
    const out = `scratch-${type}.crc`;
    const r = await this.session.exec([
      ...HEAD,
      "-y",
      ...["-copyts", "-threads", "1", "-i", h],
      ...[
        "-map",
        `0:${type[0]}:0`,
        "-c",
        "copy",
        `-frames:${type[0]}`,
        String(OFFSET_PACKET_WINDOW),
      ],
      ...["-f", "framecrc", out],
    ]);
    if (r.code !== 0) return null;
    const text = new TextDecoder().decode(await this.session.read(out));
    await this.session.remove(out);
    const tb = /^#tb 0: (\d+)\/(\d+)/m.exec(text);
    if (!tb) return null;
    // Lines: "0, dts, pts, duration, size, crc"
    const pts = [...text.matchAll(/^0,\s*(-?\d+),\s*(-?\d+),/gm)].map(
      (m) => (Number(m[2]) * Number(tb[1])) / Number(tb[2]),
    );
    return pts.length ? Math.min(...pts) : null;
  }

  async loudness(h) {
    const r = await this.session.exec([
      ...HEAD,
      ...IN(h),
      ...["-map", "0:a:0", "-af", "ebur128=framelog=-8", ...NULL_OUT],
    ]);
    if (r.code !== 0) return null; // a failed graph still prints a zero summary: never read it as a measurement
    const found = [...r.log.matchAll(/^\s+I:\s+(-?[\d.]+|-inf) LUFS/gm)];
    const last = found.at(-1)?.[1];
    return last === undefined || last === "-inf" ? null : Number(last);
  }

  async quality(ref, cand, width, height) {
    const prep = `fps=${QUALITY_SAMPLE_FPS},scale=${width}:${height}:flags=bicubic,format=yuv420p`;
    const graph = `[0:v]${prep},split[a1][a2];[1:v]${prep},split[b1][b2];[a1][b1]ssim;[a2][b2]psnr`;
    const r = await this.session.exec([
      ...HEAD,
      ...IN(cand),
      ...IN(ref),
      ...["-filter_complex", graph, ...NULL_OUT],
    ]);
    const ssim = [...r.log.matchAll(/SSIM .*? All:([\d.]+)/g)];
    const psnr = [...r.log.matchAll(/PSNR .*? average:([\d.inf]+)/g)];
    if (!ssim.length || !psnr.length) return null;
    const p = psnr.at(-1)[1];
    return {
      ssim: Number(ssim.at(-1)[1]),
      psnr_db: p === "inf" ? 100 : Number(p),
    };
  }

  async thumbnail(h, size) {
    const out = "scratch-thumb.raw";
    const r = await this.session.exec([
      ...HEAD,
      ...["-v", "error", ...IN(h)],
      ...[
        "-frames:v",
        "1",
        "-vf",
        `scale=${size}:${size}:flags=area,format=gray`,
      ],
      ...["-f", "rawvideo", out],
    ]);
    if (r.code !== 0) return null;
    const raw = await this.session.read(out);
    await this.session.remove(out);
    if (raw.length !== size * size) return null;
    return Array.from({ length: size }, (_, y) =>
      Array.from(raw.subarray(y * size, (y + 1) * size)),
    );
  }
}
