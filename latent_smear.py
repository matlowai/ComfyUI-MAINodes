"""H3LatentSmear: the time smear done on the pass-1 LATENT instead of pixels.

The pixel smear (H3TimeSmear) repeats decoded frames by a hold map and the
graph then re-encodes the dilated clip with the video VAE. That encode is the
single most expensive non-sampling stage: measured 2026-08-22 at ~0.35 s per
DILATED frame at 1.2 MP on a 96 GB card (43 s for 124 frames, 113 s for 345),
flat ~5 GiB VRAM, the same speed for the int8 and fp16 encoders. On small
cards it costs about as much as the sampling pass it feeds.

This node builds the dilated latent straight from the pass-1 tokens, so the
encode never runs. It is an APPROXIMATION of "encode the held frames": a
token covers 1 or 4 pixel frames on H3's clock (offsets 0,1,5,9,13 in every
17-frame group), so there is no token that means "frame f held four times".
Two constructions are offered and must be measured against the pixel path
(same seed) before either is trusted:

- repeat: every dilated token takes the source token that covers the source
  frame shown at the token's FIRST dilated frame (the frame H3ExactRecover
  keeps). A hold run repeats one token several times.
- lerp: each dilated token's mean world-frame position is interpolated
  between the two neighbouring source token CENTRES. This is the construction
  the T2a probe measured (2026-08-15, one clip, hold 2 x 34 frames: corr
  0.888 / nRMSE 0.44 std against the real encode of the pixel-smeared clip,
  noise null 0.00 / 1.42; decodes as motion-blur-like ghosting; nearest,
  phase-aware and box-overlap variants bought nothing). Tokens landing on a
  centre come back bit-exact; off-anchor singletons were its worst case
  (0.75). T2a also found inserted tokens want denoise >= ~0.5.

Outputs mirror H3TimeSmear exactly (same hold_map_used, same dilated length,
same tail pad rule), so H3ExactRecover, H3AudioSmear and the true-clock patch
read it unchanged. The audio half is untouched: keep H3AudioSmear ->
VAEEncodeAudio, which is cheap.
"""
import json

import torch

try:
    from .motion import (_tok_start_frame, _frame_token, _legal_ceil, _cost_report,
                         _video_component, expand_hold_map_to_end, OVERHEAD_S,
                         _cost_widgets)
except ImportError:                      # tests import top-level
    from motion import (_tok_start_frame, _frame_token, _legal_ceil, _cost_report,
                        _video_component, expand_hold_map_to_end, OVERHEAD_S,
                        _cost_widgets)

MODES = ["repeat (hold the token)", "lerp (slide between tokens)"]


def _token_count(frames):
    t = 0
    while _tok_start_frame(t) < frames:
        t += 1
    return t


def _token_span(t, frames):
    f0 = _tok_start_frame(t)
    f1 = min(_tok_start_frame(t + 1), frames)
    return f0, max(f1, f0 + 1)


def _token_centers(frames):
    """Mean pixel-frame position of every token of a legal clip (T2a's centres)."""
    return [sum(range(*_token_span(t, frames))) / float(_token_span(t, frames)[1] - _token_span(t, frames)[0])
            for t in range(_token_count(frames))]


def latent_smear_plan(holds, world_len, mode):
    """Per dilated token: (src_token_a, src_token_b, weight_b). Pure python.

    lerp is the T2a construction (benchmarks/scripts/tinterp/analyze_tinterp.py,
    MEAS 2026-08-15: corr 0.888 / nRMSE 0.44 std against the encode of the
    pixel-smeared clip): each dilated token's MEAN world-frame position,
    interpolated between the two neighbouring source token centres. A dilated
    token that covers exactly a source token's frames lands on its centre and
    comes back bit-exact (rate-1 runs are the identity)."""
    assert len(holds) == world_len, (len(holds), world_len)
    idx = [i for i, h in enumerate(holds) for _ in range(h)]   # dilated frame -> world frame
    dil = len(idx)
    t_src = _token_count(world_len)
    centers = _token_centers(world_len)
    plan = []
    for t in range(_token_count(dil)):
        f0, f1 = _token_span(t, dil)
        if mode.startswith("repeat"):
            a = _frame_token(idx[f0], t_src)
            plan.append((a, a, 0.0))
            continue
        pos = sum(idx[f0:f1]) / float(f1 - f0)
        j = 0
        while j < t_src and centers[j] < pos:
            j += 1
        if j == 0:
            plan.append((0, 0, 0.0))
        elif j >= t_src:
            plan.append((t_src - 1, t_src - 1, 0.0))
        else:
            lo, hi = centers[j - 1], centers[j]
            w = (pos - lo) / (hi - lo)
            plan.append((j - 1, j, float(w)) if w > 0 else (j - 1, j - 1, 0.0))
    return plan


