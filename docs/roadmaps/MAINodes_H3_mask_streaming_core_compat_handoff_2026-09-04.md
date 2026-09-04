# Coding-agent handoff: MiniMax H3 mask semantics, MAINodes streaming compatibility, FaceRefine findings, and the motion/window puzzle

**Status snapshot:** 2026-09-04 (America/New_York)

**Primary repo to modify:** https://github.com/matlowai/ComfyUI-MAINodes

**External repo examined:** https://github.com/Carasibana/ComfyUI-H3-FaceRefine

**Upstream:** https://github.com/Comfy-Org/ComfyUI

**Purpose of this packet:** Give a coding agent enough technical context, source pointers, implementation constraints, tests, and experiment design to make the H3 compatibility changes correctly without needing the conversation that produced this research.

---

## 0. Executive directive

There are several separate H3 problems that currently look like one large "mask/window flicker" problem. Do **not** collapse them together.

The work worth doing now is:

1. **Fix `H3StreamedBlocks` for ComfyUI PR #15375 per-token modulation rows.**
   - This is MAINodes issue #5.
   - It is a structural compatibility fix and should be merged now.
   - Preserve scalar-row behavior bit-for-bit.

2. **Fix `H3StreamedBlocks` for ComfyUI PR #15908's `FinalLayer.forward` contract and PDD head bank.**
   - This is MAINodes issue #4.
   - Accept/forward the new arguments.
   - Do **not** silently stream a multi-head PDD final projection using the old single-head algorithm. Fall back to stock for PDD unless streamed PDD is deliberately implemented and tested.

3. **Backport the semantics of pending ComfyUI PR #15988 into MAINodes behind capability detection.**
   - PR #15988 is still open as of this snapshot.
   - It is only six model-code additions: multiply returned video/audio velocity by their denoise masks **after `_forward` and before the outer audio carry/x0 conversion**.
   - Use Comfy's `WrappersMP.DIFFUSION_MODEL` extension point rather than monkey-patching or copying all of `MiniMaxH3Model.forward`.
   - Make the compatibility wrapper idempotent and automatically stop installing it once the running Comfy core contains the native fix.
   - Fail closed on unknown/foreign class rewrites so the velocity is never accidentally mask-scaled twice.

4. **Do not update `_STOCK_FORWARD_SHA` yet.**
   - The stale hash is currently a safety guard.
   - MAINodes' copied `_trimmed_forward` predates #15375 and silently lacks current denoise-mask/per-token-row behavior.
   - Refreshing the hash without a real rebase would turn a loud skip into silently wrong output.

5. **Add a small MODEL -> MODEL compatibility node or equivalent explicit path for workflows that use `H3TemporalInsert` without `H3StreamedBlocks`.**
   - `H3TemporalInsert` emits a LATENT and cannot patch the model itself.
   - The same compatibility helper should also be called automatically by `H3StreamedBlocks` so existing low-VRAM workflows need no rewiring.
   - Once #15988 is native, this node/helper becomes a no-op.

6. **Do not remove or rewrite the motion adapter based on #15988.**
   - The original True Clock / temporal-insert pathologies were measured on 2026-08-15.
   - #15375, which introduced the model-side local mask-timestep mechanism that #15988 repairs, merged on 2026-08-18.
   - Therefore #15988 cannot be the original reason the motion adapter became useful.
   - It can contaminate later masked experiments, so re-run the adapter A/B after the core compatibility work, but treat it as a separate causal question.

7. **Investigate ComfyUI issue #15982 separately after the compatibility fixes.**
   - #15982 reports that native Comfy context windows lose global window position, causing H3 window-period flicker.
   - This is conceptually close to MAINodes True Clock / temporal-coordinate work.
   - It is **not yet proven** to affect MAINodes' own independent burst-window workflow in the same way. Do not merge a speculative offset change into the compatibility patch.

If time is limited, complete items 1-4 plus tests first. Those are concrete correctness fixes.

---

## 1. Source map and status

### MAINodes issues filed by Carasibana

#### MAINodes issue #4 - FinalLayer/PDD compatibility
https://github.com/matlowai/ComfyUI-MAINodes/issues/4

Title: `H3StreamedBlocks: 'Tensor' object has no attribute 'adaln_proj' on ComfyUI 2504e68d4 and later`

Opened 2026-08-29 by Carasibana.

Reported branch:
https://github.com/Carasibana/ComfyUI-MAINodes/tree/fix/final-layer-signature-15908

Core cause: ComfyUI PR #15908 changed H3 `FinalLayer.forward` from four user arguments to seven:

```python
# old
forward(x, t_emb, video_seg, audio_seg)

# new
forward(x, t_emb, video_seg, audio_seg, sigma, sample_sigmas, shifts)
```

MAINodes currently captures its internal state as positional default parameters:

```python
def _fl_forward(x, t_emb, video_seg, audio_seg,
                _fl=fl, _c=int(final_layer_chunk), _e=_exact):
    ...
```

Therefore the three new positional values bind as:

| Core argument | MAINodes parameter it accidentally replaces |
|---|---|
| `sigma` | `_fl` |
| `sample_sigmas` | `_c` |
| `shifts` | `_e` |

`_fl` becomes a Tensor and `streamed_final_layer_forward` immediately tries `fl.adaln_proj`, causing the observed exception.

Carasibana's report also correctly points out a second correctness issue: PDD may turn the final output projection into a bank of heads, and the old MAINodes streaming final-layer path does not perform sigma-interval head selection/blending. If the wrapper is changed only enough to stop crashing, it could silently use the wrong output head.

Reported verification: 294-frame 768x576 render completed at about 85 s/step after the patch; previously every attempt failed.

---

#### MAINodes issue #5 - per-token modulation rows
https://github.com/matlowai/ComfyUI-MAINodes/issues/5

Title: `H3StreamedBlocks: size mismatch in _mod_scale_shift_range on any per-token noise mask (ComfyUI ff6c8a8af and later)`

Opened 2026-08-30 by Carasibana.

Reported branch:
https://github.com/Carasibana/ComfyUI-MAINodes/tree/fix/per-token-mod-rows-15375

Core cause: ComfyUI PR #15375 made a `mod_segments` row selector polymorphic:

```text
old/common path: row = scalar modulation-table index
new masked path: row = LongTensor, one modulation-table index per token in that segment
```

Core handles both via an indexing helper equivalent to:

```python
def _mod_row(vecs, row, dtype):
    return vecs[row].to(dtype)
```

MAINodes streams a segment in chunks. Current code does this:

```python
h[lo - c0:hi - c0].mul_(1.0 + scale[row].to(h.dtype)).add_(shift[row].to(h.dtype))
```

If `row` is a whole-segment tensor, `scale[row]` has one row per token in the whole segment while the left side contains only the current chunk intersection. That is the reported shape mismatch.

The issue's concrete example:

```text
chunk/segment overlap: 10,565 tokens
whole video segment:   52,992 tokens
```

The count is not mysterious: the video segment is last in H3's packed layout, so a 16,384-token KV chunk had 5,819 earlier text/ref/audio rows and 10,565 video rows. `scale[row]` incorrectly materialized all 52,992 video rows.

Carasibana's proposed primitive is correct:

```python
def _mod_row_range(vec, row, a, lo, hi):
    """vec[row] restricted to [lo, hi) inside a segment beginning at a."""
    return vec[row[lo - a:hi - a]] if torch.is_tensor(row) else vec[row]
```

And for sites that only need the segment's modality tag:

```python
def _mod_seg_kind(row):
    return int(row.reshape(-1)[0]) if torch.is_tensor(row) else int(row)
```

