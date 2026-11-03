# FOR THE LOCAL CODING AGENT — execution handoff

## Objective / scope

Test whether **extra transformer depth** (repeating selected Wan or Flash blocks) in native RelayVSR X2 improves **whole-video restoration quality** on real H3-style footage, without a mandatory full-model retrain. This is experimental R&D; changes are not upstreamed and **no quality gain has yet been demonstrated**. The package contains actual executable hooks, not just a plan.

**Hard requirements**

1. **Keep the control experiment sacred.** Identical input bytes, model weights, source checkout commit, seed, FPS, resolution, encoder, CRF, GPU and runtime config. The baseline (`baseline_off`) must use the *unmodified* `lightx2v.infer` subprocess. Don't compare against a different model or with different codecs.
2. **Do not alter the LightX2V checkout in place.** This pack uses an isolated Python bootstrap for discovery/experiments. If an upstream API change requires a true patch, make it in a separate worktree/branch with a deterministic diff; document why. Keep the original CLI working.
3. **Discover the actual layer implementation before guessing indices.** LightX2V's current model internals may differ from the source snapshot the wrapper was built against. The Python pre-hook only recognizes live `torch.nn.ModuleList` groups. No discovery = no justified choice of indices.
4. **No silent success.** Require `.loop.json` to show nonzero `extra_block_calls` and the intended stage/container/indices for every experiment; otherwise treat it as a failed intervention. Runtime enforces this.
5. **Do not imply cache safety.** Flash / Dual-Memory and Wan use temporal context. `allow_stateful_repeats=true` turns off a *syntactic* check for obvious live named cache arguments; it does not isolate buffers, module attributes or external rolling caches. Check repeated outputs for ghosting, memory growth and instability.
6. **Do not overfit to one still frame.** Assess entire windows, motion, cuts, details, identity and source fidelity. A prettier frame can produce a worse video.

## Reproducibility record (fill out on machine)

```text
Machine / GPU(s):
GPU driver / CUDA runtime:
LightX2V git SHA:
LightX2V Python path:
Torch / Triton versions:
RelayVSR variant (X2 or X4):
Checkpoint filename + SHA256:
Input clip path + SHA256:
Input width x height / frames / FPS:
Output scale / encoder / CRF:
Seed:
Test date:
```

## Phase 0 — baseline feasibility

- Verify unmodified LightX2V official X2 script or CLI on a 2–4s clip. If that fails, fix the CUDA/Triton/weights environment **without editing this lab**.
- Run `python -m unittest discover -s tests -v` from the nodepack root. All CPU suite cases should pass.
- Run `python tools/check_setup.py --root ... --weights ... --python ... --variant X2`.
- Run ComfyUI with the new pack **only**; remove old `ComfyUI-RelayVSR-X2` duplicate nodepack first.
- Render `baseline_off` using the same clip twice; assess determinism numerically (decoded pixels) and whether the model itself is stable with same seed.

**Exit criterion:** a clean 2× render in the correct dimensions/FPS, with no dropped or duplicated frames and a preserved soundtrack if present.

## Phase 1 — discover actual Wan/Flash blocks

- Use `discovery_scan` preset. The `discover` worker performs an otherwise normal render and records candidate torch ModuleList owners/classes and lengths in the resulting `.loop.json`.
- Locate likely Wan keyframe transformer block list and Flash/Dual-Memory per-frame list. **Do not assume every candidate container is safe.** Source-inspect the corresponding class before any experiment; inspect `forward` signatures, KV-cache state, offload schedules and block iteration order.
- If no candidates appear, run `python tools/scan_upstream.py --root /path/to/LightX2V --output /path/to/source_scan.json`; manually inspect any submodules using plain Python lists, fused paths or direct `.forward(...)`. The runtime should then be adapted to the verified source, with tests, rather than silently sampling unrelated layers.
- Use `owner_regex` and optionally `block_class_regex` to select **exactly one correct container** per stage. Metadata includes `owner`, `list_name` and `block_class`.
- Save the discovery report and SHA of source checkout alongside the experiment manifest.

**Exit criterion:** uniquely identified Wan block list length + block class and an acknowledged cache/forward interface; optionally Flash as a later phase.

## Phase 2 — tiny controlled experiments

