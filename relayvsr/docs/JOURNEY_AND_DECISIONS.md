# The journey: RelayVSR X2 → community comparison → video-control research → Block Loop Lab

_This is a concise design history, not a claim that every brainstorm was implemented._

## Phase 1 — native 2× RelayVSR caught our attention

LightX2V released [`lightx2v/RelayVSR_X2`](https://huggingface.co/lightx2v/RelayVSR_X2), a modified and continued-trained native 2× version of original RelayVSR. The original model renders at native 4×, with optional 2× delivery by downsampling; X2 uses **distinct Wan/Flash weights and architecture**. LightX2V's [RelayVSR guide](https://github.com/ModelTC/LightX2V/blob/main/scripts/relayvsr/README.md) confirms the variant/weight contract and inference options.

The first package, `ComfyUI-RelayVSR-X2`, therefore used the official **LightX2V CLI** rather than force-fitting X2 weights into the original reference implementation. It supplied ComfyUI native `VIDEO`, file-path and frame-sequence front doors; audio remux; separate inference Python; cancellation; GPU/offload/SP options. Its limitations were cold process startup, incomplete GPU validation and lack of internal neural-network tuning.

## Phase 2 — comparing the uploaded standalone original wrapper

A second implementation was shared, comprising `relay_common.py`, `relay_nodes.py`, `relay_worker.py`, etc. It targets **original RelayVSR X4** via `refvsr_inference` and the original `CollaborativeFrameStream`, rather than LightX2V X2. We observed valuable engineering there: isolated venv installer, explicit setup check, raw-RGB memmaps, frame-count/FPS validation and long-video MP4 delivery. We also noticed its MP4 delivery socket returns the original low-res `IMAGE` batch (a potential UX hazard if connected to VHS Video Combine), and that source-video ingestion differs from its file-backed direct CLI. This comparison established that **quality/robustness features** should be merged selectively without losing the native X2 backend.

The detailed earlier review is retained as `docs/history/RelayVSR_Code_Comparison_and_Merge_Plan.md`. This release focuses specifically on block-loop research; it **does not claim** all of that older proposed merge plan has been implemented.

## Phase 3 — researching additional video restoration controls

We studied sparse-reference scheduling, video-aware reference assessment, source-fidelity correction, motion-guided deflicker, reference-photo conditioning and alternate backends. The broader ideas and their sources are in `docs/history/RelayVSR_Research_Enhancement_Roadmap_2026.md`. Our repeated decision: make each knob causally meaningful and testable; do not expose a slider that the backend doesn't consume.

## Phase 4 — block looping surfaced in diffusion research

Work on **Looped Diffusion Transformer** explored repeating shared transformer computation inside a denoising step. Important caveat: naive loops can deteriorate performance, while the paper's promising results involve training-time deep supervision and attention regulation. Training-Free Looped Transformers studies a separate, predominantly language-transformer setting and reinforces the warning that naive repetition is not automatically beneficial. Neither proves a benefit for RelayVSR.

We identified two experimental targets:

- **Wan sparse references**, which might influence an entire temporal interval, making gains and failures disproportionately important.
- **Flash/Dual-Memory network**, which runs on every frame and has particularly sensitive temporal state; defer until cache safety is understood.

The idea shifted from 'add a fixed 2× block repeat' to a **general research console** with explicit indices, stages, repetition strength, schedule, and trustworthy baseline/preset handling.

## Phase 5 — implementation decisions in this bundle

1. **Don't fork or edit LightX2V files for initial work.** An isolated `relay_looping.launch` process wraps the original CLI only in discovery/experiment modes. This avoids contaminating the control path.
2. **Discover before looping.** The exact LightX2V model sources were not clonable in this environment, so the implementation targets live `nn.ModuleList` containers and logs their concrete class/size. Nothing silently applies to unrelated blocks when no match is found.
3. **Distinguish true group recurrence and per-block recurrence.** CPU tests confirmed these produce different results. Both now have separate `loop_style` choices.
4. **Offer real experimental knobs but no pretend quality labels.** Wan and Flash each have selection expressions, passes, strength, mixing and regex selectors; advanced JSON supports activation throttles.
5. **Fail closed.** Active experiments require actual replay calls; unknown hidden-state layouts or ambiguous module containers error. Obvious named cache inputs are blocked by default, but this is not complete state isolation.
6. **Sidecar/report evidence.** Each experiment writes a `.loop.json` report with the matched block group and extra executions, plus standard output metadata. This enables reproducible coding-agent iterations.
7. **Training is deferred.** Start with training-free repeats and controlled video-level comparisons. If those find repeatable improvements, investigate model-specific cache-safe loops and then potentially small LoRAs/gates rather than assuming a published trained Looped-DiT checkpoint can be reused.

## What remains open

Real X2 weights, CUDA inference, live LightX2V module topology, compiled/block-offloaded performance, Flash cache mutation and quality effects **are untested**. This bundle should make those local experiments concrete, reversible and reportable, not magically solve them.