class H3LatentSmear:
    DESCRIPTION = (
        "Time smear on the pass-1 LATENT: builds the dilated latent from the "
        "source tokens by the hold map, so the dilated clip is never decoded, "
        "held, and re-encoded (the VAE encode is ~0.35 s per dilated frame at "
        "1.2 MP even on a 96 GB card, and the whole bottleneck on small ones). "
        "An approximation of encoding held frames; measure 'repeat' and 'lerp' "
        "against H3 Time Smear + VAE Encode on your clip before trusting either. "
        "Drop-in: hold_map_used, length and the tail pad match H3 Time Smear, so "
        "H3 Exact Recover and H3 Audio Smear wire up the same way. Pass 2 must "
        "run at pass 1's canvas (the latent has no pixels to rescale).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT", {"tooltip": "pass-1 video latent (the same one the oracle reads)"}),
            "dilation": ("INT", {"default": 4, "min": 1, "max": 16,
                         "tooltip": "uniform hold when no hold_map is wired"}),
            "mode": (MODES, {"default": MODES[0]}),
        }, "optional": {
            "hold_map": ("STRING", {"default": "", "tooltip": "from H3 Jerk Oracle / Manual Hold Map / Motion Editor"}),
            "expand_to_end": ("BOOLEAN", {"default": True,
                              "tooltip": "same end-jump rule as H3 Time Smear"}),
            **_cost_widgets(with_fps=True),
        }}

    RETURN_TYPES = ("LATENT", "STRING", "INT", "STRING")
    RETURN_NAMES = ("samples", "hold_map_used", "length", "report")
    FUNCTION = "smear"
    CATEGORY = "latent/minimax/motion"

    def smear(self, samples, dilation, mode, hold_map="", expand_to_end=True, fps=24,
              s_per_step=0.0, est_steps=18, overhead_s=OVERHEAD_S):
        video = _video_component(samples)            # (1, 24, t_src, h, w)
        t_src = video.shape[2]
        hm = json.loads(hold_map) if hold_map.strip() else {}
        n = int(hm.get("world_len") or ((t_src - 2) // 5 * 17 + 5))
        assert _token_count(n) == t_src, (
            f"latent has {t_src} tokens, which is not world length {n} ({_token_count(n)} tokens)")
        if hm.get("legal"):
            raise ValueError("H3LatentSmear works on H3's own latent; a remapped hold map "
                             "(another model's grid) belongs with H3 Time Smear + that model's VAE")
        holds = hm["holds"] if hm else [dilation] * n
        assert len(holds) == n, f"hold map covers {len(holds)} frames, latent covers {n}"
        note = None
        if expand_to_end:
            holds, note = expand_hold_map_to_end(holds)
            if note:
                print("[MAINodes] H3LatentSmear " + note)
        target = _legal_ceil(sum(holds))
        n_held = sum(1 for h in holds if h > 1)
        holds = list(holds)
        holds[-1] += target - sum(holds)
        plan = latent_smear_plan(holds, n, mode)
        a = torch.tensor([p[0] for p in plan], device=video.device)
        b = torch.tensor([p[1] for p in plan], device=video.device)
        w = torch.tensor([p[2] for p in plan], device=video.device, dtype=video.dtype).view(1, 1, -1, 1, 1)
        za = video.index_select(2, a)
        out = za if mode.startswith("repeat") else za + (video.index_select(2, b) - za) * w
        used = dict(hm, holds=holds, world_len=n) if hm else {"holds": holds, "world_len": n}
        used = json.dumps(used)
        tag = ("uniform x{}".format(dilation) if not hold_map.strip()
               else "adaptive, {} of {} frames held".format(n_held, n))
        report = _cost_report(n, target, fps, s_per_step, est_steps, overhead_s,
                              tail=tag + "; latent " + mode.split(" ")[0] + ", no VAE encode")
        if note:
            report += "\n" + note
        result = dict(samples)
        result["samples"] = out.contiguous()
        return (result, used, int(target), report)


NODE_CLASS_MAPPINGS = {"H3LatentSmear": H3LatentSmear}
NODE_DISPLAY_NAME_MAPPINGS = {"H3LatentSmear": "H3 Latent Smear (no encode) [alpha]"}
