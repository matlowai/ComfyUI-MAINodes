# ComfyUI-MAINodes

Custom nodes for MiniMax H3 video. Three parts:

- **Motion Lab** fixes fast-motion smear (backflips, sword arcs, whip-fast
  turns) at inference time by re-rendering the clip as a slowed-down copy of
  itself and dropping the held frames afterward. No extra model, no training.
- **Dials** (alpha) are training-free steering sliders: make one from two
  prompts or two groups of pictures, stack them in a Dial Rack, and change
  them over the clip. Also runs on MOSS-Image, and with limits on Krea 2.
- **Contact-Sheet diffusion** makes five views of one subject from one
  reference image.

Around them: a video compare player, low-VRAM nodes for 16 to 24 GB cards,
and research nodes marked `(alpha)`.

![baseline vs inject 0.70 vs inject 0.50](assets/kitsune_threeway.gif)

The baseline (left) smears the aerial spin; the two de-roped versions keep
it clean with the same choreography. Default settings, no per-clip tuning.
More demos: [Motion Lab page](https://matlowai.github.io/ComfyUI-MAINodes/),
[Dials page](https://matlowai.github.io/ComfyUI-Dials/).

Like it? A star helps. Want to feed the GPU? [Sponsor the experiments](#support-mainodes).

## Start here

| you want to | start from | read |
|---|---|---|
| fix smeared fast motion | [`examples/motion_pipeline_ref2va_audioinit.json`](examples/motion_pipeline_ref2va_audioinit.json) | [Motion Lab](docs/MOTION_LAB.md), [`TUNING.md`](TUNING.md) |
| steer look, mood or motion with sliders | [`examples/dials/dials_simple_pika_derope.json`](examples/dials/dials_simple_pika_derope.json) | [`dials/README.md`](dials/README.md) |
| five views of one subject | [`examples/contact_sheet.json`](examples/contact_sheet.json) | [below](#contact-sheet-diffusion) |
| run on a 16 to 24 GB card | [`examples/motion_pipeline_lowvram.json`](examples/motion_pipeline_lowvram.json) | [`LOWVRAM.md`](LOWVRAM.md), [`HARDWARE.md`](HARDWARE.md) |
| compare renders side by side | the **MAI Video Compare** node | [`VIDEO_TOOLS.md`](VIDEO_TOOLS.md) |
| pick among all the graphs | | [`examples/README.md`](examples/README.md) |

Every graph comes as `name.json` (drag onto the canvas) and usually
`name_api.json` (the same graph for scripts). Most Motion Lab graphs need
[ComfyUI-KJNodes](#install).

## Motion Lab (de-rope)

One latent token spans four video frames, and at high speed those four
frames need four poses one token cannot hold, so H3 smears. The pipeline
reads where motion runs too hot from the clip's own latent (the oracle),
holds those frames so the model has room, regenerates video-to-video from
that slowed init at partial denoise, and recovers the original frame rate
by exact frame selection.

```
(baseline video) -> VAEDecode frames        (baseline latent)
        |                                        |
        v                                        v
   H3TimeSmear  <-- hold_map ------------- H3JerkOracle
        |  (integer holds)                       |
        v                                        |
    VAEEncode -> H3V2VInit -> SamplerCustomAdvanced
                                  ^
              H3InjectSchedule ---/
                                  |
                              VAEDecode -> H3ExactRecover -> original fps
```

**Start from**
[`motion_pipeline_ref2va_audioinit.json`](examples/motion_pipeline_ref2va_audioinit.json):
pass 1 at 12 steps on the base model, the turbo LoRA at 6 steps for the
de-rope, dialogue kept intact by the audio init. 192 frames at 1 MP take
**about 12 minutes** end to end on an RTX PRO 6000 (36 for 25 steps both
passes without turbo). Reach for `inject` (0.50 sharper, 0.70 safer)
before any other setting, and try a 2 to 3 second clip first.

The full guide, with every graph, node table, timing table and the alpha
features (repair, window mode, DyRoPE, chaining, the editor), is
[`docs/MOTION_LAB.md`](docs/MOTION_LAB.md).

## Dials (alpha)

Training-free steering sliders for MiniMax H3 (also MOSS-Image, and Krea 2 with limits). A **dial** is a ~14 KB file
made from the difference between two prompts (or two groups of pictures); a negative strength pushes every generation
toward the first side, a positive one toward the second. No training, about a minute to make one. Stack them in a
**Dial Rack**, see how they interact, and vary them over the clip. Full guide: [`dials/README.md`](dials/README.md);
what we learned: [`dials/LESSONS.md`](dials/LESSONS.md); what's next: [`dials/ROADMAP.md`](dials/ROADMAP.md);
dial library on [Hugging Face](https://huggingface.co/MATLOWAI/H3-Dials). **See it in action:** the
[Dials project page and demo video](https://matlowai.github.io/ComfyUI-Dials/). The original stable release, with the
simple Load/Apply Dial nodes, is [ComfyUI-Dials](https://github.com/matlowai/ComfyUI-Dials); both packs share the same dial files.

**What you can do with them**

| capability | what it gives you |
|---|---|
| **Make a dial from prompts** | `A ||| B` pairs, prompt sets with weights, hold pairs (`!`) that keep a quality fixed |
| **Make a dial from pictures or clips** | two groups of pictures of any size (or matched video clips); pick how they are read: `content`, `look`, `bare`, `all averaged` or your own sentence |
| **Dial Rack** | any number of dials on one model: on/off, strength, solo, and **H** to hold a direction out of the mix. Row order never changes the result |
| **See what dials do** | a 2D map of two dials with their useful and overcooked ranges, an interaction matrix (who reinforces or cancels whom), a "who pushes" bar, and an influence wheel over 14 probe axes (motion, light, colour, mood, voice...) |
| **Edit a dial** | open a dial, see its probe profile, drag bars to add or remove a component (say, take the colour out of a dial), and export a new dial with its parentage recorded |
| **Control it over time** | draw a strength curve over the clip with the mouse (click to add a point, drag, double-click to delete, snap to seconds or beats) or drive it from audio; the dial switches inside one generation, not in a second pass |
| **Control it over depth** | a 50-cell strip sets how much of the dial each DiT block gets |
| **Keep audio clean** | an "audio: protect" option leaves the soundtrack undialled (measured: speech errors 0.29 to 0.00 in 3 of 4 cases) |
| **Works with de-rope** | a hold-map link keeps time curves in real clip time through a de-rope run |
| **Other models** | the same nodes detect MOSS-Image (works, about 2-4x H3's strengths) and Krea 2 (partial); dial files remember their model family |
| **Examples and help** | a Simple front door (Render Preset, Dial Rack, one blueprint; core-only and KJNodes variants) and Pika H3 Flex + de-rope workflows for the rack, picture dials (folders, two pictures, groups) and prompt sets in [`examples/dials/`](examples/dials/); Node Info guides on the Dial Rack, Make Dial from Pictures, Render Preset and H3 De-rope Sigmas |

**Honest limits.** Dials are alpha. Strengths are starting points measured on Pika H3 Flex's 6-step schedule, mostly
one seed. Time curves switch smoothly (a lighting dial ramps over about 1.5 s; colour and style dials switch much
faster) and cannot follow individual drum hits. Picture dials come out weaker than text dials. Krea 2 steers on one
side only. A dial can leak into other qualities (a "psychedelic" dial also brings rave outfits); the lessons file lists
the known ones.

**Quick start.** Load [`examples/dials/dials_simple_pika_derope.json`](examples/dials/dials_simple_pika_derope.json)
(core ComfyUI only; [`_kj`](examples/dials/dials_simple_pika_derope_kj.json) adds KJNodes' VRAM savers and folder loader):
pick a Render Preset (Pika, Pika + reference pictures, DMAD, or your own), write a prompt, drag a slider on the Dial
Rack, and queue; de-rope is one choice on the same node (off, oracle or flat; 79 s off at 1280x704). [`dials_rack_pika_derope.json`](examples/dials/dials_rack_pika_derope.json)
is the same render with every node in view. To make your own, add **Make Dial**, write two prompts that differ in one
quality, and wire its output into a rack row.

## Contact-Sheet diffusion

Five standalone image latents packed on the model's time axis, jointly
denoised, decoded independently. Use with a Turnaround LoRA from
[matlod/minimax-h3-turnaround](https://huggingface.co/matlod/minimax-h3-turnaround).
Nodes: **H3 Contact Sheet**, **H3 Contact Sheet Decode**.
Drag-in workflow: [`examples/contact_sheet.json`](examples/contact_sheet.json)
(API twin alongside) — point the LoadImage at your reference image, pick
your downloaded LoRA file, queue. `ref_image` is optional: leave it
unconnected for a text-only sheet (drop the `<Picture 1>` tag from the
prompt); [`examples/contact_sheet_t2i.json`](examples/contact_sheet_t2i.json)
is that graph. Stock loaders and sampler throughout;
28 steps of res_multistep at denoise 1.0, LoRA strength 0.75. A scripted
example is in [`example_api_workflow.py`](example_api_workflow.py).
Previously published as ComfyUI-H3-ContactSheet; that repo remains up for
existing installs.

## More

- **Video tools:** MAI Video Out (file plus hold-map and metadata
  sidecars), MAI Video Compare (2 to 6 renders, synchronized, with
  frame-exact export), MAI Seed Hunter, and a standalone compare deck.
  [`VIDEO_TOOLS.md`](VIDEO_TOOLS.md).
- **Small cards:** `H3 Streamed Blocks`, `H3 Memory Probe`, `H3 Free Cache`
  and friends render a long de-rope that OOMed a 96 GB card on a 16 GB card
  in a 32 GB machine. [`LOWVRAM.md`](LOWVRAM.md), speed dials in
  [`FASTER.md`](FASTER.md).
- **De-rope for any model** (alpha): `H3 Clock Remap` retimes one hold map
  onto another model's clock from a preset (`minimax-h3`, `ltx-2.5`, Wan
  2.2). The LTX-2.5 de-rope deck behind
  <https://matlowai.github.io/flipbook/derope.html> was built with it.
  [`DEROPE_ANY_MODEL.md`](DEROPE_ANY_MODEL.md).
- **What is stable:** the Motion Lab pipeline and the contact sheet. Concept
  Lab, the timeline surface, the motion adapter, manual masks, the audio
  init and Dials are alpha: [`ALPHA.md`](ALPHA.md) says what each can do and
  where it was tested. Alpha nodes carry `(alpha)` in the menu and load
  behind a guarded loader, so a broken one cannot take the pack down.
- **What's new:** Dials 1.2.0 (2026-11-01). Older notes in
  [`docs/NEWS.md`](docs/NEWS.md); open questions in [`ROADMAP.md`](ROADMAP.md).

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/matlowai/ComfyUI-MAINodes
```

**Most Motion Lab example graphs also need [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes)**
(the Dials picture-folder example uses its `LoadImagesFromFolderKJ` too).
They use `PathchSageAttentionKJ`,
`MiniMaxH3MemoryEfficientSageAttentionPatch` and `MiniMaxChunkFeedForward`
from it. Without KJNodes a graph loads with those three missing and will
not run. The nodes in this pack themselves have no such dependency.

Cloned before 2026-08-19 and `git pull` errors? Run
`git fetch origin && git reset --hard origin/main`, or re-clone.

Restart ComfyUI. Nodes appear under `latent/minimax/motion`,
`image/minimax/motion`, `sampling/custom_sampling/schedulers` and `MAINodes/Dials`.

## Support MAINodes

MAINodes is free and open source. If it saved you time, fixed a workflow
or made something cool possible, you can help fund the next round of GPU
time, benchmarking and increasingly questionable experiments:

- [Support MAINodes on Ko-fi](https://ko-fi.com/matlowai)
- Or just star the repo; that helps too.

## License

GPL-3.0-or-later. Copyright (C) 2026 MATLOWAI. See LICENSE.
