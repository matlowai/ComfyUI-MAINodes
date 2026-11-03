# Controlled experiment matrix — no preset is approved yet

## Primary question

Does repeating selected RelayVSR transformer blocks improve *whole-video* quality for a measurable compute cost? Secondary: do group vs individual-block recurrence, partial strength and stage choice change the results systematically?

## Mandatory invariants

Same byte-identical source, fps, output dimensions, model/checkpoint weights, LightX2V revision, seed, single-GPU selection, codec `libx264`, CRF 17, `compile=false`, `warmup=false`, clip length 16, audio policy and playback comparison method. Ideally two independently repeated runs per condition to characterize generation variability. Log hashes.

## Minimum sweep

| ID | Preset or custom controls | Purpose | Accept/fail criterion |
|---|---|---|---|
| B0 | `baseline_off` | Normal LightX2V output, no custom runtime | Correct full clip; no extra hooks |
| D0 | `discovery_scan` | Find actual candidate containers | Valid `.loop.json` with owner, class, length; no repeated calls |
| W1 | `EXPERIMENTAL_wan_early_2pass` | First four blocks repeated as group | Nonzero Wan replay count; correct group and source/encoder |
| W2 | `EXPERIMENTAL_wan_middle_2pass` | Middle four group | Same |
| W3 | `EXPERIMENTAL_wan_late_2pass` | Last four group | Same |
| W4 | `EXPERIMENTAL_wan_early_half_strength` | Blended group recurrence | Same; output different from W1 and B0 if effective |
| W5 | `EXPERIMENTAL_wan_middle_damped_3pass` | Damped recurrence | Same; watch for drift/nonfinite |
| F1 | `EXPERIMENTAL_flash_middle_2pass` | Flash/Dual-Memory risk test | Stage confirmed; inspect cache state, artifacts and temporal memory |

**The preset indices are deliberately generic**, using `first:4`, `middle:4`, `last:4`; their quality has not been measured. If discovery shows an unknown block structure, narrow them further and use `owner_regex`. Flash tests should wait until code/cache investigation.

## Second sweep after first working group

Choose a single group that has at least one promising result and compare strengths `0.25 / 0.5 / 1.0`; passes `2 / 3`; `group / per_block` mode; and baseline. Don't vary all parameters simultaneously. Record the exact index list, e.g. `4-9`, rather than only `middle:6` when moving between upstream revisions.

## Measurements — label what they do and do not prove

1. **Correctness:** ffprobe output size/frames/FPS/audio; exact timebase where possible; no drift/duplicated frames at transitions. The current adapter does not yet enforce full decoded-frame verification for every codec; add it in the agent's local validation harness.
2. **Model execution:** JSON reports with `installed`, `extra_block_calls` for each stage, actual GPU peak allocated/reserved VRAM and wall time. GPU peak statistics must be measured in the worker, not guessed from process wall time.
3. **Source fidelity:** downscale SR output back to source resolution; measure PSNR/SSIM/LPIPS against input. These measure *consistency with degraded input*, not true HR recovery; they can penalize plausible correct detail.
4. **Temporal consistency:** flow-aligned warp errors with occlusion masking, temporal texture stability and flicker severity. Naive frame-difference metrics are confounded by motion.
5. **Perceptual quality:** synchronized A/B playback; inspect skin, fine strands, iris shapes, cloth, small text, background, hands, camera pans, occlusions, fast motion, and cross-shot contamination. Mark if the loop is sharper but less faithful.
6. **Compute/VRAM:** peak VRAM, latency, effective full-clip FPS, first-frame latency. Note Wan vs Flash duty cycle and cold startup overhead separately.

## Stop conditions

Stop a condition (no preset promotion) if the result has NaNs/infinities, unsupported hidden-state signature, silently unmatched modules, unintended cache growth, temporal bleed, ghosting/structural drift, or worse whole-video fidelity. If improvement only appears in one still frame, label it inconclusive.

## Agent report table template

| ID | LightX2V SHA | model hash | stage/class | blocks | style | passes | strength | extra calls | sec | peak VRAM | visual observations | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B0 | TBD | TBD | unmodified | — | — | 1 | — | 0 | TBD | TBD | TBD | baseline |
| D0 | TBD | TBD | discovery | — | — | 1 | — | 0 | TBD | TBD | TBD | diagnostic |
| W1 | TBD | TBD | TBD | first:4 | group | 2 | 1.0 | TBD | TBD | TBD | TBD | pending |

Promote presets only when evidence covers multiple scenes and reveals sensible default quality/speed tradeoffs. Keep negative results rather than deleting them.
