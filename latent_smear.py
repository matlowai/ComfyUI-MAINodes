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

MODES = ["repeat (hold the token)", "lerp (slide between tokens)",
         "hermite (curve through four tokens)", "flow (warp along latent motion)"]


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
            if w <= 1e-6:
                plan.append((j - 1, j - 1, 0.0))        # exactly on a source centre
            elif w >= 1.0 - 1e-6:
                plan.append((j, j, 0.0))
            else:
                plan.append((j - 1, j, float(w)))
    return plan


def latent_confidence(plan, holds, world_len):
    """Per dilated token, how much to trust the constructed latent, in [0, 1]:
    1.0 = an exact source token (w == 0, and the source frame sits at a token
    centre); interpolated tokens score 1 - 2*min(w, 1-w) (mid-way = 0); tokens
    whose frames straddle a hold transition lose another half. The MASK built
    from it (1 - confidence) tells H3V2VInit where to let pass 2 regenerate."""
    idx = [i for i, h in enumerate(holds) for _ in range(h)]
    dil = len(idx)
    conf = []
    for t, (a, b, w) in enumerate(plan):
        c = 1.0 if (a == b or w <= 1e-6) else 1.0 - 2.0 * min(w, 1.0 - w)
        f0, f1 = _token_span(t, dil)
        hs = {holds[idx[f]] for f in range(f0, f1)}
        if len(hs) > 1:
            c *= 0.5
        conf.append(max(0.0, min(1.0, c)))
    return conf


