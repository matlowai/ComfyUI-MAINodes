# C1 native recipe audit — 2026-11-08

Read-only evidence audit. No page binding, native tool calls, queue changes, network calls, source edits, downloads or model loading. The only written file is this report.

## Coverage

- Read the complete before recipe: 2,068 lines, 89,393 bytes; all 8 bricks, 59 settings, 23 choice-bearing settings and 1,201 offered choice values. Explicit pages were lines 1–420, 421–840, 841–1260, 1261–1680 and 1681–2068.
- Render Preset coverage is complete: all 13 settings, including its 49 model, 945 LoRA, 2 conditioning, 45 sampler and 10 schedule choices (1,051 values). No option inventory or private model names are copied into this report.
- Read all 405 lines of `setups.json`: 10 setups, 80 setting values, 25 model entries. Read all 311 lines of `run_instructions.json`: 21 instruction notes; the recipe contains 15 global notes. No overridden, conflicting or off notes are reported.
- Read the complete apply-setup/apply-unit receipts and 219-line compile result. Parsed the entire 2,234-line applied recipe and recursively compared every field against the fully read baseline. Every original choice array is unchanged except First frame's formerly empty image choices, now five images; References adds five image widgets with five choices each. The full 1,051 preset choices remain exactly equal. All changed/new values were inspected.
- Read all 1,178 lines / 41 rows of the pre-run activity snapshot in explicit pages after one batched tool response was transport-truncated. No truncated result is treated as complete evidence.
- Read canonical `snap-core`, then `snap-model-choice`, and source rules SNAP-R1–14, R26, R55, R58, R149–151. Pika 6-step video is the applicable model-choice row.

## Native values and readiness

| Setting | Before | Applied C1 |
|---|---|---|
| Setup | Pika H3 Flex, unedited | Pika + reference pictures, unedited |
| Base | H3 FL2VA pruned int8 ConvRot | H3 Ref2VA pruned int8 ConvRot |
| Turbo | Pika FL2VA v1 bf16 | matching Pika Ref2VA Comfy bf16 |
| LoRA strength | 1 | 1 |
| Conditioning | FL2V (first frame) | Ref2V (reference pictures) |
| Sampler / schedule | lcm / manual | unchanged |
| Sigmas | 1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0 | unchanged |
| Steps / de-rope | 6 / 0 | unchanged |
| Video / audio shift | 12 / 3 | unchanged |
| Effective CFG | 1 from Preset binding | unchanged |
| Preset UI value | empty | unchanged |
| Dimensions | 1280 × 704 | unchanged |
| Length | 141 frames / 5.88 s | 90 frames / 3.75 s at 24 fps |
| Seed | 42 | 42, preserved |
| First frame | off, no selected image | unchanged |
| References | no pictures, no audio | five pictures, no audio |
| Dial Rack | empty | unchanged |
| Upscale | off | off |

The Render's local CFG 8 and steps 0 remain unchanged; its bindings consume Preset CFG 1 and Preset sigmas/steps 6. They do not establish a sampling mismatch.

Native setup and applied-recipe evidence report all five required files installed, no missing files and no model warnings. Local file stats independently confirm regular `.safetensors` files for the target Ref2VA checkpoint (20,970,379,616 bytes), matching Pika LoRA (1,956,172,176), Qwen3-VL 32B H3 NVFP4/AWQ encoder (15,687,142,551), H3 video VAE fp16 (5,207,808,496), and H3 audio VAE fp32 (605,254,808). Encoder type is `minimax`, device `default`. Aggregate native size is 44.4 GB. This establishes local artifact readiness, not successful execution or available runtime VRAM.

All 41 activity rows are accounted for: 29 landed, 8 closed, 4 in flight. The four in-flight rows are queued critique work with `no_critic: true`; no queued/running render is present in this pre-run snapshot. The second candidate's distinct seed is future work and must be evidenced by native `new_seed` and its executed history.

## Applied prompt and reference contract

The five applied pictures, in citation order, are the approved C1 **opening** board, Front clean camera plate, Mio front identity, Kuroe front identity and Kuroe back view. The location master is explicitly omitted; no overhead or end-state key drawing is included. The opening board reference is distinct from an end-state key target. Speakers and audio references are empty; Kuroe's pin records “no line in C1.” The soundscape names one ceramic tap and a cloth rustle, with music `N/A`. Prompt sections have two actual newline separators.

There is no installed-artifact or sampling error in the requested/applied Pika Ref2V setup. Remaining evidence limits and observed issues:

1. The compiled prompt contains the ordered set-down action and opening bowl-in-left-hand state, followed by unqualified end-ledger sentences saying the hand is empty and bowl is on the counter. Their intended temporal order is inferable, but their wording is ambiguous. Native compile lint reports no contradiction error; no source fix was made. Check actual motion and hand/bowl state in the resulting frames.
2. `apply_unit` says merely having the Upscale brick makes takes larger, although the actual brick is off and says it runs nothing. The off brick separately reports missing LightX2V/weights. This is a misleading informational statement, not evidence that this render needs or runs RelayVSR. Measure the landed video's dimensions.
3. Native apply describes the board as a Ref2V reference and explicitly does not guarantee an exact first frame. Do not claim C1 starts pixel-identically on its board or that future C2 starts identically on C1's out-frame without measuring the landed video boundary.
4. The only compile lint is that Front clean has no set reference yet; native guidance is to derive one after choosing a suitable cut take. This is reported context, not a missing model dependency.

Evidence: `c1_recipe_before.json`, `setups.json`, `run_instructions.json`, `c1_apply_ref_setup.json`, `c1_compile.json`, `c1_apply_unit.json`, `c1_recipe_applied.json`, `activity_before.json`.
