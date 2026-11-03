# RelayVSR X2 — Research-Driven Enhancement Roadmap

**Research cutoff:** 2026-11-02  
**Target:** ComfyUI RelayVSR X2 integration (LightX2V); optional original RelayVSR X4 and distinct ReCaVSR backends.  
**Status:** Research/design recommendations, **not implemented or GPU validated**.  
**Scope:** Build transparent, grounded tuning and diagnostic tools before proposing architecture edits and parameter-efficient training.

## Executive summary

The highest-value additions are (1) shot/scene-aware scheduling, (2) source-fidelity + wavelet/color correction controls, (3) motion/occlusion-aware stabilization confined to fine detail, (4) automatic failure localization and targeted re-rendering, and (5) selectable comparison with released ReCaVSR and SparkVSR. The biggest ambitious research lanes are editable external keyframes, album-based identity conditioning, and separately trained spatial-detail/temporal-consistency adapters.

Key architecture constraints:

- Original RelayVSR uses Wan sparse endpoint latents and a Flash/Dual-Memory reconstruction network. Its `CollaborativeFrameStream(window_size=16)` samples start/end reference latents for overlapping windows. A `window_size` of 16 corresponds to **15 frame intervals** between references. The original implementation resets Flash video history per window; do not presume arbitrary clip slicing or arbitrary latent mixing is harmless.
- LightX2V native X2 is **separate architecture and checkpoint pair** (`wan_x2.safetensors`, `flash_x2.safetensors`). Its default JSON includes `clip_len: 16`, and its CLI's public X2 path is fixed `sr_ratio=2`; do not feed original X4 weights into X2.
- A settings slider is not evidence that the backend consumes it. Require end-to-end tests of each control at the correct inference call site.
- ReCaVSR and SparkVSR are **different pretrained models**. Expose them as separate model backends/experiments, not weight-compatible variants.

## Prioritized engineering table

| Lane | Proposed control / deliverable | Effort | GPU training | Key concern | Evidence |
|---|---|---|---|---|---|
| Shot-aware processing | `scene_cut_mode`, `reset_at_cuts`, scene table | Low–medium | No | Cache reset and duplicate/omitted frames | RelayVSR stream architecture |
| Fidelity / color guard | `color_lock`, `wavelet`, `adain`, `lr_consistency_strength` | Low–medium | No | Over-correcting deliberate grading / alias | ReCaVSR; STAR; RealisVSR |
| Temporal high-frequency stabilization | `temporal_detail_stability` + occlusion gating | Medium | No | Ghosting in occlusion, motion, and hair | DGAF-VSR; InstaVSR; TIG-SVQA |
| Diagnostic heatmap | motion, temporal anomalies, LR mismatch, subject identity | Medium | No | No single metric defines perceptual quality | TIG-SVQA; TINQ |
| Selective second-pass repair | heatmap/ROI/interval rerun; accept/reject | Medium–high | No | Processing an interval must retain temporal context | VARO / SparkVSR / GEARS |
| Sparse reference scheduling | `reference_interval` fixed experiments then adaptive | Medium–high | No initially | Not all intervals validated; recompile/shape effects | RelayVSR; SparkVSR |
| Interactive HR keyframes | external reference images and controllable propagation | High | Probably yes | Relay model lacks SparkVSR's trained arbitrary reference interface | SparkVSR |
| Subject identity album | image set -> quality-ranked identity/texture features | High | Yes for native integration | Alignment, UV fitting, memory/cross-attention compatibility | AlbumVSR; TIGER |
| Dual specialization adapters | distinct detail/temporal LoRAs on trainable parts | High | Yes | Different pretrained backbone than published DLoRAL | DLoRAL NeurIPS 2025 |
| Alternate streaming backend | ReCaVSR selector + decoder/color benchmarks | Medium | No if using released weights | Completely different checkpoint/runtime | ReCaVSR |
| Native spatial compute routing | route more compute to faces/hands/edges | High | Maybe yes | Runtime internals may not support variable token paths | TRaM-VSR |

## Ticket R1 — Shot-aware streaming / reference-window study

**Aim:** avoid treating a hard scene cut as contiguous motion. Pre-scan source timestamps and image differences (histogram, embedding, optical flow failures) to identify hard cuts. First, render independent scenes with clean model/context reset; preserve original source frame indices, timestamps and audio. Add exact frame-count audit.

**Experiment:** compare (a) unmodified whole clip, (b) hard-cut splitting, (c) fixed shorter windows 8/16/24 where supported. Original upstream supports configurable `window_size`; LightX2V X2 exposes `clip_len` in config but the mapping and permissible values must be verified in its inference implementation before offering a UI control. Smaller intervals increase expensive Wan reference generation and are **not inherently higher quality**; test for flicker and seams.

