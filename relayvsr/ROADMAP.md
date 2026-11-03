# RelayVSR X2 / X4 — MASTER AGENT ROADMAP

**2026-11-02 handoff, updated for the full research backlog.** This is the **single entry point** for a coding agent that should work through *all* ideas from the discussion—not just block looping. This file is an execution queue. Preserve the original research in `docs/history/RelayVSR_Research_Enhancement_Roadmap_2026.md`, the external-wrapper analysis in `docs/history/RelayVSR_Code_Comparison_and_Merge_Plan.md`, the paper links in `docs/RESEARCH_SOURCES.md`, and the block-loop details in `docs/ARCHITECTURE_AND_SAFETY.md`.

## 0. First understand what's REAL

| Capability | Status as shipped | What an agent must verify or build |
|---|---|---|
| ComfyUI X2/X4 integration, video/file/IMAGE input, output MP4/audio, subprocess cancellation | **Implemented in source; CPU adapter tests** | Actual ComfyUI + CUDA/Triton + checkpoints, audio/timebase/preview on real clips |
| Block-loop `off`, `discover`, `experiment`; Wan/Flash selectors, group vs per-block loops, 1–4 passes, strengths, JSON overrides, reports | **Implemented in generic runtime; CPU toy/fake-worker tests** | Actual model discovery, cache safety, functioning target hooks, measured results |
| Loop baseline/discovery/preset workflows, headless sweep planning, A/B video helper | **Implemented** | Workflows on your ComfyUI version, real inference and evaluation |
| Dedicated X4 original-repo worker supplied by the other developer | **Compared, not integrated into this package** | Decide whether distinct original-X4 backend adds value versus LightX2V's X4 |
| Frame-count verification, VFR/HDR/10-bit guarantees, frontend preview | **Some validation implemented; not fully production-verified** | Full decoded-frame and timebase audits; real browser UI validation |
| Scene/shot-aware cache resets and adaptive reference intervals | **Research proposal only** | Implement with source-verified reset semantics and exact reassembly |
| Source-consistency / color lock / wavelet and AdaIN correction | **Research proposal only** | Implement file-backed optional postprocess and real ablations |
| Optical-flow / occlusion-gated temporal detail stabilization | **Research proposal only** | Implement confidence-aware temporal high-frequency-only filter |
| Automatic video-quality heatmaps, selective interval rerenders, adaptive loop budgets | **Research proposal only** | Quality evaluator, interval selection, fixed-context reassembly |
| ReCaVSR / SparkVSR selectable backends or editable HR reference keyframes | **Research proposal only** | Independent backend integration; native Relay conditioning requires R&D/training |
| Identity reference albums, separate detail/temporal LoRAs, compute routing | **Longer-horizon research** | Training design, memory profiling, held-out video evaluation |
| Persistent model worker/service | **Not implemented** | Only after correctness, interrupts, cache-reset tests and multi-job isolation |

**No presets have been proven to improve quality; no actual inference with X2 checkpoints has been performed in the delivery environment.** The bundled papers and links are research leads, not a substitute for validating the up-to-date code/weights/API on the local machine. In particular, model families are not weight-compatible by implication.

## 1. The agent's operating contract

1. Preserve a fully unmodified `lightx2v.infer` baseline and checkpoint hashes. No permanent upstream edits or dependency installs into the main ComfyUI Python. Use a separate env and, where needed, a separate git worktree with a recorded diff.
2. Set up source clip suite: 2–5-second segments for talking face, turning face/hair, fast hands, rich texture, camera motion/occlusion and hard scene cuts. Use actual MiniMax H3 clips *and* clean reference HR->LR pairs where possible. Keep audio and FPS/timebase metadata.
3. Record GPU model/VRAM, CUDA/Torch/Triton/LightX2V commits, checkpoint SHA256, input SHA256, RNG seed, FPS, frame count, encoded pixel format, CRF, wall/VRAM, actual code paths. Distinguish decode/encode time from inference.
4. Change one factor at a time. Compare decoded frames at the same resolution, colorspace, and codec settings; test whole videos, not just beauty-frame crops. Collect negative results.
5. New UI knob must execute a demonstrably different tested code path. No inert sliders, no marketing claims of a quality gain before multi-clip A/B results.
6. Before working on a paper idea, confirm the paper/code actually supports the mechanism and note what is adaptation versus extrapolation.
7. Maintain `BACKLOG_STATUS.md` and `EXPERIMENT_RESULTS.md`. Never mark a task done on the basis of passing synthetic CPU tests alone if its main claim requires CUDA/video-quality validation.

