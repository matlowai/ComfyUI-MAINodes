# New view partial denoise — implementation report

READ FIRST: Development-only code ready for coordinator review and runtime validation. No render, model load, server/page reload, production edit, commit, push, download or delete performed. Main stays pinned. Existing uncommitted Qwen adapter is retained.

## Interface and exact behavior

`edit_from_context {pictures, prompt, method: "ph3_view" | "qwen21_view", denoise: 0.7, ...}`.
Omitted denoise or `1` gives the existing graph and provenance exactly. For values below `1`, Picture 1 supplies the actual sampled target through native VAEEncode; its existing conditioning references stay unchanged and ordered. Cropping/paste-back occurs before first-picture selection. First batch image is selected, matching native encoders. Native GetLatentSize reads the original empty target, including nested H3; its raw latent width/height are multiplied by 16 for these two native model families, then ImageScale sizes Picture 1 to that exact canvas. This avoids duplicating native canvas rounding and aspect/area policy. A requested Qwen first-picture resize is respected before target sizing.

- P-H3: VAEEncode video + original empty target's separated audio -> native AV concat -> sampler. RandomNoise stays enabled. H3DeropeSigmas has `inject=denoise`, `steps=0`; `start=model_sampling.percent_to_sigma(1-denoise)`, followed by original sigmas strictly below start. Transition count varies; this is not a fraction of original steps. Actual node schema accepts inject 0.05..1, so smaller partial H3 values fail clearly before queueing.
- Qwen: native KSampler denoise, encoded Picture 1 target, original positive/negative/cache/model/settings. Native denoise `0` is accepted. Nonzero partial denoise expands the schedule then takes its suffix; strengths are not numerically equivalent to H3 continuous inject.
- Other view kinds: partial init fails explicitly; full/omitted denoise preserves prior behavior. Invalid range/types fail at the boundary.
- Parent and decision provenance plus the immediate result carry `init {picture:1,denoise,schedule}`. Requested canvas is recorded for partial runs. `rerunView` passes init denoise and canvas back into the real fromContext call; it does not silently regenerate from noise.

## Owned changes

- `web/snap/edits.js`: narrow initFirst transform at the existing New view boundary, validation, result/provenance fields; corrected pre-existing Qwen comment to call its default target an empty canvas.
- `web/snap/tools.js`: optional denoise schema and forwarding; no new tool or dependency.
- `web/snap/rerun.js`: replay init denoise and canvas for partial New views.
- `tests/snap/test_view_init.js`: focused CPU contract checks for default equivalence, exact encoded first-picture target trace, size-query links, original references, H3 audio/noise/sigma paths, Qwen zero and partial denoise, provenance, real rerun function and actual tool forwarding.

Coordinator owns SNAP-R270, skill and study-wide documentation updates. Existing Qwen edits remain visible in the repository diff because they predate this worker.

## Checks

Run from development pack root:

```sh
node tests/snap/test_view_init.js
node tests/snap/test_qwen21_graph.js
git diff --check
```

All pass. Syntax checked all three modified JS modules as `.mjs` copies with `node --check`; all pass. Read-only GETs on dev :8291 confirm every added node type and input/output schema; complete snapshot is `native_registry.json`. Output is `checks.txt`. One initial test-harness error (missing C.kind mock for actual rerun module) was fixed; subsequent checks passed.

## Runtime gate still open

Runner must reload development page, exercise actual native P-H3/Qwen through Snap, inspect executed sampler target graph, actual latent shapes and retained H3 audio, and review rendered results. Native registry presence and CPU graph checks do not prove GPU execution or quality. Preserve actual executed sigma lists/start/count and inputs in experiment results. No full regression gate claimed.