The issue identifies all the places that need the same conceptual update:

- `_mod_scale_shift_range`
- `_mod_gate_range`
- `streamed_final_layer_forward.head`
- `_exact_av_rows`
- `_exact_av_rows_mixed`
- `_PrecProbe._seg_kind`

The last one is diagnostic labeling, not math, but should still be corrected rather than left misleading.

Reported verification against MAINodes origin/main at that time:

- scalar rows: `max|diff| = 0` across chunk sizes 97, 333, 1024, 4096, 16384;
- per-token rows: `max|diff| = 0` versus an unchunked reference at chunk sizes 128, 300, 777, 1024, 16384, including segment-boundary crossings;
- 311-frame 736x736 render with varying per-frame denoise mask completed, 8 steps about 95 s/step; unpatched failed at step 0.

This is strong evidence. Reproduce locally, but do not waste time trying to disprove a shape analysis that is already structurally clear.

---

### ComfyUI PR #15375 - source of per-token mask support
https://github.com/Comfy-Org/ComfyUI/pull/15375

Title: `Support per-token video and audio latent noise masks on MiniMax-H3`

Status: **merged 2026-08-18**, merge commit `ff6c8a8`.

What changed at a high level:

- H3 can consume denoise masks for video and audio as model-side conditions.
- Masks are aligned to H3's token/patch geometry.
- Mask values can create per-row local timesteps.
- When row timesteps vary within a segment, H3 emits per-token modulation-row selectors rather than one scalar selector for the segment.

This is why MAINodes #5 exists: `H3StreamedBlocks` copied an assumption from older core that each segment had one scalar row selector.

Important historical review note from #15375: reviewers were already concerned about mismatch between pixel/latent blending and token-grid timesteps. That concern is related to the later #15981/#15988 bug, but do not use review speculation as the implementation contract. #15988 now provides a concrete correction and regression tests.

---

### ComfyUI issue #15981 - broken H3 denoise-mask math
https://github.com/Comfy-Org/ComfyUI/issues/15981

Title: `MiniMax-H3: any denoise mask produces a repeating grid artifact since #15375`

Status at snapshot: open, linked to #15988.

Opened 2026-08-30 by Carasibana.

Key observation: after #15375, **even a uniform denoise mask can produce a repeating spatial grid artifact**. The problem is not limited to spatially varying masks.

The issue explains that the mask participates in two mechanisms:

1. Generic sampler inpaint blending already mixes latent/noise and output by the mask.
2. H3 now also reads the mask and assigns local row timesteps such that a row behaves as if it were at `mask * sigma`.

The network therefore predicts a velocity for a local sigma while the outer conversion still interprets that velocity with the global sigma.

The issue measured a spatial-frequency signature at latent-cell scale and reports that suppressing model-side video-mask handling removes the artifact while sampler blending still performs the mask behavior.

That workaround directly motivated the current FaceRefine implementation described below.

---

### ComfyUI issue #15978 - broader user report of broken H3 masking
https://github.com/Comfy-Org/ComfyUI/issues/15978

Title: `MiniMax H3 masking broken in v0.34.0+ (works on v0.33.4)`

Status at snapshot: open, linked to #15988.

User-visible symptom: the region intended for diffusion becomes garbled/gray rather than properly inpainted. Reporter identifies #15375 / v0.34.0 as the regression point. #15988 says it likely fixes this issue too.

Treat #15978 as independent corroboration that the bug is not specific to FaceRefine or MAINodes.

---

### ComfyUI PR #15988 - pending semantic correction
https://github.com/Comfy-Org/ComfyUI/pull/15988

Title: `Fix MiniMax H3 denoise mask velocity conversion`

Status at snapshot: **OPEN** on 2026-09-04.

Code-change commit at snapshot:
`bdafd1921488c1cb73c1939bb9c51641ea3a270e`

Files-changed view:
https://github.com/Comfy-Org/ComfyUI/pull/15988/files

The core model change is exactly six added lines around `MiniMaxH3Model.forward`:

```python
# after WrapperExecutor(... self._forward ...).execute(...)
# and before outer audio carry conversion

# Masked rows predict at mask * sigma; scale their velocity to match the outer x0 conversion.
if denoise_mask is not None:
    out[0] = out[0] * denoise_mask
if audio_denoise_mask is not None:
    out[1] = out[1] * audio_denoise_mask
```

The PR's mathematical contract:

```text
model evaluates masked rows at local sigma = mask * sigma
outer CONST/x0 conversion uses global sigma
therefore returned velocity must be scaled by mask
x0 = x - sigma * (mask * velocity)
```

Upstream testing in the PR reports:

- baseline max x0 error at sigma 0.45 and mask 205/256: `0.6487081`
- patched max x0 error: `4.77e-7`
- dedicated test for video masked x0 recovery
- dedicated test for audio velocity scaling occurring before H3's outer audio carry conversion

The order is important. Do not move the audio multiplication after the carry conversion.

The PR also had a user report that applying it locally fixed long-form video chaining degradation. Treat that as anecdotal corroboration, not as the formal test.

---

### ComfyUI PR #15908 - PDD final-layer bank
https://github.com/Comfy-Org/ComfyUI/pull/15908

Title: `MiniMax-H3: Support PDD LoRA`

Status: **merged 2026-08-28**, merge commit `2504e68`.

Relevant model change:

- `FinalLayer` can interpret output projection weights as a bank of PDD heads.
- It selects/blends interval heads using sampler state (`sigma`, `sample_sigmas`, shifts).
- Plain single-head checkpoints retain direct projection behavior.
- The H3 caller now passes the new sampler-state arguments unconditionally.

This is the upstream change behind MAINodes issue #4.

---

### ComfyUI issue #15960 - confirms #15908 broke custom wrappers
https://github.com/Comfy-Org/ComfyUI/issues/15960

Title: `PDD support unnecessarily breaks the MiniMax H3 FinalLayer.forward calling contract`

Status at snapshot: open.

This is useful because it confirms MAINodes is not uniquely broken. Other H3 optimization/custom nodes that wrapped `FinalLayer.forward` also broke when the mandatory positional parameters were added.

Do not depend on upstream restoring compatibility. MAINodes should accept current core now.

---

### ComfyUI issue #15982 - global window-position loss
https://github.com/Comfy-Org/ComfyUI/issues/15982

Title: `Context windows: a model is never told where its window sits on the timeline`

Status at snapshot: open.

Opened 2026-08-30 by wordbrew.

Reported H3 symptom:

- first context window is clean;
- from window two onward, video flickers at the window period.

Reported mechanism:

- `IndexListContextHandler` slices the latent using the context-window index list;
- that window-position information does not reach the H3 forward path;
- H3 `PackedLayout` computes target video time from `text_len + reference spans` only;
- every context window therefore constructs target positions as though it begins at the same clip origin.

The reporter logged 167 layout builds across a 9-window run with only one distinct target start.

This is important to our research because MAINodes has independently spent substantial effort on true temporal coordinates, de-RoPE, DyRoPE, rolling/burst windows, and seam behavior. It is the same broad class of abstraction leak: **tokens are being interpreted with temporal coordinates that may not match where those tokens belong in the world timeline.**

However, MAINodes' own `H3WindowPlan` / segment-crop workflow can be an independent local render job rather than Comfy's internal context-window slicing. A local subclip having a local origin can be valid. Do not apply #15982's proposed remedy to MAINodes without an A/B that proves MAINodes' path loses global position in the same way.

---

## 2. Current MAINodes code paths that matter

Use symbol search rather than trusting line numbers; line numbers below are only snapshot orientation.

