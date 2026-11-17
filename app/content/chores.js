// The chore pages (WEB_ARCHITECTURE section 3, DESIGN "Chore page"). One entry per page, prerendered from this list.
// COPY FOR OWNER REVIEW: written in each chore's own words (DESIGN "Copy and voice"), no developer words, no numbers
// beyond the example in the sentence. The sentences are the ones the home page demo uses, which were measured on the
// sample clip. A page may promise only what the checker measures.
import { ASK_MAX_CHARS } from "../config.js";

/**
 * @typedef {object} Chore
 * @property {string} slug URL part, /chores/<slug>
 * @property {string} title the page title, in the chore's own words
 * @property {string} question what a person types into a search box
 * @property {string} sentence the request the tool is pre-filled with
 * @property {[string, string, string]} steps
 * @property {string} quality a plain answer on picture quality
 * @property {string[]} otherWays other requests that fill the tool
 * @property {string[]} related slugs of related chores
 * @property {string} [diagram] the id of the home page demo chore this page's diagram is built from
 */

/** @type {Chore[]} */
export const chores = [
  {
    slug: "cut-the-start-off-a-video",
    title: "Cut the start off a video",
    question: "How do I cut the first few seconds off a video?",
    sentence: "Cut the first 3 seconds",
    steps: [
      "Choose your video. It stays on this computer.",
      "Read the plan. It shows which part of the video it will keep, and you confirm it.",
      "Run it. ffwd measures where the new video starts and how long it is, then you save the file.",
    ],
    quality:
      "The cut video is built again at high quality, so it should look the same to your eye. ffwd checks the picture size and the length of the result, not how good it looks.",
    otherWays: [
      "Remove the first 10 seconds",
      "Start the video at 0:30",
      "Cut the last 5 seconds",
      "Keep only the part from 0:10 to 0:40",
    ],
    related: ["make-a-video-vertical", "make-a-video-small-enough-to-email"],
    diagram: "trim",
  },
  {
    slug: "make-a-video-vertical",
    title: "Make a video vertical for your phone",
    question: "How do I turn a wide video into a vertical one?",
    sentence: "Make it vertical for my phone",
    steps: [
      "Choose your video. It stays on this computer.",
      "Read the plan. It shows the new picture size and that the crop is taken from the centre, and you confirm it.",
      "Run it. ffwd measures the new picture size and the length, then you save the file.",
    ],
    quality:
      "A tall picture cuts away the left and right sides of a wide one, so some of the scene is lost. What stays is not stretched. The plan shows the crop before anything runs.",
    otherWays: [
      "Crop it to 9:16",
      "Make this wide video tall",
      "Make it fit a phone screen",
    ],
    related: [
      "cut-the-start-off-a-video",
      "make-a-video-small-enough-to-email",
    ],
    diagram: "vertical",
  },
  {
    slug: "make-a-video-small-enough-to-email",
    title: "Make a video small enough to email",
    question: "How do I make a video file smaller so I can email it?",
    sentence: "Make it small enough to email, under 3 MB",
    steps: [
      "Choose your video. It stays on this computer.",
      "Read the plan. It shows the size limit you asked for, and you confirm it.",
      "Run it. ffwd measures the file size. If the first try is too big, it lowers the quality a little and tries again, and shows you each try.",
    ],
    quality:
      "A smaller file means lower quality, and the smaller the limit, the more you will see it. ffwd lowers the quality only as far as it needs to fit your limit.",
    otherWays: [
      "Make it under 10 MB",
      "Make it under 25 MB",
      "Make this file smaller and keep it looking good",
    ],
    related: [
      "cut-the-start-off-a-video",
      "fix-an-iphone-video-that-wont-play",
    ],
    diagram: "size",
  },
  {
    slug: "fix-an-iphone-video-that-wont-play",
    title: "Fix an iPhone video that won't play",
    question: "Why won't my iPhone video play on my computer?",
    sentence: "This iPhone video won’t play in PowerPoint",
    steps: [
      "Choose the video from your iPhone. It stays on this computer.",
      "Read the plan. It shows the format it will make, one that plays in most programs, and you confirm it.",
      "Run it. ffwd measures the new format, the picture size and the length, then you save the file.",
    ],
    quality:
      "The video is built again in a format that plays almost everywhere, at high quality, so it should look the same to your eye. ffwd checks the format, the picture size and the length of the result.",
    otherWays: [
      "Convert this MOV to MP4",
      "Make this video play on Windows",
      "Make this iPhone video work in PowerPoint",
    ],
    related: [
      "make-a-video-small-enough-to-email",
      "save-a-frame-every-2-seconds",
    ],
    diagram: "iphone",
  },
  {
    slug: "save-a-frame-every-2-seconds",
    title: "Save a picture from a video every 2 seconds",
    question: "How do I save a picture from a video at regular intervals?",
    sentence: "Save a frame every 2 seconds as pictures",
    steps: [
      "Choose your video. It stays on this computer.",
      "Read the plan. It shows how often a picture is taken and how many you will get, and you confirm it.",
      "Run it. ffwd counts the pictures and checks the spacing between them, then you save them.",
    ],
    quality:
      "Each picture is a still from the video, saved as a JPG. A single frame can look softer than the video does while it plays, especially in fast scenes.",
    otherWays: [
      "Save a picture every 10 seconds",
      "Save the first frame as a picture",
      "Save one picture for every second",
    ],
    related: [
      "cut-the-start-off-a-video",
      "fix-an-iphone-video-that-wont-play",
    ],
    diagram: "frames",
  },
];

/** The /app link that fills the request field. The text is encoded and capped; the tool still waits for Enter. */
export const askLink = (text) =>
  `/app?ask=${encodeURIComponent(text.slice(0, ASK_MAX_CHARS))}`;

/** The meta description of a chore page: the question, then what ffwd does. */
export const choreDescription = (c) =>
  `${c.question} Describe it in one sentence. ffwd does it on your computer and checks the result.`;

export const choreBySlug = (slug) => chores.find((c) => c.slug === slug);
