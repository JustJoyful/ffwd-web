// Cross-origin isolation (D-047, WEB_ARCHITECTURE section 8): the multithreaded ffmpeg.wasm needs SharedArrayBuffer.
export const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};
