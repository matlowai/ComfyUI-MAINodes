# A0 source audit, 2026-09-04

Node A0 of `docs/roadmaps/H3_CORE_COMPAT_TO_SPATIAL_AMR_DAG_2026-09-04.md`.
Every row below was produced by running the command or reading the file named in it,
on this box, in the night-watch worktree `/mnt/work/ai/lab/night-0904/E1`
(branch `night-0904-E1`, a worktree of `ComfyUI-MAINodes`). Nothing is quoted from
the handoffs without re-derivation.

Python used for every live check:
`/mnt/work/ai/venvs/comfyui-cu132/bin/python` with `sys.path.insert(0, "/mnt/work/ai/apps/ComfyUI")`.

## 1. Repository state

| What | Command | Value |
|---|---|---|
| ComfyUI HEAD | `git -C /mnt/work/ai/apps/ComfyUI rev-parse HEAD` | `7d2640b3c74cd8f2d36d8339d4691070d4a863f3` |
| ComfyUI branch | `git -C /mnt/work/ai/apps/ComfyUI rev-parse --abbrev-ref HEAD` | `h3-fc-vsa-0829` |
| ComfyUI dirty | `git -C ... status --porcelain` | dirty, but only ` D` deletions of stock placeholder/model-dir files (`input/example.png`, `models/**/put_*_here`, `models/configs/*.yaml`). No modified source file. |
| MAINodes HEAD (live tree `/mnt/work/ai/apps/ComfyUI/custom_nodes/ComfyUI-MAINodes`) | `rev-parse HEAD` | `46fe7d212a500604284804f71b16bd5738c47f80` |
| MAINodes branch (live tree) | `rev-parse --abbrev-ref HEAD` | `mask-conversion-0903` |
| MAINodes dirty (live tree) | `status --porcelain` | one untracked file: `docs/roadmaps/MAINodes_H3_mask_streaming_core_compat_handoff_2026-09-04.md` |
| MAINodes ahead of origin/main | `rev-list --count origin/main..mask-conversion-0903` | **14** commits (DAG s.0 says 10; stale) |
| Branch pushed | `rev-parse origin/mask-conversion-0903` | `46fe7d2...`, identical to local HEAD, so it is pushed and up to date |
| This worktree | `git -C /mnt/work/ai/lab/night-0904/E1 rev-parse HEAD` / `status --porcelain` | `46fe7d21...`, clean at audit start |

## 2. Upstream PR #15988

```
$ gh pr view 15988 -R Comfy-Org/ComfyUI --json state,headRefOid,mergedAt,title,updatedAt
{"headRefOid":"238ad33515df04a7834f7aab22aaf5f645cbe0c8","mergedAt":null,"state":"OPEN",
 "title":"Fix MiniMax H3 denoise mask velocity conversion","updatedAt":"2026-09-04T01:18:24Z"}
```

Still OPEN, not merged, head `238ad33515df04a7834f7aab22aaf5f645cbe0c8`. The compat
handoff's `bdafd192...` is stale, as the DAG already says. Detect by semantics, not hash.

## 3. `FinalLayer.forward`

`comfy/ldm/minimax/model.py:311` (line number from
`inspect.getsourcelines(FinalLayer.forward)[1]` = 311):

```python
def forward(self, x, t_emb, video_seg, audio_seg, sigma, sample_sigmas, shifts):
```

`inspect.signature` in the venv: `(self, x, t_emb, video_seg, audio_seg, sigma, sample_sigmas, shifts)`.
Seven user arguments, i.e. the post-#15908 form. PDD head-bank branch is at
`model.py:320-334` (`n = self.video_out.weight.shape[0] // self.video_out.out_features`,
`n == 1` -> direct projection, else `_pdd_head` with dt-weighted interval blending).

Issue #4 is live in this tree: `vram_lab.py:1576` is still the four-positional form

```python
def _fl_forward(x, t_emb, video_seg, audio_seg, _fl=fl, _c=int(final_layer_chunk), _e=_exact):
```

installed via `m.add_object_patch("diffusion_model.final_layer.forward", _fl_forward)`
at `vram_lab.py:1581`, so core's `sigma`/`sample_sigmas`/`shifts` bind onto `_fl`/`_c`/`_e`.

