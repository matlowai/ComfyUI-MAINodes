# De-rope for any model (alpha)

Two things: the LTX-2.5 graphs and tools behind the public de-rope deck
(https://matlowai.github.io/flipbook/derope.html, graphs in `examples/ltx25/`),
and the any-model layer that lets one hold map drive any regenerating model
through per-model presets. Both ship on `main` as alpha; the oracle-shaped LTX
arm has not been measured yet.

## What it does today: a FLAT clock

An H3 de-rope (`H3JerkOracle` -> `H3TimeSmear` -> regenerate -> `H3ExactRecover`)
slows each frame by its own hold (1 to 4, with ramps and bridges), which is what
makes the regenerated motion land on the right frames. The LTX-2.5 graphs here
use the H3 oracle only to choose WHERE the window sits (its hot span), and inside
the window every frame is held exactly d times (`ImageBatchRepeatInterleaving`,
d = 8 or 16), padded to LTX's legal length (8k+1), regenerated from a given
starting sigma, and recovered by taking every d-th frame.

Why flat: LTX compresses time by 8, so a held frame only owns its own latent
block when its hold is a multiple of 8 frames. Holds of 1 to 4 share blocks, and
measured on two scenes that is exactly where d=8 barely responds to the denoise
dial (0.94 to 0.90 across 0.1 to 0.9) while d=16 moves it (0.90 to 0.28).

Per-pass cap: 57 source frames at d=16 (`positional_embedding_max_pos[0] = 20`
with time in absolute seconds). Full coverage of a longer clip is several
overlapping windows joined by `tools/ltx25/splice_windows.py`, which measures
PSNR across each overlap before it blends.

## The any-model layer (new nodes)

The smear, recover and audio nodes were already pixel-level and model-agnostic;
what was H3-specific was the grid law (17k+5 lengths, holds in H3 frames). That
law is now data, `model_profiles.py`, and one node applies it:

- **H3 Clock Remap (any model, presets)** - wire any hold map (H3 Jerk Oracle,
  H3 Manual Hold Map, H3 Drawn Plan), pick the model that will regenerate the
  frames. Holds of 2+ are scaled by the profile's `hold_scale` and quantised
  to whole latent time blocks; holds of 1 stay 1 (plain video anywhere). The
  output map carries the target's legal grid, so **H3 Time Smear pads to that
  grid** (LTX-2.5: 8k+1, not 17k+5) and H3 Exact Recover / H3 Audio Recover
  invert it unchanged. `minimax-h3` is the identity: existing graphs do not
  change by construction (tests assert it). The report is the price tag: frames,
  seconds at the model's fps, windows needed under its cap, and a loud
  UNMEASURED line for any profile whose numbers did not come from a ladder.
- **H3 Save Hold Map / H3 Load Hold Map (sidecar)** - write `<prefix>.holdmap.json`
  beside the render; read it back by prefix (newest wins) in another graph, so
  the H3 pass decides the clock and an LTX-2.5 or Wan 2.2 graph regenerates on
  it without both models loaded at once. Load hands back the ORIGINAL clock
  (`source_holds`), never a previous target's grid. Without it a render's clock is lost when the graph closes; with it the
  staircase ruler can read H3 arms and a later remap can retime the same plan.
- **H3 Jerk Oracle `profile_mode`: "value |d3| camera-compensated"** - aligns
  each latent frame to its predecessor by the best small integer shift before
  differencing, so a pan or scroll stops scoring as jerk (the documented cause
  of panrun dilating 124 -> 345 frames). Same compiler, different signal.

- **H3 Jerk Oracle `model_profile`** - the oracle can read ANOTHER model's
  video latent: pick the preset whose latent is wired in (LTX-2.5: 128
  channels on a 1+8k token clock; Wan 2.2: 16 channels, 1+4k). Same planner,
  that model's frame<->token mapping, no H3 phase normalisation, holds per
  source frame as before. Wrong channel counts and wrong lengths are refused
  with a message that says what was expected. `minimax-h3` is the shipped
  path, bit-identical (tested). An independent port of the three motion nodes
  onto LTX-2.3/2.5 latents appeared publicly in August 2026 and confirmed this
  is the right seam: the oracle, the smear and the recover carried over with
  only the grid law changed, which is exactly what the profile holds.

### Profiles

| id | block | hold_scale | legal | fps | cap | latent (channels, clock) | measured |
|---|---|---|---|---|---|---|---|
| `minimax-h3` | 1 | 1 | 17k+5 | 24 | VRAM | 24, (1,4,4,4,4) per 17 (H3 code path) | yes |
| `ltx-2.5` | 8 | 4 | 8k+1 | 48 (the conditioning frame_rate) | 20 s / pass = 960 frames | 128, 1+8k | yes (2026-08-21 ladder) |
| `wan-2.2 (unmeasured)` | 4 | 4 | 4k+1 | 16 | none | 16, 1+4k | NO - placeholder |

`hold_scale` is measured, never derived: LTX-2.5 needed two 8-frame blocks per
hot hold (d=16) before the dial responded at all, which its compression ratio
alone would not have told you.

### Adding a model without touching code

Pick `custom (use the fields below)` on the node and type the five numbers; the
report stamps the result unmeasured. When a row works, save it as a preset:
create `<ComfyUI user dir>/mainodes_models.json` (or point
`$MAINODES_MODELS_JSON` at a file) with

```json
{"my-model": {"name": "My Model", "block": 4, "hold_scale": 4,
              "legal": [4, 1], "fps": 16, "cap_seconds": null, "measured": false,
              "latent": {"channels": 16, "first": 1, "block": 4}}}
```

and restart: it appears in the dropdown, and a row with a preset's id
overrides that preset. Send us the row and the ladder behind it.

### First measurements (2026-08-21, one pass on two lab instances)

- H3 two-stage graph with the identity remap in the chain: **bit-identical**
  to the production render (PSNR inf on baseline, dilated and recovered).
- LTX-2.5 on the camera-compensated H3 clock at x4: panrun needs a window
  (the live clock is 1201 dilated frames at x4, over the 960 cap; a 98-frame
  window fits at 951), swordspin fits whole (866). Hold-map staircase 0.864
  (panrun) / 0.818 (swordspin) at starting sigma 0.4, against 0.80 / 0.78 for
  the uniform d=16 windows: **the oracle-shaped clock does not fix LTX's weak
  response at that denoise; the denoise is the limiter, not the clock.**
  298 s / 247 s, peak 59-60 GiB.
- Wan 2.2, first ladder cell (x1, 21-source-frame window on the densest
  hold-4 run, low-noise 14B expert, denoise 0.4, 640^2): staircase **0.693**
  on swordspin (the lowest of the set), 0.877 on panrun's window; 119-126 s
  including the model load, peak 33-52 GiB. The `wan-2.2` preset stays
  unmeasured until the x1/x2 ladder settles its hold_scale; x4 cannot fit
  Wan's 81-frame training length.
- Camera-compensated oracle: identical to the default on the static swordspin
  shot; trims panrun's held span 80 -> 76 frames.

### Sizing the oracle-shaped LTX arm

On the saved oracle profiles the x4 rule gives panrun 712 / swordspin 816
dilated frames over the hot span, under the 960-frame cap (913 was the largest legal length used), so it fits one
pass at the same cost as the uniform d=16 window with the time budget spent
where the oracle put it. That arm is the one measurement left before this
leaves alpha. The x8 rule (hold 4 -> 32x) needs two windows per scene.

## Files

- `examples/ltx25/derope_any_model_ltx25_api.json` - the any-model path on
  LTX-2.5: H3 Manual Hold Map (or an oracle) -> H3 Clock Remap (`ltx-2.5`) ->
  H3 Time Smear -> the LTX-2.5 pass -> H3 Exact Recover, with H3 Save Hold Map
  beside the render. API JSON (drag onto the canvas); the UI twin lands once
  an instance with these nodes can convert it.
- `examples/ltx25/derope_any_model_h3_oracles_api.json` - the H3 base pass with
  both oracle modes (default, camera-compensated), each saved as a sidecar, plus
  the identity remap saved beside them for a bit-exact check.
- `examples/ltx25/derope_any_model_ltx25_fromsidecar_api.json` - the whole clip
  on LTX-2.5 in ONE pass from the camera-compensated sidecar (panrun: 124 frames
  -> ~785 dilated under the 960-frame cap, quiet frames at native rate).
- `examples/wan22/derope_any_model_wan22_api.json` - the same clock on Wan 2.2
  (low-noise 14B expert, v2v from the smeared frames at denoise 0.4, 640^2,
  16 fps, 4k+1 grid from the `wan-2.2 (unmeasured)` preset): the first ladder
  cell that turns that preset's numbers into measured ones.
- `examples/ltx25/` - four graphs as run for the deck, API JSON (`*_api.json`,
  what actually executed) and UI JSON (paste on the canvas):
  `panrun_or_d16_d040` (uniform d=16 de-rope of the oracle window),
  `swordspin_or_d8_d050` (d=8), `swordspin_or_x2_d8_d050_d030` (one-pass x2
  latent upsample of a d=8 pass), `panrun_ltx_d040_full` (first of the three
  windows behind the spliced full-length clip).
  Source clips are referenced by basename: put yours in ComfyUI `input/`.
- `tools/ltx25/mint_ltx25_derope.py` - mints a uniform de-rope graph from the
  stock LTX-2.5 T2V template (`--frames --fps --dilation --seed ...`).
- `tools/ltx25/mint_ltx25.py` - the plain LTX-2.5 graph minter the ladder used.
- `tools/ltx25/ltx25_oracle_window.py` - reads a saved H3 oracle profile and
  returns the legal LTX window over its hot span.
- `tools/ltx25/splice_windows.py` - joins window renders, checking alignment.
- `tools/ltx25/ui2api.py` - the UI -> API converter the minters depend on.

Model files are the stock Comfy-Org LTX-2.5 set (22B transformer, its VAE and
audio VAE, the x2 latent upsampler) plus the MiniMax-H3 set for the H3 arms.
