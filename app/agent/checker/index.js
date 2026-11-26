// Deterministic checker v1.2 (RULES §4.3: code, not a model; ARCHITECTURE §3.4). JavaScript port of
// training/env/checker.py::check, kept in step with it by protocol/conformance/checker-*.jsonl.
//
// Checks only spec fields that are set (null = unconstrained). Never throws on bad media or a failing
// measurement: that becomes passed=false with `error` set. Everything that needs FFmpeg (probing, loudness,
// SSIM/PSNR, thumbnails, packet timestamps) is behind the injected `Measure`; Plan C implements it over
// ffmpeg.wasm and the tests here use fakes or native ffmpeg. Tolerances and their evidence: ../config.js.
//
// Beyond Python, which would raise from a failing measurement: any Measure that throws is reported as `error`.
import {
  DEFAULT_TIME_TOLERANCE_S,
  FPS_REL_TOLERANCE,
  IMPLICIT_DURATION_TOLERANCE_S,
  LOUDNESS_TOLERANCE_LU,
  OFFSET_TOLERANCE_MS,
} from "../config.js";
import { usesStreamCopyOnly } from "../validator.js";
import { checkFrames } from "./frames.js";
import { inputOffsetMs, measureOffset } from "./offset.js";
import { netRotationCw } from "./orientation.js";
import { expectedDuration } from "./time.js";

export { expectedDuration };
import { displaySize, qualityChecks } from "./quality.js";
import { add, result } from "./result.js";

/**
 * @typedef {import("./result.js").CheckResult} CheckResult
 * @typedef {object} Probe a normalised probe, protocol/schemas/probe.schema.json
 * @typedef {unknown} Handle an opaque reference to a file (or, for image sequences, a directory) in the runtime
 * @typedef {object} Measure Everything the checker needs from FFmpeg. Each method may throw; check() turns that into an error result.
 * @property {(h: Handle) => Promise<Probe | null>} probe null when the file does not exist or is empty
 * @property {(dir: Handle) => Promise<string[]>} listFiles file names written into an image-sequence output
 * @property {(h: Handle, type: "video" | "audio") => Promise<number | null>} firstPacketPts earliest pts (s) among the first packets
 * @property {(h: Handle) => Promise<number | null>} loudness EBU R128 integrated loudness (LUFS), null when unmeasurable
 * @property {(ref: Handle, cand: Handle, width: number, height: number) => Promise<{ ssim: number, psnr_db: number } | null>} quality
 * @property {(h: Handle, size: number, atSeconds?: number) => Promise<number[][] | null>} thumbnail the frame at atSeconds (default: the first) as a size x size grey matrix
 */

// shortcut: container is a substring match on the probe's format_name, which cannot tell mp4 from mov
// ("mov,mp4,m4a,..."); compare major_brand in checker v2 if that distinction matters. (Same as Python.)
const CONTAINER_ALIASES = { mkv: "matroska", m4a: "mp4" };

const isSet = (x) => x !== null && x !== undefined;
const setFields = (o) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => isSet(v)));
const errName = (e) => (e instanceof Error ? e.name : "Error");

/** Invariants every output keeps unless the spec says otherwise (v1.2). (Python: `_implicit_checks`.) */
export async function implicitChecks(
  spec,
  p,
  vids,
  auds,
  inputProbes,
  checks,
  measure,
  inputs,
) {
  const kind = spec.kind;
  const hasV = vids.length > 0;
  const hasA = auds.length > 0;
  if (kind === "video") add(checks, "implicit.video_stream", true, hasV, hasV);
  if (kind === "audio") add(checks, "implicit.audio_stream", true, hasA, hasA);
  const audio = spec.audio ?? {};
  if (kind === "video" && !isSet(audio.present)) {
    const expected = inputProbes.some((ip) =>
      ip.streams.some((s) => s.type === "audio"),
    );
    add(checks, "implicit.audio_present", expected, hasA, hasA === expected);
  }
  const t = spec.time ?? {};
  if (kind !== "image_sequence" && !isSet(t.start_s) && !isSet(t.end_s)) {
    const durations = inputProbes.map((ip) => ip.duration_s);
    if (durations.length && durations.every(isSet)) {
      // One output from several inputs = their concatenation.
      const expected = durations.reduce((a, b) => a + b, 0);
      let tol = isSet(t.tolerance_s)
        ? t.tolerance_s
        : IMPLICIT_DURATION_TOLERANCE_S;
      if (isSet(audio.offset_ms)) {
        // Shifting audio stretches/shrinks the container by the shift: allow the target offset plus the input's own
        // offset (an "audio is 0.5 s late, fix it" task targets 0 but removes 0.5 s).
        const own = await inputOffsetMs(measure, inputs);
        tol += (Math.abs(audio.offset_ms) + own) / 1000;
      }
      const ok = Math.abs(p.duration_s - expected) <= tol;
      add(checks, "implicit.duration_s", expected, p.duration_s, ok);
    }
  }
}

