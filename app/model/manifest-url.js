// The rule for WHERE a build may fetch the model manifest from (D-053: the site pins a Hugging Face tag or commit, never
// `main`). Pure and dependency-free, so scripts/release-checks.mjs (Node) and the tests use the very same function.

const PINNED = /^(v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|[0-9a-f]{40})$/;
const MOVING = /^(main|master|latest|head|refs)$/i;

/**
 * @param {string | null | undefined} url
 * @returns {string | null} a plain sentence saying what is wrong, or null when the URL is an https URL with a pinned
 *   revision segment (a semver tag such as v1.0.0, or a 40-hex commit) and no branch-like segment.
 */
export function manifestUrlProblem(url) {
  let u;
  try {
    u = new URL(url ?? "");
  } catch {
    return `the manifest URL is missing or not a URL (${JSON.stringify(url ?? null)}).`;
  }
  if (u.protocol !== "https:")
    return `the manifest URL must be https (it is ${u.protocol}//).`;
  if (u.search || u.hash)
    return "the manifest URL must have no query string or fragment.";
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const moving = parts.find((p) => MOVING.test(p));
  if (moving)
    return `the manifest URL names a moving revision ("${moving}"): pin a tag like v1.0.0 or a 40-hex commit.`;
  if (!parts.some((p) => PINNED.test(p)))
    return "the manifest URL has no pinned revision segment (a tag like v1.0.0 or a 40-hex commit).";
  return null;
}

/** A file named in the manifest, resolved against the manifest's own URL. Never leaves the manifest's folder. */
export function resolveFileUrl(manifestUrl, path) {
  const base = new URL(manifestUrl);
  const u = new URL(path, base);
  const dir = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
  if (u.origin !== base.origin || !u.pathname.startsWith(dir))
    throw new Error(`file path "${path}" leaves the manifest's folder`);
  return u.href;
}