## 2. Ordered engineering queue

These tickets are **proposed follow-on work**, not features shipped in the ZIP unless marked otherwise. The suggested order balances early payoff, risk, and compute. Parallel independent workstreams are fine after the baseline is working.

### P0 — establish a trustworthy reproducible baseline (mandatory)

**P0.1 Environment + working render.** Follow `docs/INSTALL_AND_DOWNLOAD.md` and `docs/AGENT_HANDOFF.md`; run `python -m unittest discover -s tests -v`, the official LightX2V CLI, then the ComfyUI file-path and native-VIDEO workflows. Confirm native X2 is 2× with the proper `wan_x2.safetensors` and `flash_x2.safetensors`; check GPU mode and model paths. **Done when:** a 2–4 s X2 MP4 is visibly upscaled, frame count/FPS/dimensions and soundtrack are correct, logs/hashes exist, cancellation and restart work.

**P0.2 Video/quality benchmark harness.** Add robust `ffprobe` + decoded-frame count fallback, exact rational FPS/timebase/PTS tests, A/B montage helper, reference-HR PSNR/SSIM/LPIPS where valid, source-downscale residual/color drift, motion-aware temporal comparison and separate subjective review. Avoid declaring downscaled-source PSNR a truth measure of HR detail. **Done when:** a single command evaluates and records baseline and candidates consistently for all short clips. Prefer file-backed streaming; avoid whole-clip float `IMAGE` allocations.

**P0.3 Reliability merge from standalone original X4 wrapper.** Recheck `docs/history/RelayVSR_Code_Comparison_and_Merge_Plan.md` against the actual node before writing new code. Bring over robust preflight/setup diagnostics and verified output/audio behavior where missing. Fix/warn for VFR/HDR/10-bit/color-range handling rather than silently changing metadata. MP4-only mode must never masquerade as an enhanced `IMAGE` batch. **Done when:** failures are explicit and bad media are rejected or clearly converted.

### P1 — execute the block-loop research already implemented

**P1.1 Live block discovery and correctness.** Test `baseline_off`, then `discovery_scan`; inspect `.loop.json` owner class, class depth, block signatures and actual cache ownership, plus the live LightX2V SHA. If generic hooks do not see the true Wan/Flash path, add a *source-specific, opt-in* adapter in this nodepack or an isolated worktree; add regression tests. **Done when:** selected exact Wan group emits nonzero `extra_block_calls` on a genuine CUDA render and the unmodified baseline is unaffected.

**P1.2 Controlled Wan sweep.** Compare early/middle/late contiguous `group` loops; `passes=2`, `strength=0.25/0.5/1.0`; same seed/clip. Test `per_block` separately, then optionally three passes/damped update only after safety checks. Include first-frame vs across-window A/B, window seams, VRAM/time, identities, fingers, motion. **Done when:** measured changes—not merely nonzero hooks—are recorded across clips with pros/cons and no unaccounted cache mutation.

**P1.3 Cache safety.** Audit both explicit and internal mutable KV/cache states. For Flash, design *snapshot/rollback/commit-once* or genuinely side-effect-free block replay; don't treat `allow_stateful_repeats` as a solution. Initially keep compile/offload/SP disabled in experimental runs; test each separately later. **Done when:** repeat execution does not corrupt history or leak memory, with state before/after tests.

**P1.4 Adaptive *loop compute* budget (new hypothesis).** Once an evaluation harness exists, use reference-frame/source-quality scores to choose whether Wan loops should activate for difficult intervals, and evaluate using complete output windows, not the standalone prettiness of the keyframe. Compare with simply shortening supported reference intervals. **Done when:** an allocation policy beats equally-budgeted uniform looping on multiple scenes, otherwise keep it experimental.