/**
 * Check one produced output against its (user-confirmed) output spec.
 * @param {object} spec one entry of spec.outputs
 * @param {object} ctx
 * @param {Handle} ctx.output the produced file (a directory for image sequences)
 * @param {Probe} ctx.inputProbe probe of the first input
 * @param {string[]} ctx.runArgs the validated FFmpeg arguments that produced it
 * @param {Probe[]} [ctx.inputProbes] every input in task order (default: just inputProbe)
 * @param {Handle[]} [ctx.inputs] the input handles in task order; needed for rotation, quality and the input's own offset
 * @param {Measure} ctx.measure
 * @returns {Promise<CheckResult>}
 */
export async function check(spec, ctx) {
  const { output, inputProbe, measure, inputs } = ctx;
  const inputProbes = ctx.inputProbes?.length ? ctx.inputProbes : [inputProbe];
  const measurements = { re_encoded: !usesStreamCopyOnly(ctx.runArgs ?? []) };
  try {
    if (spec.kind === "image_sequence")
      return await checkFrames(spec, output, inputProbe, measurements, measure);
    let p;
    try {
      p = await measure.probe(output);
    } catch (e) {
      // Corrupt media must fail the check, not crash the episode.
      return result([], measurements, `probe failed: ${errName(e)}`);
    }
    if (!p) return result([], measurements, "output missing or empty");
    measurements.duration_s = p.duration_s;
    if (!p.duration_s || !p.streams.length)
      return result([], measurements, "output has no media");

    const checks = [];
    const vids = p.streams.filter((s) => s.type === "video");
    const auds = p.streams.filter((s) => s.type === "audio");

    if (spec.container) {
      const name = CONTAINER_ALIASES[spec.container] ?? spec.container;
      const ok = p.container.split(",").includes(name);
      add(checks, "container", spec.container, p.container, ok);
    }

    const video = setFields(spec.video);
    if (Object.keys(video).length) {
      if (!vids.length) add(checks, "video", "present", null, false);
      else {
        const v = vids[0];
        const [w, h] = displaySize(v);
        for (const [key, actual] of [
          ["codec", v.codec ?? null],
          ["pix_fmt", v.pix_fmt ?? null],
          ["width", w],
          ["height", h],
        ])
          if (key in video)
            add(
              checks,
              `video.${key}`,
              video[key],
              actual,
              actual === video[key],
            );
        if ("rotation" in video) {
          const net = inputs?.length
            ? await netRotationCw(
                measure,
                inputs[0],
                output,
                isSet(spec.time?.start_s) ? spec.time.start_s : 0,
              )
            : null;
          measurements.net_rotation_cw = net;
          add(
            checks,
            "video.rotation",
            video.rotation,
            net,
            net === video.rotation,
          );
        }
        if ("fps" in video) {
          const fps = v.fps ?? null;
          const ok =
            fps !== null &&
            Math.abs(fps - video.fps) <= FPS_REL_TOLERANCE * video.fps;
          add(checks, "video.fps", video.fps, fps, ok);
        }
      }
    }

    await implicitChecks(
      spec,
      p,
      vids,
      auds,
      inputProbes,
      checks,
      measure,
      inputs,
    );

    const audio = setFields(spec.audio);
    if ("present" in audio) {
      const has = auds.length > 0;
      add(checks, "audio.present", audio.present, has, has === audio.present);
    }
    if ("codec" in audio) {
      const actual = auds.length ? auds[0].codec : null;
      add(checks, "audio.codec", audio.codec, actual, actual === audio.codec);
    }
    if ("loudness_lufs" in audio) {
      const lufs = auds.length ? await measure.loudness(output) : null;
      measurements.loudness_lufs = lufs;
      const ok =
        lufs !== null &&
        Math.abs(lufs - audio.loudness_lufs) <= LOUDNESS_TOLERANCE_LU;
      add(checks, "audio.loudness_lufs", audio.loudness_lufs, lufs, ok);
    }
    if ("offset_ms" in audio) {
      const offset =
        vids.length && auds.length
          ? await measureOffset(measure, output)
          : null;
      measurements.offset_ms = offset;
      const ok =
        offset !== null &&
        Math.abs(offset - audio.offset_ms) <= OFFSET_TOLERANCE_MS;
      add(checks, "audio.offset_ms", audio.offset_ms, offset, ok);
    }

    const t = spec.time ?? {};
    const expected = expectedDuration(t, inputProbe);
    if (expected !== null) {
      const tol = isSet(t.tolerance_s)
        ? t.tolerance_s
        : DEFAULT_TIME_TOLERANCE_S;
      const ok = Math.abs(p.duration_s - expected) <= tol;
      add(checks, "time.duration_s", expected, p.duration_s, ok);
    }

    if (isSet(spec.size_max_bytes))
      add(
        checks,
        "size_max_bytes",
        spec.size_max_bytes,
        p.size_bytes,
        p.size_bytes <= spec.size_max_bytes,
      );

    await qualityChecks(
      spec,
      output,
      inputProbe,
      inputs,
      checks,
      measurements,
      vids,
      measure,
    );

    if (spec.lossless) {
      const lossless = !measurements.re_encoded;
      add(checks, "lossless", true, lossless, lossless);
    }

    return result(checks, measurements);
  } catch (e) {
    return result([], measurements, `measurement failed: ${errName(e)}`);
  }
}
