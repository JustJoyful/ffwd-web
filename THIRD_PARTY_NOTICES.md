# Third-party notices

The site's own code is GPL-3.0-only (`LICENSE`). Generated on 25 Nov 2026 with `pnpm licenses list --prod` (the packages that reach the shipped bundle or are copied into `build/`) and `pnpm licenses list` (everything installed); re-generate before each release. This is a notice file, not legal advice.

## Shipped in the page (production dependencies)

| Package | Version | Licence | Role |
|---|---|---|---|
| @wllama/wllama | 4.0.0 | MIT | llama.cpp compiled to WebAssembly (WebGPU or CPU); embeds libllama b12637 (llama.cpp is MIT) |
| @ffmpeg/core-mt | 0.12.10 | GPL-2.0-or-later | FFmpeg compiled to WebAssembly, multithreaded. The `ffmpeg-core.wasm` file is a GPL build: its source is FFmpeg (https://ffmpeg.org/) plus the ffmpeg.wasm build scripts (https://github.com/ffmpegwasm/ffmpeg.wasm); the site is GPL-3.0 and offers the corresponding source through this repository and those links. |
| @ffmpeg/ffmpeg 0.12.15, @ffmpeg/util 0.12.2, @ffmpeg/types | | MIT | ffmpeg.wasm JavaScript wrapper |
| react, react-dom 19.3.1, scheduler | | MIT | UI |
| react-router, @react-router/node 8.5.2, cookie-es, @remix-run/* | | MIT | routing and server build |
| @fontsource-variable/funnel-display, funnel-sans 5.3.0 | | OFL-1.1 | fonts (SIL Open Font License 1.1, Funnel project; font files are redistributed unmodified) |
| posthog-js 1.453.2 (+ @posthog/*, core-js, preact, web-vitals, fflate, query-selector-shadow-dom) | | Apache-2.0 AND MIT (web-vitals Apache-2.0; others MIT) | analytics client, loaded only when a key is set at build time and the browser does not send DNT or GPC |
| dompurify | 3.4.18 | MPL-2.0 OR Apache-2.0 | dependency of posthog-js |
| ajv 8.17.1, fast-deep-equal, json-schema-traverse, require-from-string | | MIT | JSON Schema validation of actions and specs |
| fast-uri | 3.1.9 | BSD-3-Clause | dependency of ajv |

The model itself (ffwd-0.6b, Qwen3-0.6B derivative) is Apache-2.0 and is served from the Hugging Face model repository, not from this repository; see the model repo's `THIRD_PARTY_NOTICES.md`.

## Development dependencies (not shipped)

468 MIT, 35 Apache-2.0, 30 ISC, 12 BSD-2-Clause, 11 BSD-3-Clause, 7 BlueOak-1.0.0, 3 MPL-2.0 (axe-core, lightningcss), and single packages under PSF-2.0 (argparse), CC-BY-4.0 (caniuse-lite, data), Unlicense (isbot), 0BSD (tslib), `sentry` under FSL-1.1-Apache-2.0 (a transitive dependency of the Lighthouse CI tool; used only on the developer's machine, not shipped). Full list: `pnpm licenses list`.

## Media

See `CREDITS.md`. Summary: the Meridian (2016) clips and frames on the home page are by Netflix, licensed CC BY 4.0, modified (cut, scaled, colour-adjusted); attribution with licence link is on the page. The Netflix Open Content download is used, not the Xiph mirror copy, whose licence file says CC BY-NC-ND 4.0. Big Buck Bunny (CC BY 3.0, Blender Foundation) appeared only in a local mockup that is not tracked.

## Protocol files

`protocol/` is a copy of `packages/protocol` from the model repository (JSON Schemas, allowlist, conformance cases, prompts), GPL-3.0-only, pinned by `protocol/PIN.json`.

## Not used

React Bits and other component collections: none found in the source tree (grep of the working tree, 25 Nov 2026).