**Advanced follow-up:** adaptive interval proposal based on estimated optical flow, occlusion, sharpness/texture and confidence of generative references. For phase one, use a small discrete set of supported lengths rather than arbitrary dynamic RoPE shapes. The original pipeline computes a reference at each window endpoint and resets Flash state, so dynamic scheduling requires an internal modification, not merely passing a variable to the wrapper.

**Acceptance:** no dropped/duplicated frames; zero cross-cut contaminated memory; controlled comparisons; record latency, inferred reference count, and VRAM. Include an ablation of fixed 8/16/24 vs content-driven selection.

## Ticket R2 — Source fidelity & color lock (training-free)

Two separate problems: (i) brightness/contrast/color drift; (ii) hallucinated geometry inconsistent with the low-res evidence. These need separate knobs.

**Color:** add `color_mode` = `none | wavelet | adain | luma_only` and `color_strength`, using low-frequency statistics from the bicubic source. ReCaVSR already offers `--color-fix wavelet` and `--color-fix adain` for its own backend. The methods need careful color-space choice (linear/gamma) and smooth temporal parameter estimates to avoid oscillation.

**LR consistency:** for SR output `Y`, LR observation `x` and estimated degradation/downsample operator `D`, form `Y' = Y + beta * U(x - D(Y))` where `U` is a smooth upsampler and `beta` is a controllable weight, preferably applied only to low spatial frequencies. This is a proposed postprocessing heuristic, **not a demonstrated RelayVSR result**. Include a robust noise/compression mask and prevent amplifying banding or ringing. Distinguish from full output blending `alpha*Y+(1-alpha)*U(x)` (cheap but reduces genuine texture). Test preservation of deliberate cinematic grading.

**Acceptance:** reduced low-frequency discrepancy and hue drift without skin-tone distortion, temporal oscillation, or loss of true recoverable detail. Use both subjective and objective assessments.

## Ticket R3 — Flow/occlusion gated temporal-detail fusion (training-free)

Derive motion from **LR** frames, scale the motion vectors for HR coordinates, calculate forward/backward optical-flow consistency and occlusion/confidence masks. Decompose output into low-frequency color/structure `L_t` and high-frequency detail `H_t`. Only blend `H_t` with correctly warped, confidence-weighted neighboring high-frequency detail; never average full frames blindly. One illustrative recurrence:

`H'_t = (1 - lambda * conf_t) * H_t + (lambda * conf_t) * warp(H'_(t-1), flow_(t -> t-1))`.

Smooth or suppress weights at cuts, occlusions, moving boundaries, hands, reflections and disocclusions; optionally use a two-sided offline pass for symmetry. Clamp the maximum propagated weight to avoid gradually freezing textures. This is a **research hypothesis**, not proof of improvement on RelayVSR's already temporally consistent outputs.

**Acceptance:** measure flow-aligned high-frequency flicker AND preservation of fine moving detail. Ensure improvement does not merely trade temporal quality for softness/ghosting.

## Ticket R4 — Automatic diagnostics and selective repair

Add `RelayVSR Analyze` as separate node that emits a frame-by-frame CSV/JSON and preview overlay. Candidate measurements: shot cut, source blur/compression, optical-flow residual, occlusion density, high-frequency temporal discrepancy, low-frequency LR reconstruction mismatch, and optionally face-reference embedding consistency. Provide heatmap not only a single scalar score.

**Mode:** diagnostic only / recommend corrections / auto rerun suspicious interval. A conservative second pass can render neighboring frames with different reference spacing or fixed seed, then select a **whole coherent interval** after evaluating context. Do not patch a single generative keyframe unless the remainder of the dependent window is reprocessed.

**Guidance from papers:** TIG-SVQA and TINQ are video-quality assessment research, not drop-in reward guarantees; VARO in the RelayVSR paper explicitly optimizes video-level results in addition to reference quality. Adopt their distinction between local reference quality and propagated video effect.

**Acceptance:** diagnostic heatmaps correlate with manually tagged failure regions; auto mode does not degrade clips that were already good; retain intervention log and original for A/B comparison.

## Ticket R5 — Editable reference images (SparkVSR)

SparkVSR demonstrates a full inference and training path for user-selected HR references, including an existing ComfyUI implementation in `taco-group/SparkVSR/ComfyUI-Spark/`. Use it first as a **reference external model**: select a sparse set of frames, optionally enhance/edit with the image model of choice, then run SparkVSR. This is usable today with its own model; the weights are not interchangeable with RelayVSR.

**Relay native R&D:** inspect `WanVSRPipeline.sample_streaming_latent_step()` and `CollaborativeFrameStream.keyframe()` before deciding how to insert external control. Candidate routes: (a) encode corrected reference images to the expected latent space and test a naive latent replacement **as a diagnostic only** (may be incompatible); (b) train a small adapter projecting reference features into endpoint-conditioning representations; (c) jointly supervise temporal reconstruction with the corrected references. Include a reference strength that truly acts on trained conditioning, rather than pretending to be text CFG.