### P2 — safe quality tunability (no new model training)

**P2.1 Source fidelity and color correction.** Expose separate `color_mode=none|wavelet|adain|luma_only`, `color_strength` and `lr_consistency_strength`. For consistency, try a low-frequency residual `Y' = Y + beta U(X - D(Y))`, with robust compression/noise masks. Preserve scene grading and prevent per-frame color oscillation. The formula is a *proposed postprocess*, not RelayVSR-native guidance. **Done when:** real code paths and tests show source/color changes without unacceptable texture loss or flicker.

**P2.2 Scene/shot boundary handling.** Implement hard-cut detection and independent full-scene processing where needed, with correct context resets and exact frame-accurate reassembly. Explore fixed interval 8/16/24 **only if the actual X2 backend supports them**; don't equate its `clip_len` blindly with original RelayVSR's `window_size`. **Done when:** no dropped/duplicated frames, audio drift, or cross-shot ghosts; include cut and window-seam comparisons.

**P2.3 Temporal detail correction.** Use LR flow, forward/back consistency, occlusion masks, and only the SR **high-frequency band** to blend neighboring detail. Skip/attenuate at cuts and newly exposed surfaces. Keep optional/off by default. **Done when:** corrected clips improve motion-aligned temporal consistency with no new hair/hand/reflection ghosting.

**P2.4 Compare native X2/X4 and released alternate VSR backends.** Add ReCaVSR and SparkVSR as **separate independent backends/wrappers** only after verifying their current dependency/weight contracts. Test ReCaVSR decoder and color-fix options if available; test SparkVSR externally supplied references on the same videos. Do not load one family’s weights into another. **Done when:** common input/output and measurement contracts work and backend-specific controls are named honestly.

### P3 — diagnostic-assisted intelligent repair

**P3.1 Video quality inspector.** Create optional file-backed reports/heatmaps: LR downsample mismatch, color residual, optical-flow warp consistency with occlusion masking, temporal flicker in mostly static areas, boundaries, face identity drift where consented references exist. Record raw metrics and caveats; no single aggregate magic score. **Done when:** known defects and negative controls are visibly and reproducibly localized.

**P3.2 Smart interval re-render.** Rerun full context windows around flagged intervals with alternative loop/reference/backend/fidelity settings and compare to original. Use conservative boundaries, overlap, timecode auditing and deterministic stitching. Keep both versions; don't automatically accept a more 'detailed' but less faithful candidate. **Done when:** selected intervals improve whole-video quality and stitching/PTS/audio remain correct.

### P4 — external references, identity, and more ambitious adaptations

**P4.1 Editable keyframe reference experiment.** Use SparkVSR's published implementation as an *independent control*. Investigate Relay’s latent reference interface separately: generic injection of edited HR keyframes is not a supported pretrained knob. If necessary, train a small reference-conditioning adapter. **Done when:** edits survive motion/viewpoint without identity drift, and a clean baseline is available.

**P4.2 Album/identity experiments.** First implement reference-quality filtering/diagnostics; optionally test a face-only reference-guided restorer; then investigate native adapters inspired by AlbumVSR (which uses a different backbone). Maintain held-out reference images and all-angle/expressive identity tests. **Done when:** objective identity metrics and viewing tests improve without pasted faces or temporal seams.

**P4.3 Separate detail and consistency adapters.** Only after P0 benchmark + P2 tunability baselines: freeze Wan first and profile Flash/Dual-Memory LoRA or a small post-decoder. Study DLoRAL as training-design inspiration, not compatible checkpoints. Do not expose two independent user sliders until independent effects are confirmed. **Done when:** same compute budget gains on held-out high-frequency detail *and* temporal stability, with VRAM measurements on local cards.

**P4.4 Other paper leads, not direct integrations.** TRaM-VSR (token routing), AVSR-Diff (arbitrary scale), InfVSR (streaming cache), DGAF-VSR (flow-aligned guidance), RealisVSR (wavelet and training), DTG-Restore (diffusion-time guidance), GEARS (failure-aware recycle), and RGFVR (face restoration). Verify publications/source code and study the transferable *ideas* before modifying Relay internals.