### `vram_lab.py`
Raw current:
https://raw.githubusercontent.com/matlowai/ComfyUI-MAINodes/main/vram_lab.py

#### Current modulation helpers

At snapshot the core problem is visible directly:

```python
def _mod_scale_shift_range(h, shift, scale, segments, c0, c1):
    for a, b, row in segments:
        lo, hi = max(a, c0), min(b, c1)
        if lo < hi:
            h[lo - c0:hi - c0].mul_(1.0 + scale[row].to(h.dtype)).add_(shift[row].to(h.dtype))
    return h


def _mod_gate_range(x, gate, other, segments, c0, c1):
    for a, b, row in segments:
        lo, hi = max(a, c0), min(b, c1)
        if lo < hi:
            x[lo:hi].addcmul_(other[lo - c0:hi - c0], gate[row].to(x.dtype))
    return x
```

These are only correct when `row` is scalar or when the current chunk happens to cover exactly the whole segment.

#### Current FinalLayer wrapper

At snapshot:

```python
def _fl_forward(x, t_emb, video_seg, audio_seg,
                _fl=fl, _c=int(final_layer_chunk), _e=_exact):
    if x.shape[0] < cfg["min_tokens"]:
        return type(_fl).forward(_fl, x, t_emb, video_seg, audio_seg)
    return streamed_final_layer_forward(
        _fl, x, t_emb, video_seg, audio_seg,
        chunk=_c,
        probe=getattr(dm, "_h3_memprobe", None),
        exact_gemm=_e,
    )
```

This is incompatible with #15908 for the reason described above.

#### `_STOCK_FORWARD_SHA`

At snapshot:

```python
_STOCK_FORWARD_SHA = "f40e52b23fb2f9c7"
```

and `H3StreamedBlocks` only installs its copied `_trimmed_forward` when the installed Comfy `_forward` source hash matches.

Carasibana observed installed hash `06f09532bec4aed6` versus expected `f40e52b23fb2f9c7`, so trim-forward currently skips safely.

**DO NOT refresh this constant as part of the compatibility work.**

Why: the copy predates #15375. It accepts `**kwargs` but does not implement current `denoise_mask` / `audio_denoise_mask` local row-timestep construction. It emits scalar `mod_segments`. If the hash is refreshed without porting all modern semantics, masked runs will silently become uniform-denoise runs. That is worse than a warning and disabled optimization.

Treat re-basing `_trimmed_forward` as a separate project with its own parity tests.

---

### `motion.py` / `H3TemporalInsert`
Raw current:
https://raw.githubusercontent.com/matlowai/ComfyUI-MAINodes/main/motion.py

`H3TemporalInsert` is a native reproduction of MAINodes issue #5.

It expands the video latent temporally, then constructs:

```python
mask_v = torch.zeros(1, 1, t_dil, video.shape[3], video.shape[4], ...)
for n in inserted:
    mask_v[:, :, n] = 1.0
...
mask_a = torch.ones(...)
out["noise_mask"] = NestedTensor((mask_v, mask_a))
```

Semantics:

```text
original/copy token-times -> mask 0 -> frozen/preserved
inserted token-times      -> mask 1 -> regenerate
```

This is exactly a non-uniform video mask. On Comfy after #15375 it can create per-token `mod_segments` row tensors, so current H3StreamedBlocks can crash even with no FaceRefine installed.

This is important for scope: MAINodes #5 is not "compatibility for somebody else's plugin." It fixes a path produced by MAINodes itself.

---

### `h3_capabilities.py`
Raw current:
https://raw.githubusercontent.com/matlowai/ComfyUI-MAINodes/main/h3_capabilities.py

This file is already designed for this situation. It deliberately inspects the **running source** rather than trusting a Comfy version number, because users can have tagged builds, nightlies, or cherry-picked commits.

It already has:

```python
caps["per_token_masks"] = "_pool_masks_to_token_grid" in comfy.model_base source
caps["mask_rows_fractional"] = "def mask_row_values" in H3 model source
```

and it already reports foreign object patches/class rewrites.

Extend this mechanism rather than inventing version checks.

Recommended new capability:

```text
mask_velocity_conversion =
    "native"                  # #15988 behavior detected in running core
    "compat_needed"           # #15375 local mask timesteps exist, native correction absent, core shape recognized
    "legacy_no_model_mask"    # pre-#15375 core; do not apply #15988 scaling
    "unknown"                 # source unreadable or foreign rewrite means double-scaling risk
```

The old three-state True/False/unknown convention is fine for booleans, but this compatibility point benefits from explicit semantic states.

Detection should inspect `MiniMaxH3Model.forward` specifically, not merely the whole module, so comments/tests elsewhere do not create a false positive.

A pragmatic native detector can tolerate whitespace variants of both operations:

```python
out[0] = out[0] * denoise_mask
out[1] = out[1] * audio_denoise_mask
```

An AST-based detector is stronger if convenient. Do not over-engineer it at the expense of finishing the fix.

Before returning `compat_needed`, also verify enough structural anchors to know this is the known post-#15375/pre-#15988 core:

- H3 model-side mask rows are present;
- `MiniMaxH3Model.forward` uses `WrapperExecutor` around `_forward`;
- the outer audio carry conversion occurs after that call;
- `MiniMaxH3Model.forward` is owned by Comfy core, not a foreign custom-node class rewrite.

If ownership/source is unknown, return `unknown` and warn rather than risking multiplication twice.

Update `format_report()` so a user sees this clearly, e.g.:

```text
per_token_masks             yes
mask_velocity_conversion    compat_needed   #15988 not native; MAINodes compatibility shim can correct it
```

or:

```text
mask_velocity_conversion    native          upstream #15988 behavior present; MAINodes shim disabled
```

---

## 3. FaceRefine repo: why it is relevant and what not to copy blindly

Repo:
https://github.com/Carasibana/ComfyUI-H3-FaceRefine

Raw implementation:
https://raw.githubusercontent.com/Carasibana/ComfyUI-H3-FaceRefine/main/nodes.py

FaceRefine is a per-frame face-refinement workflow around H3. The relevant node is `H3 Per-Frame Denoise`, which varies denoise strength along time based on measured face size.

The current README explicitly says the node must sit in the **MODEL** path because it makes two model-level changes:

1. keep its video denoise mask out of H3's per-token timestep mechanism;
2. re-noise held frames to the sampler's current sigma.

The two implementation helpers are especially useful evidence.

### `_mask_via_sampler_only(model)`

Its comments state the current reasoning directly:

- a video mask otherwise affects sampler blending and H3 local row timesteps;
- the mismatch creates the repeating latent-cell grid;
- only the video entry is suppressed;
- audio mask conditioning is preserved because their native-audio lock/lipsync depends on it.

This is a deliberate workaround for the current pre-#15988 core, not accidental behavior.

### `_renoised_inpaint(model)`

When FaceRefine suppresses the model-side video mask, the preserved injected frames would otherwise be much cleaner than the current sampler sigma. The helper patches `scale_latent_inpaint` so held frames are re-noised to the sigma the sampler is actually on. It preserves H3's audio rescaling semantics.

### What this means for MAINodes

Do **not** port FaceRefine's sampler-only workaround into MAINodes as the general solution.

Why:

- #15988 provides a direct upstream mathematical correction for H3's native model-side mask path.
- MAINodes `H3TemporalInsert` wants the native per-token local-timestep semantics: mask-0 preserved token-times and mask-1 generated in-betweens are genuinely different local denoise states.
- Suppressing the entire model-side mechanism would change the algorithm rather than merely correct the conversion.

