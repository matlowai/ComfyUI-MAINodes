# Partial denoise contract scout — 2026-11-08

READ FIRST: source inspection only. No render, page, server or code changes. Native core and development Snap source were checked. A runtime graph and image must still be inspected before calling any result image-to-image. This report owns no experiment assets.

## Finding

Both current P-H3 and Qwen2.1 new-view paths start from **empty target latents**. The pictures are encoded as conditioning references, not copied into the sampled target. Lowering only the existing denoise/sigma schedule is not image-to-image from the collage. Reference blurring/feathering is a separate, valid experiment: it changes conditioning pixels while the target is still generated from noise.

The smallest truthful experiment encodes the collage through the same model's VAE, connects that encoded target to the sampler's `latent_image`, and starts sampling at a partial schedule. Keep the collage as Picture 1 and the clean references in their existing conditioning slots for a matched comparison. Do not blur the clean references. The experiment can separately choose whether to encode the original or blurred collage as target; record that choice explicitly.

## Exact source contracts

Source paths below are relative to the ComfyUI core root or development MAINodes pack root.

| Owner | Contract |
|---|---|
| Core `comfy_extras/nodes_minimax_h3.py:681`, `PH3ImageConditioning.execute` | Each connected image is VAE-encoded into `minimax_refs`, including Picture 1. Output 0 is conditioning. Output 1 calls `_av_latent(latent_width, latent_height, 1, 2)`; it is **not** `refs[0].latent`. |
| Core same file:92, `_av_latent` | Creates zeros: video `[B,24,1,H/16,W/16]` and audio `[B,32,2,2]`, packed as `comfy.nested_tensor.NestedTensor`. |
| Core `comfy_extras/nodes_qwen.py:111`, `TextEncodeQwenImage21.execute` | Reference images enter vision and VAE `reference_latents` conditioning. Output 2 is explicit zero tensor `[1,64,H/16,W/16]` at the first reference's rounded size. Schema explicitly calls it empty. |
| Pack `web/snap/edits.js:509`, `ph3Graph` | `SamplerCustomAdvanced.latent_image = [p,1]`; ManualSigmas supplies P-H3's grid, BasicGuider and Euler. No init-target or denoise argument. |
| Pack `web/snap/edits.js:531`, `qwen21Graph` | `KSampler.latent_image = [p,2]`, denoise 1. Optional ImageScale resizes first reference before encoding. Comment “first-reference latent” means matching dimensions; it must not be read as encoded init pixels. |
| Pack `web/snap/edits.js:553`, `fizgigGraph` | Uses `FizgigH3StillLatent` or the five-frame Ref2V empty output. BasicScheduler denoise 1. It likewise does not encode Picture 1 as sampled target. |
| Core `comfy_extras/nodes_custom_sampler.py:1020`, `SamplerCustomAdvanced.execute` | Accepts noise, guider, sampler, SIGMAS and `latent_image`; it has **no denoise input**. Passes the provided samples and generated noise to `guider.sample`. |
| Core same file:17, `BasicScheduler.execute`; `comfy/samplers.py:1431`, `KSampler.set_steps` | For denoise <1, generate `int(steps/denoise)` schedule then keep final `steps+1` sigmas. These change start noise without supplying target pixels. |
| Core `comfy_extras/nodes_custom_sampler.py:204`, `SplitSigmas`; :228 `SplitSigmasDenoise` | Native way to take a suffix of existing ManualSigmas. `SplitSigmas` output 1 begins at `step`; SplitSigmasDenoise output 1 keeps `round(original_steps*denoise)` transitions. This fraction is discrete schedule-index fraction, different from H3DeropeSigmas continuous noise fraction. |
| Pack `render.py:72`, `derope_sigmas`, exposed by `H3DeropeSigmas` at :205 | Start is `model_sampling.percent_to_sigma(1-inject)`; output is `[start] + original sigmas strictly below start`. `steps=0` keeps this tail, otherwise resamples it. Continuous start, model shift aware; not a promise of the original number of sampler evaluations. |
| Core `comfy_extras/nodes_lt.py:897`, `LTXVConcatAVLatent`; :972 `LTXVSeparateAVLatent` | Generic AV split/join explicitly support H3. Separate output 1 is audio; concat inputs are `video_latent` and `audio_latent`. This preserves P-H3's audio stream while replacing only its video target. |

## Runnable graph additions

For an existing P-H3 graph using IDs `p` (conditioning), `3` (VAE), `g` (guider), `m` (ManualSigmas), `k` (sampler), add the following nodes. `collage` must be the exact final target IMAGE link at output resolution, already prepared/feathered as intended:

```json
{
  "init_encode": {"class_type":"VAEEncode","inputs":{"pixels":["collage",0],"vae":["3",0]}},
  "init_audio": {"class_type":"LTXVSeparateAVLatent","inputs":{"av_latent":["p",1]}},
  "init_av": {"class_type":"LTXVConcatAVLatent","inputs":{"video_latent":["init_encode",0],"audio_latent":["init_audio",1]}},
  "init_sigmas": {"class_type":"H3DeropeSigmas","inputs":{"model":["4",0],"sigmas":["m",0],"inject":0.7,"steps":0}}
}
```

Set `k.inputs.latent_image=["init_av",0]` and `k.inputs.sigmas=["init_sigmas",0]`. Keep RandomNoise enabled: it adds the correct noise to the supplied encoded target at the selected start. VAEEncode must use the P-H3 VAE and matching target dimensions, not a latent borrowed from the vision conditioning. An entirely native schedule alternative is `SplitSigmas {sigmas:[m,0],step:4}` → output 1. The registry P-H3 grid is `1.0,0.984753,0.967905,0.951688,0.925372,0.881923,0.810083,0.528718,0.0`; step 4 gives four transitions from 0.925372. Label this actual start and transition count rather than “50% image strength.”

For Qwen2.1: add only `VAEEncode` of the collage using `[3,0]`; set `k.inputs.latent_image` to it and `k.inputs.denoise` to e.g. 0.7. Keep the first reference and target at the same exact dimensions, preferably a multiple of 32. This is genuine init-to-collage. It uses Qwen's existing KSampler schedule convention; its number is not directly comparable to H3's continuous inject. Preserve Qwen reference conditioning and model/cache settings unchanged.

For Fizgig H3: same AV replacement pattern, split the existing sampler latent to preserve audio, then concatenate encoded one-frame target and partial sigmas. The five-frame method needs a correctly sized temporal target; avoid that path in the first experiment. No need to add a new model-specific node or change core inference.

## What Snap already supports and what is missing

`web/snap/upscale.js:112` `stillPass` already implements the needed target contract for an existing **rendered take**: LoadImage of that take → ImageScale → VAEEncode using its decode VAE → sampler target; AV models split/rejoin audio according to `methods.json`'s `av_latents`. KSampler receives denoise; custom sampler receives H3DeropeSigmas. `upscale_take {method:"stage2",factor:1,denoise:0.7}` can therefore redraw an existing successful still take at the same grid-aligned size using its own actual output as init.

That operation does **not** test init-to-original-collage: it encodes the generated take output, not Picture 1. Passing a collage as a reference, or stage2 after an initial generation, changes the experiment. `ED.fromContext` has no denoise or init-target argument; ignored extra JSON is not support. `rerun` preserves the graph/reference semantics and does not synthesize an encoded collage target.

Smallest Snap boundary addition if direct collage init is required: add optional denoise/init semantics to the existing New view route and its tool schema, resolve target from the already-loaded first picture, emit the graph additions above in the relevant graph builder, and persist the explicit init picture + schedule choice with candidate/parent provenance. Omit it by default to preserve every existing graph. Scope initially to P-H3/Qwen2.1 if those are the actual experiments; do not introduce a new core node, sampler wrapper or fake imported take. Reuse existing stillPass's AV handling and scheduler pattern. A general explicit init picture is clearer long term, but `init_from_picture_1` plus denoise is the smallest experiment-facing route if first picture is always the collage. A later generalization needs actual use, not speculation.

Do not queue a raw API side graph to evade missing Snap support: snap-core states takes made there miss Snap shot/pin/Work ownership. Build the small boundary route first or use the existing rendered-take stage2 operation with its different question clearly labeled.

## Lean comparison and limits

1. Reference-only controls: exact collage and softened collage, same cleanrefs, same seed/model/full schedule. These measure whether less pasted appearance lets cleanrefs dominate.
2. True target init: softened collage encoded as target, same conditioning as softened control, one partial start (e.g. 0.7) initially; one lower start only if the first result establishes a useful range. Keep one seed matched. Store actual sigma list and sampler calls; P-H3 has very few low-noise knots, so low inject can mean one or two updates and poor redraw.
3. Inspect the exact executed graph before spending GPU: trace sampler latent to VAEEncode collage (via AV concat for H3), trace sigma start, and verify all clean references remain conditioning. Compare final geometry, face/costume fidelity and collage seams visually; no source inspection establishes quality.

Partial denoise preserves more **pasted appearance** as well as layout; this can oppose the goal of letting cleanrefs govern costume/identity. Blur applied only to conditioning and blur applied to encoded init target answer different questions. No claim here that partial denoise improves the image, that distilled P-H3 likes every partial start, or that current :8291 has every dev node installed. Runtime node availability and actual rendered quality remain unverified.
