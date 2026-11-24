// Content-Security-Policy (review S5), built from the hosts a build is allowed to talk to, so "nothing else leaves the
// page" is enforced by the browser and not only by review. Used by scripts/postbuild.mjs (written into _headers) and by the
// dev server when FFWD_CSP=1 (so the end-to-end suite and the real-model smoke can run under it).
//
// DROPPED ON PURPOSE: script-src. The pages carry inline scripts (the theme script, React Router's context script) and
// ajv compiles schemas with `new Function`, so a script-src that works needs 'unsafe-inline' and 'unsafe-eval', which
// protects nothing. Fixing that needs script hashes per page and a precompiled validator: a later job.
const origin = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/**
 * @param {{ modelUrl?: string | null, analyticsHost?: string | null, dev?: boolean }} p analyticsHost only when analytics is on
 */
export function buildCsp({ modelUrl, analyticsHost, dev = false }) {
  const model = origin(modelUrl ?? "");
  const connect = [
    "'self'",
    // blob: because ffmpeg.wasm and wllama fetch their own wasm back from a blob URL they made from our own files
    // (found by running the e2e suite under this policy: without it the video engine never starts).
    "blob:",
    model,
    // A Hugging Face download is redirected to its file CDN; a redirect target must be allowed too. NOT verified on our own
    // file (it is not public yet): confirm the real redirect host and tighten this when it is.
    model && /(^|\.)huggingface\.co$/.test(new URL(model).hostname)
      ? "https://*.huggingface.co https://*.hf.co"
      : null,
    analyticsHost ? origin(analyticsHost) : null,
    dev ? "ws://localhost:* http://localhost:*" : null,
  ].filter(Boolean);
  return [
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
