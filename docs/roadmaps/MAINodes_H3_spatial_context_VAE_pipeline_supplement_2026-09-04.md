# Supplemental coding-agent handoff #2: H3 spatial context anchoring, USDU tiling, VAE boundaries, global coordinates, and the time-first/space-second pipeline

**Status snapshot:** 2026-09-04 (America/New_York)

**Companion handoff that MUST be read first:**
`MAINodes_H3_mask_streaming_core_compat_handoff_2026-09-04.md`

**Primary repo:** https://github.com/matlowai/ComfyUI-MAINodes

**H3 USDU fork examined:** https://github.com/lisitskyaa/ComfyUI_UltimateSDUpscaleGuider_H3

**Upstream generic/context-anchored references:**
- https://github.com/Blakeem/ComfyUI_UltimateSDUpscaleGuider
- https://github.com/Blakeem/ComfyUI-ContextAnchoredTileRefine

**ComfyUI upstream:** https://github.com/Comfy-Org/ComfyUI

**Purpose of this supplement:** Organize the spatial-upscale / H3-USDU / VAE-seam discussion into an implementation and experiment plan that complements the first H3 mask/streaming handoff. This packet is deliberately broader than a patch request: it distinguishes several seam mechanisms that can look similar in motion, identifies the smallest useful fork experiment, explains where de-rope and spatial refinement should remain separated, and lays out the higher-value follow-on experiments if the simple frozen-context fix is not enough.

---

## 0. Read this first: the directive

Do **not** start this supplement until the core correctness work in the companion handoff is either implemented or explicitly supplied by the test environment.

The trustworthy spatial-mask test environment requires:

1. MAINodes support for ComfyUI #15375 per-token H3 modulation rows (MAINodes issue #5).
2. MAINodes compatibility with the new H3 FinalLayer/PDD interface from #15908 (MAINodes issue #4).
3. Correct H3 denoise-mask velocity conversion, either:
   - native ComfyUI after #15988 lands, or
   - the capability-gated MAINodes semantic shim from the first handoff, or
   - a development checkout with the #15988 code commit (`bdafd19`) applied.
4. The stale `_STOCK_FORWARD_SHA` must remain a safety fence until the copied trimmed H3 forward is actually rebased.

As of this 2026-09-04 snapshot, ComfyUI PR #15988 is still **open**. Its purpose is to multiply returned H3 video/audio velocity by the corresponding denoise masks before the outer x0/audio-carry conversion. Its upstream test reports baseline max x0 error `0.6487081` and patched error `4.77e-7`.

**The spatial work worth doing first is not a new tiler.** The current H3 USDU fork already contains almost all of the scaffolding needed to prove the central hypothesis. The first experiment should be a small, auditable patch to that fork:

1. make H3 actually use a nested noise mask;
2. allow H3 to use `anchor_context` instead of explicitly bypassing it;
3. keep the **sampling/freeze mask hard** and distinct from the **pixel-composite feather mask**;
4. process three full-height strips sequentially at native pixel geometry, aligned to H3's 32-pixel DiT row grid;
5. compare the resulting moving seam against the current fork on the same clip/seed/settings.

Only after that should the agent investigate global spatial RoPE coordinates, global noise, real locked audio context, alternate traversal, or a synchronized shared-latent canvas.

---

## 1. Executive synthesis: there are several seam problems, not one

The Discord observations are useful precisely because the seam is often nearly invisible on a paused frame but perceptible during motion. That does **not** imply one single cause.

Treat seams as separate failure classes with different mechanisms and fixes:

### 1.1 Diffusion/world-model seam

Two H3 spatial tiles solve overlapping or adjacent regions as different world-model trajectories.

Typical mechanism today:

```text
finished tile A is already in the live pixel canvas
        ↓
tile B crop includes finished A as overlap/context
        ↓
H3 VAE-encodes [A context | B]
        ↓
current H3 USDU path re-denoises all video pixels
        ↓
H3 internally invents A' while solving B'
        ↓
post-sampling composite discards A' and keeps visible A
        ↓
visible output = A | B' where B' was solved against A'
        ↓
motion can disagree across the boundary even if a still frame looks fine
```

Primary fix: **frozen neighboring context during H3 sampling**.

This is the main subject of sections 4-9.

### 1.2 VAE reconstruction seam

The same latent or pixel clip is independently encoded/decoded in spatial chunks and the decoder gives slightly different reconstructions near tile boundaries.

Current Comfy H3 VAE internally tiles spatially. In current source it defaults to roughly:

```text
tile_size       = 256 source pixels
tile_overlap_min = 64 source pixels
spatial VAE ratio = 16
```

It decodes each latent tile independently and then linearly blends overlap bands into a canvas.

Primary fix area: VAE tiling/chunking strategy, not H3 denoise masks. A context/halo-and-commit-interior strategy may help, but because the current H3 decoder is a `ViT3DDecoder`, do **not** assume there is a small finite convolutional halo that gives exact full-frame parity. Measure it.

This is the likely family for reports of seams during low-VRAM/progressive VAE decode.

### 1.3 Pixel compositing seam

The H3 tile results may already be coherent but the final alpha mask, blur, LANCZOS resize, brightness drift, or overlap blend makes a visible boundary.

Primary fixes:
- distinguish hard model mask from soft output mask;
- avoid unnecessary resize-in / resize-out geometry;
- use a tiny output feather only after model continuity is solved;
- optionally use minimum-error cuts/color compensation as fallback, not the first mechanism.

### 1.4 Coordinate/window seam

The model is shown a local crop/window but its positional coordinates say “this is a fresh standalone world beginning at the origin.”

Temporal analogue: ComfyUI issue #15982 reports H3 context windows losing global temporal window origin and creating periodic flicker.

Spatial analogue (new hypothesis in this supplement): every independently sampled H3 spatial crop currently constructs a fresh **local area-normalized spatial RoPE grid** from that crop's `latent_h × latent_w`. That means the same real-world object can have different `(h,w)` position IDs in neighboring tile calls.

Frozen context can solve a large part of the content boundary while this coordinate mismatch remains. Do not mix this into the MVP; instrument it if a residual seam survives.

### 1.5 Stochastic/noise-coordinate seam

The current H3 USDU path calls `prepare_noise(latent_image, seed, ...)` for each tile. Equal-shaped tiles with the same seed therefore start from the same tile-local noise realization rather than corresponding crops from one global noise field.

This may or may not matter materially for V2V refinement with strong starting latents and frozen context. It is cheap enough to A/B later.

### 1.6 Audio-context mismatch

H3 is a joint audio-video model. The current H3 USDU fork constructs an empty native audio template and also constructs a zero audio denoise mask, but then accidentally discards the entire mask. If we simply start returning the mask, we change audio behavior from “no mask attached” to “empty audio latent frozen.”

That may be the intended code path, but it is not automatically the best spatial-refinement conditioning. A better eventual spatial refiner may feed **real original/recovered audio latent as frozen context** while never regenerating audio in the spatial stage.

This is not required to prove the seam hypothesis but should be explicit rather than accidental.

---

## 2. North-star pipeline principle: time first, space second

The strongest architectural synthesis from the discussion is:

