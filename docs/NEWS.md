# What's new in MAINodes

Newest first. The README carries only the latest headline.

**Dials: the Simple front door, and review fixes** (2026-11-02, alpha). One Render Preset node now switches the whole
render recipe (model, LoRA, shifts, FL2V or Ref2V, sampler, schedule, de-rope steps, cfg; *Pika H3 Flex*, *Pika +
reference pictures*, *DMAD speed LoRA*, or Save as your own), H3 De-rope Sigmas builds the de-rope schedule from it, and
one blueprint (`Dials - H3 + De-rope`) takes the prompt and de-rope choice (off, oracle, flat). Make Dial from Pictures
takes folders inside `input/`; Combine Dials is an output node. Fixes: video dials sampled the wrong frames at frame
rates other than 24 fps; post dials missed clones carrying their own model copy; the rack re-runs when a dial file it
names is saved again; Make Dial encodes every prompt before loading the model, so a low-VRAM encoder load can no
longer evict it. The first Simple workflow moved to `examples/dials/_archive/`.
Guide: [`dials/README.md`](../dials/README.md#simple-start).

**Dials 1.2.0** (2026-11-01, alpha). Training-free steering sliders, merged from the `dials-rack` branch: the Dial Rack
(map, interaction matrix, influence wheel), the dial editor, picture dials, per-block strengths, clip-time curves with a
mouse editor, the hold-map link for de-rope, and MOSS-Image / Krea 2 detection. Guide: [`dials/README.md`](../dials/README.md).


**Repair, a per-block clock, and the chaining nodes** (2026-08-24, alpha).
Five additions, all opt-in and all alpha. `H3 Repair Plan` / `H3 Repair
Splice` re-render a few bad frames of a finished clip and hand back the same
clip with only those frames different ([details](MOTION_LAB.md#repairing-a-few-bad-frames)).
`H3 DyRoPE` gives the true-duration RoPE clock to SOME blocks or SOME steps
instead of all of them, which is what separates the timing correction from
the flash and jitter it used to cost
([details](MOTION_LAB.md#dyrope-who-gets-the-true-clock)). `H3 V2V Init` grew
`audio_prefix_ticks`, the audio twin of the video prefix freeze, so a
continuation can carry the previous segment's sound across the join
([details](MOTION_LAB.md#anchoring-audio-across-a-join-alpha)). `H3 Drift Control` and
`H3 Delta Color Carry` attack the two things that decay down a chain of
segments, clean-conditioning error and VAE round-trip colour
([details](MOTION_LAB.md#chained-segments-drift-and-colour-alpha)). And window mode, the
excerpt-shaped graph where only part of a long clip is retimed, finally has
a page: [docs/WINDOW_MODE.md](WINDOW_MODE.md).

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
Encoder`. All opt-in, nothing changes unless the node is in the graph. The
memory numbers behind them are in the docstrings of `vram_lab.py`; the
small-card recipe, what to expect and the environment it was measured in are
in [LOWVRAM.md](../LOWVRAM.md), with the example graph
`examples/motion_pipeline_lowvram.json`; the alpha status is in
[ALPHA.md](../ALPHA.md#vram-lab). Evening additions: two opt-in K/V store
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
[Dialogue through a de-rope](MOTION_LAB.md#dialogue-through-a-de-rope) for the three nodes
to add to a graph you already have.

**The graph to start from** is
[`motion_pipeline_ref2va_audioinit.json`](../examples/motion_pipeline_ref2va_audioinit.json):
full-reference mode with the audio init wired, 12 steps on the base model for
pass 1 and the turbo LoRA at 6 steps for the de-rope. On 192 frames at 1 MP
that is **12 minutes end to end**, against 36 for the same graph at 25 steps
both passes without turbo. The audio init itself is free in both currencies,
costing no measurable time and no measurable sharpness.
