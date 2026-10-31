# Dials (alpha)

Training-free steering for MiniMax H3, made from prompt pairs. Write two prompts that differ in one quality
(*"stands perfectly still"* vs *"runs across the scene"*); Make Dial turns the difference into a ~14 KB file that
works like a strength slider. Negative strength moves every generation toward the first prompt, positive toward the
second. Ported from [ComfyUI-Dials](https://github.com/matlowai/ComfyUI-Dials); this is where new Dials work happens.

## Nodes (category MAINodes/Dials)

| node | what it does |
|---|---|
| **Dial Rack** | Any number of dials on one model. One row per dial: on/off, dial, strength (slider and number), solo. **+ Add dial** adds a row; dials wired into the `dial_N` inputs (straight from Make Dial) appear as rows too. After a run the node shows each dial's size, the combined shift, and dials that overlap (reinforce or cancel). |
| **Make Dial** | Prompt pairs (`A ||| B` per line, `{subject}` expanded over a subjects list) to a dial. Saves to `models/loras/dials/<name>.safetensors` and outputs the dial for a rack input. Shows pair agreement (above 0.6 is a clean direction) and how much generic wording shift was removed. |
| **Combine Dials** | `weight_a * a + weight_b * b` as one new dial, optionally removing b's direction from a first (orthogonalize). Plain mixing is easier in the rack. |

**Strength:** +0.5 to +1 is the everyday range. Past about 1.5 side effects appear (the scene restages, characters
morph), and on Pika H3 Flex's 6-step schedule even sooner. The motion dial at −2 and +2 shows the extremes.

**Rack = chain:** the rack applies its rows in order with exactly the patches a chain of single-dial nodes makes, so
one rack is bit-for-bit the same as that chain (`tests/test_dial_rack.py`). Off rows, zero-strength rows and
non-solo rows while something is soloed change nothing; a rack with nothing active returns the model untouched.

**Dial files** live in `models/loras/dials/`. The dial library is on Hugging Face:
[MATLOWAI/H3-Dials](https://huggingface.co/MATLOWAI/H3-Dials). Folders starting with `_` are not listed (park
retired dials there). The file format, the folder and the DIAL socket type are shared with ComfyUI-Dials, so both
packs can be installed side by side (node ids differ: `MAIDial*` here, `Dials*` there) and use each other's dials.

Two kinds of dial file:
- **hook** (`post_refiner`, the default): added after H3's token refiner, where the DiT reads the prompt. The most
  faithful; use these in the rack.
- **LoRA file** (`pre_refiner`): a `condition_proj` bias diff the stock *Load LoRA (model only)* node also applies.
  Only an approximation of the hook; above ~1 it starts to wash out the prompt.

## Writing good pairs

- Keep A and B identical except for the one quality you want.
- Use `{subject}` with 4–8 varied subjects (no children for face or body dials).
- Describe the effect you actually want, in place. Pairs teach *literally*: "runs past the camera" teaches subjects to
  leave the frame.
- Dials steer H3's audio too: a mood dial can change voices (sinister crushes speech); check dialogue scenes by ear.

## License

The node code is GPL-3.0 with the rest of this pack. Dial weight files are Model Derivatives of MiniMax H3 and fall
under the MiniMax H3 Community License Agreement (see the H3-Dials repository for the Agreement and NOTICE).
Powered by MiniMax H3.
