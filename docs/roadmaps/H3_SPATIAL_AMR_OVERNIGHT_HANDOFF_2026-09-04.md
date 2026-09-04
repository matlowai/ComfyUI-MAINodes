# MiniMax H3 Spatial AMR / Fine-Detail Research
## Overnight coding-agent handoff — 2026-09-04

**Repository target:** `matlowai/ComfyUI-MAINodes`  
**Status:** experimental research branch only; do not change existing defaults  
**Primary objective:** determine whether H3's fixed 2x2 DiT patch stride is a material bottleneck for faces, hands, text, and other small high-value structures, and whether we can locally increase spatial token density without changing the H3 VAE or the sampler's dense latent state.

---

# 0. Executive directive: build this first

Do **not** start by training a new VAE, adding a random 24->5376 projection, or implementing a general quadtree.

The highest-probability first experiment is:

> **Keep H3's exact trained 2x2 / 96-value visual patch representation, but inside a selected ROI slide that same patch at stride 1 latent cell instead of stride 2.**

H3's video VAE produces 24-channel latents at 16x spatial compression. The stock DiT then patchifies those latents with `(1,2,2)`, so one transformer row covers a 2x2 block of VAE cells: effectively about 32x32 source pixels per visual transformer token. The proposed experiment leaves the VAE latent tensor unchanged and changes only **how densely the DiT samples that tensor**:

```text
stock H3 target-token lattice                  refined ROI
(stride 2 VAE cells)                           (stride 1 VAE cell)

X . X . X .                                    X X X X X .
. . . . . .                                    X X X X X .
X . X . X .             ->                     X X X X X .
. . . . . .                                    X X X X X .
X . X . X .                                    X X X X X .
```

Crucially, each refined token is still a **real 2x2 H3 patch with the exact 96-value layout on which `video_patch_proj` was trained**. The patch support stays 2x2; only the patch **stride / token lattice spacing** changes.

This is more likely to work zero-shot than splitting a 96-value token into four partial 24-value embeddings because it keeps the input distribution much closer to stock H3.

### Core defaults for the first useful run

- Dense VAE/scheduler state remains `[1,24,T,H,W]` throughout.
- Coarse area: stock 2x2 patch, stride 2.
- Refined area: stock 2x2 patch, stride 1.
- Refine a **small face ROI** first, not the whole frame.
- Quantize the ROI to whole stock parent cells and add a 1-parent-cell halo.
- Activate refinement **late in denoising**, initially around `sigma_v <= 0.85`, and sweep it.
- Use the model's existing positional-coordinate formula at patch stride 1 for refined anchors.
- For the first scatter implementation, each fine token is responsible for the latent cell at its own patch anchor; use the output head's `(dy=0, dx=0)` slot for that cell.
- No new learned weights.
- No automatic indecision-driven mask until the manual/face-mask intervention is shown to work.
- No attention-area correction until the basic mixed-lattice forward produces coherent images; then test it as a separate ablation.

If this works even modestly, it gives us a clean path to a real adaptive spatiotemporal allocator. If it fails, the failure will still tell us whether to pursue learned mixed-resolution adaptation, a true 1x1 token adapter, or a higher-resolution VAE residual.

---

# 1. Why this is a valid H3 seam

## 1.1 Current ComfyUI H3 facts to verify again locally before editing

Current upstream MiniMax H3 support in ComfyUI uses:

- video latent channels: `24`
- DiT patch size: `(1,2,2)`
- visual patch row width: `24 * 1 * 2 * 2 = 96`
- hidden size: `5376`
- visual input projection: `Linear(96, 5376)`
- visual output head: `Linear(5376, 96)`
- packed sequence order: `[text | conditions/references | audio | video]`
- target video is the final packed segment
- target video position IDs are generated from a spatial 2x2-patch grid plus H3's physical temporal grid

Upstream source:

- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/minimax/model.py

The H3 VAE implementation reports 24 latent channels and spatial downsampling product 16:

- https://github.com/xiaolibai-sys/ComfyUI-MiniMaxH3/blob/main/models/vae.py

**Before coding:** inspect the exact `comfy/ldm/minimax/model.py` installed beside this MAINodes checkout and record:

```bash
git -C /path/to/ComfyUI rev-parse HEAD
python - <<'PY'
import inspect
from comfy.ldm.minimax import model
print(inspect.getsourcefile(model.MiniMaxH3Model))
print(model.MiniMaxH3Model)
PY
```

Do not assume the web snapshot and the local Comfy checkout are identical.

## 1.2 Why switching token density per denoise step is unusually clean here

The sampler state does **not** have to change shape.

Stock and adaptive forward passes both consume the same dense H3 video latent:

```text
[1, 24, T, H, W]
```

and both return a dense velocity/noise prediction with that same shape.

So a denoise run can do:

```text
high sigma: dense latent -> stock stride-2 packing -> H3 -> dense velocity
low  sigma: dense latent -> mixed stride-2/stride-1 packing -> H3 -> dense velocity
```

There is no spatial equivalent of `H3MidInsert`'s state-size transition. We do **not** resize the scheduler state, interpolate noisy cells, or top up variance. Tokenization can be chosen independently on every model call.

That is one of the strongest reasons to try late spatial refinement before changing the VAE.

---

# 2. Connection to existing MAINodes work

Read these before editing:

- `motion.py`
  - `H3IndecisionOracle`
  - `H3TemporalInsert`
  - `H3MidInsert`
  - `H3LatentUpscale`
  - `H3DyRoPE` / true-clock work if present on the local branch
  - current cost model (`COST_EXP`)
- `RESEARCH_NOTES_ATOS.md`
- `ROADMAP.md`
- `TESTING_ALPHA.md`
- relevant Concept Lab notes under `concept_lab/`

Current repo sources:

- https://github.com/matlowai/ComfyUI-MAINodes
- https://github.com/matlowai/ComfyUI-MAINodes/blob/main/RESEARCH_NOTES_ATOS.md
- https://github.com/matlowai/ComfyUI-MAINodes/blob/main/ROADMAP.md
- https://github.com/matlowai/ComfyUI-MAINodes/blob/main/motion.py

## 2.1 The unifying view

MAINodes already performs adaptive allocation in **time**:

```text
model/latent signal
      -> detect overloaded temporal spans
      -> spend more latent/world samples there
      -> regenerate
      -> map back to the original clock
```

This experiment asks whether we can perform the corresponding operation in **space**:

```text
ROI / error signal
      -> detect spatially under-resolved cells
      -> spend more DiT tokens there
      -> denoise on a denser spatial lattice
      -> scatter back to the same dense /16 latent state
```

Longer term, the allocator is not “face refinement.” It is an error-driven field:

```text
D(x, y, t, sigma)
```

with independent actions such as:

- temporal subdivision / de-rope
- spatial token densification
- extra denoise effort / regional sampling
- eventually richer latent coefficients or a sparse /8 residual

## 2.2 Indecision is promising but not yet the router

The existing `H3IndecisionOracle` measures model x0 movement between denoise steps. The current code notes that, after controlling for pixel motion, its signal still correlated with static detail energy, including a stronger relationship in quiet regions.

That makes it a plausible **model-native under-resolution/error signal**, but this has **not** established that high indecision predicts benefit from spatial refinement.

Do not wire it into automatic refinement first.

Instead, once a manually selected ROI produces a real improvement, test the causal relationship:

```text
indecision J(x,y,t)
        vs.
actual quality gain from applying spatial refinement there
```

That experiment is described later in this handoff.

---

# 3. FaceRefine is a baseline and a source of engineering priors

Repository:

- https://github.com/Carasibana/ComfyUI-H3-FaceRefine
- MIT licensed as of 2026-09-04.

Do not make MAINodes depend on it for the first implementation. Use it as a comparison baseline and optionally consume ordinary masks/boxes produced elsewhere.

## 3.1 What FaceRefine demonstrates

FaceRefine:

1. detects/tracks the face per frame,
2. smooths the trajectory,
3. uses a crop whose physical size changes so the face occupies a roughly fixed fraction of a constant H3 canvas,
4. refines that enlarged crop through H3,
5. warps/stitches it back.

Its default `crop_factor=2.5` puts the face at about 40% of the generated crop. Its README notes 768 as the strongest face-quality canvas at substantially greater cost than 512.

That means it is effectively giving a small face many more H3 spatial tokens.

Example intuition:

```text
source face 64 px high
stock H3 DiT lattice: about 64/32 = 2 tokens across

FaceRefine 768 canvas, crop_factor 2.5
face occupies roughly 768/2.5 = 307 px
about 307/32 = 9.6 H3 tokens across
```

This is not proof that patch stride is the only bottleneck because cropping also changes semantic scale and context. It is, however, a very useful intervention baseline.

## 3.2 Temporal-stability lesson to steal

FaceRefine's code explicitly moved from integer crop slicing to sub-pixel `affine_grid/grid_sample` because integer coordinate rounding was a major residual source of frame-to-frame jitter after trajectory smoothing. Its comments record a measured trajectory-jerk example dropping from about `0.58` to `0.06` when the float trajectory was preserved.

For spatial AMR this means:

- do not let the refine mask chatter frame to frame,
- quantize refinement only after a smooth physical trajectory exists,
- add temporal hysteresis / dilation around activation changes,
- use a halo around the refined region,
- judge in playback, not stills.

## 3.3 FaceRefine also already allocates denoise effort by face size

Current documented defaults include:

- small face threshold: 30 source pixels
- large face threshold: 120 source pixels
- small-face denoise multiplier: 1.0
- large-face denoise multiplier: 0.35
- temporal smoothing: 9 frames

This is a useful second baseline: some failures may be solved by **more/less denoise effort**, not more spatial addressability. Keep these axes separate in experiments.

---

# 4. The primary implementation: mixed patch stride, unchanged patch semantics

Call the internal prototype something unambiguous such as:

```text
H3 Spatial AMR (alpha)
```

Suggested source file:

```text
h3_spatial_amr.py
```

unless the local repo has a clearer experimental-module convention. Keep it out of the already-large `motion.py` unless project conventions strongly favor that file.

## 4.1 Stock patch layout: a critical indexing warning

H3's stock patchify code is equivalent to:

```python
x = latent.reshape(B, C, t, pt, h, ph, w, pw)
x = torch.einsum("nctrhpwq->nthwcrpq", x)
rows = x.reshape(B * t * h * w, C * pt * ph * pw)
```

For `C=24`, `pt=1`, `ph=pw=2`, the 96 values are flattened as:

```text
[channel, dy, dx]
```

not:

```text
[child, channel]
```

Therefore a spatial child-slot index is **strided every four values**:

```python
slot_index(k) = torch.arange(24) * 4 + k
k = dy * 2 + dx
```

Do **not** treat the 96 vector as four contiguous 24-value chunks.

This must have a unit test.

## 4.2 Use `unfold` to produce exact H3 patch rows at different strides

A clean helper is:

```python
import torch
import torch.nn.functional as F


def patchify_video_stride(latent: torch.Tensor, stride: int) -> torch.Tensor:
    """[B,24,T,H,W] -> [B*T*Nh*Nw,96], exact H3 channel/kernel order."""
    b, c, t, h, w = latent.shape
    assert c == 24
    xt = latent.permute(0, 2, 1, 3, 4).reshape(b * t, c, h, w)
    cols = F.unfold(
        xt,
        kernel_size=(2, 2),
        stride=(stride, stride),
    )  # [B*T, 96, Nh*Nw], order C,kh,kw
    return cols.transpose(1, 2).reshape(-1, 96).contiguous()
```

Required gate:

```python
z = torch.randn(1, 24, 3, 8, 10)
a = upstream_patchify_video(z, (1,2,2))
b = patchify_video_stride(z, 2)
assert torch.equal(a, b)  # or maxabs == 0
```

If this is not exact, stop and fix ordering before touching the model.

## 4.3 Fine rows are real overlapping 2x2 patches

For stride 1:

```python
fine_rows = patchify_video_stride(video_x, 1)
```

For each latent time, the row grid has shape:

```text
(H - 1) x (W - 1)
```

with an anchor at every valid top-left 2x2 latent-cell location.

Each fine row is therefore a completely ordinary 96-value H3 visual patch. It differs from training primarily in **where patches are sampled**, not in what a patch contains.

This is the principal reason this path is preferred over a 24-value child projection for the first zero-shot test.

## 4.4 Mixed packing rule

Define a boolean `refine_parent[t, py, px]` over the stock coarse token grid:

```text
[T, H/2, W/2]
```

Iterate stock parent tokens in stock order `(t, py, px)`.

If a parent is coarse:

```text
emit 1 stock stride-2 row
```

If a parent is refined:

```text
replace that parent with 4 stride-1 rows anchored at:

(2*py + 0, 2*px + 0)
(2*py + 0, 2*px + 1)
(2*py + 1, 2*px + 0)
(2*py + 1, 2*px + 1)
```