FaceRefine's workaround remains a valuable alternate algorithm and a useful pre-#15988 consumer test.

After #15988 semantics are active, FaceRefine should eventually A/B:

```text
A. native H3 per-token mask behavior with #15988 correction
B. sampler-only video mask + re-noised held frames
```

Do not assume B becomes wrong. It may have desirable practical properties. It simply stops being the only mathematically sane way around a known core bug.

MAINodes does not need to edit FaceRefine for this task.

---

## 4. Recommended implementation architecture

### 4.1 Port per-token-row support first

Use Carasibana's `fix/per-token-mod-rows-15375` branch as a reference, not as unquestioned truth.

Suggested inspection workflow:

```bash
git remote add carasibana https://github.com/Carasibana/ComfyUI-MAINodes.git 2>/dev/null || true
git fetch carasibana

git diff origin/main...carasibana/fix/per-token-mod-rows-15375 -- vram_lab.py
git diff origin/main...carasibana/fix/final-layer-signature-15908 -- vram_lab.py
```

If local `main` has advanced, port the ideas by symbol rather than cherry-picking conflict-heavy commits.

Add a primitive equivalent to:

```python
def _mod_row_range(vec, row, a, lo, hi):
    """Select modulation rows for [lo, hi) of segment [a, b)."""
    if torch.is_tensor(row):
        return vec[row[lo - a:hi - a]]
    return vec[row]
```

Then update every chunked consumer.

For segment-relative final-layer chunks, be careful about coordinate systems. If `c0/c1` are already relative to the segment, the slice is `row[c0:c1]`; do not subtract the packed-sequence segment start twice.

Add a helper for places that need only the modality kind:

```python
def _mod_seg_kind(row):
    if torch.is_tensor(row):
        if row.numel() == 0:
            raise ValueError("empty per-token modulation row")
        return int(row.reshape(-1)[0])
    return int(row)
```

Why first element is valid in those sites: core's `rows_to_mod_index` varies the timestep-table portion while modality tag remains constant for that segment. Confirm against current core before relying on it, then encode the assumption in a test/comment.

### 4.2 Fix the FinalLayer wrapper second

At minimum, move captured defaults behind `*extra` so they cannot be overwritten positionally.

Recommended compatibility shape:

```python
def _fl_forward(
    x,
    t_emb,
    video_seg,
    audio_seg,
    *extra,
    _fl=fl,
    _c=int(final_layer_chunk),
    _e=_exact,
    **kwargs,
):
    vo = _fl.video_out
    n_heads = vo.weight.shape[0] // vo.out_features

    if n_heads > 1 or x.shape[0] < cfg["min_tokens"]:
        return type(_fl).forward(
            _fl,
            x,
            t_emb,
            video_seg,
            audio_seg,
            *extra,
            **kwargs,
        )

    # Single-head path may stream, but it still needs correct per-token video/audio seg rows.
    return streamed_final_layer_forward(
        _fl,
        x,
        t_emb,
        video_seg,
        audio_seg,
        chunk=_c,
        probe=getattr(dm, "_h3_memprobe", None),
        exact_gemm=_e,
    )
```

Notes:

- `**kwargs` is intentional future-proofing even though current Comfy passes the PDD arguments positionally.
- The exact PDD-bank detection should be validated against current `FinalLayer` module attributes. Do not blindly trust a shape division if a quantized/proxy weight type changes the contract.
- If detection cannot be proven for a model, prefer stock FinalLayer over silently wrong streaming.
- A later optimization can stream each PDD head while preserving Comfy's dt-weighted interval blend, but that is not required to restore correctness now.

### 4.3 Implement #15988 as a capability-gated ModelPatcher wrapper

Current upstream `MiniMaxH3Model.forward` does this ordering:

```text
undo audio carried representation
    -> WrapperExecutor(self._forward, WrappersMP.DIFFUSION_MODEL).execute(...)
    -> outer audio carry/schedule velocity conversion
    -> return
```

This is ideal. A `WrappersMP.DIFFUSION_MODEL` wrapper sees the raw `_forward` output **before** outer audio conversion, which is exactly where #15988 inserts its multiplication.

Comfy provides keyed wrapper APIs on ModelPatcher:

```python
model.add_wrapper_with_key(wrapper_type, key, wrapper)
model.remove_wrappers_with_key(wrapper_type, key)
```

Use a stable key such as:

```python
_H3_MASK_VELOCITY_COMPAT_KEY = "mainodes_h3_mask_velocity_15988"
```

Suggested helper shape (adapt imports/style to repo conventions):

```python
def apply_h3_mask_velocity_compat(model):
    """Return a clone with the pending #15988 behavior only when running core needs it."""
    caps = probe_core()
    state = caps.get("mask_velocity_conversion", "unknown")

    m = model.clone()

    # Always remove our own key first so repeated application is idempotent.
    try:
        m.remove_wrappers_with_key(
            comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
            _H3_MASK_VELOCITY_COMPAT_KEY,
        )
    except AttributeError:
        # This itself should normally imply an older/unsupported core.
        ...

    if state in ("native", "legacy_no_model_mask"):
        return m

    if state != "compat_needed":
        log.warning(
            "H3 mask velocity compatibility not applied: core state=%s; "
            "refusing to risk double scaling",
            state,
        )
        return m

    def _wrapper(executor, *args, **kwargs):
        out = executor(*args, **kwargs)

        video_mask = kwargs.get("denoise_mask")
        audio_mask = kwargs.get("audio_denoise_mask")

        # Current _forward returns a mutable list. Be defensive if upstream changes it.
        if isinstance(out, tuple):
            out = list(out)

        if video_mask is not None:
            out[0] = out[0] * video_mask
        if audio_mask is not None:
            out[1] = out[1] * audio_mask

        return out

    m.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        _H3_MASK_VELOCITY_COMPAT_KEY,
        _wrapper,
    )
    return m
```

The `WrapperExecutor` contract in current core is:

```python
wrapper(executor, *args, **kwargs)
out = executor(*args, **kwargs)  # calls next wrapper/original
```

Do not call `executor.execute(...)` from inside a received wrapper; Comfy's source explicitly says to call the executor object itself so it advances to the next wrapper.

### 4.4 Restrict the wrapper to MiniMax H3

Before installing, prove that the ModelPatcher actually wraps a current MiniMax H3 diffusion model. Use the repo's existing H3 checks or inspect `model.model.diffusion_model` carefully.

Do not install a generic `DIFFUSION_MODEL` mask scaler on arbitrary models.

### 4.5 Handle foreign H3 class rewrites conservatively

`h3_capabilities.block_patch_report()` already detects import-time rewrites of:

- `MiniMaxH3Model.forward`
- `MiniMaxH3Model._forward`
- `DiTBlock.forward`
- `Attention.forward`
- `FinalLayer.forward`

If `MiniMaxH3Model.forward` has been rewritten by another custom node and the capability detector cannot prove #15988 semantics are absent/present, do not auto-install a second scaler.

Report something actionable such as:

```text
H3 mask velocity fix: UNKNOWN because MiniMaxH3Model.forward is rewritten by <pack>.
MAINodes did not apply its #15988 compatibility shim to avoid double-scaling velocity.
```

This is exactly the kind of collision that the capability module exists to make loud.

### 4.6 Expose an explicit compatibility node

Recommended node concept:

```text
H3 Core Compatibility (alpha)
MODEL -> MODEL
```

Responsibilities:

- inspect running H3 core capabilities;
- apply the #15988 semantic shim only when required;
- optionally print/report what it did;
- no-op on native fixed core;
- no-op on pre-#15375 core;
- warn and no-op on unknown/foreign-rewrite state.

