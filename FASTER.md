# FASTER.md, or: how to make it less awesome but still better than nothing

The Motion Lab defaults are tuned for quality. Every dial below trades some of
that quality for wall-clock time, in descending order of how much time it buys.
Numbers come from measured runs on the example scenes; your content will move
them, the ordering should hold. The plan report prices most of these before you
spend a second of GPU: queue the windowed graph with `window: 0`, read the
report, then decide.

## Where the time actually goes

A de-rope render is pass 1 (generate) plus pass 2 (regenerate the dilated
timeline at higher effective resolution). Pass 2 dominates, and its cost is
roughly quadratic in token count: tokens = frames x pixels. So the dials that
remove frames or pixels beat the dials that make steps cheaper.

## The dials, best value first

| dial | where | default | cheaper setting | what you give up |
|---|---|---|---|---|
| `dilation` / `d_max` | H3 Time Smear / H3 Jerk Oracle | 4 | 3 or 2 | the slow-motion budget on bursts; 2 still beats no de-rope by a wide margin |
| `q` | H3 Jerk Oracle | 0.75 | 0.85 | fewer frames count as bursts, so borderline motion stays baseline |
| `expand_to_end` | H3 Time Smear | on in some graphs | off | the span after the last burst stays baseline; fine when the tail is calm |
| `inject` | H3 Inject Schedule | 0.45 | keep 0.45 | it is already the cheap setting: only the steps below the inject point run. 0.7 is the deeper, slower variant |
| pass 2 resolution | the second ResolutionSelector | 1.5 MP | 1.0 MP | the upscale half of upscale-de-rope; tokens scale with pixels |
| `coverage` | H3 Window Plan | full clip | burst only | on NON-upscale graphs only: calm spans keep their baseline render. On upscale graphs leave it on full clip or calm spans stay low-res |
| `kv_store` | H3 Streamed Blocks | kvi8r | kvi8s | needs the sageattention package; measured 219 vs 318 s/step at long context, judged side by side as a keeper |
| `handle_frames` | H3 Window Plan | 12 | 8 | less duplicated context at window seams; the edge pins carry more of the tracking load |
| `steps` (pass 1) | BasicScheduler | 12 (fast flow) | 12 | going below 12 shows; save elsewhere first |

## What not to touch

- The window edge pins (`MiniMax H3 Add Guide` at the first and last frame).
  They cost nothing measurable and they are what holds the regenerated windows
  on the baseline's motion and look.
- The audio seed (`H3 Audio Smear` into `H3 V2V Init`). Also near-free, and
  pass 2's foley tracks the original performance because of it.
- `max_dilated_frames` does not buy total time. Smaller windows lower the PEAK
  cost so a smaller card can run at all; the total goes slightly up from
  duplicated handles.

## A worked example

The rolling-window example scene (107 frames, 4.5 s) plans 243 dilated frames
at the defaults: 2.27x the frames and 4.0x the time per step of a plain pass.
Dropping `d_max` to 3 and `q` to 0.85 with `expand_to_end` off re-plans the
same clip in the low 100s of dilated frames; the burst keeps its slow-motion
budget and the calm frames stop paying for it. Queue with `window: 0` and the
report will show you the exact count for your clip before you commit.
