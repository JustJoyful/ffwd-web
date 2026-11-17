// Single config module for the browser agent (RULES §6.2). Values mirror training/config.py so the browser
// grades exactly as training did; each one names its Python twin.

export const PROTOCOL_VERSION = "0.3.0";

// Agent loop budget (ARCHITECTURE §3.1). Python: MAX_RUNS_PER_JOB, MAX_TURNS_PER_JOB, MAX_ASK_USER.
export const MAX_RUNS = 4;
export const MAX_TURNS = 8;
export const MAX_ASK_USER = 1;
// Browser-only: generation cap per model turn (spike config).
export const MAX_TOKENS = 512;

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
export const ORIENTATION_MAX_RATIO = 0.75;
export const ORIENTATION_MIN_GAP = 4.0;