## 4. `MiniMaxH3Model.forward` order

`comfy/ldm/minimax/model.py:559-583`. Order, verified by reading:

1. `559` signature: `forward(self, x, timestep, context, transformer_options={}, minimax_payload=None, denoise_mask=None, audio_denoise_mask=None, **kwargs)`
2. `562-570` audio carry is UNDONE first: `carry = (sigma_a / sigma_v)`, `x = [x[0], audio_src * carry]` when `audio_scale != 1`.
3. `572-577` `comfy.patcher_extension.WrapperExecutor.new_class_executor(self._forward, self, get_all_wrappers(WrappersMP.DIFFUSION_MODEL, transformer_options)).execute(x, timestep, context, transformer_options, minimax_payload=..., denoise_mask=..., audio_denoise_mask=..., **kwargs)`
4. `579-582` outer audio carry conversion, AFTER the wrapper:
   ```python
   out[1] = ((1.0 - scale) * (audio_src * carry)
             + (1.0 + (scale - 1.0) * sigma_a).to(out[1].dtype) * out[1])
   ```
5. `583` `return out`

So the structural anchors the compat handoff s.2 requires for `compat_needed` all hold:
`WrapperExecutor` around `_forward`, audio carry after it, class owned by comfy core
(`h3_capabilities.block_patch_report()["class_rewrites"]` empty, s.8 below).

## 5. The two #15988 lines: ABSENT

```
$ grep -n "out\[0\] \* denoise_mask\|out\[1\] \* audio_denoise_mask\|\* denoise_mask\|\* audio_denoise_mask" \
    /mnt/work/ai/apps/ComfyUI/comfy/ldm/minimax/model.py
(no output, exit 1)
```

And from the venv, on `inspect.getsource(MiniMaxH3Model.forward)`:

```
forward has WrapperExecutor: True
forward has out[0]*denoise_mask: False
forward has out[1]*audio_denoise_mask: False
```

Confirms DAG s.0: #15988 is ABSENT in this core. Masked rows are evaluated at
`m * sigma` (`model.py:619-641`) with no compensating velocity scale.

## 6. `mod_segments` row construction, scalar vs LongTensor

`comfy/ldm/minimax/model.py:657-673`, with the helper at `649-654`:

```python
649  def rows_to_mod_index(rows_t, tag):
650      # per-row timestep values -> per-row mod-row indices into the t_emb table
651      levels = rows_t.unique()
652      base = torch.tensor([t_row[v] * 3 + tag for v in levels.tolist()],
653                          dtype=torch.long, device=rows_t.device)
654      return base[torch.searchsorted(levels, rows_t)]
...
657  mod_segments = []
658  for a, b, kind in layout.segments:
659      row_base = t_row[seg_t[kind]] * 3
660      if kind == "text" and text_tags is not None:
666          mod_segments.append((a + run_start, a + i, row_base + int(tags[run_start])))   # SCALAR (python int)
668      elif kind == "video" and video_rows_t is not None:
669          mod_segments.append((a, b, rows_to_mod_index(video_rows_t, seg_tag[kind])))    # LongTensor, one per token
670      elif kind == "audio" and audio_rows_t is not None:
671          mod_segments.append((a, b, rows_to_mod_index(audio_rows_t, seg_tag[kind])))    # LongTensor, one per token
672      else:
673          mod_segments.append((a, b, row_base + seg_tag[kind]))                          # SCALAR (python int)
```

`video_rows_t` / `audio_rows_t` are set only when the per-row timesteps are NOT all
equal (`model.py:629-632` and `638-641`: `if rows_t.unique().numel() == 1` collapses to
a scalar segment timestep instead). So a uniform fractional mask still yields scalar
rows; only a non-uniform mask produces the LongTensor form. The tensor is whole-segment
length (`video_rows_t` comes from `mask_row_values` over all `latent_t * lat_h/2 * lat_w/2`
rows), which is exactly the MAINodes #5 shape mismatch: `vram_lab.py:176-190`
(`_mod_scale_shift_range`, `_mod_gate_range`) index `scale[row]` / `gate[row]` with the
whole-segment tensor while writing into a chunk-sized slice. Both helpers are still
scalar-row in this tree; issue #5 is live here.