**Acceptance:** strong keyframe fidelity and video-level consistency, not only favorable still frames; successful preservation of edited feature over motion and changing viewpoint; fallback on missing/incorrect references.

## Ticket R6 — Album/face identity lane (2026-10-28 paper)

AlbumVSR is noteworthy because coauthor Xijun Wang also authored RelayVSR, but AlbumVSR itself runs on a **frozen FlashVSR-tiny backbone**, not RelayVSR X2. It encodes album identity using MagFace/CLIP and texture via FLAME UV atlas; attaches 4 identity and 64 texture tokens to cached cross attention; trains lightweight adaptation heads and LoRA while freezing backbone.

**Pragmatic staged approach:** (1) reference-quality filtering and identity-drift diagnostics, (2) optional aligned face-only postrestoration and seamless temporal blending, (3) trainable reference attention adapter for whichever RelayVSR branch offers a stable conditioning interface. Use face pose/landmarks to avoid identity-smearing across yaw changes. Do not claim native AlbumVSR checkpoints work with RelayVSR.

**Acceptance:** same-person identity retention measured against withheld reference images and HR ground truth, plus face PSNR/LPIPS, temporal stability, off-axis profiles, expression retention, and no pasted-on face boundary.

## Ticket R7 — Separate consistency and detail adapters

NeurIPS 2025 DLoRAL trains a consistency LoRA and a detail LoRA in stages for its particular SD-based architecture. Transfer the **training design**, not the actual weights. For RelayVSR, initially freeze the large reference generator and experiment with parameter-efficient adaptation of the smaller Flash/Dual-Memory path, or a narrow post-decoder module. Supervise fidelity and temporal consistency separately and evaluate composition/interpolation only where the networks support it.

Potential UX: `detail_adapter_scale` and `temporal_adapter_scale`, **but expose these only after experiments show independently meaningful axes**. In an initial prototype, a similarly named pair of inference sliders could otherwise be misleading.

**Compute caution:** 2× RTX 5090 and 2× RTX 6000 Pro are substantial for short-clip LoRA experiments, but exact training feasibility depends on actual model sizes, tensor/activation shapes, offloading, optimizer, and backbone. Start with crop-based short temporal sequences, mixed precision, activation checkpointing and a frozen Wan branch. Do not assert full joint fine-tuning is within budget without a memory profile.

## Ticket R8 — Backend comparison: ReCaVSR / SparkVSR / X2 / original X4

Provide common `VIDEO` entry/output contracts plus a backend-specific settings object. Record model revisions, exact flags and parameters, source dimensions/timestamps, codec, and peak GPU/CPU memory. ReCaVSR has released inference code/weights and supports `--scale 1.5/2/4`, `--color-fix wavelet/adain`, and optional decoder selection. Benchmark each independently; do not force one common setting like `guidance_scale` onto models where it doesn't exist. Include Lightning+Kernels vs speed only after test.

## Additional papers to scout when the above are measured

- **DGAF-VSR (CVPR 2026):** optical-guided warping and dense feature guidance; plausible temporal-detail architecture inspiration, not a postprocess in its published form.
- **TRaM-VSR (2026):** token importance by motion and semantics, routing critical patches differently; may speed selective features but requires internal DiT modifications.
- **RealisVSR (2025):** wavelet + histogram-oriented high-frequency loss and temporal ControlNet; good training objective inspiration.
- **AVSR-Diff (ECCV 2026):** scale-agnostic denoising and Fourier refinement for arbitrary output scale; separate architecture rather than drop-in Relay weight patch.
- **DTG-Restore (CVPR 2026):** decouples conditional/unconditional diffusion timesteps for geometry vs details; may help *a multi-step refinement backend*, not directly applicable to RelayVSR's one-step checkpoint.
- **InfVSR (ICML 2026):** rolling cache and cross-chunk consistency; architecture and long-video evaluation inspiration.
- **GEARS (2026):** diagnosis-guided candidate recycling, inspiration for rerendering only recoverable failure regions/windows.

## ComfyUI node design

