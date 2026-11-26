import { describe, expect, test } from "vitest";
import { parseFfmpegProbe } from "../../app/agent/measure/probe-log.js";

const LOG = (streams) => `Input #0, mp3, from 'song.mp3':
  Duration: 00:03:05.00, start: 0.025057, bitrate: 192 kb/s
${streams}`;

describe("an attached cover picture is not a video stream", () => {
  test("an mp3 with cover art has one audio stream and no video", () => {
    const p = parseFfmpegProbe(
      LOG(`  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 500x500 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
`),
      1000,
    );
    expect(p.streams.map((s) => s.type)).toEqual(["audio"]);
  });
  test("a real video keeps its video stream when a cover picture sits next to it", () => {
    const p = parseFfmpegProbe(
      LOG(`  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 30 fps, 30 tbr, 15360 tbn
  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp
  Stream #0:2: Video: mjpeg, yuvj420p, 300x300, 90k tbr, 90k tbn (attached pic)
`),
      1000,
    );
    const v = p.streams.filter((s) => s.type === "video");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ width: 1280, height: 720, fps: 30 });
  });
});
