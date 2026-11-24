// Cross-origin isolation (D-047, WEB_ARCHITECTURE section 8): the multithreaded ffmpeg.wasm needs SharedArrayBuffer.
export const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  // not isolation, but the dev and preview servers should send what _headers sends (review N5)
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
