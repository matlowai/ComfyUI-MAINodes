# What is alpha here, and how alpha is it

This pack ships finished work and unfinished work in the same install. The
finished work is the Motion Lab de-rope pipeline and the contact sheet; it
has been measured, it has example graphs, and its dials have numbers behind
them in TUNING.md. Everything on this page is the other kind.

Alpha here means one or more of: it has run on one machine and no others,
the interesting half of it is not built, its interface will change, or it
is a real capability that simply has not been tested on enough material to
know where it stops working. Each entry below says which.

Nothing on this page changes existing behaviour or defaults. Alpha nodes
carry `(alpha)` in the name you see in the ComfyUI menu, and the subsystems
load behind a guarded loader, so a broken alpha module cannot take the rest
of the pack down with it.

If you find something wrong, an issue with the symptom and the graph is
worth more than a fix. Symptom-and-dial pairs belong in TUNING.md.

---

## Concept Lab

`concept_lab/`, and the nodes `MAI Concept Capture Arm / Flush` and
`MAI Concept Inject Delta`.

A research subsystem on the bet that a reusable concept does not have to
live in trained weights and can instead live in a measured functional
delta: measure what a piece of conditioning actually does to the model,
factor that into reusable components, compile them back through the model's
own conditioning channels.

**State: the interesting half is not built.** What exists is the data
layer (contracts, workspace, verbs, three surfaces over them) and an H3
capture tap that rides along on a render. What does not exist is anything
that turns a capture into a factor, or a factor into conditioning. Unbuilt
verbs raise and name the task that blocks them rather than returning an
empty result, because in a subsystem whose output is evidence a quiet
nothing is worse than a refusal.

Full status table, the layering rules, and a Contributing section naming
the four things most worth receiving: **`concept_lab/README.md`**. The
design decisions and their reasoning are in `concept_lab/DECISIONS.md`.

## Extension (long clips from short renders)

`h3_extend.py`: `H3 Extension Plan`, `H3 Tail Context`, `H3 Protect Prefix`,
`H3 Prefix Freeze Mask`, `H3 Trim`, `H3 Seam Normalize`; the shared types
in `capsule_types.py`; the graph `examples/motion_pipeline_extend_api.json`;
edge-protection dials on `H3 Jerk Oracle` (`protect_tail`) and
`H3 Window Plan` (`edge_protect`).

