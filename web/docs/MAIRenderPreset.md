# Render Preset

The render recipe of the Simple front door in one node. A **preset** is the whole recipe, and picking one changes every
field together:

| field | what it sets |
|---|---|
| model, lora, lora_strength | the MiniMax H3 diffusion model and an optional LoRA (model only) |
| shift_video, shift_audio | the flow shifts (core's ModelSamplingMiniMaxH3): H3 is 12 / 3 |
| conditioning | **FL2V** (prompt + optional first frame) or **Ref2V** (prompt naming `<Picture 1>`, `<Picture 2>` + reference pictures) |
| sampler | the sampler for both stages |
| schedule, sigmas, steps | stage 1: `manual` uses the sigma list (another step count resamples it, untested), any other choice is that ComfyUI scheduler with `steps` on the model's shift |
| derope_steps | stage 2: 0 = auto (the stage-1 sigmas below the de-rope amount); a number resamples that tail |
| cfg | 1 for distilled LoRAs; above 1 the blueprint guides against a zeroed copy of the prompt (untested) |

Built in:
- **Pika H3 Flex**: FL2VA int8 + Pika H3 Flex LoRA, `lcm`, Pika's six manual sigmas `1.0, 0.972973, 0.923077, 0.8,
  0.571429, 0.333333, 0.0`, shifts 12 / 3, cfg 1. De-rope at 0.48: `0.9172, 0.8, 0.5714, 0.3333, 0` (4 steps).
- **Pika + reference pictures**: the same with Ref2V.
- **DMAD speed LoRA**: FL2VA int8 + the DMAD 4-step LoRA (Kijai's rank-39 conversion) at **0.8**, `lcm`, `simple`
  **6 steps** (`1, 0.984, 0.96, 0.923, 0.857, 0.706, 0`), shifts 12 / 2, cfg 1. De-rope at 0.48: `0.917, 0.857, 0.706, 0`
  (3 steps). The DMAD authors recommend LoRA 1.0 and 4 steps (`lcm` re-noises the way the students were trained; they
  were trained at audio shift 2); the Banodoco community runs 0.8 with 5-6 steps. On our train-platform test (1 seed) 0.8 /
  6 was the crisper of the two in both passes; at 1.0 / 4 the de-rope tail is only `0.917, 0.8, 0` and came out soft
  (setting de-rope steps to 4 fixed that). Other samplers people use with DMAD: `euler` / `simple`, `er_sde` / `simple`,
  `euler` / `beta57`. DMAD was trained on text-to-AV; FL2V/Ref2V and partial denoise (de-rope) are not the paper's setting.

**Your own presets:** change the fields and type a name (letters, digits, `_`, `-`), then **Save as**. They are saved in
`models/loras/dials/presets/render/<name>.json` and never overwritten; **↻** reloads the list. Set the sampler, schedule
and steps together with the LoRA: a distilled LoRA works only on the schedule it was distilled for, and stage 2 (de-rope)
uses the same sampler and a tail of the same schedule.

The node only ever reads its fields, so a queued workflow does not depend on preset files. Shipped presets name plain
file names; when your copy sits in a sub-folder (e.g. `h3/`), picking the preset uses it.

Outputs: `MODEL` (into the Dial Rack), and `sampler`, `sigmas`, `derope_steps`, `conditioning`, `cfg` into the
**Dials - H3 + De-rope** blueprint.