Consumer side, `_mod_row` is used by `FinalLayer.forward` (`model.py:318`) and the DiT
block path (`model.py:291-296`), both of which take `(start, stop, row)` triples.

## 7. `MiniMaxH3.scale_latent_inpaint` in `comfy/model_base.py`

PRESENT, `comfy/model_base.py:2248-2272`, on class `MiniMaxH3` (`model_base.py:2136`).
Signature `scale_latent_inpaint(self, sigma, noise, latent_image, x=None, denoise_mask=None, **kwargs)`.
What it does, read line by line:

- `2250-2252` if `self.latent_shapes` is missing or has < 2 entries, delegate to `BaseModel`.
- `2253-2256` unpack the packed latent into `[video, audio]`; **inject the preserved video
  at the cond timestep**: `aug = VISUAL_COND_TIMESTEP` (0.999),
  `cleans[0] = aug * cleans[0] + (1.0 - aug) * noises[0]`. This is the "hold anchor is
  native since #15375" claim in DAG s.0, confirmed.
- `2257-2265` audio rescale: undo the sampler's `(sigma_v / sigma_a)` carry and the
  `audio_scale`, `factor = (sigma_v / sigma_a) / scale`, so the model sees clean audio.
- `2266-2272` repack; if `x` and `denoise_mask` are given, blend the sampler's current `x`
  back in proportionally to how much the token-grid (amax-pooled) mask exceeds the
  per-pixel mask:
  ```python
  token_grid_mask = utils.pack_latents(self._token_grid_masks(denoise_mask, shapes))[0]
  x_blend_weight = (token_grid_mask - denoise_mask) / (1.0 - denoise_mask).clamp(min=1e-6)
  x_blend_weight = torch.where(denoise_mask < 1.0, x_blend_weight.clamp(0.0, 1.0), torch.zeros_like(x_blend_weight))
  return injected + x_blend_weight.to(injected.dtype) * (x - injected)
  ```
  i.e. where amax-pooling made a row "more live" than its pixels, the injection is
  weakened toward the live latent rather than pinned clean.

Called from `comfy/samplers.py:639` inside `CFGGuider`'s masked path
(`x = x * denoise_mask + ...scale_latent_inpaint(...) * (1 - denoise_mask)`), and the
output blend at `samplers.py:641-642` (`out = out * denoise_mask + self.latent_image * latent_mask`).

Companions used by A8: `_pool_masks_to_token_grid` (`model_base.py:2215-2228`),
`_token_grid_masks` (`2230-2232`, `ceil(mask * 256) / 256`), `_denoise_mask_values`
(`2234-2243`), `_denoise_mask_conds` (`2245-2246`), and the extra_conds hook at
`2201-2203`.

## 8. `_forward` source hash vs `_STOCK_FORWARD_SHA`

```
live sha256(inspect.getsource(MiniMaxH3Model._forward))[:16] = 4819d1fe818d1c37
_STOCK_FORWARD_SHA in vram_lab.py:851                        = f40e52b23fb2f9c7
```

They differ, so `H3StreamedBlocks` takes the `else` branch at `vram_lab.py:1588-1589` and
logs `trim_forward skipped`. trim_forward fails safe on this core, as intended. Note the
compat handoff's reported observed hash `06f09532bec4aed6` is a THIRD value: it was taken
on a different core than ours. Do not treat any of these as a version identity.
Do not refresh the constant (DAG s.4).

## 9. `h3_capabilities.block_patch_report()`

Run in the venv with `custom_nodes/ComfyUI-MAINodes` on `sys.path`, importing only
`comfy.ldm.minimax.model` and `h3_capabilities` (no ComfyUI node loading, no model):

```
block_patch_report = {
 "double_block_owners": {},
 "object_patches": {},
 "transformer_options": {},
 "class_rewrites": {},
 "loaded_h3_packs": []
}
```

Read honestly: with `model=None` the function can only report import-time class rewrites
and packs already in `sys.modules` (`h3_capabilities.py:150-200`). In a bare process no
pack is imported, so `loaded_h3_packs` empty means "nothing was loaded here", NOT "no pack
patches H3". `class_rewrites` empty is a real result: at import of core alone,
`MiniMaxH3Model.forward/_forward`, `DiTBlock.forward`, `Attention.forward` and
`FinalLayer.forward` all still resolve to `comfy core`.