1. `RelayVSR Preflight / Inspect`: source geometry, FPS/VFR warnings, cuts, degradation profile, optional references; produces `RELAY_ANALYSIS` JSON.
2. `RelayVSR X2 Run`: backend-specific checkpoint config, seed, validated native clip length, optional frame-accurate shot segmentation; returns `VIDEO`, path, metadata.
3. `RelayVSR Fidelity`: `color_mode`, `color_strength`, `LR_lock_strength`, detail band limit; input/output `VIDEO`.
4. `RelayVSR Temporal Detail`: flow model, temporal detail weight, confidence cutoff, occlusion toggle; input/output `VIDEO`.
5. `RelayVSR Inspect / Compare`: split-screen/wipe, loop selected frames, flicker + LR residual overlays and CSV.
6. `RelayVSR Smart Repair` (later): seed/interval/alternate backend selection only for flagged intervals; requires reproducible reassembly.
7. `RelayVSR Reference Lab` (R&D): external HR keyframes, reference masks, optional identity albums; explicitly indicate whether using SparkVSR or a trained Relay adapter.

Prefer file-backed `VIDEO` interfaces for long clips; avoid ComfyUI float `IMAGE` batches for 2K/4K full sequences. Use a persistent helper process only after deterministic multi-job isolation and cancellation are verified. Always validate exact output frame count, timestamps/FPS, dimensions, and soundtrack.

## Evaluation matrix and thresholds

Create a small clean held-out benchmark with 2–5 second 24/30 FPS clips in six categories: stable talking head, fast head turn and hair, hands/body action, fabric/foliage textures, camera motion/disocclusions, and hard scene cuts. Include intentionally degraded real 4K->LR pairs *and* actual MiniMax-H3 footage. Hold out identity/scene references from training when testing generalization.

Keep input frames, color space, model/weights hash, seeds, temporal stride, encoding loss, and hardware fixed across conditions. Report **per-scene** rather than only pooled means:

- Reconstruction (where GT exists): PSNR/SSIM, LPIPS; face-region scores and held-out identity similarity when applicable.
- Temporal: flow-compensated error / tLPIPS, flicker energy in static areas, occlusion-gated metrics, cut-boundary discontinuities.
- No-reference perceptual: DOVER/MUSIQ/CLIP-IQA as *supporting* metrics; guard against hallucinated details winning perceptual scores.
- Source accountability: LR-downsample reconstruction residual and color drift. May disagree with perceptual scores; show both.
- Runtime: wall clock incl. init/encoding, warm inference FPS, peak allocated/reserved VRAM, RAM, disk/swap; 5090 and RTX 6000 Pro separated.
- Human tests: 100% zoom at playback speed, not only keyframe crops; A/B blind on 3–5 second segments.

Test one factor at a time first: `reference_interval` 8/16/24 where supported, color `none/wavelet/adain`, LR lock 0/0.3/0.6, high-frequency temporal weight 0/0.15/0.3, and `scene_reset` off/on. These values are **experiment candidates**, not tuned recommendations.

**Acceptance gate:** baseline quality maintained on clean controls, measurable improvement on targeted failure cases, no new face/hand geometry artifacts, no timebase/frame-count corruption, deterministic reproduction when applicable, and exposed controls backed by code-path tests.

## Source references (primary papers/repos)

1. RelayVSR original paper: https://arxiv.org/abs/2609.37850  | original code https://github.com/kopperx/RelayVSR
2. LightX2V RelayVSR X2: https://huggingface.co/lightx2v/RelayVSR_X2  | runtime https://github.com/ModelTC/LightX2V/blob/main/scripts/relayvsr/README.md
3. SparkVSR interactive reference conditioning: https://arxiv.org/abs/2603.16864 | https://github.com/taco-group/SparkVSR | ComfyUI https://github.com/taco-group/SparkVSR/tree/main/ComfyUI-Spark
4. AlbumVSR (2026-10-28): https://arxiv.org/abs/2610.39001 | methods https://arxiv.org/html/2610.39001
5. ReCaVSR: https://arxiv.org/abs/2609.37831 | https://github.com/kopperx/ReCaVSR
6. DLoRAL / One-Step Diffusion for Detail-Rich and Temporally Consistent Video SR: https://arxiv.org/abs/2506.15591
7. TIG-SVQA temporal SR quality assessment: https://ojs.aaai.org/index.php/AAAI/article/view/37599
8. TINQ (open quality metric code): https://arxiv.org/abs/2412.18933 | https://github.com/Lighting-YXLI/TINQ
9. DGAF-VSR dense flow-aligned guidance: https://openaccess.thecvf.com/content/CVPR2026/html/Xu_Rethinking_Diffusion_Model-Based_Video_Super-Resolution_Leveraging_Dense_Guidance_from_Aligned_CVPR_2026_paper.html
10. TRaM-VSR token routing: https://arxiv.org/abs/2607.22231
11. RealisVSR: https://arxiv.org/abs/2507.19138
12. AVSR-Diff: https://arxiv.org/abs/2607.00987
13. DTG-Restore: https://arxiv.org/abs/2605.30431
14. InfVSR: https://arxiv.org/abs/2510.00948
15. GEARS: https://arxiv.org/abs/2608.29322
16. RGFVR face video restoration: https://arxiv.org/abs/2606.16401
