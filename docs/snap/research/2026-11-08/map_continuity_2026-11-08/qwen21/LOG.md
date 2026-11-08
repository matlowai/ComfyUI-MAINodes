# Qwen Image 2.1 integration experiment

2026-11-08: Explicit view adapter implemented in dev; main live unchanged. Native 25-step CFG1 Euler/simple, cache auto/default, encoder-returned latent; first reference resized before encoding for requested size. No downloads or core changes. Starting isolated GPU0 server on :8291.

2026-11-08: Exact official8B encoder selected after coordinator source check. Graph test/syntax pass. Real native Snap runs3/3 success at24.230/36.702/37.193s; all3fail exact blocking/mapupdate as detailed in REPORT. Critiques written flaws. Closing isolated runtime, retaining all artifacts.
