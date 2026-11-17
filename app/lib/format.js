// Seconds to a timecode, e.g. 65 -> "1:05".
export const fmt = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
