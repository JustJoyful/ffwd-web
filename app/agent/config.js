// Single config module for the browser agent (RULES §6.2). Values mirror training/config.py so the browser
// grades exactly as training did; each one names its Python twin.

export const PROTOCOL_VERSION = "0.3.0";

// Agent loop budget (ARCHITECTURE §3.1). Python: MAX_RUNS_PER_JOB, MAX_TURNS_PER_JOB, MAX_ASK_USER.
export const MAX_RUNS = 4;
export const MAX_TURNS = 8;
export const MAX_ASK_USER = 1;
// Browser-only: generation cap per model turn (spike config).
export const MAX_TOKENS = 512;
// How much of an FFmpeg log goes back to the model (training/config.py STDERR_TAIL_CHARS).
export const STDERR_TAIL_CHARS = 2000;

// Checker tolerances (checker v1.2). Python twins in training/config.py carry the evidence for each size.
export const DEFAULT_TIME_TOLERANCE_S = 0.1;
export const IMPLICIT_DURATION_TOLERANCE_S = 0.1;
export const FPS_REL_TOLERANCE = 0.01;
export const FRAME_COUNT_TOLERANCE = 0;
export const FRAME_SAMPLE_EPS_FRAMES = 0.5;
export const LOUDNESS_TOLERANCE_LU = 2.0;
export const OFFSET_TOLERANCE_MS = 40.0;
export const SSIM_FLOOR_DEFAULT = 0.9;
export const PSNR_FLOOR_DB_DEFAULT = 28.0;
// Bounds on the three spec fields the person never sees (review S3). The schema leaves them unbounded numbers.
//  tolerance_s: at most 0.5. The checker default is 0.1 (DEFAULT_TIME_TOLERANCE_S); the task generator writes only 0.15
//    (1320 train specs) and 0.2 (1171) in data/tasks/train/v1.jsonl, so 0.2 is the largest value the model was ever
//    trained to write; tests/unit/checker.test.js uses 0.5 as its loosest example. 0.5 keeps that headroom and no more.
//  min_ssim / min_psnr_db: never below the checker's own default floors (SSIM_FLOOR_DEFAULT, PSNR_FLOOR_DB_DEFAULT,
//    training/config.py), because a lower number would loosen the floor a size-target output gets even when quality is
//    null. SSIM is at most 1 by definition; a PSNR above any real result only makes the check fail, which is safe.
export const SPEC_TOLERANCE_S_MAX = 0.5;
export const SPEC_SSIM_MAX = 1;
export const ORIENTATION_MAX_RATIO = 0.75;
export const ORIENTATION_MIN_GAP = 4.0;

// ffmpeg.wasm runtime (Plan C). Values the Phase 0 browser spike measured; Python twins noted where there are any.
// The core (about 31 MB) is copied to public/ffmpeg by scripts/copy-core.mjs; production hosting is Plan D/E.
export const FFMPEG_CORE_BASE = "/ffmpeg";
// Re-encodes deadlock in core-mt 0.12.10 when FFmpeg picks its own thread count (copy works, every encode hangs), so
// the harness caps threads on every output. The same happens with auto decoder threads and two inputs (concat).
export const FFMPEG_THREADS = 4;
export const FFMPEG_DECODE_THREADS = 1;
// Filter graphs hang the same way when FFmpeg picks their thread count (found in Plan C Task 1: a lavfi video+audio
// encode and the 32x32 thumbnail graph both deadlocked until the graph was single-threaded). Global options.
export const FFMPEG_FILTER_THREADS = [
  "-filter_threads",
  "1",
  "-filter_complex_threads",
  "1",
];
// One run, in ms. Python RUN_TIMEOUT_S is 120 s; wasm is several times slower than native, so the browser allows
// more before it gives up (a 4K HEVC decode can take minutes).
export const RUN_TIMEOUT_MS = 300_000;
// After the in-core timeout, how long to wait before the page kills the worker itself (a deadlocked core never
// reaches its own timeout check).
export const RUN_WATCHDOG_GRACE_MS = 15_000;
// Above this a logged average frame rate is container junk; use the base rate (training/config.py PROBE_MAX_FPS).
export const PROBE_MAX_FPS = 1000;
// Packets read for the A/V offset (training/config.py OFFSET_PACKET_WINDOW).
export const OFFSET_PACKET_WINDOW = 16;
// SSIM/PSNR sampling rate (training/config.py QUALITY_SAMPLE_FPS).
export const QUALITY_SAMPLE_FPS = 2;
