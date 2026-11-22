// The model artifact and runtime settings (D-050, D-051). ONE source: the worker, the client, the loader and analytics
// read these, nothing else hard-codes them. The values are those of the owner-confirmed configuration.
export const MODEL = {
  version: "agent-v0.1-0.6b-q5_k_m",
  file: "grpo-m3-ckpt60-q5_k_m.gguf",
  bytes: 444411456,
  sha256: "bbf439b749c02c04b5227ab93fb1430263a7c567c15552b6e12ae3836cde1e11",
  nCtx: 8192,
  kvCache: "q8_0",
  maxTokens: 512,
};

// Where the file comes from. The public Hugging Face repo and the R2 fallback do not exist yet (the DeepSeek terms
// review comes first), so there is NO production URL: a build gets one from VITE_MODEL_URL (a localhost URL in
// development and in the real-model smoke test), and without it the loader says the model is not published yet.
export const modelUrl = () => import.meta.env?.VITE_MODEL_URL || null;
