# Dials (alpha)

Training-free steering for MiniMax H3, made from prompt pairs. Write two prompts that differ in one quality
(*"stands perfectly still"* vs *"runs across the scene"*); Make Dial turns the difference into a ~14 KB file that
works like a strength slider. Negative strength moves every generation toward the first prompt, positive toward the
second. Ported from [ComfyUI-Dials](https://github.com/matlowai/ComfyUI-Dials); this is where new Dials work happens.

## Nodes (category MAINodes/Dials)

| node | what it does |
|---|---|
| **Dial Rack** | Any number of dials on one model. One row per dial: on/off, dial, strength (slider and number), solo, **H** to hold a direction. **+ Add dial** adds a row; dials wired into the `dial_N` inputs (straight from Make Dial) appear as rows too. After a run the node shows each dial's size, the combined shift, and dials that overlap (reinforce or cancel). |
| **Make Dial** | Prompt pairs (`A ||| B` per line, `{subject}` expanded over a subjects list) to a dial. Saves to `models/loras/dials/<name>.safetensors` and outputs the dial for a rack input. Shows pair agreement (above 0.6 is a clean direction) and how much generic wording shift was removed. |
| **Combine Dials** | `weight_a * a + weight_b * b` as one new dial, optionally removing b's direction from a first (orthogonalize). Plain mixing is easier in the rack. |

**Strength:** +0.5 to +1 is the everyday range. Past about 1.5 side effects appear (the scene restages, characters
morph), and on Pika H3 Flex's 6-step schedule even sooner. The motion dial at −2 and +2 shows the extremes.

**Rack = chain without holds:** the rack applies its rows in order with exactly the patches a chain of single-dial
nodes makes, so one rack is bit-for-bit the same as that chain (`tests/test_dial_rack.py`). Off rows, zero-strength rows and
non-solo rows while something is soloed change nothing; a rack with nothing active returns the model untouched.

**Hold rows:** toggle **H** to remove that dial's direction from the sum of the rack's active post-refiner shifts.
Hold directions are orthonormalized together before projection, then the rack installs one combined post shift.
Duplicate or zero directions add no constraint. Holds follow on/off and solo; their strength is ignored (even zero),
and the disabled strength controls retain the value for when H is turned off. A rack containing only holds changes
nothing. Pre-refiner dials cannot be hold rows; ordinary pre-refiner rows still apply as usual. Holds affect this
rack's post shift, including cancellation between its rows; they do not remove upstream patches or guarantee that
H3 leaves the corresponding visual/audio quality unchanged. The report gives the remaining shift and each hold's
share of the original summed shift's squared norm removed, crediting overlapping holds in row order.

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
`dial`, `sha256`, `strength`, `on`, and `solo`, plus optional `hold` (absent means false). They store file references
and settings, never weights. Names accept letters, digits, `_` and `-` (1–80 characters); saving requires a new name. Loading warns about missing files or
changed SHA-256 hashes and keeps every row, including off/solo settings; absent files remain marked **(missing)**.
Presets use saved files: save wired dials and select their files before saving a preset, and disconnect wired dials
before loading one. Save under a new name to accept changed files' current hashes.

## Example workflows

These complete text-to-video graphs use one Dial Rack, seed 42, an adult kitchen scene, and video plus audio output.

| Example | API graph | Settings |
|---|---|---|
| One dial | [one_dial_api.json](../examples/dials/one_dial_api.json) | Base H3, motion +1, 20-step `res_multistep`, 832×480, 124 frames |
| Four dials | [four_dials_api.json](../examples/dials/four_dials_api.json) | Base H3, motion +0.5 / dread +1 / warm–cold −0.5 / reserved–lively +0.5, same 20-step settings |
| Pika rack | [pika_rack_api.json](../examples/dials/pika_rack_api.json) | Same four rows, Pika H3 Flex LoRA +1, 6-step LCM with manual sigmas, 1280×704, 141 frames |

All run at 24 fps and save MP4s under `output/video/dials/`. The graphs use the local `h3/` subfolder in
`models/diffusion_models`, `models/text_encoders`, `models/vae`, and (Pika only) `models/loras`; adjust the loader
filenames to your installation. They require the H3 model, Qwen3-VL text encoder, video/audio VAEs, and the selected
dial files in `models/loras/dials/`. The four-row examples also require the warm–cold and reserved–lively candidate
dials from pack 2. ComfyUI-Dials nodes are not required. No weights are included in the workflows.

To queue an API graph, POST `{"prompt": <contents of the API JSON>}` to your ComfyUI server's `/prompt` endpoint.
Keep the four-row order when reproducing a result: reordering post-refiner additions can change the generated video.

## Writing good pairs

- Keep A and B identical except for the one quality you want.
- Use `{subject}` with 4–8 varied subjects (no children for face or body dials).
- Describe the effect you actually want, in place. Pairs teach *literally*: "runs past the camera" teaches subjects to
  leave the frame.
- Dials steer H3's audio too: a mood dial can change voices (sinister crushes speech); check dialogue scenes by ear.

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

## License

The node code is GPL-3.0 with the rest of this pack. Dial weight files are Model Derivatives of MiniMax H3 and fall
under the MiniMax H3 Community License Agreement (see the H3-Dials repository for the Agreement and NOTICE).
Powered by MiniMax H3.