> **Temporal oversampling should happen while spatial tokens are cheap. Spatial oversampling should happen only after we have collapsed back to real/output time.**

Do not collapse de-rope and high-resolution spatial refinement merely because USDU can hide a VAE encode/decode inside one node.

### 2.1 Current useful separation

Conceptually:

```text
SOURCE VIDEO
    │
    ▼
LOWER-RES TEMPORAL STAGE
H3TimeSmear / temporal dilation
    │
    ▼
M dilated frames
    │
    ▼
H3 de-rope / temporal regeneration
    │
    ▼
VAEDecode
    │
    ▼
H3ExactRecover
    │
    ▼
N real/output frames    (N << M when dilation is substantial)
    │
    ▼
SPATIAL STAGE
pixel upscale / H3 spatial refinement / tiling
    │
    ▼
FINAL N high-res frames
```

`H3ExactRecover` is not a cosmetic resampler. MAINodes deliberately selects exact pixel frames after the H3 temporal pass. H3's video VAE has temporal compression and nonuniform frame/token coverage; there is not a simple one-latent-token-per-output-frame representation that lets us delete this pixel boundary without designing a new latent recovery algorithm.

### 2.2 The tempting but bad collapse

A naive “USDU already encodes images internally” rearrangement would become:

```text
H3TimeSmear
    │
    ▼
M dilated frames
    │
    ▼
HIGH-RES H3 spatial tiles over all M frames
    │
    ▼
ExactRecover
    │
    ▼
throw away a large fraction of expensive high-res temporal work
```

This saves a visible VAE node in the graph, not the VAE computation. USDU still encodes and decodes each tile internally.

Worse, it moves the expensive spatial H3 pass **before** temporal collapse. MAINodes' measured H3 token-length cost is approximately superlinear (`tokens^~1.7` in the relevant measurements), and spatial tiling duplicates context and sampler overhead. Spending that high-resolution work on temporary dilation frames that will be discarded is almost exactly backward.

### 2.3 Practical rule for the coding agent

Keep these stages logically distinct:

```text
Stage T: temporal repair / de-rope / insertion
    outputs real-time pixel frames

Stage S: spatial refinement
    consumes only those recovered frames
```

Stage S is free to own its **own** image → VAE → H3 → VAE → image machinery internally. That can simplify the workflow UI without pretending the encode has vanished.

### 2.4 Long-term exception

If a future implementation creates a persistent shared H3 latent representation from the recovered clip and does all spatial tiling there, the VAE boundary **inside Stage S** can be reduced:

```text
recovered pixels
    ↓
encode once
    ↓
shared spatial H3 latent canvas
    ↓
all tile refinement
    ↓
decode once
```

That is valuable. It still does **not** justify moving Stage S ahead of `ExactRecover`.

---

## 3. Current H3-USDU code audit: the key facts

Repository:
https://github.com/lisitskyaa/ComfyUI_UltimateSDUpscaleGuider_H3

File of interest:
`modules/processing.py`

The exact line numbers will drift; use function names and behavior as the primary anchors.

### 3.1 The fork builds the H3 nested mask and throws it away

Current helper:

```python
def _usdu_h3_startlatent_build_noise_mask(video_latent, audio_latent):
    import comfy.nested_tensor
    video_mask = torch.ones_like(video_latent)
    audio_mask = torch.zeros_like(audio_latent)
    return comfy.nested_tensor.NestedTensor((video_mask, audio_mask))
```

Then `_usdu_h3_startlatent_prepare()` does approximately:

```python
samples = NestedTensor((video_latent, audio_tmpl))
noise_mask = _usdu_h3_startlatent_build_noise_mask(video_latent, audio_tmpl)
...
return {"samples": samples}, source_frames
```

The constructed `noise_mask` never reaches the sampler.

The logger describes the audio as locked, but the return object does not attach the lock.

This is a real implementation inconsistency, but see section 10 before treating the one-line return change as a production-quality audio design.

### 3.2 H3 is explicitly excluded from generic `anchor_context`

Immediately after encoding, current logic is effectively:

```python
if (not is_h3_startlatent_v2v) and anchor_context and (...):
    ...
    latent["noise_mask"] = ...
```

The UI/documentation promises context anchoring, but the H3 starting-latent path cannot use it.

That is the central seam-fix opportunity.

### 3.3 Tile B already sees finished tile A

The loop crops tile inputs from `shared.batch`, the live canvas. After a tile finishes, the decoded/composited result is written back to `shared.batch[i]`.

So in sequential mode the current dataflow already has the right dependency:

```text
A generated → A written to live canvas
                    ↓
B crop comes from live canvas
                    ↓
B input already contains finished A in its context area
```

We do **not** need a new cross-tile attention system to prove the idea.

The missing semantic is that A must be **visible but immutable** while B is sampled.

### 3.4 H3 tiles are currently resized before sampling and resized back afterward

The code crops `crop_region`, then, if the crop differs from a fixed `tile_size`, applies LANCZOS before VAE encode. After H3 sampling/decode it LANCZOS-resizes the result back to the original crop size.

This is inherited behavior that is especially questionable for temporal video refinement:

```text
real context crop
    ↓
resize to generic processing tile geometry
    ↓
VAE encode → H3 → VAE decode
    ↓
resize back
```

An interior tile can have context on both sides while an edge tile has context on only one side, so the scale ratio can differ by tile. A static frame can look acceptable while motion acquires a small spatial ripple at the boundary.

For a full-height strip, vertical resize is particularly wasteful: if the source itself is 1088 pixels high and the crop has no vertical pixels outside the frame, growing it just to satisfy inherited processing dimensions creates no additional context.

### 3.5 Current generic anchor logic also conflates soft composite blur with hard diffusion mask

Current flow blurs `image_mask`/`composite_masks`, then the generic anchor path eventually turns any value `> 0` into a live denoise region.

That creates this failure:

```text
Gaussian mask tail = 0.0001
        ↓
threshold > 0
        ↓
1.0 = fully live denoise
```

A pixel feather operation should not silently expand the model's denoising domain.

Sampling/freeze semantics and output blend semantics need separate masks.

### 3.6 The guider path creates tile-local noise from the same seed every tile

`sample_with_guider()` currently does:

```python
latent_image = latent["samples"]
noise = comfy.sample.prepare_noise(latent_image, seed, batch_inds)
...
guider.sample(...)
```

Since the seed is reused and each tile is sampled separately, same-shaped tiles use same-origin stochastic fields rather than slices of one global spatial noise field.

Do not change this in the first patch. Add it as a later controlled A/B.

### 3.7 H3 source frame count is padded to the native legal sequence and cropped back after decode

The fork rounds source video to an H3 legal frame count (`17k + 5` family), matches the VAE latent against the native template, then after decode trims back to the original source frame count.

This is another reason the “USDU simply removes the VAE plumbing” story is too simplistic. The node is doing real H3 temporal-shape adaptation internally.

---

## 4. Why frozen context is the right first primitive

Comfy's sampling machinery already has the exact semantics we need:

```text
denoise_mask = 1  → region is live / noisy / generated
denoise_mask = 0  → region is preserved/reinjected
```

The important distinction is:

```text
CAN THE MODEL ATTEND TO FROZEN A?  yes
CAN THE SAMPLER MODIFY FROZEN A?   no
```

H3 self-attention is not hiding those frozen rows merely because their denoise mask is zero.

Therefore the desired tile B call is conceptually:

```text
crop = [finished neighbor context A | new tile core B]

video denoise mask:
0 0 0 0 0 0 | 1 1 1 1 1 1
frozen A       live B

H3 attention sees both.
H3 sampler can only rewrite B.
```

This changes the causal relationship from:

```text
B is generated against temporary re-imagined A'
```

to:

```text
B is generated against the exact A that will remain visible
```

For video, this gives the model a space-time boundary condition: moving branches, faces, camera translation, lighting changes, and object trajectories have an already-established neighboring history rather than a second independently synthesized history.

---

## 5. The MVP experiment: patch the existing fork, not MAINodes first

The purpose of this MVP is to answer one question:

> Does making the already-finished neighboring H3 tile immutable during the next tile's denoise remove the moving seam that ordinary overlap/reprocess leaves behind?

Do this in a small fork/branch before building a new MAINodes node.

### 5.1 Recommended fixed test geometry

Use the existing successful/high-quality case:

```text
output target:      1920 × 1088
spatial topology:   3 full-height vertical cores
core width:         640 px each
height:             1088 px
context:            begin with 64 px
order:              linear, sequential
batch size:         1
seam-fix pass:       none
sampling mask blur: 0
```

This geometry is unusually convenient for H3:

```text
1920 / 3 = 640
640 / 32 = 20
1088 / 32 = 34
64 / 32 = 2
middle crop with 64 px both sides = 768 × 1088
768 / 32 = 24
```

So the model boundary can be aligned cleanly to H3's 2×2 latent-patch rows, which correspond to 32×32 source-pixel cells (16× VAE spatial compression × 2×2 DiT patch).

### 5.2 Phase A: preserve a hard model mask separately from soft output masks

Before any Gaussian blur, save a hard copy:

```python
hard_image_mask = image_mask.copy()

hard_composite_masks = (
    [m.copy() for m in composite_masks]
    if composite_masks is not None
    else None
)
```

Keep the existing blurred mask only for the final pixel alpha/composite behavior.

Initially set output `mask_blur=0` too so the first experiment has no hidden variable.

### 5.3 Phase B: create an H3 nested anchor mask

Add an H3-specific helper. Pseudocode, not drop-in production code:

```python
def build_h3_spatial_anchor_mask(latent, hard_mask, crop_region, actual_crop_size):
    import comfy.nested_tensor
    import torch.nn.functional as F

    video, audio = latent["samples"].unbind()

    # Crop the exact world-space area fed to H3.
    m = hard_mask.crop(crop_region)

    # If MVP still uses a resized H3 tile, use NEAREST here, never LANCZOS/BILINEAR.
    # Native-size phase should make this unnecessary.
    if m.size != actual_crop_size:
        m = m.resize(actual_crop_size, Image.Resampling.NEAREST)

    m = torch.from_numpy(np.asarray(m, dtype=np.float32) / 255.0)[None, None]
    m = m.to(device=video.device, dtype=video.dtype)

    # Pixel-space mask -> H3 VAE latent spatial grid.
    m = F.interpolate(m, size=video.shape[-2:], mode="nearest")

    # MVP: hard binary semantics.
    m = (m >= 0.5).to(video.dtype)

    # Static spatial mask for every H3 video-latent timestep.
    m = m.unsqueeze(2).expand(
        video.shape[0], 1, video.shape[2], video.shape[-2], video.shape[-1]
    ).contiguous()

    # AUDIO POLICY IS EXPLICIT; see section 10.
    audio_mask = torch.zeros_like(audio)

    return comfy.nested_tensor.NestedTensor((m, audio_mask))
```

Important semantics:

```text
hard model mask: nearest / binary / aligned
soft output feather: separate pixel operation
```

Do **not** use a Gaussian tail or bilinear antialiasing to define whether an H3 DiT row is live.

### 5.4 Phase C: remove the H3 exclusion from anchor behavior

Restructure the current logic into a model-specific branch:

```python
should_anchor = anchor_context and (
    region_mask is not None
    or tile_overlap_mode == CONTEXT_ONLY
)

if should_anchor:
    if is_h3_startlatent_v2v:
        latent["noise_mask"] = build_h3_spatial_anchor_mask(...)
    else:
        # existing generic implementation
        ...
```

For the first H3 version support only a static spatial seam mask shared across the whole video.

Do not pretend arbitrary per-frame edit masks are solved here; H3's temporal VAE makes those a separate problem.

### 5.5 Phase D: force sequential processing

For the context-anchored H3 path:

```text
batch_size = 1
mode       = Linear / explicit tile order
```

Neighbor anchoring is dependency-ordered by definition:

```text
A completes
  ↓
B conditions on completed A
  ↓
C conditions on completed B
```

A spatial batch of A/B/C at the same time cannot provide those completed-neighbor semantics unless the algorithm changes to synchronized shared-latent tiling (section 14).

### 5.6 Phase E: run against correct #15988 semantics

Do not evaluate H3 masked denoising against a core with the known velocity/x0 mismatch.

Use one of:

```text
A. MAINodes capability-gated #15988 semantic wrapper
B. ComfyUI checkout with bdafd19 applied
C. future native ComfyUI after #15988 merges
```

For research validation, A and B should already have a parity test from the first handoff.

---

## 6. Do not overvalue the one-line “return the existing mask” patch

The current fork already creates:

```text
video mask = 1 everywhere
audio mask = 0 everywhere
```

and then discards it.

Changing:

```python
return {"samples": samples}, source_frames
```

to:

```python
return {"samples": samples, "noise_mask": noise_mask}, source_frames
```

is a valid diagnostic and makes the code match its “audio locked” logging.

However, this is **not** necessarily a production-safe semantic no-op:

- Today, no mask is attached.
- After the change, H3's empty audio template is explicitly frozen.
- H3 is joint audio-video; those audio rows are part of the same packed model sequence.
- Even if the output audio is discarded, changing whether those rows are live/frozen can change video conditioning.

Therefore use the one-line patch as **Experiment B**, not as an unquestioned final design.

The production spatial refiner should make audio policy explicit.

---

## 7. Phase 2 after the mask proof: native-size H3 crops

If frozen context helps, the next change should remove inherited resize-in / resize-out geometry from H3.

### 7.1 Desired H3 path

```text
compute actual world crop including context
    ↓
adjust crop edges to valid /32 boundaries
    ↓
actual crop size IS the H3 processing size
    ↓
no LANCZOS before VAE
    ↓
H3
    ↓
no reverse LANCZOS after VAE
    ↓
commit only core / tiny feather band
```

### 7.2 Why /32 rather than merely /8 or /16

Current H3 video VAE has spatial ratio 16.

Current H3 DiT patchifies video latent with 2×2 spatial patches.

Therefore one model row covers:

```text
16 source pixels / latent cell
× 2 latent cells / DiT patch
= 32 source pixels per DiT spatial row edge
```

Current H3 `mask_row_values()` pools the denoise mask over each 2×2 latent patch using `amax`.

