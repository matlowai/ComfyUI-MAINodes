# Dials (alpha)

Training-free steering for MiniMax H3, made from prompt pairs. Write two prompts that differ in one quality
(*"stands perfectly still"* vs *"runs across the scene"*); Make Dial turns the difference into a ~14 KB file that
works like a strength slider. Negative strength moves every generation toward the first prompt, positive toward the
second. Ported from [ComfyUI-Dials](https://github.com/matlowai/ComfyUI-Dials); this is where new Dials work happens.

## Nodes (category MAINodes/Dials)

| node | what it does |
|---|---|
| **Dial Rack** | Any number of dials on one model. One row per dial: on/off, dial, strength (slider and number), solo, **H** to hold a direction. **+ Add dial** adds a row; dials wired into the `dial_N` inputs (straight from Make Dial) appear as rows too. After a run the node shows each dial's size, the combined shift, and dials that overlap (reinforce or cancel). A **Pad** moves two rows together on a 2D square (the dot is your prompt). |
| **Make Dial** | Prompt pairs (`A ||| B` per line, `{subject}` expanded over a subjects list) to a dial. Saves to `models/loras/dials/<name>.safetensors` and outputs the dial for a rack input. Shows pair agreement (above 0.6 is a clean direction) and how much generic wording shift was removed. Also takes weighted pairs (`A ||| B :: 2`) and prompt sets (`+1 …` / `-1 …` lines). |
| **Combine Dials** | `weight_a * a + weight_b * b` as one new dial, optionally removing b's direction from a first (orthogonalize). Plain mixing is easier in the rack. |
| **Make Dial from Pictures** | Two image batches and one shared prompt to a post-refiner dial. Negative strength moves toward A, positive toward B. Equal batch sizes pair by index for agreement; unequal sizes use side means and report agreement as n/a. Saves and connects to the rack like Make Dial. |
| **Make Dial from Videos** | Matched clips (up to 12 per side) and one shared prompt to a post-refiner dial; clips are sampled at 2 fps and cut to equal length. Experimental. |

**Strength:** +0.5 to +1 is the everyday range. Past about 1.5 side effects appear (the scene restages, characters
morph), and on Pika H3 Flex's 6-step schedule even sooner. The motion dial at −2 and +2 shows the extremes.

**Rack = chain without holds or envelopes:** the rack applies its rows in order with exactly the patches a chain of
single-dial nodes makes, so one rack is bit-for-bit the same as that chain (`tests/test_dial_rack.py`). Off rows, zero-strength rows and
non-solo rows while something is soloed change nothing; a rack with nothing active returns the model untouched.

**Hold rows:** toggle **H** to remove that dial's direction from the sum of the rack's active post-refiner shifts.
Hold directions are orthonormalized together before projection, then the rack installs one combined post shift.
Duplicate or zero directions add no constraint. Holds follow on/off and solo; their strength is ignored (even zero),
and the disabled strength controls retain the value for when H is turned off. A rack containing only holds changes
nothing. Pre-refiner dials cannot be hold rows; ordinary pre-refiner rows still apply as usual. Holds affect this
rack's post shift, including cancellation between its rows; they do not remove upstream patches or guarantee that
H3 leaves the corresponding visual/audio quality unchanged. The report gives the remaining shift and each hold's
share of the original summed shift's squared norm removed, crediting overlapping holds in row order.
Hold rows and explicit step envelopes cannot share a rack; use constant rows with no `envelope` field for holds.

**Dial files** live in `models/loras/dials/`. The dial library is on Hugging Face:
[MATLOWAI/H3-Dials](https://huggingface.co/MATLOWAI/H3-Dials). Folders starting with `_` are not listed (park
retired dials there). The file format, the folder and the DIAL socket type are shared with ComfyUI-Dials, so both
packs can be installed side by side (node ids differ: `MAIDial*` here, `Dials*` there) and use each other's dials.

Two kinds of dial file:
- **hook** (`post_refiner`, the default): added after H3's token refiner, where the DiT reads the prompt. The most
  faithful; use these in the rack.
- **LoRA file** (`pre_refiner`): a `condition_proj` bias diff the stock *Load LoRA (model only)* node also applies.
  Only an approximation of the hook; above ~1 it starts to wash out the prompt.

**Rack presets:** use **Save preset** / **Load preset** in the rack bar. Presets live in
`models/loras/dials/presets/<name>.json`, with format `MAIDialRack preset`, version `1`, and ordered rows containing
`dial`, `sha256`, `strength`, `on`, and `solo`, plus optional `hold` (absent means false) and `envelope`. They store file references
and settings, never weights. Names accept letters, digits, `_` and `-` (1–80 characters); saving requires a new name. Loading warns about missing files or
changed SHA-256 hashes and keeps every row, including off/solo settings; absent files remain marked **(missing)**.
Presets use saved files: save wired dials and select their files before saving a preset, and disconnect wired dials
before loading one. Save under a new name to accept changed files' current hashes.

## The pad: drag your prompt

**Pad** in the rack bar opens a square where two rows (picked as X and Y) move together. The dot is your prompt:
dragging it sets both strengths. **Shift+drag** moves at a fifth of the speed for careful nudging, arrow keys step
by 0.05 (Shift: 0.25), and a double-click puts both back to 0. Rings mark the everyday range (strength 1) and where
side effects start (1.5). The readout gives both strengths, how much the two dials overlap (cosine), and the
combined push in units of "one dial at +1", measured from the dial files, so you can see when two reinforcing dials
add up to more than either looks. **Sweep 3×3** queues nine renders on a grid around the dot (spacing set by
*sweep step*) and then puts the dot back. The pad's settings are saved with the workflow and never reach the backend;
it only edits the two rows' strengths. Wired `dial_N` rows can be axes but have no file to measure.

## Example workflows

These complete text-to-video graphs use one Dial Rack, seed 42, an adult kitchen scene, and video plus audio output.

| Example | UI workflow | API graph | Settings |
|---|---|---|---|
| One dial | [one_dial.json](../examples/dials/one_dial.json) | [one_dial_api.json](../examples/dials/one_dial_api.json) | Base H3, motion +1, 20-step `res_multistep`, 832×480, 124 frames |
| Four dials | [four_dials.json](../examples/dials/four_dials.json) | [four_dials_api.json](../examples/dials/four_dials_api.json) | Base H3, motion +0.5 / dread +1 / warm–cold −0.5 / reserved–lively +0.5, same 20-step settings |
| Pika rack | [pika_rack.json](../examples/dials/pika_rack.json) | [pika_rack_api.json](../examples/dials/pika_rack_api.json) | Same four rows, Pika H3 Flex LoRA +1, 6-step LCM with manual sigmas, 1280×704, 141 frames |

All run at 24 fps and save MP4s under `output/video/dials/`. The graphs use the local `h3/` subfolder in
`models/diffusion_models`, `models/text_encoders`, `models/vae`, and (Pika only) `models/loras`; adjust the loader
filenames to your installation. They require the H3 model, Qwen3-VL text encoder, video/audio VAEs, and the selected
dial files in `models/loras/dials/`. The four-row examples also require the warm–cold and reserved–lively candidate
dials from pack 2. ComfyUI-Dials nodes are not required. No weights are included in the workflows.

Drag a UI workflow into ComfyUI, select your local files, and queue it. To queue an API graph, POST
`{"prompt": <contents of the API JSON>}` to your ComfyUI server's `/prompt` endpoint.
Keep the four-row order when reproducing a result: reordering post-refiner additions can change the generated video.

## Step envelopes

Each rack row can shape its strength across denoising: **constant**, **early** (falls to zero by the midpoint),
**late** (rises from zero after the midpoint), **bell** (a triangular middle peak), or **manual** `[progress, gain]`
points. Gains multiply the row's strength; they are not automatically normalized. Manual points interpolate linearly
and hold their endpoint values outside the specified range. Progress runs from 0 at the first model step to 1 at
the last, excluding the terminal sigma; a one-step schedule uses progress 0. This controls denoising, not video time.
Progress is measured within each sampler call: with two sampler stages (split sigmas, or a second pass at
denoise < 1) the envelope is applied to each stage on its own.

Envelopes support **post-refiner** dials. H3 caches refined text before sampling, so an enveloped rack shifts that
cached context at each diffusion-model call. It compiles against the actual sampler sigmas at sample time, uses the
same strength for repeated CFG calls at one sigma, and interpolates between compiled strengths for intermediate
solver evaluations. All post rows in that rack keep their addition order, including constant rows. An absent
envelope keeps the original hook path when no upstream rack is scheduled; an explicit constant envelope has the
same tensor result. Zero-gain steps skip addition. Pre-refiner rows can coexist but cannot have envelopes.

The rack report updates when sampling starts with the sigma schedule and evaluated per-step strengths (a
`mai-dial-envelope` WebSocket event carrying that text); the earlier API history preview says the values are pending. Each sampler run
compiles its own wrapper, so reused models and cloned workflows do not share a step counter or cached schedule.
Keep scheduled and constant post rows in racks: an external Apply Dial node downstream still changes H3's cached
text before envelope evaluation and can therefore change bf16 addition order.

API row examples (the `envelope` field is optional):

```json
[
  {"dial": "dials/h3_motion.safetensors", "strength": 1, "on": true, "envelope": "early"},
  {"input": "dial_0", "strength": 0.5, "envelope": {"type": "manual", "points": [[0, 0], [0.5, 1], [1, 0]]}}
]
```

CPU parity and lifecycle checks: `tests/test_dial_envelopes.py`. A constant envelope reproduces the plain hook in a
real render (pixel difference 0). **What envelopes do on Pika H3 Flex (6 steps), so far:** prompt-side dials act only in
the first steps. A late envelope at +2 and even +8 left dream, claymation, underwater and day/night renders unchanged,
and for the motion dial constant beat every other shape per unit of gain. An early envelope at high strength (+6)
scrambles the scene in a dial-specific direction, which can be a creative tool but is not a controlled edit. Base H3's
longer schedules are untested.

## Writing good pairs

- Keep A and B identical except for the one quality you want.
- Use `{subject}` with 4–8 varied subjects (no children for face or body dials).
- Describe the effect you actually want, in place. Pairs teach *literally*: "runs past the camera" teaches subjects to
  leave the frame.
- Dials steer H3's audio too: a mood dial can change voices (sinister crushes speech); check dialogue scenes by ear.

## Prompt sets and pair weights

- **`A ||| B :: 2`** counts that pair twice in the mean (any non-zero number; hold pairs take no weight).
- **Prompt sets:** lines `+w prompt` and `-w prompt` (w defaults to 1, the sign goes in front) build the dial from more
  than two prompts: the weighted mean of the `+` prompts minus the weighted mean of the `-` prompts, e.g.

  ```
  +2 {subject} walks through rain at night
  +1 {subject} under flickering neon signs
  -1 {subject} in bright midday sun
  ```

  One `+1` and one `-1` line give exactly the plain pair `A ||| B`; the example equals the weighted pairs
  `midday ||| rain :: 2` and `midday ||| neon :: 1`. `{subject}` expands as usual (one set per subject), sets combine
  with ordinary pairs, and word weights work inside set prompts. A set needs at least one `+` and one `-` line.

## Hold pairs and word weights

Two extras in Make Dial's pair text (not in ComfyUI-Dials):

- **`! A ||| B` holds a quality.** Lines starting with `!` are averaged into one direction that is projected out of
  the dial, so the dial cannot move that quality. Example: the expressive-face pairs plus
  `! {subject} speaks at a low volume. ||| {subject} speaks at a high volume.` give a face dial that leaves loudness
  alone (the plain face dial shares cos 0.45 with loudness). The report says how much of the dial the hold removed.
  This is linear: it removes the held direction from the vector, and H3 may still couple the two qualities downstream.
  Use **`![loudness] A ||| B`**, **`![motion] A ||| B`**, etc. to hold several qualities: each group's pairs average
  into its own direction. Bare `!` lines form the unnamed group `""`. Multiple directions are orthonormalized with
  the nuisance basis using QR; redundant or zero directions add no constraint. One group preserves the original
  calculation bit for bit. The report and saved metadata give each group's share of the debiased dial's squared
  norm removed; overlapping groups are credited in first-appearance order (a redundant later group gets 0%).
  Measured with one loudness hold on Pika (kitchen line, 3 seeds): the face dial at +1 raises voice level +4.8 dB;
  with loudness held, +1.7 dB and the faces stay animated.
- **`(words:w)` weighs words.** Inside A or B, the words count `w` times what they add to the text around them
  (`enc(text without them) + w * (enc(text) - enc(text without them))`, on token means). Useful for tilting a mix
  within one side, e.g. `{subject} talks with an (expressive:2) face, (eyebrows raised:0.5)`, or a negative weight to
  subtract a word's pull. A single weighted span on one side just scales the whole dial (same as strength), and
  spans add independently (no interaction terms). H3's own prompt box ignores this syntax: ComfyUI tokenizes H3
  prompts with weights disabled, so `(quiet:2)` in a normal prompt reaches the model as literal text.

## Video pairs

Connect matched clips from **Load Video** to **Make Dial from Videos** (`MAIDialMakeFromVideos`), with up to
12 inputs per side. Inputs pair by numeric suffix within each side. The shared prompt defaults to
`A video in the style and content of <Video 1>.`. Clips are sampled at 2 fps with source timestamps (lower-rate
clips retain their native rate), shrunk to the canvas ComfyUI's H3 reference videos use, and every clip is cut to the
same number of samples (the shortest clip's, at most 16 = 8 s), so the timestamp tokens are identical on both sides
and clip length cannot leak into the dial. Audio is excluded. The full sequence passes through the text projection
and refiner before pooling text-tag positions, including video labels and timestamps. Each clip has equal weight.
Negative strength moves toward A and positive toward B. Equal counts report indexed pair agreement; unequal
counts use side means with agreement n/a. The same generic wording debiasing applies as for picture pairs.
Keep framing, subjects, duration and frame rate matched, changing only the quality to steer. Load Video decodes the
whole clip before sampling, so trim long or high-resolution clips first. CPU contracts: `tests/test_dial_videos.py`.
**Measured so far:** a real-time vs timelapse dial from two generated pairs made no clear timelapse at +2 (1 seed);
the pairs also differed in framing and light. Treat this node as an experiment.

## Picture pairs

Connect two IMAGE batches to **Make Dial from Pictures** (`MAIDialMakeFromPictures`) with the H3 CLIP and MODEL.
Use the same framing, light and background at each index, changing only the quality to steer. The default prompt is
`A video in the style and content of <Picture 1>.`; it is used unchanged for every picture on both sides. Each picture
is encoded separately as an H3 reference image. The full sequence passes through the projection and token refiner,
then only text positions (`minimax_token_tags == 1`) contribute to its mean. Each picture has equal weight, regardless
of token count. The dial is B minus A, with Make Dial's generic wording debiasing enabled by default.

This node makes hook dials only. No image VAE is needed. Pictures with a short edge above 2048 px are shrunk as
ComfyUI's H3 reference images are. A missing text-token tag map is an error; vision tokens are never silently included
in the mean. CPU checks with a tagged fake encoder: `tests/test_dial_pictures.py`. **Measured so far:** a lizard vs
squirrel dial from 12 generated photo pairs points 0.49 the same way as the text dial but is 0.6x its size, and did
not reach a lizard by -3 where the text dial did by -2 (1 seed); it has not yet been tried at matched size.

## License

The node code is GPL-3.0-or-later with the rest of this pack. It started as a port of ComfyUI-Dials (AGPL-3.0, same
author), which stays as it is; the code here is released under this pack's GPL. Dial weight files are Model Derivatives of MiniMax H3 and fall
under the MiniMax H3 Community License Agreement (see the H3-Dials repository for the Agreement and NOTICE).
Powered by MiniMax H3.