Static survey of the installed tree for the same question (grep over
`/mnt/work/ai/apps/ComfyUI/custom_nodes/**/*.py`), which is what the report would find in
a live server once those packs load:

| Site | Kind | Note |
|---|---|---|
| `ComfyUI-MAINodes/vram_lab.py:1581` | object patch `diffusion_model.final_layer.forward` | ours, issue #4 lives here |
| `ComfyUI-MAINodes/vram_lab.py:1586` | object patch `diffusion_model._forward` | ours, gated on the sha in s.8, currently skipped |
| `ComfyUI-MAINodes/vram_lab.py:751` | class rewrite `MiniMaxH3Model._forward = _sol_capture_forward` | ours, sol-attn capture path |
| `ComfyUI-sol-attn/minimax.py:523` | object patch `diffusion_model._forward` | foreign |
| `ComfyUI-MiniMaxH3-PDD-Mamad8/nodes.py:733` | object patch `diffusion_model.final_layer.forward` | foreign |
| `ComfyUI-MiniMaxH3-Contex-Loop/h3_mask_compat.py:255,465,466` | **class rewrites** `FinalLayer.forward`, `MiniMaxH3Model.forward`, `MiniMaxH3Model._forward` | foreign, process-wide |

The Contex-Loop rewrite is the one that matters for A3/A5: it replaces core's `forward`
and `_forward` with its own #15375 back-compat implementations. It is gated
(`h3_mask_compat.py:640-668`: it installs only `if not before["mask_engine_complete"]`,
and RAISES on a partially-updated core) and it is invoked lazily from
`masking_support.require_h3_mask_support()` at node execution, not at import. On this
post-#15375 core it should therefore stay dormant. I did NOT execute
`ensure_h3_mask_compat()` to prove that (it would rewrite core classes in the process);
A3's detector must handle the case where it did fire, and that is exactly the `unknown`
state, because after that rewrite `MiniMaxH3Model.forward` is no longer core-owned.

## 10. Corrections to DAG s.0

1. **MAINodes branch is 14 commits ahead of `origin/main`, not 10** (`rev-list --count`
   above). Still pushed, still not merged. Cosmetic, but s.0 is meant to be re-derivable.
2. **The live `_forward` source hash is `4819d1fe818d1c37`.** s.0 records only the stale
   constant `f40e52b23fb2f9c7` and the handoff records a third observed value
   `06f09532bec4aed6`. Neither equals ours. The behaviour (`trim_forward` skipped, fails
   safe) is as s.0 states.
3. **The ComfyUI checkout is dirty**, though only with deletions of stock placeholder
   files and `models/configs/*.yaml`. s.0 says "checkout `7d2640b3` on branch
   `h3-fc-vsa-0829`" without a cleanliness claim; recording it here so a later worktree
   comparison is not surprised.
4. **`block_patch_report()` in a bare process is nearly empty by construction.** s.0/A0
   asks "which packs patch `_forward`/`final_layer`" and the runtime report cannot answer
   that without a loaded server and a ModelPatcher. The answer above is a static survey
   plus the empty runtime report, and the new fact is that
   `ComfyUI-MiniMaxH3-Contex-Loop` performs process-wide **class rewrites** of
   `MiniMaxH3Model.forward`/`_forward`/`FinalLayer.forward` behind a capability gate. s.0
   does not mention this pack at all; A3 and A5 must treat it as the principal source of
   the `unknown` state on a live 8188/8189.
5. Also confirmed unchanged, no correction needed: #15988 head `238ad33` and OPEN;
   `FinalLayer.forward` seven-arg signature; `_fl_forward` still four-positional at
   `vram_lab.py:1576` exactly; `_mod_scale_shift_range`/`_mod_gate_range` still scalar-row;
   `_STOCK_FORWARD_SHA` stale on purpose; the two `out[i] * mask` lines absent;
   `scale_latent_inpaint` native hold-anchor at 0.999.

Everything else in DAG s.0 that this node was asked to check is re-confirmed as written.
