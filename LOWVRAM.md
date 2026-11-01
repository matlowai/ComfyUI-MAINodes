# Low VRAM, low RAM: the de-rope on a 16 GB card

Status 2026-08-18: alpha. Measured on one machine fenced down to a 16 GB
card / 32 GB box (how, and how the fence was read, at the bottom); not yet
run on a physically different 16 GB card, which is the next thing.

**Get started** (16 GB card, 32 GB machine; measured, alpha):

1. Start ComfyUI **without** `--gpu-only` and **with**
   `--fast-disk --fp16-intermediates --disable-pinned-memory` (and
   `--cache-none` if RAM is tight; it re-runs every node on each queue).
   What each does, measured on the 702-frame de-rope (RSS peak, same VRAM and
   speed in every case): fp32 IMAGEs and a pinned DiT = 41.9 GB; `--fp16-intermediates`
   halves every held IMAGE = 31.8; `--disable-pinned-memory` drops the DiT's
   ~10 GB pinned staging copy = 21.6; `--cache-none` frees node outputs after
   their consumers = 24.2 alone, **14.6 GB with all four**. `--fast-disk` reads
   the weights from the NVMe page cache instead of RAM copies. Speed did not
   move (369-374 s/step throughout).
2. Load `examples/motion_pipeline_lowvram.json` (API twin alongside), point
   the LoadImage at your reference, set the prompt and canvas.
3. Queue. The 124-frame reference clip takes about 7 minutes end to end on
   the fenced 15 GiB card (RSS 25 GB).

If `H3 Streamed Blocks` is not in the node search (category `MAINodes/VRAM
Lab`, display name "H3 Streamed Blocks (exact low-VRAM, alpha)"), look at
the ComfyUI console for one line at startup: `[MAINodes] vram_lab not
loaded: ...`. The module needs a recent ComfyUI (developed on 0.33.0; it
imports `comfy.ldm.minimax.model` and comfy_kitchen's native rope op via
`comfy.quant_ops.ck`) and PyTorch flash attention; the pack loads the rest
of its nodes without it and prints why. Paste that line in an issue.

**What the graph does to make a small card happy:**

- the DiT at 4-bit weights / 8-bit activations (`minimax_h3_ref2va_pruned_w4a8_mixed`, 11 GB), the text encoder in NVFP4, the video VAE as int8_convrot (2.2 GiB less than fp16, decode 1.5x faster, 60 dB PSNR against it);
- `H3 Streamed Blocks` runs every DiT block in 16k-token chunks so the whole-sequence QKV and SwiGLU tensors (8.6 and 15.4 GiB at 217k tokens) never exist, and streams the output head; same math as stock (bit-equal on int8 / W4A8 with the exact K/V store);
- **`kv_store` = kvi8r**: the K/V of the whole sequence held as rotated int8, forward peak +9.5 GiB at 217k tokens instead of +11.9 (with `trim_forward`, on by default, another 2.3 GiB comes off); a sibling take of the exact result that passed the operator's eyes on the de-rope ("perfect for both"); flip it to `bf16 (exact)` for the bit-equal path;
- `H3 Evict Text Encoder` after each prompt encode, `H3 Free Cache` before the pass-2 decode: the 15 GB TE and the allocator pool leave the card before the VAE needs it;
- the turbo LoRA with a 12-step base pass and a 6-step / inject 0.7 de-rope pass, so the long pass is a handful of forwards.

Everything below is the why and the numbers.

## The workflow that ships: `examples/motion_pipeline_lowvram.json`