Short segments generated and de-roped one at a time, the last 39 frames
carried into the next segment, the overlap trimmed at assembly. Integer
time throughout: the 141/39 atom adds exactly 102 frames and 170 audio
ticks per segment. On a core with per-token masks (#15375) the handle is
WRITTEN INTO the next segment's own pass-1 latent under a time-varying
mask, with the audio handle on an audio-only `MiniMaxH3AddGuide`; on older
cores the whole handle rides the guide. The de-rope holds the prefix at 1
AND freezes it in pass 2; a non-final segment's last 17 frames are also
held at 1, because a gesture that runs into the cut has no "after" to slow
into and comes back fast otherwise. `H3 Seam Normalize` fits per-channel
linear-light gains on the hidden prefix (each VAE round trip darkens it
~2.4%) and applies them to the new material; its audio rms gain measured
NEGATIVE and defaults off.

**State: measured on two content sets, one machine, two segments.** The
masked path beats the image guide everywhere we measured: join jerk 0.86x
to 1.1x the clip's ordinary frame-to-frame motion vs 5x to 6.5x for the
guide, camera velocity continuous through the join instead of reversing,
handle within 2.2 to 3.3/255 of the carried tail, ~20% less wall (no
guide rows in every block). The closing-gesture fix measured 1.55x -> 1.06x.
Unmeasured: more than two segments (the drift curve), the 192/90 atom,
lower inject on continuation segments, dialogue across a join, and the
audio ambience bed, which still steps at the cut (a per-tick audio mask
is the planned fix). The API graph is the only form shipped so far.

## The timeline surface

Nodes: `H3 Drawn Plan`, `H3 Plan Settings`, `H3 Plan Estimate`,
`H3 Timeline Analyze`, `H3 Timeline Render`, `H3 Flight Recorder Start` and
`Stop`.

A plan document as the single source of truth: something proposes a plan,
a human edits it, a compiler turns it into a legal graph. The node surface
reaches parity with the compiler route, and the splice is proven on tensors.

**State: real but young.** The interface is expected to move, and the
editing experience around it is not built. If you are looking for the
production route, use the ordinary de-rope graphs.

## The audio init for dialogue

`H3 Audio Smear`, plus `audio_latent` / `audio_mode` on `H3 V2V Init` and
`audio_source` on `H3 Audio Recover`.

Fixes a real defect: a de-rope breaks speech, because the picture gets an
init and obeys it while the audio starts from zeros, so pass 2 writes a
fresh performance at natural rate and moves the mouth to that. Seeding the
audio rows with the baseline performance stretched onto the same dilated
clock makes pass 2 render a genuinely slowed take. The README's
"Dialogue through a de-rope" section has the adoption steps.

**State: it works, on material we have not varied enough.** The geometry
is solid: the smear/recover round trip is sample-exact in both directions
with envelope correlation 0.975, and the init costs nothing measurable in
picture quality. But it has been heard on a handful of clips, all
two-speaker sword-fight material at hold factors around 4 and dilations
between 2.4x and 2.7x. A single speaker, speech over music, non-anime
footage, and other hold factors are all unmeasured. If you try one of
those, that result is worth reporting whichever way it goes.

## The motion adapter (pilot)

A rank-16 LoRA trained on the de-rope task itself, applied to the de-rope
pass only. Documented with its measured settings and its known costs in the
README's "The motion adapter (pilot)" section, and released as an
intermediate option rather than a finished one. A more ambitious all-in-one
adapter is in progress and may not work.

## Manual mask paths

The `(alpha)`-tagged inputs on `H3 V2V Init` and `H3 Motion Composite`:
manual region masks, final-alpha masks, and the time-varying mask path.
These are exercised by the checklist in **`TESTING_ALPHA.md`**, which
covers the 2026-08-09 node batch and still wants human passes on the
interactive widget and the drag-in workflows.

---

## VRAM Lab

`H3 Streamed Blocks`, `H3 Memory Probe`, `H3 Free Cache`, `H3 Evict Text
Encoder` (`vram_lab.py`, 2026-08-18). Alpha because it has run on one
machine (RTX PRO 6000 Blackwell, 188 SMs) and its exactness is a kernel
property, not a code property: query chunking is bit-equal only while every
chunk keeps PyTorch's flash kernel off its split-KV path (measured boundary
`heads x ceil(L/64) >= 0.8 x 2 x SMs`; the node sizes chunks from the SM
count with a 2.6x margin and carries a `self_check` that compares stock and
streamed on the first block's real input). int8 and W4A8 checkpoints are
bit-equal by mechanism (row-wise activation scales, int32 accumulate);
NVFP4/FP8 would need one shared activation scale and are untested; bf16 is
numerically equivalent, not identical. `kv_block` is experimental and as
built does not lower memory (leave it at 0). The output head has an exact
mode (default) and a chunked-GEMM mode that changes the clip after 25 steps
by ~1e-6 per step of fp32 difference; that mode is labelled and off.

What was measured, one graph (294 f -> 702 f de-rope at 1376x768, ~217k
tokens): torch activations peak +11.9 GiB over the weight floor at any
card; a 16 GB card in a 32 GB machine renders it with ComfyUI's dynamic VRAM
and `--fast-disk` at 316 s/step; a 96 GB card resident is 311 s/step. RAM is
the small-machine ceiling in normal mode (CPU copies of the models without
`--fast-disk`, and CPU-side IMAGE intermediates); the text encoder costs
1 to 2.5 GiB of peak on a 16 GB card and about 3 s per new prompt, and
either eviction or the conditioning bank removes it. Untested: other GPUs,
Windows, ROCm, non-flash attention backends (cuDNN and mem-efficient are
chunk-invariant at every length here but 1.1 to 2x slower; no two backends
are bit-equal to each other).

The `kv_store` options (`kvi8r`, `kvi8s`) are the approximation tier of the
same node: half the K/V bytes (kvi8r measured +9.5 GiB forward peak against
the exact +11.9 at 217k tokens; kvi8s attends on int8/fp8 tensor cores
straight from the store, ~1.6x faster attention standalone), same-seed
renders are sibling takes, and only kvi8r's first cut has been in front of
eyes ("almost perfect" on the de-rope side by side, one clip, one viewer).
The node defaults to the exact store; the low-VRAM example graph turns kvi8r
on (operator's call for that graph); the table with the numbers and what is
still owed is in LOWVRAM.md. The int8_convrot video VAE now in the example graph is also an
approximation (60 dB PSNR against the fp16 decoder on the same latent).

## Where to look next

| | |
|---|---|
| `concept_lab/README.md` | Concept Lab status, layering, contributing |
| `TESTING_ALPHA.md` | hands-on checklist for the manual mask and editor batch |
| `TUNING.md` | dials with measured numbers, for the finished pipeline |
| `ROADMAP.md` | where the unfinished parts are meant to go |

---

## Repair verb

`h3_repair.py`, nodes `H3 Repair Plan (alpha)` and `H3 Repair Splice (alpha)`.

Type a bad frame range; the plan snaps it outward to whole tokens, runs the
regeneration through the nearest shot cut, and the splice puts every
untouched pixel back bit-exact, printing its seam numbers. Validated on one
cell and one in-graph rerun (entry seam 0.26x the clip's median frame delta,
exit ON the source's own cut within 1.8%). Alpha because: one scene family
so far, and AUDIO IS STILL A WORK IN PROGRESS: the splice passes audio
through untouched, which is only right when the repair changed no performance.

## DyRoPE

`motion.py`, node `H3 DyRoPE (alpha)`.

An instrument that hands the de-rope's two clock geometries (true world time
vs the trained grid) to different transformer blocks or different denoise
steps. The dose map is measured and in TUNING.md: two settings keep the
world-time correction, everything below them loses it, everything above adds
shimmer. Alpha because: one scene measured deeply, everything else untested.

## Audio prefix freeze

`motion.py`, inputs `audio_prefix_ticks` and `audio_prefix_release_ticks` on
`H3 V2V Init`.

The audio twin of the video prefix freeze, with a half-cosine release.
Bench-tested on chained music (overlap correlation ~0.92 in the full
chain, 0.98 on the pass-1-only control; beat phase 0.0 ms). It carries local continuity (level, timbre, beat),
not a track's global phrase structure. Alpha because: the caveat list in the
README section is load-bearing; read it before wiring.

## Drift Control

`h3_drift.py`, node `H3 Drift Control (alpha)`.

Schedule-matched noise on a carried video prefix so a chain's later joins
stop drifting. Second-join delta 0.680 to 0.860 with the first join
unchanged; replicated across two chains and new seeds; joins hold 0.85-0.89 through link 4 (the earlier chain sat in the 0.65 class at its second
join before the recipe; cross-chain comparison, not a paired arm). Refuses to stack with
any other dynamic denoise-mask patch; sigma-split samplers unsupported.

## Color Carry

`h3_color_carry.py`, nodes `H3 Delta Color Carry (alpha)` and
`H3 Scene Color Stats (alpha)`.

Cancels the VAE round-trip color bias on a carried prefix by adding only
E(corrected) minus E(original) to the latent, so the encode bias cancels and
the weak scene-one grade survives. Active path exercised on a real 4-link render 2026-08-24: it fires, corrects in the anchor direction, and stays sub-visible under its clamps on mildly-drifted content; on the deepest tested link it fires on both channels at or near its clamp. A strong-drift bench is still owed.

## Video Compare viewer (upgraded player)

`video_compare.py` + `web/video_compare.js`. The review player grew a
timeline, loop brackets, waveform, blips and a frame-exact export this
release. KNOWN ISSUES, alpha honesty: multi-video playback inside the
ComfyUI node surface does not hold sync reliably (browser video elements
each run their own clock; every correction strategy trades stutter for
offset), and the transport can wedge after scrubbing during playback -
re-queue or reload the page to recover. The standalone deck pages built
by `tools/compare_deck/` do not share these problems. Two more, both about
audio: in clock sync mode audio follows only the clock-owning side, so
locking audio to the other pane is silent until sync mode is flipped; and
the realtime export records audio from the locked side even when it is not
one of the two playing panes, so prefer the precise export. Planned fix,
next iteration: the node bakes each pair into ONE combined preview stream
and every view mode becomes a crop of it - one decoder, one clock, sync by
construction. Deferred with it: the player is duplicated (~330 lines)
between `web/video_compare.js` and the deck template, and a single-source
refactor is the next iteration's job (the deck's export bitrate selector
having been honored on only one of the two export paths was the first bite
of that divergence).

## Mid-denoise insert

`motion.py`, node `H3 MidInsert (alpha)`.

Inserts time-dilation tokens into a still-noisy latent at a handoff sigma
instead of between passes, with a measured variance top-up. Kept for
research honesty: at its one tested operating point (handoff sigma 0.53,
four dense steps) it breaks clip continuity in playback, and it is
documented as that negative rather than removed. Do not reach for it in
production; the two-pass insertion path is the shipped construction.

## VRAM lab instruments

`vram_lab.py`, node `H3 FakeQuant (alpha)`. `H3 Sol Attention` is in the
code but NOT registered this release.

Measurement instruments from the quantization review work: FakeQuant
fake-quantizes a chosen region of the model's activations so a precision
regime can be auditioned without real kernels; Sol Attention switches the
attention path for the same kind of audition. Instruments, not
accelerators: they exist to make honest comparison pages, and their
numbers only mean something next to a reference arm. FakeQuant ships;
Sol Attention stays unregistered until it gets the DyRoPE arm/disarm
pattern, because it rebinds attention process-globally with no restore
path.

## Attention measure (experimental)

`h3_measure.py`, node `H3 Attention Measure`. From the hold map a retime
used, it adds `strength * log(1 / duplication)` to the pre-softmax logit of
every target video key, so a temporal cell split into n near-identical
children stops collecting n times the softmax mass it represents.

Hypothesis under test, nothing measured yet: the uniform case is a no-op by
construction (`tests/test_attention_measure.py`), and whether the correction
changes a real render is exactly the open question.
