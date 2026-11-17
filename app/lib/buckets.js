// Coarse labels for analytics: a number becomes one of a few ranges, so an exact size or time never leaves the page.
// Each list is the whole vocabulary; the privacy page does not print them, the unit test pins them.

const pick = (n, bounds, labels) => {
  if (!Number.isFinite(n) || n < 0) return "unknown";
  const i = bounds.findIndex((b) => n < b);
  return labels[i === -1 ? bounds.length : i];
};

export const SIZE_BUCKETS = [
  "under 10 MB",
  "10 to 100 MB",
  "100 to 500 MB",
  "500 MB to 1 GB",
  "over 1 GB",
];
/** @param {number} bytes the chosen file's size (decimal megabytes, as people read file sizes) */
export const bucketSize = (bytes) =>
  pick(bytes, [10e6, 100e6, 500e6, 1e9], SIZE_BUCKETS);

export const SECONDS_BUCKETS = [
  "under 10 s",
  "10 to 30 s",
  "30 to 60 s",
  "1 to 3 min",
  "over 3 min",
];
/** @param {number} s how long the job took */
export const bucketSeconds = (s) => pick(s, [10, 30, 60, 180], SECONDS_BUCKETS);

export const COUNT_BUCKETS = ["1", "2 to 3", "4 or more"];
/** @param {number} n number of files */
export const bucketCount = (n) =>
  Number.isFinite(n) && n < 1 ? "unknown" : pick(n, [2, 4], COUNT_BUCKETS);
