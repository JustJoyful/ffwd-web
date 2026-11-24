// The app's OWN "this file was hashed" marker (review S2). It is a field in the cache entry's metadata, written by
// model-host.js only after a full sha256 pass over the stored bytes, and it names the file, the sha256 and the size it
// was hashed for. wllama's own `sha256` metadata field is NOT used: wllama fills it from the host's claim (Hugging Face's
// /raw/ pointer) when a download ends, before anything has been hashed, so a tab that died during the hash would leave
// a field that looks verified. If the marker is missing or different, the file is hashed again.
export const VERIFIED_FIELD = "ffwdVerified";

/** @param {string} name cache file name @param {{ sha256: string, bytes: number }} expected */
export const verifiedMarker = (name, { sha256, bytes }) => ({
  name,
  sha256,
  bytes,
});

/**
 * @param {object | null | undefined} meta the cache entry's metadata
 * @param {string} name @param {{ sha256: string, bytes: number }} expected
 */
export function isVerified(meta, name, { sha256, bytes }) {
  const v = meta?.[VERIFIED_FIELD];
  return v?.name === name && v.sha256 === sha256 && v.bytes === bytes;
}
