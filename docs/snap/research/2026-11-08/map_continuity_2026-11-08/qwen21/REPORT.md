# Qwen Image 2.1 native Snap trial — 2026-11-08

READ FIRST: Native adapter works in isolated Snap; all three requested images rendered and landed as candidate takes. **None passes exact map/blocking continuity.** No production record, main page, or :8193 code changed. Main remains pinned G17a. Lab server and its named extra visible Chrome are stopped after capture. Base, outputs, requests, responses, histories and critiques remain here.

## Implementation

Dev pack: explicit `qwen21_view` registry entry plus narrow native graph builder in `web/snap/edits.js`; H3 defaults unchanged. Uses exact original Qwen2.1 int8 model, official workflow's Qwen3VL8B int8 encoder (not 3.5 PE_i2i), matching bf16 VAE; `TextEncodeQwenImage21` positive/negative/latent to KSampler, native shift untouched, QwenImage21Cache auto/default, 25steps CFG1 Euler/simple denoise1. First reference resized to requested size before encoding at resolution0; encoder rounds to multiples32. Never creates an unrelated empty latent. Each reference has its own ordered native socket.

Registry/tool description explains Qwen `<image1>` syntax and first-picture canvas. Focused actual-source graph test plus stale expected method lists in U101 updated; full U101 is not run here because it assumes placeholder models and headless browser.

## Comparison contract

Copied exact resolved input files through isolated server's upload API. Preserved original seeds, requested dimensions, picture order and full prompt apart from mechanical `<Picture N>` → `<imageN>` references. Landing changed to isolated lab tab; production Cast/location/take records are not mutated or recreated, so lab provenance contains copied file refs rather than original version pins. Qwen's first picture is an edit canvas, versus Fizgig's all-reference contract. Native sampling differs intentionally. These are capability probes, not a sampler-isolated benchmark.

Three stills only, no rerolls, no downloads, no dependencies, no core edits, no raw outside-Snap generation. GPU0 RTX5090; native exact model inference through existing Snap queue/candidate/take path on :8291.

| case | seed / dimensions | execution wall time | result |
|---|---|---:|---|
| map final placement | 880097 /1216×1728 |24.230s first load | New west mark, but old south mark remains; malformed extra mark by label and west boundary gaps. Fails move-only edit. |
| guided W |880101 /1920×1088 |36.702s | Correct side-on view, red-haired woman left /white-haired man right, appearance and lowered wands. Both feet overlap ring bands; armillary centered behind ring and cracks centered. Fails precise blocking. |
| guided S |880102 /1920×1088 |37.193s | Correct near Liora/back view and far Corvin/front view. Corvin inside ring; crack cluster centered. Fails outside-ring blocking. |

Execution duration includes encode/load/sample/decode; queue waiting excluded. Four-reference camera cases have different conditioning workload from one-reference map edit. Full timestamps and history are in `execution_timings.json` and each `*.history.json`.

Outputs: `base/output/snap_views/d5f559df_00001_.png` map, `_00002_.png` W, `_00003_.png` S. Each is a successful Snap candidate take; no candidate is applied. Critiques map `crit-1a1bc328f15-e670`, W `crit-1a1bc33203f-9e28`, S `crit-1a1bc33b2f1-daf1` are written as flaws; full packet/context and verdict responses retained.

## Verification and remaining gate

`node tests/snap/test_qwen21_graph.js`: PASS. Native canvas, requested first-ref canvas, ordered refs, unmodified prompt, exact encoder/model selection, sampler/cache and no independent latent/shift. ES-module syntax checks on edits/tools passed. Coordinator independently reran focused graph test and read diff. Actual Snap three-run native test:3/3 runtime success. No full UI/regression gate, production shot landing, stage2/upscale, or main deployment is claimed.

Result: this adds a valid alternative editing path but does not solve exact set geometry. Use deterministic map state and projected/blockout camera guides before an image-model finishing pass; this trial does not establish that a finishing pass will preserve those guides.

## Isolated runtime

Unit `snap-qwen21-lab`; GPU0 only via CUDA_VISIBLE_DEVICES=0, OMP_NUM_THREADS=4 and nice19. Core main.py --use-ck-attention --base-directory qwen21/base --extra-model-paths-config qwen21/models.yaml --port8291 --listen127.0.0.1 --disable-auto-launch. Only custom node is a symlink to snap-scout. Original model files shared read-only through extra-model config; no weights copied or modified. Separate visible managed Chrome purpose `Qwen 2.1 isolated comparison`, CDP43187, page283a4a. Full systemd recipe and journal retained separately. Restart lab if needed, then start its named extra visibleChrome and read scoped instructions; never point main server at dev code.
