// What went wrong in a failed FFmpeg run, in classes a person can act on. The model still gets the scrubbed stderr tail
// (loop.js); the person gets one of these sentences, never the log, a path or an exit code.

// Order matters: the first class whose pattern matches the log wins.
const CLASSES = [
  [
    "memory",
    /out of memory|cannot allocate memory|memory access out of bounds|\bOOM\b/i,
  ],
  [
    "interrupted",
    /\[timed out\]|timed out|received signal|immediate exit requested|terminated|aborted/i,
  ],
  [
    "option",
    /unrecognized option|option .* not found|no such filter|error (initializing|parsing|reinitializing) filter|error parsing (global )?options|unable to parse option|failed to set value|invalid (value|argument) .* for option|error applying option/i,
  ],
  [
    "stream",
    /no such file or directory|matches no streams|does not contain any stream|stream specifier|invalid data found when processing input|output file is empty|\[missing or empty output\]/i,
  ],
  [
    "codec",
    /unknown (encoder|decoder)|encoder .* not found|decoder .* not found|unsupported codec|automatic encoder selection failed|codec not currently supported|could not find (tag|codec)/i,
  ],
  [
    "combination",
    /streamcopy|cannot be used together|error while opening encoder|could not open encoder|error initializing output stream|incompatible pixel format|invalid argument|conflict/i,
  ],
];

export const FAILURE_TEXT = {
  option:
    "FFmpeg didn't understand part of the command it was given. Try rewording your request.",
  stream:
    "FFmpeg couldn't find the picture or sound it was told to use. Try rewording your request.",
  codec:
    "This video or sound format can't be made here. Try asking for a different format, such as MP4.",
  combination:
    "FFmpeg was given settings that don't work together. Try rewording your request.",
  memory: "This job ran out of memory. Try a shorter or smaller video.",
  interrupted:
    "The job was stopped before it finished. Try a shorter video or a simpler request.",
  unknown: "FFmpeg couldn't make this result. Try rewording your request.",
};

/** @param {unknown} log the (scrubbed) FFmpeg log tail of a failed run @returns {keyof typeof FAILURE_TEXT} */
export function classifyFailure(log) {
  const text = String(log ?? "");
  return CLASSES.find(([, re]) => re.test(text))?.[0] ?? "unknown";
}