A seam cutting through a 32-pixel model row can therefore make the entire row live if any part of it is live.

For the deterministic first experiment, require:

```text
tile core boundaries: multiples of 32
context widths:        multiples of 32
crop dimensions:       multiples of 32
```

Later, if arbitrary image sizes are required, implement explicit edge padding/cropping and document exactly which pixels are padded.

### 7.3 Full-height strips are a good initial topology

Three vertical strips provide:

- only two H3 diffusion seams;
- no horizontal H3 tile boundary;
- full vertical scene context within each tile;
- easy alignment at 1920×1088;
- a simple causal traversal;
- easy visual measurement of seam energy at x≈640 and x≈1280.

Do not generalize to arbitrary 2D chess tiling before the 3-strip result is known.

---

## 8. Split “overlap” into separate concepts

The term overlap is overloaded in classic tiled upscaling. The new H3 design should have separate knobs/concepts.

### 8.1 Tile core

The region whose newly generated pixels are committed to the output.

Example:

```text
640 px core
```

### 8.2 Context anchor

Neighbor world shown to H3 but not modifiable and not committed from the new tile.

Initial sweep:

```text
64 / 96 / 128 px, aligned to /32 where possible
```

This can be much wider than the final visible blend.

### 8.3 Optional live diffusion overlap

A band both neighboring tiles are allowed to refine.

For the first hypothesis test, use **zero** if possible. We want to know whether frozen context alone prevents the discrepancy.

Later, a thin live band can be evaluated if model continuity benefits from both sides solving a small shared region.

### 8.4 Output feather

A tiny pixel-space blend used only for residual VAE/color/reconstruction mismatch.

Start at:

```text
0 px
```

then try perhaps:

```text
8 / 16 / 32 px
```

if needed.

### 8.5 Architectural implication

Classic tiling says:

> “Large overlap is mandatory because two independent generations need to be reconciled.”

Context anchoring instead says:

> “Give the model lots of immutable neighboring world to reason from; only blend a tiny residual boundary if necessary.”

Blakeem's newer `ComfyUI-ContextAnchoredTileRefine` independently converges on almost exactly this split: native-size tiles, context rings, frozen anchor context, sequential processing, and a narrow residual blend. Its synchronized latent variants go further and step all tiles against one shared latent canvas.

Reference:
https://github.com/Blakeem/ComfyUI-ContextAnchoredTileRefine

---

## 9. Minimal experiment matrix: prove the cause before refactoring

Use one fixed difficult video, one seed, one sampler/schedule, one denoise level, same prompt/conditioning, same H3 model, same output resolution.

Record runtime and peak VRAM, but quality causality is the first target.

| Run | Change from previous | Purpose |
|---|---|---|
| A | Current H3 USDU fork | Baseline moving seam |
| B | Only attach the already-constructed nested mask | Tests current intended audio-lock behavior; should not fundamentally solve video seam because video mask remains all-ones |
| C | B + hard H3 frozen-neighbor spatial mask | **Primary hypothesis test** |
| D | C + tiny output feather (8/16 px) | Determines whether remaining boundary is only VAE/pixel reconstruction |
| E | C/D + native-size H3 crops, no resize-in/out | Tests inherited USDU geometry as second seam source |
| F | E + context sweep 64/96/128 | Finds useful context radius |
| G | E/F + global spatial noise field | Tests tile-local noise reset hypothesis |
| H | E/F + real frozen audio context | Tests whether empty/frozen audio is hurting video coherence |
| I | E/F + global spatial RoPE prototype | Tests local-coordinate reset hypothesis if residual seam remains |

The highest-value comparison is **A vs C**.

If C makes the transient motion seam disappear or sharply reduces it, the main theory is confirmed before any larger architecture change.

---

## 10. Audio semantics for a spatial H3 refiner

This deserves its own explicit contract because H3 is audio-video jointly.

### 10.1 Do not let Stage S accidentally rewrite the performance

For the spatial stage the safe product/default behavior should be:

```text
video: refine spatially
audio: preserve chosen source performance
```

This matches the broader MAINodes workflow principle that audio recovery should default to the original performance unless the workflow deliberately seeded/regenerated audio rows and the user intentionally selects that result.

### 10.2 Current USDU H3 behavior is ambiguous

The fork creates:

```text
samples = NestedTensor((video_latent, EMPTY audio template))
constructed mask = (video ones, audio zeros)
```

but drops the mask.

A one-line fix would freeze an **empty** audio latent.

That may be okay as a minimal starting-latent mechanism, but it is not obviously ideal conditioning for a joint AV transformer.

### 10.3 Better eventual design

Add an explicit spatial-refiner audio-context mode:

```text
empty_locked          # compatibility / minimal mode
original_locked       # preferred safe default if available
recovered_pass_locked # use chosen Stage-T audio result, but never modify it in Stage S
```

Implementation idea:

1. encode the selected audio source once to H3 audio latent;
2. reuse that same global audio latent for every spatial tile;
3. use `audio_denoise_mask=0` for all Stage-S tiles;
4. do not return/replace audio from Stage S unless explicitly requested;
5. preserve the same audio timing/context across all spatial tiles.

This may improve lip/motion/beat coherence because every tile receives the real shared performance context rather than an empty audio stream.

### 10.4 Experiment

After the visual mask MVP works, compare:

```text
A. empty audio, current behavior
B. empty audio explicitly frozen
C. original/recovered audio explicitly frozen
```

Measure video seam, face/lip stability, motion rhythm, and any unexpected visual change. Do not assume output-audio equivalence implies visual equivalence.

---

## 11. New research lead: “Spatial True Coordinates” for H3 RoPE

This is the most interesting synthesis beyond the obvious USDU patch.

### 11.1 What current H3 does

Current Comfy H3 constructs target spatial position IDs from the **local latent dimensions** for each model call.

At a high level:

```python
frame, w_grid = _frame_grid(latent_h, latent_w)
...
position_ids_for_target_video = _video_grid(latent_t, frame, cursor)
```

`_frame_grid(h,w)` creates **area-normalized** h/w coordinates from that local crop's shape.

Therefore three independent tile calls can conceptually be telling H3:

```text
left tile:   "I am a complete 768×1088-ish world centered on my own local grid"
center tile: "I am a complete 768×1088-ish world centered on my own local grid"
right tile:  "I am a complete 768×1088-ish world centered on my own local grid"
```

instead of:

```text
left tile:   "I occupy global x = 0...704"
center tile: "I occupy global x = 576...1344"
right tile:  "I occupy global x = 1216...1920"
within one 1920×1088 world"
```

The exact ranges depend on context geometry, but that is the conceptual mismatch.

### 11.2 Why this resembles #15982

ComfyUI issue #15982 is a temporal-window version of the same abstraction leak:

```text
crop/window is physically from later in the world timeline
but model coordinates restart at local origin
```

MAINodes True Clock work already treats temporal coordinate truth as important.

Spatial tiling raises the analogous question:

> Should neighboring H3 tiles share a single global spatial coordinate system even though they are sampled in separate calls?

### 11.3 This is a hypothesis, not a bug claim

Independent tile refinement is outside the normal whole-frame H3 contract. It is not fair to call local spatial coordinates an upstream Comfy bug by themselves.