### P5 — performance and production readiness

**P5.1 Persistent inference worker** with model residency across clips, per-request timeouts, cancellation, resettable KV state, GPU memory accounting and clean fallback to one-shot subprocess. **Done when:** back-to-back clips do not leak any state, outputs match isolated runs where expected, and throughput/warmup costs are measured.

**P5.2 Optimize only observed bottlenecks.** Check compilation, activation/weight offload, two-GPU SP, actual transfer costs for repeated blocks, chunked IO and codec losses separately. Compare on 5090 vs RTX 6000 Pro; don't assume two GPUs always improve latency. **Done when:** speed/quality/peak-VRAM chart from real timings, with same frame and fidelity guarantees.

**P5.3 Promote meaningful presets.** `Fast / Source-faithful / Temporal-safe / Detail-seeking / Reference-guided` are **candidate UX labels only**. A preset must specify backend version, hashes, concrete controls, known failure cases, proof on several clip classes, and safe fallback. Never ship a 'quality' preset based on a single sharper still.

## 3. Paper/repo index and evidence discipline

- **Block looping:** Looped-DiT (arXiv:2609.40305); training-free loop paper (arXiv:2605.23872); community HunyuanImage3 ComfyUI implementation. See `docs/RESEARCH_SOURCES.md` for URLs and differences from our untrained hooks.
- **RelayVSR lineage and backend:** RelayVSR paper (arXiv:2609.37850), original `kopperx/RelayVSR`, native X2 LightX2V checkpoint and docs; see `docs/RESEARCH_SOURCES.md`.
- **Broad quality bibliography, precise assumptions and original eight tickets:** `docs/history/RelayVSR_Research_Enhancement_Roadmap_2026.md` (includes SparkVSR, AlbumVSR, ReCaVSR, DLoRAL, TIG-SVQA, TINQ, DGAF-VSR, TRaM-VSR, RealisVSR, AVSR-Diff, DTG-Restore, InfVSR, GEARS, RGFVR).
- **Original-X4 community wrapper comparison and safety notes:** `docs/history/RelayVSR_Code_Comparison_and_Merge_Plan.md`.
- **Technical mechanics and warnings for the shipped loop code:** `docs/ARCHITECTURE_AND_SAFETY.md`, `docs/EXPERIMENT_MATRIX.md`, `docs/JOURNEY_AND_DECISIONS.md`.

**Sources are leads, not permissions to assert efficacy on RelayVSR.** Independently verify upstream HEAD/commits and license when incorporating model code. Maintain a citation/implementation map in your experiment notes: original paper idea, local adaptation and test evidence.

## 4. Expected files the agent should create next

- `BACKLOG_STATUS.md`: each P0–P5 ticket `not started / blocked / in progress / tested / validated`, with commit and evidence path.
- `EXPERIMENT_RESULTS.md`: machine/versions/hashes, clip matrix, exact command/config, output file, loop owner/indices/count, media checks, speed/VRAM, quality evidence, caveats, verdict.
- `docs/LOCAL_COMPATIBILITY_NOTES.md`: *actual* LightX2V block topology, cache/mutation findings, fixes, and supported version/commit.
- `tests/` cases for any new feature; synthetic numerical tests clearly separated from GPU/video tests.
- `presets/` only for **validated** cross-clip reproducible improvements; keep exploratory candidates prefixed `EXPERIMENTAL_`.

## 5. First request to a local coding agent

> Read `MASTER_AGENT_ROADMAP.md`, `START_HERE.md`, `AGENT_PROMPT.md`, `docs/AGENT_HANDOFF.md` and both `docs/history/` reports. Inventory the environment and complete P0.1, then P0.2 and P1.1. Write `BACKLOG_STATUS.md` and `EXPERIMENT_RESULTS.md` with reproducible evidence. If the live block hook mismatches upstream, repair it without modifying the working LightX2V checkout in place. When a baseline and block discovery exist, work down the prioritized queue, implementing source-fidelity/color and shot handling before expensive training ideas. Never describe unimplemented research tickets as shipped features.