For v0, **do not refine a parent if any requested fine anchor would lie outside the valid stride-1 patch-anchor grid**. Fall back to its coarse token. This means edge parents remain coarse. Solve border padding later only if needed.

Store compact row metadata:

```python
@dataclass
class SpatialRowMeta:
    kind: int       # 0 coarse, 1 fine
    t: int
    py: int         # coarse parent index if kind=0; owning parent if fine
    px: int
    anchor_y: int   # fine only
    anchor_x: int   # fine only
```

Do not use one Python dataclass per token in the optimized path; this is explanatory. In code, use tensors/arrays for row type and coordinates. Python loops are acceptable for a 5-frame proof but should not become the final hot path.

## 4.5 Position IDs: use H3's own coordinate formula

Do not invent pixel-coordinate embeddings.

Stock H3 uses:

```python
_axis_from_sqrt_area(dim, patch, sqrt_area)
```

For coarse rows, preserve stock patch=2 coordinates exactly.

For fine anchors, generate the corresponding patch=1 coordinate arrays:

```python
area = math.sqrt(lat_h * lat_w)
h_fine = _axis_from_sqrt_area(lat_h, 1, area)
w_fine = _axis_from_sqrt_area(lat_w, 1, area)
```

A fine row at latent anchor `(ay, ax)` receives:

```text
(t_position, h_fine[ay], w_fine[ax])
```

Use the same `_video_t_grid()` value as the stock row for that latent time token.

Important useful property to unit-test:

```text
coarse position (py,px)
should coincide with the patch=1 position at (2*py,2*px)
under the current H3 coordinate formula.
```

Do not shift fine rows to an imagined patch center unless an explicit ablation later proves that better.

## 4.6 Embedding: use the stock projection unchanged

The refined rows are still width 96:

```python
video_embed = self.video_patch_proj(mixed_video_rows).to(dtype)
```

No new projection layer.
No random weights.
No low-rank adapter for the first experiment.

## 4.7 Output scatter: stock coarse path + fine anchor prediction

The final H3 video head still emits 96 values per mixed video row.

For a coarse row:

```text
interpret all 96 outputs exactly like stock H3 and scatter its 2x2 block.
```

For a fine row anchored at `(ay,ax)`:

```text
use only the output corresponding to local patch offset (dy=0, dx=0)
and write those 24 channels to dense latent cell (ay,ax).
```

The 24 slot-0 indices are:

```python
idx00 = torch.arange(24, device=v.device) * 4
cell_pred = v_fine[:, idx00]
```

Why slot 0? The stock token position is the spatial coordinate of its patch anchor. Once a fine token is positioned at a new anchor, output slot `(0,0)` is the geometrically aligned prediction for that anchor cell.

Do **not** initially use the fine token's old parity slot (`dy,dx`) just because the cell came from that parity inside its original coarse parent. That would shift the output role relative to the new token position.

### Required ablations after the first coherent result

1. `anchor00` — default described above.
2. `overlap_average` — use all valid 2x2 predictions from overlapping fine tokens and average them for refined cells.
3. `overlap_weighted` — later, center/coverage-weighted overlap-add if averaging helps.

Do not implement all three before proving the main path runs.

---

# 5. Patch the correct ComfyUI seam

A normal `set_model_patch_replace()` block hook happens **after** H3 has already built the packed sequence. It is too late to change token count.

For the prototype, patch the diffusion model's `_forward` itself.

Current Comfy `ModelPatcher` supports object patching, and other current H3 community extensions patch `diffusion_model._forward` with `add_object_patch`.

Suggested pattern:

```python
import types

patched = model.clone()
base_model = patched.model
# exact nesting must be verified in this checkout
# get_model_object("diffusion_model._forward") is preferable when available
orig = patched.get_model_object("diffusion_model._forward")
dm = patched.get_model_object("diffusion_model")


def _patched_forward(self, *args, **kwargs):
    if not spatial_amr_should_run(...):
        return orig(*args, **kwargs)
    return adaptive_h3_forward(self, orig, *args, **kwargs)

_patched_forward._mainodes_spatial_amr_version = 1
patched.add_object_patch(
    "diffusion_model._forward",
    types.MethodType(_patched_forward, dm),
)
```

This is pseudocode: inspect the exact object hierarchy before using it.

Community precedent for full H3 `_forward` patching:

- https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/main/multikeyframe_advanced.py

## 5.1 Make the stock path truly stock

This is non-negotiable.

If refinement is disabled because:

- node mode is off,
- mask is empty,
- current sigma is earlier than the activation threshold,
- or no valid parent survives edge/budget checks,

then call the **original `_forward` object directly**.

Do not run the custom packer with an all-coarse mask and merely assume it is equivalent.

This gives us a bit-exact stock path and limits risk to the model calls where refinement is actually active.

## 5.2 Copy as little upstream forward logic as possible

The active adaptive call will need much of H3's `_forward`, because layout, embeddings, RoPE, transformer blocks, and final unpack are intertwined.

For the prototype:

1. copy the exact local upstream `_forward` into a helper,
2. preserve all current hooks and options,
3. change only:
   - target-video row packing,
   - target-video position IDs / packed-layout length,
   - target-video embedding placement,
   - final target-video scatter.

Add a comment containing the local Comfy commit hash from which the function was copied.

Do not silently fork the entire H3 implementation into MAINodes.

## 5.3 V0 compatibility restrictions are acceptable

For the first proof, explicitly reject unsupported combinations instead of silently doing the wrong thing.

Reasonable v0 restrictions:

- batch size 1 only (already H3's assumption)
- no visual keyframe/reference blocks while adaptive mode is active
- no per-token denoise mask while adaptive mode is active
- target audio remains stock
- text remains stock
- no unknown competing `_forward` patch

This makes the first implementation much smaller because the packed sequence can be treated as:

```text
[text | audio | mixed target video]
```

After the signal is established, generalize the layout while preserving references/conditions. The target video is already the final segment in current upstream H3, which makes this extension much less painful.

Do **not** claim general compatibility until same-seed tests prove it.

---

# 6. Proposed Comfy node API

Prototype node name:

```text
H3 Spatial AMR (alpha)
```

Suggested inputs:

```text
model                 MODEL
mask                  MASK
mode                   off | late | always
sigma_start            FLOAT default 0.85
halo_parents           INT default 1
mask_threshold         FLOAT default 0.20
max_refine_fraction    FLOAT default 0.15
scatter_mode           anchor00  (only expose others after implemented)
debug                   BOOLEAN default true
```

Outputs:

```text
model                  MODEL
report                 STRING
```

The node should clone and patch the model; existing H3 nodes remain unchanged.

## 6.1 Standard `MASK`, no FaceRefine-specific dependency

Accept a normal Comfy `MASK` so the experiment can be driven by:

- a hand-painted region,
- YOLO/SAM/face masks,
- a tracked box converted to a mask,
- later the MAINodes indecision heatmap.

Do not make the node accept `H3FACEXFORM` in v0.

## 6.2 Convert the user mask to H3 latent time correctly

Spatially, normalized resampling is enough:

```text
MASK -> [latent_h, latent_w] -> 2x2 parent pooling
```

Temporally, H3's VAE token clock is nonuniform in pixel-frame support. MAINodes already contains `_token_frame_spans()` / equivalent logic for the `1,4,4,4,4` pattern.

For a moving per-pixel-frame mask:

1. map each latent time token to its pixel-frame span,
2. aggregate source masks over that span (`max` for “refine if any covered”; optionally mean score),
3. resize to latent H/W,
4. max-pool each 2x2 latent parent into a coarse refine score,
5. threshold,
6. dilate by `halo_parents`.

For the first static/manual ROI, simply repeating the spatial mask over latent time is allowed and should be the quickest path.

## 6.3 Budget guard

A user mask can accidentally cover the whole frame and turn a cheap test into a huge attention run.

For a refined parent fraction `f`, replacing one coarse row with four fine rows gives approximately:

```text
video target rows ~= N * (1 + 3f)
```

Log the **actual packed sequence lengths**, not only this approximation, because text/audio/reference rows do not scale.

Default `max_refine_fraction=0.15` for normal ROI mode. If the mask exceeds it:

- rank parent cells by mask coverage score,
- keep the highest scores up to budget,
- report the clamp loudly.

Provide an explicit `always/all-fine diagnostic` mode that bypasses the cap so a researcher can intentionally run the expensive causal test.

---

# 7. Late-only activation: the default hypothesis

Recent diffusion work independently supports coarse-early / fine-late computation, and MAINodes' own RoPE experiments are a warning that global off-distribution geometry changes can create visible instability.

Use the current H3 video sigma seen by `_forward`:

```python
sigma_v = float((timestep.flatten()[0] / 1000.0).item())
active = sigma_v <= sigma_start
```

Verify the exact local convention first.

Because H3's video sigma shift is large, `sigma_start` does not correspond linearly to “percentage of nominal steps.” Log the sigma on every activation for the first run.

Initial sweep:

```text
0.70   very late / conservative
0.85   preferred first useful setting
1.00   effectively active across almost the full schedule; diagnostic
```

Also include an explicit `always` mode rather than relying on numeric edge cases.

Research precedent:

- DDiT: https://arxiv.org/abs/2602.16968
- Jenga: https://arxiv.org/abs/2505.16864

Do not cite these as proof H3 will accept stride-1 patches. They motivate the schedule, not the model-specific compatibility claim.

---

# 8. Test gates before any expensive render

Create focused tests, ideally under the repo's existing test convention.

## Gate A — patch layout equivalence

For random dense H3 latents:

```text
stock patchify == unfold stride 2
```

Require exact equality or zero max-abs difference.

## Gate B — slot indexing

For a deterministic tensor where every `(channel,y,x)` is unique, prove that:

```python
row.reshape(24, 2, 2)[:, dy, dx]
```

matches:

```python
row[:, torch.arange(24) * 4 + (dy*2+dx)]
```

for all four slots.

## Gate C — spatial-coordinate nesting

For representative H/W:

```text
coarse_grid[py,px] == fine_grid[2*py,2*px]
```

under the current upstream `_axis_from_sqrt_area()` formula.

If not, inspect upstream before changing the hypothesis.

## Gate D — mixed row count / coverage

For a synthetic parent mask:

```text
mixed_count = coarse_count + 3 * refined_parent_count
```

when no edge parent is rejected.

Prove every dense latent cell is assigned exactly once by the output scatter:

- every unrefined parent: all four cells from its coarse row
- every refined parent: four cells from four fine anchors

No holes; no duplicate writes in `anchor00` mode.

## Gate E — model wrapper stock bypass

With `mode=off` and with an empty mask, confirm the original `_forward` is called directly.

## Gate F — same-seed real-model identity

Run a tiny H3 sample with the patch node installed but inactive.

Require:

- output latent maxabs == stock, ideally bit-identical
- same decoded video
- same audio
- same model options / extension hooks

If this fails, **stop**. Do not interpret any adaptive render.

---

# 9. The first GPU experiments, in order

Do not burn the night on a giant matrix before the forward is known-good.

## E0 — VAE bottleneck assay, in parallel with coding

Goal: learn whether the `/16` VAE has enough information at the object sizes we want to rescue.

Take real, sharp clips/images with faces and hands at approximate source sizes:

```text
24, 32, 48, 64, 96, 128, 192 px
```

For each:

```text
source -> H3 VAE encode -> H3 VAE decode
```

Save ROI crops and metrics.

At minimum record:

- LPIPS/DISTS if already available
- SSIM/PSNR as reconstruction sanity, not perceptual truth
- edge/high-frequency retention as a secondary diagnostic
- face identity cosine if InsightFace is already available and appropriate
- landmark/keypoint stability across frames if available

The important result is the **breakpoint by object size**, not one aggregate score.

Interpretation:

```text
if VAE roundtrip is already destroyed at the target size:
    stride-refining the DiT cannot recreate source information reliably;
    move that size regime toward a /8 residual-VAE branch later.

if VAE roundtrip is decent but normal H3 V2V/generation is bad:
    transformer patching/addressability becomes a strong suspect.
```

For the first AMR generation test, prefer a face around **64-96 px** high. That is small enough to be poorly represented by the stock /32 DiT lattice but large enough that the /16 VAE has a reasonable chance of carrying useful structure.

## E1 — tiny uniform stride-1 diagnostic

Purpose: does H3 remain coherent when the target video lattice is densified at all?

Use a deliberately tiny workload, for example:

- 5 legal H3 frames if the local workflow supports it
- 256-384 square or similarly small legal dimensions
- no refs/keyframes
- no denoise mask
- stock prompt/seed paired A/B

Compare:

1. stock
2. uniform stride-1 active only late
3. uniform stride-1 always

This is **not** a quality benchmark. It is an architectural smoke test.

Expected result if the hypothesis is viable:

- late stride-1 remains semantically coherent,
- always-on may be worse because it is further off distribution.

If both are catastrophic, inspect position IDs, row ordering, output scatter, and timestep/modulation segments before assuming the idea is dead.

## E2 — the real first test: one tracked face ROI, late only

Use a 22- or 39-frame V2V clip with:

- face approximately 64-96 px high for at least part of the shot
- modest motion first; do not combine with the hardest de-rope failure yet
- same source, prompt, seed, schedule, and V2V strength

Conditions:

A. stock H3 V2V  
B. spatial AMR, face mask + 1-parent halo, `sigma_start=0.85`  
C. FaceRefine baseline on the same source  

Record:

- source face px per frame
- coarse parent fraction refined
- stock target-video rows
- adaptive target-video rows
- total packed sequence rows
- seconds/step
- peak VRAM if available
- activation sigmas

Playback is the primary quality judgement.

## E3 — activation sweep

Only if E2 is coherent.

Same clip/seed:

```text
stock
sigma_start 0.70
sigma_start 0.85
always
```

Question:

> Is the quality gain specifically a late-detail effect, or does H3 need the denser lattice through more of the denoise trajectory?

## E4 — ROI-size / halo sweep

Same clip/seed:

```text
halo = 0, 1, 2 stock parents
```

Watch specifically for:

- boundary shimmer
- duplicate/shifted features
- local scale mismatch
- skin/texture discontinuity
- motion discontinuity as the mask moves

Use `halo=1` as the prior, not zero.

## E5 — scatter ablation if needed

If the ROI is coherent but noisy/unstable:

```text
anchor00
vs
fine overlap-average
```

Do not do this before E2.

---

# 10. Baselines that make the result interpretable

A pretty AMR render alone proves almost nothing.

For the same scene/seed where possible compare:

1. stock H3
2. stock H3 with stronger/later denoise only
3. FaceRefine crop/zoom H3
4. spatial AMR
5. uniform stride-1 tiny diagnostic, where affordable

Why baseline 2 matters:

If “more denoise” fixes the face just as well, the failure was not necessarily spatial addressability.

Why FaceRefine matters:

It is an empirical upper-ish baseline for what H3 can do when the face is presented at a much larger spatial scale.

Why uniform stride-1 matters:

It separates “the mixed-resolution boundary is bad” from “H3 cannot use a stride-1 lattice at all.”

---

# 11. What counts as a win

The first overnight pass does not need a publication-quality benchmark.

A useful **GO** result is:

- inactive wrapper is bit-exact to stock,
- late stride-1 is coherent,
- on at least 2 of 3 same-seed clips the selected ROI has visibly better structural detail than stock in playback,
- improvement is not merely global sharpening/noise,
- the rest of the frame remains substantially unchanged,
- boundary shimmer is not worse than the local detail gain,
- added compute scales with refined area rather than full-frame 4x tokenization.

A very strong result would additionally show that the gain appears for a non-face structure such as hands, text, jewelry, a weapon, or small mechanical detail.

A useful **NO-GO / branch** result is equally valuable:

### Case A — VAE roundtrip already bad

Prioritize a sparse /8 detail residual or nested VAE experiment. Do not blame the DiT for information the VAE did not preserve.

### Case B — VAE good, stride-1 coherent, but no detail improvement

The model may have learned 2x2 patch semantics too strongly for denser sampling alone. Next try the true fine-cell adapter/decomposition experiment described in section 15.

### Case C — detail improves but mixed boundary duplicates/warps

This is very close to the failure mode reported by Foveated Diffusion's naive mixed-resolution video baseline. Proceed to:

1. late-only schedule tuning,
2. cell-measure attention ablation,
3. small mixed-resolution LoRA / positional adaptation.

### Case D — ROI steals composition / model overfocuses on it

This is a prime symptom of the **token multiplicity / attention-mass problem**. Test area-weighted attention before abandoning spatial AMR.

---

# 12. Attention mass: the second experiment, not the first blocker

Replacing one coarse token by four fine tokens changes softmax multiplicity.

If four fine tokens had identical K/V to their parent, ordinary attention would approximately quadruple the region's aggregate opportunity to receive attention.

A discretization-aware correction is:

```text
logit_ij = q_i k_j / sqrt(d) + log(w_j)
```

where `w_j` is the cell measure represented by key token `j`.

For this lattice:

```text
coarse visual token: w = 1
fine visual token:   w = 1/4
text/audio tokens:   w = 1 (unchanged reference convention)
```

so fine visual keys receive:

```text
-log(4)
```

relative to coarse visual keys.

In the duplicate-token limit, the four fine children then carry the same combined softmax mass as one coarse parent.

This is the spatial version of the cell-measure/quadrature idea already under investigation elsewhere in this research program.

## 12.1 Do not materialize a giant NxN mask casually

Current Comfy attention functions accept additive masks, but an explicit `[N,N]` matrix can erase the memory win.

The desired bias is key-only, i.e. conceptually shape:

```text
[1, 1, 1, Nkeys]
```

broadcast over queries and heads.

Prototype this only after the unweighted mixed lattice runs. Options:

1. use an `optimized_attention_override` with PyTorch SDPA and a broadcast key-bias tensor for a small test,
2. patch H3 Attention narrowly to add the key bias without materializing N^2,
3. accept slower attention for the scientific A/B before optimizing Sage/Flash support.

Current Comfy attention source:

- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/modules/attention.py

Note that some fast attention backends fall back when a mask is present. Treat quality causality and production speed as separate questions.

## 12.2 Required area-weighting A/B

If basic AMR is coherent, compare on the exact same seed:

```text
mixed stride AMR, no area correction
mixed stride AMR, log-area key correction
```

Measure:

- ROI detail
- outside-ROI drift from stock
- prompt/global-composition drift
- temporal stability

The hypothesis is that area weighting should reduce **unintended semantic over-weighting caused only by token subdivision** without deleting the local-resolution benefit.

Do not claim novelty without a dedicated prior-art search around measure-weighted/nonuniform-token attention.

---

# 13. The high-value oracle experiment: does indecision predict refinement benefit?

Only run this after a hand-selected ROI has demonstrated that spatial AMR can help.

Define a local intervention gain map. For a source-conditioned V2V experiment, one workable form is:

```text
G(x,y,t) = quality_error_stock - quality_error_refined
```

or, if a reliable source metric is unavailable, use the change toward the FaceRefine/high-density teacher in the ROI.

Then compare candidate predictors:

- face/hand detector mask
- object pixel size
- simple high-frequency/detail energy
- optical flow / motion magnitude
- VAE reconstruction residual
- current MAINodes jerk signal
- **H3 x0 indecision map**

The key question is not whether indecision correlates with texture.

It is:

> **Does high indecision predict where spending additional spatial token density produces measurable quality gain?**

That is a causal allocation question and would connect the existing de-rope oracle research to spatial AMR.

Suggested first analysis:

1. create 20-50 small ROI candidates over several clips,
2. apply the same fixed refinement budget to each candidate separately,
3. measure local gain,
4. rank candidates by each oracle,
5. report Spearman rank correlation and top-k precision for “refinement was worth it.”

If indecision wins, then build an automatic `H3 Spatial Refinement Oracle` later.

Do not reuse the old automatic spatial **compositing** result as evidence either way. MAINodes' roadmap correctly notes that automatic oracle-driven blend masks degraded some playback cases. Changing where the DiT spends tokens is a different intervention from masking which decoded pixels get pasted.

---

# 14. Research papers/repositories to read while the code runs

These are not a paper dump; each has a specific role.

## Foveated Diffusion — closest spatial precedent

**Foveated Diffusion: Efficient Spatially Adaptive Image and Video Generation**  
arXiv: https://arxiv.org/abs/2603.23491  
Code: https://github.com/bchao1/foveated_diffusion

Why it matters:

- mixed-resolution token sequences for image and video DiTs,
- explicit high-density vs low-density spatial token regions,
- video implementation on Wan,
- the repo exposes a **naive mixed-resolution** video condition that exhibits scale mismatch / duplicate structures at HR/LR boundaries,
- their successful method uses mixed-resolution post-training/LoRA and cross-resolution positional attention (CRPA).

Interpretation for H3:

- zero-shot mixed stride may work enough to validate the bottleneck,
- but boundary artifacts should not surprise us,
- a small mixed-resolution adaptation is a very plausible second step if the zero-shot signal is positive.

## DDiT — denoise-step-dependent patch density

**DDiT: Dynamic Patch Scheduling for Efficient Diffusion Transformers**  
https://arxiv.org/abs/2602.16968

Relevant idea:

- early timesteps can use coarser patches,
- later iterations benefit from finer patches,
- demonstrated on image and video generation.

Use it to motivate late-only activation, not as proof of H3 compatibility.

## RAS — region-specific computation without retraining

**Region-Adaptive Sampling for Diffusion Transformers**  
https://arxiv.org/abs/2502.10389  
https://github.com/microsoft/RAS

Relevant idea:

- different regions can receive different sampling/update budgets,
- a model-derived focus/error signal can route computation,
- training-free spatial allocation is useful even without changing tokenizer resolution.

This is a baseline/adjacent branch: perhaps some H3 small-detail failures need extra solver effort rather than more tokens.

## CAT — only pursue hard if the VAE is the wall

**CAT: Content-Adaptive Image Tokenization**  
https://arxiv.org/abs/2501.03120

Relevant idea:

- variable representation capacity / nested VAE,
- complex images including faces and text benefit from lower compression,
- supports the broader premise that fixed VAE compression is wasteful for perceptually important detail.

If E0 shows H3's `/16` VAE is the dominant small-detail failure, CAT becomes a direct design reference for a future nested/sparse higher-resolution VAE branch.

## VGDFR — temporal sibling to ATOS/de-rope

**VGDFR: Diffusion-based Video Generation with Dynamic Latent Frame Rate**  
https://arxiv.org/abs/2504.12259

Relevant idea:

- time is not uniformly information-dense,
- dynamically varying latent temporal density can save/allocate capacity.

This is conceptually adjacent to de-rope; useful for the eventual unified spacetime allocator.

## Jenga — progressive-resolution inference

**Training-Free Efficient Video Generation via Dynamic Token Carving**  
https://arxiv.org/abs/2505.16864

Relevant idea:

- progressive resolution during inference,
- coarse early / higher resolution later,
- training-free video inference adaptation.

Again: supports the schedule, not H3's exact mixed-lattice representation.

## KATok — extremely recent adaptive-video-tokenizer warning

**Keep-or-Drop? Adaptive Tokenizer for Compact Video Representation**  
https://arxiv.org/abs/2608.24293

Why it is worth reading now:

- explicitly attacks fixed spatiotemporal compression in video VAEs/tokenizers,
- learns to keep content-rich tokens and drop low-value ones,
- calls out spatial misalignment as a problem when adaptive token selection changes the original spatiotemporal structure,
- proposes position-prediction strategies to restore consistency.

This arrived in August 2026 and is directly relevant to what could go wrong when we alter H3's token lattice.

---

# 15. Backup experiment: true 1x1 fine-cell tokens using existing weights

Do **not** start here. Implement only if overlapping stride-1 patches are coherent but clearly fail to expose enough local degrees of freedom.

There is a zero-new-weights way to construct a more literal child split from H3's existing 96->5376 projection.

Let the stock 96-vector be `p`, arranged by `[channel,dy,dx]`, and let `p_k` contain only one spatial offset `k` with all other entries zero.

For the stock linear projection:

```text
e_parent = W p + b
         = sum_k W p_k + b
```

A decomposition-preserving child embedding is:

```text
e_k = W p_k + b/4
```

so:

```text
sum_k e_k = e_parent
```

However, `e_k` is substantially farther from the training distribution because 3/4 of the patch inputs are absent. This is why it is a backup rather than the default.

A potentially more in-distribution alternative is a **parent-plus-local residual**:

```text
a_k = W p_k
A   = sum_k a_k = W p

e_k = e_parent + lambda * (4*a_k - A)
```

The mean of the four child embeddings is exactly `e_parent` for any `lambda`, while the residual differentiates children.

Suggested `lambda` sweep if this branch is reached:

```text
0.0, 0.25, 0.5, 1.0
```

A third fallback is to repeat one child latent into all four virtual 2x2 slots and use the stock projection. That preserves realistic per-channel magnitudes but changes the virtual local context.

All of these should be considered **ablations / bridge designs**, not assumed-correct semantics.

If a learned adapter becomes necessary, a 24->hidden and hidden->24 pair is small relative to H3 itself, and can be post-trained while keeping the base model frozen. But do not spend the overnight run training it before the zero-weight interventions are measured.

---

# 16. If zero-shot is promising but boundaries are bad: next training step

Foveated Diffusion strongly suggests that mixed-resolution behavior may need post-training even when the representation is principled.

If the zero-shot H3 AMR result is:

```text
+ noticeably better face/hand detail
+ generally coherent
- local scale mismatch / duplicate structures / boundary shimmer
```

then the next branch should be a **small mixed-lattice LoRA**, not a new full model.

Initial training concept:

- base H3 frozen,
- LoRA rank 8-32 on attention Q/K/V/O and possibly MLP, mirroring foveated-video precedents,
- randomly moving/smoothed spatial refinement masks,
- a mix of coarse-only and mixed-lattice batches so stock behavior is retained,
- masks include boxes, saliency/detail maps, and trajectories with hysteresis,
- supervise normal H3 flow-matching objective on real training clips if the H3 training stack is available,
- explicitly include transition/boundary regions in the loss accounting.

Do not begin by training only on faces. Faces are the first evaluation target, not the desired ontology of the allocator.

A later distillation idea is to use crop/zoom H3 or FaceRefine as a **high-spatial-density teacher** for the local ROI while the student runs the full frame with mixed tokens. That is more complicated and should wait until basic mixed-lattice SFT is understood.

---

# 17. If the VAE is the bottleneck: sparse /8 residual, not wholesale replacement

If E0 shows that `/16` VAE reconstruction itself destroys the structures we care about, the next architecture should still avoid throwing away H3's pretrained latent space.

Preferred long-term shape:

```text
global base field:
    H3 /16 x 24 latent, unchanged

selected high-error cells:
    + sparse /8 detail residual or auxiliary coefficients
```

Think of this as hp-adaptive refinement:

- `h` refinement: smaller spatial support (/16 -> /8 locally)
- `p` refinement: more coefficients/channels in important cells

The base H3 latent remains the global low-order field. The residual only carries detail that the base field cannot represent.

Possible router signals:

- VAE reconstruction residual
- x0 indecision
- face/hand/text detector for controlled experiments
- high-frequency energy
- learned benefit predictor trained from intervention data

Do not design this until the VAE-size sweep tells us which object-size regime actually needs it.

---

# 18. Measurement protocol

## 18.1 Never judge this from stills alone

MAINodes' existing research discipline is correct: playback is primary for video artifacts.

For every useful experiment save:

```text
source.mp4
stock.mp4
amr.mp4
facerefine.mp4            # when applicable
mask_overlay.mp4
metadata.json
```

Metadata should contain at least:

```json
{
  "mainodes_commit": "...",
  "comfy_commit": "...",
  "seed": 0,
  "prompt": "...",
  "steps": 0,
  "sampler": "...",
  "sigma_start": 0.85,
  "refine_fraction": 0.0,
  "coarse_video_rows": 0,
  "adaptive_video_rows": 0,
  "stock_total_rows": 0,
  "adaptive_total_rows": 0,
  "seconds_per_step": [],
  "peak_vram_mb": null,
  "scatter_mode": "anchor00",
  "attention_measure": false
}
```

## 18.2 Automated metrics are supporting evidence

For real V2V source clips, useful supporting metrics include:

- ROI LPIPS / DISTS to source
- full-frame LPIPS outside ROI to detect collateral drift
- ArcFace/InsightFace identity cosine where domain-appropriate
- face landmark temporal jitter
- hand-keypoint confidence/stability if a reliable detector is available
- OCR accuracy for text experiments
- boundary-ring temporal difference / flicker

Do not optimize directly for raw high-frequency energy or Laplacian variance; noise can game them.

## 18.3 Blind playback sheet

For each important A/B:

- randomize labels,
- view full-speed loop first,
- then slow inspection,
- score:
  - face/hand structure
  - identity stability
  - texture/detail
  - temporal coherence
  - boundary visibility
  - outside-ROI drift

A tiny structured human evaluation is more useful here than ten synthetic scalar metrics.

---

# 19. Cost accounting

MAINodes currently uses a measured superlinear token-cost exponent around:

```text
COST_EXP ~= 1.7
```

for its relevant H3 workloads. Treat this only as a planning estimate.

If fraction `f` of stock target-video parents are refined:

```text
N_video_adaptive / N_video_stock ~= 1 + 3f
```

For `f=0.10`:

```text
1.30x target-video rows
```

A rough per-step target-video-only estimate using exponent 1.7 is:

```text
1.30^1.7 ~= 1.56x
```

But H3's actual packed sequence also includes text/audio/conditions, so log and use:

```text
actual_total_sequence_ratio = adaptive_seq_len / stock_seq_len
```

If refinement is active only during a fraction `r` of denoise calls, an intentionally crude total-time estimate is:

```text
(1-r) + r * ratio^1.7
```

Do not publish this as measured performance. Record wall time.

---

# 20. Failure signatures and what to do next

## Whole image changes composition when ROI is refined

Likely causes:

- extra ROI tokens changed attention mass,
- refinement activated too early,
- position semantics are off.

Next:

1. activate later,
2. test log-area key correction,
3. check position-grid nesting unit test.

## ROI develops duplicates / inconsistent scale at the edge

This is a known class of naive mixed-resolution failure.

Next:

1. increase halo,
2. smooth/hysteresis mask over time,
3. compare uniform stride-1 tiny run,
4. if uniform is good but mixed is bad, prioritize mixed-resolution LoRA / CRPA-like adaptation.

## ROI is sharper but identity drifts

Likely too much generative rewrite, not necessarily wrong tokenization.

Next:

- refine later,
- reduce V2V denoise,
- compare FaceRefine's size-conditioned denoise baseline.

## ROI is coherent but visually unchanged

Possible explanations:

- stock H3 already has enough transformer addressability at this size,
- extra tokens are too correlated to create new local modes,
- VAE is the real wall,
- output scatter is discarding useful overlapping predictions.

Next:

1. check VAE assay,
2. try overlap-average scatter,
3. try true child/decomposition token branch,
4. only then consider learned adapter.

## Temporal shimmer follows the moving refine boundary

Next:

- temporal smoothing/hysteresis of parent activation,
- 1-2 parent halo,
- keep mask based on source/track, never generated output,
- borrow FaceRefine's sub-pixel tracking discipline before quantization.

## OOM / absurd runtime

Do not optimize kernels first.

- reduce refine fraction,
- shorten clip,
- use 5/22-frame architectural probe,
- activate later,
- log actual sequence lengths.

The first job is causality, not throughput.

---

# 21. Overnight execution order

A coding agent should work through these in order and leave artifacts after every gate.

## Phase 1 — source-of-truth audit

- record MAINodes HEAD and dirty status
- record ComfyUI HEAD
- inspect local H3 `model.py`
- inspect local H3 VAE
- inspect MAINodes ATOS/indecision/mid-insert/latent-upscale code
- inspect FaceRefine README and crop/denoise implementation
- create `research_notes` or experiment log with exact source hashes

**Deliverable:** `SOURCE_AUDIT.md`

## Phase 2 — pure tensor prototype, no H3 weights

Implement/test:

- stride-2 unfold == stock patchify
- stride-1 patch generation
- stock/fine spatial position grids
- mixed-row metadata
- mixed row count
- anchor00 scatter coverage
- mask parent quantization + halo

**Deliverable:** tests passing on CPU/GPU without loading H3.

## Phase 3 — model wrapper with stock bypass

Implement experimental model patch.

Requirements:

- original forward retained
- inactive path calls original directly
- unknown incompatible forward patch is detected/refused
- v0 unsupported payload modes fail loudly
- debug report shows current sigma and row counts

**Deliverable:** inactive same-seed H3 run is bit-exact.

## Phase 4 — tiny uniform-stride diagnostic

Run the smallest useful real H3 sample.

**Deliverable:** stock / late-stride1 / always-stride1 outputs + metadata.

If catastrophic, debug before proceeding.

## Phase 5 — face ROI A/B

Run stock vs AMR vs FaceRefine on one 64-96 px face clip.

**Deliverable:** videos, mask overlay, row/runtime log, short verdict.

## Phase 6 — two more content types / seeds

At least:

- another face/identity case
- a hand/text/prop fine-detail case
- one negative control where the subject is already large

**Deliverable:** small comparison table and playback notes.

## Phase 7 — only if positive: area-weighted attention probe

Implement the cheapest scientifically clean A/B, even if it temporarily forces PyTorch attention.

**Deliverable:** no-area vs log-area same-seed pair and outside-ROI drift measurement.

## Phase 8 — only if still positive: indecision-benefit pilot

Use existing x0 tap/indecision machinery to rank several candidate ROIs and compare against actual intervention gain.

**Deliverable:** scatter plot / CSV with predictor vs gain.

---

# 22. Commit / hygiene rules

This is research code touching upstream-sensitive model internals.

- Do not modify existing MAINodes defaults.
- Put every user-visible node behind `alpha` / experimental labeling consistent with the repo.
- Keep the original H3 model forward reachable.
- Add a version marker to the patched method.
- Refuse unknown competing `_forward` patches rather than stacking blindly.
- Record the Comfy commit used to copy any internal forward logic.
- Do not vendor FaceRefine code unless there is a concrete reason; it is MIT, but loose coupling is better.
- Keep benchmarks/results outside normal import paths.
- Never make a quality claim without the matched seed/config in metadata.
- Preserve current model hooks (`patches_replace`, streamed blocks, quantization/offload behavior) when copying `_forward`; if compatibility has not been tested, explicitly mark it unsupported.

Suggested commit boundaries:

```text
1. tests: exact H3 stride repacking / coordinate invariants
2. feat(alpha): mixed stride target-video pack/scatter
3. feat(alpha): H3 Spatial AMR model patch node
4. bench: spatial AMR matched-seed experiment harness
5. research: first results and go/no-go notes
```

---

# 23. Minimal result table to leave for the next agent

At the end of the overnight run, fill something like:

| Test | Stock | AMR | FaceRefine | Verdict |
|---|---:|---:|---:|---|
| inactive wrapper maxabs | 0 | — | — | must pass |
| 5f tiny coherent? | yes/no | yes/no | — | |
| 64-96px face detail | baseline | +/- | +/- | |
| identity stability | | | | |
| temporal shimmer | | | | |
| outside-ROI drift | | | | |
| total sequence ratio | 1.00 | | — | |
| sec/step ratio | 1.00 | | | |
| peak VRAM | | | | |

And answer these five questions explicitly:

1. **Does H3 tolerate stride-1 sampling of its existing 2x2 visual patch late in denoising?**
2. **Does local densification improve a face/hand/detail case where the VAE roundtrip still preserves useful information?**
3. **Is the gain local, or does token multiplicity perturb the whole generation?**
4. **Are mixed-resolution boundaries the dominant failure once the interior improves?**
5. **Which branch should be next: attention measure, mixed-resolution LoRA, true 1x1 adapter, or /8 VAE residual?**

---

# 24. What success would mean scientifically

The strongest outcome is not “faces look nicer.”

The stronger claim to investigate is:

> A pretrained video diffusion transformer with a fixed latent representation can benefit from **adaptive local sampling of its token lattice**, allocating more spatial degrees of freedom only where its current discretization is insufficient, while keeping the global solver state unchanged.

MAINodes would then have two complementary adaptive-resolution mechanisms:

```text
time:
    de-rope / ATOS -> spend more samples where temporal dynamics overload the model

space:
    Spatial AMR -> spend more tokens where fine structure overloads the model
```

If x0 indecision predicts where either intervention pays off, that becomes even more interesting:

```text
model prediction instability
      -> estimate local representational error
      -> choose the cheapest refinement action
         (time, space, or solver effort)
```

That is the direction worth protecting. Faces are simply the first target where the fixed-resolution failure is obvious enough to measure.

---

# 25. Final priority stack

If the overnight agent has to choose where to spend the next hour, use this ordering:

```text
P0  exact pack/position/scatter tests
P0  stock-bypass bit-exact test
P0  stride-1-overlap late-only model forward
P0  one 64-96px face matched-seed A/B

P1  VAE object-size reconstruction sweep
P1  FaceRefine baseline
P1  halo / sigma-start sweep
P1  runtime + packed-row logging

P2  overlap-average scatter
P2  log-area attention correction
P2  second content class (hands/text/props)
P2  indecision-vs-refinement-benefit pilot

P3  true 1x1 child/decomposition adapter
P3  mixed-resolution LoRA
P3  sparse /8 VAE residual
```

**Do not skip the P0 causal gates to start a P3 training moonshot.**

The most likely “it just works enough to learn something tonight” pattern is:

```text
stock /16 VAE state
+ stock trained 2x2 patch semantics
+ stride-1 overlapping patches only inside a small ROI
+ native H3 continuous spatial RoPE coordinates
+ late denoise activation
+ stock coarse path everywhere else
+ exact scatter back to the unchanged dense latent
```

That is the experiment to earn or kill first.