Treat this as a MAINodes research extension.

Frozen context may make local coordinates irrelevant enough in practice. Test only if residual seam/geometry drift remains after the P0/P1 fixes.

### 11.4 Prototype design

Because H3's `_forward` accepts/uses `minimax_payload["layout"]` if supplied, a future MAINodes/experimental wrapper could build a layout with global target-video h/w position IDs.

Conceptually:

1. compute the H3 frame grid for the **full global target latent**;
2. identify the DiT-row crop corresponding to the tile's global x/y origin and extent;
3. slice those global h/w position rows for the tile;
4. repeat them across the tile's latent time exactly as H3 normally does;
5. preserve the existing target temporal origin/cursor;
6. use the custom layout only when its signature matches the tile's packed sequence.

The /32 crop alignment from section 7 makes this much easier because each tile boundary lands exactly on DiT spatial rows.

### 11.5 Important audio-coordinate detail

H3's target audio position rows pin stereo channels to the low/high extremes of the current video `w_grid`.

If video uses global spatial coordinates but target audio continues using tile-local extrema, the packed positional system becomes internally inconsistent.

For a global spatial layout prototype, consider using the **global full-frame w extrema for audio rows** too, especially if the same real audio latent is reused across every tile.

Test this rather than assuming it.

### 11.6 Mandatory layout tests before visual experiments

- A crop equal to the full frame must produce position IDs equivalent to stock H3.
- The same global pixel/DiT row appearing in two overlapping tile crops must have identical h/w position IDs.
- Adjacent /32-aligned crops must have monotonically continuous global coordinates at the boundary.
- Ref/keyframe segments must either be intentionally unsupported in the first prototype or receive correct compatible grids; do not silently corrupt layouts when refs are present.
- Audio row position IDs must be deterministic and documented.

---

## 12. New research lead: use one global noise field

Current tile-local behavior:

```text
tile A: prepare_noise(shape_A, seed)
tile B: prepare_noise(shape_B, seed)
tile C: prepare_noise(shape_C, seed)
```

For equal shapes, this effectively gives each crop a fresh same-origin noise realization.

A more globally consistent tiled solver would do:

```text
prepare full global video-latent noise once
        ↓
crop noise by each tile's global latent coordinates
        ↓
use exact corresponding noise in overlap/context/live regions
```

### 12.1 Why it might matter

Frozen context constrains the output boundary, but stochastic trajectories in the new region can still differ based on local noise coordinates.

Global noise is a cheap way to make tiled sampling more like cropping one whole-frame diffusion process without yet implementing a shared latent solver.

### 12.2 Why it may not matter much

At low denoise strength, with strong V2V starting latents and hard frozen anchors, H3 may be dominated by source conditioning enough that the noise-coordinate difference is negligible.

Therefore A/B it; do not architect around it until measured.

### 12.3 Implementation requirements

- generate noise at global H3 latent video shape, not pixel shape;
- crop on /16 latent boundaries and preferably /32 model-row boundaries;
- preserve exactly the same sigma schedule;
- if audio is frozen, audio noise should not create a changing global state;
- ensure the comparison uses the same seed and the exact same tile traversal.

---

## 13. Progressive/low-VRAM VAE seams: same principle, different mechanism

Someone reporting seams during progressive VAE decode may sound related, but do **not** apply the H3 denoise-mask solution to it.

### 13.1 Current H3 VAE already has internal spatial tiling

Current Comfy source defines `MiniMaxH3VideoVAE` with:

```text
vae_ratio        = 16 spatially
vae_ratio_t      = 4 temporally
tile_size        = 256
tile_overlap_min = 64
tiling           = true
```

Its spatial encoder/decoder operates on tiles and blends overlap bands. The decoder is a `ViT3DDecoder`, not a simple local-only convolution stack.

### 13.2 Isolate VAE seams before touching diffusion

Create a pure round-trip diagnostic:

```text
source clip
    ↓
H3 VAE encode
    ↓
H3 VAE decode
    ↓
compare against source / full feasible reference
```

No H3 DiT sampling at all.

Then map residual temporal/spatial seam energy against:

```text
A. USDU/H3 diffusion core boundaries (e.g. x=640,1280)
B. H3 VAE internal 256-ish tiling boundaries
C. final pixel composite boundaries
```

This tells us which subsystem owns the artifact.

### 13.3 “Compute with context, commit only interior” still generalizes

The same broad principle can improve a progressive VAE strategy:

```text
decode tile with halo/context
    ↓
discard unreliable halo edge
    ↓
commit only center/interior
```

But because the decoder has transformer/global-in-tile behavior, do not claim a particular halo is mathematically exact. Sweep and measure.

### 13.4 Do not assume generic VAEDecodeTiled knobs control H3's internal tiler

Current H3 VAE implements its own internal tiling. Before changing a Comfy node's external tile/overlap widgets, inspect which code path the installed H3 VAE actually uses.

Version drift matters here: old H3 VAE OOM/seam reports may describe earlier core behavior that current master has already changed.

### 13.5 Useful VAE experiment matrix

```text
V0 source only
V1 one encode/decode roundtrip, stock H3 VAE
V2 larger internal overlap if safely parameterizable
V3 halo/crop-interior prototype
V4 decode whole frame where VRAM permits (gold reference)
```

Metrics:
- framewise seam gradient at known tile positions;
- temporal derivative of that gradient;
- LPIPS/SSIM only as secondary metrics;
- optical-flow discontinuity across seam;
- visible flash/ripple frequency in playback.

---

## 14. Longer-term architecture: shared H3 latent canvas

Do **not** build this first. It is the natural destination if the small fork experiment succeeds and Stage-S VAE cost/seams remain important.

### 14.1 Sequential shared-latent version

Instead of:

```text
finish A pixels
→ decode A
→ paste A pixels
→ crop A again as B context
→ re-encode A context
```

maintain:

```text
encode recovered clip once
        ↓
global H3 latent canvas
        ↓
sample tile A latent
        ↓
commit A core into global latent canvas
        ↓
sample tile B with A latent frozen as context
        ↓
commit B
        ↓
sample C
        ↓
decode whole final latent once
```

Benefits:
- one Stage-S video encode;
- one final video decode;
- no VAE reconstruction mismatch between H3 diffusion tiles;
- exact frozen context is already latent, not decode/re-encode approximation;
- global noise and global spatial coordinates become easier to define.

Risks:
- H3 nested audio/video latent handling;
- RoPE/layout position semantics;
- per-tile masks and sampler state;
- memory residency of the global canvas;
- correct denoise schedule when tiles are completed at different times;
- refs/keyframes/payload compatibility.

### 14.2 Better long-term version: synchronized tiled diffusion

Blakeem's current `ContextAnchoredTileRefine` VL nodes implement a stronger idea for image models: all tiles live on one shared canvas latent and every tile advances **one diffusion step at a time**, with results consolidated back into the shared canvas between steps.

Reference:
https://github.com/Blakeem/ComfyUI-ContextAnchoredTileRefine

For H3 the analogous algorithm would be roughly:

```text
GLOBAL latent canvas at sigma_k

for each tile:
    crop tile + context from SAME sigma_k global canvas
    run one model/sampler step
    collect tile proposal

merge/commit proposals into global canvas

advance to sigma_(k+1)
repeat
```

