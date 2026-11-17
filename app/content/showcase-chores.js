// Data for the window demo, copied verbatim from mockup-v5/app.js. Every value was measured with FFmpeg on the sample clip.
export const D = 16.07; // sample length in seconds

export const SAMPLE = {
  name: "detective.mp4",
  size: "12.1 MB",
  probe: [
    ["Length", "0:16"],
    ["Picture", "1920 × 1080"],
    ["Format", "MP4"],
    ["Sound", "None"],
  ],
};

export const CHORES = [
  {
    id: "trim",
    tab: "Cut the start",
    file: SAMPLE,
    ask: "Cut the first 3 seconds",
    plan: [
      ["Keep", "0:03 to 0:16", 1],
      ["Length", "0:13", 1],
      ["Picture", "unchanged"],
      ["Format", "unchanged"],
    ],
    runs: [
      {
        checks: [
          ["Starts at", "0:03", 1],
          ["Length", "0:13", 1],
          ["Picture", "1920 × 1080", 1],
        ],
      },
    ],
    out: { name: "detective-trimmed.mp4", size: "7.2 MB" },
    range: [3, D],
    cmd: "ffmpeg -ss 3 -i detective.mp4 -c:v libx264 -crf 18 detective-trimmed.mp4",
  },
  {
    id: "vertical",
    tab: "Make it vertical",
    file: SAMPLE,
    ask: "Make it vertical for my phone",
    plan: [
      ["Picture", "1080 × 1920", 1],
      ["Crop", "centre, 9:16", 1],
      ["Length", "unchanged"],
    ],
    runs: [
      {
        checks: [
          ["Picture", "1080 × 1920", 1],
          ["Length", "0:16", 1],
        ],
      },
    ],
    out: { name: "detective-vertical.mp4", size: "5.6 MB" },
    crop: true,
    cmd: 'ffmpeg -i detective.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -crf 20 detective-vertical.mp4',
  },
  {
    id: "size",
    tab: "Under 3 MB",
    file: SAMPLE,
    ask: "Make it small enough to email, under 3 MB",
    plan: [
      ["Size", "under 3 MB", 1],
      ["Length", "unchanged"],
      ["Picture", "unchanged"],
    ],
    runs: [
      {
        t: "Run 1",
        checks: [
          ["Size", "3.2 MB", 0, "over your 3 MB limit"],
          ["Length", "0:16", 1],
        ],
      },
      {
        t: "Run 2, after lowering the quality a little",
        checks: [
          ["Size", "1.7 MB", 1],
          ["Length", "0:16", 1],
        ],
      },
    ],
    out: { name: "detective-small.mp4", size: "1.7 MB" },
    meter: { input: 12.1, limit: 3, runs: [3.2, 1.7] },
    cmd: "ffmpeg -i detective.mp4 -c:v libx264 -crf 26 detective-small.mp4",
  },
  {
    id: "iphone",
    tab: "iPhone video won’t play",
    file: {
      name: "IMG_4021.MOV",
      size: "1.1 MB",
      probe: [
        ["Length", "0:16"],
        ["Picture", "1920 × 1080"],
        ["Format", "iPhone (HEVC)"],
        ["Sound", "None"],
      ],
    },
    ask: "This iPhone video won’t play in PowerPoint",
    plan: [
      ["Format", "MP4 that plays widely", 1],
      ["Picture", "unchanged"],
      ["Length", "unchanged"],
    ],
    runs: [
      {
        checks: [
          ["Format", "MP4", 1],
          ["Picture", "1920 × 1080", 1],
          ["Length", "0:16", 1],
        ],
      },
    ],
    out: { name: "IMG_4021.mp4", size: "3.2 MB" },
    badge: ["MOV", "MP4"],
    cmd: "ffmpeg -i IMG_4021.MOV -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart IMG_4021.mp4",
  },
  {
    id: "frames",
    tab: "A frame every 2 s",
    file: SAMPLE,
    ask: "Save a frame every 2 seconds as pictures",
    plan: [
      ["Pictures", "one every 2 s", 1],
      ["Count", "8", 1],
      ["Format", "JPG"],
    ],
    runs: [
      {
        checks: [
          ["Pictures", "8", 1],
          ["Spacing", "2 s", 1],
        ],
      },
    ],
    out: { name: "8 pictures, JPG", size: "" },
    every: 2,
    cmd: "ffmpeg -i detective.mp4 -vf fps=1/2 -q:v 3 frame-%02d.jpg",
  },
];
