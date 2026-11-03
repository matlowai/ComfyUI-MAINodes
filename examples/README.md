# Start here

Thirty-odd files in this folder is a lot of doors. This page says which one to
open. Every graph comes in two flavours: `name.json` loads in the ComfyUI
editor, `name_api.json` is the same graph in API form for scripts and
coding agents.

The folder has three tiers:

| tier | where | what it means |
|---|---|---|
| **start here** and **specialised** | this folder | measured, maintained, dials documented in [`../TUNING.md`](../TUNING.md) |
| **experimental** | [`experimental/`](experimental/), [`wan22/`](wan22/) | runs, interesting, one machine, interface may change; [`../ALPHA.md`](../ALPHA.md) says how alpha each one is |
| **archived** | [`archive/`](archive/) | superseded recipes, kept so the numbers in old write-ups still resolve; do not start from these |

## Which graph

| you want | graph | needs |
|---|---|---|
| **the recommended starting point** | [`dials/dials_simple_pika_derope.json`](dials/dials_simple_pika_derope.json) | Pika H3 Flex + de-rope behind one Render Preset and one blueprint, with the Dial Rack; core ComfyUI only (a [`_kj`](dials/dials_simple_pika_derope_kj.json) variant adds KJNodes' VRAM savers). Guide: [`../dials/README.md`](../dials/README.md#simple-start) |
| **a long clip, short renders** | [`motion_pipeline_extend_api.json`](motion_pipeline_extend_api.json) | alpha, API form; 141-frame segments chained by writing the last 39 frames into the next segment's latent under a per-token mask. Below |
| the Motion Lab starting point | [`motion_pipeline_ref2va_audioinit.json`](motion_pipeline_ref2va_audioinit.json) | Ref2VA checkpoint, a reference image, the lightx2v turbo LoRA. 12 steps on the base model for pass 1, turbo at 6 steps for the de-rope, audio seeded. 192 frames at 1 MP in ~12 min on our card |
| best quality, time is no object | [`motion_pipeline.json`](motion_pipeline.json) | FL2VA checkpoint, first-frame image. 25 steps both passes, no turbo, the audio fixes included. The starting-point graph run this way measured 36 min against 12 |
| a 16 to 24 GB card (12 reported working in the field, just slower) | [`motion_pipeline_lowvram.json`](motion_pipeline_lowvram.json) | W4A8 checkpoint, NVFP4 text encoder, ~32 GB of system RAM. Measured on fenced 16/24/32 GB budgets, see [`../LOWVRAM.md`](../LOWVRAM.md) |
| to try prompts and seeds fast | [`motion_pipeline_fast_iterate.json`](motion_pipeline_fast_iterate.json) | 0.2 MP pass 1, 0.4 MP de-rope, ~95 s. A scouting loop, not a final |
| to upscale a finished clip 2x (RelayVSR) | [`relayvsr/workflow_comfyui_native_video.json`](relayvsr/workflow_comfyui_native_video.json) | LightX2V in its own venv plus the X4 weights (a quantized Wan for 16-24 GB cards); setup and VRAM tiers in [`../relayvsr/README.md`](../relayvsr/README.md) |

If you only read one more line: **pass 1 decides the choreography, pass 2
repairs the bursts.** Spend steps on pass 1; pass 2 is where the turbo
LoRA belongs. The base model on pass 2 is better still, if you have
forever to spend.

## The essential graph

Every motion graph in this folder is this chain with something bolted on.
Eleven nodes, two of them samplers:

```mermaid
flowchart TD
    subgraph P1["pass 1: the baseline (decides the choreography)"]
        I2V["MiniMaxH3ImageToVideo<br/>or ReferenceToVideo"] --> S1["SamplerCustomAdvanced<br/>(12 to 25 steps, base model)"]
        S1 --> D1["VAEDecode + VAEDecodeAudio"]
    end
    subgraph DR["the de-rope (repairs the bursts)"]
        S1 -- "latent" --> O["H3 Jerk Oracle<br/>(where is motion too fast)"]
        O -- "hold_map" --> TS["H3 Time Smear<br/>(hold frames where it is)"]
        D1 -- "frames" --> TS
        D1 -- "audio" --> AS["H3 Audio Smear<br/>(same clock, for the audio)"]
        TS --> E["VAEEncode"]
        E --> V2V["H3 V2V Init<br/>(video + audio latent)"]
        AS --> V2V
        V2V --> S2["SamplerCustomAdvanced<br/>(H3 Inject Schedule, partial denoise)"]
        S2 --> D2["VAEDecode + VAEDecodeAudio"]
        D2 --> R["H3 Exact Recover<br/>+ H3 Audio Recover<br/>(drop the held frames)"]
    end
    R --> OUT["CreateVideo / SaveVideo<br/>original length, bursts repaired"]
```

Three dials do most of the work:

| dial | node | what it trades |
|---|---|---|
| `preset` / `q` / `d_max` | H3 Jerk Oracle | how much of the clip gets slowed, and by how much. `balanced` is q 0.75, d_max 4 |
| `inject` | H3 Inject Schedule | how far pass 2 is allowed to re-decide. 0.50 is sharper and tracks the source closer, 0.70 is the safer playback default. Effective pass-2 steps = total_steps x inject |
| `audio_mode` | H3 V2V Init | `0.5` seeds pass 2 with the baseline performance so dialogue survives the slow-down |

The full symptom-to-dial table is [`../TUNING.md`](../TUNING.md#symptom-to-dial).

## Specialised graphs

Each one is the essential graph plus the nodes named in the diagram.

**You know where the problem is.**
[`motion_pipeline_targeted.json`](motion_pipeline_targeted.json) replaces
the oracle's decision with typed time ranges; you pay for your spans only.

```mermaid
flowchart LR
    O["H3 Jerk Oracle"] -. "review the heatmap" .-> M["H3 Manual Hold Map<br/>(type the ranges)"]
    M -- "hold_map" --> TS["H3 Time Smear"]
```

**You want to paint it instead.**
[`motion_pipeline_editor.json`](motion_pipeline_editor.json) puts a GUI on
the hold map: blocks, painting, automation.
[`motion_pipeline_editor_segment.json`](motion_pipeline_editor_segment.json)
adds a crop around one burst so a long clip pays for the window only.

```mermaid
flowchart LR
    O["H3 Jerk Oracle"] --> ED["H3 Motion Editor<br/>(paint the envelope)"]
    ED --> TS["H3 Time Smear"]
    TS --> C["H3 Segment Crop<br/>(one burst + handles)"]
    C --> S2["pass 2 on the window only"]
    S2 --> SP["H3 Segment Splice<br/>(back into the full clip)"]
    ED --> MC["H3 Motion Composite<br/>(blend repaired over original)"]
```

**Cheap pass 1, expensive pass 2.**
[`motion_pipeline_upscale_derope.json`](motion_pipeline_upscale_derope.json)
renders the baseline at 0.4 MP and de-ropes at 1.5 MP: 89% of native
detail in 83% of the time on our measurements.

```mermaid
flowchart LR
    D1["pass 1 frames<br/>0.4 MP"] --> TS["H3 Time Smear"] --> SC["ImageScale<br/>to 1.5 MP"] --> E["VAEEncode"] --> S2["pass 2 at 1.5 MP"]
```

**The dilated pass does not fit the card.**
[`motion_pipeline_rolling_window.json`](motion_pipeline_rolling_window.json)
(and the `_lowvram` twin) slides a fixed-size window across the clip, so
peak memory follows the window, not the clip. Alpha: validated end to
end, waiting on field reports from real 24 to 32 GB cards.

```mermaid
flowchart LR
    TS["H3 Time Smear"] --> WP["H3 Window Plan<br/>(cut the clip into windows)"]
    WP --> S2["pass 2, one window per queue item"]
    S2 --> WC["H3 Window Collect<br/>(bank, then reassemble)"]
    WC --> R["H3 Exact Recover"]
```

**Two different long-video jobs, easy to confuse.** Already have one long
clip and want it repaired? That is the rolling window above: one world,
the expensive pass chunked. Want to MAKE a long clip but can only afford
short generations? That is extension: short segments generated and
de-roped one at a time, a short video+audio tail carried into the next
segment as its opening context, the overlap trimmed at assembly. The two
trade differently: the window keeps one semantic world at bounded memory;
extension accepts some drift between separately generated worlds in
exchange for bounded compute.

**Make a long clip on a smaller card.**
[`motion_pipeline_extend_api.json`](motion_pipeline_extend_api.json) (alpha,
API form only for now) renders two 141-frame segments and assembles 243
frames. Segment 2 does not restart: segment 1's last 39 frames are written
into its own pass-1 latent and held there by a time-varying per-token mask
(the audio handle rides an audio-only `MiniMaxH3AddGuide` at frame 0), so
the shot's momentum carries across. The de-rope then holds that prefix at
1 AND freezes it in pass 2, protects the last 17 frames of any non-final
segment (a gesture that runs into the cut would come back fast after
recovery otherwise), trims the hidden overlap, colour-matches the new
material from it, and appends. The plan node prints the arithmetic
(141 = 235 audio ticks, handle 39 = 65, new 102 = 170: nothing fractional
accumulates) and which anchor the running core supports; without #15375
it falls back to the image guide. Measured on two content sets: the join
lands at 0.86x to 1.1x the clip's ordinary frame-to-frame motion (the
guide fallback measures 5x to 6.5x), and the camera's velocity is
continuous through the cut.

```mermaid
flowchart LR
    R1["segment 1<br/>recovered"] --> TC["H3 Tail Context<br/>(last 39 frames + audio)"]
    P["H3 Extension Plan<br/>(141/39 atom)"] --> TC
    TC --> ML["tail written into the<br/>pass-1 target latent<br/>(per-token mask)"] --> S2["segment 2 pass 1"]
    TC -- "audio only" --> AG["MiniMaxH3AddGuide @ 0"] --> S2
    S2 --> O["H3 Jerk Oracle"] --> PP["H3 Protect Prefix<br/>(hold 1: prefix + last 17)"] --> TS["H3 Time Smear"]
    TS -- "length" --> FM["H3 Prefix Freeze Mask"] --> V["H3 V2V Init<br/>(time_varying)"]
    V --> D2["pass 2 + recover"] --> T["H3 Trim"] --> N["H3 Seam Normalize"] --> A["ImageBatch + AudioConcat"]
```

The grid rules behind it are in [`../TUNING.md`](../TUNING.md#chained-clips-and-the-audio-clock).

**No audio init.**
[`motion_pipeline_ref2va.json`](motion_pipeline_ref2va.json) is the
starting-point graph without `H3 Audio Smear`; use it to hear what the
audio init changes, otherwise prefer the `_audioinit` twin.

**Contact sheets** are a different product: one call, several consistent
views of a character.
[`contact_sheet.json`](contact_sheet.json) (from a reference image) and
[`contact_sheet_t2i.json`](contact_sheet_t2i.json) (from text).

```mermaid
flowchart LR
    R["LoadImage (optional)"] --> CS["H3 Contact Sheet<br/>(conditioning + latent)"] --> S["SamplerCustomAdvanced"] --> CD["H3 Contact Sheet Decode"] --> SI["SaveImage x views"]
```

## Experimental

In [`experimental/`](experimental/):

- `motion_pipeline_adapter.json`: the motion adapter pilot, a LoRA trained
  on the de-rope task, on the pass-2 model only. Known costs in
  [The motion adapter (pilot)](../docs/MOTION_LAB.md#the-motion-adapter-pilot).
- `motion_window_pinned_adapter_api.json`: a clip you already have,
  regenerated at denoise 0.70 with first and last frames pinned, adapter on.
- `time_burst_api.json`: a look, not a repair, and it breaks things on
  purpose. The windowed insert with the in-between tokens born as pure
  noise: no crossfade init, no adapter, no guide. Inside the window the
  model has no clock, so it spends the free slots on motion: the span runs
  at about 2.7x the source speed, a burst inside an otherwise normal shot,
  with flares it invents along the way. This is the exact graph (same seed,
  same hold map) that made [`../assets/time_burst_result.mp4`](../assets/time_burst_result.mp4)
  from [`../assets/time_burst_plate.mp4`](../assets/time_burst_plate.mp4);
  copy the plate into `ComfyUI/input/` and you can watch it work before
  pointing it at your own clip. Dials: the hold map (more holds, longer and
  wilder burst), `H3InjectSchedule` inject (1.0 is the burst; switch
  `H3TemporalInsert` to lerp init at 0.4 to 0.6 and it calms toward the
  ordinary insert), and where you draw the window. One clip, one seed, our
  card; expect it to be able to make things worse.

In [`wan22/`](wan22/): the de-rope on a model that is not H3. One cell
measured so far; the dials are not tuned there.

## Two recipes, and why both exist

The graphs in this folder were minted in two waves, and the settings
differ. Neither is wrong; they are different budgets.

| | the August 8 recipe | the August 19 recipe |
|---|---|---|
| graphs | `motion_pipeline`, `_targeted`, `_editor`, `_editor_segment` | `_ref2va_audioinit`, `_ref2va`, `_fast_iterate`, `_upscale_derope`, `_rolling_window`, `_lowvram` |
| pass 1 | 25 steps, `simple`, `res_multistep` | 12 steps, `linear_quadratic`, `gradient_estimation` |
| pass 2 | base model, inject 0.70 | turbo LoRA, 6-step `beta`, inject 0.70 (or 0.48 on the window graphs) |
| audio | seeded (`H3 Audio Smear`) in all of them | seeded |
| cost | ~3.5x one baseline render | ~1x to 1.3x |

One thing we learned the hard way: the turbo LoRA dropped into the August 8
graph, with its sampler and schedule unchanged, renders jerky and
pixelated. Turbo on pass 2 needs the whole August 19 recipe, not just the
LoRA. If you want turbo, start from a graph that already has it.

## When it fails

| symptom | first thing to check |
|---|---|
| dialogue or audio sounds wrong, words mangled | update ComfyUI; the H3 tokenizer special-token fix landed upstream 2026-08-22 (PR #15808), and an older core corrupts H3 prompts before any node here runs |
| the reference stops influencing pass 2 | put `BasicScheduler` / stock sigmas back before debugging anything else; one field report traced exactly this to a third-party scheduler |
| pass 2 looks jerky and pixelated | turbo LoRA in an August 8 graph, see above |
| the de-rope OOMs | [`../HARDWARE.md`](../HARDWARE.md), then [`../LOWVRAM.md`](../LOWVRAM.md) |
| VAE encode takes minutes | it is the slowest stage on a small card; `H3 Free Cache` before it, `H3 Evict Text Encoder` after the prompt. The TAE encoder (125x faster) needs a ComfyUI newer than 2026-08-17 (core PR #15695) |
| the motion got slower, not cleaner | `inject` too high or `d_max` too high; try `faithful detail 0.50` |

Anything else: [`../TUNING.md`](../TUNING.md) is written for humans and for
the coding agent working on your behalf. Paste a graph and a symptom into
either and you will usually get the dial.
