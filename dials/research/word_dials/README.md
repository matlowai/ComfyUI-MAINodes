# Word dials (research release, 2026-11-06)

Dials made from **four words and no prompt pairs**, using the Jacobian lens on H3's text encoder
([how and why](../experiments/J1-J3-word-dials.md), [clips with sound](https://matlowai.github.io/ComfyUI-Dials/words.html)).
Joint work with [fredbliss](https://github.com/fblissjr), who brought the Jacobian lens to H3; this is our own
reimplementation.

## Use them

Copy the `.safetensors` files into `ComfyUI/models/loras/dials/` and pick them in the Dial Rack like any other dial
(post-refiner hook, MiniMax H3). Every file is scaled to the size of `h3_evil_sinister`, so strength 1 is a typical push;
the clips used **+2**. Each file's metadata (`word_dial`) records its words and recipe.

| file | words | seen at +2 (one seed, train scene) |
|---|---|---|
| `h3_jc_underwater` | underwater, submerged, bubbles, aquatic | **water appears**: a harbourside, boats, the train ploughing through water |
| `h3_jc_thunder` | thunder, roar, crash, boom | **soundtrack ~21 dB louder than the placebo**, twice the low end; windswept |
| `h3_jc_stainedglass` | stained, glass, cathedral, mosaic | a grand glass-vaulted station hall |
| `h3_jc_origami` | origami, folded, paper, crease | the scene moves to a Japanese station |
| `h3_jc_hush` | whisper, hush, silence, quiet | quieter, but only ~7 dB beyond the placebo |
| `h3_jc_static` | static, signal, broadcast, interference | a colder blue hour |
| `h3_jc_vertigo` | vertigo, dizzy, spinning, tilt | little effect |
| `h3_jc_biolum` | bioluminescent, glowing, phosphorescent, jellyfish | no glow |
| `h3_jc_rust` | rust, corrosion, decay, patina | not rendered alone; nothing in a combo |
| `h3_jc_honey` | honey, amber, syrup, golden | not rendered yet |
| `h3_jc_still` | still, frozen, motionless, calm | not rendered yet |
| `h3_jc_bland` | table, number, between, also | **placebo**: compare everything against it |

**Always render the placebo at the same strength.** A dial this size reshuffles any scene and (at +2) quiets the
soundtrack by ~9 dB whatever its words mean. What the placebo doesn't do is what your word dial does.

Caveats: one scene, one seed per finding. The files are **centered** against the mean of these 12 lists, so they belong
together as a set; a new list made later is centered differently (see "Make your own").

## Make your own

`../code/dials_word_dial.py` builds word dials from your own lists. You need:
- the H3 models (`minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` text encoder, an H3 FL2VA DiT);
- the upstream **Qwen3-VL-32B-Instruct** shards 11-14 plus `config.json` and `model.safetensors.index.json` (~17 GB),
  e.g. `hf download Qwen/Qwen3-VL-32B-Instruct config.json model.safetensors.index.json model-00011-of-00014.safetensors
  model-00012-of-00014.safetensors model-00013-of-00014.safetensors model-00014-of-00014.safetensors --local-dir <dir>`.
  H3's encoder is upstream's first 50 layers (checked bit for bit on the overlap), and these shards hold the last layers
  and output head that H3 does not ship;
- a large GPU: we ran it on one 96 GB card (the encoder, the 14-layer tail in bf16 and the DiT load one after another);
  smaller cards are untested.

From the ComfyUI root:

```
python custom_nodes/ComfyUI-MAINodes/dials/research/code/dials_word_dial.py --method jlens \
  --tail <dir>/model-00014-of-00014.safetensors --out my_words.json --save --center \
  --lists "lava=lava,molten,magma,glowing" "fog=fog,mist,haze,murky" "bland=table,number,between,also"
```

This writes raw `h3_j_<name>` dials and, with `--center`, the usable `h3_jc_<name>` ones: each list minus the mean of
all the lists in that run, rescaled. Always include a bland list: it is both your placebo and part of the centering. Use several lists (we used 12): with
only two or three, the mean still holds much of each concept and centering removes part of it. The
raw dials share one big "any word" direction and do little on their own. Centering against a large neutral vocabulary,
so that each list stands alone, is the next improvement ([PLAN](../PLAN.md), J track).

License: dial files are Model Derivatives of MiniMax H3 under the MiniMax H3 Community License Agreement.
