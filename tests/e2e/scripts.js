// The three chores of the flow spec, each as the assistant replies a scripted policy plays (the model stands in
// as text, so headless Chromium needs no WebGPU). The checks are the real ones, run on real ffmpeg.wasm output.
const act = (a) => JSON.stringify(a);
const spec = (output) =>
  act({
    action: "spec",
    spec: {
      family: ["F1"],
      outputs: [{ id: "out1", kind: "video", ...output }],
    },
  });
const run = (...args) =>
  act({ action: "run", args, inputs: ["clip"], outputs: ["out1"] });
const X264 = ["-c:v", "libx264", "-preset", "ultrafast"];

// Run 1 of the size chore is deliberately too big (crf 30, about 2.2 MB on this clip) and run 2 fits (crf 38), the
// home page's "3.2 MB, then 1.7 MB" story with the sizes this clip really produces. The limit sits between them.
export const SIZE_LIMIT_BYTES = 1_500_000;

export const CHORES = {
  trim: {
    recipe: "e2e_sample",
    file: { name: "sample.mp4", type: "video/mp4" },
    ask: "Cut the first second",
    chips: [
      ["Keep", "0:01 to 0:04"],
      ["Length", "0:03"],
      ["Picture", "unchanged"],
    ],
    runs: 1,
    script: [
      spec({ container: "mp4", time: { start_s: 1 } }),
      run("-ss", "1", "-i", "{in:clip}", ...X264, "-c:a", "aac", "{out:out1}"),
    ],
    download: "sample-ffwd.mp4",
    flags: ["-ss", "1"],
  },
  size: {
    recipe: "e2e_sample",
    file: { name: "sample.mp4", type: "video/mp4" },
    ask: "Make it small enough to email, under 1.5 MB",
    chips: [["Size", "under 1.5 MB"]],
    runs: 2,
    script: [
      spec({ container: "mp4", size_max_bytes: SIZE_LIMIT_BYTES }),
      run(
        "-i",
        "{in:clip}",
        ...X264,
        "-crf",
        "30",
        "-c:a",
        "aac",
        "{out:out1}",
      ),
      run(
        "-i",
        "{in:clip}",
        ...X264,
        "-crf",
        "38",
        "-c:a",
        "aac",
        "{out:out1}",
      ),
    ],
    download: "sample-ffwd.mp4",
    flags: ["-crf", "38"],
  },
  iphone: {
    recipe: "e2e_iphone",
    file: { name: "IMG_4021.MOV", type: "video/quicktime" },
    ask: "This iPhone video won't play in PowerPoint",
    chips: [["Format", "MP4 that plays widely"]],
    runs: 1,
    script: [
      spec({ container: "mp4", video: { codec: "h264", pix_fmt: "yuv420p" } }),
      run(
        "-i",
        "{in:clip}",
        ...X264,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "{out:out1}",
      ),
    ],
    download: "IMG_4021-ffwd.mp4",
    flags: ["-pix_fmt", "yuv420p"],
  },
};

export const UNSUPPORTED_SCRIPT = [
  act({
    action: "unsupported",
    reason:
      "I can't add subtitles yet. The nearest thing I can do is cut the clip so you can add them elsewhere.",
  }),
];