This solves a real graph-coverage issue:

```text
H3TemporalInsert -> LATENT
```

cannot patch a model. A user can legitimately run temporal insert with stock H3 and without `H3StreamedBlocks`. The explicit compatibility node gives that graph a correct model path while upstream #15988 is pending.

Also call the same helper automatically inside `H3StreamedBlocks`, so low-VRAM users do not have to add the node manually.

Avoid two independent implementations. One helper, two entry points.

### 4.7 Do not bake an upstream commit hash into runtime logic

For development validation, the #15988 code commit is currently:

```text
bdafd1921488c1cb73c1939bb9c51641ea3a270e
```

But runtime compatibility should detect semantics/source, not this hash. The PR branch can be rebased or amended before merge.

---

## 5. Why the #15988 compatibility wrapper should be safe

### Current broken/pending-core path

```text
sampler supplies denoise mask
       |
       +--> sampler inpaint blending
       |
       +--> H3 model-side local row timesteps (#15375)
                 |
                 +--> network predicts velocity at local sigma = mask * sigma
                              |
                              +--> outer conversion interprets velocity at global sigma
                                      -> wrong x0 / grid artifact
```

### With the temporary MAINodes wrapper

```text
network raw velocity at local sigma
       |
DIFFUSION_MODEL wrapper
       |
velocity *= corresponding mask
       |
outer audio carry conversion (audio only, unchanged ordering)
       |
outer CONST/x0 conversion sees globally-scaled equivalent velocity
```

### With future native #15988

Capability detector sees native multiplication in `MiniMaxH3Model.forward`:

```text
state = native
MAINodes wrapper not installed
```

No double multiplication. Existing workflows continue to load.

### On pre-#15375 core

There is no model-side local mask timestep to correct:

```text
state = legacy_no_model_mask
MAINodes wrapper not installed
```

Generic sampler mask behavior remains untouched.

---

## 6. Test plan - mandatory before declaring this done

Do not rely only on a successful video render. Most dangerous failure modes here are silent semantic differences.

### 6.1 Unit tests for modulation-row chunking

Create focused tests for `_mod_row_range`, `_mod_scale_shift_range`, and `_mod_gate_range` that do not require loading H3 weights.

#### Scalar rows

For several segment layouts and chunk sizes:

```text
97, 333, 1024, 4096, 16384
```

compare patched helper output to current unpatched scalar behavior.

Acceptance:

```text
max_abs_diff == 0
```

Use exact equality where dtype/operation ordering allows it. Carasibana reports bit-identical output, so do not weaken the test unnecessarily.

#### Per-token rows

Build a synthetic modulation table and a segment whose `row` is a LongTensor with changing table indices. Compare chunked application to a straightforward unchunked reference.

Include:

- chunk fully inside a segment;
- chunk starts before and ends inside video segment;
- chunk starts inside and ends after segment;
- chunk straddles a segment boundary;
- odd chunk sizes such as 128, 300, 777, 1024;
- a full-size/no-split reference.

Acceptance:

```text
max_abs_diff == 0
```

#### Modality extraction

Test `_mod_seg_kind` using representative scalar and per-token row selectors generated with the same `row_index * 3 + tag` convention as current H3.

Prove that timestep index can vary while modality tag remains the expected one.

Fix `_PrecProbe` label behavior too; diagnostics should not say `cond_video` when they mean target video.

---

### 6.2 Unit tests for streamed FinalLayer

#### Old/single-head contract

- single head;
- scalar segment rows;
- result matches stock FinalLayer/reference.

#### Per-token segment rows

- tensor video row selector;
- tensor audio row selector if practical;
- multiple final-layer chunk sizes;
- compare to a simple unchunked reference.

#### New #15908 calling contract

Call patched `_fl_forward` with:

```python
sigma
sample_sigmas
shifts
```

both positionally as current core does and, if the wrapper accepts it, as keywords to verify future tolerance.

Assert captured `_fl`, chunk size, and exact-GEMM flag are not overwritten.

#### PDD multi-head guard

Construct/mock `video_out` / `audio_out` with >1 bank head according to current core's detection shape.

Assert:

- MAINodes delegates to stock `FinalLayer.forward`;
- sigma/schedule/shifts reach stock;
- streamed single-head implementation is not called.

If a real PDD LoRA is available in the dev environment, add one end-to-end smoke render after unit coverage.

---

### 6.3 Capability-probe tests

Prefer fixtures or monkeypatched source strings/classes rather than requiring multiple Comfy installs.

Cover:

1. **pre-#15375**
   - no `_pool_masks_to_token_grid`
   - expected `legacy_no_model_mask`

2. **post-#15375, pre-#15988**
   - per-token mask support present
   - `MiniMaxH3Model.forward` wrapper/carry structure present
   - native mask velocity multiplication absent
   - expected `compat_needed`

3. **native #15988**
   - both video and audio output multiplications detected
   - expected `native`

4. **only one multiplication detected**
   - expected `unknown`, not native

5. **source unreadable**
   - expected `unknown`

6. **foreign rewrite of `MiniMaxH3Model.forward`**
   - expected warning / unknown unless semantic detector can prove native behavior

The safety invariant is more important than convenience:

> Never return `compat_needed` when there is a credible possibility another implementation already multiplies velocity by the mask.

---

### 6.4 #15988 wrapper tests

Use tiny tensor outputs; no full H3 weights required.

#### No masks

```text
out == executor output exactly
```

#### Video mask only

```text
out[0] == raw_video_velocity * video_mask
out[1] == raw_audio_velocity
```

#### Audio mask only

```text
out[0] == raw_video_velocity
out[1] == raw_audio_velocity * audio_mask
```

#### Both masks

Both scale exactly once.

#### Idempotent install

Apply compatibility helper twice to the same logical model chain.

Assert only one wrapper exists under `_H3_MASK_VELOCITY_COMPAT_KEY` and output is multiplied once, not squared.

#### Native state

Capability state `native` -> no wrapper under MAINodes key.

#### Legacy state

Capability state `legacy_no_model_mask` -> no wrapper.

#### Unknown state

No wrapper; warning emitted.

---

### 6.5 Audio carry ordering parity test

This is mandatory because an apparently equivalent mask multiplication in the wrong place changes audio math.

Copy the **logic** of upstream #15988's small unit test, not necessarily its exact source text.

Set:

```text
video sigma shift = 12
 audio sigma shift = 3
 audio_scale != 1
 non-uniform audio mask
 deterministic raw audio velocity
```

Verify MAINodes wrapper plus current pre-#15988 `MiniMaxH3Model.forward` gives the same result as native #15988's formula:

```text
mask raw audio velocity first
THEN apply outer carried-variable conversion
```

Do not accept a test that only checks video.

---

### 6.6 Native upstream equivalence test - highest-value integration test

On the dev machine, prepare two Comfy installations/worktrees or otherwise test two code states:

```text
A. current Comfy master without #15988 + MAINodes compatibility wrapper
B. same Comfy base + upstream #15988 code-change commit, MAINodes wrapper disabled by native detection
```

Use the same tiny synthetic forward test and, if practical, the same small real H3 workflow.

Acceptance goal:

```text
A == B
```

For deterministic tensor-level paths, require exact or tight `torch.testing.assert_close` matching appropriate to the same operation order.

For a real generation, same seed/sampler/settings should be visually and numerically as close as the surrounding H3 execution permits.

This is the best proof that MAINodes has not invented a slightly different interpretation of #15988.

---

### 6.7 End-to-end MAINodes smoke tests

At minimum:

1. Stock H3, no mask, `H3StreamedBlocks` on.
2. `H3TemporalInsert` non-uniform 0/1 mask + `H3StreamedBlocks`.
3. Same temporal insert without `H3StreamedBlocks`, but through explicit H3 Core Compatibility node.
4. Per-frame/fractional mask if a small graph is available.
5. PDD model/LoRA + H3StreamedBlocks, verifying stock FinalLayer fallback.
6. Audio-lock workflow so audio mask/carry behavior is not broken.

Record:

- Comfy commit;
- MAINodes commit;
- mask velocity capability state;
- whether wrapper installed;
- whether FinalLayer streamed or fell back;
- shape/count of mod-row tensors;
- output hashes/metrics when meaningful.

---

## 7. Motion adapter: what #15988 can and cannot explain

Motion adapter:
https://huggingface.co/MATLOWAI/MiniMax-H3-Motion-Adapter

### Critical chronology

MAINodes source contains measurements dated **2026-08-15** for:

- True Clock seam flash/jitter;
- the T2a temporal-insert fidelity probe;
- non-uniform time-grid behavior.

Comfy PR #15375 merged **2026-08-18**.

#15988 only repairs behavior introduced by the model-side local mask-timestep path from #15375.

Therefore:

> #15988 cannot be the original cause of the motion/window pathology that motivated the adapter or the True Clock / temporal-coordinate research.

That chronology is a hard causal constraint.

### Adapter measurements point to a real model behavior

The model card reports a same-clip comparison for targeted fast-motion regeneration:

```text
no adapter:
  alternation = 0.370
  rate        = 1.416

adapter strength 0.75:
  alternation = 0.134
  rate        = 1.011
```

The qualitative failure without adapter is described as:

```text
advance -> snap -> advance -> snap
```

and rate 1.416 means the generated pass produced roughly 40% more motion than desired.

That is not the characteristic signature of #15988. #15988 is a conversion correction applied after the network's raw prediction, and #15981's most specific signature is a latent-cell-scale spatial grid under mask handling.

### Boundary pins versus adapter

The model card also reports:

```text
no boundary pins -> drift and splice jumps
add first/last boundary pins:
  jitter       0.103 -> 0.006
  entry jank   2.05  -> 1.58
  objects      109   -> 60

pins + adapter:
  alternation  0.129 -> 0.093
  objects      60    -> 54
```

Interpretation already supported by the experiment:

- boundary anchoring solves most of the splice/seam problem;
- the adapter then improves motion smoothness/behavior inside the constrained window.

Do not attribute all window flicker to one bug.

### Why binary TemporalInsert masks make the distinction even stronger

`H3TemporalInsert` uses:

```text
mask 0 for preserved/original token-times
mask 1 for inserted/generated token-times
```

#15988 multiplies output velocity by the mask.

For a fully generated inserted token (`mask=1`):

```text
corrected_velocity = 1 * velocity
```

There is no direct numerical change at that token from the #15988 multiplication itself.

For a fully frozen token (`mask=0`):

```text
corrected_velocity = 0 * velocity
```

The correction is large, but the sampler also preserves/blends that region.

Therefore if the primary `advance/snap` behavior is visibly inside the generated in-between token-times, #15988 is unlikely to be the direct mechanism the adapter learned to fix. Boundary state can still affect the trajectory indirectly, which is why a controlled A/B is needed, but do not discard the adapter based on theory alone.

---

## 8. Experiment matrix after compatibility fixes

Do this **after** unit/parity tests so we know the infrastructure is correct.

Use one of the exact held-out fast-motion clips/settings used for the adapter evaluation if available.

Keep constant:

- seed;
- source plate;
- hold map/window;
- sampler;
- total steps;
- inject schedule;
- resolution;
- boundary pins;
- adapter strength when enabled.

### Primary four-arm experiment

| Arm | #15988 semantics | Motion adapter | Why |
|---|---:|---:|---|
| A | broken/current pre-fix | off | contaminated historical-style baseline |
| B | MAINodes compat wrapper | off | corrected base H3 |
| C | native upstream #15988 commit | off | proves wrapper matches upstream |
| D | corrected | on | measures residual adapter benefit after mask math is correct |

Expected interpretation:

- B vs C should be effectively identical; otherwise the compatibility shim is wrong.
- A vs B measures how much current mask conversion contaminated the run.
- B vs D measures what the adapter still contributes after the core bug is removed.

### Killer control: eliminate model-side mixed-mask semantics

Create a path where the H3 network does not receive a nontrivial denoise mask at all, or use a workflow whose live generated region is not dependent on mixed local row timesteps.

Compare adapter off/on.

If `advance/snap` and over-motion remain without the adapter and improve with it, that directly demonstrates the adapter addresses a separate model/time-geometry behavior.

### Metrics to preserve

Use the same existing metrics where possible so historical numbers remain comparable:

- alternation;
- motion rate ratio;
- boundary jitter;
- entry/exit jank;
- invented-object count or current replacement metric;
- color/warmth penalty if still tracked;
- spatial FFT/grid metric from #15981 if easy to reproduce.

Do not replace playback review with scalar metrics. MAINodes' own tuning notes correctly warn that stills and one-number sharpness metrics can lie about temporal quality.

---

## 9. #15982 / True Clock / window-coordinate research track

This is worth pursuing, but keep it outside the correctness patch.

### Hypothesis

There may be a shared conceptual failure mode between:

- Comfy native context windows losing `window_start` (#15982), and
- MAINodes de-RoPE/True Clock/window experiments where local regenerated spans receive a temporal geometry different from the actual world-time placement.

The common question is:

> What temporal coordinate does H3 think each target token occupies, and does that coordinate match the token's intended global/world position?

### Why it matters

H3 builds explicit position IDs for the packed sequence. In #15982, the target-video cursor depends only on text length and reference spans, so every internally sliced context window gets the same starting target coordinate.

MAINodes already has machinery that intentionally changes temporal coordinates:

- True Clock;
- DyRoPE;
- temporal inserts;
- segment crop/splice;
- rolling windows;
- boundary pins/edge protection.

That makes MAINodes an unusually good testbed for a principled global-time/window-position solution.

### But do not assume identical mechanics

Comfy native context window:

```text
one sampling job
  -> framework slices latent into windows internally
  -> each model call should know its slice's global indices
```

MAINodes rolling/burst window can instead be:

```text
explicit local subclip job
  -> local conditioning and anchors
  -> independent sampling pass
  -> splice into world clip
```

A local subclip can legitimately use a local origin if all conditioning and recovery are defined in that coordinate system.

### Cheapest useful experiment

Instrument the H3 layout/position path for a MAINodes rolling-window workflow and log, for every generated window:

- world frame start/end;
- local frame start/end;
- target RoPE/video-grid start coordinate;
- reference/keyframe coordinates;
- True Clock spans;
- whether any Comfy context-window handler is active;
- first/last pinned anchor positions.

Then compare against a known `ContextWindowsManual` reproduction of #15982.

If MAINodes windows all report the same target coordinate despite different intended world placements **and** changing it removes periodic flicker without hurting local motion, then we have evidence to integrate a global offset. Until then, keep it research-only.

### Frequency-domain validation

#15982 predicts a very specific signature: periodic disturbance at the context-window period from window two onward.

If practical:

1. compute temporal difference energy per frame;
2. FFT/autocorrelate that scalar series;
3. test for power at the window stride/period;
4. compare before/after any window-position prototype.

This separates generic motion-adapter improvement from a framework-periodic seam bug.

---

## 10. Recommended commit sequence

Small commits make regressions attributable.

### Commit 1 - tests/fixtures for modern mod-row shapes

Add synthetic tests that currently fail on tensor `row` and pass on scalar row.

No production behavior change yet if practical.

### Commit 2 - per-token streaming support (#15375 / MAINodes #5)

Port:

- `_mod_row_range` equivalent;
- scale/shift range;
- gate range;
- streamed final-layer row slicing;
- exact A/V helpers;
- diagnostic segment-kind fix.

Run unit tests and one real `H3TemporalInsert` reproduction.

### Commit 3 - FinalLayer/PDD compatibility (#15908 / MAINodes #4)

- make captured values keyword-only after `*extra`;
- forward `*extra, **kwargs` to stock;
- detect PDD head bank;
- fall back to stock for PDD;
- add signature and PDD tests.

### Commit 4 - capability detection for mask velocity conversion

Extend `h3_capabilities.py` with `mask_velocity_conversion` semantic state and reporting.

No render behavior change yet if possible.

### Commit 5 - #15988 compatibility wrapper

- one shared helper;
- keyed/idempotent `DIFFUSION_MODEL` wrapper;
- auto install from H3StreamedBlocks when `compat_needed`;
- native/legacy/unknown are no-op as specified;
- audio ordering test;
- native upstream parity test.

### Commit 6 - explicit H3 Core Compatibility node and docs

MODEL -> MODEL node using the same helper.

Add workflow/documentation guidance for `H3TemporalInsert` users not using StreamedBlocks.

### Commit 7 - integration tests / example workflow update

Only after behavior is proven.

### Separate future commit/project - rebase `_trimmed_forward`

Do **not** sneak this into commits 1-7.

To re-enable trim-forward safely later, rebase the copied function against current Comfy and port all current behaviors, including at least:

- #15375 per-token video/audio mask row construction;
- current keyframe/reference layout semantics;
- #15908 PDD FinalLayer arguments;
- any changes after the old source hash;
- #15988 behavior if the copy ever encompasses the outer conversion boundary (verify architecture; do not assume).

Then add stock-vs-trimmed parity tests across masked/unmasked and PDD/non-PDD paths. Only then update `_STOCK_FORWARD_SHA`.

---

## 11. Stop conditions / things not to do

### DO NOT: merely refresh `_STOCK_FORWARD_SHA`

This would silently re-enable an old `_trimmed_forward` that lacks modern mask semantics.

### DO NOT: suppress all H3 model-side video masks as MAINodes' general answer

That is FaceRefine's current workaround for broken core. MAINodes has legitimate use for per-token local denoise state.

### DO NOT: apply the #15988 multiplication after audio carry conversion

Upstream's regression test specifically protects the opposite ordering.

### DO NOT: install the compatibility wrapper when native behavior is detected

Double scaling would produce `mask^2 * velocity` for fractional masks and be wrong.

### DO NOT: install automatically when `MiniMaxH3Model.forward` is rewritten by an unknown custom node

Warn and fail closed unless semantics can be proven.

### DO NOT: claim the motion adapter is obsolete because #15988 exists

Chronology disproves #15988 as the original cause.

### DO NOT: merge a #15982-style global window offset into the compatibility patch without a MAINodes-specific reproduction

Keep the research branch separate until evidence exists.

### DO NOT: optimize streamed PDD before restoring correctness

Stock fallback is acceptable. Silent wrong head selection is not.

---

## 12. Acceptance criteria for the coding task

The compatibility work is complete when all of the following are true:

- [ ] Current Comfy after #15375 can run non-uniform H3 masks through `H3StreamedBlocks` without shape mismatch.
- [ ] Scalar modulation-row path is unchanged/bit-identical in focused tests.
- [ ] Per-token chunked modulation matches an unchunked reference across awkward chunk boundaries.
- [ ] Current Comfy after #15908 no longer corrupts `_fl/_c/_e` positional captures.
- [ ] PDD multi-head FinalLayer uses stock fallback unless a tested streamed implementation exists.
- [ ] Running pre-#15988 core is detected as `compat_needed` only when the known core structure is recognized.
- [ ] MAINodes applies video/audio velocity mask scaling exactly once and at the same ordering point as upstream #15988.
- [ ] Native #15988 is detected and disables the MAINodes shim automatically.
- [ ] Pre-#15375 core does not receive an inappropriate velocity scaler.
- [ ] Foreign/unknown H3 forward rewrite causes warning/no-op rather than guessed patching.
- [ ] Repeated compatibility-node/StreamedBlocks application does not stack duplicate wrappers.
- [ ] Audio carry conversion has a dedicated parity test.
- [ ] MAINodes shim and native upstream #15988 agree in an explicit parity test.
- [ ] `H3TemporalInsert` works both with StreamedBlocks and with the explicit model compatibility path.
- [ ] `_STOCK_FORWARD_SHA` remains unchanged and trim-forward continues to fail safe until separately rebased.
- [ ] Capability report clearly says whether mask conversion is native, compat-shimmed/needed, legacy, or unknown.
- [ ] One same-seed real render validates no regression on an unmasked workflow.
- [ ] One real masked H3TemporalInsert render validates the corrected path.

Research follow-up is complete only when:

- [ ] motion adapter off/on is re-measured under corrected #15988 semantics;
- [ ] wrapper vs native #15988 are equivalent;
- [ ] #15982-like window-position behavior is instrumented separately rather than inferred from visual similarity.

---

## 13. Suggested coding-agent work log format

For every meaningful change, append a short record to the task notes or PR description:

```text
CHANGE:
WHY:
UPSTREAM CONTRACT / ISSUE:
TEST THAT WOULD FAIL BEFORE:
TEST RESULT AFTER:
REAL-WORKFLOW CHECK:
KNOWN LIMITATION:
```

For example:

```text
CHANGE: slice per-token mod-row selector to chunk intersection
WHY: #15375 row may be LongTensor for the whole segment
UPSTREAM CONTRACT: Comfy _mod_row(vec,row) supports scalar or tensor row
TEST THAT WOULD FAIL BEFORE: 300-token chunk crossing video-segment boundary
TEST RESULT AFTER: max_abs_diff 0 vs unchunked reference
REAL-WORKFLOW CHECK: H3TemporalInsert 0/1 temporal mask completes step 0+
KNOWN LIMITATION: trim_forward remains disabled by source hash
```

This keeps future maintenance from rediscovering why apparently strange compatibility code exists.

---

## 14. Useful source snippets / contracts to re-check at coding time

Because upstream can move after this packet was written, re-open these before finalizing the patch.

### Current H3 model
https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/minimax/model.py

Confirm:

- `MiniMaxH3Model.forward` still wraps `_forward` with `WrappersMP.DIFFUSION_MODEL`;
- outer audio carry conversion remains after wrapper execution;
- #15988 is still absent/present according to source;
- `mod_segments` tensor-row construction still follows the same structure;
- `FinalLayer.forward` current signature and PDD-bank semantics.

### ModelPatcher wrappers
https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_patcher.py

Confirm:

```python
add_wrapper_with_key
remove_wrappers_with_key
```

still exist and wrapper collections clone as expected.

### WrapperExecutor contract
https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/patcher_extension.py

Current contract says a wrapper receives `executor` and should call:

```python
executor(*args, **kwargs)
```

not `executor.execute(...)` from inside the wrapper.

### Upstream #15988 exact diff
https://github.com/Comfy-Org/ComfyUI/pull/15988/files

Re-check before coding in case the PR changes, gets merged, or receives review modifications.

### Carasibana MAINodes reference branches

Per-token rows:
https://github.com/Carasibana/ComfyUI-MAINodes/tree/fix/per-token-mod-rows-15375

FinalLayer:
https://github.com/Carasibana/ComfyUI-MAINodes/tree/fix/final-layer-signature-15908

### FaceRefine current implementation
https://github.com/Carasibana/ComfyUI-H3-FaceRefine

Relevant symbols in `nodes.py`:

```text
_renoised_inpaint
_mask_via_sampler_only
H3PerFrameDenoise
```

---

## 15. Causal map - keep this mental model while debugging

```text
Comfy #15375: per-token video/audio latent mask support
    |
    +--> H3 mod_segments row may become LongTensor
    |       |
    |       +--> MAINodes H3StreamedBlocks assumes scalar row
    |               -> MAINodes issue #5 / shape mismatch
    |
    +--> H3 evaluates masked rows at local sigma = mask * sigma
            |
            +--> outer x0 conversion still uses global sigma
                    -> Comfy #15981 / #15978 artifacts
                    -> pending Comfy #15988 velocity correction

Comfy #15908: PDD LoRA support
    |
    +--> FinalLayer.forward adds sigma/sample_sigmas/shifts
    |       -> MAINodes issue #4 positional-capture crash
    |
    +--> FinalLayer may contain multiple PDD output heads
            -> old MAINodes streamed final layer cannot silently handle this
            -> stock fallback is the immediate safe answer

Comfy context window system
    |
    +--> global window index not propagated to model (#15982)
            -> every H3 target window may think it starts at clip origin
            -> periodic flicker at window stride
            -> research lead for MAINodes temporal-coordinate/window work

MAINodes de-rope / temporal dilation
    |
    +--> true/nonuniform temporal geometry + held/inserted token-times
    |       -> model can over-advance / snap / spend extra capacity poorly
    |       -> motion adapter has measured residual benefit
    |
    +--> H3TemporalInsert emits non-uniform 0/1 noise_mask
            -> independently exercises #15375 tensor rows
            -> therefore MAINodes #5 is directly relevant
            -> later experiments after 2026-08-18 may also be contaminated by pre-#15988 conversion bug
```

---

## 16. Priority ranking if the agent has limited compute/time

### P0 - correctness

1. MAINodes #5 per-token row slicing.
2. MAINodes #4 FinalLayer signature and PDD fallback.
3. #15988 capability detection + semantic wrapper.
4. Keep trim-forward disabled.

### P1 - confidence

5. Tensor-level parity tests versus upstream #15988.
6. End-to-end H3TemporalInsert mask smoke render.
7. Audio carry test.
8. Capability/collision diagnostics.

### P2 - usability

9. Explicit H3 Core Compatibility MODEL node.
10. README/alpha docs explaining temporary compatibility behavior.

### P3 - research

11. Re-run motion adapter A/B after correction.
12. Instrument #15982-like global/local target coordinates in MAINodes windows.
13. Only if proven useful, design a proper global-window-position API/patch.

### Deferred optimization

14. Stream PDD final heads instead of stock fallback.
15. Rebase and re-enable `_trimmed_forward`.

---

## 17. What a good final PR/agent report should say

The final report should distinguish **fixed bugs** from **open research**.

Suggested shape:

```text
Implemented
- H3StreamedBlocks supports scalar and per-token mod-row selectors from Comfy #15375.
- FinalLayer wrapper accepts Comfy #15908 sampler-state arguments and falls back to stock for PDD head banks.
- MAINodes detects pending/native #15988 semantics and applies an idempotent DIFFUSION_MODEL compatibility wrapper only when needed.
- H3TemporalInsert has a supported model-compatibility path even without StreamedBlocks.
- trim_forward remains intentionally disabled against changed core until rebased.

Verified
- scalar streaming parity: ...
- tensor-row streaming parity: ...
- native #15988 vs MAINodes shim: ...
- audio carry ordering: ...
- masked H3TemporalInsert real workflow: ...
- unmasked regression workflow: ...

Not claimed / follow-up
- motion adapter remains a separate measured behavior; #15988 did not predate its motivating failure.
- #15982 global context-window position is a research lead, not part of this compatibility fix.
- streamed PDD head-bank optimization is deferred; correctness uses stock final layer.
- trim_forward rebase is deferred.
```

If a result differs from this packet because upstream changed after 2026-09-04, document the new upstream state and adapt to the **semantic contract**, not to these stale line numbers.

---

## 18. Source index

### MAINodes

- Main repo: https://github.com/matlowai/ComfyUI-MAINodes
- Issue #4: https://github.com/matlowai/ComfyUI-MAINodes/issues/4
- Issue #5: https://github.com/matlowai/ComfyUI-MAINodes/issues/5
- `vram_lab.py`: https://raw.githubusercontent.com/matlowai/ComfyUI-MAINodes/main/vram_lab.py
- `motion.py`: https://raw.githubusercontent.com/matlowai/ComfyUI-MAINodes/main/motion.py
- `h3_capabilities.py`: https://raw.githubusercontent.com/matlowai/ComfyUI-MAINodes/main/h3_capabilities.py
- Motion adapter: https://huggingface.co/MATLOWAI/MiniMax-H3-Motion-Adapter

### Carasibana / FaceRefine

- FaceRefine: https://github.com/Carasibana/ComfyUI-H3-FaceRefine
- FaceRefine `nodes.py`: https://raw.githubusercontent.com/Carasibana/ComfyUI-H3-FaceRefine/main/nodes.py
- MAINodes per-token branch: https://github.com/Carasibana/ComfyUI-MAINodes/tree/fix/per-token-mod-rows-15375
- MAINodes FinalLayer branch: https://github.com/Carasibana/ComfyUI-MAINodes/tree/fix/final-layer-signature-15908

### ComfyUI

- PR #15375 per-token H3 masks: https://github.com/Comfy-Org/ComfyUI/pull/15375
- PR #15908 PDD LoRA: https://github.com/Comfy-Org/ComfyUI/pull/15908
- Issue #15960 FinalLayer API break: https://github.com/Comfy-Org/ComfyUI/issues/15960
- Issue #15978 masking broken v0.34+: https://github.com/Comfy-Org/ComfyUI/issues/15978
- Issue #15981 H3 mask grid artifact: https://github.com/Comfy-Org/ComfyUI/issues/15981
- Issue #15982 context-window global position loss: https://github.com/Comfy-Org/ComfyUI/issues/15982
- PR #15988 denoise-mask velocity conversion: https://github.com/Comfy-Org/ComfyUI/pull/15988
- #15988 files changed: https://github.com/Comfy-Org/ComfyUI/pull/15988/files
- #15988 code commit at this snapshot: https://github.com/Comfy-Org/ComfyUI/commit/bdafd1921488c1cb73c1939bb9c51641ea3a270e
- H3 model source: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/minimax/model.py
- ModelPatcher source: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_patcher.py
- wrapper extension source: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/patcher_extension.py

---

## 19. Final operator intent

The desired outcome is not merely "make FaceRefine stop erroring." The goal is to make MAINodes a **well-behaved modern H3 model patcher** across a rapidly moving Comfy core:

- preserve exact old behavior when the upstream contract has not changed;
- understand new per-token mask semantics when it has;
- borrow the pending upstream mathematical fix without pinning users to a fork;
- automatically get out of the way when upstream catches up;
- never hide stale copied-core code behind an updated hash;
- keep diagnostics loud when multiple H3 packs have hands on the same model;
- preserve the separate research question of how H3 behaves when MAINodes deliberately changes temporal topology/coordinates.

The immediate fixes are unusually well-scoped and well-supported by external reports. Do those first. The interesting research begins only after the baseline H3 mask math is trustworthy again.
