# ComfyUI-MAINodes

Custom nodes for MiniMax-H3. Two groups: **Motion Lab** (a test-time fix
for fast-motion smearing) and **Contact-Sheet diffusion** (five views of
one subject from one reference image).

Like it? A star helps. Want to feed the GPU? [Sponsor the experiments](#support-mainodes).

## What's new

Cloned before 2026-08-19 and `git pull` errors? Run
`git fetch origin && git reset --hard origin/main`, or re-clone.

**Long de-ropes on small cards** (2026-08-18, alpha). A de-rope pass at
d_max 4 on an 8 to 12 second clip is ~200k packed tokens, and the stock H3
block materialises its fused QKV and SwiGLU tensors for the whole sequence
(8.6 and 15.4 GiB at that length), which is what OOMs 24 GB cards and, at
1376x768, a 96 GB one. `H3 Streamed Blocks` runs every DiT block in token
chunks with the same math (int8 and W4A8 activations quantise per row and
accumulate in int32, so the result is bit-equal to stock; measured on
same-seed renders, video and audio) and streams the output head the same
way. With ComfyUI's dynamic VRAM and `--fast-disk`, the same 702-frame pass
that OOMed a 96 GB card renders on a 16 GB card in a 32 GB machine at the
same seconds per step (316 vs 311), because the step is attention-bound at
that length and the weight traffic hides under it. Alongside it: `H3 Memory
Probe` (per-block, per-phase VRAM and RSS ledger with a hoverable timeline,
plus an optional allocator trace), `H3 Free Cache` (return the allocator
pool before VAE decode; 17 GiB back on the long pass), `H3 Evict Text
Encoder`, and `H3 Evict Diffusion Model` (unload the DiT right before VAE
Encode: before a VAE call core frees only the encoder's own estimate, so on
a small card the encode runs in the few GB left beside the resident DiT and
spills to shared memory on Windows; one report measured 50 s decode vs 500 s
encode on 12 GB). All opt-in, nothing changes unless the node is in the graph. The
memory numbers behind them are in the docstrings of `vram_lab.py`; the
small-card recipe, what to expect and the environment it was measured in are
in [LOWVRAM.md](LOWVRAM.md), with the example graph
`examples/motion_pipeline_lowvram.json`; the alpha status is in
[ALPHA.md](ALPHA.md#vram-lab). Evening additions: two opt-in K/V store
options in the same node (`kvi8r`, rotated int8 K/V, forward peak +9.5 GiB
instead of +11.9; `kvi8s`, the same bytes in SageAttention's layout attended
on int8/fp8 tensor cores with no dequant), both approximation tier with the
measurements and what is still owed in LOWVRAM.md, kvi8r on in the low-VRAM
example graph; the example graph moves to
the int8_convrot video VAE (2.2 GiB less, decode 1.5x faster, 60 dB PSNR
against fp16 on the same latent); and a fix for the `H3 Audio Smear` /
`H3 Audio Recover` istft crash on short stretched tails (user report).

**Dialogue survives a de-rope now** (2026-08-17). A de-rope used to break
speech, and the way it broke was confusing: the body came back at the right
speed and the mouth did not, so held regions sounded rushed while the tail
sounded fine. The cause is that the picture gets an init and obeys it while
the audio starts from zeros, so pass 2 writes a fresh performance at natural
rate and moves the mouth to that. Recovery then compresses something that was
never slow. New node `H3 Audio Smear` stretches the baseline track onto the
same dilated clock so pass 2 renders a genuinely slowed take instead. See
[Dialogue through a de-rope](#dialogue-through-a-de-rope) for the three nodes
to add to a graph you already have.

**The graph to start from** is
[`motion_pipeline_ref2va_audioinit.json`](examples/motion_pipeline_ref2va_audioinit.json):
full-reference mode with the audio init wired, 12 steps on the base model for
pass 1 and the turbo LoRA at 6 steps for the de-rope. On 192 frames at 1 MP
that is **12 minutes end to end**, against 36 for the same graph at 25 steps
both passes without turbo. The audio init itself is free in both currencies,
costing no measurable time and no measurable sharpness.

## What is stable, and what is not

**Stable:** the Motion Lab de-rope pipeline and Contact-Sheet diffusion, both
described below. Their dials have measured numbers behind them in
[TUNING.md](TUNING.md), and their example graphs run out of the box.

**Not stable:** Concept Lab, the timeline surface, the motion adapter pilot,
the manual mask paths, and the audio init above, which works but has only
been heard on a narrow slice of material. [ALPHA.md](ALPHA.md) says which is
which and where each has and has not been tested. Alpha nodes carry
`(alpha)` in the ComfyUI menu and load behind a guarded loader, so a broken
one cannot take the pack down.

## Motion Lab

H3 smears bursty motion: backflips, fast sword arcs, whip-fast reversals.
The cause is structural. One latent token spans four pixel frames, and at
high motion speed those four frames need four distinct poses that a single
token can't hold. Re-denoising the affected region doesn't help, because
the missing poses were never generated in the first place.

This pipeline works around that at inference time. It re-generates the
clip as a slowed-down version of itself, seeded from the original. Frames
where motion is too fast get held (repeated) so the model has more
temporal room, the result is generated video-to-video from that retimed
init at partial denoise, and the original frame rate is recovered
afterward by dropping the held frames. The oracle that decides where to
slow down reads the clip's own latent. No extra model, no training.

![baseline vs inject 0.70 vs inject 0.50](assets/kitsune_threeway.gif)

Baseline on the left smears the aerial spin into a blob; the two
regenerated settings render it clean and keep the choreography. New scene,
default knobs, no per-clip tuning
([view](https://matlowai.github.io/ComfyUI-MAINodes/#kitsune) /
[download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/kitsune_threeway_sbs.mp4)).

All demos play on one page: **https://matlowai.github.io/ComfyUI-MAINodes/**

Demo clips:
- baseline vs regenerated, same seed, real time: left smears through the
  backflip, right doesn't
  ([view](https://matlowai.github.io/ComfyUI-MAINodes/#derope) /
  [download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/baseline_vs_regenerated_sbs.mp4))
- uniform vs adaptive hold maps, the bridge trade-off described below
  ([view](https://matlowai.github.io/ComfyUI-MAINodes/#adaptive) /
  [download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/uniform_vs_adaptive_sbs.mp4))
- the oracle, watching: heat pools where motion runs too hot, and the
  strip lights up as the burst arrives
  ([view](https://matlowai.github.io/ComfyUI-MAINodes/#oracle) /
  [download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/oracle_map.mp4))
- fast motion under a panning camera: parasol burst mid-pan
  ([view](https://matlowai.github.io/ComfyUI-MAINodes/#panrun) /
  [download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/panrun_sbs.mp4))
- nine tiers, one seed: every quality/speed rung with render times in the
  header
  ([view](https://matlowai.github.io/ComfyUI-MAINodes/#ladder) /
  [download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/preview_ladder_grid.mp4))
- the featherweight stack on 24-32 GB cards, with a Ref2VA subject drop-in
  ([view](https://matlowai.github.io/ComfyUI-MAINodes/#featherweight) /
  [download](https://github.com/matlowai/ComfyUI-MAINodes/raw/main/assets/featherweight_ref_triptych.mp4))

| baseline vs regenerated | the oracle, watching |
|---|---|
| ![baseline vs regenerated](assets/derope_sbs.gif) | ![the oracle, watching](assets/oracle_map.gif) |

Already good, and slightly better: uniform dilation, then the adaptive
map without and with `bridge`. Same seed all three.

![uniform vs adaptive, without and with bridge](assets/uniform_vs_adaptive.gif)

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

Three ready-made graphs live in [`examples/`](examples/):
[`motion_pipeline.json`](examples/motion_pipeline.json) drags straight
onto the ComfyUI canvas;
[`motion_pipeline_api.json`](examples/motion_pipeline_api.json) is the
same graph in API format for scripted use; and
Three flows cover almost every job, and the examples keep one graph per job:
the full-quality pipeline (25-step pass 1, 25-step pass 2, no turbo), the fast
flow (12-step turbo pass 1, 6-step turbo pass 2, inject 0.48 or 0.7), and the
low-VRAM stack in [LOWVRAM.md](LOWVRAM.md). Inject 0.48 replaced 0.50 as the
shipped default: at 0.50 and above some scenes measurably loosen their hold on
the reference. Historical dial studies and superseded variants live in
[`examples/archive/`](examples/archive/), still runnable as committed. When the
defaults are too slow for your card or your patience, [FASTER.md](FASTER.md)
prices every speed dial from measured runs.

[`motion_pipeline_turbo.json`](examples/archive/motion_pipeline_turbo.json) is the
same pipeline with the regeneration pass running on the LightX2V 4-step
turbo LoRA (Kijai's ComfyUI conversion, strength 0.8, er_sde with a beta
schedule, 3 of 4 steps after injection). Point the LoRA loader at
wherever you saved the conversion; community strength range is 0.65 to
0.8, and v0.1 of that LoRA is a preview, so judge results accordingly.

How we actually use this after trying every combination: **turbo is for
getting your prompt right, the pipeline is for the keeper, and mixing
them is a waste of time.** Iterate prompts and seeds on plain turbo
generations to learn what you will get globally, then run the winner
through the base pipeline. Putting the turbo LoRA inside the
regeneration pass saves a few minutes on a clip you have already decided
deserves the full treatment, and it costs quality on exactly that clip;
we do not recommend it. The turbo-inside graphs remain for people with
different budgets. One wrinkle that did earn its keep: starting the
turbo PREVIEW on the base model for the first couple of steps before
handing off to turbo (H3 Expert Schedule with inject 1.0) may buy
preview fidelity cheaply; we are still testing it. A unified workflow
with a preview/final toggle (H3 Mode Switch, lazy: only the chosen path
executes) is the intended end state.

A fourth graph,
[`motion_pipeline_probe_expert.json`](examples/archive/motion_pipeline_probe_expert.json),
is the fast path: instead of finishing the baseline it runs only the
first 6 steps (H3 Probe Schedule, configurable) and reads the oracle and
the init from the early x0 estimate, then regenerates with a base-model
head and a turbo tail (H3 Expert Schedule). Cheapest of the set; no
full-speed audio track to blend, and the saved preview is intentionally
rough.

There is also [`motion_pipeline_i50.json`](examples/archive/motion_pipeline_i50.json),
the same finals graph with the inject 0.50 preset selected, for people who
prefer the sharper flavor without touching a dropdown.

For 24 to 32 GB cards there is
[`motion_pipeline_featherweight.json`](examples/archive/motion_pipeline_featherweight.json):
the same finals graph pointed at the smallest community-published models
(w4a8 DiT, int8_convrot VAE, nvfp4 text encoder). Needs ComfyUI 0.31+.
Measured numbers and the honest caveats live in
[TUNING.md](TUNING.md#featherweight-stack-measured-comfyui-031).

Everything from here through the editor and segment graphs is new
(2026-08-09) and marked **alpha**: the node interfaces may still move,
and the interactive widget is young. The classic pipeline nodes above
are untouched and differentially regression-tested against the
previous release (same inputs, identical outputs).

And for the "the oracle is overzealous, I know exactly where the
problem is" crowd:
[`motion_pipeline_targeted.json`](examples/motion_pipeline_targeted.json)
(API twin alongside) puts a human in the loop. The oracle still
proposes, but its hold map passes through **H3 Manual Hold Map**, which
keeps holds only inside the time ranges you type (`36-60, 1.5s-2.4s:3`,
frames or seconds, optional per-range hold count; leave the oracle
unwired to author holds directly). Queue once and watch the saved
oraclemap video to see where the heat pools; type your ranges; queue
again. The node's report output prices the pass before you pay for it:
world length in, effective regeneration length out, with an optional
minutes estimate from your measured s/step. Since cost scales with the
held spans, targeting one burst in a long clip is also the biggest
speed lever this pack has. The drag-in graph additionally carries a
muted spatial branch: export a frame, paint a mask, load it, unmute,
and H3 Motion Composite returns your masked region to baseline timing
with a feathered seam (see below).

The full editing experience is
[`motion_pipeline_editor.json`](examples/motion_pipeline_editor.json)
(API twin alongside): the **H3 Motion Editor** node puts a DAW-style
editor right on the canvas. Queue once to load the filmstrip, then
work on the node: drag bracket blocks on the timeline (multiple
blocks, snapped to the model's token grid, jerk profile drawn
underneath so you can see what the oracle sees), click a block and
step frame by frame painting the problem areas with brush and eraser
(onion skin included), set per-block dials for hold, feather size,
feather profile and direction, edge grow, and temporal fade, and
toggle `A` on hold, feather, or strength to draw an automation
envelope with draggable breakpoints, exactly like an automation lane
in a DAW. A block with no strokes regenerates its whole time span;
strokes narrow it to the painted region. Queue again and only the
regeneration side re-runs; the baseline stays cached. The node's
outputs are ordinary `hold_map` and MASK wires, the mask arriving
pre-feathered and envelope-scaled (`mask_is_soft` on the composite),
so everything downstream is the same pipeline. Agents skip the GUI
and write the same `editor_state` JSON directly; the contract is in
the node's docstring.

And the compute payoff of targeting:
[`motion_pipeline_editor_segment.json`](examples/motion_pipeline_editor_segment.json)
(API twin alongside) adds **H3 Segment Crop** and **H3 Segment Splice**
around the editor. The regeneration chain runs only on the editor's
held window plus a few real-time handle frames, then the recovered
segment splices back into the baseline with video and sample-accurate
audio crossfades inside the handles. Cost scales with dilated frame
count, so a one-burst window in a longer clip regenerates severalfold
faster than the whole world; the crop node's report output states the
exact ratio for your selection. On FL2VA checkpoints, wire the crop's
first/last frame outputs into the regeneration conditioning to pin the
seam poses.

Four shorter paths, each measured on one prompt and seed:

[`motion_pipeline_split_lora.json`](examples/archive/motion_pipeline_split_lora.json)
splits pass 1 mid-trajectory. The bare model runs the early, high-sigma
steps -- where the motion is actually decided -- and a turbo LoRA takes
over for the low-sigma steps, off one schedule with no re-noising
between them (`SplitSigmas` + `DisableNoise`). Running a turbo LoRA
across the whole of pass 1 cost about 22% of mean subject motion and 30%
of the peak in our measurements, and the second pass never gave it back;
splitting recovered 99% of it, and still finished faster than a plain
12-step pass 1.

[`motion_pipeline_upscale_derope.json`](examples/motion_pipeline_upscale_derope.json)
does the de-rope and a spatial upscale in the same second pass: pass 1
renders at 0.4 MP, the smeared frames are resampled to the target size,
and the regeneration runs there. The second pass rebuilds detail rather
than interpolating it -- measured 89% of a native 1.5 MP render's
high-frequency detail for 83% of the wall time. Most of what the cheap
pass 1 saves, the larger second pass gives back: pass 1 drops from 179 s
to 31 s, and pass 2 rises from 305 s to 372 s. The cost is jerk
removal: a soft pass 1 gives the oracle blurrier evidence, so it cuts
less of it.

[`motion_pipeline_rolling_window.json`](examples/motion_pipeline_rolling_window.json)
(alpha) is the upscale de-rope split into budgeted windows, for cards
that cannot hold the whole dilated pass at once. **H3 Window Plan**
divides the clip into as many windows as your `max_dilated_frames`
budget requires and emits one per queue item: queue once, read the plan
report (wired to a preview node; it prices every window and names each
cut cold or hot before anything runs), then set the queue batch count
to the window count and queue once more -- the `window` widget
increments itself per batch item, seed-widget style, so the whole set
renders from one click. **H3 Window Collect** banks each rendered window to disk
(`output/h3_windows`, so a crash or reboot costs one window, not the
run) and splices the full set into the baseline once the last one
lands. On our test clip the peak window was 62 latent tokens against
77 for the one-pass version, paid for as 1.47x the one-pass total in
generated frames at the budget that forced the split. `coverage`
defaults to `full clip` so calm spans get the same second-pass repaint
as the action; `held span` is cheaper but leaves everything outside the
held span at baseline resolution, which on this graph means visibly
soft the moment motion calms.

**H3 Conditioning Bank** (alpha) keeps the text encoder out of the
window items. Wire it between the encode node and the guider: the first
item encodes and banks the conditioning to disk, and every later item
reads the tensors back. Its `conditioning` input is lazy, so on a bank
hit ComfyUI never executes the encode node or the CLIP loader behind
it, and the encoder (14.96 GB resident on the int8 ref2va stack, 21.2
GB peak on a 16 GB-simulated card) is never loaded for that item. To be
exact about what it buys: requeueing the same graph with only the
`window` widget changed already hits ComfyUI's own node cache, so
nothing is re-encoded there. What loses that cache is queueing any
other workflow in between, restarting ComfyUI, or editing anything
upstream of the encode, and the bank survives all three. It is not
window-specific: a seed hunt and an extension chain on the same prompt
encode once between them too.

**H3 Latent Bank** (alpha) is the same trick one stage later, and on
this graph it is worth more. The pass-1 baseline render is cached
exactly like the conditioning is, and lost exactly as easily, so an
interleaved workflow makes window item 2 re-render the whole baseline
before it starts its own window. Bank the pass-1 LATENT and every
consumer is served from it: the video decode, the audio decode, and H3
Jerk Oracle, which reads the latent directly. Latents are the cheap
thing to keep: the AV latent of a 107-frame 480x832 clip is 4.8 MB,
against 513 MB for the same clip as float32 frames. The staleness
contract is stated plainly on the node: `bank_key` plus a hash of
`seed` and `fingerprint`, and nothing else is fingerprinted for you.

Measured on a simulated 32 GB card (a large card fenced down with
`--reserve-vram`; int8 stack, 0.4 to 1.5 MP, 107 frames): the one-pass
de-rope peaked at 30.7 GB, touched the ceiling, and streamed the DiT
layer by layer (208 lowvram patches). Split into two windows the peaks
were 22.5 and 24.6 GB and the DiT stayed resident, so the two windows
together (440 s) matched the one-pass wall time (460 s) while
generating 1.4x the frames. The lower peak is what buys the extra work
back: on a card at the offload cliff, not streaming beats not
splitting.

[`motion_pipeline_fast_iterate.json`](examples/motion_pipeline_fast_iterate.json)
is the same idea sized for iteration: 0.2 MP in, 0.4 MP out, about 95
seconds end to end. Use it to find out whether the choreography lands
before paying for a final.

[`motion_pipeline_ref2va_audioinit.json`](examples/motion_pipeline_ref2va_audioinit.json)
runs the pipeline in full-reference mode, with the six-section prompt
contract and a reference image (wired to ComfyUI's stock `example.png`
so it runs out of the box -- swap in your own). It also seeds pass 2's
AUDIO rows with the baseline performance, which is what keeps dialogue
intact through a de-rope: without a seed, pass 2 writes fresh speech at
natural rate and drags the mouth to match it, and recovery then
compresses those lips by the hold factor, so held regions come back
rushed while the unheld tail sounds fine. `H3 Audio Smear` stretches the
baseline track onto the dilated clock, `VAEEncodeAudio` encodes it, and
`H3 V2V Init`'s `audio_latent` seeds it at `follow the original
performance (0.5)`.

**This is the balanced setting, and it is the one to start from.** Pass 1
runs 12 steps on the base model, pass 2 runs the turbo LoRA at
`total_steps 6` with inject 0.50, so about three steps actually execute on
the de-rope. On 192 frames at 1 MP on an RTX PRO 6000 Blackwell that is
**12 minutes end to end**. The same graph without turbo, at 25 steps for
both passes, took 36 minutes on the Max-Q card, which runs roughly 13%
slower on sustained 1 MP work, so call it 32 minutes equivalent. Nearly
three times the wall time, and the turbo arm was the one that got the
playback verdict.

**The audio init itself is free.** Pass 2 measured 6:06 with the seed
against about 7:20 without it on the same card, which is inside run to run
variation. It also costs nothing in picture quality: 91.8 against 91.3 on
laplacian variance, inside the noise floor of the video encoder itself.
And because the seed only touches pass 2, re-running a graph after wiring
it serves pass 1 from cache.

It writes two finals so you can hear the difference the seed makes:
`_recovered` keeps the original performance (the safe route, and the one
we ship as the default), and `_seededfoley` takes pass 2's own foley
retimed to the world clock -- legitimate ONLY because the rows were
seeded. Alpha: measured on a handful of clips, all sword-fight material
with two speakers. Speech over music, a single speaker and hold factors
other than 4 are untested.

[`motion_pipeline_ref2va.json`](examples/motion_pipeline_ref2va.json)
is the same graph WITHOUT the audio init, kept as the archived version.
Reach for it only if you want the older behaviour; on any clip with
dialogue, prefer the audioinit graph above.

**There is a resolution floor.** Below roughly 0.4 MP the subject smears
regardless of configuration, and every quality judgement we took from a
448x448 render turned out to be worthless. The small-canvas paths are for
iteration, not finals. Separately, a distilled LoRA wants the size it was
trained at: ours was mush at 448x448 and clean at its native 768x768.

**Do not run a turbo LoRA at its distilled step count in pass 2.** A
distilled LoRA's step budget is sized for a full denoise from noise;
pass 2 is a partial re-denoise from a v2v init, so those steps land far
too finely and the subject dissolves into a coarse mosaic. Running an
8-step LoRA for 8 steps of a 0.50 injection failed at both 0.2 and
1.0 MP and with either v1.0 file; 4 steps of the same schedule was
clean. Budget pass-2 steps against the fraction of the schedule you are
actually running, not against the LoRA's name.

All of them generate or probe a baseline, read its oracle, regenerate,
and recover, in one queue item. The oracle's length and the regeneration
length are wired dynamically, so changing the clip duration needs no
other edits. Each node's info button documents its inputs.

### Nodes

| node | knob | default | notes |
|---|---|---|---|
| H3 Jerk Oracle | `q` | 0.75 | jerk quantile treated as "hot"; higher = tighter span, lower cost |
| | `d_max` | 4 | peak hold count; below 4, smearing starts returning in our tests |
| | `ramp` | on | smooth shoulders on the hold curve; hard steps caused visible stutter |
| | `bridge` | 8 | fill dips between peaks of the same burst (see below); 0 = off |
| | `preset` | balanced | balanced / max quality / economy; `custom` uses the knobs |
| H3 Time Smear | `dilation` | 4 | uniform hold count, used when no hold_map is wired |
| H3 Inject Schedule | `inject` | 0.70 | fraction of the denoise schedule that runs. Lower keeps more of the init (including its artifacts); higher lets the model drift from the source choreography. 0.5 to 0.8 is the useful range |
| | `preset` | 0.70 | 0.70 / 0.50 / 0.80; `custom` uses the knob |
| H3 V2V Init | `length` | 0 (auto) | wraps the encoded init as H3's joint AV latent; audio regenerates with the video |
| H3 Exact Recover | | | drops held frames per the hold map; recovery is frame selection, not resampling |
| H3 Audio Recover | `fps` | 24 | retimes the regenerated audio to the original clock with the same hold map, pitch preserved, so the recovered video keeps its own foley |
| | `reference_mix` | 1 | whose track survives: 1 = the pass-1 baseline audio intact (default; regenerated audio quality varies, especially off turbo passes), 0 = the regenerated foley (leaner, one performance). The two performances are different takes, so mid values blend them; the dial is happiest near its ends |
| H3 Jerk Heatmap | `alpha`, `strip_height` | 0.55, 96 | the oracle-watching overlay from the demo clip, as a node |
| H3 Probe Schedule | `probe_steps` | 6 | run only the head of the baseline; the early x0 feeds the oracle and the init. Raise it if the init loses choreography |
| H3 Expert Schedule | `base_head` | 2 | split the injected schedule: base-model head for structure, turbo tail for refinement (tail defaults to turbo's native 4 steps) |
| H3 Trajectory Bank | `every_n` | 1 | wraps a sampler and checkpoints the trajectory latent each step (~7 MB per step for a 5 s clip) |
| H3 Trajectory Load | `step` | 5 | resume a banked run from any step with its remaining schedule; swap the model, LoRA, or guider and continue without recomputing the head |

#### Alpha nodes

Added 2026-08-09 and after. These are the research surface: they
work and are documented, but their names, defaults and outputs may
change, and they have had far less playback mileage than the nodes
above. `TESTING_ALPHA.md` is the manual checklist; `ROADMAP.md` and
`RESEARCH_NOTES_ATOS.md` carry the open questions and what we
rejected. If you want the settled pipeline, everything above this
line is it.

| node | knob | default | notes |
|---|---|---|---|
| H3 Motion Editor | timeline, brushes, lanes | | the GUI: time blocks with bracket handles, per-frame mask painting, per-block dials, automation envelopes for hold/feather/strength. Compiles to a hold map and a soft mask; state is plain JSON that agents can author without the GUI |
| H3 Segment Crop | `handle_frames` | 12 | cut the world to the held window plus context handles; the regen chain then pays only for the window. Report output states the speedup |
| H3 Segment Splice | `feather_frames` | 6 | reassemble after recovery: baseline outside, segment inside, video + audio crossfades inside the handles |
| H3 Window Plan (alpha) | `max_dilated_frames` | 209 | per-window budget in smeared frames, the number that sets cost and peak memory; read your card's ceiling off a run that survived |
| | `coverage` | full clip | `full clip` tiles windows over every frame so calm spans are repainted too (they cost 1 dilated frame each and cut cold); `held span` regenerates only where the hold map fires, cheaper, but passed-through frames keep baseline resolution on upscale graphs |
| | `window` | 0 | which window this queue item renders; 0, queue, then 1, queue. The report output is the interface: read it |
| H3 Window Collect (alpha) | `store_dir` | output/h3_windows | windows bank here between queue items and survive a reboot; avoid /tmp, it is a RAM disk on most Linux installs |
| | `run_name` | window_run | keys the banked set; change it whenever the plan changes |
| H3 Conditioning Bank (alpha) | `bank_key` | run | banks the encoded prompt to disk between queue items. Its `conditioning` input is lazy, so on a hit the encode node and the ~15 GB text encoder are never executed. One key per (prompt, reference, canvas, length): only the prompt is fingerprinted for you, and only if you wire it |
| | `mode` | use bank if present | `refresh` re-encodes and overwrites, which is what you press after changing anything the key does not cover |
| H3 Latent Bank (alpha) | `bank_key` | pass1 | same idea one stage later: banks a sampled LATENT so the pass is not re-rendered. Seat it after the pass-1 sampler, where the video decode, the audio decode and the jerk oracle all read from it. Lazy input, so a hit never stages the sampler |
| | `seed`, `fingerprint` | unwired | the ONLY things folded into the filename beyond `bank_key`. Wire the noise seed; put steps, scheduler, LoRA strength and resolution into `fingerprint` yourself |
| | `store_dtype` | float32 (exact) | float16 halves the file and sits below a VAE decode's noise, but it is not bit-identical: keep float32 while you are comparing takes |
| H3 Manual Hold Map | `ranges` | | manual time targeting: `start-end[:hold]` pairs, frames or seconds. Wire the oracle's hold_map in and its holds survive only inside your ranges (gate mode); leave it unwired to author holds directly. The report output prices the regeneration before you run it |
| H3 V2V Init | `freeze_threshold` | 0 (off) | automatic background freeze, not recommended: it fixes background timing but degraded other artifacts in our playback tests. Kept for content where the trade goes the other way |
| | `mask`, `mask_feather` | off, 0 | manual freeze region: you paint what regenerates (`invert_mask` to paint the frozen background instead). Static union over time, so the boundary never moves. Default is hard latent cells (each ~16 px cell fully frozen or fully live; the decode smooths the edge); raise `mask_feather` for a pixel-space ramp pooled to fractional cells if a seam shows |
| H3 Motion Composite | `mask` | oracle heat | spatial recovery: regenerated pixels inside the mask, baseline outside. The automatic oracle-heat mode stays deprecated for moving background objects (they pop at its boundary); with a hand-drawn mask the seam goes where you hide it, along a real edge |
| H3 Indecision Oracle (experimental) | `mode` | indecision | which signal drives the hold map: `indecision`, `jerk passthrough`, `blend max`, `blend weighted w`. Outputs mirror H3 Jerk Oracle and compile through the same threshold/bridge/ramp code, so the switch changes the signal and nothing else. See below |
| | `step_a`, `step_b` | 6, 12 | which two X0 Tap dumps to difference. 6 to 12 on a 25-step run is the validated pair; 0 to 1 is degenerate |
| | `blend_w` | 0.5 | weight on indecision in `blend weighted w`; blending happens after per-source rank normalization |
| H3 Timeline Analyze (alpha) | `auto` | True | oracle profiles in, a PLAN DOCUMENT out: a per-clip JSON saying in generation densities over time how the shot should be retimed. `auto` compiles the proposal straight to a minted graph; off stops at the plan so you can edit it |
| H3 Timeline Render (alpha) | `plan_path` | | a plan in, a legal graph minted and priced. It emits the graph path and the launch line rather than executing: launching stays with your own queue script |
| H3 Drawn Plan (alpha) | `plan_path`, `plan_json` | | load a plan and get its compiled geometry as wireable outputs: `hold_map` (the compiler's map verbatim, for H3 Temporal Insert), `ranges` (the same map in H3 Manual Hold Map's language, which re-shapes it through that node's own snapping), window start/len, dilated length, guide frame, and a `splice_map` for H3 Segment Splice at feather 0 |
| | `ignore_uncompiled_lanes` | False | a plan may carry lanes this backend cannot compile yet. Off refuses the plan so nothing is dropped silently; on compiles the density lane and names every lane it skipped |
| H3 Plan Settings (alpha) | `plan_path`, `plan_json` | | the same plan's execution knobs as typed outputs: inject, steps, seed, prompt, width, height, output prefix. Wire these instead of retyping them and the graph cannot drift from the plan. `expand_to_end` is reported for reading only: the compiler already baked it into the map, so H3 Temporal Insert stays False |
| H3 Plan Estimate (alpha) | `recorder_path` | flight recorder | what the plan costs before it runs: equivalent clip time (exact from the plan), work units, VRAM band. `seconds` comes back -1 when your box has no recorded runs, because an uncalibrated guess is worse than no answer |

#### The indecision oracle (experimental, 2026-08-14)

A second, independent oracle. The jerk oracle reads a clip's motion out
of a finished latent; this one reads the model's own uncertainty out of
two mid-schedule x0 predictions:

    J[token] = avgpool2x2( mean over the 24 latent channels of |x0_b - x0_a| )

High J means tokens whose predicted clean latent is still moving between
denoise steps, i.e. where the model has not made up its mind. A desk
study over 7 scenes found it carries genuinely independent signal:
controlling for pixel motion it still correlates +0.41 with static
detail energy, and on the quietest third of token-times (where
frame-diff has nothing to say) +0.51. It also misses things the jerk
oracle catches: one fast swinging prop read motion rank 0.97 and jitter
rank 0.04. The two disagree in both directions, so `blend max` is the
recommended experiment rather than a straight substitution.

**Nothing else in the pack changed its defaults.** This node exists so
the comparison can be made on real renders first.

Wiring the A/B:

1. Pass 1 goes through `X0 Tap (SAMPLER wrapper)` from `h3-motion-lab`
   with `dump_steps` including both steps you want (`6,12` at minimum).
2. Wire the pass-1 latent into `samples` and the tap's `dump_dir` into
   `dump_dir`, and set `length`/`width`/`height` to the tapped clip.
3. Wire `hold_map` where you would have wired the jerk oracle's, and
   flip `mode` to compare. `jerk passthrough` reproduces H3 Jerk Oracle
   exactly (unit-tested for byte-identical output), so the A/B is one
   widget and not two graphs.
4. Read the `comparison` output for the overlap and divergence numbers,
   and preview `heat` for the side-by-side map (indecision left, jerk
   right; wire `images` to get it overlaid on frames instead of tiles).

Two traps the node shouts about in its report:

- **The cheap pair is the useless one.** Step 0 to 1 is dominated by the
  (1,4,4,4,4) chunk-phase ramp, not by content, and correlated at or
  below zero with the picture on 6 of 7 test scenes.
- **Masked, pinned and repaint runs give you a picture of the mask.**
  Composited token rows read as exactly zero jitter. If more than 30% of
  token rows are exactly zero the report says so in capitals; believe it
  and do not drive a hold map off that map.

Some graphs tap `0,1,12,24` rather than including 6. There 12 to 24 is
the usable pair. With `auto_fallback` on (default) the node picks the
closest available pair and puts what it did in the report; turn it off
to hard-fail on a mis-tapped graph instead.
| | `feather_profile`, `feather_direction` | linear, centered | seam control: linear/smoothstep/gaussian falloff; centered straddles the boundary, inward eats into the masked side, outward into the kept side |

### What to expect, time-wise

Measured on a 5 second 1024x1024 clip at about 11.5 s/step (RTX PRO 6000);
scale to your card and clip:

| path | time | what you get |
|---|---|---|
| pipeline, inject 0.70 (`motion_pipeline.json`) | ~19 min incl. its own baseline | the default finals: safest playback feel |
| pipeline, inject 0.50 (`motion_pipeline_i50.json`) | ~15 min incl. baseline | sharper, tracks the source motion closer; try both |
| probe + expert turbo (`motion_pipeline_probe_expert.json`) | ~8.5 min, no full baseline | the fast full de-rope; preview output is intentionally rough |
| featherweight (`motion_pipeline_featherweight.json`, ComfyUI 0.31+) | 4-6 min for 3 s clips; ~29 min for 5 s at 1.0 MP | the 24-32 GB card path; fits where int8 thrashes. See TUNING for measured peaks |
| split LoRA pass 1 (`motion_pipeline_split_lora.json`) | ~7.5 min at 1.5 MP | most motion retained of the pass-1 recipes we measured |
| upscale de-rope (`motion_pipeline_upscale_derope.json`) | ~6.75 min at 0.4 -> 1.5 MP | 89% of native detail, 83% of the time |
| fast iterate (`motion_pipeline_fast_iterate.json`) | ~95 s at 0.2 -> 0.4 MP | prompt and choreography loop, not a final |

Start with a short clip, 2 to 3 seconds, and scale up once you like what
you see. Durations snap to the model's legal frame counts automatically
(the closest ones are 1.6 s, 2.3 s, and 3.0 s at 24fps), a short clip
keeps VRAM and wait times friendly, and how far you scale is really a
question of how much fast action the clip contains: cost follows the
burst spans, not the runtime.

A tuning guide for all of this, written for humans and for AI assistants
working on a user's behalf, is in [`TUNING.md`](TUNING.md).

Where the method is honestly weak, and what we are doing about it, is split
across two documents: [`RESEARCH_NOTES_ATOS.md`](RESEARCH_NOTES_ATOS.md) for
what has been measured (including the finding that the oracle can rank but
cannot abstain), and [`ROADMAP.md`](ROADMAP.md) for the methods under
investigation, what would count as success for each, and the approaches we
tried and rejected.

### bridge and inject

Both settings change the output in ways that are a preference, not a
ranking. From same-seed comparisons on our test clips:

- `bridge: 8` (default): the hold plateau covers each burst fully.
  Sharpest output, motion tracking equal to uniform dilation, about 2.9x
  frame budget. Poses can drift slightly from the baseline (a head angle
  on a landing, that kind of thing).
- `bridge: 0`: holds follow the raw oracle curve. Closest to the
  baseline's poses; a few soft frames can remain where the curve dips
  inside a burst.
- no hold_map (uniform `dilation: 4`): most conservative, highest cost.
- `inject 0.70` vs `0.50`: 0.50 measured sharper with closer motion
  tracking on our clips; 0.70 has been the safer default in playback.
  Try both on your content.

### Manual spatial masks, or: the birds

Time warping overcranks steady background movers (birds, crowds,
traffic) inside dilated spans, and both automatic remedies failed our
playback bar: compositing on the oracle's own heat mask popped at the
boundary, and the latent freeze degraded other artifacts. The
mechanisms were fine; the mask author wasn't. The oracle cannot hide a
seam. You can, by lassoing the sky down to a rooftop line and letting
the feather blend along an edge where nothing moves.

So both mechanisms now take a hand-drawn MASK. On the demo clip, whose
regeneration invented an extra flock and a small pagoda, a two-box
keep-baseline mask (`invert_mask` on) returned both regions to the
baseline take and kept the regenerated subject, seam along the cloud
deck. Prefer the composite (pixel space, fine feather control) unless
background and subject share lighting or contact, then use the V2V
Init freeze (latent space, coarser feather, but the model renders the
interaction). A single mask is a static boundary and cannot pop by
construction; mask batches are supported for per-frame control but
bring the moving-boundary risk back, so feather harder and judge in
playback.

### Notes on the approach

- A reference conditions every step at full strength and will copy the
  source's artifacts. An init decays with noise: at `inject 0.70` the
  baseline's smear detail is destroyed while its coarse motion survives.
- The model's clock stays uniform. The slowdown exists only in the
  content, as a speed ramp, so there is no boundary where the DiT and the
  VAE disagree about time. (Warping the RoPE time axis directly was
  tried; it produced boundary stutter.)
- Holds are integer, so recovering the original frame rate is exact frame
  selection.

### Dialogue through a de-rope

If your clip has speech in it, the de-rope will break it, and the way it
breaks is not obvious from the output.

Here is what happens. The de-rope stretches time, regenerates, then
compresses back. The picture goes along with that: the smeared init tells
pass 2 to move slowly, and it does. The audio has no init. It starts from
zeros, so pass 2 writes a fresh performance at natural speaking rate and
moves the mouth to match that. Recovery then compresses the whole clip by
the hold factor. The body comes back at the right speed because it really
was slowed. The mouth does not, because it never was. On a clip that
dilated 2.4x, held regions come back sounding rushed while the tail sounds
fine, which is a confusing symptom because half the clip is correct.

The fix is to give the audio an init too. `H3 Audio Smear` stretches the
baseline track onto the same dilated clock the video init lives on, using
the same hold map. Encode that with `VAEEncodeAudio`, wire it into
`H3 V2V Init`'s `audio_latent`, and set `audio_mode` to
`follow the original performance (0.5)`. Pass 2 now renders a genuinely
slowed take, so compressing it afterwards is a valid thing to do.

Two graphs ship with this, both full-reference mode:
[`motion_pipeline_ref2va_audioinit.json`](examples/motion_pipeline_ref2va_audioinit.json)
has the seed wired and writes both audio routes as separate finals, and
[`motion_pipeline_ref2va.json`](examples/motion_pipeline_ref2va.json) is the
same graph without it, kept as the archived version. Diff the two if you
would rather read the change than follow the steps below.

**To adopt it in a graph you already have, add three things:**

1. `H3 Audio Smear` -- `audio` from the VAEDecodeAudio of your FIRST pass
   (the baseline performance, not pass 2's), `hold_map` from the same
   `H3 Time Smear` output you already feed to `H3 Audio Recover`, `fps` 24.
2. `VAEEncodeAudio` -- audio from the smear, vae is your audio VAE.
3. On `H3 V2V Init`, wire `audio_latent` from that encode and set
   `audio_mode` to `follow the original performance (0.5)`.

Nothing else changes. Both new inputs are optional and default to the old
behaviour, so a graph without them behaves exactly as it did before.

**Which audio to ship.** `H3 Audio Recover` now takes plain-language
options instead of a bare 0 to 1 dial, because the two ends mean different
things depending on whether you seeded the rows:

- `keep the original performance (safe default)` is the one to use. Your
  first pass's audio is already on the world clock and has never been
  through a vocoder, so it is the best-sounding track you have. The seed's
  job is to make the picture agree with it.
- `use pass 2's foley - ONLY IF the audio rows were seeded` gives you
  foley scored for the new motion. Without a seed this is the rushed
  defect described above. With one it is a real option, though it comes
  back thinner: two phase-vocoder passes and a VAE round trip cost about a
  third of the presence band between 3.4 and 8 kHz.

**What it costs the picture: nothing measurable.** Same graph with and
without the seed, everything else held, came out 91.8 against 91.3 on
laplacian variance, which is inside the noise floor of the video encoder
itself. It moves most pixels, because it is steering a joint audio-video
latent and the two halves are denoised together, but it does not soften.

**Where this has and has not been tested.** It has been run on a handful
of clips, all sword-fight material with two speakers trading lines over
fast motion, at hold factors around 4 and dilations from 2.4x to 2.7x.
It has not been tried on a single speaker, on speech over music, on
non-anime footage, or at other hold factors. Treat it as alpha, and
listen to the tail of a clip as well as the start, because the tail is
where an unheld region will sound normal whether or not anything is wrong.

### The motion adapter (pilot)

A rank-16 LoRA trained on the de-rope task itself: frames inside a motion
burst held out, the rest kept as clean context, the model asked to fill
the burst back in. Applied to the de-rope pass only, it teaches the base
model to spend the stretched clock on smoothness instead of invention.
Weights and the measurement write-up:
[huggingface.co/matlowai/MiniMax-H3-Motion-Adapter](https://huggingface.co/matlowai/MiniMax-H3-Motion-Adapter).
Graphs: [`examples/motion_pipeline_adapter_api.json`](examples/motion_pipeline_adapter_api.json)
(text to video, then the standard de-rope with one `LoraLoaderModelOnly`
on the pass-2 model) and
[`examples/motion_window_pinned_adapter_api.json`](examples/motion_window_pinned_adapter_api.json)
(a clip you already have: the window is regenerated at denoise 0.70 with
its first and last frames pinned, adapter on the pass-2 model; this is the
graph behind the demo page's headline quad). Clips on the
[demo page](https://matlowai.github.io/ComfyUI-MAINodes/#adapter).

Settings, measured on clips it never saw: strength 1.0 (strength and
inject are the same dial; 1.0 wins alternation in every paired cell);
inject is what you tune, 0.45 for character work where the base
over-produces, 0.30 where identity or props are the deliverable, anything
on very fast anime; keep the tail guide on. Known costs: about 1 dB of
anchor fidelity on native keyframes, over-correction of calm chains, and
muted colour on strong-colour or particle-heavy subjects, worst on the
Ref2VA checkpoint and on full-clip 3x passes (a prismatic creature came
out as a plain calico both ways). It is a pilot released as an intermediate option; a
more ambitious all-in-one adapter is in progress and may not work.

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

## Alpha work

This pack ships finished work and unfinished work in the same install.
The Motion Lab pipeline and the contact sheet above are the finished part.
Alongside them are a research subsystem (Concept Lab), a timeline surface,
the audio init for dialogue, the motion adapter pilot, and the manual mask
paths, all at varying degrees of unfinished.

**[ALPHA.md](ALPHA.md) says which is which**, what each one can and cannot
do today, and where each has and has not been tested. Alpha nodes carry
`(alpha)` in the ComfyUI menu, they load behind a guarded loader so a
broken one cannot take the pack down, and none of them changes existing
behaviour or defaults.

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/matlowai/ComfyUI-MAINodes
```

**The example graphs also need [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes).**
They use `PathchSageAttentionKJ`,
`MiniMaxH3MemoryEfficientSageAttentionPatch` and `MiniMaxChunkFeedForward`
from it. Without KJNodes a graph loads with those three missing and will
not run. The nodes in this pack themselves have no such dependency.

Restart ComfyUI. Nodes appear under `latent/minimax/motion`,
`image/minimax/motion`, and `sampling/custom_sampling/schedulers`.

## Support MAINodes

MAINodes is free and open source. If it saved you time, fixed a workflow
or made something cool possible, you can help fund the next round of GPU
time, benchmarking and increasingly questionable experiments:

- [Support MAINodes on Ko-fi](https://ko-fi.com/matlowai)
- Or just star the repo; that helps too.

## License

GPL-3.0-or-later. Copyright (C) 2026 MATLOWAI. See LICENSE.

## De-rope for any model (branch `generic-derope`)

One hold map, any regenerating model: `H3 Clock Remap` retimes the oracle's
plan onto a model's clock from a preset (`minimax-h3`, `ltx-2.5`, a
user-editable registry for the rest), `H3 Time Smear` pads to that model's
grid, and `H3 Save Hold Map` keeps the clock beside the render. The LTX-2.5
graphs behind https://matlowai.github.io/flipbook/derope.html live there too.
See `DEROPE_ANY_MODEL.md`. Alpha, on a branch until the oracle-shaped LTX arm
is measured.
