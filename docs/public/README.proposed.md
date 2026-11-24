# ffwd-web

The browser app for ffwd: describe a video chore in one sentence, and a 0.6B model (ffwd-0.6b, run in your tab with wllama on WebGPU or CPU) writes an FFmpeg command that ffmpeg.wasm runs on your own file. Nothing is uploaded; the result is checked against what you asked for before it is called done. The model, training and evaluation live in the `ffmpeg-agent` repository.

## What is in here

React Router 8 (SSR build for Cloudflare Pages) app in `app/`, the JavaScript port of the agent loop, checker, validator and chat template in `app/agent`, a copy of the shared protocol in `protocol/` (pinned by `protocol/PIN.json`, kept in sync by the conformance tests and the `protocol-drift` workflow), unit tests, Playwright end-to-end tests, and release checks.

## Run it

```
pnpm install
pnpm copy-core        # copies the 31 MB ffmpeg core into public/ffmpeg (git-ignored)
pnpm dev
pnpm test && pnpm lint && pnpm e2e
pnpm build && pnpm check:release   # same shell; the check fails on anything not ready for a hosted launch
```

The page needs cross-origin isolation (COOP/COEP headers; see `isolation-headers.js`, `public/_headers`). The model is fetched from the Hugging Face repo named by a pinned manifest URL (`VITE_MODEL_MANIFEST_URL` and `VITE_MODEL_MANIFEST_SHA256` at build time) and refused on any hash, protocol or prompt mismatch. `pnpm release:local` serves a local package for testing.

## Privacy

No uploads. Analytics are off unless a key is set at build time; events never contain prompts, file names, contents, paths or IPs, and nothing loads when the browser sends Do Not Track or Global Privacy Control.

## Known limits

Speed and accuracy depend on the device; WebGPU on one tested Intel integrated GPU gives wrong output on long prompts. Browser results are 95.0% (855/900) on generated test tasks, 1.33 points below the native file; see the model repo for the full evaluation and its limits. The ffmpeg core exceeds Cloudflare Pages' 25 MiB file limit and must be hosted elsewhere (`docs/launch-items.txt`).

## Licence

GPL-3.0-only (`LICENSE`). Third-party software, fonts and media: `THIRD_PARTY_NOTICES.md` and `CREDITS.md` (Meridian by Netflix, CC BY 4.0, modified).