This removes the fundamental left→right “A is fully finished while C has not started” asymmetry.

It is closer to MultiDiffusion/Mixture-of-Diffusers family thinking but can preserve direct tile bodies and blend only a narrow shared band.

### 14.3 Why synchronized tiling is attractive for video

- all neighboring tiles reason about roughly the same noise level at the same time;
- global motion structures do not have to condition on a fully denoised neighbor while the current tile is still very noisy;
- left-to-right accumulated style/brightness drift can be reduced;
- traversal order becomes less semantically important;
- global noise/layout naturally fit one world canvas.

### 14.4 Why it is invasive for H3

H3 is not just a 2D latent image sampler:

- video + audio are packed together;
- masks create per-token local timesteps;
- temporal latent structure is nontrivial;
- PDD and model wrappers need current compatibility;
- references/keyframes can alter packed layout;
- one sampler step needs correct nested state and sigma/carry semantics.

Treat synchronized H3 tiling as P3 research after the simpler sequential version is validated.

---

## 15. Traversal order is a real design parameter

For the 3-strip MVP use simple left → center → right because it is easy to reason about and matches the current sequential fork.

Afterward, consider whether traversal affects residual quality.

### 15.1 Raster/left-to-right

```text
A → B → C
```

Pros:
- simplest;
- matches traditional implementation;
- sensible when dominant camera/object motion enters from the left and travels right.

Cons:
- errors/style choices can propagate A→B→C;
- rightmost tile is two generations removed from the first anchor decision.

### 15.2 Center-out

```text
B first
then A anchored to B
then C anchored to B
```

Pros:
- central subject/face can become the anchor world;
- both outer strips are only one hop from the center;
- symmetric error distribution.

Cons:
- first center tile has no generated neighbor context;
- not naturally aligned with directional motion/camera flow.

### 15.3 Motion-aware traversal (future experiment)

Estimate dominant horizontal optical flow/camera translation and start from the source side of the motion.

Example:

```text
dominant motion → right
choose left→right
```

This is speculative. It is interesting because the Discord seam was more perceptible on the side toward which motion/attention was trending.

Do not add an optical-flow subsystem until ordinary traversal A/Bs show a meaningful directional effect.

---

## 16. Performance and low-VRAM synthesis

The community observations point to a real optimization problem rather than “more tiles = better low VRAM.”

### 16.1 Costs compete

More/smaller spatial tiles:

```text
+ lower peak token count per H3 call
+ lower VRAM
+ potentially faster superlinear attention/model work per tile

- more duplicated context
- more VAE encode/decode work
- more sampler launches
- more boundaries
- more offload/model residency churn
```

Fewer/larger tiles:

```text
+ fewer seams
+ less duplicated context
+ fewer encode/decode/sampler launches

- much larger token count per H3 call
- possible OOM
- superlinear H3 compute increase
```

### 16.2 Do not repeat model initialization unnecessarily

The long pauses users describe as “initializing the model several times” may include real offload/reload/residency churn rather than graph construction alone.

A dedicated MAINodes Stage-S node should try to keep:

- H3 model/guider;
- VAE;
- sampler/sigmas;
- audio context;
- source/global latent if used

alive across the entire tile loop, subject to available VRAM.

Measure actual model load/offload events rather than inferring from wall-clock pauses.

### 16.3 Existing `H3StreamedBlocks` may enable a different spatial optimum

Once the first-handoff compatibility fixes are in place, MAINodes block streaming can potentially lower activation pressure enough that a user who needed three strips can run two wider strips.

That trades:

```text
3 strips → 2 seams
2 strips → 1 seam
```

against a larger per-call token count.

Benchmark rather than assuming two strips are faster; with superlinear sequence cost, three may still win in wall time.

### 16.4 Candidate future auto-planner

A useful MAINodes research feature could choose tile layout under a VRAM budget by minimizing a rough objective:

```text
estimated H3 token cost
+ duplicated context cost
+ VAE tile cost
+ model-transition penalty
+ seam-risk penalty
```

subject to measured VRAM constraints.

Use the repo's existing empirical token-scaling data instead of an abstract FLOP-only estimate.

Not P0.

---

## 17. Interaction with de-rope and the motion adapter

This spatial tiling work should not be allowed to muddy the temporal research conclusions from the first handoff.

### 17.1 Separate axes

```text
TEMPORAL PROBLEM
H3 sees stretched/infilled world time
→ advance/snap / excess movement / interpolation difficulty
→ motion adapter and True Clock research

SPATIAL PROBLEM
H3 sees partial frame/world crop
→ neighbor disagreement / local spatial coordinates / tile-local noise
→ context anchor / global spatial coordinates / shared latent research
```

They are conceptually related because both are cases of giving H3 a partial world and asking it to remain globally coherent, but they are not the same bug.

### 17.2 Useful common principle

Both research tracks point toward:

> **Model coordinates and context should describe the real world being solved, while modification masks should say only which part is allowed to change.**

Temporal True Clock:
- preserve truthful world-time coordinates while adding temporal work capacity.

Spatial True Coordinates:
- preserve truthful global spatial coordinates while solving smaller spatial crops.

Frozen context:
- expose established world state to attention while preventing the sampler from rewriting it.

### 17.3 Potential eventual unified abstraction

If the experiments validate both axes, MAINodes could eventually represent an H3 subproblem as:

```text
world extent:
    global time range
    global x/y range

local compute crop:
    selected temporal window
    selected spatial tile

position transform:
    local tokens → global H3 coordinates

editability mask:
    which local rows may change

context source:
    immutable surrounding latent/pixel/audio state
```

That is a much cleaner general abstraction than special-case “time smear,” “tile overlap,” and “seam repair” switches. Do not build this framework before the experiments justify it, but keep it in mind when naming interfaces.

---

## 18. Concrete implementation queue for the coding agent

### P0 — prerequisites / correctness

Read and execute the companion handoff first:

- MAINodes #5 per-token mod-row streaming;
- MAINodes #4 FinalLayer/PDD compatibility;
- #15988 capability-aware semantic correction;
- tests proving native/shim parity;
- no `_STOCK_FORWARD_SHA` refresh.

**Stop condition:** do not interpret H3 masked spatial quality before this is green.

### P1 — tiny H3-USDU experiment branch

1. Pin/document exact upstream fork commit used for testing.
2. Add logging for:
   - crop region;
   - actual crop size;
   - processing tile size;
   - H3 encoded latent shape;
   - video/audio mask min/max/unique values;
   - committed core region;
   - tile order.
3. Preserve hard masks before output blur.
4. Implement H3 nested static spatial anchor mask.
5. Remove/replace the H3 `anchor_context` exclusion.
6. Force/validate sequential `batch_size=1` for context-anchored H3.
7. Use 3× full-height 640×1088 cores and 64px context.
8. Run with no seam-fix pass and no mask blur.
9. Capture A/B videos and objective seam metrics.

**Stop condition:** determine whether frozen context materially reduces the moving seam.

### P1.5 — native geometry

If P1 helps:

1. move H3 detection before generic overlap resize decisions;
2. compute /32-aligned native crop geometry;
3. do not resize H3 crop before encode;
4. do not resize H3 decoded result back afterward;
5. rerun the exact same clip/settings.

**Stop condition:** determine whether inherited USDU geometry contributes independently.

### P2 — isolate residuals

In this order:

1. context-width sweep;
2. tiny output feather sweep;
3. pure VAE roundtrip seam test;
4. global-noise A/B;
5. real-frozen-audio A/B;
6. local-vs-global spatial RoPE prototype.

Do not start all six at once.

### P3 — MAINodes-native spatial refiner

Only after the fork experiments are understood:

- design a clean MAINodes node/API around **core/context/feather** semantics;
- keep one model/guider alive across tile loop;
- expose diagnostics/capabilities;
- support safe audio passthrough/context policy;
- integrate block streaming if useful;
- preserve exact source/output frame count.

### P4 — shared/synchronized latent research

Only if performance/quality data justify the engineering cost:

- encode Stage-S clip once;
- global H3 latent canvas;
- global position/noise fields;
- sequential latent commit prototype;
- then synchronized same-sigma tile stepping.

---

## 19. Required diagnostics and metrics

The seam is perceptual-in-motion, so do not evaluate only screenshots.

### 19.1 Save exact experiment metadata

For every run:

```text
repo commits:
  ComfyUI
  MAINodes
  H3 USDU fork

model / VAE / quantization
seed
sampler
sigma schedule
steps
CFG/guider config
denoise strength
frame count
FPS
input/output geometry
tile core geometry
context width
live overlap width
output feather width
traversal
mask mode
#15988 mode: native / MAINodes shim / dev cherry-pick
block streaming settings
peak VRAM
wall time
```

### 19.2 Visual seam metrics

At each known vertical seam x coordinate, calculate over time:

- luminance/color gradient discontinuity;
- optical-flow vector discontinuity across a small left/right band;
- temporal derivative of those discontinuities;
- high-frequency energy localized around the seam;
- frame index of top-N seam spikes.

A seam that is invisible while paused but visible in motion should show up more strongly in temporal/flow metrics than in static pixel error.

### 19.3 Control regions

Measure equivalent vertical lines away from the seam so camera motion itself is not mistaken for seam energy.

### 19.4 Video review format

Produce:

```text
A/B synchronized side-by-side
+ 4× or 8× narrow crop around seam
+ temporal difference view
+ optional optical-flow discontinuity visualization
```

Keep seed/settings identical.

---

## 20. Decision tree after the first experiments

### Result 1: C eliminates the moving seam

Interpretation:

> Re-denoising the already-finished neighbor was the main cause.

Next:
- native-size geometry;
- tiny feather only if required;
- package into MAINodes Stage-S node;
- global RoPE/noise can remain research-only.

### Result 2: C helps, E helps again

Interpretation:

> Two independent problems were present: world-model disagreement and inherited resize geometry.

Next:
- make native-size geometry mandatory for H3 mode;
- keep frozen anchor;
- isolate remaining VAE/pixel contribution.

### Result 3: C barely helps, pure VAE roundtrip shows same seam

Interpretation:

> The dominant artifact is likely VAE tile reconstruction, not H3 diffusion-world disagreement.

Next:
- stop tuning H3 denoise overlap;
- work on VAE tile/halo/chunk strategy;
- compare seam locations to internal H3 VAE tile boundaries.

### Result 4: C/E remove static mismatch but subtle motion warp persists

Interpretation:

> Investigate coordinate/noise consistency.

Next:
1. global noise A/B;
2. spatial True Coordinates prototype;
3. only then more elaborate shared latent work.

### Result 5: real locked audio changes visual stability

Interpretation:

> Stage-S H3 visual refinement is meaningfully using global audio context.

Next:
- make selected source audio a first-class frozen conditioning input;
- never silently use empty audio when real performance is available;
- retain original audio as output by default.

### Result 6: sequential direction strongly affects quality

Interpretation:

> Error propagation / flow direction matters.

Next:
- center-out test;
- simple motion-aware traversal test;
- consider synchronized same-sigma tiling if direction dependence remains severe.

---

## 21. Acceptance criteria for a MAINodes-native Stage-S implementation

A production-worthy first MAINodes spatial H3 refiner should satisfy all of these:

### Correctness