On a Blackwell card there is a free speed lever on top of all of this: swap
the example's W4A8 UNET for the NVFP4 build
([MATLOWAI/minimax-h3-nvfp4](https://huggingface.co/MATLOWAI/minimax-h3-nvfp4)).
Same file size, measured 0.84 to 0.91x wall on 25-step graphs and 0.88x with
the turbo LoRA stacked, stock ComfyUI. A same-seed render is a sibling take;
judge it on your own content. Non-Blackwell cards should not use it.

Two things the example already includes that are easy to miss: the AUDIO INIT
(`H3 V2V Init` takes the source performance's audio latent at strength 0.5, so
pass 2 follows the original delivery) and the smear-aware audio recover. For
clips whose dilated pass does not fit your card in one piece, the same stack is
wired into the windowed graph:
[`examples/motion_pipeline_rolling_window_lowvram.json`](examples/motion_pipeline_rolling_window_lowvram.json)
(API twin alongside; plan report first, then queue per window; inject 0.48). Each
window pins its first and last frame to the baseline via `MiniMax H3 Add Guide`,
which holds the regenerated windows on the baseline's motion and look so the
splice seams carry no state jumps; the pin frames come straight from
`H3 Window Plan`'s first/last frame outputs.

One graph, the whole motion pipeline for a small card, with the rotated int8
K/V store on. What is in it and why, in the order it runs (2026-08-18):

| node | setting | what it buys |
|---|---|---|
| `UNETLoader` | `minimax_h3_ref2va_pruned_w4a8_mixed` (11 GB) | the DiT at 4-bit weights / 8-bit activations, exact under chunking (int32 accumulate) |
| `CLIPLoader` | `qwen3vl_32b_minimax_h3_nvfp4_awq` | the text encoder in NVFP4 (~15 GB file) |
| `VAELoader` (video) | `minimax_h3_video_vae_int8_convrot` | 2.2 GiB less on the card than fp16, decode 1.5x faster, 60 dB PSNR against the fp16 decoder on the same latent |
| `VAELoader` (audio) | `minimax_h3_audio_vae_fp32` | unchanged, 0.6 GB |
| `LoraLoaderModelOnly` | lightx2v turbo 4-step v1.0 768p, strength 1.0 | pass 1 at 12 steps (`linear_quadratic`), pass 2 on a 6-step `beta` schedule with `inject 0.7` (the "faithful detail" preset), so the long de-rope pass costs a handful of forwards |
| **`H3 Streamed Blocks`** | q/kv/mlp chunks 16384, `min_tokens` 32768, `final_layer_chunk` 16384, `final_layer_gemm` exact, **`kv_store` = kvi8r** | every DiT block in token chunks (never the whole-sequence QKV or SwiGLU), the output head streamed, and the K/V of the whole sequence held as rotated int8: forward peak +9.5 GiB at 217k tokens instead of +11.9 (exact store) or +21 (stock). Bit-equal to stock with `kv_store` = bf16; with kvi8r a sibling take that the operator judged "perfect for both" on the de-rope side by side |
| `H3 Evict Text Encoder` (x2) | after each prompt encode | the 15 GB TE leaves the card as soon as its conditioning exists (1 to 2.5 GiB of peak on a 16 GB card, ~3 s per new prompt to bring back) |
| `H3 Jerk Oracle`, `H3 Time Smear`, `H3 Audio Smear`, `H3 V2V Init` | `d_max 4`, dilation 4, audio 0.5 | the de-rope itself (see [Motion Lab](docs/MOTION_LAB.md)) |
| `H3 Free Cache` | between the pass-2 sampler and its decodes | returns the allocator pool before the VAE runs (17 GiB on the long pass under `--gpu-only`; the small-card win is that decode never competes with a stale pool) |
| `H3 Exact Recover`, `H3 Audio Recover` | | back to real time, frame-exact |

Measured as it ships (kvi8r + int8 VAE) at the 15.0 GiB fence / 48 GB
cgroup: the 124-frame reference clip end to end in **6:56**, VRAM 15.4 (the
fence, filled during the TE load), torch reserved max 6.2 GiB, RSS 25.2 GB,
zero allocator trims; pass 1 14.2 s/step, the de-rope pass 56 s/step. (With
the exact store and the fp16 VAE at the earlier 15.4 fence: 6:14, RSS 24.8.)
On the 702-frame de-rope, a bigger graph than this example, the exact store
no longer fits at 15.0 GiB while kvi8r (374 s/step) and kvi8s (219) render.

The KJNodes sage-attention patches and FFN chunker from the parent graph
are not in it: sage attention is an approximation and the exactness gates
here were run on PyTorch's flash attention.
3. Set your prompt, reference image and canvas as usual.

## What to expect

**VRAM.** The activation peak inside a forward is card-independent:
`0.3 GiB + ~53 KB per packed token` (K/V buffers 28.7 KB/token, the residual
10.8, chunk transients and two tensors ComfyUI's forward keeps alive).
At 702 frames / 217k tokens that is +11.9 GiB. Dynamic VRAM fills whatever is
left with resident weights, so the process peak reads close to the card size
on every card; what decides whether a length fits is `weights it must keep +
activations + ~1 GB context`. Measured: 702 frames fits a 16 GB card, 906 does
not (275k tokens: +14.9 GiB of activations plus the minimum resident weights).
Frames here are 1376x768; other canvases scale by tokens
(`latent_frames x (W/32) x (H/32)`).

**RAM. This is the tight budget, not VRAM.** With `--fast-disk`, process RSS
was 27.4 GB on the 16 GB card and 25.8 GB on the 24 GB card for a single
702-frame pass, 36 to 40 GB for the full de-rope pipeline (it holds the pass-1
decodes, the smear IMAGE, the heat map: a 702-frame fp32 IMAGE is 8.9 GB), and
59 GB without `--fast-disk`. Add your own headroom: an idle Ubuntu desktop is
~2 GB, an idle Windows 11 desktop 4 to 8 GB, ComfyUI itself 3 to 5 GB before
any model. So, measured: a single 702-frame pass and the 124-frame example
graph fit a 16 GB card + 32 GB RAM (lean Linux; already paging on Windows);
**the full 702-frame de-rope pipeline does not fit 32 GB** (it was OOM-killed at
the smear under a 32 GB fence, 2026-08-18 19:00) and needs ~48 GB today, 64 GB
to be comfortable. Holding intermediates as fp16/uint8 by consumer type is
the next change and should bring the full pipeline back under 32 GB. Under our 64 GB fence
the kernel reclaimed page cache before killing anything; a Windows box would
pagefile instead, which is slower but alive.

**Time.** 316 to 318 s per pass-2 step at 217k tokens on the fenced 16, 24 and
32 GB cards versus 311 resident on 96 GB. On the 90-frame clip the 16 GB card
did 8.2 s/step. The text encoder costs 3 to 4.5 s per new prompt from a warm
page cache (a cold read of the 15 GB file is longer), and 1 to 2.5 GiB of
VRAM peak on a 16 GB card, which the evict node removes.

**The text encoder on tiny cards**, measured on the fenced 16 GB card, 90 frames:

| arm | wall | encode | VRAM peak | RSS |
|---|---|---|---|---|
| stock CLIPLoader | 221 s | 3.0 s | 15.7 | 14.3 |
| second prompt in the same process | 218 s | 1.7 s | 16.6 | 15.5 |
| `H3 Evict Text Encoder` after the encode | 221 s | 3.1 s | 13.9 | 14.7 |
| `CLIPLoader device=cpu` | 272 s | 55 s | 14.0 | 26.9 |
| conditioning bank hit (encoder never runs) | 218 s | none | 14.7 | 12.4 |

Nothing thrashed. Evict is the default in the example graph because a normal
run types a new prompt; `H3 Conditioning Bank` is for repeated prompts (seed
hunts, windows, extension chains) and needs the sampler's latent to come from
somewhere other than the encode node (`EmptyMiniMaxH3LatentAV` for T2VA, the
latent bank for a banked pass 1), or the encode node runs anyway for its
latent output.

## The numbers

The de-rope pass at `d_max 4` on an 8 to 12 second clip is ~200k packed tokens.
The stock H3 block builds its fused QKV and SwiGLU tensors for the whole
sequence at once, 8.6 and 15.4 GiB at that length, and that is what OOMs a
24 GB card, and at 1376x768 a 96 GB one. `H3 Streamed Blocks` runs every DiT
block in token chunks with the same math. Together with two things ComfyUI
already ships (dynamic VRAM, `--fast-disk`) it changes the small-card story
from "OOM" to "same speed":

| card | machine | 294 f -> 702 f de-rope at 1376x768 (~217k tokens) | s/step (pass 2) |
|---|---|---|---|
| 96 GB, everything resident (`--gpu-only`) | 91 GB | renders | 311 |
| 32 GB (fenced), normal mode, `--fast-disk` | 64 GB (cgroup) | renders, 25 GiB VRAM peak | 318 |
| 24 GB (fenced) | 32 GB (cgroup) | renders, 23.5 GiB VRAM peak, 25.8 GB RSS | 318 |
| **16 GB (fenced)** | **32 GB (cgroup)** | **renders, 15.5 GiB VRAM peak, 27.4 GB RSS** | **316** |
| **15.0 GiB fence (a 5070 Ti with its desktop up)** | 48 GB (cgroup) | exact store: **out of memory** at the second forward (+12.1 GiB needed above the resident weights, 1990 allocator trims first); **kvi8r: renders** (+9.5 GiB, 22:33); **kvi8s: renders** (+9.5 GiB, 14:50); **kvi8s + `trim_forward`: renders with zero allocator trims (+7.2 GiB, 14:51)** | exact - / kvi8r 374 / kvi8s 219 |
| 16 GB (fenced) | 32 or 64 GB | 906 f (~275k tokens): out of memory | |
| 24 GB (fenced) | 32 GB | 906 f: renders, RSS 29.8 GB (RAM at the edge) | 515 |

Same seed, the streamed result is bit-equal to the stock result on the int8
and W4A8 checkpoints (video and audio latents compared tensor by tensor). It
is not a quality dial. It is also not slower: at these lengths the step is
attention-bound and the weight traffic hides under it (see "Why no speed
penalty").

## How far you can go (extrapolated from the lines above)

The activation line predicted the 906-frame point on the 24 GB card before it
was measured (14.9 GiB both ways), so the table below is the line, not a
guess; treat it as +-1 frame-block. "Max tokens" assumes dynamic VRAM keeps
the minimum of resident weights (2 to 3 GB measured) and ~1 GB of context.

| card | max packed tokens | frames at 1376x768, single de-rope pass | RAM at that length, single pass / full pipeline |
|---|---|---|---|
| 16 GB | ~230k | ~740 (measured: 702 renders, 906 does not) | ~28 / ~40 GB |
| 24 GB | ~380k | ~1230 (measured: 906 renders at 515 s/step) | ~33 / ~45 GB |
| 32 GB | ~530k | ~1720 | ~39 / ~51 GB |

RAM per frame is ~12 MB (one fp32 IMAGE at 1376x768) on top of a ~19 GB base
for a single pass with `--fast-disk`; the full pipeline holds two to three
more IMAGEs of the clip. Past ~1100 frames the step time (attention grows with
the square of the sequence: 316 s at 702 frames, 515 at 906, ~650 at 1110)
is the practical limit before memory is. Other canvases: convert to tokens
with `latent_frames x (W/32) x (H/32)`, where `latent_frames = (frames-5)/17*5+2`.

**The example graph itself, end to end on the fenced 16 GB card in a 32 GB
machine** (2026-08-18 18:25): rendered in 6:14 wall. Pass 1 (Ref2VA, 12 base
steps, 124 frames) 147 s, oracle + smear + audio smear + VAE encode 30 s,
pass 2 (6 turbo steps) 150 s, decode 21 s, recover and three saves. Process
VRAM peak 16.1 GiB (dynamic VRAM sized itself to the card), RSS peak 24.8 GB,
cgroup peak 30.9 GB (RSS plus the reclaimable page cache of the weight files:
that is how little air a 32 GB box has even at 124 frames). The text encoder
held 13 GB of the card until `H3 Evict Text Encoder` freed it
(`device free 1.3 -> 14.6 GiB`).

## Why no speed penalty

At 217k tokens about 250 of the ~315 seconds per forward are attention, which
grows with the square of the sequence. Streaming the whole 11 to 12.5 GB DiT
once per forward is ~0.5 s over PCIe from RAM and ~2 s from an NVMe page
cache, and dynamic VRAM prefetches the next layers while the current ones
compute. Weight traffic is a fixed cost per forward; attention is quadratic;
the long clip hides the traffic completely, and on the short one prefetch
did the same (8.2 s/step on 16 GB versus ~9 resident on 96 GB). This box has
PCIe 5 x16 and a fast NVMe; a PCIe 4 desktop halves the bandwidth, which is
still nothing against a 300 s step. A machine whose RAM cannot hold the
weight file's page cache and whose SSD is slow could show it on short clips.

## The K/V store options (approximation tier, default off)

At 217k tokens the exact block's forward peak is +11.9 GiB above the resident
weights, and 5.8 GiB of that is the K/V of the whole sequence held in bf16
while the query chunks attend against it. `H3 Streamed Blocks` has a
`kv_store` option with two ways of halving those bytes. Neither is bit-equal
to stock: a same-seed render is a sibling take. The node's default is the
exact store; the low-VRAM example graph ships with kvi8r on (operator's
call); kvi8s has now been rendered and seen ("looks perfect", 219 s/step
against kvi8r's 374) and is the faster option for anyone with the
`sageattention` package installed; the example keeps kvi8r because it needs
no extra package.

| `kv_store` | what it is | forward peak at 217k tokens | s/step (pass 2, 702 f de-rope) | quality so far |
|---|---|---|---|---|
| `bf16 (exact)` | stock math, chunked | +11.9 GiB | 318 | bit-equal |
| `kvi8r: rotated int8 K/V` | K and V int8 with one fp16 scale per (token, head) row, in a fixed Hadamard-rotated basis of the head dim; the query chunk is rotated to match and the output un-rotated once, so a K/V block dequant is one int8->fp16 cast times a scale, no GEMM; attention in fp16 blockwise (`kv_block`, default 16384) with an online-softmax combine | **+9.5 GiB** (second cut, measured live 2026-08-18 evening; the first cut was +12.5) | **374** (first cut 400) | first cut: operator's eyes "almost perfect" on the de-rope side by side, "looks fine" on a 90 f T2VA; second cut: side by side rendered, verdict pending; sensor bank over seeds owed |
| `kvi8s: Sage int8/fp8 K/V, rotated` | the same bytes kept in SageAttention's kernel layout (int8 K with one scale per 64-token block after mean smoothing, fp8 e4m3 V per channel), Q and K Hadamard-rotated first, attended on int8/fp8 tensor cores straight from the store, no dequant; needs the `sageattention` package (2.x, sm120 works) | **+9.5 GiB** (measured live 2026-08-18 evening) | **219** (31% faster than the exact store, 42% faster than kvi8r) | one rung more approximate than kvi8r on a synthetic proxy (rel-rms 3.1e-2 vs 1.3e-2; the shipped `sageattn()` scores 5.5e-2 on the same inputs, so the rotation is worth 1.8x to Sage); operator's eyes on the de-rope side by side: "looks perfect" (one clip, one viewer; sensor bank over seeds owed) |

Why the rotation: the fixed orthonormal Hadamard spreads the outlier channels
of K and V over all 128 dims before rounding, so a per-row int8 scale wastes
less range; scores are invariant (q.k = (qH).(kH)) and P.V comes back through
H^T once on the output. Why fp16 and not bf16 inside kvi8r: in the rotated
basis every value has the same magnitude and bf16's 8-bit mantissa alone costs
a 4.8e-3 rel-rms floor; fp16's 11 bits cost 1.7e-3 (measured on random data).

## What is exact, and what is not

- `H3 Streamed Blocks` on int8 and W4A8 checkpoints: bit-equal to stock. The
  mechanism is that comfy_kitchen quantises activations per row and the int8
  GEMM accumulates in int32, which is associative, so chunking rows cannot
  change the sum. NVFP4/FP8 would need one shared activation scale and are
  untested; bf16 checkpoints are numerically equivalent (fp accumulation
  order), not identical.
- Query chunking is exact only while every chunk keeps PyTorch's flash
  kernel off its split-KV path (measured boundary `heads x ceil(L/64) >=
  0.8 x 2 x SMs`; a 259-token tail once made a different clip). The node sizes
  chunks from the SM count with a 2.6x margin and has a `self_check` that
  compares stock and streamed on the first block's real input.
- The output head has an exact mode (default) and a chunked-GEMM mode that
  differs by ~1e-6 per step in fp32 and produced a different clip after 25
  steps. It is labelled and off. `kv_block` on the exact store is experimental
  and as built does not lower memory; leave it at 0 (it is the block size for
  the kvi8r store).
- `H3 Free Cache` and `H3 Evict Text Encoder` change no math.
- `trim_forward` (default on) runs a copy of the stock model forward that
  releases the patch-embed buffers once the packed sequence is assembled
  (stock holds them for the whole forward: 2.3 GiB at 217k tokens, measured
  live). Same math, bit-equal on the patcher gate; it checks the installed
  ComfyUI's forward against the copy by source hash and switches itself off
  with a log line if ComfyUI has changed. With kvi8s it takes the forward
  peak to +7.2 GiB (the streamed output head is now the peak, not attention).
- The int8_convrot video VAE is an approximation by construction (60 dB PSNR
  against the fp16 decoder on the same latent, encoder identical); the fp16
  VAE is what the exactness gates were run with.

## What is next (the roadmap, in the order it will be tested)

1. **Host RAM was the binding limit on the small machine; four flags moved it.**
   Every held IMAGE is 8.9 GB per 702 frames at 1376x768 in fp32, ComfyUI pins
   a ~10 GB staging copy of the DiT, and the execution cache holds every
   output until the prompt ends: 41.9 GB. With `--fp16-intermediates
   --disable-pinned-memory --cache-none` (all measured one at a time and
   together) the same pipeline peaks at 14.6 GB. Note the fp16 IMAGE is
   normalised in fp16 before the encoder, so the pass-2 result is a sibling
   take of the fp32 run (28 dB between them, judged equal by eye). What is
   left for code: streaming the smear straight into the encoder (never
   holding the dilated IMAGE), uint8 for view-only outputs, and an fp32
   normalise on the encode input if anyone wants the fp32 sibling back. VAE
   activations themselves are not the problem (0.6 GiB decode / 2.2 GiB
   encode transient at the 256 px tiles).
2. **kvi8s live**, then the sensor bank over seeds for both stores; a per-32-value
   scale variant of kvi8r (finer than per row); fp8 K/V if a kernel takes it
   without dequant; int4/nvfp4 K/V behind the same gate.
3. **The weight side**: where the streamed block forces extra weight decode
   per token chunk (W4A8's int4->int8 decode is repeated per chunk: measured
   +25% wall at 29k tokens, +6% at 217k); decode once per block and reuse,
   larger chunks where the flash split-KV rule allows, kitchen's fused paths
   (SwiGLU fold, `convrot_w4a4` for the MLP).
4. **A real 16 GB card**, someone else's, end to end on the example graph.
5. Later, after the static rungs: dynamic precision routing (per block, per
   step, FP4 vs FP8 by measured reconstruction error; the first experiment is
   a heatmap on real activations, no kernels), and the ViT VAE decoder's own
   low-bit rungs (already on int8 tensor cores in the int8_convrot file; the
   remaining case is speed, ~40 s per 702 f decode).

## The environment this was measured in

Everything below was measured on one
machine, fenced down to look like small ones (real renders on the real GPU with
the VRAM held by a balloon and the RAM capped by a cgroup). **How the fence
was read:** the first day's "16 GB" rows ran with 15.4 GiB device-free as
`torch.cuda.mem_get_info` sees it (a headless 5070 Ti reports 15.92 GiB total
and about 15.5 free); the evening's kvi8r run used a stricter 15.0 GiB fence,
which is a 5070 Ti with its desktop attached. Dynamic VRAM fills whatever the
card has, so process peaks always read as the fence; the numbers that carry a
memory claim are the in-process forward peaks from `H3 Memory Probe`. Nothing
has been run on a physically different 16 GB card yet; that is the next thing,
and it is a dogfood ask, not a research question.

One workstation: two RTX PRO 6000 Blackwell (96 GB, 188 SMs), EPYC 9554,
91 GB RAM, NVMe, Ubuntu, ComfyUI 0.33.0, PyTorch 2.14 nightly cu132,
comfy_kitchen native ops, PyTorch flash attention (comfy default), MiniMax-H3
W4A8 and int8 checkpoints. Small cards were simulated by holding VRAM with a
balloon process so ComfyUI, dynamic VRAM and torch all saw a real 16 / 24 /
32 GB card; small machines by running ComfyUI in a cgroup with a hard memory
limit and swap off. Only ComfyUI ran during the measurements. Not measured:
Windows, other GPUs, ROCm, non-flash attention backends, real PCIe 4 boxes.

The graph of the lines (VRAM activation line with per-card ceilings, RSS by
graph type) is `LOWVRAM_lines.html` next to this file; it grows as the sweep
does.