- First test `EXPERIMENTAL_wan_early_2pass` on a **very short** clip. This is a hypothesis; its first-four-block selector is not evidence those blocks are optimal.
- Validate `extra_block_calls.wan > 0` and `installed.wan[0].indices` matches the intended list. The report shows *block-forward replays*, not global diffusion steps.
- Try `first:2` vs `middle:2` vs `last:2`, with `loop_style=group`, `passes=2`, and `strength=0.25`, `0.5`, `1.0`. Record each output's source consistency, temporal stability, visual texture, peak VRAM and wall time.
- Compare one block group against `per_block` mode with the same selected indices to isolate order effects. This is a distinct ablation (see `docs/ARCHITECTURE_AND_SAFETY.md`).
- Run `tools/make_ab_preview.py baseline.mp4 candidate.mp4 --output ab.mp4`; review the entire video (with motion), not solely stills.
- Keep a copy of the original frames and output with no additional sharpening, wavelets or other postfilters in this experiment.

**Exit criterion:** at least one repeatable, measured difference without NaNs, corrupted clips, or unexpected large cache growth. Difference is not necessarily improvement.

## Phase 3 — temporal/cache integrity

- Check `Wan` reference memory for overwrites. If the network stores KV tensors or mutable state during block forwards, repeating them can change *future* frames even if the current block result is acceptable.
- To make this genuinely cache-safe, identify cache owners and construct a **snapshot / rollback / commit-once** or side-effect-free block interface. The current general hook does **not** implement this. Snapshotting only tensor values won't automatically cover queues, Python counters or compiled kernel state.
- For Flash experiments, **require a separate test of temporal memory**. Compare with an unchanged Flash path and inspect for lagged textures, bleeding between shots or persistent details from earlier frames.
- Initially keep `compile_model=false` and `warmup=false`, use single GPU, and disable SP/offload. Allowing either advanced mode is a deliberate later test after inspecting how they distribute or move blocks.

**Exit criterion:** verified cache state behavior at the block entry/exit, or explicit classification as an unsafe exploratory path.

## Phase 4 — promoting presets

Only after multiple clips, scenes and source types show a repeatable positive quality/speed tradeoff should a preset move out of the `EXPERIMENTAL_` namespace. A promotion should record:

- model variant, checkpoint hashes, LightX2V git commit, selector class/indices and runtime mode;
- at least three content categories (face, motion, detailed texture), ideally several clips each;
- video-level quality review and any available reference-based measurements;
- source fidelity, temporal consistency, wall time, peak VRAM, error/NaN rate, audio and frame-count checks;
- negative results/failure modes and fallback logic.

## The first three agent tasks I'd hand over

1. Get a real X2 baseline render and a **discovery report**, inspect the current Wan/Flash class implementations and report actual block counts/owner regex strings. Make minimal compatibility patches if necessary; add real-checkout fixture tests for the code path.
2. Run `first:2`/`middle:2`/`last:2` **group loops** (two passes, strength 0.5) on the same 2–4s H3 video; compare against baseline and note GPU cost/caches. Keep audio/FPS/codec unchanged.
3. If any promising outcome, examine cache mutation and implement reversible cache snapshots or a native side-effect-free block runner before tuning higher pass counts or enabling Flash loops.

## Directory/output expectations

- `ComfyUI/output/relayvsr/*.mp4`: rendered files.
- `*.json`: run settings/stats.
- `*.loop.json`: discovery, installed blocks and extra block calls.
- `experiment_manifest.json`/`.csv`: sweep result/index.
- Agent notes as `EXPERIMENT_RESULTS.md`, with links/paths/hashes to example outputs. Avoid putting large checkpoint files into this repository.

## Beyond block looping

This document deliberately describes the **initial block-loop GPU experiment**, not every feature proposed throughout the project. Continue with `MASTER_AGENT_ROADMAP.md` at the package root for P0–P5 workstreams: output validation and quality benchmarks, source/color fidelity, cut-aware reference scheduling, optical-flow temporal-detail stabilization, quality heatmaps, smart interval rerendering, ReCaVSR/SparkVSR comparison, identity/edited references, adapter training and persistent inference. The original research rationale and links remain in `docs/history/`. All of those items are **future work unless explicitly labeled implemented**.