def _lk_flow(a, b, iters=3, win=5, levels=3):
    """Lucas-Kanade flow a->b on latent maps (C, H, W), all channels as
    constraints, coarse-to-fine. Returns (2, H, W) in pixels of the latent grid.
    Tiny on purpose: an 80x60 field is the whole problem at 1.2 MP."""
    import torch.nn.functional as F
    C, H, W = a.shape
    import math as _m
    levels = max(1, min(levels, int(_m.log2(max(min(H, W) // 4, 1))) + 1))   # never pool below ~4 px
    pyr = []
    aa, bb = a[None], b[None]
    for l in range(levels):
        pyr.append((aa[0], bb[0]))
        if l < levels - 1:
            aa = F.avg_pool2d(aa, 2, ceil_mode=True); bb = F.avg_pool2d(bb, 2, ceil_mode=True)
    flow = torch.zeros(2, pyr[-1][0].shape[1], pyr[-1][0].shape[2], dtype=a.dtype, device=a.device)
    for l in range(levels - 1, -1, -1):
        al, bl = pyr[l]
        h, w = al.shape[1], al.shape[2]
        if flow.shape[1] != h or flow.shape[2] != w:
            flow = F.interpolate(flow[None], size=(h, w), mode="bilinear", align_corners=False)[0] * (h / flow.shape[1])
        for _ in range(iters):
            bw = _warp(bl, flow)                                   # b sampled at x+flow
            gy, gx = torch.gradient(bw, dim=(1, 2))
            it = bw - al
            Ixx = F.avg_pool2d((gx * gx).sum(0, keepdim=True)[None], win, 1, win // 2)[0, 0]
            Iyy = F.avg_pool2d((gy * gy).sum(0, keepdim=True)[None], win, 1, win // 2)[0, 0]
            Ixy = F.avg_pool2d((gx * gy).sum(0, keepdim=True)[None], win, 1, win // 2)[0, 0]
            Ixt = F.avg_pool2d((gx * it).sum(0, keepdim=True)[None], win, 1, win // 2)[0, 0]
            Iyt = F.avg_pool2d((gy * it).sum(0, keepdim=True)[None], win, 1, win // 2)[0, 0]
            det = Ixx * Iyy - Ixy * Ixy + 1e-6
            du = -(Iyy * Ixt - Ixy * Iyt) / det
            dv = -(Ixx * Iyt - Ixy * Ixt) / det
            flow = flow + torch.stack([du, dv]).clamp(-4, 4)
    return flow


def _warp(x, flow):
    """Sample x (C, H, W) at position + flow (2, H, W): x_warped(p) = x(p + flow(p))."""
    import torch.nn.functional as F
    C, H, W = x.shape
    ys, xs = torch.meshgrid(torch.arange(H, dtype=x.dtype, device=x.device),
                            torch.arange(W, dtype=x.dtype, device=x.device), indexing="ij")
    gx = (xs + flow[0]) / max(W - 1, 1) * 2 - 1
    gy = (ys + flow[1]) / max(H - 1, 1) * 2 - 1
    grid = torch.stack([gx, gy], -1)[None]
    return F.grid_sample(x[None], grid, mode="bilinear", padding_mode="border", align_corners=True)[0]


def flow_between(z0, z1, w):
    """Motion-compensated in-between of two latent frames (C, H, W) at fraction
    w of the way from z0 to z1: warp each endpoint toward the other along the
    estimated latent flow and blend. Large displacements become displacement,
    not a double exposure."""
    if min(z0.shape[1], z0.shape[2]) < 8:          # nothing to estimate motion on
        return z0 * (1.0 - w) + z1 * w
    f01 = _lk_flow(z0, z1); f10 = _lk_flow(z1, z0)
    # _lk_flow solves b(x + f01(x)) = a(x): content at x in z0 sits at x + f01 in z1.
    # The in-between frame is that content moved w of the way: I(p) = z0(p - w*f01).
    a = _warp(z0, -f01 * w)          # z0's content pushed forward by w of its motion
    b = _warp(z1, -f10 * (1.0 - w))  # z1's content pulled back by the rest
    return a * (1.0 - w) + b * w


def hermite_between(zm, z0, z1, z2, w):
    """Catmull-Rom through z0, z1 with tangents from the neighbours (zm, z2)."""
    m0 = (z1 - zm) * 0.5; m1 = (z2 - z0) * 0.5
    w2, w3 = w * w, w * w * w
    return ((2 * w3 - 3 * w2 + 1) * z0 + (w3 - 2 * w2 + w) * m0
            + (-2 * w3 + 3 * w2) * z1 + (w3 - w2) * m1)


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

    RETURN_TYPES = ("LATENT", "STRING", "INT", "STRING", "MASK")
    RETURN_NAMES = ("samples", "hold_map_used", "length", "report", "regen_mask")
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
        legal = hm.get("legal")
        if legal and tuple(legal) != (17, 5):
            raise ValueError("H3LatentSmear works on H3's own latent (17k+5 grid); this hold map was "
                             f"remapped to another model's grid {list(legal)} and belongs with "
                             "H3 Time Smear + that model's VAE")
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
        if mode.startswith("repeat"):
            out = za
        elif mode.startswith("lerp"):
            out = za + (video.index_select(2, b) - za) * w
        else:
            cols = []
            for t, (ia, ib, ww) in enumerate(plan):
                if ib == ia or ww <= 1e-6:
                    cols.append(video[0, :, ia]); continue
                z0, z1 = video[0, :, ia].float(), video[0, :, ib].float()
                if mode.startswith("hermite"):
                    zm = video[0, :, max(ia - 1, 0)].float(); z2 = video[0, :, min(ib + 1, t_src - 1)].float()
                    cols.append(hermite_between(zm, z0, z1, z2, ww).to(video.dtype))
                else:
                    cols.append(flow_between(z0, z1, ww).to(video.dtype))
            out = torch.stack(cols, 1)[None]
        conf = latent_confidence(plan, holds, n)
        # MASK for H3V2VInit (mask = where pass 2 may REGENERATE; time_varying on):
        # one frame per dilated frame, uniform over space, 1 - confidence of its token
        dil_frames = sum(holds)
        per_frame = []
        for t, c in enumerate(conf):
            f0, f1 = _token_span(t, dil_frames)
            per_frame += [1.0 - c] * (f1 - f0)
        regen = torch.tensor(per_frame[:dil_frames], dtype=torch.float32).view(-1, 1, 1).expand(-1, video.shape[3], video.shape[4]).contiguous()
        used = dict(hm, holds=holds, world_len=n) if hm else {"holds": holds, "world_len": n}
        used = json.dumps(used)
        tag = ("uniform x{}".format(dilation) if not hold_map.strip()
               else "adaptive, {} of {} frames held".format(n_held, n))
        exact = sum(1 for c in conf if c >= 0.999)
        report = _cost_report(n, target, fps, s_per_step, est_steps, overhead_s,
                              tail=tag + "; latent " + mode.split(" ")[0] + ", no VAE encode; "
                              f"{exact} of {len(conf)} tokens exact, mean confidence {sum(conf)/len(conf):.2f}")
        if note:
            report += "\n" + note
        result = dict(samples)
        result["samples"] = out.contiguous()
        return (result, used, int(target), report, regen)


NODE_CLASS_MAPPINGS = {"H3LatentSmear": H3LatentSmear}
NODE_DISPLAY_NAME_MAPPINGS = {"H3LatentSmear": "H3 Latent Smear (no encode) [alpha]"}