- Runs only with known-safe H3 mask semantics (#15988 native or compatibility shim).
- H3 per-token mask rows work with `H3StreamedBlocks`.
- PDD/FinalLayer compatibility from first handoff remains intact.
- Frozen context is truly frozen at every sampler step.
- Frozen rows remain available to H3 attention.
- Hard sampling mask and soft output feather are independent.
- No accidental double mask scaling.

### Geometry

- H3 tile core/context boundaries have explicit /32 alignment/padding rules.
- H3 crop is sampled at native pixel geometry; no hidden LANCZOS resize-in/out.
- Output dimensions and source frame count are exact.
- Every tile reports global crop/core coordinates in diagnostics.

### Audio

- Spatial refinement cannot silently replace the user's audio.
- Audio context policy is explicit.
- Default is preservation of the selected/original performance.
- If audio is supplied as H3 context, it is encoded/reused consistently across every tile.

### Reproducibility

- Fixed seed gives deterministic tile order/results under the same software/hardware path.
- Experiment metadata includes upstream commits and #15988 mode.
- A whole-frame/single-tile case is a sanity control.

### UX

Prefer semantic parameters:

```text
max_tile_width / target core width
context_anchor_px
live_overlap_px
output_feather_px
traversal
spatial_coordinate_mode = local | global_experimental
audio_context_mode
```

Avoid exposing inherited USDU knobs whose meaning is ambiguous for H3 unless they map cleanly to the new concepts.

---

## 22. Things the agent should NOT do

1. **Do not** judge masked H3 tiling on unpatched pre-#15988 ComfyUI and then tune around its known math error.
2. **Do not** refresh MAINodes `_STOCK_FORWARD_SHA` merely to make trim-forward run again.
3. **Do not** merge all spatial work into the first compatibility patch.
4. **Do not** use output Gaussian blur as the H3 denoise/freeze mask.
5. **Do not** assume `Context Only Overlap` currently means frozen H3 context; H3 is explicitly excluded in the present fork.
6. **Do not** treat `seam_fix_mode=None` as a defect. Prevention is preferable to an extra seam-repair diffusion pass.
7. **Do not** combine de-rope and high-res spatial refinement just to remove visible VAE nodes.
8. **Do not** run high-res Stage S across temporary dilation frames that `ExactRecover` will throw away unless an experiment specifically tests that trade.
9. **Do not** assume returning the currently discarded `(video=1,audio=0)` mask is semantically harmless; it freezes an empty audio template.
10. **Do not** add arbitrary per-frame H3 spatial masks in the first tiler; start with one static spatial mask over all video timesteps.
11. **Do not** spatial-batch context-dependent tiles and claim they are anchored to completed neighbors.
12. **Do not** assume external generic VAE tiled-decode widgets control H3's current internal VAE tile policy.
13. **Do not** call local spatial RoPE an upstream bug yet; it is an experimental global-coordinate extension for independent tile calls.
14. **Do not** build synchronized shared-latent H3 tiling until the minimal sequential frozen-context experiment is measured.
15. **Do not** use screenshots alone to decide whether a motion seam is fixed.

---

## 23. Suggested branch / commit sequence

Keep commits intentionally separable so a failed hypothesis can be reverted without losing diagnostics.

### Experimental USDU fork

```text
exp/h3-anchor-00-instrumentation
  - record crop/tile/mask/latent geometry

exp/h3-anchor-01-hard-soft-mask-split
  - preserve pre-blur hard masks

exp/h3-anchor-02-nested-h3-context-mask
  - H3 static spatial frozen context
  - sequential guard

exp/h3-anchor-03-native-size
  - /32-aligned native H3 crop
  - remove H3 resize-in/out

exp/h3-anchor-04-global-noise
  - optional A/B only

exp/h3-anchor-05-audio-context
  - optional real locked audio A/B

exp/h3-anchor-06-global-spatial-layout
  - experimental RoPE/layout path only
```

Do not squash these until the causal experiments are complete.

### MAINodes later

Once behavior is understood, implement a clean native abstraction rather than permanently depending on the experimental fork's inherited USDU architecture.

Possible temporary research node names:

```text
H3 Context Anchored Spatial Refine
H3 Spatial Tile Plan
H3 Spatial Tile Diagnostics
```

Do not overcommit to naming before the interface stabilizes.

---

## 24. Source map / research snapshot

### Companion MAINodes correctness work

- MAINodes repo: https://github.com/matlowai/ComfyUI-MAINodes
- MAINodes issue #4: https://github.com/matlowai/ComfyUI-MAINodes/issues/4
- MAINodes issue #5: https://github.com/matlowai/ComfyUI-MAINodes/issues/5
- ComfyUI #15375: https://github.com/Comfy-Org/ComfyUI/pull/15375
- ComfyUI #15908: https://github.com/Comfy-Org/ComfyUI/pull/15908
- ComfyUI #15981: https://github.com/Comfy-Org/ComfyUI/issues/15981
- ComfyUI #15988: https://github.com/Comfy-Org/ComfyUI/pull/15988
- ComfyUI #15982: https://github.com/Comfy-Org/ComfyUI/issues/15982

### H3 USDU code

- Repo: https://github.com/lisitskyaa/ComfyUI_UltimateSDUpscaleGuider_H3
- `modules/processing.py`: https://raw.githubusercontent.com/lisitskyaa/ComfyUI_UltimateSDUpscaleGuider_H3/main/modules/processing.py
- `usdu_nodes.py`: https://raw.githubusercontent.com/lisitskyaa/ComfyUI_UltimateSDUpscaleGuider_H3/main/usdu_nodes.py
- `usdu_patch.py`: https://raw.githubusercontent.com/lisitskyaa/ComfyUI_UltimateSDUpscaleGuider_H3/main/usdu_patch.py

Current snapshot facts verified in `processing.py`:
- H3 nested mask helper builds video ones + audio zeros.
- `_usdu_h3_startlatent_prepare()` constructs that mask but returns only `samples`.
- generic `anchor_context` block explicitly begins with `not is_h3_startlatent_v2v`.
- tile crops come from the live `shared.batch` canvas.
- tiles can be LANCZOS-resized before H3 and resized back after decode.
- `sample_with_guider()` calls `prepare_noise` per tile with the same seed.

### Current Comfy H3 model

- Model: https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy/ldm/minimax/model.py
- H3 VAE: https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy/ldm/minimax/vae.py

Relevant current model facts:
- video latent is patchified 2×2 spatially;
- `mask_row_values()` pools mask values per 2×2 latent patch with `amax`;
- `_frame_grid(h,w)` creates area-normalized local spatial position coordinates;
- `PackedLayout` uses that local frame grid for target video rows;
- `_forward` accepts a supplied `minimax_payload["layout"]` if the signature matches;
- current `forward` exposes the `WrappersMP.DIFFUSION_MODEL` hook before outer audio carry conversion;
- as of this snapshot current master still lacks the #15988 velocity-mask additions.

### Current H3 VAE facts

Current source defaults include:

```text
space_down=(2,2,2,2,1,1) → ratio 16
time_down=(1,2,2,1,1,1) → ratio 4
tile_size=256
tile_overlap_min=64
tiling=True
decoder=ViT3DDecoder
```

Spatial encode/decode independently process tiles and blend overlap regions.

### Context-anchored prior art/reference

- Blakeem ContextAnchoredTileRefine:
  https://github.com/Blakeem/ComfyUI-ContextAnchoredTileRefine

Current repo describes:
- native-size tile extraction (no quality-losing resize);
- separate context rings;
- frozen context anchor as primary seam mechanism;
- narrow blending for residual differences;
- synchronized shared-latent tile stepping on its VL nodes.

This is useful architectural prior art. Do not blindly port image-model assumptions into H3's nested AV sampler.

---

## 25. Compact agent checklist

Before coding:

```text
[ ] Read companion handoff #1.
[ ] Confirm exact Comfy commit.
[ ] Confirm #15988 mode (native / shim / dev patch).
[ ] Confirm H3 USDU fork commit.
[ ] Capture baseline clip and metadata.
```

MVP:

```text
[ ] Instrument tile/crop/mask geometry.
[ ] Preserve hard mask before any blur.
[ ] Build nested H3 spatial anchor mask.
[ ] Keep frozen neighbor visible to attention.
[ ] Force sequential batch=1.
[ ] Use 3×640×1088 full-height cores at /32 alignment.
[ ] 64px frozen context.
[ ] No seam-fix pass.
[ ] No mask blur.
[ ] A/B same seed/settings.
```

If successful:

```text
[ ] Remove H3 resize-in/out; use native /32 crop.
[ ] Sweep context width.
[ ] Add only tiny output feather if needed.
[ ] Isolate pure VAE roundtrip seam.
```

Only if residual remains:

```text
[ ] Global latent noise A/B.
[ ] Real locked audio A/B.
[ ] Spatial global-RoPE/layout prototype.
[ ] Traversal A/B.
```

Longer-term only:

```text
[ ] Encode Stage-S clip once.
[ ] Shared latent canvas.
[ ] Same-sigma synchronized tile stepping.
```

---

## 26. Final architectural thesis

There is a useful pattern connecting almost everything we have been finding around H3:

```text
DO MORE COMPUTE LOCALLY
without lying to the model about the world.
```

For de-rope:

```text
more temporal compute
but preserve truthful time/context
```

For spatial refinement:

```text
smaller spatial compute crops
but preserve established neighboring world
and eventually truthful global spatial coordinates
```

For low-VRAM VAE:

```text
smaller reconstruction chunks
but give each chunk enough surrounding context
and commit only the region we trust
```

For audio:

```text
spatial visual work
but retain one truthful global performance context
```

That suggests a broader design direction for MAINodes: **separate compute partitioning from world coordinates, context, and editability.** A window/tile should describe *where it lives*, *what surrounding state it can see*, and *what it is permitted to modify* independently.

The immediate task is much smaller: prove that one frozen neighboring H3 strip eliminates the transient seam. But if it does, this is likely the start of a reusable H3 subproblem abstraction rather than merely another seam-fix mode.

