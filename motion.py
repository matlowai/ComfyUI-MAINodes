"""v2v time-smear nodes — the validated fast-motion recipe as knobs.

Pipeline (all defaults = measured best values, 2026-08-08):
  H3VideoFit        (source-video path only) arbitrary frames -> the 17k+5
                    grid, audio cut to match, length for the oracle
  H3JerkOracle      latent -> jerk profile, window, LocalRate segments,
                    per-frame integer hold map (C1 ramps)
  H3IndecisionOracle (experimental, alternative signal) two X0 Tap dumps ->
                    the same outputs, off the model's own x0 jitter; mode
                    switches indecision / jerk passthrough / blend
  H3TimeSmear       frames + hold map -> smeared frames on a 17k+5 grid
  (VAEEncode)       smeared frames -> video latent
  H3V2VInit         video latent -> nested AV latent for injection
  H3TemporalInsert  (experimental) the same retime done IN LATENT SPACE:
                    insert interpolated token-times, freeze the originals
  H3LatentUpscale   (experimental) spatial upscale of the video half only
  H3InjectSchedule  model -> truncated SIGMAS (inject 0.70 default)
  (SamplerCustomAdvanced) -> generated latent -> decode
  H3ExactRecover    frames + hold map -> world clock (exact selection)
  H3JerkHeatmap     frames + latent -> oracle overlay + jerk strip (demo tile)
"""
import bisect
import json
import os
import math

import numpy as np
import torch

LEGAL_STEP = 17  # legal pixel lengths are 17k+5

# Per-step cost does NOT scale linearly with token count: attention dominates,
# so time goes as tokens**COST_EXP. Measured 2026-08-09, one clip one card,
# 37 -> 92 tokens took 13.35 -> 65.85 s/step (4.93x for a 2.49x token ratio,
# exponent 1.75). An independent field report on other hardware (16 -> 72
# s/step) lands near 1.64. 1.7 splits them. Expect it to climb toward 2.0 at
# higher resolution, where attention takes a larger share of the step.
COST_EXP = 1.7


def _torchaudio(*needs):
    """Import torchaudio, check the functions we actually use, and say what to
    do when either fails.

    `needs` names attributes of `torchaudio.functional` (e.g. "phase_vocoder",
    "resample"). Nothing here pins or compares a VERSION: versions move, and
    the only thing that matters is whether the call we are about to make
    exists. A caller that needs resample is not blocked by a missing phase
    vocoder.

    The audio nodes import it lazily, so a broken install does NOT fail at
    startup: the pack loads, the node registers, the graph validates, and it
    dies mid-render after the sampler has already been paid for. torchaudio's
    own message for the common cause (a CUDA build that disagrees with torch)
    names two version numbers and no remedy, which reads like the graph is at
    fault. Say otherwise.
    """
    try:
        import torchaudio
    except Exception as e:                       # ImportError, RuntimeError, OSError
        try:
            v, cu = torch.__version__, torch.version.cuda
        except Exception:
            v = cu = "unknown"
        raise RuntimeError(
            "This node needs torchaudio (phase vocoder / resample) and it "
            f"failed to import: {e}\n"
            f"torch is {v} built against CUDA {cu}. If torchaudio reports a "
            "different CUDA version, it came from a different build than "
            "torch - typically after an upgrade that pulled a stock wheel "
            "over a nightly one, because requirements.txt names torchaudio "
            "with no version and no index. Reinstall torchaudio from the SAME "
            "index as your torch and restart ComfyUI. Your graph is fine."
        ) from e
    missing = [n for n in needs if not hasattr(torchaudio.functional, n)]
    if missing:
        raise RuntimeError(
            f"torchaudio {getattr(torchaudio, '__version__', '?')} imported, but "
            f"torchaudio.functional is missing {', '.join(missing)}, which this "
            "node calls directly. The function was most likely moved or renamed "
            "upstream. Nothing is wrong with your graph or your install; this "
            "node needs updating for that torchaudio."
        )
    return torchaudio


def _video_component(samples):
    z = samples["samples"]
    if hasattr(z, "is_nested") and z.is_nested:
        z = z.tensors[0]
    return z  # (1, 24, t_lat, h, w)


def _tok_start_frame(t):
    c, i = divmod(t, 5)
    return c * 17 + (0 if i == 0 else 4 * (i - 1) + 1)


def _frame_token(f, t_lat):
    for t in range(t_lat - 1, -1, -1):
        if _tok_start_frame(t) <= f:
            return t
    return 0


def _token_frame_spans(t_lat):
    """Inclusive (first, last) pixel-frame span of every latent time token.

    The token clock is non-uniform: each 17-frame group is 5 tokens
    covering (1, 4, 4, 4, 4) frames, so every 5th token is a singleton
    sitting on a 17-multiple frame (the native keyframe anchors). The
    trailing +2 tokens of a 17k+5 clip are just the next group's first
    two entries (a singleton at frame 17k and the 4-group 17k+1..17k+4),
    so no tail special case is needed: spans tile [0, length) exactly."""
    return [(_tok_start_frame(t), _tok_start_frame(t + 1) - 1)
            for t in range(t_lat)]


def _tokenize_mask_time(m, t_lat, length):
    """Fold a per-pixel-frame mask (T, H, W) onto the latent token clock,
    returning (t_lat, H, W). MAX over each token's covered frames: a token
    cannot be split in time, so any covered frame asking to regenerate wins
    (same asymmetry as freeze_grow -- a moving subject is never clipped by
    its own freeze). T != length is nearest-neighbour resampled to length
    first. Pure torch, no comfy: unit-testable."""
    if m.shape[0] != length:
        src = m.shape[0]
        idx = (torch.arange(length, dtype=torch.float32)
               * (src / length)).floor().long().clamp(0, src - 1)
        m = m[idx]
    return torch.stack([m[a:b + 1].amax(dim=0)
                        for a, b in _token_frame_spans(t_lat)])


def _phase_norm(prof):
    """Divide out the (1,4,4,4,4) grid bias so tokens are comparable."""
    for ph in range(5):
        m = prof[ph::5].mean()
        if m > 0:
            prof[ph::5] /= m
    return prof


def _value_profile(v, order):
    """Per-token |Δ^order| of the latent VALUES, averaged over c/h/w."""
    j = np.abs(np.diff(v, n=order, axis=2)).mean(axis=(0, 1, 3, 4))
    lead = order // 2
    return np.pad(j, (lead, v.shape[2] - len(j) - lead), mode="edge")


def _trajectory_profile(v, order=3):
    """Per-token |Δ^order| of the energy CENTROID's path.

    The value-domain score is contaminated by motion energy: a textured
    object passing a location makes the value there pulse, and a pulse has
    large differences of every order even at constant velocity (measured
    corr(|d1|,|d3|) = 0.96-0.98 on real clips). Differentiating the centroid
    TRAJECTORY instead measures how abruptly the motion changes, which is
    what the method actually cares about, and on real textured clips it
    separated jerk from velocity where the value domain did not (top-decile
    share 0.29 vs 0.22, r = 0.46).

    Caveat measured 2026-08-10: on a SMOOTH synthetic blob the centroid path
    is nearly noise-free, so peak-to-mean contrast there is not comparable to
    the value domain's (1.21x vs 1.88x separation on such a toy). This mode
    is provided for ablation; it is not established as the better detector.
    """
    e = np.abs(v).mean(axis=(0, 1))                # (T, h, w) energy per token
    e = e - e.min(axis=(1, 2), keepdims=True)
    tot = e.sum(axis=(1, 2)) + 1e-8
    ys = np.arange(e.shape[1], dtype=np.float64)[None, :, None]
    xs = np.arange(e.shape[2], dtype=np.float64)[None, None, :]
    cy = (e * ys).sum(axis=(1, 2)) / tot
    cx = (e * xs).sum(axis=(1, 2)) / tot
    path = np.stack([cy, cx], axis=1)              # (T, 2)
    j = np.linalg.norm(np.diff(path, n=order, axis=0), axis=1)
    lead = order // 2
    return np.pad(j, (lead, path.shape[0] - len(j) - lead), mode="edge")


PROFILE_MODES = {
    "value |d3| (default)": ("value", 3),
    "value |d1| (energy baseline)": ("value", 1),
    "trajectory centroid |d3|": ("traj", 3),
    "value |d3| camera-compensated": ("camvalue", 3),
}


def _load_profiles():
    """model_profiles.load_profiles, tolerant of how this module was imported
    (package in ComfyUI, top-level in the test scripts). Never raises."""
    try:
        try:
            from .model_profiles import load_profiles
        except ImportError:
            from model_profiles import load_profiles
        return load_profiles()
    except Exception as e:                       # a registry typo must not kill the oracle
        print(f"[MAINodes] model profiles unavailable: {type(e).__name__}: {e}")
        return {}


def _profile_ids():
    return list(_load_profiles()) or ["minimax-h3"]


def _LatentClock(row):
    try:
        from .model_profiles import LatentClock
    except ImportError:
        from model_profiles import LatentClock
    return LatentClock(row)


def _camera_compensate(v, max_shift=3):
    """Align each latent frame to its predecessor by the integer (dy, dx) shift
    that minimises their mean absolute difference, accumulated along the clip,
    so a steady pan or scroll reads as stillness and only motion AGAINST the
    camera survives into the differences. Edges wrap (np.roll); at <= 3 latent
    cells on a 64-cell frame that is a border effect, not a signal.

    ROADMAP section 2 ("camera-compensated jerk"): the documented cause of
    panrun's over-dilation (124 -> 345 frames) was the pan itself scoring as
    jerk. Same seam as the other modes: a different profile, the same compiler."""
    T = v.shape[2]
    out = np.empty_like(v)
    out[:, :, 0] = v[:, :, 0]
    dy = dx = 0
    for t in range(1, T):
        prev = out[:, :, t - 1]
        cur = v[:, :, t]
        best, bs = None, (dy, dx)
        for sy in range(dy - max_shift, dy + max_shift + 1):
            for sx in range(dx - max_shift, dx + max_shift + 1):
                cand = np.roll(cur, (sy, sx), axis=(-2, -1))
                err = float(np.abs(cand - prev).mean())
                if best is None or err < best:
                    best, bs = err, (sy, sx)
        dy, dx = bs
        out[:, :, t] = np.roll(cur, (dy, dx), axis=(-2, -1))
    return out


def _jerk_profile(z, mode="value |d3| (default)", phase_norm=True):
    """Per-token motion-overload profile from a video latent.

    Default reproduces the original phase-normalized |Δ³| exactly. The other
    modes exist so the detector can be ablated against a cheap baseline
    rather than assumed: see ROADMAP.md section 1.
    """
    v = z.detach().float().cpu().numpy()          # (1, 24, T, h, w)
    kind, order = PROFILE_MODES.get(mode, ("value", 3))
    if kind == "camvalue":
        prof = _value_profile(_camera_compensate(v), order)
    else:
        prof = _value_profile(v, order) if kind == "value" else _trajectory_profile(v, order)
    return _phase_norm(prof) if phase_norm else prof   # (t_lat,)


def _legal_ceil(n):
    k = max(2, -(-(n - 5) // LEGAL_STEP))
    return LEGAL_STEP * k + 5


# The two exact neighbours on the 17k+5 grid. _legal_ceil above clamps to
# k>=2 (never below 39) because a smear target that short is not worth
# generating; a FIT must not invent 27 frames out of a 12-frame clip, so it
# uses these instead.
def _grid_floor(n):
    return 5 + LEGAL_STEP * max(0, (n - 5) // LEGAL_STEP)


def _grid_ceil(n):
    return 5 + LEGAL_STEP * max(0, -(-(n - 5) // LEGAL_STEP))


def _token_count(frames):
    """Latent tokens for a pixel length, snapped up to the 17k+5 grid."""
    return (_legal_ceil(frames) - 5) // LEGAL_STEP * 5 + 2


# ---------------------------------------------------------------- true clock
# MM-RoPE's temporal coordinate is PHYSICAL: 5/3 RoPE units per WORLD frame,
# token spans 5/3 x (1,4,4,4,4) [SRC comfy/ldm/minimax/model.py:30-91]. A
# de-roped (time-smeared) clip therefore misreports itself: N world frames
# smeared to M dilated frames read as an M-frame clip, i.e. a LONGER take, not
# slow motion. The functions below rebuild the per-token t-spans so each
# dilated frame advances time at its WORLD rate (1/hold of a world frame), so
# the clip's total RoPE duration equals its WORLD duration.
#
# CLOCK/ORIGIN (mechanics section 8): input `holds` are indexed by WORLD frame
# (origin = world frame 0); the returned spans are indexed by LATENT TOKEN of
# the DILATED clip (origin = dilated frame 0, which is world frame 0); units
# are RoPE units, ROPE_UNITS_PER_FRAME per world frame.
ROPE_UNITS_PER_FRAME = 5.0 / 3.0


def _snap_holds(holds):
    """H3TimeSmear's legal-snap, replayed: the 17k+5 tail pad lives in the
    LAST hold (motion.py H3TimeSmear.smear, `holds[-1] += target - sum`).

    So padding frames are extra copies of the last WORLD frame, and under the
    true clock they carry 1/holds[-1] world-frames each like every other copy
    in that group: the pad costs no extra world time, the final world frame is
    simply held longer. Idempotent on a hold map that is already snapped."""
    holds = [int(h) for h in holds]
    holds[-1] += _legal_ceil(sum(holds)) - sum(holds)
    return holds


# Longest rate-1 tail expand_to_end will treat as an end jump. One whole
# group (LEGAL_STEP = 17 world frames); anything longer is intended rest.
MAX_END_TAIL = LEGAL_STEP


def _hold_runs(holds):
    """Run-length view of a hold map, for logs: [(rate, count), ...]."""
    runs = []
    for h in holds:
        if runs and runs[-1][0] == h:
            runs[-1][1] += 1
        else:
            runs.append([int(h), 1])
    return [(r, c) for r, c in runs]


def _hold_runs_str(holds):
    return "+".join(f"[{r}]*{c}" for r, c in _hold_runs(holds))


def expand_hold_map_to_end(holds):
    """The expand_to_end rewrite: make the final expansion span run through
    the last world frame.

    Fires ONLY on the end-jump shape — a SHORT trailing run of rate-1 frames
    that follows a higher-rate span. A map that already ends inside an
    expansion (uniform dilation included) and a map that is rate-1 all the
    way are returned unchanged, so existing graphs stay bit-identical.

    TAIL GUARD (operator ruling 2026-08-14): a rate-1 tail longer than
    MAX_END_TAIL = LEGAL_STEP = 17 world frames, one whole group, is
    intended REST, not an end jump, and passes through unchanged. Adaptive
    oracle maps routinely put a long quiet run after a mid-clip burst
    (measured: a 124f oracle map ending in [1]*39 would otherwise be
    rewritten from 250 to 294 dilated frames), and turning that rest into
    slow motion is neither the fix nor the bill anyone asked for.

    When it fires: the trailing rate-1 run is lifted to the rate r of the
    span in front of it, and the resulting length is put back on the 17k+5
    grid by _legal_ceil. The deficit is spent INSIDE that same span+tail
    region, as evenly as possible with the remainder on the LAST frames, so
    rates only ever rise toward the end (the 0.45 round's
    [1]*34+[2]*10+[3]*12 shape). Never removes expansion the caller asked
    for, and the output is already legal, so the tail pad in H3TimeSmear /
    _snap_holds becomes a no-op.

    Returns (holds_out, note) where note is None when nothing was rewritten.
    """
    holds = [int(h) for h in holds]
    assert holds and min(holds) >= 1, "hold counts are >= 1"
    n = len(holds)
    tail = 0
    while tail < n and holds[n - 1 - tail] == 1:
        tail += 1
    if tail == 0 or tail == n or tail > MAX_END_TAIL:
        return holds, None            # to the end already / no expansion / rest
    start = n - tail - 1              # last frame of the span that stops short
    r = holds[start]
    while start > 0 and holds[start - 1] == r:
        start -= 1                    # the whole contiguous rate-r span
    out = holds[:start] + [r] * (n - start)
    m = n - start
    q, rem = divmod(_legal_ceil(sum(out)) - sum(out), m)
    for i in range(start, n):
        out[i] += q
    for i in range(n - rem, n):
        out[i] += 1
    note = (f"expand_to_end: rewrote the hold map so the final expansion "
            f"span runs to world frame {n - 1}. "
            f"{_hold_runs_str(holds)} ({sum(holds)}f) -> "
            f"{_hold_runs_str(out)} ({sum(out)}f)")
    return out, note


def true_clock_spans(holds):
    """Density-corrected per-token RoPE t-spans for a smeared clip.

    holds: per-world-frame integer hold counts (H3TimeSmear's hold_map_used).
    Returns a list of float spans, one per latent token of the dilated clip,
    drop-in for comfy.ldm.minimax.model._video_t_spans(t_lat).

    Each dilated frame is one of h copies of a world frame, so it advances
    1/h world frames; a token's span is ROPE_UNITS_PER_FRAME x the world time
    its covered dilated frames represent. Consequences that the unit test
    pins: the spans sum to len(holds) x ROPE_UNITS_PER_FRAME (world duration,
    exactly, pad included), they are all positive (so the grid is strictly
    increasing), and holds all-1 returns the stock grid unchanged."""
    holds = _snap_holds(holds)
    length = sum(holds)
    per_frame = [1.0 / h for h in holds for _ in range(h)]   # world frames/frame
    t_lat = (length - 5) // LEGAL_STEP * 5 + 2
    return [ROPE_UNITS_PER_FRAME * float(sum(per_frame[a:b + 1]))
            for a, b in _token_frame_spans(t_lat)]


def true_clock_grid(holds):
    """Origin-0 token t-coordinates: exclusive cumsum of true_clock_spans,
    mirroring comfy.ldm.minimax.model._video_t_grid(n, 0)."""
    out, cur = [], 0.0
    for s in true_clock_spans(holds):
        out.append(cur)
        cur += s
    return out


# Fixed per-render cost that is NOT sampling: model/LoRA setup, VAE encode and
# decode, node overhead. Measured 2026-08-12, 1.5 MP pass 2 on GPU1, warm:
# 124.8 s at 1 step, 209.9 / 212.8 at 2, 293.6 at 3 — a straight line of
# ~84 s per step on ~41 s of intercept. Without this term a 1-step estimate
# is 33% low.
#
# That 41 s was measured on an already-dilated pass, so it is NOT a constant:
# divided by that run's time multiplier it is ~6.7 s, and a separate fit over
# 266 corpus runs found the step-independent cost scaling at t**1.66 against
# the step's t**1.70. So overhead is scaled by time_x below, the same as the
# steps are. The two measurements agree once the dilation is divided out
# (~0.5 of one step for pass 2; the corpus fit reads ~1.1 for turbo pass 1,
# which is a different workload, not a contradiction).
#
# The whole minutes estimate is a ballpark. It is here so nobody discovers
# a 30 minute pass by waiting through it, not to be quotable.
OVERHEAD_S = 6.7


def _cost_report(world_len, dilated, fps=24, s_per_step=0.0, est_steps=18,
                 overhead_s=OVERHEAD_S, tail=""):
    """The price tag every targeting node shows before the expensive pass.

    Same sentence everywhere: world length in, effective regeneration length
    out, then the TIME multiplier. The frame ratio is stated too but labelled,
    because reading it as a time ratio understates the bill badly: per-step
    cost goes as tokens**COST_EXP, so 2.5x the frames is about 4.9x the time.
    """
    world_len = max(1, int(world_len))
    dilated = max(world_len, int(dilated))
    fps = max(1, int(fps))
    t_world = _token_count(world_len)
    t_dil = _token_count(dilated)
    time_x = (t_dil / t_world) ** COST_EXP
    report = (f"{world_len}f ({world_len / fps:.1f}s) -> {dilated}f "
              f"({dilated / fps:.1f}s) effective regen, "
              f"{dilated / world_len:.2f}x frames / {time_x:.1f}x time per "
              f"step; tokens {t_world} -> {t_dil}")
    if tail:
        report += f"; {tail}"
    if s_per_step > 0:
        secs = time_x * (overhead_s + s_per_step * max(1, int(est_steps)))
        report += (f"; roughly {secs / 60:.0f} min at {s_per_step:g} s/step x "
                   f"{int(est_steps)} steps (+{overhead_s:g}s encode/decode, "
                   f"all x{time_x:.1f})")
    return report


def _cost_widgets(with_fps=False):
    """Optional widgets that turn the report's multiplier into minutes.
    Shared so every node that prices a pass asks for the same three numbers."""
    w = {}
    if with_fps:
        w["fps"] = ("INT", {"default": 24, "min": 1, "max": 120,
                    "tooltip": "only used to phrase the report in seconds"})
    w["s_per_step"] = ("FLOAT", {"default": 0.0, "min": 0.0, "max": 120.0, "step": 0.05,
                       "tooltip": "seconds per step from a baseline render of this clip; 0 skips the minutes estimate"})
    w["est_steps"] = ("INT", {"default": 18, "min": 1, "max": 100,
                      "tooltip": "steps the regen pass will actually run (total_steps x inject)"})
    w["overhead_s"] = ("FLOAT", {"default": OVERHEAD_S, "min": 0.0, "max": 600.0, "step": 0.1,
                       "tooltip": "fixed non-sampling seconds per render (setup, VAE encode/decode). "
                                  "40 measured at 1.5 MP on a warm instance; take it from the gap "
                                  "between your own 1-step and 2-step wall times"})
    return w


# --- window / segment geometry -------------------------------------------
# A frame index is a token START iff it is one of these offsets inside a
# 17-frame chunk: _tok_start_frame(5c+i) = 17c + (0, 1, 5, 9, 13)[i].
TOK_OFFSETS = (0, 1, 5, 9, 13)


def _is_tok_start(f):
    return f % LEGAL_STEP in TOK_OFFSETS


def _seg_contrib(holds, f, c0, c1, hot_lo, hot_hi):
    """Smeared-frame contribution of world frame f inside a window whose
    regenerated core is [c0, c1]. Handle frames are hold 1 at a COLD cut
    (real-time baseline context, the shipped behaviour), but inherit the
    world hold at a HOT cut so both sides of the seam are repaired at the
    same temporal rate (seam policy 4)."""
    if c0 <= f <= c1:
        return int(holds[f])
    hot = hot_lo if f < c0 else hot_hi
    return int(holds[f]) if hot else 1


def _seg_holds(holds, a, b, c0, c1, hot_lo=False, hot_hi=False):
    return [_seg_contrib(holds, f, c0, c1, hot_lo, hot_hi)
            for f in range(a, b + 1)]


def _grid_grow(holds, a, b, c0, c1, n, hot_lo=False, hot_hi=False):
    """Widen [a, b] outward until sum(seg_holds) sits exactly on the 17k+5
    grid, and return (a, b, residual).

    Why: H3TimeSmear lands on the grid with `holds[-1] += target - sum`,
    which parks a multi-frame freeze on the window's last frame. Handle
    frames cost exactly 1 smeared frame each, so growing a handle by the
    deficit reaches the same grid point with no freeze at all. residual is
    what is still left for H3TimeSmear to absorb (0 unless the clip runs
    out of frames on both sides).
    """
    def contrib(f):
        return _seg_contrib(holds, f, c0, c1, hot_lo, hot_hi)

    s = sum(contrib(f) for f in range(a, b + 1))
    need = _legal_ceil(s) - s
    # each step subtracts exactly the frame's own contribution and never
    # overshoots, so _legal_ceil(sum) is invariant through the loop
    while need > 0 and b < n - 1 and contrib(b + 1) <= need:
        b += 1
        need -= contrib(b)
    while need > 0 and a > 0 and contrib(a - 1) <= need:
        a -= 1
        need -= contrib(a)
    return a, b, need


def _soft_edge(mask, feather, profile="linear", direction="centered"):
    """Feather a (T, H, W) 0/1 mask. Separable box or gaussian blur;
    direction pre-shifts the boundary so the ramp eats into the masked
    side (inward) or the kept side (outward) instead of straddling it."""
    import torch.nn.functional as F
    if feather <= 0:
        return mask
    m = mask[:, None]
    s = feather // 2
    if s and direction != "centered":
        k = s * 2 + 1
        if direction == "inward":
            m = 1 - F.max_pool2d(1 - m, k, stride=1, padding=k // 2)
        else:  # outward
            m = F.max_pool2d(m, k, stride=1, padding=k // 2)
    k = feather // 2 * 2 + 1
    if profile == "gaussian":
        x = torch.arange(k, dtype=torch.float32) - k // 2
        w = torch.exp(-(x ** 2) / (2 * (max(feather, 1) / 4.0) ** 2))
    else:
        w = torch.ones(k)
    w = w / w.sum()
    # replicate padding: masks that bleed off the image edge (inverted
    # background lassos) must not erode at the border
    m = F.pad(m, (k // 2, k // 2, k // 2, k // 2), mode="replicate")
    m = F.conv2d(m, w.view(1, 1, k, 1))
    m = F.conv2d(m, w.view(1, 1, 1, k))
    m = m[:, 0].clamp(0, 1)
    if profile == "smoothstep":
        m = m * m * (3 - 2 * m)
    return m


class H3VideoFit:
    """Snap an arbitrary clip's frame count onto H3's 17k+5 grid before it
    enters the pipeline: trim or pad the frames, cut the audio to match,
    and emit the resulting length so nothing downstream has to be told it
    by hand."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-12; the classic pipeline nodes are unchanged.\n\n"
        "The doorway for footage you already have. H3 works in 17-frame "
        "chunks, so legal clip lengths are 5, 22, 39, 56 ... 17k+5; an "
        "arbitrary MP4 lands between them. This trims (or pads) the batch to "
        "the nearest legal count, cuts the source audio by the same amount, "
        "and outputs 'length' — wire it into H3 Jerk Oracle's length instead "
        "of typing a number or wiring the duration expression the generated "
        "examples use.\n\n"
        "Why it matters even though nothing errors: the H3 VAE encoder pads a "
        "short final chunk by REPEATING THE LAST FRAME, silently. A 312-frame "
        "clip is encoded as 323 frames, the last 11 of them frozen, so the "
        "final tokens read as calm and the oracle under-dilates the end of "
        "your clip. Trimming to 311 removes the invented stillness.\n\n"
        "Default 'trim tail': never invents content, cuts at most 16 frames "
        "(0.67s at 24fps), and keeps frame 0, which is the anchor every "
        "keyframe/FLF path and the audio clock reference. 'trim head' if the "
        "action you care about is at the end. 'pad tail' repeats the last "
        "frame up to the next legal length (and pads the audio with silence) "
        "— it makes the encoder's hidden padding explicit and visible rather "
        "than removing it, so prefer it only when you cannot lose the tail.\n\n"
        "max_frames is the cost lever: per-step time is superlinear in token "
        "count, so capping a long source before fitting is the cheapest knob "
        "in the graph. 0 = use the whole clip.\n\n"
        "The report output is the receipt: frames in, frames out, which end "
        "lost them, the token count, and a warning if the source is not 24fps "
        "(H3 has one frame rate; a 30fps source will play back 1.25x slower).")

    MODES = ["trim tail (default)", "trim head",
             "pad tail (freeze last frame)", "nearest (trim or pad)"]

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE", {"tooltip": "source frames, e.g. LoadVideo -> GetVideoComponents"}),
            "mode": (cls.MODES, {"default": "trim tail (default)",
                     "tooltip": "how to reach the nearest 17k+5 length; trimming never invents frames"}),
        }, "optional": {
            "max_frames": ("INT", {"default": 0, "min": 0, "max": 3600,
                           "tooltip": "cap the clip before fitting (drops the tail); 0 = whole clip. "
                                      "The cheapest cost knob there is: time per step goes as tokens**1.7"}),
            "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.01,
                    "tooltip": "source frame rate, for the audio cut and the 24fps warning; "
                               "wire GetVideoComponents' fps output"}),
            "audio": ("AUDIO", {"tooltip": "the source's own track; cut to the same span. "
                                "Unwired -> the audio output carries nothing"}),
        }}

    RETURN_TYPES = ("IMAGE", "INT", "AUDIO", "STRING")
    RETURN_NAMES = ("images", "length", "audio", "report")
    FUNCTION = "fit"
    CATEGORY = "image/minimax/motion"

    def fit(self, images, mode, max_frames=0, fps=24.0, audio=None):
        images = images.detach().cpu()
        src = int(images.shape[0])
        assert src > 0, "no frames on the images input"
        n = min(src, int(max_frames)) if max_frames else src
        capped = n < src

        lo, hi = _grid_floor(n), _grid_ceil(n)
        if n < 5:                                  # cannot trim below the grid
            out_n, how = 5, "pad"
        elif n == lo:
            out_n, how = n, "none"
        elif mode.startswith("pad"):
            out_n, how = hi, "pad"
        elif mode.startswith("nearest"):
            out_n = lo if (n - lo) <= (hi - n) else hi
            how = "trim" if out_n < n else "pad"
        else:
            out_n, how = lo, "trim"

        head = mode == "trim head" and how == "trim"
        start = n - out_n if head else 0           # first kept source frame
        clip = images[:n]
        if how == "trim":
            out = clip[start:start + out_n]
        elif how == "pad":
            pad = out_n - n
            out = torch.cat([clip, clip[-1:].repeat(pad, 1, 1, 1)], dim=0)
        else:
            out = clip

        fps = float(fps) or 24.0
        cut = None
        if audio is not None:
            wav = audio["waveform"].detach().float().cpu()   # [B, C, N]
            sr = int(audio["sample_rate"])
            spf = sr / fps
            a = int(round(start * spf))
            b = int(round((start + out_n) * spf))
            seg = wav[..., a:min(b, wav.shape[-1])]
            if seg.shape[-1] < b - a:                        # pad tail = silence
                seg = torch.nn.functional.pad(seg, (0, b - a - seg.shape[-1]))
            cut = {"waveform": seg.contiguous(), "sample_rate": sr}

        parts = [f"{src} frames in, {out_n} out"]
        if capped:
            parts.append(f"capped at max_frames={max_frames}, {src - n} off the tail")
        if how == "trim":
            parts.append(f"dropped {n - out_n} from the "
                         f"{'head' if head else 'tail'}")
        elif how == "pad":
            parts.append(f"padded {out_n - n} by repeating the last frame "
                         f"(audio padded with silence)")
        else:
            parts.append("already on the 17k+5 grid, passed through")
        # tokens straight from the grid index, not _token_count: that helper
        # goes through _legal_ceil's k>=2 clamp and would price a legal
        # 5-frame clip at 39 frames / 12 tokens.
        k = (out_n - 5) // LEGAL_STEP
        report = ("; ".join(parts) +
                  f". {out_n} = 17x{k}+5, {5 * k + 2} tokens, "
                  f"{out_n / fps:.2f}s at {fps:g} fps")
        if cut is not None:
            report += f"; audio {cut['sample_rate']} Hz cut to match"
        if how == "trim" and (n - out_n) > 0.25 * n:
            # only fires under ~64 frames, where one grid step is a big share
            # of the clip. Flag it, do not override the user's mode.
            report += (f". WARNING: the trim dropped {(n - out_n) / n:.0%} of "
                       f"the clip; 'pad tail' would have kept all {n} frames")
        if abs(fps - 24.0) > 0.1:
            report += (f". WARNING: H3 is a 24fps model and these frames go in "
                       f"as 24fps, so the result plays {fps / 24.0:.2f}x "
                       f"slower than the source")
        return (out, int(out_n), cut, report)


class H3JerkOracle:
    """Read the jerk oracle from a final latent. Emits everything downstream
    knobs consume: LocalRate segment string, detected window, and the
    per-frame integer hold map (with C1 ramp shoulders) for H3TimeSmear."""

    DESCRIPTION = (
        "Reads WHERE and WHEN a clip's motion is too fast for the model from "
        "the clip's own latent (per-token jerk, |Δ³| over time). Outputs: "
        "hold_map → wire into H3 Time Smear for ADAPTIVE dilation; segments → "
        "H3 Local Rate; window/profile for inspection.\n\n"
        "Knobs: q = jerk quantile that counts as 'hot' (default 0.75; raise "
        "toward 0.85 for tighter spans and lower cost, lower toward 0.7 to "
        "catch more of the burst). d_max = peak hold count (default 4; the "
        "measured sweet spot — 2-3 saves time but starts to rope again). "
        "ramp = C1 shoulders on the hold curve (keep ON; hard steps jitter).\n\n"
        "ADAPTIVE MODE NOTE: the oracle hold map dilates only the hot spans, "
        "which saves significant render time (~2.4-3x total budget instead of "
        "uniform 4x) and follows the clip's intended pacing/attention more "
        "closely — quiet spans keep their native beat contrast. Trade-off: it "
        "can artifact slightly more than uniform dilation if the hold plateau "
        "dips inside a burst — the bridge knob (default 8) closes such valleys automatically per our measured production rule; if you still see hiccups mid-burst, lower q or raise "
        "d_max so the whole burst sits at the plateau.\n\n"
        "EFFECTIVE SIZE: this node decides how long the regeneration pass "
        "really is, and the report output states it before you pay — world "
        "length in, effective regen length out, then the multipliers. Expect "
        "a 5 s action clip to run as 11 to 13 s of frame data, so on a card "
        "that fits 10 s you can de-rope about a third of that. The frame and "
        "TIME multipliers are not the same number: per-step cost goes as "
        "tokens^1.7, so 2.5x the frames is roughly 4.9x the time per step. "
        "q and d_max are the two knobs that move it. Set s_per_step from a "
        "baseline render of this clip on this card for a minutes estimate.")

    PRESETS = {
        "balanced (default)": {"q": 0.75, "d_max": 4, "ramp": True},
        "max quality (wide plateau)": {"q": 0.70, "d_max": 4, "ramp": True},
        "economy (tight spans)": {"q": 0.85, "d_max": 3, "ramp": True},
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT",),
            "length": ("INT", {"default": 124, "min": 5, "max": 3600, "step": 17}),
            "q": ("FLOAT", {"default": 0.75, "min": 0.5, "max": 0.99, "step": 0.01,
                            "tooltip": "jerk quantile that counts as hot; higher = tighter span, lower cost"}),
            "d_max": ("INT", {"default": 4, "min": 2, "max": 8,
                              "tooltip": "peak hold count on the hottest tokens; 4 = measured sweet spot"}),
            "ramp": ("BOOLEAN", {"default": True,
                                 "tooltip": "C1 ramp shoulders (1,2,..,d_max,..,2,1) instead of hard steps — keep ON"}),
        }, "optional": {
            "preset": (["custom"] + list(cls.PRESETS), {"default": "balanced (default)",
                       "tooltip": "any choice but 'custom' overrides the knobs above"}),
            "bridge": ("INT", {"default": 8, "min": 0, "max": 20,
                       "tooltip": "bridge inter-peak valleys within a burst at d_max "
                                  "(measured production rule: a plateau dip between peaks "
                                  "of the same burst causes mid-burst artifacts). Max gap "
                                  "in tokens to fill; 0 disables."}),
            "profile_mode": (list(PROFILE_MODES), {"default": "value |d3| (default)",
                       "tooltip": "(alpha) which signal to threshold. The default is the "
                                  "shipped one. |d1| is the honest cheap baseline (on real "
                                  "clips it correlates 0.96-0.98 with |d3|, so the default "
                                  "is closer to motion ENERGY than to jerk). 'trajectory' "
                                  "differentiates the energy CENTROID's path instead, which "
                                  "is closer to the physical quantity; on real textured clips "
                                  "it gave a narrower profile than velocity. EXPERIMENTAL: on "
                                  "SMOOTH synthetic content the centroid is nearly noise-free, "
                                  "so its contrast is not comparable to the value domain's "
                                  "there. Ablate it, do not assume it."}),
            "abstain_below": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1,
                       "tooltip": "(alpha) ABSOLUTE gate, 0 = off (shipped behaviour). "
                                  "q is a quantile, so the oracle always dilates the top "
                                  "(1-q) of tokens even on a clip that needs nothing: a "
                                  "synthetic clip with EXACTLY zero trajectory jerk still "
                                  "got 3.06x. If the profile's peak-to-mean contrast is "
                                  "below this, the oracle abstains and returns a flat "
                                  "hold map (no dilation, no cost). Measured contrast ran "
                                  "about 2x higher on a jerky clip than a smooth one, so "
                                  "try 1.5-2.5 and check against a clip you know is calm."}),
            **_cost_widgets(with_fps=True),
            "model_profile": (["minimax-h3"] + [k for k in _profile_ids() if k != "minimax-h3"],
                              {"default": "minimax-h3",
                               "tooltip": "which model's latent is wired in. minimax-h3 is the shipped path, "
                                          "bit-identical. Any other preset reads THAT model's video latent "
                                          "(LTX-2.5: 128 channels, 1+8k token clock; Wan 2.2: 16 channels, "
                                          "1+4k) with the same planner, no phase normalisation, and emits "
                                          "holds per SOURCE frame as before - wire into H3 Clock Remap or "
                                          "straight into H3 Time Smear."}),
            "protect_tail": ("INT", {"default": 0, "min": 0, "max": 96,
                             "tooltip": "(alpha) hold the LAST n frames at 1 whatever the profile says. A burst that runs into the end of the clip has no 'after' for the model to slow into: measured 2026-08-23 on a chained segment, hold 4 on the closing gesture played it 1.55x fast after recovery; 17 (one token group) brought it to 1.06x. Untested on a single clip; 0 = off"}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "INT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("hold_map", "segments", "window_start", "window_len",
                    "profile", "report")
    FUNCTION = "read"
    CATEGORY = "latent/minimax/motion"

    @classmethod
    def VALIDATE_INPUTS(cls, model_profile=None):
        # Own the check so a stale or wrong value (0, "", an old name) never
        # rejects the prompt: read() routes anything unknown to minimax-h3.
        return True

    def read(self, samples, length, q, d_max, ramp, preset="custom", bridge=8,
             profile_mode="value |d3| (default)", abstain_below=0.0, model_profile="minimax-h3",
             fps=24, s_per_step=0.0, est_steps=18, overhead_s=OVERHEAD_S, protect_tail=0):
        if preset in self.PRESETS:
            p = self.PRESETS[preset]
            q, d_max, ramp = p["q"], p["d_max"], p["ramp"]
        clock = None
        if model_profile not in (None, "", "minimax-h3") and str(model_profile) not in _load_profiles():
            print(f"[MAINodes] H3JerkOracle: model_profile {model_profile!r} is not a profile; using minimax-h3")
            model_profile = "minimax-h3"
        if model_profile in (None, "", 0, "0"):
            model_profile = "minimax-h3"
        if model_profile != "minimax-h3":
            # another model's latent: same planner, that model's token clock,
            # no H3 phase normalisation. The checks are loud because a wrong
            # length here silently misaligns every hold downstream.
            row = _load_profiles().get(model_profile)
            if row is None or not row.get("latent"):
                raise ValueError(f"model_profile {model_profile!r} has no latent clock; "
                                 f"add a 'latent' entry (channels, first, block) to its profile")
            clock = _LatentClock(row)
            z = samples["samples"]
            if hasattr(z, "is_nested") and z.is_nested:
                z = z.tensors[0]
            if z.ndim != 5:
                raise ValueError(f"expected a 5D video latent [B, C, T, H, W] for {model_profile}, "
                                 f"got shape {tuple(z.shape)}")
            if clock.channels and z.shape[1] != clock.channels:
                raise ValueError(f"{model_profile} video latents carry {clock.channels} channels, this "
                                 f"one has {z.shape[1]}: is the right model's latent wired in?")
            t_lat = z.shape[2]
            want = clock.token_count(length)
            if t_lat != want:
                raise ValueError(f"length={length} means {want} latent time positions on {model_profile} "
                                 f"({clock.first}+{clock.block}k), the wired latent has {t_lat}: "
                                 f"use the clip's real frame count")
            prof = _jerk_profile(z, profile_mode, phase_norm=False)
        else:
            z = _video_component(samples)
            t_lat = z.shape[2]
            prof = _jerk_profile(z, profile_mode)

        # Absolute gate. The quantile can rank but cannot abstain, so without
        # this a calm clip still pays for its own fastest quarter.
        contrast = float(prof.max() / max(prof.mean(), 1e-8))
        if abstain_below > 0.0 and contrast < abstain_below:
            flat = json.dumps({"holds": [1] * length, "world_len": length})
            return (flat, "", 0, int(length),
                    " ".join(f"{v:.2f}" for v in prof),
                    _cost_report(length, _legal_ceil(length), fps, s_per_step,
                                 est_steps, overhead_s,
                                 tail=f"abstained, profile contrast "
                                      f"{contrast:.2f} < {abstain_below:g}"))

        holds, segs_str, w0, wlen, tok_d = _profile_to_plan(
            prof, length, q, d_max, ramp, bridge, clock=clock)
        if protect_tail:
            holds = list(holds)
            for i in range(max(0, len(holds) - int(protect_tail)), len(holds)):
                holds[i] = 1

        hold_map = json.dumps({"holds": holds, "world_len": length}
                              if clock is None else
                              {"holds": holds, "world_len": length, "oracle_latent": model_profile})
        profile = " ".join(f"{v:.2f}" for v in prof)
        n_held = sum(1 for h in holds if h > 1)
        report = _cost_report(
            length, _legal_ceil(sum(holds)), fps, s_per_step, est_steps,
            overhead_s,
            tail=f"{n_held} of {length} frames held, peak x{int(tok_d.max())}")
        return (hold_map, segs_str, int(w0), int(wlen), profile, report)


def _profile_to_plan(prof, length, q, d_max, ramp, bridge, clock=None):
    """Per-token profile -> (holds, segments string, window_start, window_len,
    per-token hold counts).

    Extracted verbatim out of H3JerkOracle.read so a second oracle can compile
    its own profile through EXACTLY the same rules: an A/B between two signals
    has to differ in the signal, not in the compiler that turns it into holds.

    clock=None is H3's (1,4,4,4,4)-per-17 grid, unchanged. A LatentClock
    (model_profiles) makes the same planner read another model's latent:
    only the frame<->token mapping and the legal grid change.
    """
    prof = np.asarray(prof, dtype=np.float64)
    t_lat = len(prof)
    thr = np.quantile(prof, q)
    tok_d = np.where(prof >= thr, d_max, 1).astype(int)
    if bridge:
        # production rule (measured): never let the plateau dip between
        # peaks of the same burst — the dip is where mid-burst artifacts
        # come back (4 of 5 in the v1 map). Fill short valleys at d_max.
        hot = np.where(tok_d == d_max)[0]
        for a, b in zip(hot[:-1], hot[1:]):
            if 1 < b - a <= bridge:
                tok_d[a:b + 1] = d_max
    if ramp:
        for _ in range(d_max - 1):            # relax until |Δd| <= 1
            left = np.concatenate([[1], tok_d[:-1]])
            right = np.concatenate([tok_d[1:], [1]])
            tok_d = np.maximum(tok_d, np.maximum(left, right) - 1)

    ft = _frame_token if clock is None else clock.frame_token
    holds = [int(tok_d[ft(f, t_lat)]) for f in range(length)]

    segs, t0 = [], 0
    for t in range(1, t_lat + 1):
        if t == t_lat or tok_d[t] != tok_d[t0]:
            if tok_d[t0] > 1:
                segs.append(f"{t0}:{t}:{int(tok_d[t0])}")
            t0 = t
    hot = np.where(tok_d > 1)[0]
    if len(hot) and clock is None:
        w0 = (_tok_start_frame(int(hot.min())) // 17) * 17
        w1 = min(length, _tok_start_frame(min(int(hot.max()) + 1, t_lat - 1)) + 4)
        wlen = _legal_ceil(w1 - w0)
        wlen = min(wlen, length - w0) if w0 + wlen > length else wlen
    elif len(hot):
        w0 = clock.tok_start_frame(int(hot.min()))
        w1 = min(length, clock.tok_start_frame(min(int(hot.max()) + 1, t_lat - 1)) + clock.block)
        wlen = clock.legal_ceil(w1 - w0)
        wlen = min(wlen, length - w0) if w0 + wlen > length else wlen
    else:
        w0, wlen = 0, length
    return holds, ",".join(segs), int(w0), int(wlen), tok_d


def _compile_hold_map(frame_holds, length, ramp, bridge):
    """Frame-domain holds -> token-snapped holds + segments string.
    Shared by H3ManualHoldMap and H3MotionEditor; same bridge/ramp rules
    as the oracle."""
    t_lat = 0
    while _tok_start_frame(t_lat) < length:
        t_lat += 1
    tok_d = np.ones(t_lat, int)
    for t in range(t_lat):
        f0 = _tok_start_frame(t)
        f1 = min(_tok_start_frame(t + 1), length)
        if f1 > f0:
            tok_d[t] = int(np.max(frame_holds[f0:f1]))

    d_peak = int(tok_d.max())
    if bridge and d_peak > 1:
        hot = np.where(tok_d == d_peak)[0]
        for a, b in zip(hot[:-1], hot[1:]):
            if 1 < b - a <= bridge:
                tok_d[a:b + 1] = d_peak
    if ramp and d_peak > 1:
        for _ in range(d_peak - 1):
            left = np.concatenate([[1], tok_d[:-1]])
            right = np.concatenate([tok_d[1:], [1]])
            tok_d = np.maximum(tok_d, np.maximum(left, right) - 1)

    holds = [int(tok_d[_frame_token(f, t_lat)]) for f in range(length)]
    segs, t0 = [], 0
    for t in range(1, t_lat + 1):
        if t == t_lat or tok_d[t] != tok_d[t0]:
            if tok_d[t0] > 1:
                segs.append(f"{t0}:{t}:{int(tok_d[t0])}")
            t0 = t
    return holds, ",".join(segs), t_lat


# ------------------------------------------------------- indecision oracle
# EXPERIMENTAL (2026-08-14). A second, independent oracle: instead of reading
# the clip's motion out of a finished latent, read the MODEL'S OWN UNCERTAINTY
# out of two x0 taps taken mid-schedule.
#
#   J(a->b)[t,y,x] = avgpool2x2( mean_over_24_channels |x0_b - x0_a| )
#
# High J = tokens whose predicted clean latent is still moving between denoise
# steps, i.e. where the model has not made up its mind.
#
# The math below is PORTED VERBATIM from the desk study that validated it
# (a private benchmarks tree, x0_jitter.py); tests/test_indecision_oracle.py
# asserts parity against that file so the two cannot drift. What the study found (RESULTS.md, 7 scenes):
#
#   - the map is NOT a re-derivation of the jerk oracle. Controlling for pixel
#     motion it still correlates +0.41 with static detail energy; on the
#     quietest third of token-times it correlates +0.51 with detail while
#     frame-diff has nothing to say.
#   - it is also NOT a superset: on kitsune_dash token 21 a fast swinging
#     ofuda reads motion rank 0.974 and jitter rank 0.040. The two oracles
#     disagree in BOTH directions, which is why this node ships with blend
#     modes and why nothing else in the pack changed its defaults.
#   - the cheap pair 0->1 is degenerate: on 6 of 7 fresh runs it correlates at
#     or below zero with anything in the picture, because it is dominated by
#     the (1,4,4,4,4) chunk-phase ramp. Use 6->12 on a 25-step run.
#   - mask-composited / pinned / repaint runs produce a picture of the MASK,
#     not of the model (pr15375 arms: 12 of 22 token rows exactly zero). The
#     degeneracy check below fires on that.

def _x0_token_count(frames):
    """Latent time tokens for a 17k+5 pixel length (x0_jitter.token_count)."""
    return (frames - 5) // LEGAL_STEP * 5 + 2


def _x0_step_path(dump_dir, step):
    import os
    return os.path.join(dump_dir, f"x0_step{int(step):03d}.pt")


def _x0_available_steps(dump_dir):
    """Step indices actually dumped in a dump_dir, sorted."""
    import os
    import re
    out = []
    try:
        names = os.listdir(dump_dir)
    except OSError:
        return out
    for n in names:
        m = re.fullmatch(r"x0_step(\d+)\.pt", n)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def _load_x0(dump_dir, step, frames, h_pix, w_pix):
    """-> torch [24, T_lat, h_lat, w_lat] float32 (video part of the flat dump).

    X0TapSampler writes payload["video"]; on H3 that can arrive already shaped
    or as the flat cat(video.ravel(), audio.ravel()), so this reads it flat and
    slices the video prefix, exactly as x0_jitter.load_x0 does.
    """
    p = _x0_step_path(dump_dir, step)
    payload = torch.load(p, weights_only=True)
    flat = payload["video"].reshape(-1).float()
    T, h, w = _x0_token_count(frames), h_pix // 16, w_pix // 16
    n_vid = 24 * T * h * w
    if flat.numel() < n_vid:
        raise ValueError(f"{p}: {flat.numel()} elems < video {n_vid} "
                         f"(length/width/height wrong?)")
    rem = flat.numel() - n_vid
    if rem % 64:
        raise ValueError(f"{p}: audio remainder {rem} not divisible by 64 "
                         f"(length/width/height wrong?)")
    return flat[:n_vid].reshape(24, T, h, w)


def _jitter_map(za, zb):
    """[24,T,h,w] x2 -> [T, h/2, w/2] token-grid jitter (float32 numpy)."""
    d = (zb - za).abs().mean(0)                       # [T,h,w]
    tok = torch.nn.functional.avg_pool2d(d.unsqueeze(1), 2).squeeze(1)
    return tok.numpy().astype(np.float32)


def _detrend_phase(J):
    """Subtract the (1,4,4,4,4) chunk-phase ramp so cross-time comparisons are
    about content. Per-map SPATIAL ranking is unaffected; only the temporal
    axis moves — which is the axis the hold map is compiled from."""
    J = J.copy()
    T = J.shape[0]
    for m in range(5):
        idx = np.arange(m, T, 5)
        if len(idx):
            J[idx] -= J[idx].mean(axis=0, keepdims=True) - J.mean()
    return J


def _map_normalize(J, mode="rank"):
    """Per-run normalization so maps from different sources are comparable."""
    if mode == "rank":
        flat = J.ravel()
        r = np.empty_like(flat)
        r[np.argsort(flat)] = np.linspace(0.0, 1.0, flat.size)
        return r.reshape(J.shape)
    if mode == "z":
        return (J - J.mean()) / (J.std() + 1e-9)
    if mode == "none":
        return J.astype(np.float32)
    raise ValueError(mode)


def _degeneracy_check(J):
    """pr15375-style trap: composited/pinned token rows read as exactly 0
    jitter, so the map is the noise MASK, not the model's mind."""
    per_t = J.reshape(J.shape[0], -1).mean(1)
    zero_rows = [int(i) for i, v in enumerate(per_t) if v < 1e-6]
    frac_zero = float((J == 0).mean())
    return {"zero_token_rows": zero_rows, "frac_exact_zero": frac_zero,
            "degenerate": bool(zero_rows)}


def _jerk_spatial_map(z):
    """Per-token SPATIAL jerk on the same (1,2,2) token grid the jitter map
    uses, so the two oracles are comparable cell for cell. Same map
    H3JerkHeatmap draws (|Δ³| over time, clamp-padded, phase-normalized),
    then average-pooled 2x2 like the patchifier."""
    v = z.detach().float().cpu().numpy()              # (1, 24, T, h, w)
    t_lat = v.shape[2]
    jmap = np.abs(np.diff(v, n=3, axis=2)).mean(axis=(0, 1))   # (T-3, h, w)
    if jmap.shape[0] == 0:                            # < 4 tokens: no Δ³
        jmap = np.zeros((1,) + v.shape[3:], dtype=np.float64)
    tok = np.stack([jmap[min(max(k - 1, 0), jmap.shape[0] - 1)]
                    for k in range(t_lat)])
    for ph in range(5):
        m = tok[ph::5].mean()
        if m > 0:
            tok[ph::5] /= m
    t = torch.from_numpy(np.ascontiguousarray(tok)).float().unsqueeze(1)
    return torch.nn.functional.avg_pool2d(t, 2).squeeze(1).numpy().astype(np.float32)


SPATIAL_REDUCE = ("mean (matches the jerk oracle)", "top-decile mean", "max")


def _map_to_profile(M, reduce="mean (matches the jerk oracle)"):
    """Token map [T,h,w] -> per-token profile [T]. The jerk oracle's profile is
    a spatial MEAN, so mean is the default: it keeps the two profiles
    comparable. The other two are more selective about a small hot region."""
    flat = M.reshape(M.shape[0], -1)
    if reduce.startswith("max"):
        return flat.max(axis=1).astype(np.float64)
    if reduce.startswith("top-decile"):
        k = max(1, int(round(flat.shape[1] * 0.1)))
        part = np.sort(flat, axis=1)[:, -k:]
        return part.mean(axis=1).astype(np.float64)
    return flat.mean(axis=1).astype(np.float64)


def _rank_flat(a):
    return np.argsort(np.argsort(a.ravel())).astype(np.float64)


def _spearman(a, b):
    ra, rb = _rank_flat(a), _rank_flat(b)
    if ra.std() < 1e-12 or rb.std() < 1e-12:
        return float("nan")
    return float(np.corrcoef(ra, rb)[0, 1])


def _top_decile_iou(a, b, q=0.90):
    am, bm = a >= np.quantile(a, q), b >= np.quantile(b, q)
    u = np.logical_or(am, bm).sum()
    return float(np.logical_and(am, bm).sum() / u) if u else 1.0


INDECISION_MODES = ("indecision", "jerk passthrough", "blend max",
                    "blend weighted w")


def _blend_maps(mode, Jn, Kn, w):
    """Combine two ALREADY rank-normalized token maps."""
    if mode == "blend max":
        return np.maximum(Jn, Kn)
    if mode == "blend weighted w":
        return (w * Jn + (1.0 - w) * Kn).astype(np.float32)
    raise ValueError(mode)


def _norm01(M, lo_q=0.05, hi_q=0.995):
    lo, hi = np.quantile(M, lo_q), np.quantile(M, hi_q)
    return np.clip((M - lo) / (hi - lo + 1e-9), 0, 1)


def _heat_tiles(M, tile=48, cols=8, label_row=True):
    """Token map [T,h,w] -> a single preview IMAGE (1, H, W, 3), one tile per
    token-time, red/yellow on black. Used when no frames are wired, so the map
    is always previewable in-graph."""
    T = M.shape[0]
    n = _norm01(M)
    t = torch.from_numpy(n).float().unsqueeze(1)
    t = torch.nn.functional.interpolate(t, size=(tile, tile), mode="nearest")
    t = t.squeeze(1)                                          # (T, tile, tile)
    rows = []
    for r in range(0, T, cols):
        chunk = [t[i] for i in range(r, min(r + cols, T))]
        while len(chunk) < cols:
            chunk.append(torch.zeros(tile, tile))
        row = torch.cat([_heat_rgb(c) for c in chunk], dim=1)
        if label_row:
            row[:1, :] = 0.25
            row[:, ::tile] = 0.25
        rows.append(row)
    return torch.cat(rows, dim=0)[None]


def _heat_rgb(hm):
    """0..1 map -> red/yellow RGB, the H3JerkHeatmap ramp."""
    return torch.stack([hm,
                        hm * (0.3 + 0.7 * (1 - hm)),
                        torch.zeros_like(hm)], -1)


def _heat_overlay(images, M, alpha):
    """Frames + token map -> per-frame overlay, mirroring H3JerkHeatmap."""
    images = images.detach().float().cpu()
    n, H, W, _ = images.shape
    t_lat = M.shape[0]
    heat = torch.nn.functional.interpolate(
        torch.from_numpy(_norm01(M)).float()[None], size=(H, W),
        mode="bilinear", align_corners=False)[0]              # (T, H, W)
    out = []
    for f in range(n):
        k = min(_frame_token(f, t_lat), t_lat - 1)
        hm = heat[k]
        a = (hm * alpha)[..., None]
        color = torch.stack([torch.ones_like(hm),
                             0.3 + 0.7 * (1 - hm),
                             torch.zeros_like(hm)], -1)
        out.append(images[f] * (1 - a) + color * a)
    return torch.stack(out)


def _hot_cell(M_t):
    y, x = np.unravel_index(int(np.argmax(M_t)), M_t.shape)
    return int(x), int(y)


def _comparison_report(Jn, Kn, n_top=4):
    """Per-token-time top regions for each source + overlap/divergence stats.
    Both inputs must already be rank-normalized so the numbers compare."""
    T = Jn.shape[0]
    lines = [f"COMPARISON  indecision vs jerk, token grid "
             f"{T}x{Jn.shape[1]}x{Jn.shape[2]} (rank-normalized both sides)",
             f"  whole-map Spearman rho = {_spearman(Jn, Kn):+.3f}; "
             f"top-decile IoU = {_top_decile_iou(Jn, Kn):.3f}"]
    jp = Jn.reshape(T, -1).mean(1)
    kp = Kn.reshape(T, -1).mean(1)
    lines.append(f"  per-token profile Spearman rho = {_spearman(jp, kp):+.3f}")
    for tag, prof, other in (("indecision", jp, kp), ("jerk", kp, jp)):
        order = np.argsort(prof)[::-1][:n_top]
        bits = []
        for t in order:
            src = Jn if tag == "indecision" else Kn
            x, y = _hot_cell(src[t])
            bits.append(f"tok {int(t)} (frame {_tok_start_frame(int(t))}) "
                        f"cell ({x},{y}) J={Jn[t, y, x]:.3f} K={Kn[t, y, x]:.3f}")
        lines.append(f"  hottest token-times by {tag}: " + "; ".join(bits))
    D = Jn - Kn
    div = np.abs(D).reshape(T, -1).mean(1)
    order = np.argsort(div)[::-1][:n_top]
    bits = []
    for t in order:
        jy, jx = np.unravel_index(int(np.argmax(D[t])), D[t].shape)
        my, mx = np.unravel_index(int(np.argmin(D[t])), D[t].shape)
        bits.append(f"tok {int(t)} |dR|={div[t]:.3f} "
                    f"J>K ({jx},{jy}) {Jn[t, jy, jx]:.3f}/{Kn[t, jy, jx]:.3f} "
                    f"K>J ({mx},{my}) {Jn[t, my, mx]:.3f}/{Kn[t, my, mx]:.3f}")
    lines.append("  biggest disagreements: " + "; ".join(bits))
    lines.append(f"  cells where indecision leads jerk by >0.5 rank: "
                 f"{float((D > 0.5).mean()):.1%}; the other way: "
                 f"{float((D < -0.5).mean()):.1%}")
    lines.append("  NOTE: neither source is a superset of the other. The desk "
                 "study found a fast prop the jitter map missed entirely "
                 "(motion rank 0.97 / jitter rank 0.04); blend max is the "
                 "recommended experiment, not indecision alone.")
    return "\n".join(lines)


class H3IndecisionOracle:
    """The INDECISION oracle: read the model's own uncertainty off two x0 taps
    and compile it through the jerk oracle's exact hold-map rules, so either
    signal (or a blend) can drive the same pipeline from one widget.

    EXPERIMENTAL. Nothing else in the pack changed its defaults; this node has
    to earn its place on real renders first."""

    DESCRIPTION = (
        "EXPERIMENTAL second oracle (2026-08-14). Instead of reading a clip's "
        "MOTION out of a finished latent, this reads the model's own "
        "UNCERTAINTY out of two X0 Tap dumps: J = |x0_b - x0_a| per latent "
        "channel, pooled to the (1,2,2) token grid. High J = tokens the model "
        "has not made up its mind about.\n\n"
        "Outputs mirror H3 Jerk Oracle exactly (hold_map / segments / window / "
        "profile / report) and compile through the SAME threshold, bridge and "
        "ramp code, so an A/B between the two differs in the signal and "
        "nothing else. Two extra outputs: comparison (a text A/B) and heat (a "
        "previewable map).\n\n"
        "WHAT IT NEEDS: pass 1 must have run through X0 Tap with BOTH steps "
        "dumped. The validated pair is 6->12 on a 25-step schedule. 0->1 is "
        "DEGENERATE — it carries the (1,4,4,4,4) chunk-phase ramp, not "
        "content, and correlated at or below zero with the picture on 6 of 7 "
        "test scenes. Several shipped graphs tap 0,1,12,24 only; there 12->24 "
        "is the usable pair (the node lists what it found and can fall back "
        "for you).\n\n"
        "WHAT IT IS NOT: a replacement for the jerk oracle. Measured over 7 "
        "scenes it carries genuinely independent signal (partial rho +0.41 "
        "with static detail after removing motion, +0.51 on the quietest "
        "third of token-times) but it MISSES things motion catches — a fast "
        "swinging prop read motion rank 0.97 and jitter rank 0.04. The two "
        "disagree in both directions. 'blend max' is the recommended "
        "experiment.\n\n"
        "MASKED / REPAINT / PINNED RUNS: composited token rows read as exactly "
        "zero jitter, so the map becomes a picture of the noise MASK. The "
        "report shouts if more than 30% of token rows are exactly zero. Do "
        "not use this oracle on such a run.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "dump_dir": ("STRING", {"default": "/tmp/x0_tap",
                         "tooltip": "X0 Tap dump_dir from PASS 1 — the same path "
                                    "you gave the X0 Tap (SAMPLER wrapper)"}),
            "length": ("INT", {"default": 124, "min": 5, "max": 3600, "step": 17,
                       "tooltip": "world frames of the tapped clip (17k+5)"}),
            "width": ("INT", {"default": 1024, "min": 32, "max": 8192, "step": 32}),
            "height": ("INT", {"default": 1024, "min": 32, "max": 8192, "step": 32}),
            "step_a": ("INT", {"default": 6, "min": 0, "max": 999,
                       "tooltip": "first tapped step. 6->12 is the validated pair on a "
                                  "25-step run; 0->1 is degenerate (phase ramp, not content)"}),
            "step_b": ("INT", {"default": 12, "min": 0, "max": 999,
                       "tooltip": "second tapped step, later than step_a"}),
            "mode": (list(INDECISION_MODES), {"default": "indecision",
                     "tooltip": "which signal drives the hold map. 'jerk passthrough' needs "
                                "samples wired and reproduces H3 Jerk Oracle exactly (same "
                                "knobs, same code) so the A/B is one widget. Blends operate "
                                "AFTER per-source rank normalization."}),
            "q": ("FLOAT", {"default": 0.75, "min": 0.5, "max": 0.99, "step": 0.01,
                            "tooltip": "same quantile knob as the jerk oracle"}),
            "d_max": ("INT", {"default": 4, "min": 2, "max": 8,
                              "tooltip": "peak hold count; 4 = the jerk oracle's measured sweet spot"}),
            "ramp": ("BOOLEAN", {"default": True,
                                 "tooltip": "C1 ramp shoulders — keep ON"}),
        }, "optional": {
            "samples": ("LATENT", {"tooltip": "the same latent H3 Jerk Oracle reads. "
                        "REQUIRED for 'jerk passthrough' and the blends; optional in "
                        "'indecision' mode, where wiring it only fills in the comparison "
                        "report and the second heat panel"}),
            "images": ("IMAGE", {"tooltip": "optional frames to overlay the heat on. "
                        "Without them the heat output is a tile atlas of the token map"}),
            "normalization": (["rank", "z", "none"], {"default": "rank",
                       "tooltip": "per-source normalization before blending; rank is what "
                                  "the desk study validated and is the only one that makes "
                                  "the two scales comparable"}),
            "blend_w": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05,
                       "tooltip": "'blend weighted w': weight on INDECISION (1-w on jerk)"}),
            "detrend_phase": ("BOOLEAN", {"default": True,
                       "tooltip": "remove the (1,4,4,4,4) chunk-phase ramp from the temporal "
                                  "axis. Spatial ranking is unaffected either way, but the "
                                  "hold map is compiled from the temporal axis, so keep ON"}),
            "spatial_reduce": (list(SPATIAL_REDUCE), {"default": SPATIAL_REDUCE[0],
                       "tooltip": "how the token map collapses to a per-token profile. "
                                  "mean matches the jerk oracle's spatial mean"}),
            "bridge": ("INT", {"default": 8, "min": 0, "max": 20,
                       "tooltip": "same valley-bridging rule as the jerk oracle; "
                                  "keep it matched when you A/B the two"}),
            "auto_fallback": ("BOOLEAN", {"default": True,
                       "tooltip": "if a requested step was not dumped, use the nearest pair "
                                  "that WAS (loudly, in the report) instead of failing the "
                                  "render. Turn OFF to hard-fail on a mis-tapped graph"}),
            "alpha": ("FLOAT", {"default": 0.55, "min": 0.0, "max": 1.0, "step": 0.05,
                       "tooltip": "heat overlay strength when images are wired"}),
            **_cost_widgets(with_fps=True),
        }}

    RETURN_TYPES = ("STRING", "STRING", "INT", "INT", "STRING", "STRING",
                    "STRING", "IMAGE")
    RETURN_NAMES = ("hold_map", "segments", "window_start", "window_len",
                    "profile", "report", "comparison", "heat")
    FUNCTION = "read"
    CATEGORY = "latent/minimax/motion"

    def read(self, dump_dir, length, width, height, step_a, step_b, mode, q,
             d_max, ramp, samples=None, images=None, normalization="rank",
             blend_w=0.5, detrend_phase=True,
             spatial_reduce=SPATIAL_REDUCE[0], auto_fallback=True, alpha=0.55,
             bridge=8, fps=24, s_per_step=0.0, est_steps=18,
             overhead_s=OVERHEAD_S):
        notes = []
        need_jerk = mode != "indecision"
        need_jitter = mode != "jerk passthrough"
        assert samples is not None or not need_jerk, (
            f"mode '{mode}' needs the LATENT wired to `samples` (the same one "
            f"you give H3 Jerk Oracle)")

        Kmap = _jerk_spatial_map(_video_component(samples)) if samples is not None else None

        Jmap = None
        if need_jitter:
            a, b, pick_note = self._resolve_pair(dump_dir, step_a, step_b,
                                                 auto_fallback)
            if pick_note:
                notes.append(pick_note)
            za = _load_x0(dump_dir, a, length, height, width)
            zb = _load_x0(dump_dir, b, length, height, width)
            Jmap = _jitter_map(za, zb)
            deg = _degeneracy_check(Jmap)
            frac_rows = len(deg["zero_token_rows"]) / max(1, Jmap.shape[0])
            if frac_rows > 0.30:
                notes.append(
                    f"*** DEGENERATE: {len(deg['zero_token_rows'])} of "
                    f"{Jmap.shape[0]} token rows are EXACTLY zero "
                    f"({frac_rows:.0%}, frac_exact_zero="
                    f"{deg['frac_exact_zero']:.2f}). This is a masked / "
                    f"pinned / repaint run: the map you are looking at is a "
                    f"picture of the NOISE MASK, not of the model's mind. Do "
                    f"not drive a hold map off it. ***")
            elif deg["zero_token_rows"]:
                notes.append(f"note: token rows {deg['zero_token_rows']} have "
                             f"zero jitter (partial pinning?)")
            if a <= 1 and b <= 1:
                notes.append("*** WARNING: the 0->1 pair is DEGENERATE — it "
                             "carries the chunk-phase ramp, not content "
                             "(rho <= 0 with the picture on 6 of 7 scenes). "
                             "Use 6->12, or 12->24 on a coarse tap. ***")
            if detrend_phase:
                Jmap = _detrend_phase(Jmap)
            if Kmap is not None and Kmap.shape != Jmap.shape:
                notes.append(f"note: jerk map {Kmap.shape} and jitter map "
                             f"{Jmap.shape} disagree on geometry — check "
                             f"length/width/height against the tapped clip; "
                             f"comparison and blending are skipped")
                Kmap = None
                if need_jerk:
                    raise ValueError(
                        f"mode '{mode}' needs both maps on the same grid; got "
                        f"jitter {Jmap.shape} from the dump")

        # profile: normalize per source, then blend, then reduce to per-token
        if mode == "jerk passthrough":
            prof = _jerk_profile(_video_component(samples))
            src_label = "jerk (passthrough)"
            heat_map = Kmap
        elif mode == "indecision":
            prof = _map_to_profile(_map_normalize(Jmap, normalization),
                                   spatial_reduce)
            src_label = "indecision"
            heat_map = Jmap
        else:
            Jn = _map_normalize(Jmap, normalization)
            Kn = _map_normalize(Kmap, normalization)
            heat_map = _blend_maps(mode, Jn, Kn, float(blend_w))
            prof = _map_to_profile(heat_map, spatial_reduce)
            src_label = (f"{mode}" if mode == "blend max"
                         else f"blend w={blend_w:g} indecision / "
                              f"{1 - blend_w:g} jerk")

        holds, segs_str, w0, wlen, tok_d = _profile_to_plan(
            prof, length, q, d_max, ramp, bridge)
        hold_map = json.dumps({"holds": holds, "world_len": length})
        profile = " ".join(f"{v:.4f}" for v in prof)
        n_held = sum(1 for h in holds if h > 1)
        report = _cost_report(
            length, _legal_ceil(sum(holds)), fps, s_per_step, est_steps,
            overhead_s,
            tail=f"source={src_label}, {n_held} of {length} frames held, "
                 f"peak x{int(tok_d.max())}")
        report = "\n".join([report,
                            "EXPERIMENTAL oracle: defaults elsewhere in the "
                            "pack are unchanged; validate before trusting it."]
                           + notes)

        if Jmap is not None and Kmap is not None:
            comparison = _comparison_report(_map_normalize(Jmap, "rank"),
                                            _map_normalize(Kmap, "rank"))
        elif Jmap is None:
            comparison = ("no comparison: mode is jerk passthrough, so no x0 "
                          "dump was read. Switch mode to 'indecision' (samples "
                          "stays wired) for the A/B.")
        else:
            comparison = ("no comparison: wire the LATENT into `samples` to "
                          "get the indecision-vs-jerk A/B numbers.")

        # A/B preview: indecision | jerk side by side whenever both exist,
        # otherwise just whatever drove the hold map.
        panels = ([Jmap, Kmap] if (Jmap is not None and Kmap is not None)
                  else [heat_map])
        if images is not None:
            heat = torch.cat([_heat_overlay(images, M, float(alpha))
                              for M in panels], dim=2)
        else:
            heat = torch.cat([_heat_tiles(M) for M in panels], dim=2)
        return (hold_map, segs_str, int(w0), int(wlen), profile, report,
                comparison, heat)

    @staticmethod
    def _resolve_pair(dump_dir, step_a, step_b, auto_fallback):
        """Pick the actual (a, b) to read. Several shipped graphs tap
        0,1,12,24 only, so the default 6->12 is not always on disk."""
        have = _x0_available_steps(dump_dir)
        assert have, (f"no x0_stepNNN.pt files in {dump_dir} — was pass 1 run "
                      f"through the X0 Tap (SAMPLER wrapper)?")
        a, b = int(step_a), int(step_b)
        if a in have and b in have:
            if b <= a:
                raise ValueError(f"step_b ({b}) must be later than step_a ({a})")
            return a, b, ""
        if not auto_fallback:
            raise ValueError(
                f"steps {a}->{b} were not both dumped in {dump_dir}; available: "
                f"{have}. Re-tap pass 1 with dump_steps including both, or turn "
                f"auto_fallback on.")
        cands = [(x, y) for x in have for y in have if y > x]
        assert cands, f"only one step dumped in {dump_dir}: {have}"
        a2, b2 = min(cands, key=lambda p: (abs(p[0] - a) + abs(p[1] - b), p))
        return a2, b2, (f"*** step fallback: {a}->{b} was not dumped, using the "
                        f"closest available pair {a2}->{b2}. Steps on disk: "
                        f"{have}. Only 6->12 (25-step run) and 12->24 (coarse "
                        f"taps) have been validated; treat anything else as "
                        f"unmeasured, and re-tap pass 1 if you care. ***")


def _env_value(auto, param, frame, default):
    """Evaluate a breakpoint envelope [[frame, value], ...] at a frame."""
    pts = (auto or {}).get(param)
    if not pts:
        return default
    pts = sorted(pts, key=lambda p: p[0])
    if frame <= pts[0][0]:
        return float(pts[0][1])
    if frame >= pts[-1][0]:
        return float(pts[-1][1])
    for (f0, v0), (f1, v1) in zip(pts[:-1], pts[1:]):
        if f0 <= frame <= f1:
            if f1 == f0:
                return float(v1)
            a = (frame - f0) / (f1 - f0)
            return float(v0) + a * (float(v1) - float(v0))
    return default


def _rasterize_strokes(strokes, h, w):
    """Vector strokes (normalized coords, disc brush) -> (h, w) 0/1 mask.
    Brush and erase apply in stroke order."""
    import math
    m = torch.zeros(h, w)
    for s in strokes or []:
        r = max(1.0, float(s.get("r", 0.03)) * w)
        pts = s.get("pts") or []
        stamped = []
        for i, (x1, y1) in enumerate(pts):
            if i == 0:
                stamped.append((x1, y1))
                continue
            x0, y0 = pts[i - 1]
            d = math.hypot((x1 - x0) * w, (y1 - y0) * h)
            nsub = max(1, int(d / max(1.0, r * 0.5)))
            for k in range(1, nsub + 1):
                stamped.append((x0 + (x1 - x0) * k / nsub,
                                y0 + (y1 - y0) * k / nsub))
        val = 0.0 if s.get("t") == "erase" else 1.0
        for px, py in stamped:
            cx, cy = px * w, py * h
            x0i, x1i = int(max(0, cx - r - 1)), int(min(w, cx + r + 2))
            y0i, y1i = int(max(0, cy - r - 1)), int(min(h, cy + r + 2))
            if x1i <= x0i or y1i <= y0i:
                continue
            ys = torch.arange(y0i, y1i).float()[:, None]
            xs = torch.arange(x0i, x1i).float()[None, :]
            hit = (ys - cy) ** 2 + (xs - cx) ** 2 <= r * r
            patch = m[y0i:y1i, x0i:x1i]
            patch[hit] = val
    return m


class H3ManualHoldMap:
    """Author the hold map by hand: time ranges in, oracle-format hold
    map out. Solo mode replaces the oracle; gate mode keeps the oracle's
    holds only inside your ranges (the oracle proposes, you dispose)."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-09; the classic pipeline nodes are unchanged.\n\n"
        "Manual targeting: turns user-chosen time ranges into the same "
        "hold-map JSON the H3 Jerk Oracle emits, so H3 Time Smear, H3 "
        "Exact Recover and H3 Audio Recover work unmodified.\n\n"
        "ranges syntax: comma-separated start-end pairs, in frames or "
        "seconds, with an optional per-range hold count: '36-60, "
        "88-102:3' or '1.5s-2.4s:4'. Ends inclusive. Ranges snap "
        "outward to the model's token grid (one token spans ~4 frames); "
        "the segments output echoes what actually got held, so trust it "
        "over your typed numbers.\n\n"
        "GATE mode: wire the oracle's hold_map into oracle_hold_map and "
        "the oracle's holds survive only inside your ranges — the fix "
        "for an overzealous oracle. Leave it unwired to author holds "
        "directly at 'hold' per range.\n\n"
        "The report output is the price tag: world length vs effective "
        "regen length. Show it before committing to the expensive pass; "
        "set s_per_step (measured on a baseline run of YOUR clip on "
        "YOUR card) for a minutes estimate.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "length": ("INT", {"default": 124, "min": 5, "max": 3600,
                       "tooltip": "world-clock frame count of the clip"}),
            "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
            "ranges": ("STRING", {"default": "", "multiline": True,
                       "tooltip": "start-end[:hold], comma-separated; frames or seconds ('1.5s'), ends inclusive"}),
            "hold": ("INT", {"default": 4, "min": 2, "max": 8,
                     "tooltip": "hold count for ranges without an explicit :hold"}),
            "ramp": ("BOOLEAN", {"default": True,
                     "tooltip": "C1 ramp shoulders, same as the oracle — keep ON"}),
            "bridge": ("INT", {"default": 8, "min": 0, "max": 20,
                       "tooltip": "fill short valleys between peak spans, same rule as the oracle"}),
        }, "optional": {
            "oracle_hold_map": ("STRING", {"default": "", "forceInput": True,
                                "tooltip": "wire H3 Jerk Oracle's hold_map to gate it by your ranges"}),
            **_cost_widgets(),
        }}

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("hold_map", "segments", "report")
    FUNCTION = "build"
    CATEGORY = "latent/minimax/motion"

    def build(self, length, fps, ranges, hold, ramp, bridge,
              oracle_hold_map="", s_per_step=0.0, est_steps=18,
              overhead_s=OVERHEAD_S):
        spans = []
        for part in ranges.split(","):
            part = part.strip()
            if not part:
                continue
            h = hold
            if ":" in part:
                part, hs = part.rsplit(":", 1)
                h = max(1, int(hs))
            a_s, b_s = part.split("-")

            def to_frame(v):
                v = v.strip().lower()
                return (int(round(float(v[:-1]) * fps)) if v.endswith("s")
                        else int(v))

            a, b = max(0, to_frame(a_s)), min(length - 1, to_frame(b_s))
            assert a <= b, f"empty range '{part}' after clamping to the clip"
            spans.append((a, b, h))
        wired = bool(oracle_hold_map.strip())
        assert spans or wired, ("give at least one range, e.g. '36-60' or "
                                "'1.5s-2.4s:4' (or wire the oracle)")

        frame_holds = np.ones(length, int)
        passthrough = False
        if wired:
            oracle = json.loads(oracle_hold_map)["holds"]
            assert len(oracle) == length, (
                f"oracle map covers {len(oracle)} frames, length is {length}")
            if not spans:
                # wired oracle, nothing typed yet: pass its plan straight through,
                # so the first run needs no typing and shows the spans to edit
                # (operator 2026-08-21: "populated with what the oracle is thinking")
                frame_holds[:] = oracle
                passthrough = True
                print("[MAINodes] H3ManualHoldMap: no ranges typed, passing the oracle's map through")
            for a, b, _ in spans:                 # gate: oracle inside, 1 outside
                frame_holds[a:b + 1] = oracle[a:b + 1]
        else:
            for a, b, h in spans:
                frame_holds[a:b + 1] = h

        holds, segments, t_lat = _compile_hold_map(frame_holds, length,
                                                   ramp, bridge)
        report = _cost_report(length, _legal_ceil(sum(holds)), fps,
                              s_per_step, est_steps, overhead_s)
        if passthrough:
            report += ("\noracle passed through (no ranges typed); copy the spans "
                       "above into ranges to edit them")
        hold_map = json.dumps({"holds": holds, "world_len": length})
        return (hold_map, segments, report)


class H3TimeSmear:
    """Retime frames onto a longer uniform grid by integer holds — the
    nonuniform (oracle) or uniform (dilation) smear that seeds v2v
    injection. Output length is snapped up to the 17k+5 grid by extending
    the final hold; the emitted hold_map records exactly what happened so
    H3ExactRecover can invert it losslessly."""

    DESCRIPTION = (
        "Retimes frames onto a longer uniform grid by integer frame holds — "
        "the seed material for v2v regeneration.\n\n"
        "Two modes: UNIFORM (nothing wired to hold_map): every frame held "
        "'dilation' times (default 4 — the zero-artifact reference point; "
        "highest cost). ADAPTIVE (wire H3 Jerk Oracle's hold_map): only "
        "jerk-hot spans get held, quiet spans stay real-time — cheaper and "
        "preserves the clip's natural beat contrast ('motion beauty'), at a "
        "small artifact risk where the hold curve dips inside a burst.\n\n"
        "expand_to_end (default ON): if the map ends in a rate-1 tail behind "
        "an expansion span, that tail reads as a little jump back to real "
        "time at the clip end. With the toggle on, the span is run through "
        "the last world frame instead and the length is put back on the "
        "17k+5 grid inside the same span. Uniform maps, maps that already "
        "end inside an expansion, rate-1-only maps, and rest tails longer "
        "than 17 world frames are left alone. The console and the report "
        "say so whenever a map is rewritten.\n\n"
        "Output length is snapped up to the H3-legal 17k+5 grid by extending "
        "the final hold - or to the TARGET model's grid when the map comes from "
        "H3 Clock Remap (LTX-2.5: 8k+1). ALWAYS pass hold_map_used to H3 Exact "
        "Recover — it records exactly what happened so recovery is lossless.\n\n"
        "EFFECTIVE SIZE: the report output is the price tag for everything "
        "downstream of here — a 5 s action clip regenerates as 11 to 13 s of "
        "frame data, and that dilated length, not the runtime, is what sets "
        "the bill and the VRAM peak. Read the TIME multiplier, not the frame "
        "one: per-step cost is superlinear in tokens, so 2.5x the frames is "
        "about 4.9x the time per step. Set s_per_step from a baseline render "
        "of this clip on this card for a minutes estimate.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "dilation": ("INT", {"default": 4, "min": 1, "max": 8,
                                 "tooltip": "uniform hold count; ignored when hold_map is wired"}),
        }, "optional": {
            "hold_map": ("STRING", {"default": "",
                                    "tooltip": "from H3JerkOracle — per-frame integer holds"}),
            "expand_to_end": ("BOOLEAN", {"default": True,
                              "tooltip": "when the map ends in a SHORT rate-1 tail (<= 17 frames) after an expansion span, run that span through the last frame instead (kills the end jump). Uniform maps and longer rest tails are untouched"}),
            **_cost_widgets(with_fps=True),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "STRING")
    RETURN_NAMES = ("images", "hold_map_used", "length", "report")
    FUNCTION = "smear"
    CATEGORY = "image/minimax/motion"

    def smear(self, images, dilation, hold_map="", expand_to_end=True, fps=24,
              s_per_step=0.0, est_steps=18, overhead_s=OVERHEAD_S):
        images = images.detach().cpu()  # keep the (possibly huge) held batch off VRAM
        n = images.shape[0]
        hm = json.loads(hold_map) if hold_map.strip() else {}
        holds = hm["holds"] if hm else [dilation] * n
        assert len(holds) == n, f"hold map covers {len(holds)} frames, batch has {n}"
        # A map from H3 Clock Remap carries the TARGET model's legal grid; an
        # oracle / manual map carries none and gets H3's 17k+5 as before.
        legal = tuple(hm["legal"]) if hm.get("legal") else None
        note = None
        if expand_to_end and not legal:
            holds, note = expand_hold_map_to_end(holds)
            if note:
                print("[MAINodes] H3TimeSmear " + note)
        if legal:
            try:
                from .model_profiles import legal_ceil as _gen_legal
            except ImportError:                  # tests import motion top-level
                from model_profiles import legal_ceil as _gen_legal
            target = _gen_legal(sum(holds), legal)
        else:
            target = _legal_ceil(sum(holds))
        n_held = sum(1 for h in holds if h > 1)   # count before the tail pad
        holds = list(holds)
        holds[-1] += target - sum(holds)          # tail pad lives in the last hold
        idx = torch.tensor([i for i, h in enumerate(holds) for _ in range(h)])
        used = dict(hm, holds=holds, world_len=n) if hm else {"holds": holds, "world_len": n}
        used = json.dumps(used)
        mode = ("uniform x{}".format(dilation) if not hold_map.strip()
                else "adaptive, {} of {} frames held".format(n_held, n))
        report = _cost_report(n, target, fps, s_per_step, est_steps,
                              overhead_s, tail=mode)
        if note:
            report += "\n" + note
        return (images[idx], used, int(target), report)


class H3ExactRecover:
    """Invert H3TimeSmear: keep the first frame of every hold group —
    exact 24fps real-time recovery by frame selection (never resampling)."""

    DESCRIPTION = (
        "Inverts H3 Time Smear: keeps the first frame of every hold group, "
        "giving exact 24fps real-time recovery by pure frame selection — "
        "never interpolation or resampling, so recovered frames are pixel-"
        "identical to generated ones. Wire hold_map from the SAME H3 Time "
        "Smear node that produced the frames (hold_map_used output).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "hold_map": ("STRING", {"default": ""}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "recover"
    CATEGORY = "image/minimax/motion"

    def recover(self, images, hold_map):
        holds = json.loads(hold_map)["holds"]
        starts, cur = [], 0
        for h in holds:
            starts.append(cur)
            cur += h
        assert cur == images.shape[0], (cur, images.shape[0])
        # cpu: recovered frames feed image-composition nodes (ImageBatch,
        # splices) whose other inputs are CPU loads; a cuda tensor here
        # crashes the cat. Matches H3TimeSmear's convention.
        return (images[torch.tensor(starts)].cpu(),)


_TRUE_CLOCK = {"spans": None}   # armed per run; never left set (see _wrap)


def _install_true_clock_patch():
    """Chain a density-corrected override onto _video_t_spans, once.

    Same sanctioned mechanism as h3-motion-lab's H3LocalRate
    (custom_nodes/h3-motion-lab/__init__.py:139-153): the packed layout is
    built in extra_conds BEFORE sampler.sample runs, so the override lives in
    module state, is armed at node-execution time and disarmed in a finally.
    We chain whatever is currently bound (so loading order with h3-motion-lab
    does not matter and both warps compose) and guard on exact token count, so
    reference-video blocks and any other call keep the stock grid."""
    import comfy.ldm.minimax.model as _mm
    if getattr(_mm._video_t_spans, "_h3_true_clock", False):
        return
    prev = _mm._video_t_spans

    def patched(n):
        spans = _TRUE_CLOCK["spans"]
        if spans is not None and len(spans) == n:   # exact-length guard
            return list(spans)
        return prev(n)

    patched._h3_true_clock = True
    _mm._video_t_spans = patched


class _TrueClockSampler:
    def __init__(self, inner, spans):
        self.inner = inner
        self.spans = spans

    def max_denoise(self, model_wrap, sigmas):
        return self.inner.max_denoise(model_wrap, sigmas)

    def sample(self, *args, **kwargs):
        _TRUE_CLOCK["spans"] = self.spans      # belt; layout is usually prebuilt
        try:
            return self.inner.sample(*args, **kwargs)
        finally:
            _TRUE_CLOCK["spans"] = None        # never leak the clock into later runs


class H3TrueClock:
    """EXPERIMENTAL: tell the model the smeared clip's true world duration.

    Divides the RoPE t-grid by the local hold density from H3 Time Smear's
    hold map, so a de-roped clip occupies its WORLD duration on the physical
    time axis instead of its dilated one. Wraps a SAMPLER, scoped to one run.
    """

    DESCRIPTION = (
        "EXPERIMENTAL, default-off, off-distribution: the model was trained "
        "on uniform time grids and has never seen the one this node builds. "
        "Expect it to be able to make things worse.\n\n"
        "What it does: H3's RoPE time axis is physical (5/3 units per world "
        "frame), so a time-smeared clip reads to the model as a LONGER take "
        "rather than as slow motion — which is why unfrozen background agents "
        "(gulls, crowds) animate on through the held frames and come out "
        "ACCELERATED after H3 Exact Recover. This node divides each latent "
        "token's RoPE span by the local hold density, so the dilated clip's "
        "total RoPE duration equals its world duration and held copies share "
        "one world frame's worth of time.\n\n"
        "Wire H3 Time Smear's hold_map_used straight in (the tail pad it "
        "folded into the last hold rides along: pad frames are extra copies "
        "of the final world frame and cost no extra world time). Wire the "
        "same sampler you would otherwise pass to SamplerCustomAdvanced. "
        "Judged on: does world-speed hold for background agents, and does "
        "beat duplication drop.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "sampler": ("SAMPLER",),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "hold_map_used from the H3 Time Smear that made this clip"}),
        }}

    RETURN_TYPES = ("SAMPLER",)
    RETURN_NAMES = ("sampler",)
    FUNCTION = "wrap"
    CATEGORY = "sampling/custom_sampling/samplers"

    @classmethod
    def IS_CHANGED(cls, *a, **k):
        # The layout is prebuilt in extra_conds BEFORE sampler.sample runs, so
        # the override must be armed at node-execution time — and the node must
        # re-execute every run or a cached hit leaves it disarmed.
        return float("nan")

    def wrap(self, sampler, hold_map):
        holds = json.loads(hold_map)["holds"]
        spans = true_clock_spans(holds)
        _install_true_clock_patch()
        # a guide's cond rows must ride this clock too, whoever built them
        # (this node's H3 Add Latent Guide or core's image Add Guide)
        _install_guide_layout_patch()
        _TRUE_CLOCK["spans"] = spans   # armed NOW, before extra_conds builds the layout
        return (_TrueClockSampler(sampler, spans),)


# --- DyRoPE: layer-wise / sigma-faded time geometry ------------------------
#
# H3 True Clock rewrites the RoPE t-grid for EVERY block. Measured 2026-08-15
# on the pier cell that bought a real speed correction at the price of seam
# flash (7.17x the arm's own baseline vs 1.87x for the control) and jitter
# (5.06x vs 0.85x); the warped-decode arm moved the decode by 0.8%, so the
# sampler owns the damage. The standing hypothesis is an off-distribution
# penalty from a non-uniform grid fed identically to all 50 blocks.
#
# DyRoPE splits the two geometries apart so they can be given to DIFFERENT
# blocks, or mixed over the denoise schedule:
#   physical = True Clock spans        (true_clock_spans(holds))
#   compact  = the stock uniform grid  (core _video_t_spans, 5/3 * 1,4,4,4,4)
# The rotation table is built once per forward at
# comfy/ldm/minimax/model.py:694 and handed to every block, and a
# ``patches_replace["dit"][("double_block", i)]`` patch receives it as
# ``args["rope_freqs"]`` and may substitute it (model.py:697-709) — so a
# per-block table needs no core change. Fade modes need no block patches at
# all: they hand one interpolated table to everybody, per step.
#
# NOTE on where the fade is computed. The packed layout (and with it
# position_ids) is prebuilt ONCE per sampling run in extra_conds
# (comfy/model_base.py:2206-2208), so a per-step geometry cannot ride the
# _video_t_spans patch the way True Clock's does. It rides the rope_freqs
# wrapper instead, which runs once per forward and can rebuild the t column.

_DYROPE = {
    "active": False,      # rope_freqs wrapper does work only when this is set
    "mode": None,
    "n_tokens": 0,
    "spans_phys": None,
    "spans_comp": None,
    "blocks": (),         # blocks that get the ALTERNATE table
    "fade_end": 0.5,
    "sigma_max": None,
    "sigma": None,
    "alt_angles": None,   # [S, 96] angles for the alternate geometry, per forward
    "alt_table": None,    # rotation table built lazily from alt_angles
    "alt_requested": 0,   # how many blocks actually pulled the alternate table
    "last_weight": None,
}

DYROPE_MODES = ["physical_all", "compact_all", "physical_blocks",
                "compact_blocks", "fade_physical_to_compact",
                "fade_compact_to_physical", "fade_physical_blocks"]

# modes whose incoming position_ids must already carry the physical grid
_DYROPE_PHYSICAL_ARMED = ("physical_all", "physical_blocks", "compact_blocks",
                          "fade_physical_to_compact", "fade_compact_to_physical",
                          "fade_physical_blocks")


def dyrope_stock_spans(n):
    """The core's UNPATCHED per-token t-spans, read from the core constants.

    Deliberately not a call to comfy.ldm.minimax.model._video_t_spans: that
    symbol is what True Clock (and h3-motion-lab's local rate) chain onto, so
    while a run is armed it returns the physical grid. This is the "compact"
    geometry by definition: the grid the model was trained on."""
    import comfy.ldm.minimax.model as _mm
    return [_mm.FRAME_RESCALE * _mm.FRAME_PER_TOKEN[k % len(_mm.FRAME_PER_TOKEN)]
            for k in range(n)]


def dyrope_grid(spans, origin=0.0):
    """origin + exclusive cumsum, BIT-IDENTICAL to the core's _video_t_grid.

    Deliberately the same float64 torch cumsum the core uses rather than a
    python running sum: the two disagree in the last bits (summation order),
    and the compact arm has to rebuild the exact coordinates the model would
    have seen with no node in the graph."""
    t = torch.tensor([float(s) for s in spans], dtype=torch.float64)
    if t.numel() == 0:
        return []
    g = float(origin) + torch.cat([torch.zeros(1, dtype=torch.float64), t[:-1].cumsum(0)])
    return g.tolist()


def dyrope_fade_weight(sigma, sigma_max, fade_end):
    """Weight on the FIRST-named geometry: 1.0 at sigma_max, 0.0 at fade_end,
    linear in sigma between, clamped outside."""
    if sigma is None or sigma_max is None:
        return 1.0
    span = float(sigma_max) - float(fade_end)
    if span <= 1e-12:
        return 0.0 if float(sigma) <= float(fade_end) else 1.0
    w = (float(sigma) - float(fade_end)) / span
    return max(0.0, min(1.0, w))


def dyrope_video_rows(position_ids, t_lat):
    """(start_row, rows_per_frame) of the target video segment.

    The target streams are the last two segments of the packed sequence
    (audio then video, comfy/ldm/minimax/model.py:715), and every row of one
    latent frame shares one t coordinate, so the trailing run of equal t
    values is exactly one frame's worth of rows."""
    t_col = position_ids[:, 0]
    total = int(t_col.shape[0])
    last = t_col[-1]
    rows_per_frame = int((t_col == last).flip(0).cumprod(0).sum().item())
    if rows_per_frame <= 0:
        raise RuntimeError("H3 DyRoPE: could not size a video frame's rows")
    n_rows = t_lat * rows_per_frame
    if n_rows > total:
        raise RuntimeError(
            "H3 DyRoPE: layout too short for %d tokens x %d rows (seq %d)"
            % (t_lat, rows_per_frame, total))
    return total - n_rows, rows_per_frame


def dyrope_retimed_position_ids(position_ids, start, rows_per_frame, grid):
    """Copy of position_ids with the video segment's t column replaced by grid
    (one value per latent token, repeated over the frame's rows). Every other
    row is bit-identical."""
    out = position_ids.clone()
    vals = torch.tensor(grid, dtype=out.dtype, device=out.device)
    out[start:, 0] = vals.repeat_interleave(rows_per_frame)
    return out


def _install_dyrope_rope_patch():
    """Chain a geometry-aware override onto MiniMaxH3Model.rope_freqs, once.

    Same sanctioned shape as _install_true_clock_patch: chain whatever is
    bound, gate on module state armed by the sampler wrapper and disarmed in
    a finally, so an unarmed process is untouched."""
    import comfy.ldm.minimax.model as _mm
    if getattr(_mm.MiniMaxH3Model.rope_freqs, "_h3_dyrope", False):
        return
    prev = _mm.MiniMaxH3Model.rope_freqs

    def patched(self, position_ids, device):
        st = _DYROPE
        if not st["active"]:
            return prev(self, position_ids, device)
        st["alt_angles"] = None
        st["alt_table"] = None
        n = int(st["n_tokens"])
        total = int(position_ids.shape[0])
        # exact-length guard, same intent as True Clock's: a layout that
        # cannot hold this clip's tokens is somebody else's call
        if n <= 0 or total < n:
            return prev(self, position_ids, device)
        start, rpf = dyrope_video_rows(position_ids, n)
        origin = float(position_ids[start, 0])
        g_phys = dyrope_grid(st["spans_phys"], origin)
        g_comp = dyrope_grid(st["spans_comp"], origin)
        # never silently mis-rotate: the rows we identified MUST be the ones
        # True Clock already retimed
        have = position_ids[start::rpf, 0].tolist()
        want = g_phys if st["mode"] in _DYROPE_PHYSICAL_ARMED else g_comp
        if len(have) != len(want) or max(abs(a - b) for a, b in zip(have, want)) > 1e-9:
            raise RuntimeError(
                "H3 DyRoPE: the rows identified as target video (start=%d, "
                "%d rows/frame, %d tokens) do not carry the armed t-grid "
                "(first mismatch %r vs %r). Refusing to rotate the wrong "
                "rows." % (start, rpf, n, have[:4], want[:4]))

        mode = st["mode"]
        if mode == "physical_blocks":
            g_default, g_alt = g_comp, g_phys
        elif mode == "compact_blocks":
            g_default, g_alt = g_phys, g_comp
        elif mode == "fade_physical_blocks":
            # combo arm: the named blocks see the per-step faded grid
            # (physical at sigma_max, compact by fade_end); every other
            # block sees compact at every step. Both dose axes at once.
            w = dyrope_fade_weight(st["sigma"], st["sigma_max"], st["fade_end"])
            st["last_weight"] = w
            mixed = [w * float(a) + (1.0 - w) * float(b)
                     for a, b in zip(st["spans_phys"], st["spans_comp"])]
            g_default, g_alt = g_comp, dyrope_grid(mixed, origin)
        else:  # fade_*
            w = dyrope_fade_weight(st["sigma"], st["sigma_max"], st["fade_end"])
            st["last_weight"] = w
            first, second = ((st["spans_phys"], st["spans_comp"])
                             if mode == "fade_physical_to_compact"
                             else (st["spans_comp"], st["spans_phys"]))
            # interpolate SPANS then cumsum: a convex mix of positive spans is
            # positive, so the grid stays strictly monotone. Never interpolate
            # rotation tables.
            mixed = [w * float(a) + (1.0 - w) * float(b) for a, b in zip(first, second)]
            g_default, g_alt = dyrope_grid(mixed, origin), None

        # aligned latent guides: cond rows duplicate target rows, so they have
        # to follow them onto whichever grid this table is being built for.
        # Keyed on EXACT sequence length, the same guard shape True Clock uses.
        rec = _GUIDE_LAYOUTS.get(total)

        pos_default = (position_ids if g_default is want
                       else dyrope_retimed_position_ids(position_ids, start, rpf, g_default))
        if rec is not None:
            pos_default = guide_retimed_position_ids(pos_default, rec, "H3 DyRoPE")
        angles = prev(self, pos_default, device)
        if g_alt is not None:
            pos_alt = (position_ids if g_alt is want
                       else dyrope_retimed_position_ids(position_ids, start, rpf, g_alt))
            if rec is not None:
                pos_alt = guide_retimed_position_ids(pos_alt, rec, "H3 DyRoPE")
            st["alt_angles"] = prev(self, pos_alt, device)
        return angles

    patched._h3_dyrope = True
    _mm.MiniMaxH3Model.rope_freqs = patched


def _dyrope_block_patch(index):
    """double_block replacement that swaps in the alternate rotation table.

    Registered through ModelPatcher.set_model_patch_replace, so the capability
    probe (h3_capabilities.block_patch_report) attributes it to this pack and
    warns about a collision with H3 Streamed Blocks, which owns the same key."""
    def dyrope_double_block(args, extra):
        st = _DYROPE
        angles = st.get("alt_angles")
        if angles is not None:
            import comfy.ldm.minimax.model as _mm
            table = st.get("alt_table")
            ref = args["rope_freqs"]
            if table is None or table.dtype != ref.dtype:
                table = _mm.rope_rotation_table(angles, ref.dtype)
                st["alt_table"] = table
            st["alt_requested"] += 1
            args = dict(args)
            args["rope_freqs"] = table
        return extra["original_block"](args)

    dyrope_double_block._h3_dyrope_block = int(index)
    return dyrope_double_block


def _dyrope_diffusion_wrapper(executor, *args, **kwargs):
    """DIFFUSION_MODEL wrapper: stash this step's sigma before rope_freqs runs.

    forward() builds the executor around _forward with (x, timestep, context,
    transformer_options, ...) (comfy/ldm/minimax/model.py:539-545) and the
    core derives sigma as timestep/1000 (model.py:571)."""
    st = _DYROPE
    if st["active"] and str(st["mode"]).startswith("fade"):
        ts = args[1] if len(args) > 1 else kwargs.get("timestep")
        try:
            st["sigma"] = float(ts.flatten()[0]) / 1000.0
        except Exception:  # noqa: BLE001
            st["sigma"] = None
    return executor(*args, **kwargs)


class _DyRoPESampler:
    def __init__(self, inner, state):
        self.inner = inner
        self.state = state

    def max_denoise(self, model_wrap, sigmas):
        return self.inner.max_denoise(model_wrap, sigmas)

    def sample(self, *args, **kwargs):
        prev_clock = _TRUE_CLOCK["spans"]
        _TRUE_CLOCK["spans"] = self.state["_clock_spans"]   # None for compact_all
        for k, v in self.state.items():
            if not k.startswith("_"):
                _DYROPE[k] = v
        _DYROPE["sigma"] = None
        _DYROPE["alt_angles"] = None
        _DYROPE["alt_table"] = None
        _DYROPE["alt_requested"] = 0
        sigmas = kwargs.get("sigmas")
        if sigmas is None and len(args) > 1:
            sigmas = args[1]
        try:
            _DYROPE["sigma_max"] = float(sigmas[0])
        except Exception:  # noqa: BLE001
            _DYROPE["sigma_max"] = None
        try:
            return self.inner.sample(*args, **kwargs)
        finally:
            _TRUE_CLOCK["spans"] = prev_clock if prev_clock is None else None
            _DYROPE["active"] = False
            _DYROPE["mode"] = None
            _DYROPE["alt_angles"] = None
            _DYROPE["alt_table"] = None
            _DYROPE["sigma"] = None
            _DYROPE["sigma_max"] = None


DYROPE_PRESETS = {
    "custom": None,  # knobs used as-is; old graphs (no preset widget) resolve here
    "timing fidelity (blocks 30-49)": ("physical_blocks", 30, 49, 0.7),
    "minimal shimmer (blocks 40-49)": ("physical_blocks", 40, 49, 0.7),
    "flash-free fade (sigma 0.7)": ("fade_physical_to_compact", 0, 24, 0.7),
}


class H3DyRoPE:
    """EXPERIMENTAL: give different BLOCKS (or different SIGMAS) different
    time geometries, instead of one grid for all 50.

    Wraps a SAMPLER and (for the per-block modes) a MODEL, scoped to one run.
    """

    DESCRIPTION = (
        "EXPERIMENTAL, default-off, off-distribution: an instrument for the "
        "question H3 True Clock left open. True Clock hands its "
        "density-corrected RoPE t-grid to every block at every step; the "
        "measured cost was seam flash and jitter well above the control's, "
        "while the speed correction itself worked. This node splits the two "
        "geometries so they can be handed out selectively:\n\n"
        "  physical = True Clock's grid (the clip's true world duration)\n"
        "  compact  = the stock uniform grid the model was trained on\n\n"
        "physical_all reproduces H3 True Clock exactly; compact_all "
        "reproduces having no node at all. Those two are the identity arms. "
        "*_blocks give the named block range one geometry and every other "
        "block the other. fade_* give every block ONE grid per step, "
        "interpolated between the two as a function of sigma, complete at "
        "fade_end (spans are interpolated and then accumulated, so the grid "
        "stays monotone).\n\n"
        "Wire H3 Time Smear's hold_map_used into hold_map, the sampler you "
        "would otherwise pass to SamplerCustomAdvanced into sampler, and — "
        "for the *_blocks modes — route the model OUT of this node into your "
        "guider, or the per-block tables never reach the sampler.\n\n"
        "Not composable with H3 Streamed Blocks: both own the "
        "double_block replacement slot and Comfy keeps only one per block "
        "(the capability probe reports the collision). The fade modes use no "
        "block patches and compose fine.\n\n"
        "Judged on: does a hybrid keep the world-speed correction while "
        "bringing seam flash and jitter back toward the control's.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "sampler": ("SAMPLER",),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "hold_map_used from the H3 Time Smear that made this clip"}),
            "mode": (DYROPE_MODES, {"default": "physical_blocks",
                     "tooltip": "which blocks/steps see the physical grid"}),
            "block_lo": ("INT", {"default": 30, "min": 0, "max": 49,
                         "tooltip": "first block of the range (inclusive), *_blocks modes only"}),
            "block_hi": ("INT", {"default": 49, "min": 0, "max": 49,
                         "tooltip": "last block of the range (inclusive), *_blocks modes only"}),
            "fade_end": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01,
                         "tooltip": "sigma at which the fade completes; linear in sigma from sigma_max down to here"}),
        },
        "optional": {
            "preset": (list(DYROPE_PRESETS), {"default": "custom",
                       "tooltip": "a measured setting overrides the mode/block/fade knobs; "
                                  "custom leaves the knobs in charge (old graphs resolve here)"}),
        }}

    RETURN_TYPES = ("MODEL", "SAMPLER", "STRING")
    RETURN_NAMES = ("model", "sampler", "report")
    FUNCTION = "wrap"
    CATEGORY = "sampling/custom_sampling/samplers"

    @classmethod
    def IS_CHANGED(cls, *a, **k):
        # Same reason as H3TrueClock: the layout is prebuilt in extra_conds
        # BEFORE sampler.sample runs, so the override must be armed at
        # node-execution time — and a cached hit would leave it disarmed.
        return float("nan")

    def wrap(self, model, sampler, hold_map, mode, block_lo, block_hi, fade_end,
             preset="custom"):
        chosen = DYROPE_PRESETS.get(preset)
        if chosen is not None:
            mode, block_lo, block_hi, fade_end = chosen
        holds = json.loads(hold_map)["holds"]
        spans_phys = true_clock_spans(holds)
        n = len(spans_phys)
        spans_comp = dyrope_stock_spans(n)
        lo, hi = int(min(block_lo, block_hi)), int(max(block_lo, block_hi))
        uses_blocks = mode in ("physical_blocks", "compact_blocks",
                               "fade_physical_blocks")
        is_fade = str(mode).startswith("fade")
        blocks = tuple(range(lo, hi + 1)) if uses_blocks else ()

        state = {
            "active": uses_blocks or is_fade,
            "mode": mode,
            "n_tokens": n,
            "spans_phys": spans_phys,
            "spans_comp": spans_comp,
            "blocks": blocks,
            "fade_end": float(fade_end),
            "_clock_spans": spans_phys if mode in _DYROPE_PHYSICAL_ARMED else None,
        }

        _install_true_clock_patch()
        _install_guide_layout_patch()   # cond rows follow the target's grid
        if state["active"]:
            _install_dyrope_rope_patch()
        # armed NOW, before extra_conds builds the layout
        _TRUE_CLOCK["spans"] = state["_clock_spans"]
        for k, v in state.items():
            if not k.startswith("_"):
                _DYROPE[k] = v

        out_model = model
        n_blocks = None
        if uses_blocks:
            dm = getattr(getattr(model, "model", None), "diffusion_model", None)
            n_blocks = len(getattr(dm, "blocks", []) or [])
            try:  # collision report: who already has a hand on this model (never blocks)
                from . import h3_capabilities as _caps
                for w in _caps.collision_warnings(_caps.block_patch_report(model)):
                    print("[MAINodes] H3DyRoPE: " + w)
            except Exception as _e:  # noqa: BLE001
                print("[MAINodes] H3DyRoPE: collision report skipped (%s: %s)" % (type(_e).__name__, _e))
            out_model = model.clone()
            for i in blocks:
                if n_blocks and i >= n_blocks:
                    continue
                out_model.set_model_patch_replace(_dyrope_block_patch(i), "dit", "double_block", i)
        if is_fade:
            import comfy.patcher_extension as _px
            if out_model is model:
                out_model = model.clone()
            out_model.add_wrapper(_px.WrappersMP.DIFFUSION_MODEL,
                                  _dyrope_diffusion_wrapper)

        if mode == "fade_physical_blocks":
            who = ("blocks %d-%d -> physical faded to compact by sigma %.3f, "
                   "all other blocks -> compact%s"
                   % (lo, hi, float(fade_end),
                      "" if n_blocks is None else " (of %d)" % n_blocks))
        elif uses_blocks:
            alt = "physical" if mode == "physical_blocks" else "compact"
            other = "compact" if mode == "physical_blocks" else "physical"
            who = ("blocks %d-%d -> %s, all other blocks -> %s%s"
                   % (lo, hi, alt, other,
                      "" if n_blocks is None else " (of %d)" % n_blocks))
        elif is_fade:
            who = ("all blocks -> one interpolated grid per step, %s, "
                   "complete at sigma %.3f" % (mode[5:].replace("_", " "), float(fade_end)))
        else:
            who = "all blocks -> %s (identity arm, no block patches)" % mode[:-4].rstrip("_")

        report = ("H3 DyRoPE: mode=%s block_lo=%d block_hi=%d fade_end=%.3f\n"
                  "tokens=%d  physical sum=%.6f (= %d world frames x 5/3)  "
                  "compact sum=%.6f (= %d dilated frames x 5/3)\n"
                  "%s"
                  % (mode, lo, hi, float(fade_end), n,
                     sum(spans_phys), len(holds),
                     sum(spans_comp), sum(_snap_holds(holds)), who))
        return (out_model, _DyRoPESampler(sampler, state), report)



class H3V2VInit:
    """Wrap a VAE-encoded video latent as the nested AV latent that
    SamplerCustomAdvanced expects for H3, ready for partial-denoise
    injection (pair with H3InjectSchedule). Audio starts from zeros and
    regenerates on the truncated schedule (jointly with the video —
    the operator-preferred audio source for regenerated content)."""

    DESCRIPTION = (
        "Wraps a VAE-encoded video latent (from VAEEncode of the smeared "
        "frames) as the nested audio+video latent H3's SamplerCustomAdvanced "
        "expects, ready for partial-denoise injection. Audio starts empty and "
        "generates jointly with the video on the truncated schedule — "
        "causally synced foley, the preferred audio source for regenerated "
        "content. length=0 (default) derives the frame count from the latent "
        "itself; wire H3 Time Smear's length output or set it only to assert "
        "a specific grid.\n\n"
        "Background freeze: wire the BASELINE latent into oracle_samples and "
        "set freeze_threshold above 0 to keep everything outside the "
        "oracle's motion region frozen to the smeared init during "
        "generation. Frozen background is held baseline content, so after "
        "exact recovery its timing is exactly the baseline's: background "
        "agents (birds, crowds) cannot speed up. The mask is static over "
        "time, so nothing pops at its boundary. Effects that fly far from "
        "the subject may be clipped by the freeze; lower the threshold or "
        "raise freeze_grow to give them room.\n\n"
        "Manual freeze: wire a MASK instead and YOU choose the boundary "
        "(overrides the oracle path). mask = the region to REGENERATE; "
        "invert_mask flips it so you can paint the background/birds to "
        "freeze directly. By default the mask is unioned over time (static "
        "boundary, never pops) and snapped to HARD latent cells by default "
        "(mask_feather 0): every ~16 px cell is fully frozen or fully "
        "live, no half-frozen blend cells, and the decode smooths the "
        "edge. Set mask_feather above 0 to get the old pixel-space ramp "
        "pooled to fractional cells if a hard seam ever shows. Prefer "
        "this over the composite node when background and subject share "
        "lighting, shadows or water contact.\n\n"
        "time_varying (manual mask only): keeps the mask's time axis "
        "instead of unioning it, so the freeze region can move or switch "
        "on partway. Transitions QUANTIZE to the latent token grid: each "
        "17 pixel frames are 5 tokens covering (1, 4, 4, 4, 4) frames, so "
        "a change lands on the token that covers it and a token "
        "regenerates if ANY frame it covers is marked regenerate. A moving "
        "boundary CAN pop at those steps - that is the tradeoff for the "
        "default's promise. Put intended transitions on 17-frame phase "
        "(frames 0, 17, 34, ...), where the singleton tokens hold exactly "
        "one frame each and the step is tightest. Masks whose frame count "
        "differs from the clip length are nearest-neighbour resampled "
        "first; a 2D or single-frame mask behaves as before.\n\n"
        "AUDIO ROWS (alpha): by default they start from zeros, so pass 2 "
        "invents its own performance at NATURAL rate and drags the mouth to "
        "match it. On a de-roped clip that is the whole dialogue defect - "
        "recovery then compresses those lips (and, at reference_mix 0, that "
        "speech) by the hold factor, so held regions come back rushed while "
        "the unheld tail sounds fine. Wire audio_latent with the baseline "
        "track stretched onto THIS dilated clock (H3 Audio Smear -> "
        "VAEEncodeAudio), pick an audio_mode, and pass 2 renders a genuinely "
        "slowed performance instead - which is what Exact Recover and Audio "
        "Recover were assuming all along.")

    # the audio half of the injection bargain, in words
    AUDIO_MODES = {
        "invent freely (original behaviour)": 1.0,
        "follow the original performance (0.5)": 0.5,
        "follow loosely, re-render more (0.7)": 0.7,
        "pin the original outright (0.0)": 0.0,
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT", {"tooltip": "video latent from VAEEncode of the smeared frames"}),
        }, "optional": {
            "length": ("INT", {"default": 0, "min": 0, "max": 3600,
                               "tooltip": "0 = derive from the latent (recommended); nonzero asserts this exact 17k+5 length"}),
            "oracle_samples": ("LATENT", {"tooltip": "baseline latent; enables background freezing"}),
            "freeze_threshold": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05,
                "tooltip": "0 = off. Above 0: freeze background latent to the smeared init so its "
                           "timing stays exactly the baseline's (fixes background agents speeding up). "
                           "The subject mask is the oracle heat unioned over time, so the boundary never moves. "
                           "0.35 is a sane start."}),
            "freeze_grow": ("INT", {"default": 2, "min": 0, "max": 16,
                "tooltip": "latent-pixels of mask dilation (16 image px each); applies to both mask sources"}),
            "mask": ("MASK", {"tooltip": "(alpha) manual region to REGENERATE (1) vs freeze to baseline timing (0). "
                     "Overrides the oracle path. Union over time by default: the boundary never "
                     "moves (set time_varying to keep the time axis)"}),
            "mask_feather": ("INT", {"default": 0, "min": 0, "max": 256,
                "tooltip": "0 (default): hard latent cells, every cell fully frozen or fully live; "
                           "the decode smooths the edge. >0: pixel-space ramp pooled to fractional "
                           "cells (~16 px quanta) if a hard seam ever shows"}),
            "invert_mask": ("BOOLEAN", {"default": False,
                "tooltip": "on: the mask marks the FREEZE region instead (paint the background/birds directly)"}),
            "time_varying": ("BOOLEAN", {"default": False,
                "tooltip": "off (default): the manual mask is unioned over time, static boundary. "
                           "on: a multi-frame mask keeps its time axis, quantized to the latent "
                           "token grid ((1,4,4,4,4) frames per 17). A moving boundary CAN pop; put "
                           "intended transitions on 17-frame phase. Manual mask only, ignored by "
                           "the oracle path and by 2D / single-frame masks"}),
            "audio_latent": ("LATENT", {"tooltip": "(alpha) VAEEncodeAudio of H3 Audio Smear's output: "
                     "the baseline track stretched onto THIS dilated clock. Leave unwired for the "
                     "original behaviour (audio starts from zeros and pass 2 invents its own "
                     "performance at natural rate, which is what makes held regions come back "
                     "rushed after recovery)"}),
            "audio_mode": (["custom (use audio_strength)"] + list(cls.AUDIO_MODES),
                {"default": "custom (use audio_strength)",
                 "tooltip": "plain-language presets for the audio rows; anything but 'custom' "
                            "overrides audio_strength. All but the first need audio_latent wired "
                            "(H3 Audio Smear -> VAEEncodeAudio). Start with 'follow the original "
                            "performance': it is what makes a de-roped clip keep its dialogue"}),
            "audio_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                "tooltip": "(alpha) how much of the audio rows pass 2 re-renders. 1.0 (default) = "
                           "unchanged behaviour. With audio_latent wired, 0.5-0.7 keeps the seeded "
                           "performance's bulk timing and re-renders detail, the same bargain "
                           "H3 Inject Schedule makes on the video side; 0.0 pins the track outright. "
                           "H3 runs ONE joint pass, so the sigma schedule cannot set this per "
                           "modality - it rides the audio half of the noise mask"}),
            "audio_prefix_ticks": ("INT", {"default": 0, "min": 0, "max": 36000,
                "tooltip": "(alpha) freeze the FIRST n audio-latent ticks to the seeded audio_latent "
                           "content (noise-mask 0 there; every later tick keeps audio_strength). The "
                           "audio twin of the video prefix freeze: a 39-frame carried handle is 65 "
                           "ticks exactly. Needs audio_latent wired. 0 = off (scalar behaviour "
                           "unchanged)"}),
            "audio_prefix_release_ticks": ("INT", {"default": 0, "min": 0, "max": 400,
                "tooltip": "(alpha) half-cosine release: the LAST n ticks of the frozen prefix ramp "
                           "0 -> audio_strength instead of cutting hard (8 ticks = 0.2 s, the field's "
                           "tested recipe). If used, assembly must let the continuation OWN the "
                           "overlap tail, or the trim discards the release. 0 = hard edge"}),
        }}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "build"
    CATEGORY = "latent/minimax/motion"

    def build(self, samples, length=0, oracle_samples=None, freeze_threshold=0.0,
              freeze_grow=2, mask=None, mask_feather=0, invert_mask=False,
              time_varying=False, audio_latent=None, audio_strength=1.0,
              audio_mode="custom (use audio_strength)", audio_prefix_ticks=0,
              audio_prefix_release_ticks=0):
        import torch.nn.functional as F

        import comfy.nested_tensor
        from comfy_extras.nodes_minimax_h3 import temporal_shape

        if audio_mode in self.AUDIO_MODES:        # words win over the raw dial
            audio_strength = self.AUDIO_MODES[audio_mode]
        if audio_latent is None and audio_strength != 1.0:
            print("[H3V2VInit] audio_strength/audio_mode asks pass 2 to follow an audio "
                  "init, but audio_latent is not wired: the rows are still ZEROS, so it "
                  "has nothing to follow. Wire H3 Audio Smear -> VAEEncodeAudio.")
        if audio_latent is not None and audio_strength == 1.0 and not audio_prefix_ticks:
            # the likelier half of the mistake: the wiring is done and the last
            # step is not, so the seed is written and then fully renoised away
            print("[H3V2VInit] audio_latent is wired but audio_strength is 1.0, which "
                  "re-renders the audio rows completely: the seeded performance is "
                  "discarded and this behaves exactly as if nothing were wired. Set "
                  "audio_mode to 'follow the original performance (0.5)'.")

        def _aud_noise_mask():
            m = torch.full((1, 32, 2, audio_t), float(audio_strength))
            if audio_prefix_ticks:
                p = min(int(audio_prefix_ticks), audio_t)
                m[..., :p] = 0.0
                r = min(int(audio_prefix_release_ticks), p)
                if r > 0:
                    ramp = (0.5 - 0.5*torch.cos(torch.linspace(0, torch.pi, r))) * float(audio_strength)
                    m[..., p-r:p] = ramp
            return m

        video = _video_component(samples)
        if not length:
            length = (video.shape[2] - 2) // 5 * 17 + 5  # invert t_lat
        _, t_lat, audio_t = temporal_shape(length)
        assert video.shape[2] == t_lat, (
            f"latent has {video.shape[2]} tokens, length {length} needs {t_lat}")
        audio = torch.zeros(video.shape[0], 32, 2, audio_t,
                            device=video.device, dtype=video.dtype)
        if audio_latent is not None:
            # seed the audio rows with the smeared baseline performance. The
            # encode is sized by the wav length, so it lands a token or two off
            # the grid the video half demands; crop/pad rather than refuse.
            a = audio_latent["samples"] if isinstance(audio_latent, dict) else audio_latent
            a = a.to(device=video.device, dtype=video.dtype)
            if a.dim() == 3:                       # [C, 2, T] -> [1, C, 2, T]
                a = a[None]
            if a.shape[-1] > audio_t:
                a = a[..., :audio_t]
            elif a.shape[-1] < audio_t:
                a = torch.nn.functional.pad(a, (0, audio_t - a.shape[-1]))
            if a.shape[0] != audio.shape[0]:
                a = a[:1].expand(audio.shape[0], -1, -1, -1)
            audio = a.contiguous()
        out = {"samples": comfy.nested_tensor.NestedTensor((video, audio))}

        if mask is not None:
            h, w = video.shape[3], video.shape[4]
            m = mask.detach().float().cpu()
            if m.dim() == 2:
                m = m[None]
            if invert_mask:
                m = 1.0 - m
            m = (m >= 0.5).float()
            if time_varying and m.shape[0] > 1:
                # per-token-time mask: fold the frame clock onto the token
                # clock (max = regenerate wins inside a mixed token)
                m = _tokenize_mask_time(m, t_lat, length)
            else:
                m = m.max(dim=0, keepdim=True).values       # union: static boundary
            m = _soft_edge(m, mask_feather)                 # pixel-space ramp first
            m = F.interpolate(m[None], size=(h, w), mode="area")[0]  # fractional cells
            if freeze_grow:
                k = freeze_grow * 2 + 1
                m = F.max_pool2d(m[None], k, stride=1, padding=k // 2)[0]
            if mask_feather <= 0:
                # hard cells: area pooling leaves boundary cells fractional
                # (half-frozen blends denoise off-manifold); snap to 0/1 and
                # let the decode's receptive-field overlap smooth the edge
                m = (m >= 0.5).float()
            m = m.clamp(0, 1)
            if m.shape[0] == 1:
                m = m.expand(t_lat, h, w)
            vid_mask = m[None, None].to(video.device)
            aud_mask = _aud_noise_mask()
            out["noise_mask"] = comfy.nested_tensor.NestedTensor(
                (vid_mask.contiguous(), aud_mask))
        elif oracle_samples is not None and freeze_threshold > 0:
            z = _video_component(oracle_samples)
            v = z.detach().float().cpu().numpy()
            jmap = np.abs(np.diff(v, n=3, axis=2)).mean(axis=(0, 1))  # (T-3, h, w)
            for ph in range(5):
                m = jmap[ph::5].mean()
                if m > 0:
                    jmap[ph::5] /= m
            heat = jmap.max(axis=0)                       # union over time: static boundary
            lo, hi = np.quantile(heat, 0.05), np.quantile(heat, 0.995)
            heat = np.clip((heat - lo) / (hi - lo + 1e-9), 0, 1)
            m = torch.from_numpy(heat >= freeze_threshold).float()[None, None]
            if freeze_grow:
                k = freeze_grow * 2 + 1
                m = F.max_pool2d(m, k, stride=1, padding=k // 2)
            h, w = video.shape[3], video.shape[4]
            if m.shape[-2:] != (h, w):
                m = F.interpolate(m, size=(h, w), mode="nearest")
            vid_mask = m[0, 0].expand(t_lat, h, w)[None, None].to(video.device)
            aud_mask = _aud_noise_mask()
            out["noise_mask"] = comfy.nested_tensor.NestedTensor(
                (vid_mask.contiguous(), aud_mask))
        if "noise_mask" not in out and (audio_strength != 1.0 or audio_prefix_ticks):
            # audio-only injection: no video mask was asked for, so the video
            # half denoises exactly as it did before this input existed
            out["noise_mask"] = comfy.nested_tensor.NestedTensor(
                (torch.ones(1, 1, t_lat, video.shape[3], video.shape[4]),
                 _aud_noise_mask()))
        return (out,)


# -------------------------------------------------- temporal token insertion
# Track 2 of the latent-resident roadmap (idea 23): do the retime IN LATENT
# SPACE. Instead of duplicating PIXEL frames and paying a VAE encode of the
# longer clip, expand the video latent along t onto the dilated token grid,
# fill the inserted token-times by interpolating the base tokens, and hand the
# sampler a repaint mask that FREEZES the originals so only the in-betweens
# are generated.
#
# The map below is PORTED, not re-derived, from the T2a fidelity probe
# (ComfyUI-ModelCatalog benchmarks/scripts/tinterp/analyze_tinterp.py:
# token_spans / smear_index / base_time_of_smear_tokens / lerp_tokens), whose
# worked token map is checked in as token_map.csv and is pinned row-for-row by
# tests/test_temporal_insert.py. What T2a measured, and what it decided here
# [MEAS 2026-08-15, one clip, hold 2 x 34 frames, fp16 VAE]:
#   - plain lerp of the base latent matches the encode of the pixel-smeared
#     clip at corr 0.888 / nRMSE 0.44 std (noise null 0.00 / 1.42) and DECODES
#     as motion-blur-like ghosting, not garbage. Nearest, phase-aware and
#     box-overlap variants bought nothing, so lerp is the only mode offered.
#   - token-times landing exactly on a base token centre come back EXACTLY
#     (corr 1.0); off-anchor singletons are the worst case (0.75). Those exact
#     hits are bit-copied here and frozen by the mask.
#   - inserted tokens want sigma >= ~0.5 of denoise (break-even against the
#     interpolation residual is 0.305; at inject 0.7 the residual is 19% of
#     the injected noise).
AUDIO_LATENT_FPS = 40   # H3's audio latent clock [SRC comfy_extras/nodes_minimax_h3.py:31]


def _audio_latent_t(frames):
    """Audio-latent length for a pixel length. Defers to comfy's own
    temporal_shape when comfy is importable so the two cannot drift; the
    fallback is that function's arithmetic, for unit tests."""
    try:
        from comfy_extras.nodes_minimax_h3 import temporal_shape
        return int(temporal_shape(frames)[2])
    except Exception:
        return int(round(frames / 24.0 * AUDIO_LATENT_FPS))


def _token_centers(t_lat):
    """Mean pixel-frame position of every latent token: the time each token
    actually sits at on the non-uniform (1,4,4,4,4) grid."""
    return [(a + b) / 2.0 for a, b in _token_frame_spans(t_lat)]


def _index_runs(idx):
    """Compact 'a-b,c' rendering of a sorted index list, for reports."""
    if not idx:
        return "none"
    out, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i == p + 1:
            p = i
            continue
        out.append(f"{s}-{p}" if p > s else f"{s}")
        s = p = i
    out.append(f"{s}-{p}" if p > s else f"{s}")
    return ",".join(out)


def temporal_insert_map(holds):
    """The dilated clip's per-token interpolation plan for a hold map.

    holds: per-world-frame integer hold counts, the same map H3TimeSmear
    consumes and emits (and the oracles produce). It is legal-snapped here by
    the SAME rule H3TimeSmear uses (_snap_holds: the 17k+5 tail pad folds into
    the last hold), so the pixel and latent routes always agree on length.

    Returns (holds_snapped, dilated_len, t_base, t_dil, plan) where plan has
    one entry per DILATED token: (target_base_time, lo_tok, hi_tok, w_hi,
    exact_tok). target_base_time is the mean base-frame index of the frames
    that token covers; the value is (1 - w_hi) * base[lo] + w_hi * base[hi].
    exact_tok is >= 0 when the target lands exactly on a base token's centre,
    which means COPY THAT TOKEN VERBATIM (T2a rule 1) rather than blend.
    """
    holds = _snap_holds(holds)
    n_base = len(holds)
    assert (n_base - 5) % LEGAL_STEP == 0 and n_base >= 5, (
        f"the base clip is {n_base} frames, which is not on the 17k+5 grid; "
        "fit the source with H3VideoFit before encoding it")
    dilated = sum(holds)
    idx = [i for i, h in enumerate(holds) for _ in range(h)]
    t_base = (n_base - 5) // LEGAL_STEP * 5 + 2
    t_dil = (dilated - 5) // LEGAL_STEP * 5 + 2
    cb = _token_centers(t_base)
    plan = []
    for a, b in _token_frame_spans(t_dil):
        frames = idx[a:b + 1]
        t = sum(frames) / float(len(frames))
        j = bisect.bisect_left(cb, t)
        if j < len(cb) and cb[j] == t:          # exact hit -> verbatim copy
            plan.append((t, j, j, 0.0, j))
        elif j <= 0:
            plan.append((t, 0, 0, 0.0, 0))
        elif j >= len(cb):
            plan.append((t, len(cb) - 1, len(cb) - 1, 0.0, len(cb) - 1))
        else:
            w = (t - cb[j - 1]) / (cb[j] - cb[j - 1])
            plan.append((t, j - 1, j, w, -1))
    return holds, dilated, t_base, t_dil, plan


def temporal_insert_fill(video, plan, t_dil):
    """Expand a video latent onto the dilated token grid, per a plan.

    The grid half of the insert, factored out of H3TemporalInsert so
    H3MidInsert (the mid-denoise variant) runs the SAME arithmetic instead of
    a second copy of it: exact hits are bit-copied, every other token-time is
    the plain lerp of its bracketing base tokens.

    Returns (out_v, copied, inserted, brackets) where copied/inserted are
    dilated token indices in plan order and brackets is [(n, lo, hi, w_hi)]
    for the inserted ones (what a variance top-up needs).
    """
    out_v = torch.empty(video.shape[0], video.shape[1], t_dil,
                        video.shape[3], video.shape[4],
                        device=video.device, dtype=video.dtype)
    copied, inserted, brackets = [], [], []
    for n, (_t, lo, hi, w, exact) in enumerate(plan):
        if exact >= 0:
            out_v[:, :, n] = video[:, :, exact]            # verbatim, maxabs 0
            copied.append(n)
            continue
        inserted.append(n)
        brackets.append((n, lo, hi, w))
        out_v[:, :, n] = ((1.0 - w) * video[:, :, lo].float()
                          + w * video[:, :, hi].float()).to(video.dtype)
    return out_v, copied, inserted, brackets


class H3TemporalInsert:
    """Temporal super-resolution as temporal INPAINTING: expand a video
    latent onto the dilated token grid, interpolate the inserted
    token-times, freeze the originals with a repaint mask."""

    DESCRIPTION = (
        "EXPERIMENTAL, off-distribution. The time-smear de-rope done in "
        "LATENT space: instead of duplicating pixel frames and re-encoding a "
        "longer clip, this expands the video latent along t onto the dilated "
        "token grid, fills the INSERTED token-times by interpolating the "
        "neighbouring base tokens, and emits a repaint mask that freezes "
        "every original token (0) and regenerates only the in-betweens (1). "
        "So the pass pays for the dilated token count once, and the frames "
        "you already have are not re-rendered.\n\n"
        "Wire the SAME hold map the oracles and H3 Time Smear speak "
        "(holds express where and how much to insert). Length is snapped up "
        "to the 17k+5 grid exactly as H3 Time Smear snaps it (the tail pad "
        "folds into the last hold), and hold_map is passed through already "
        "snapped for H3 True Clock and the recover nodes - wire THAT output, "
        "not the original map.\n\n"
        "expand_to_end (default ON): a map that ends in a rate-1 tail behind "
        "an expansion span jumps back to real time at the clip end. With the "
        "toggle on, that span is run through the last world frame and the "
        "length is put back on the 17k+5 grid inside the same span (rates "
        "rise toward the end when legality asks for it). Uniform maps, maps "
        "already ending inside an expansion, and rate-1-only maps are "
        "untouched, and so is any rate-1 tail longer than 17 world frames "
        "(that is rest, not an end jump); a rewrite is logged to the "
        "console and named in the report.\n\n"
        "init_mode: 'lerp' (default) linearly blends the bracketing base "
        "tokens - measured corr 0.888 against the encode of the pixel-"
        "smeared clip, and token-times that land on a base token centre are "
        "bit-copied. 'noise' fills the inserted tokens with unit noise "
        "instead (pure inpainting, no init). Denoise the result from sigma "
        ">= ~0.5; below that the interpolation residual survives.\n\n"
        "PREFER HOLD SPANS THAT START ON A 17-MULTIPLE (frames 0, 17, 34 "
        "...): inserted singleton tokens that land on those anchors are "
        "recovered exactly, off-anchor ones are the worst case.\n\n"
        "AUDIO IS NOT RETIMED. v1 deliberately leaves H3's audio clock "
        "alone: any audio component is passed through bit-exact, so the "
        "expanded video NO LONGER MATCHES ITS AUDIO DURATION (a plain video "
        "latent gets a zero audio track sized for the DILATED length "
        "instead). Take audio from elsewhere - the source clip, or H3 Audio "
        "Recover at reference_mix 1.0.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT", {"tooltip": "video latent from VAEEncode of the ORIGINAL (un-smeared) clip, or a nested AV latent"}),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "the oracles' / H3 Time Smear's hold map: per-world-frame integer holds. hold h means h token-times where there was 1"}),
            "init_mode": (["lerp", "noise"], {"default": "lerp",
                          "tooltip": "lerp: blend the bracketing base tokens (T2a: corr 0.888, fancier variants buy nothing). noise: unit noise, pure inpainting"}),
        }, "optional": {
            "expand_to_end": ("BOOLEAN", {"default": True,
                              "tooltip": "when the map ends in a SHORT rate-1 tail (<= 17 frames) after an expansion span, run that span through the last frame instead (kills the end jump). Uniform maps and longer rest tails are untouched"}),
            "length": ("INT", {"default": 0, "min": 0, "max": 3600,
                       "tooltip": "0 = derive the base length from the latent (recommended); nonzero asserts this exact base length"}),
            "noise_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                           "tooltip": "only used by init_mode 'noise'; fixed so the init is reproducible"}),
        }}

    RETURN_TYPES = ("LATENT", "LATENT", "STRING", "STRING")
    RETURN_NAMES = ("samples", "noise_mask", "hold_map", "report")
    FUNCTION = "insert"
    CATEGORY = "latent/minimax/motion"

    def insert(self, samples, hold_map, init_mode="lerp", expand_to_end=True,
               length=0, noise_seed=0):
        import comfy.nested_tensor

        parsed = json.loads(hold_map)
        holds_in = list(parsed["holds"])
        z = samples["samples"]
        nested = bool(getattr(z, "is_nested", False) and hasattr(z, "unbind"))
        parts = list(z.unbind()) if nested else [z]
        video = parts[0]                                  # (B, 24, t_lat, h, w)
        audio_in = parts[1] if len(parts) > 1 else None
        if "world_len" in parsed:
            assert int(parsed["world_len"]) == len(holds_in), (
                f"hold map says world_len {parsed['world_len']} but carries "
                f"{len(holds_in)} holds")
        if length:
            assert length == len(holds_in), (
                f"length {length} but the hold map covers {len(holds_in)} frames")

        note = None
        if expand_to_end:
            holds_in, note = expand_hold_map_to_end(holds_in)
            if note:
                print("[MAINodes] H3TemporalInsert " + note)

        holds, dilated, t_base, t_dil, plan = temporal_insert_map(holds_in)
        assert video.shape[2] == t_base, (
            f"the latent has {video.shape[2]} tokens; a {len(holds)}-frame "
            f"base clip needs {t_base} (is this the SMEARED latent? this node "
            "takes the ORIGINAL clip's latent)")

        out_v, copied, inserted, _brackets = temporal_insert_fill(
            video, plan, t_dil)
        mask_v = torch.zeros(1, 1, t_dil, video.shape[3], video.shape[4],
                             device=video.device, dtype=video.dtype)
        gen = torch.Generator(device="cpu").manual_seed(int(noise_seed))
        for n in inserted:
            mask_v[:, :, n] = 1.0
            if init_mode == "noise":                       # overwrite the lerp
                out_v[:, :, n] = torch.randn(
                    video.shape[0], video.shape[1], video.shape[3],
                    video.shape[4], generator=gen).to(video.device, video.dtype)

        if audio_in is None:
            audio = torch.zeros(video.shape[0], 32, 2, _audio_latent_t(dilated),
                                device=video.device, dtype=video.dtype)
            audio_note = (f"no audio component in: a ZERO audio latent sized "
                          f"for the dilated length was built ({tuple(audio.shape)})")
        else:
            audio = audio_in                               # by reference, bit-exact
            audio_note = (f"audio passed through untouched, {tuple(audio.shape)} "
                          f"{audio.dtype} - it still runs on the BASE clip's "
                          f"clock")
        mask_a = torch.ones(1, audio.shape[1], audio.shape[2], audio.shape[3])

        out = dict(samples)
        out["samples"] = comfy.nested_tensor.NestedTensor((out_v, audio))
        nm = comfy.nested_tensor.NestedTensor((mask_v.contiguous(), mask_a))
        out["noise_mask"] = nm

        starts = [f for f, h in enumerate(holds)
                  if h > 1 and (f == 0 or holds[f - 1] <= 1)]
        off = [f for f in starts if f % LEGAL_STEP]
        rep = [
            f"temporal insert ({init_mode}): world {len(holds)}f -> dilated "
            f"{dilated}f, t_lat {t_base} -> {t_dil} tokens "
            f"(+{t_dil - t_base}); video {video.shape[3]}x{video.shape[4]} cells",
            f"copied verbatim (mask 0, frozen): {len(copied)} token-times "
            f"[{_index_runs(copied)}]",
            f"inserted (mask 1, regenerate): {len(inserted)} token-times "
            f"[{_index_runs(inserted)}]",
            (f"T2a rule 1 - hold spans start at frames [{_index_runs(starts)}]; "
             + ("all on 17-multiples, so inserted singletons land on base "
                "anchors and recover exactly"
                if not off else
                f"OFF the 17-multiple phase: {off} - those spans' inserted "
                "singletons are the worst case (T2a corr 0.75). Move them to "
                "frames 0/17/34/... if the in-betweens look wrong")),
            f"AUDIO CAVEAT: {audio_note}. The video is now {dilated / 24.0:.2f}s "
            f"of frames against {len(holds) / 24.0:.2f}s of world time, so any "
            "audio it carries is NOT in sync - take audio from the source clip "
            "or H3 Audio Recover at reference_mix 1.0",
            "denoise the inserted tokens from sigma >= ~0.5 (T2a break-even "
            "0.305); the mask reaches the sampler through the samples output "
            "itself - the noise_mask output is the same mask, for inspection",
        ]
        if note:
            rep.insert(1, note)
        used = json.dumps({"holds": holds, "world_len": len(holds)})
        return (out, {"samples": nm}, used, "\n".join(rep))


# ------------------------------------------------- mid-denoise topology change
# PoC (2026-08-24): today the coarse -> dense grid change happens BETWEEN
# passes - pass 1 takes the coarse grid all the way to sigma 0, H3TemporalInsert
# expands it, pass 2 re-noises and denoises again. The idea here is to change
# topology WHILE the denoise is running: stop the coarse pass at a handoff
# sigma_s, insert the new token-times into the STILL-NOISY latent, and let the
# dense grid carry on from sigma_s to 0, so the model finishes deciding the
# motion with the in-betweens already present.
#
# THE ONE PIECE OF MATHS THIS NODE OWNS: an inserted token is
# init = (1 - w) * x_lo + w * x_hi, and at a mid-schedule sigma its two
# neighbours are NOISY, so the lerp is variance-DEFICIENT - it averages two
# imperfectly-correlated noise realisations and lands smoother than a real
# token at that position. Per element, with neighbour variances v_lo / v_hi
# and noise correlation rho,
#
#     Var(init) = (1-w)^2 v_lo + w^2 v_hi + 2 w (1-w) rho sqrt(v_lo v_hi)
#
# while a genuine token there would carry, interpolating its neighbours'
# dispersion the same way its content is interpolated,
#
#     v_tgt = (1-w) v_lo + w v_hi
#
# Subtract, and rho and the square root collapse into one thing that is
# actually ON THE TENSOR - the neighbour RESIDUAL:
#
#     deficit = v_tgt - Var(init)
#             = w (1-w) [v_lo + v_hi - 2 rho sqrt(v_lo v_hi)]
#             = w (1-w) * Var(x_hi - x_lo)                              (*)
#
# (*) is why nothing here has to ASSUME a correlation: the deficit is measured
# directly, per inserted token and per channel, from the residual between the
# two bracketing tokens. rho is then RECOVERED for the report,
#     rho = (v_lo + v_hi - Var(x_hi - x_lo)) / (2 sqrt(v_lo v_hi)),
# and never used to size anything. Sanity check on (*): put v_lo = v_hi = v
# and w = 0.5 and it gives Var(init) = v (1 + rho) / 2, deficit = v (1 - rho)/2
# - the (1+rho)/2 law, as the symmetric special case.
#
# noise_topup scales the fresh gaussian's VARIANCE (std = sqrt(topup*deficit)),
# so 0 is the raw lerp and 1 restores the neighbours' spread exactly.
#
# HONEST CAVEAT, and it is not small: Var(x_hi - x_lo) also contains the real
# SIGNAL change between the two neighbours. On fast content the lerp is
# legitimately smoother than a real token because the content moved, and a full
# top-up then pays for real motion with white noise. Give sigma_s and the
# report prints the noise-only bound the flow parameterisation predicts -
# a handed-off latent is x/(1-sigma) with x = (1-sigma)x0 + sigma*eps, so an
# independent unit-white residual alone would explain
#     deficit_noise = 2 w (1-w) (sigma/(1-sigma))^2
# (H3's video scale_factor is 1.0, so process_latent_out does not rescale this
# [SRC comfy/latent_formats.py MiniMaxH3Video]). Measured deficit far above
# that bound means the excess is content, not noise.
class H3MidInsert:
    """Insert token-times into a latent that is still mid-denoise, so the
    dense grid finishes the schedule instead of starting a new one."""

    DESCRIPTION = (
        "EXPERIMENTAL PoC, off-distribution. The temporal insert done in the "
        "MIDDLE of a denoise instead of between two passes. Run the coarse "
        "grid down to a handoff sigma_s only (SplitSigmas' high half), hand "
        "the STILL-NOISY latent to this node, and sample the dilated grid "
        "from sigma_s to 0 (the low half) - the model then decides the "
        "motion with the in-betweens already in the sequence, and the coarse "
        "pass is partial.\n\n"
        "The grid arithmetic is H3 Temporal Insert's, shared code, so the two "
        "routes can never disagree about which token-times exist. What is "
        "different is the INIT: lerping two NOISY neighbours is variance-"
        "deficient, and noise_topup adds fresh gaussian noise sized from the "
        "MEASURED neighbour residual (per token, per channel) so the inserted "
        "tokens carry the same spread their neighbours do. 0 = raw lerp, "
        "1 = full top-up. The measured correlation and the deficit are "
        "printed in the report; wire sigma_s to also print the noise-only "
        "bound the flow parameterisation predicts, which is how you see how "
        "much of the deficit was real motion rather than noise.\n\n"
        "NO NOISE MASK, deliberately. A repaint mask re-noises its frozen "
        "content from a CLEAN latent every step (comfy/samplers.py "
        "KSamplerX0Inpaint), and this latent is not clean - it is already at "
        "sigma_s. Everything continues denoising together, which is the whole "
        "point. Any noise_mask on the incoming latent is dropped.\n\n"
        "WIRING: pass A SamplerCustomAdvanced ends on sigma_s and its "
        "'output' is the noisy latent (already divided by 1-sigma_s by "
        "inverse_noise_scaling); pass B MUST take DisableNoise, whose zero "
        "noise makes noise_scaling multiply by 1-sigma_s again and hand the "
        "sampler back exactly the state pass A left. RandomNoise on pass B "
        "would add a second full noise draw on top and destroy the handoff.\n\n"
        "AUDIO IS PASSED THROUGH UNCHANGED - it stays on the BASE clip's "
        "clock while the video moves onto the dilated one, so pass B sees an "
        "audio stream that covers only part of the video's span. Take the "
        "delivered audio from elsewhere. A plain video latent stays plain: "
        "unlike H3 Temporal Insert this node will NOT fabricate a zero audio "
        "track, because a clean zero mid-schedule is not a valid state.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT", {"tooltip": "the nested AV latent MID-SCHEDULE: SamplerCustomAdvanced's 'output' from a pass whose sigmas ended at sigma_s"}),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "the same map H3 Time Smear / the oracles speak; hold h means h token-times where there was 1"}),
            "noise_topup": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                            "tooltip": "fraction of the MEASURED variance deficit to restore with fresh gaussian noise. 0 = raw lerp, 1 = the inserted tokens carry their neighbours' spread"}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                     "tooltip": "the top-up noise draw; fixed so the init is reproducible"}),
        }, "optional": {
            "expand_to_end": ("BOOLEAN", {"default": False,
                              "tooltip": "H3 Temporal Insert's end-jump rewrite. OFF by default here: a mid-denoise arm wants the same grid its between-passes control used"}),
            "length": ("INT", {"default": 0, "min": 0, "max": 3600,
                       "tooltip": "0 = derive the base length from the latent; nonzero asserts this exact base length"}),
            "sigma_s": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.001,
                        "tooltip": "REPORT ONLY, changes nothing: the handoff sigma pass A ended on. Given it, the report prints the noise-only variance deficit the flow parameterisation predicts, to compare against the measured one"}),
            "init_mode": (["lerp", "duplicate"], {"default": "lerp",
                          "tooltip": "lerp = blend the bracketing base tokens (the default, what every earlier arm ran). duplicate = each inserted token-time is a VERBATIM copy of the nearer base token, state and noise realisation both, so the remesh adds no new content at all; noise_topup is ignored in that mode"}),
        }}

    RETURN_TYPES = ("LATENT", "STRING", "STRING")
    RETURN_NAMES = ("samples", "hold_map", "report")
    FUNCTION = "insert"
    CATEGORY = "latent/minimax/motion"

    def insert(self, samples, hold_map, noise_topup=1.0, seed=0,
               expand_to_end=False, length=0, sigma_s=0.0, init_mode="lerp"):
        import comfy.nested_tensor

        parsed = json.loads(hold_map)
        holds_in = list(parsed["holds"])
        z = samples["samples"]
        nested = bool(getattr(z, "is_nested", False) and hasattr(z, "unbind"))
        parts = list(z.unbind()) if nested else [z]
        video = parts[0]                                  # (B, 24, t_lat, h, w)
        audio_in = parts[1] if len(parts) > 1 else None
        if "world_len" in parsed:
            assert int(parsed["world_len"]) == len(holds_in), (
                f"hold map says world_len {parsed['world_len']} but carries "
                f"{len(holds_in)} holds")
        if length:
            assert length == len(holds_in), (
                f"length {length} but the hold map covers {len(holds_in)} frames")

        note = None
        if expand_to_end:
            holds_in, note = expand_hold_map_to_end(holds_in)
            if note:
                print("[MAINodes] H3MidInsert " + note)

        holds, dilated, t_base, t_dil, plan = temporal_insert_map(holds_in)
        assert video.shape[2] == t_base, (
            f"the latent has {video.shape[2]} tokens; a {len(holds)}-frame "
            f"base clip needs {t_base} (this node takes the COARSE grid, "
            "mid-schedule - is it already dilated?)")

        # the grid: H3TemporalInsert's own arithmetic, shared code
        out_v, copied, inserted, brackets = temporal_insert_fill(
            video, plan, t_dil)

        # duplicate init: the "stupid remesh". Every inserted token-time
        # becomes a verbatim copy of the NEARER bracketing base token (state
        # and noise realisation both), so the grid gains token count and
        # nothing else. Nothing is blended and nothing is added, so the
        # variance top-up does not apply and is ignored.
        dup = (init_mode == "duplicate")
        dup_src = {}
        if dup:
            for n, lo, hi, w in brackets:
                src = hi if w >= 0.5 else lo
                dup_src[n] = src
                out_v[:, :, n] = video[:, :, src]

        # the top-up: measured per inserted token, per channel. See the block
        # comment above this class for the derivation of deficit = w(1-w)Var(r).
        vf = video.float()
        dims = (-2, -1)                       # stats over the spatial cells
        gen = torch.Generator(device="cpu").manual_seed(int(seed))
        rho_all, def_all, tgt_all, std_all, ident = [], [], [], [], 0.0
        for n, lo, hi, w in brackets:
            a, b = vf[:, :, lo], vf[:, :, hi]              # (B, C, h, w)
            v_lo = a.var(dim=dims, unbiased=False)
            v_hi = b.var(dim=dims, unbiased=False)
            v_res = (b - a).var(dim=dims, unbiased=False)  # THE measurement
            v_tgt = (1.0 - w) * v_lo + w * v_hi
            deficit = (w * (1.0 - w)) * v_res
            rho = ((v_lo + v_hi - v_res)
                   / (2.0 * (v_lo * v_hi).clamp_min(1e-20).sqrt()))
            # identity self-check: the lerp we actually built must have the
            # variance (*) predicts, v_tgt - deficit
            if not dup:
                v_lerp = out_v[:, :, n].float().var(dim=dims, unbiased=False)
                ident = max(ident,
                            float((v_lerp - (v_tgt - deficit)).abs().max()
                                  / max(float(v_tgt.abs().max()), 1e-20)))
            std = (float(0.0 if dup else noise_topup)
                   * deficit).clamp_min(0.0).sqrt()
            if noise_topup > 0.0 and not dup:
                g = torch.randn(tuple(a.shape), generator=gen).to(
                    video.device, torch.float32)
                out_v[:, :, n] = (out_v[:, :, n].float()
                                  + std[..., None, None] * g).to(video.dtype)
            rho_all.append(rho)
            def_all.append(deficit)
            tgt_all.append(v_tgt)
            std_all.append(std)

        out = dict(samples)
        # a repaint mask would re-noise its frozen rows FROM A CLEAN LATENT
        # every step; this latent is at sigma_s, so any inbound mask is a bug
        dropped = out.pop("noise_mask", None)
        if audio_in is None:
            out["samples"] = out_v
            audio_note = ("no audio component: the latent stays VIDEO-ONLY "
                          "(a fabricated zero audio track would be a CLEAN "
                          "row in a mid-schedule pack)")
        else:
            out["samples"] = comfy.nested_tensor.NestedTensor((out_v, audio_in))
            audio_note = (f"audio passed through untouched, "
                          f"{tuple(audio_in.shape)} {audio_in.dtype} - still "
                          f"the BASE clip's clock, "
                          f"{audio_in.shape[-1]} ticks against "
                          f"{_audio_latent_t(dilated)} the dilated video wants")

        exact_hits = [p[4] for p in plan if p[4] >= 0]
        dupes = len(exact_hits) - len(set(exact_hits))
        starts = [f for f, h in enumerate(holds)
                  if h > 1 and (f == 0 or holds[f - 1] <= 1)]
        off = [f for f in starts if f % LEGAL_STEP]

        def _stat(xs):
            if not xs:
                return (0.0, 0.0, 0.0)
            t = torch.stack([x.reshape(-1) for x in xs])
            return (float(t.mean()), float(t.min()), float(t.max()))

        rho_m, rho_lo, rho_hi = _stat(rho_all)
        def_m, def_lo, def_hi = _stat(def_all)
        tgt_m, _tl, _th = _stat(tgt_all)
        std_m, _sl, std_hi = _stat(std_all)
        rep = [
            f"mid-denoise insert: world {len(holds)}f -> dilated {dilated}f, "
            f"t_lat {t_base} -> {t_dil} tokens (+{t_dil - t_base}); video "
            f"{video.shape[3]}x{video.shape[4]} cells",
            f"copied verbatim, STILL NOISY and still denoising (no freeze "
            f"mask): {len(copied)} token-times [{_index_runs(copied)}]",
            f"inserted (lerp of noisy neighbours): {len(inserted)} token-times "
            f"[{_index_runs(inserted)}]",
            f"measured neighbour correlation rho (per token, per channel, "
            f"recovered from Var(x_hi - x_lo)): mean {rho_m:.4f}, "
            f"range [{rho_lo:.4f}, {rho_hi:.4f}]",
            f"measured variance deficit w(1-w)Var(x_hi - x_lo): mean "
            f"{def_m:.5f} = {100.0 * def_m / max(tgt_m, 1e-20):.1f}% of the "
            f"target token variance {tgt_m:.5f}; range "
            f"[{def_lo:.5f}, {def_hi:.5f}]",
            (f"init_mode duplicate: {len(inserted)} inserted token-times are "
             f"verbatim copies of base tokens "
             f"{sorted(set(dup_src.values()))}; noise_topup ignored"
             if dup else "init_mode lerp (the default blend)"),
            f"top-up applied: noise_topup {noise_topup:.2f} -> fresh gaussian "
            f"std mean {std_m:.5f}, max {std_hi:.5f}, seed {int(seed)}"
            + ("" if noise_topup > 0.0 else "  (RAW LERP: nothing added)"),
            ("identity self-check: n/a, duplicate init builds no lerp"
             if dup else
             f"identity self-check |Var(lerp) - (v_tgt - deficit)| / v_tgt: "
             f"{ident:.3e} (must be ~0; it is the derivation, verified on "
             f"this tensor)"),
        ]
        if sigma_s >= 1.0:
            # report only, and the bound divides by (1 - sigma_s): at sigma_s 1
            # the whole latent IS the noise and the ratio is undefined
            rep.append(
                f"noise-only bound at sigma_s {sigma_s:.4f}: n/a (the bound "
                f"scales as (sigma_s/(1-sigma_s))^2, which is undefined at "
                f"sigma_s 1.0 - pure noise; measured deficit {def_m:.5f})")
        elif sigma_s > 0.0:
            wsum = sum(w * (1.0 - w) for _n, _lo, _hi, w in brackets)
            wbar = wsum / max(len(brackets), 1)
            bound = 2.0 * wbar * (sigma_s / (1.0 - sigma_s)) ** 2
            ratio = def_m / max(bound, 1e-20)
            rep.append(
                f"noise-only bound at sigma_s {sigma_s:.4f}: an independent "
                f"unit-white residual alone explains a deficit of "
                f"{bound:.5f} (mean w(1-w) {wbar:.4f}); measured {def_m:.5f} "
                f"= {ratio:.2f}x that - "
                + ("above 1x, so the excess is CONTENT change between "
                   "neighbours and a full top-up pays for real motion with "
                   "white noise" if ratio > 1.0 else
                   "at or below 1x, so the residual is noise-like and the "
                   "neighbours' noise is CORRELATED (a denoised trajectory "
                   "keeps its draw); the top-up is honest here"))
        rep += [
            (f"T2a rule 1 - hold spans start at frames [{_index_runs(starts)}]; "
             + ("all on 17-multiples"
                if not off else
                f"OFF the 17-multiple phase: {off} - worst case for the "
                "inserted singletons")),
            f"AUDIO: {audio_note}",
            "NO NOISE MASK is emitted: the copied tokens are mid-schedule, "
            "and repaint would re-noise them from a clean latent. "
            + ("an inbound noise_mask was DROPPED"
               if dropped is not None else "none was on the input"),
            "PASS B MUST USE DisableNoise: pass A's output is already "
            "x/(1-sigma_s) (inverse_noise_scaling), and zero noise makes "
            "noise_scaling multiply by (1-sigma_s) again - an exact handoff",
        ]
        if dupes:
            rep.insert(3, f"WARNING: {dupes} exact-hit token(s) are DUPLICATES "
                          "of another dilated token (edge clamping), so the "
                          "same noise realisation appears twice in the grid")
        if note:
            rep.insert(1, note)
        used = json.dumps({"holds": holds, "world_len": len(holds)})
        return (out, used, "\n".join(rep))


# -------------------------------------------------- aligned latent guides
# Hand the model the movie as CLEAN CONDITION ROWS on the target's own rotary
# coordinates, instead of smearing it into x_t. Measured on the trainer's
# ruler (the aligned-guide A/B/C study, 2026-08-28): the same
# lerp movie read as aligned guide rows scores 0.406-0.433 of the lerp
# baseline with NO adapter at all, against 0.464 for a LoRA trained on the
# in-x_t arrangement — and 0.238-0.254 for one trained on the guide.
#
# Core already packs keyframe latents exactly that way
# (comfy/ldm/minimax/model.py:322-360): each keyframe latent becomes its own
# ("cond", vt * frame_rows) segment right after the text, on the TARGET's
# spatial grid, with t origin cursor + FRAME_RESCALE * resolved_frame_index
# and img_update False. What core does NOT do is follow a rewritten clock —
# the cond t column is built from the stock spans and the stock origin. Under
# H3 True Clock a FULL-grid guide inherits the rewritten spans by accident
# (the exact-length guard matches, motion.py _install_true_clock_patch) while
# a PARTIAL one does not; under H3 DyRoPE nothing does, because the rope
# wrapper rewrites out[start:, 0] — the target segment — only. The trainer
# measured what that costs: on a dense sample the rewrite moves the target
# 156.7 (57 tokens) / 447.5 (107 tokens) rotary units, so an unretimed guide
# sits that far from the rows it duplicates and the model reads it as a
# different take. So: identify the cond rows from the layout's own segment
# KINDS and give every one of them the RETIMED t of the target row it
# duplicates — or raise. Never a silent stock-grid fallback.

_GUIDE_LAYOUTS = {}   # seq_len -> record, filled by the PackedLayout wrapper


def guide_frame_index(token_idx):
    """resolved_frame_index for a guide whose first token is target token
    token_idx. Core anchors keyframes in PIXEL frames and a token covers
    FRAME_PER_TOKEN = (1, 4, 4, 4, 4) of them per 5."""
    import comfy.ldm.minimax.model as _mm
    fpt = _mm.FRAME_PER_TOKEN
    return sum(fpt[k % len(fpt)] for k in range(int(token_idx)))


def guide_token_index(resolved_frame_index):
    """Inverse of guide_frame_index; None when that pixel frame is not a token
    boundary (core's image AddGuide may anchor anywhere, and a guide that
    starts mid-token duplicates no single target row)."""
    import comfy.ldm.minimax.model as _mm
    fpt = _mm.FRAME_PER_TOKEN
    target = int(resolved_frame_index)
    if target < 0:
        return None
    f, k = 0, 0
    while f < target:
        f += fpt[k % len(fpt)]
        k += 1
    return k if f == target else None


def _guide_clock_name():
    """Which clock is armed right now — the name that goes in the raise."""
    if _DYROPE.get("active"):
        return "H3 DyRoPE"
    if _TRUE_CLOCK.get("spans") is not None:
        return "H3 True Clock"
    return "stock"


def guide_layout_record(layout, latent_t, keyframes):
    """Cond-video-row map of a packed layout, or None when it has none.

    Rows are identified by the layout's own segment KINDS, never by value
    coincidence: audio rows live on the same t axis as video rows and their
    values collide freely (comfy/ldm/minimax/model.py:_audio_grid)."""
    conds = [(a, b) for a, b, kind in layout.segments if kind == "cond"]
    if not conds:
        return None
    video = [(a, b) for a, b, kind in layout.segments if kind == "video"]
    latent_t = int(latent_t)
    if not video or latent_t <= 0:
        return None
    v_start, v_stop = video[-1]
    rows_per_frame, rem = divmod(v_stop - v_start, latent_t)
    if rem or rows_per_frame <= 0:
        return None
    kfs = [kf for kf in (keyframes or ()) if kf.get("latent") is not None]
    blocks = []
    for i, (a, b) in enumerate(conds):
        vt, vrem = divmod(b - a, rows_per_frame)
        token_idx, reason = None, ""
        if vrem:
            reason = ("%d rows is not a whole number of %d-row frames"
                      % (b - a, rows_per_frame))
        elif i >= len(kfs):
            reason = ("no keyframe latent carries this segment (%d cond "
                      "segments, %d keyframes with a latent)"
                      % (len(conds), len(kfs)))
        else:
            rfi = int(kfs[i]["resolved_frame_index"])
            token_idx = guide_token_index(rfi)
            if token_idx is None:
                reason = ("resolved_frame_index %d is not a token boundary "
                          "(tokens start at pixel frames 0, 1, 5, 9, 13, 17...)"
                          % rfi)
            elif token_idx + vt > latent_t:
                reason = ("token %d + %d guide tokens overruns the target's %d"
                          % (token_idx, vt, latent_t))
                token_idx = None
        blocks.append({"start": int(a), "stop": int(b), "vt": int(vt),
                       "token_idx": token_idx, "reason": reason})
    return {"seq_len": int(layout.seq_len), "video_start": int(v_start),
            "rows_per_frame": int(rows_per_frame), "latent_t": latent_t,
            "blocks": blocks}


def guide_retimed_position_ids(position_ids, record, clock):
    """Copy of position_ids whose cond VIDEO rows carry the t of the target
    rows they duplicate. Every other row is bit-identical.

    Under the stock clock this is the value core already computed (cond_t +
    cumsum of the stock spans IS the target's grid from that token on), so the
    copy is a no-op receipt; under a rewritten clock it is the whole point. A
    block that cannot be mapped RAISES under a rewritten clock. Under the
    stock clock it is left exactly as core built it — that is the correct
    answer there, not a fallback, and it is the only way core's own image
    AddGuide keeps working off a token boundary."""
    out = None
    v_start = record["video_start"]
    rpf = record["rows_per_frame"]
    for blk in record["blocks"]:
        tok = blk["token_idx"]
        if tok is None:
            if clock == "stock":
                continue
            raise RuntimeError(
                "H3 Add Latent Guide: condition rows %d..%d cannot be mapped "
                "onto target video tokens, so the %s clock cannot retime them "
                "(%s). Refusing to leave a guide on the stock grid — it would "
                "sit off the rows it duplicates (the rewrite moves a dense "
                "target by hundreds of rotary units) and the model would read "
                "it as a different take."
                % (blk["start"], blk["stop"], clock, blk["reason"]))
        if blk["vt"] <= 0:
            continue
        if out is None:
            out = position_ids.clone()
        idx = v_start + (tok + torch.arange(blk["vt"], device=position_ids.device)) * rpf
        out[blk["start"]:blk["stop"], 0] = position_ids[idx, 0].repeat_interleave(rpf)
    return position_ids if out is None else out


def _install_guide_layout_patch():
    """Chain the cond-row retime onto PackedLayout.__init__, once.

    Same sanctioned chaining shape as _install_true_clock_patch and
    _install_dyrope_rope_patch: wrap whatever is currently bound, and do
    nothing at all when the layout carries no cond video rows — so a graph
    without a guide is bit-identical to one built with this pack unloaded.
    The layout is built in extra_conds BEFORE sampler.sample runs, which is
    why the retime happens here and not in the sampler wrapper."""
    import comfy.ldm.minimax.model as _mm
    if getattr(_mm.PackedLayout.__init__, "_h3_guide_rows", False):
        return
    prev = _mm.PackedLayout.__init__

    def patched(self, text_len, latent_t, latent_h, latent_w, audio_t,
                keyframes=None, refs=None):
        prev(self, text_len, latent_t, latent_h, latent_w, audio_t,
             keyframes=keyframes, refs=refs)
        record = guide_layout_record(self, latent_t, keyframes)
        if record is None:
            return
        _GUIDE_LAYOUTS[int(self.seq_len)] = record
        self.position_ids = guide_retimed_position_ids(
            self.position_ids, record, _guide_clock_name())

    patched._h3_guide_rows = True
    _mm.PackedLayout.__init__ = patched


class H3AddLatentGuide:
    """Pack a LATENT as H3's keyframe guide: the movie as clean condition rows
    on the target's own rotary coordinates. No VAE, no mp4, no images."""

    DESCRIPTION = (
        "EXPERIMENTAL. Hands the model a whole video LATENT as an ALIGNED "
        "GUIDE — H3's keyframe condition rows, which pack right after the "
        "text on the target's own spatial grid and time axis, arrive nearly "
        "clean (noise_aug 0.999) and are never denoised. Core's Add Guide "
        "node takes IMAGES and VAE-encodes them; this one takes the latent "
        "you already have, so a latent-space init (H3 Temporal Insert's lerp, "
        "a bank, a previous pass) never makes a round trip through pixels.\n\n"
        "Why bother: measured on the trainer's ruler (the aligned-guide "
        "A/B/C study, 2026-08-28), the same lerp movie read as aligned guide "
        "rows scores 0.41-0.43 of the lerp baseline with NO adapter at all, "
        "where a LoRA trained on the in-x_t arrangement gets 0.46: the base "
        "model can read a correctly-positioned guide and does not need to be "
        "taught to. Keeping the lerp in x_t as well buys nothing (it measures "
        "as the in-x_t arm again), so the intended pairing is H3 Temporal "
        "Insert with init_mode=noise into the sampler and a SECOND one with "
        "init_mode=lerp into this node, on a FULL schedule.\n\n"
        "What that buys DECODED, and what it costs (one clip, same-seed rerun "
        "band measured 2026-09-01): the guide keeps the inserted span at the "
        "source's speed, as the Motion Adapter recipe does, and invents less "
        "in the frame; it also costs about 12% of the source's detail (0.88 of "
        "source sharpness, rerun band 0.003), and on playback the guide arms "
        "were judged WORSE than the adapter recipe for exactly that reason. "
        "Read this node as a 'protect what is already right' instrument, not "
        "as a sharper de-rope.\n\n"
        "token_idx is the LATENT-TOKEN offset of the guide's first token "
        "inside the target grid (0 = a full-length guide starting at the "
        "top). Tokens cover (1, 4, 4, 4, 4) pixel frames per 5, and this node "
        "converts to the pixel-frame anchor core wants for you.\n\n"
        "Clock-correct by construction: under H3 True Clock or H3 DyRoPE the "
        "guide's rows are retimed to the exact t of the target rows they "
        "duplicate, and a guide that cannot be mapped RAISES instead of "
        "silently sitting on the stock grid (which, on a dense clip, is "
        "hundreds of rotary units away from what it is supposed to align "
        "with).\n\n"
        "Costs one target-video-worth of sequence length per full guide — "
        "roughly a doubling of the video rows, which is superlinear in step "
        "time. A short guide over the span you care about costs "
        "proportionally less; that is what token_idx is for.\n\n"
        "Do NOT pair with the published Motion Adapter: it was trained on "
        "the in-x_t arrangement and measured WORSE with a guide than the "
        "base model is (0.87 vs 0.41 of the lerp baseline).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "positive": ("CONDITIONING",),
            "latent": ("LATENT", {"tooltip": "the TARGET AV latent the sampler will denoise — the shape authority"}),
            "guide": ("LATENT", {"tooltip": "the guide movie as a latent: a video latent [1,24,vt,h,w] or a "
                                            "nested AV latent (the video half is used, audio is ignored). "
                                            "Must share the target's (h, w)"}),
            "token_idx": ("INT", {"default": 0, "min": 0, "max": 4096,
                          "tooltip": "latent-token offset of the guide's first token inside the target grid. "
                                     "0 = aligned from the top (a full-length guide). Converted to core's "
                                     "pixel-frame anchor via (1,4,4,4,4) frames per token"}),
            "noise_aug": ("FLOAT", {"default": 0.999, "min": 0.0, "max": 1.0, "step": 0.001,
                          "tooltip": "how clean the condition rows arrive: rows = aug*guide + (1-aug)*noise, "
                                     "and the row timestep is max(t_video, aug). 0.999 is core's default and "
                                     "the value the guide arms were trained at. Applies to EVERY keyframe on "
                                     "this conditioning, not just this node's"}),
        }}

    RETURN_TYPES = ("CONDITIONING", "STRING")
    RETURN_NAMES = ("positive", "report")
    FUNCTION = "add"
    CATEGORY = "conditioning/minimax/motion"

    def add(self, positive, latent, guide, token_idx=0, noise_aug=0.999):
        import comfy.ldm.minimax.model as _mm
        import node_helpers

        target = _video_component(latent)
        g = _video_component(guide)
        if g.dim() == 4:
            g = g[None]
        if target.dim() != 5 or g.dim() != 5:
            raise ValueError(
                "H3 Add Latent Guide: expected 5D video latents (B, C, t, h, w), "
                "got target %r and guide %r" % (tuple(target.shape), tuple(g.shape)))
        if target.shape[0] != 1 or g.shape[0] != 1:
            raise ValueError(
                "H3 Add Latent Guide: batch must be 1 on both sides (target B=%d, "
                "guide B=%d). Core packs one keyframe latent per condition; a "
                "batch would silently pack only the first."
                % (target.shape[0], g.shape[0]))
        if g.shape[1] != target.shape[1]:
            raise ValueError(
                "H3 Add Latent Guide: guide has %d channels, the target has %d"
                % (g.shape[1], target.shape[1]))
        if tuple(g.shape[3:]) != tuple(target.shape[3:]):
            raise ValueError(
                "H3 Add Latent Guide: guide (h, w) = %r must equal the target's %r. "
                "Core packs cond rows on the TARGET's spatial grid, so a "
                "different resolution does not misalign — it produces the wrong "
                "number of rows and fails deep in the model."
                % (tuple(g.shape[3:]), tuple(target.shape[3:])))
        t_lat = int(target.shape[2])
        vt = int(g.shape[2])
        token_idx = int(token_idx)
        if token_idx + vt > t_lat:
            raise ValueError(
                "H3 Add Latent Guide: a %d-token guide at token_idx %d overruns "
                "the target's %d tokens" % (vt, token_idx, t_lat))

        resolved_frame_index = guide_frame_index(token_idx)
        # receipt: core's cond origin (FRAME_RESCALE * resolved_frame_index) is
        # the target's own stock t at this token. dyrope_stock_spans/dyrope_grid
        # read the core constants and reproduce _video_t_grid bit for bit
        # WITHOUT going through the patched _video_t_spans symbol.
        origin_t = _mm.FRAME_RESCALE * resolved_frame_index
        stock_t = dyrope_grid(dyrope_stock_spans(token_idx + 1), 0.0)[token_idx]
        assert abs(origin_t - stock_t) < 1e-9, (
            "H3 Add Latent Guide: token %d maps to pixel frame %d -> cond origin "
            "%.12f, but the target's stock t there is %.12f"
            % (token_idx, resolved_frame_index, origin_t, stock_t))

        keyframes = list(positive[0][1].get("minimax_keyframes", []))
        keyframes.append({"resolved_frame_index": int(resolved_frame_index),
                          "latent": g})
        out = node_helpers.conditioning_set_values(
            positive, {"minimax_keyframes": keyframes,
                       "minimax_visual_cond_noise_aug": float(noise_aug)})
        _install_guide_layout_patch()

        frame_rows = (target.shape[3] // 2) * (target.shape[4] // 2)
        rows = vt * frame_rows
        target_rows = t_lat * frame_rows
        report = (
            "H3 Add Latent Guide: %d guide tokens at token_idx %d "
            "(pixel-frame anchor %d, cond t origin %.6f == target stock t %.6f)\n"
            "guide %r -> %d rows (%d tokens x %d rows/frame); the target video "
            "is %d rows, so this guide adds %.2fx of it\n"
            "keyframes on this conditioning: %d   noise_aug %.4f (applies to "
            "all of them)\n"
            "clock: retimed to the target rows under H3 True Clock / H3 DyRoPE; "
            "raises rather than falling back to the stock grid"
            % (vt, token_idx, resolved_frame_index, origin_t, stock_t,
               tuple(g.shape), rows, vt, frame_rows, target_rows,
               rows / float(target_rows), len(keyframes), float(noise_aug)))
        print("[MAINodes] " + report.splitlines()[0])
        return (out, report)


LATENT_CELL = 16   # image pixels per latent spatial cell (H3 video VAE)
LATENT_GRID = 2    # legal latent sizes are multiples of 2 cells (= 32 px)


def _snap_cells(px):
    """Pixels -> latent cells on the legal /32-pixel = /2-cell grid.

    Snapped in PIXELS (one step = 32 px) so the result is the nearest legal
    frame size, and half-up rather than python's banker's rounding so a .5
    request does not depend on which side of the grid it fell on.
    """
    step = LATENT_CELL * LATENT_GRID
    cells = int(math.floor(px / step + 0.5)) * LATENT_GRID
    return max(LATENT_GRID, cells)


def _spatial_resize(v, h, w, mode):
    """Spatially resize a (B, C, T, h, w) video latent. T is untouched."""
    import torch.nn.functional as F
    b, c, t = v.shape[0], v.shape[1], v.shape[2]
    flat = v.permute(0, 2, 1, 3, 4).reshape(b * t, c, v.shape[3], v.shape[4])
    kw = {} if mode.startswith("nearest") else {"align_corners": False}
    flat = F.interpolate(flat.float(), size=(h, w), mode=mode, **kw).to(v.dtype)
    return flat.reshape(b, t, c, h, w).permute(0, 2, 1, 3, 4).contiguous()


class H3LatentUpscale:
    """Spatial upscale of the VIDEO half of an H3 latent, audio untouched.

    Stock LatentUpscale cannot touch an H3 latent at all: `samples` is a
    comfy NestedTensor (video (B,24,T,h,w) + audio (B,32,2,aT)), and a
    2D interpolate on either member is meaningless. This resizes only the
    video's h/w on the legal grid and passes the audio through by
    reference. The time axis is never touched."""

    DESCRIPTION = (
        "EXPERIMENTAL. Spatially upscales the VIDEO component of an H3 "
        "latent (nested audio+video, or a plain VAEEncode video latent) and "
        "passes the AUDIO through untouched, bit-exact. Lets an upscale+"
        "refine pass stay latent-resident: no VAE decode, pixel resize and "
        "re-encode between the passes. The trade is real - the VAE roundtrip "
        "the pixel path pays also re-derives detail, so a latent upscale can "
        "come back softer; measure before adopting it (A/B against the "
        "pixel path on your content).\n\n"
        "Sizes snap to the legal grid: one latent cell is 16 image pixels "
        "and legal frames are multiples of 32 px, so targets round to an "
        "EVEN number of cells. scale is used unless width/height are "
        "nonzero (a nonzero value overrides that axis). The TIME axis is "
        "untouched - token count, the 17k+5 grid and the audio clock all "
        "stay exactly as they were.")

    MODES = ["bilinear", "nearest-exact"]

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT", {"tooltip": "H3 nested AV latent, or a plain video latent from VAEEncode"}),
            "scale": ("FLOAT", {"default": 2.0, "min": 0.25, "max": 4.0, "step": 0.05,
                                "tooltip": "spatial scale factor; snapped to the /32-pixel (/2-cell) grid"}),
            "mode": (cls.MODES, {"default": "bilinear",
                                 "tooltip": "bilinear (default) is smoother; nearest-exact keeps latent cell values verbatim"}),
        }, "optional": {
            "width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 32,
                              "tooltip": "0 = use scale. Nonzero: target IMAGE width, snapped to /32"}),
            "height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 32,
                               "tooltip": "0 = use scale. Nonzero: target IMAGE height, snapped to /32"}),
        }}

    RETURN_TYPES = ("LATENT", "STRING")
    RETURN_NAMES = ("samples", "report")
    FUNCTION = "upscale"
    CATEGORY = "latent/minimax/motion"

    def upscale(self, samples, scale=2.0, mode="bilinear", width=0, height=0):
        z = samples["samples"]
        nested = bool(getattr(z, "is_nested", False) and hasattr(z, "unbind"))
        parts = list(z.unbind()) if nested else [z]
        video = parts[0]
        src_h, src_w = int(video.shape[3]), int(video.shape[4])

        tgt_h = _snap_cells(height) if height else _snap_cells(src_h * LATENT_CELL * scale)
        tgt_w = _snap_cells(width) if width else _snap_cells(src_w * LATENT_CELL * scale)

        out = dict(samples)
        if (tgt_h, tgt_w) != (src_h, src_w):
            parts[0] = _spatial_resize(video, tgt_h, tgt_w, mode)
            if nested:
                out["samples"] = type(z)(tuple(parts))
            else:
                out["samples"] = parts[0]
            nm = samples.get("noise_mask")
            if nm is not None:
                mparts = (list(nm.unbind())
                          if getattr(nm, "is_nested", False) and hasattr(nm, "unbind")
                          else [nm])
                if mparts[0].dim() == 5:
                    mparts[0] = _spatial_resize(mparts[0], tgt_h, tgt_w,
                                                "nearest-exact")
                    out["noise_mask"] = (type(nm)(tuple(mparts))
                                         if len(mparts) > 1 else mparts[0])

        rep = [f"video {src_h}x{src_w} -> {tgt_h}x{tgt_w} cells "
               f"({src_h * LATENT_CELL}x{src_w * LATENT_CELL} -> "
               f"{tgt_h * LATENT_CELL}x{tgt_w * LATENT_CELL} px), {mode}",
               f"time axis untouched: {int(video.shape[2])} tokens"]
        if nested and len(parts) > 1:
            rep.append("audio passed through untouched: "
                       f"{tuple(parts[1].shape)} {parts[1].dtype}")
        else:
            rep.append("plain video latent (no audio component)")
        return (out, "\n".join(rep))


class H3InjectSchedule:
    """Truncated sigma schedule for v2v injection. inject=0.70 (the
    measured sweet spot) keeps the init's coarse choreography and re-rolls
    rendering; lower inherits more artifact risk, higher drifts toward
    free generation (invented-physics regime)."""

    DESCRIPTION = (
        "Truncated sigma schedule for v2v injection — THE quality dial of "
        "the pipeline. inject = how much of the denoise trajectory actually "
        "runs on top of your smeared init.\n\n"
        "Recommended range 0.5-0.8. Default 0.70 (playback-ratified). 0.5 "
        "measured as the metric quality point in our A/B (sharpest AND "
        "closest choreography tracking) — try both on your content. Below "
        "~0.5 the init's own artifacts start surviving into the output; "
        "above ~0.8 the model increasingly ignores your baseline and invents "
        "its own choreography. total_steps 25 for the base model; drop to "
        "the distilled step count if you stack a turbo LoRA (measure first — "
        "injection under heavy distillation is still experimental).")

    PRESETS = {
        "balanced 0.70 (default)": 0.70,
        "faithful detail 0.50 (metric best)": 0.50,
        "loose / creative 0.80": 0.80,
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "scheduler": (["simple", "normal", "beta", "sgm_uniform", "karras",
                           "exponential"], {"default": "simple"}),
            "total_steps": ("INT", {"default": 25, "min": 4, "max": 100}),
            "inject": ("FLOAT", {"default": 0.70, "min": 0.05, "max": 1.0,
                                 "step": 0.05,
                                 "tooltip": "0.5-0.8 recommended; lower keeps init artifacts, higher invents choreography"}),
        }, "optional": {
            "preset": (["custom"] + list(cls.PRESETS), {"default": "balanced 0.70 (default)",
                       "tooltip": "any choice but 'custom' overrides the inject knob"}),
        }}

    RETURN_TYPES = ("SIGMAS",)
    FUNCTION = "sigmas"
    CATEGORY = "sampling/custom_sampling/schedulers"

    def sigmas(self, model, scheduler, total_steps, inject, preset="custom"):
        if preset in self.PRESETS:
            inject = self.PRESETS[preset]
        import comfy.samplers
        full = comfy.samplers.calculate_sigmas(
            model.get_model_object("model_sampling"), scheduler, total_steps)
        run = max(1, int(round(total_steps * inject)))
        return (full[total_steps - run:],)


class H3JerkHeatmap:
    """The oracle made visible (demo tile as a node): jerk-heat overlay on
    the frames + a per-token jerk strip with playhead along the bottom."""

    DESCRIPTION = (
        "The oracle made visible: overlays the jerk heat map on your frames "
        "(red-yellow pools where motion is too fast per latent token) and "
        "draws the per-token jerk profile as a bar strip with a playhead — "
        "watch the burst light up as playback reaches it. With show_drift "
        "on, regions that move steadily WITHOUT burst jerk (birds, crowds, "
        "traffic: velocity-high, jerk-low) glow blue: the drifter class "
        "that time warping mishandles and background freezing protects. "
        "Purely diagnostic/"
        "presentational; wire the same latent you'd give H3 Jerk Oracle. "
        "alpha 0.4-0.7 reads well; strip_height 0 hides the bar strip.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "samples": ("LATENT",),
            "alpha": ("FLOAT", {"default": 0.55, "min": 0.0, "max": 1.0, "step": 0.05}),
            "strip_height": ("INT", {"default": 96, "min": 0, "max": 256}),
        }, "optional": {
            "show_drift": ("BOOLEAN", {"default": True,
                "tooltip": "blue overlay on steady movers (velocity-high, jerk-low): the birds"}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "overlay"
    CATEGORY = "image/minimax/motion"

    def overlay(self, images, samples, alpha, strip_height, show_drift=True):
        images = images.detach().float().cpu()  # --gpu-only hands us cuda tensors
        z = _video_component(samples)
        t_lat = z.shape[2]
        n, H, W, _ = images.shape

        v = z.detach().float().cpu().numpy()
        jmap = np.abs(np.diff(v, n=3, axis=2)).mean(axis=(0, 1))   # (T-3, h, w)
        vmap = np.abs(np.diff(v, n=1, axis=2)).mean(axis=(0, 1))   # (T-1, h, w)
        tok = np.stack([jmap[min(max(k - 1, 0), jmap.shape[0] - 1)]
                        for k in range(t_lat)])
        for ph in range(5):
            m = tok[ph::5].mean()
            if m > 0:
                tok[ph::5] /= m
        lo, hi = np.quantile(tok, 0.05), np.quantile(tok, 0.995)
        tok = np.clip((tok - lo) / (hi - lo + 1e-9), 0, 1)
        heat = torch.nn.functional.interpolate(
            torch.from_numpy(tok).float()[None], size=(H, W),
            mode="bilinear", align_corners=False)[0]               # (T, H, W)

        drift = None
        if show_drift:
            vtok = np.stack([vmap[min(max(k - 1, 0), vmap.shape[0] - 1)]
                             for k in range(t_lat)])
            for ph in range(5):
                m = vtok[ph::5].mean()
                if m > 0:
                    vtok[ph::5] /= m
            lo2, hi2 = np.quantile(vtok, 0.05), np.quantile(vtok, 0.995)
            vtok = np.clip((vtok - lo2) / (hi2 - lo2 + 1e-9), 0, 1)
            dmap = np.clip(vtok - tok, 0, 1)          # moving, but not bursting
            drift = torch.nn.functional.interpolate(
                torch.from_numpy(dmap).float()[None], size=(H, W),
                mode="bilinear", align_corners=False)[0]

        prof = _jerk_profile(z)
        pn = (prof - prof.min()) / (prof.max() - prof.min() + 1e-9)

        out = []
        bar_w = max(W // t_lat, 1)
        for f in range(n):
            k = _frame_token(min(f, 3600), t_lat) if f < 3600 else 0
            k = min(k, t_lat - 1)
            hm = heat[k]
            a = (hm * alpha)[..., None]
            color = torch.stack([torch.ones_like(hm),
                                 0.3 + 0.7 * (1 - hm),
                                 torch.zeros_like(hm)], -1)
            img = images[f] * (1 - a) + color * a
            if drift is not None:
                dm = drift[k]
                da = (dm * alpha * 0.8)[..., None]
                dcolor = torch.stack([torch.zeros_like(dm),
                                      0.45 + 0.35 * (1 - dm),
                                      torch.ones_like(dm)], -1)
                img = img * (1 - da) + dcolor * da
            if strip_height:
                strip = torch.full((strip_height, W, 3), 0.09)
                for t in range(t_lat):
                    bh = int(pn[t] * (strip_height - 14)) + 4
                    x0, x1 = t * bar_w + 1, min((t + 1) * bar_w - 1, W)
                    c = (torch.tensor([1.0, 0.3 + 0.7 * (1 - pn[t]), 0.0]) if t == k
                         else torch.tensor([0.35, 0.35 + 0.45 * (1 - pn[t]), 0.63]))
                    strip[strip_height - bh:, x0:x1] = c
                px = int(f / max(n - 1, 1) * (W - 1))
                strip[:, max(px - 1, 0):px + 1] = 1.0
                img = torch.cat([img, strip.to(img.dtype)], 0)
            out.append(img)
        return (torch.stack(out),)


def _vocoder_rate_for(spec, rate, hop, need):
    """Clamp a phase-vocoder rate so the ISTFT can cover `need` samples.

    torch.istft(center=True) yields n_frames*hop valid samples; asking for
    more (length=) reaches into the last window's Hann tail and trips
    "window overlap add min". phase_vocoder emits ceil(n_in/rate) frames, so
    the guard is rate <= n_in*hop/need. It bites only when the source segment
    was clipped short (H3's audio runs on a 40 Hz clock, so a clip's audio can
    be up to +-12.5 ms off frames/fps, and the LAST stretched run of a map
    then has fewer source samples than its frame count implies). Reported by
    a user 2026-08-18: [3]*12 last run, 93 frames vs 48160 requested."""
    n_in = spec.shape[-1]
    if n_in <= 0 or need <= 0:
        return rate
    return min(float(rate), (n_in * hop) / float(need))


class H3AudioRecover:
    """Retime the regenerated clip's jointly-generated audio back to the
    original clock, using the same hold map as the video."""

    DESCRIPTION = (
        "Retimes the regenerated clip's own audio back to the original "
        "clock, using the same hold map as the video. Each hold segment is "
        "compressed with a phase vocoder, so pitch is preserved while "
        "duration shrinks. Wire audio from VAEDecodeAudio of the "
        "regenerated latent and hold_map from the same H3 Time Smear that "
        "built the init; the result lines up with H3 Exact Recover's video "
        "frame for frame. fps is the video frame rate the holds count in.\n\n"
        "Thickness dial: the regenerated foley is scored for the slowed "
        "performance, so it comes back leaner than a native-speed mix "
        "(often a more realistic feel). Wire the baseline clip's audio "
        "into reference and raise reference_mix to blend its denser "
        "full-speed track back in: 0 keeps the lean regenerated foley, "
        "1 is the baseline track alone. Note: with an adaptive hold map, "
        "audio in unheld spans passes through untouched, so dialog "
        "outside the bursts is unaffected either way.")

    # words rather than a bare 0..1, because the two endpoints mean different
    # things depending on whether pass 2 was given an audio init at all
    SOURCES = {
        "keep the original performance (safe default)": 1.0,
        "use pass 2's foley - ONLY IF the audio rows were seeded": 0.0,
        "blend, favour the original": 0.75,
        "blend, favour pass 2": 0.25,
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO",),
            "hold_map": ("STRING", {"default": ""}),
            "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
        }, "optional": {
            "reference": ("AUDIO", {"tooltip": "baseline clip audio (already real-time)"}),
            "reference_mix": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0,
                                        "step": 0.05,
                                        "tooltip": "1 = the pass-1 reference track intact (default: regenerated "
                                                   "audio quality varies, especially with turbo passes), "
                                                   "0 = regenerated foley only (leaner, one performance). "
                                                   "Mid values blend two takes and are happiest near the ends"}),
            "audio_source": (["custom (use reference_mix)"] + list(cls.SOURCES),
                {"default": "custom (use reference_mix)",
                 "tooltip": "plain-language presets; anything but 'custom' overrides reference_mix. "
                            "WHICH ONE IS RIGHT DEPENDS ON WHETHER PASS 2's AUDIO ROWS WERE SEEDED "
                            "(H3 Audio Smear -> H3 V2V Init audio_latent). Unseeded, pass 2 invents "
                            "speech at natural rate and this node compresses it, so held regions come "
                            "back rushed - keep the original. Seeded, pass 2 really did perform slowly, "
                            "so the retime is valid and its foley is scored for the NEW motion"}),
        }}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "recover"
    CATEGORY = "audio/minimax/motion"

    def recover(self, audio, hold_map, fps=24, reference=None, reference_mix=1.0,
                audio_source="custom (use reference_mix)"):
        import math

        if audio_source in self.SOURCES:          # words win over the raw dial
            reference_mix = self.SOURCES[audio_source]

        torchaudio = _torchaudio("phase_vocoder")

        holds = json.loads(hold_map)["holds"]
        wav = audio["waveform"].detach().float().cpu()   # [B, C, N]
        sr = audio["sample_rate"]
        b, c, n = wav.shape
        x = wav.reshape(b * c, n)

        runs = []                                        # consecutive equal holds
        for h in holds:
            if runs and runs[-1][0] == h:
                runs[-1][1] += 1
            else:
                runs.append([h, 1])

        n_fft, hop = 2048, 512
        window = torch.hann_window(n_fft)
        phase_adv = torch.linspace(0, math.pi * hop, n_fft // 2 + 1)[..., None]
        spf = sr / float(fps)                            # samples per frame
        xfade = max(1, int(round(0.005 * sr)))           # 5 ms, 160 @ 32 kHz
        segs, joins, cursor = [], [], 0.0
        prev_tgt = 0
        for h, count in runs:
            src = h * count * spf
            # exact world-clock samples this run must occupy. The vocoder's
            # istft comes back hop-quantized (~16 ms at 32 kHz), and letting
            # those errors accumulate slides the retimed track against the
            # reference toward the clip's end -- which is what turns a mid
            # reference_mix into audible doubled impacts.
            tgt = int(round(count * spf))
            s0, s1 = int(round(cursor)), int(round(cursor + src))
            cursor += src
            # pre-roll for the crossfade into the previous run: f output
            # samples cost f*h source samples, taken from BEFORE s0, so both
            # sides of the join carry the same material at their own rate and
            # nothing is dropped. It lands ON TOP of the previous segment's
            # tail, so the output length is exactly sum(tgt) either way.
            f = 0 if not segs else min(xfade, tgt, prev_tgt, s0 // max(h, 1))
            prev_tgt = tgt
            seg = x[:, s0 - f * h:min(s1, n)]
            if seg.shape[1] == 0:
                # source exhausted: hold the clock with silence instead of
                # silently shortening every later segment's position
                segs.append(torch.zeros(x.shape[0], tgt))
                joins.append(0)
                continue
            if h > 1:
                spec = torch.stft(seg, n_fft, hop, window=window,
                                  return_complex=True)
                spec = torchaudio.functional.phase_vocoder(
                    spec, _vocoder_rate_for(spec, float(h), hop, f + tgt), phase_adv)
                # length= is load-bearing: without it istft returns a
                # hop-multiple that falls short of the target and the pad
                # below appends digital silence at every held run's tail --
                # an audible click on the 512-sample lattice.
                seg = torch.istft(spec, n_fft, hop, window=window,
                                  length=f + tgt)
            if seg.shape[1] < f + tgt:
                seg = torch.nn.functional.pad(seg, (0, f + tgt - seg.shape[1]))
            segs.append(seg[:, :f + tgt])
            joins.append(f)
        parts = []
        for seg, f in zip(segs, joins):
            if f:
                # equal-power crossfade: the two takes of this material are
                # retimed at different rates, so they sum incoherently
                t = torch.arange(1, f + 1, dtype=seg.dtype) / f
                prev = parts[-1].clone()                 # never write into x
                prev[:, -f:] = (prev[:, -f:] * torch.cos(t * (math.pi / 2))
                                + seg[:, :f] * torch.sin(t * (math.pi / 2)))
                parts[-1] = prev
            parts.append(seg[:, f:])
        y = torch.cat(parts, dim=1)
        if reference is None and reference_mix > 0:
            print(f"[H3AudioRecover] reference_mix={reference_mix} but no "
                  "reference audio is wired: the mix does NOTHING and the "
                  "output is pure regenerated audio. Wire the baseline's "
                  "audio into 'reference' to blend it back in")
        if reference is not None and reference_mix > 0:
            ref = reference["waveform"].detach().float().cpu().reshape(-1, reference["waveform"].shape[-1])
            if reference["sample_rate"] != sr:
                _ta = _torchaudio("resample")
                ref = _ta.functional.resample(ref, reference["sample_rate"], sr)
            n_out = min(y.shape[1], ref.shape[1])
            if ref.shape[0] != y.shape[0]:
                ref = ref[:1].expand(y.shape[0], -1)
            y = (1 - reference_mix) * y[:, :n_out] + reference_mix * ref[:, :n_out]
        return ({"waveform": y.reshape(b, c, -1).contiguous(), "sample_rate": sr},)


class H3AudioSmear:
    """Expand a world-clock track onto the dilated clock: Audio Recover run
    backwards, off the same hold map."""

    DESCRIPTION = (
        "The audio twin of H3 Time Smear: stretches the baseline clip's audio "
        "onto the SAME dilated timeline the smeared video init lives on, so "
        "the second pass can be seeded with a slowed performance instead of "
        "inventing its own.\n\n"
        "Why this exists: the de-rope tells pass 2 to move slowly through the "
        "smeared video init, and the picture obeys, but audio has no init, so "
        "the model writes fresh speech at NATURAL rate and drags the mouth to "
        "match it. Recovery then compresses that mouth (and, at "
        "reference_mix 0, that speech) by the hold factor, which is why held "
        "regions come back rushed while the unheld tail sounds fine. Seed the "
        "audio rows with this node's output and the slowed performance becomes "
        "the thing pass 2 renders, so Exact Recover and Audio Recover are both "
        "compressing something that really was slow.\n\n"
        "Wire the same hold_map you gave H3 Time Smear, and the BASELINE "
        "(pass-1) audio. Feed the result to VAEEncodeAudio and then to H3 V2V "
        "Init's audio_latent. Pitch is preserved; the stretch is a phase "
        "vocoder, so its fine detail is rough. That is fine: the injection "
        "strength is what re-renders detail (0.5-0.7, the same dial the video "
        "side uses).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO", {"tooltip": "baseline (pass-1) audio, on the world clock"}),
            "hold_map": ("STRING", {"default": ""}),
            "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
        }}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "smear"
    CATEGORY = "audio/minimax/motion"

    def smear(self, audio, hold_map, fps=24):
        import math

        torchaudio = _torchaudio("phase_vocoder")

        holds = json.loads(hold_map)["holds"]
        wav = audio["waveform"].detach().float().cpu()
        sr = audio["sample_rate"]
        b, c, n = wav.shape
        x = wav.reshape(b * c, n)

        runs = []                                        # consecutive equal holds
        for h in holds:
            if runs and runs[-1][0] == h:
                runs[-1][1] += 1
            else:
                runs.append([h, 1])

        n_fft, hop = 2048, 512
        window = torch.hann_window(n_fft)
        phase_adv = torch.linspace(0, math.pi * hop, n_fft // 2 + 1)[..., None]
        spf = sr / float(fps)
        xfade = max(1, int(round(0.005 * sr)))
        segs, joins, cursor = [], [], 0.0
        prev_tgt = 0
        for h, count in runs:
            # mirror of the recover geometry: src is what this run occupies on
            # the WORLD clock, tgt is the room it gets on the dilated one.
            src = count * spf
            tgt = int(round(h * count * spf))
            s0, s1 = int(round(cursor)), int(round(cursor + src))
            cursor += src
            # pre-roll for the crossfade: f output samples cost f/h source
            # samples, taken from BEFORE s0, so both sides of the join carry
            # the same material at their own rate.
            f = 0 if not segs else min(xfade, tgt, prev_tgt, s0 * max(h, 1))
            prev_tgt = tgt
            seg = x[:, s0 - max(1, f // max(h, 1)):min(s1, n)] if f else x[:, s0:min(s1, n)]
            if seg.shape[1] == 0:
                segs.append(torch.zeros(x.shape[0], tgt))
                joins.append(0)
                continue
            if h > 1:
                spec = torch.stft(seg, n_fft, hop, window=window,
                                  return_complex=True)
                # rate < 1 LENGTHENS; this is the only line that differs in
                # direction from H3AudioRecover
                spec = torchaudio.functional.phase_vocoder(
                    spec, _vocoder_rate_for(spec, 1.0 / float(h), hop, f + tgt), phase_adv)
                # length= is load-bearing here for the same reason it is in
                # recover: istft returns a hop multiple and the pad below would
                # otherwise append digital silence at every run's tail.
                seg = torch.istft(spec, n_fft, hop, window=window,
                                  length=f + tgt)
            if seg.shape[1] < f + tgt:
                seg = torch.nn.functional.pad(seg, (0, f + tgt - seg.shape[1]))
            segs.append(seg[:, :f + tgt])
            joins.append(f)
        parts = []
        for seg, f in zip(segs, joins):
            if f:
                t = torch.arange(1, f + 1, dtype=seg.dtype) / f
                prev = parts[-1].clone()
                prev[:, -f:] = (prev[:, -f:] * torch.cos(t * (math.pi / 2))
                                + seg[:, :f] * torch.sin(t * (math.pi / 2)))
                parts[-1] = prev
            parts.append(seg[:, f:])
        y = torch.cat(parts, dim=1)
        return ({"waveform": y.reshape(b, c, -1).contiguous(), "sample_rate": sr},)


class H3ProbeSchedule:
    """Head-only schedule for oracle probing: skip most of the first pass."""

    DESCRIPTION = (
        "Runs only the head of the baseline schedule. Wire the sampler's "
        "denoised_output (the x0 estimate) into H3 Jerk Oracle and into the "
        "decode that feeds H3 Time Smear: in our measurements the burst "
        "timing is readable by step 4-5 of 25, and injection destroys fine "
        "detail anyway, so the coarse early estimate is a workable init. "
        "probe_steps is the dial: 6 of 25 skips ~75% of the first pass; "
        "raise it if the init loses too much choreography on your content. "
        "Trade-off: no finished baseline means no finished baseline audio "
        "(H3 Audio Recover's reference input has nothing full-speed to "
        "blend, and the probe's own audio estimate is rough).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "scheduler": (["simple", "normal", "beta", "sgm_uniform", "karras",
                           "exponential"], {"default": "simple"}),
            "total_steps": ("INT", {"default": 25, "min": 4, "max": 100}),
            "probe_steps": ("INT", {"default": 6, "min": 2, "max": 100,
                            "tooltip": "how much of the schedule to actually run"}),
        }}

    RETURN_TYPES = ("SIGMAS",)
    FUNCTION = "sigmas"
    CATEGORY = "sampling/custom_sampling/schedulers"

    def sigmas(self, model, scheduler, total_steps, probe_steps):
        import comfy.samplers
        full = comfy.samplers.calculate_sigmas(
            model.get_model_object("model_sampling"), scheduler, total_steps)
        return (full[:min(probe_steps, total_steps) + 1],)


class H3ExpertSchedule:
    """Split the injected schedule: base-model head, turbo tail."""

    DESCRIPTION = (
        "Expert split for the regeneration pass: the first base_head steps "
        "run on the base model (structure forms on the least-distilled "
        "weights), the remaining steps run on the turbo LoRA (refinement, "
        "where distilled models are comfortable). Outputs head and tail "
        "sigma slices of one continuous schedule. Wire: head into a "
        "SamplerCustomAdvanced on the plain model with your RandomNoise; "
        "tail into a second SamplerCustomAdvanced on the LoRA-patched "
        "model with DisableNoise, continuing the head's output latent. "
        "Defaults: total 8, inject 0.70 (6 steps run), base_head 2, so the "
        "turbo tail gets 4 steps, its native count.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "scheduler": (["simple", "normal", "beta", "sgm_uniform", "karras",
                           "exponential"], {"default": "beta"}),
            "total_steps": ("INT", {"default": 8, "min": 4, "max": 100}),
            "inject": ("FLOAT", {"default": 0.70, "min": 0.05, "max": 1.0,
                                 "step": 0.05}),
            "base_head": ("INT", {"default": 2, "min": 0, "max": 20,
                          "tooltip": "steps run on the base model before the turbo tail"}),
        }}

    RETURN_TYPES = ("SIGMAS", "SIGMAS")
    RETURN_NAMES = ("head_sigmas", "tail_sigmas")
    FUNCTION = "sigmas"
    CATEGORY = "sampling/custom_sampling/schedulers"

    def sigmas(self, model, scheduler, total_steps, inject, base_head):
        import comfy.samplers
        full = comfy.samplers.calculate_sigmas(
            model.get_model_object("model_sampling"), scheduler, total_steps)
        run = max(1, int(round(total_steps * inject)))
        s = full[total_steps - run:]
        h = min(base_head, run - 1)
        return (s[:h + 1], s[h:])


class _TrajBankSampler:
    def __init__(self, inner, dump_dir, every_n):
        self.inner = inner
        self.dump_dir = dump_dir
        self.every_n = max(1, every_n)

    def max_denoise(self, model_wrap, sigmas):
        return self.inner.max_denoise(model_wrap, sigmas)

    def sample(self, model_wrap, sigmas, extra_args, callback, noise,
               latent_image=None, denoise_mask=None, disable_pbar=False):
        import os
        os.makedirs(self.dump_dir, exist_ok=True)
        torch.save(sigmas.detach().cpu(), os.path.join(self.dump_dir, "sigmas.pt"))

        def parts(t):
            if hasattr(t, "is_nested") and t.is_nested:
                return list(t.tensors)
            return [t]

        # At this (KSAMPLER) level x is comfy's PACKED latent: every stream
        # flattened and concatenated to (B, 1, N) by comfy.utils.pack_latents
        # (samplers.py CFGGuider.sample), so the NestedTensor branch below
        # never fires for H3 and "video" holds the whole packed vector. Record
        # the stream shapes when the guider exposes them so H3TrajectoryLoad
        # can unpack; otherwise Load needs its `reference` LATENT input.
        shapes = None
        audio_scale = None
        for obj in (model_wrap, getattr(model_wrap, "inner_model", None),
                    getattr(getattr(model_wrap, "inner_model", None), "inner_model", None)):
            if obj is None:
                continue
            ls = getattr(obj, "latent_shapes", None)
            if ls and shapes is None:
                shapes = [list(int(v) for v in sh) for sh in ls]
            ms = getattr(obj, "model_sampling", None)
            if audio_scale is None and ms is not None and hasattr(ms, "audio_scale"):
                try:
                    audio_scale = float(ms.audio_scale)
                except Exception:
                    audio_scale = None

        def cb(i, denoised, x, total):
            if i % self.every_n == 0 or i == total - 1:
                comps = parts(x)
                payload = {"step": i, "total_steps": total,
                           "video": comps[0].detach().to(torch.float16).cpu(),
                           "packed": len(comps) == 1 and comps[0].dim() == 3 and comps[0].shape[1] == 1}
                if shapes is not None:
                    payload["latent_shapes"] = shapes
                if audio_scale is not None:
                    payload["audio_scale"] = audio_scale
                if len(comps) > 1:
                    payload["audio"] = comps[1].detach().to(torch.float16).cpu()
                torch.save(payload, os.path.join(self.dump_dir, f"x_step{i:03d}.pt"))
            if callback is not None:
                callback(i, denoised, x, total)

        return self.inner.sample(model_wrap, sigmas, extra_args, cb, noise,
                                 latent_image, denoise_mask, disable_pbar)


class H3TrajectoryBank:
    """SAMPLER wrapper that checkpoints the noisy latent at every step."""

    DESCRIPTION = (
        "Wraps a sampler and saves the trajectory latent (x_t, the noisy "
        "state the sampler actually carries) after each step, plus the "
        "sigma schedule. About 7 MB per step for a 5 s 1024 clip, so a "
        "full 25-step run banks under 200 MB. Pair with H3 Trajectory "
        "Load to branch from any step without recomputing the head: swap "
        "the model, LoRA, guider, or remaining schedule and continue.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "sampler": ("SAMPLER",),
            "dump_dir": ("STRING", {"default": "/tmp/h3_trajectory"}),
            "every_n": ("INT", {"default": 1, "min": 1, "max": 25,
                                "tooltip": "save every Nth step (last step always saved)"}),
        }}

    RETURN_TYPES = ("SAMPLER",)
    FUNCTION = "wrap"
    CATEGORY = "sampling/custom_sampling/samplers"

    def wrap(self, sampler, dump_dir, every_n):
        return (_TrajBankSampler(sampler, dump_dir, every_n),)


class H3TrajectoryLoad:
    """Resume a banked trajectory from any saved step."""

    DESCRIPTION = (
        "Loads a step checkpoint saved by H3 Trajectory Bank and the "
        "matching remaining sigma schedule. Wire the LATENT into a "
        "SamplerCustomAdvanced with DisableNoise and the SIGMAS output as "
        "its schedule: sampling continues from the banked state, under "
        "whatever model, LoRA, or guider you attach. Changing anything "
        "downstream of the loaded step is the point.\n\n"
        "Fidelity: the bank stores x in fp16, so a null resume reproduces the "
        "banked run to ~35-42 dB for sigma <= ~0.90 (measured on H3, euler); "
        "above ~0.95 fp16 banking stops reproducing the take (instrument "
        "edge, not model behaviour). Only x is banked, not sampler history, so "
        "a multistep sampler (dpmpp_2m, res_multistep, gradient_estimation) "
        "resumes approximately at step k; euler is exact. AV models bank the "
        "packed video+audio vector; Load unpacks it from latent_shapes "
        "recorded by the Bank or from the `reference` LATENT, and divides the "
        "audio stream by the model's audio scale (recorded by the Bank when "
        "reachable; the widget is the fallback).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "dump_dir": ("STRING", {"default": "/tmp/h3_trajectory"}),
            "step": ("INT", {"default": 5, "min": 0, "max": 200,
                             "tooltip": "resume FROM this saved step (0-based): the file holds x "
                                        "entering step k at sigma[k]; remaining_sigmas = sigmas[k:]"}),
        }, "optional": {
            "reference": ("LATENT", {"tooltip": "the LATENT the banked run sampled from (e.g. "
                                     "MiniMaxH3ImageToVideo); supplies the stream shapes when the "
                                     "bank file predates latent_shapes (AV models pack video+audio "
                                     "into one flat vector at the sampler)"}),
            "audio_scale": ("FLOAT", {"default": 4.0, "min": 0.0, "max": 64.0, "step": 0.01,
                                      "tooltip": "the sampler carries the audio stream scaled onto the "
                                                 "video schedule by shift/audio_shift (H3: 12/3 = 4); a "
                                                 "bank file is in that space, so the unpacked audio is "
                                                 "divided by this before it re-enters as a LATENT (where "
                                                 "process_latent_in re-applies it). A value recorded in "
                                                 "the bank file wins over this widget; 0 = leave as-is."}),
            "undo_const_scaling": ("BOOLEAN", {"default": False,
                                  "tooltip": "flow/CONST models: SamplerCustomAdvanced applies "
                                             "(1-sigma_k)*latent + sigma_k*noise on entry, so a "
                                             "DisableNoise resume must be pre-divided by (1-sigma_k). "
                                             "Uses the banked sigma_k, i.e. assumes this node's own "
                                             "remaining_sigmas is the schedule you wire. Off = raw "
                                             "(do it in-graph with LatentMultiply)."}),
        }}

    RETURN_TYPES = ("LATENT", "SIGMAS", "INT")
    RETURN_NAMES = ("samples", "remaining_sigmas", "loaded_step")
    FUNCTION = "load"
    CATEGORY = "latent/minimax/motion"

    @classmethod
    def IS_CHANGED(cls, dump_dir, step, reference=None, audio_scale=4.0, undo_const_scaling=False):
        import os
        p = os.path.join(dump_dir, f"x_step{step:03d}.pt")
        try:
            return os.path.getmtime(p)
        except OSError:
            return float("nan")

    def load(self, dump_dir, step, reference=None, audio_scale=4.0, undo_const_scaling=False):
        import os

        import comfy.nested_tensor
        import comfy.utils
        p = os.path.join(dump_dir, f"x_step{step:03d}.pt")
        d = torch.load(p, weights_only=True)
        sigmas = torch.load(os.path.join(dump_dir, "sigmas.pt"), weights_only=True)
        video = d["video"].float()
        shapes = d.get("latent_shapes")
        ref_shapes = None
        if reference is not None:
            ref = reference["samples"]
            if hasattr(ref, "is_nested") and ref.is_nested:
                ref_shapes = [list(t.shape) for t in ref.tensors]
            else:
                ref_shapes = [list(ref.shape)]
        if shapes is None:
            shapes = ref_shapes
        elif ref_shapes is not None and [list(map(int, sh)) for sh in shapes] != [list(map(int, sh)) for sh in ref_shapes]:
            print(f"[H3TrajectoryLoad] bank file records latent_shapes {shapes}; the wired reference has "
                  f"{ref_shapes}. Using the file's (it describes what was banked).")
        if d.get("audio_scale") is not None:
            file_scale = float(d["audio_scale"])
            if audio_scale and abs(file_scale - float(audio_scale)) > 1e-6:
                print(f"[H3TrajectoryLoad] bank file records audio_scale {file_scale:.4f}; widget says "
                      f"{float(audio_scale):.4f}. Using the file's.")
            if audio_scale:
                audio_scale = file_scale
        packed = video.dim() == 3 and video.shape[1] == 1 and (d.get("packed") or shapes is not None)
        if packed and shapes is not None:
            import math
            total = sum(math.prod(sh[1:]) for sh in shapes)
            if int(shapes[0][0]) != int(video.shape[0]) or total != int(video.shape[-1]):
                raise ValueError(
                    f"H3TrajectoryLoad: the banked vector is {tuple(video.shape)} (batch {video.shape[0]}, "
                    f"{video.shape[-1]} values) but the stream shapes {shapes} sum to {total} values for batch "
                    f"{shapes[0][0]}. The reference must be the LATENT the banked run sampled from (same "
                    f"clip length, canvas and audio length); a mismatch would silently misalign the streams.")
        if packed and shapes is None and "audio" not in d:
            raise ValueError(
                "H3TrajectoryLoad: this bank file holds the packed video+audio vector and carries no "
                "latent_shapes (older Bank), so the streams cannot be separated. Wire the `reference` "
                "input with the LATENT the banked run sampled from (e.g. the MiniMaxH3ImageToVideo output).")
        if "audio" in d:
            aud = d["audio"].float()
            if audio_scale and audio_scale != 1.0:
                aud = aud / float(audio_scale)
            samples = comfy.nested_tensor.NestedTensor((video, aud))
        elif shapes is not None and len(shapes) > 1 and video.dim() == 3 and video.shape[1] == 1:
            # packed vector from the bank -> per-stream tensors (video, audio, ...)
            streams = comfy.utils.unpack_latents(video, [torch.Size(sh) for sh in shapes])
            if audio_scale and audio_scale != 1.0 and len(streams) > 1:
                streams = [streams[0], streams[1] / float(audio_scale)] + list(streams[2:])
            samples = comfy.nested_tensor.NestedTensor(streams)
        elif shapes is not None and len(shapes) == 1 and video.dim() == 3 and video.shape[1] == 1:
            samples = video.reshape(shapes[0])
        else:
            samples = video
        if undo_const_scaling:
            s_k = float(sigmas[step])
            if s_k < 1.0:
                samples = samples * (1.0 / (1.0 - s_k))
            else:
                print(f"[H3TrajectoryLoad] undo_const_scaling: sigma[{step}] = {s_k:.4f} >= 1, nothing to undo "
                      f"(the latent is fully replaced by noise on entry at sigma 1).")
        # x_step{k} is x ENTERING step k (the k-diffusion callback fires before the
        # update), so the schedule to continue with is sigmas[k:], not sigmas[k+1:].
        return ({"samples": samples}, sigmas[step:], int(step))


class H3MotionComposite:
    """Spatial recovery: regenerated pixels where the oracle saw motion
    (or where a manual mask says so), baseline pixels everywhere else."""

    DESCRIPTION = (
        "Fixes the sped-up-background side effect: inside dilated spans "
        "the model keeps background agents (birds, crowds, traffic) near "
        "their natural pace instead of full slow motion, so recovery "
        "overcranks them. This node composites per pixel on the shared "
        "world clock: where the subject mask is high it keeps the "
        "regenerated frames; where it is low it keeps the baseline, whose "
        "timing was correct all along.\n\n"
        "Two mask sources. ORACLE mode (wire samples, the BASELINE "
        "latent): spatial jerk heat picks the subject automatically; "
        "threshold sets how much heat counts as subject. MANUAL mode "
        "(wire mask): you decide. A human can hide the seam along a real "
        "edge (rooftop line, horizon) where the oracle cannot; lasso "
        "generously and let feather do the blending. mask=1 keeps "
        "regenerated pixels; invert_mask flips that, so you can lasso "
        "the birds/sky region you want kept at baseline timing instead. "
        "A single mask = static boundary (safe, never pops); a mask "
        "batch = per-frame on the world clock (moving boundaries can "
        "pop at the seam; feather harder).\n\n"
        "grow expands the mask to cover pose drift. feather softens the "
        "seam: profile linear (box), smoothstep or gaussian; direction "
        "centered straddles the boundary, inward eats into the masked "
        "side, outward eats into the kept side (trace a rooftop tight, "
        "then feather outward into the sky).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "regenerated": ("IMAGE",),
            "baseline": ("IMAGE",),
            "threshold": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.05,
                          "tooltip": "oracle mode: how much heat counts as subject; manual mode: binarization level for soft masks"}),
            "grow": ("INT", {"default": 32, "min": 0, "max": 256,
                             "tooltip": "pixels of mask dilation, covers pose drift"}),
            "feather": ("INT", {"default": 48, "min": 0, "max": 256}),
        }, "optional": {
            "samples": ("LATENT", {"tooltip": "BASELINE latent (oracle mode); optional when mask is wired"}),
            "mask": ("MASK", {"tooltip": "(alpha) manual subject mask, overrides the oracle. 1 = keep regenerated, 0 = keep baseline. One mask = static boundary; a batch = per-frame"}),
            "invert_mask": ("BOOLEAN", {"default": False,
                            "tooltip": "on: the mask marks the KEEP-BASELINE region instead (lasso the birds directly)"}),
            "feather_profile": (["linear", "smoothstep", "gaussian"], {"default": "linear"}),
            "feather_direction": (["centered", "inward", "outward"], {"default": "centered",
                                  "tooltip": "where the ramp lives relative to the mask boundary"}),
            "mask_is_soft": ("BOOLEAN", {"default": False,
                             "tooltip": "(alpha) mask values are final alphas (e.g. from H3 Motion Editor): skip threshold/grow/feather"}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "composite"
    CATEGORY = "image/minimax/motion"

    def composite(self, regenerated, baseline, threshold, grow, feather,
                  samples=None, mask=None, invert_mask=False,
                  feather_profile="linear", feather_direction="centered",
                  mask_is_soft=False):
        import torch.nn.functional as F

        regenerated = regenerated.detach().float().cpu()
        baseline = baseline.detach().float().cpu()
        n = min(regenerated.shape[0], baseline.shape[0])
        H, W = baseline.shape[1], baseline.shape[2]

        if mask is not None:
            m = mask.detach().float().cpu()
            if m.dim() == 2:
                m = m[None]
            if invert_mask:
                m = 1.0 - m
            if m.shape[-2:] != (H, W):
                m = F.interpolate(m[:, None], size=(H, W), mode="bilinear",
                                  align_corners=False)[:, 0]
            alpha = m.clamp(0, 1) if mask_is_soft else (m >= threshold).float()
            per_frame = alpha.shape[0]
            token_indexed = False
        else:
            assert samples is not None, \
                "wire samples (oracle mode) or mask (manual mode)"
            z = _video_component(samples)
            t_lat = z.shape[2]
            v = z.detach().float().cpu().numpy()
            jmap = np.abs(np.diff(v, n=3, axis=2)).mean(axis=(0, 1))
            tok = np.stack([jmap[min(max(k - 1, 0), jmap.shape[0] - 1)]
                            for k in range(t_lat)])
            for ph in range(5):
                m = tok[ph::5].mean()
                if m > 0:
                    tok[ph::5] /= m
            lo, hi = np.quantile(tok, 0.05), np.quantile(tok, 0.995)
            tok = np.clip((tok - lo) / (hi - lo + 1e-9), 0, 1)
            heat = torch.from_numpy(tok).float()[None]          # (1, T, h, w)
            heat = F.interpolate(heat, size=(H, W), mode="bilinear",
                                 align_corners=False)[0]        # (T, H, W)
            alpha = (heat >= threshold).float()
            per_frame = 0
            token_indexed = True

        if not (mask is not None and mask_is_soft):
            if grow:
                k = grow // 2 * 2 + 1
                alpha = F.max_pool2d(alpha[:, None], k, stride=1,
                                     padding=k // 2)[:, 0]
            alpha = _soft_edge(alpha, feather, feather_profile,
                               feather_direction)

        out = []
        for f in range(n):
            if token_indexed:
                a = alpha[min(_frame_token(f, t_lat), t_lat - 1)][..., None]
            elif per_frame == 1:
                a = alpha[0][..., None]
            else:
                idx = int(round(f * (per_frame - 1) / max(n - 1, 1)))
                a = alpha[min(idx, per_frame - 1)][..., None]
            out.append(baseline[f] * (1 - a) + regenerated[f] * a)
        return (torch.stack(out),)


class H3MotionEditor:
    """DAW-style timeline + mask editor. The JS widget (web/motion_editor.js)
    edits a serialized state; this node compiles it into a hold map, a soft
    per-frame mask, and envelope data. Agents can author the same state JSON
    directly, no GUI needed.

    editor_state contract (v1):
      {"v": 1, "blocks": [{
          "id": str, "start": int, "end": int,     # frames, inclusive
          "hold": int,                              # 0 = use oracle here
          "dials": {"feather": 48, "profile": "smoothstep",
                     "direction": "centered", "grow": 0, "fade": 6,
                     "strength": 1.0},
          "auto": {"hold": [[f,v],...], "feather": [[f,v],...],
                    "strength": [[f,v],...]},       # breakpoint envelopes
          "strokes": {"<frame>": [{"t": "brush"|"erase", "r": 0.03,
                                    "pts": [[x,y],...]}, ...]},  # normalized
          "static_strokes": [ ...same, applies to every frame of the block ]
      }, ...]}

    Mask semantics: a block with no strokes regenerates the whole frame for
    its time span; strokes narrow that to the painted problem areas. Frames
    outside every block follow outside_blocks. No blocks at all = mask is
    all ones (composite becomes a no-op passthrough of the regenerated clip)
    and the oracle hold map (if wired) passes through untouched."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-09; the classic pipeline nodes are unchanged.\n\n"
        "The Motion Lab editor node. Wire the baseline frames (and latent) "
        "in, queue once to load the filmstrip, then edit right on the node: "
        "drag time blocks on the timeline (DAW-style brackets, snapped to "
        "the model's token grid), click a block and paint problem areas "
        "frame by frame, dial feather/grow/fade per block, and draw "
        "automation envelopes for hold, feather and strength. Outputs are "
        "drop-ins: hold_map feeds H3 Time Smear, mask feeds H3 Motion "
        "Composite (enable mask_is_soft there: the mask comes out already "
        "feathered and envelope-scaled), report prices the pass before you "
        "run it. Everything upstream stays cached between edits, so "
        "re-queueing after an edit only re-runs the regeneration side.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE", {"tooltip": "baseline frames (world clock)"}),
            "editor_state": ("STRING", {"default": "", "multiline": True,
                             "tooltip": "serialized editor state; the GUI widget maintains this"}),
        }, "optional": {
            "samples": ("LATENT", {"tooltip": "baseline latent, for the jerk profile strip"}),
            "oracle_hold_map": ("STRING", {"default": "", "forceInput": True,
                                "tooltip": "wire the oracle to gate it; blocks with hold=0 use oracle holds"}),
            "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
            "ramp": ("BOOLEAN", {"default": True}),
            "bridge": ("INT", {"default": 8, "min": 0, "max": 20}),
            "invert_mask": ("BOOLEAN", {"default": False,
                            "tooltip": "flip the final mask (paint keep-baseline regions instead)"}),
            "outside_blocks": (["baseline", "regenerated"], {"default": "baseline",
                               "tooltip": "what the composite shows on frames no block covers"}),
            "paint_res": ("INT", {"default": 512, "min": 128, "max": 1024, "step": 64,
                          "tooltip": "mask compile width; the composite rescales to full res"}),
            "hold_until_edited": ("BOOLEAN", {"default": True,
                                  "tooltip": "with no blocks laid out yet, stop the graph here after the "
                                             "filmstrip is written (nothing downstream runs); lay out blocks "
                                             "and run again. Off = an empty editor passes the oracle's map through"}),
        }, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("STRING", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("hold_map", "mask", "envelopes", "report")
    OUTPUT_NODE = True
    FUNCTION = "compile"
    CATEGORY = "latent/minimax/motion"

    def _thumbs(self, images, paint_w):
        """Save filmstrip + paint-res frames to the temp dir for the widget.
        Returns the ui payload lists; empty when not running inside ComfyUI."""
        try:
            import folder_paths
            from PIL import Image
        except ImportError:
            return [], []
        import os
        import uuid
        sub = "h3_editor"
        root = os.path.join(folder_paths.get_temp_directory(), sub)
        os.makedirs(root, exist_ok=True)
        tag = uuid.uuid4().hex[:8]
        n, H, W, _ = images.shape
        pw = min(paint_w, W)
        ph = max(1, round(H * pw / W))
        sw = 96
        sh = max(1, round(H * sw / W))
        paint, strip = [], []
        arr = (images.clamp(0, 1) * 255).byte().cpu().numpy()
        for f in range(n):
            im = Image.fromarray(arr[f])
            name_p = f"{tag}_p{f:04d}.jpg"
            im.resize((pw, ph)).save(os.path.join(root, name_p), quality=88)
            paint.append({"filename": name_p, "subfolder": sub, "type": "temp"})
            name_s = f"{tag}_s{f:04d}.jpg"
            im.resize((sw, sh)).save(os.path.join(root, name_s), quality=80)
            strip.append({"filename": name_s, "subfolder": sub, "type": "temp"})
        return paint, strip

    @classmethod
    def VALIDATE_INPUTS(cls, fps=None, ramp=None, bridge=None, invert_mask=None,
                        outside_blocks=None, paint_res=None, hold_until_edited=None):
        # The frontend has been seen to submit this node's widget values shifted
        # by a slot after interactive edits (2026-08-21). The editor_state JSON
        # is the real input and is self-describing; the chrome values are
        # coerced in compile() with a warning rather than failing the prompt.
        return True

    @staticmethod
    def _coerce(name, value, default, kind, choices=None, lo=None, hi=None):
        try:
            if kind is bool:
                v = value if isinstance(value, bool) else str(value).lower() in ("true", "1", "yes")
            elif kind is int:
                v = int(float(value))
                if lo is not None and (v < lo or v > hi):
                    raise ValueError
            elif kind is str:
                v = str(value)
                if choices and v not in choices:
                    raise ValueError
            else:
                v = value
            return v
        except (TypeError, ValueError):
            print(f"[MAINodes] H3MotionEditor: {name}={value!r} is not usable (widget values shifted?); using {default!r}")
            return default

    def compile(self, images, editor_state, samples=None, oracle_hold_map="",
                fps=24, ramp=True, bridge=8, invert_mask=False,
                outside_blocks="baseline", paint_res=512, hold_until_edited=True,
                unique_id=None):
        fps = self._coerce("fps", fps, 24, int, lo=1, hi=120)
        ramp = self._coerce("ramp", ramp, True, bool)
        bridge = self._coerce("bridge", bridge, 8, int, lo=0, hi=20)
        invert_mask = self._coerce("invert_mask", invert_mask, False, bool)
        outside_blocks = self._coerce("outside_blocks", outside_blocks, "baseline", str,
                                      choices=("baseline", "regenerated"))
        paint_res = self._coerce("paint_res", paint_res, 512, int, lo=128, hi=1024)
        hold_until_edited = self._coerce("hold_until_edited", hold_until_edited, True, bool)
        import torch.nn.functional as F

        images = images.detach().float().cpu()
        n, H, W, _ = images.shape
        pw = min(paint_res, W)
        ph = max(1, round(H * pw / W))

        state = {}
        if editor_state.strip():
            state = json.loads(editor_state)
        blocks = [b for b in (state.get("blocks") or []) if not b.get("mute")]   # muted rows are kept, not compiled

        oracle = None
        if oracle_hold_map.strip():
            oracle = json.loads(oracle_hold_map)["holds"]
            assert len(oracle) == n, (
                f"oracle map covers {len(oracle)} frames, clip has {n}")

        # ---- hold map ----
        if not blocks:
            holds = list(oracle) if oracle else [1] * n
            segments = ""
            if oracle:
                _, segments, _ = _compile_hold_map(
                    np.asarray(holds, int), n, False, 0)
        else:
            frame_holds = np.ones(n, int)
            for b in blocks:
                a = max(0, int(b.get("start", 0)))
                z = min(n - 1, int(b.get("end", a)))
                base_hold = int(b.get("hold", 0))
                for f in range(a, z + 1):
                    h = _env_value(b.get("auto"), "hold", f,
                                   float(base_hold))
                    h = int(round(h))
                    if h <= 0:
                        h = oracle[f] if oracle else 4
                    frame_holds[f] = max(frame_holds[f], h)
            holds, segments, _ = _compile_hold_map(frame_holds, n, ramp, bridge)

        # ---- mask ----
        if not blocks:
            mask = torch.ones(n, ph, pw)
        else:
            outside = 0.0 if outside_blocks == "baseline" else 1.0
            mask = torch.full((n, ph, pw), outside)
            for b in blocks:
                a = max(0, int(b.get("start", 0)))
                z = min(n - 1, int(b.get("end", a)))
                dials = b.get("dials") or {}
                fade = max(0, int(dials.get("fade", 6)))
                grow = max(0, int(dials.get("grow", 0)))
                profile = dials.get("profile", "smoothstep")
                direction = dials.get("direction", "centered")
                static = b.get("static_strokes") or []
                per_frame = b.get("strokes") or {}
                base_m = (_rasterize_strokes(static, ph, pw)
                          if static else None)
                for f in range(a, z + 1):
                    fs = per_frame.get(str(f)) or []
                    if fs or static:
                        m = base_m.clone() if base_m is not None \
                            else torch.zeros(ph, pw)
                        if fs:
                            mm = _rasterize_strokes(fs, ph, pw)
                            m = torch.maximum(m, mm)
                    else:
                        m = torch.ones(ph, pw)   # bare block: whole frame
                    if grow:
                        k = grow // 2 * 2 + 1
                        m = F.max_pool2d(m[None, None], k, stride=1,
                                         padding=k // 2)[0, 0]
                    feather = int(round(_env_value(
                        b.get("auto"), "feather", f,
                        float(dials.get("feather", 48)))))
                    feather = int(feather * pw / max(W, 1))  # px are image px
                    if feather > 0:
                        m = _soft_edge(m[None], feather, profile,
                                       direction)[0]
                    strength = _env_value(b.get("auto"), "strength", f,
                                          float(dials.get("strength", 1.0)))
                    if fade:
                        edge = min(f - a + 1, z - f + 1)
                        if edge <= fade:
                            strength *= edge / (fade + 1)
                    m = m * max(0.0, min(1.0, strength))
                    mask[f] = torch.maximum(mask[f], m)
        if invert_mask:
            mask = 1.0 - mask

        # ---- report / envelopes ----
        dilated = _legal_ceil(sum(holds)) if holds else n
        t_world = (_legal_ceil(n) - 5) // 17 * 5 + 2
        t_dil = (dilated - 5) // 17 * 5 + 2
        report = (f"{n}f ({n / fps:.1f}s) -> {dilated}f ({dilated / fps:.1f}s) "
                  f"effective regen, {dilated / max(n, 1):.2f}x frames / "
                  f"{(t_dil / max(t_world, 1)) ** COST_EXP:.1f}x time per step; "
                  f"{len(blocks)} block(s)")
        if segments:
            report += f"; held segments {segments}"
        envelopes = json.dumps({
            "fps": fps, "length": n,
            "blocks": [{"id": b.get("id"), "start": b.get("start"),
                        "end": b.get("end"), "auto": b.get("auto") or {}}
                       for b in blocks]})
        hold_map = json.dumps({"holds": holds, "world_len": n})

        paint, strip = self._thumbs(images, paint_res)
        prof = []
        if samples is not None:
            prof = [round(float(v), 3)
                    for v in _jerk_profile(_video_component(samples))]
        ui = {"h3_paint": paint, "h3_strip": strip,
              "h3_profile": prof, "h3_length": [n], "h3_fps": [fps],
              "h3_report": [report],
              "h3_holds": [int(h) for h in holds]}     # the compiled clock, for the playhead views
        held = bool(hold_until_edited) and not blocks
        ui["h3_held"] = [held]
        _editor_stash(unique_id, ui)
        if held:
            # Nothing laid out yet: the filmstrip is what this run was for. Block
            # every consumer silently (no error, no pass 2); a run after blocks
            # exist goes through, and the base pass is cached by then.
            from comfy_execution.graph_utils import ExecutionBlocker
            report += "\nHELD: no blocks yet, nothing downstream ran. Lay out blocks and run again."
            print("[MAINodes] H3MotionEditor held the graph: no blocks yet (hold_until_edited)")
            return {"ui": ui, "result": (ExecutionBlocker(None), ExecutionBlocker(None),
                                         ExecutionBlocker(None), report)}
        return {"ui": ui,
                "result": (hold_map, mask, envelopes, report)}


# ---- the editor's last payload per node, for a fresh page load ----------
# Lives in the temp directory, so it has exactly ComfyUI's own cache lifetime:
# survives a page reload, dies with a server restart.
def _editor_stash_dir():
    import folder_paths
    d = os.path.join(folder_paths.get_temp_directory(), "h3_editor")
    os.makedirs(d, exist_ok=True)
    return d


def _editor_stash(unique_id, ui):
    if unique_id is None:
        return
    try:
        with open(os.path.join(_editor_stash_dir(), f"last_{unique_id}.json"), "w") as f:
            json.dump(ui, f)
    except Exception as e:                       # never let bookkeeping fail a run
        print(f"[MAINodes] editor stash skipped: {type(e).__name__}: {e}")


def _install_editor_route():
    try:
        from server import PromptServer
        from aiohttp import web
    except Exception:
        return
    srv = getattr(PromptServer, "instance", None)
    if srv is None or getattr(srv, "_h3_editor_route", False):
        return

    @srv.routes.get("/mainodes/editor/{nid}")
    async def _last(request):
        nid = "".join(ch for ch in request.match_info["nid"] if ch.isalnum() or ch in "-_")
        path = os.path.join(_editor_stash_dir(), f"last_{nid}.json")
        if not os.path.exists(path):
            return web.json_response({}, status=404)
        try:
            return web.json_response(json.load(open(path)))
        except Exception:
            return web.json_response({}, status=404)
    srv._h3_editor_route = True


_install_editor_route()


class H3SegmentCrop:
    """Cut the world down to the held window plus real-time handles, so the
    expensive regeneration pass only pays for the frames the user targeted."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-09; the classic pipeline nodes are unchanged.\n\n"
        "The compute lever for targeted de-roping: crops the clip to the "
        "hold map's held span plus handle_frames of untouched context on "
        "each side. Wire the cropped images into H3 Time Smear together "
        "with the emitted segment hold_map, and the whole regeneration "
        "chain (encode, v2v, sample, recover, audio) runs on the segment "
        "only. Cost scales with dilated token count, so a one-burst window "
        "in a long clip regenerates several times faster than the full "
        "world. splice_map goes to H3 Segment Splice for reassembly. "
        "first/last frame outputs are the handle endpoints for FLF "
        "pinning on the regeneration's conditioning if you run an FL2VA "
        "checkpoint (recommended: it anchors the seam poses).\n\n"
        "The handles are generated at hold 1 and injected at your inject "
        "value, so they come back close to the baseline; H3 Segment "
        "Splice crossfades inside them. Multiple separate bursts are "
        "covered by one window spanning first to last held frame in this "
        "version.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE", {"tooltip": "baseline frames, world clock"}),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "from the oracle, H3 Manual Hold Map, or H3 Motion Editor"}),
            "handle_frames": ("INT", {"default": 12, "min": 2, "max": 48,
                              "tooltip": "real-time context frames kept on each side of the held span"}),
        }, "optional": {
            "grid_align": ("BOOLEAN", {"default": False,
                           "tooltip": "(alpha, OFF = shipped behaviour, bit-identical) H3 Time "
                                      "Smear reaches the 17k+5 grid by extending the LAST hold, "
                                      "which parks a multi-frame freeze on the window's final "
                                      "frame (measured: hold 8, a third of a second frozen) and "
                                      "a frozen tail is where H3 invents extra beats. Handle "
                                      "frames cost exactly 1 smeared frame each, so turning this "
                                      "ON grows a hold-1 handle by the deficit instead and the "
                                      "sum lands on the grid exactly, no freeze. Changes the "
                                      "crop bounds, so it changes the render: leave it off to "
                                      "reproduce an earlier result."}),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("images", "hold_map", "splice_map", "first_frame",
                    "last_frame", "report")
    FUNCTION = "crop"
    CATEGORY = "image/minimax/motion"

    def crop(self, images, hold_map, handle_frames=12, grid_align=False):
        images = images.detach().cpu()
        holds = json.loads(hold_map)["holds"]
        n = images.shape[0]
        assert len(holds) == n, f"hold map covers {len(holds)}, clip has {n}"
        held = [i for i, h in enumerate(holds) if h > 1]
        assert held, "hold map has no held span; nothing to crop"
        a = max(0, held[0] - handle_frames)
        b = min(n - 1, held[-1] + handle_frames)
        raw = sum(_seg_holds(holds, a, b, held[0], held[-1]))
        pad = _legal_ceil(raw) - raw          # what H3TimeSmear would freeze
        if grid_align:
            a, b, pad = _grid_grow(holds, a, b, held[0], held[-1], n)
        seg = images[a:b + 1]
        seg_holds = [holds[f] if held[0] <= f <= held[-1] else 1
                     for f in range(a, b + 1)]
        seg_len = b - a + 1
        splice = json.dumps({
            "start": a, "end": b, "world_len": n,
            "handle_in": held[0] - a, "handle_out": b - held[-1]})
        dil_full = _legal_ceil(sum(holds))
        dil_seg = _legal_ceil(sum(seg_holds))
        t_full = (dil_full - 5) // 17 * 5 + 2
        t_seg = (dil_seg - 5) // 17 * 5 + 2
        report = (f"window f{a}-f{b} ({seg_len}f of {n}f); regen "
                  f"{dil_seg}f instead of {dil_full}f full-clip "
                  f"({t_seg} vs {t_full} tokens): about "
                  f"{(t_full / t_seg) ** COST_EXP:.1f}x faster per step "
                  f"(cost is superlinear in tokens, so the time saved beats "
                  f"the {t_full / t_seg:.1f}x token cut)")
        if grid_align:
            report += (f"; grid_align grew the handles to f{a}-f{b}, "
                       f"tail freeze {pad}f")
        elif pad:
            report += (f"; NOTE H3 Time Smear will reach the grid by holding "
                       f"the last frame {pad + 1}x ({pad}f of freeze); "
                       f"grid_align removes it")
        return (seg, json.dumps({"holds": seg_holds, "world_len": seg_len}),
                splice, seg[:1].clone(), seg[-1:].clone(), report)


class H3SegmentSplice:
    """Reassemble: baseline outside the window, regenerated segment inside,
    crossfaded across the handles. Audio spliced sample-accurately."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-09; the classic pipeline nodes are unchanged.\n\n"
        "Inverts H3 Segment Crop after recovery: the world is baseline "
        "outside the window and the recovered segment inside, with a "
        "video crossfade over feather_frames inside each handle zone "
        "(handles regenerate close to baseline, so the blend hides the "
        "residual tone drift). Wire segment = H3 Exact Recover's output "
        "for the segment. Audio: baseline_audio is the full clip track, "
        "segment_audio the retimed segment track from H3 Audio Recover; "
        "the splice is sample-accurate with an equal-power crossfade in "
        "the same handle zones. Omit the audio inputs to splice video "
        "only.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "baseline": ("IMAGE",),
            "segment": ("IMAGE", {"tooltip": "recovered segment, world clock"}),
            "splice_map": ("STRING", {"default": "", "forceInput": True}),
            "feather_frames": ("INT", {"default": 6, "min": 0, "max": 24,
                               "tooltip": "crossfade width inside each handle"}),
        }, "optional": {
            "baseline_audio": ("AUDIO",),
            "segment_audio": ("AUDIO",),
            "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
        }}

    RETURN_TYPES = ("IMAGE", "AUDIO")
    FUNCTION = "splice"
    CATEGORY = "image/minimax/motion"

    def splice(self, baseline, segment, splice_map, feather_frames=6,
               baseline_audio=None, segment_audio=None, fps=24):
        baseline = baseline.detach().float().cpu()
        segment = segment.detach().float().cpu()
        sp = json.loads(splice_map)
        a, b, n = sp["start"], sp["end"], sp["world_len"]
        assert baseline.shape[0] >= n, (baseline.shape[0], n)
        seg_len = b - a + 1
        assert segment.shape[0] == seg_len, (segment.shape[0], seg_len)
        fade_in = min(feather_frames, sp.get("handle_in", feather_frames))
        fade_out = min(feather_frames, sp.get("handle_out", feather_frames))

        out = baseline.clone()
        for i in range(seg_len):
            w = 1.0
            if fade_in and i < fade_in:
                w = (i + 1) / (fade_in + 1)
            j = seg_len - 1 - i
            if fade_out and j < fade_out:
                w = min(w, (j + 1) / (fade_out + 1))
            f = a + i
            out[f] = baseline[f] * (1 - w) + segment[i] * w

        audio = baseline_audio
        if baseline_audio is not None and segment_audio is not None:
            import math
            sr = baseline_audio["sample_rate"]
            bw = baseline_audio["waveform"].detach().float().cpu()
            swav = segment_audio["waveform"].detach().float().cpu()
            if segment_audio["sample_rate"] != sr:
                torchaudio = _torchaudio("resample")
                shp = swav.shape
                swav = torchaudio.functional.resample(
                    swav.reshape(-1, shp[-1]), segment_audio["sample_rate"],
                    sr).reshape(shp[0], shp[1], -1)
            y = bw.clone()
            s0 = int(round(a / fps * sr))
            s1 = min(int(round((b + 1) / fps * sr)), y.shape[-1])
            need = s1 - s0
            seg_a = swav[..., :need]
            if seg_a.shape[-1] < need:   # pad with baseline tail if short
                pad = y[..., s0 + seg_a.shape[-1]:s1]
                seg_a = torch.cat([seg_a, pad], dim=-1)
            xf = int(round(max(fade_in, fade_out) / fps * sr))
            xf = min(xf, need // 2)
            mixed = seg_a.clone()
            if xf > 0:
                t = torch.linspace(0, math.pi / 2, xf)
                up, down = torch.sin(t) ** 2, torch.cos(t) ** 2
                mixed[..., :xf] = (y[..., s0:s0 + xf] * down +
                                   seg_a[..., :xf] * up)
                mixed[..., -xf:] = (y[..., s1 - xf:s1] * up.flip(0) +
                                    seg_a[..., -xf:] * down.flip(0))
            y[..., s0:s1] = mixed
            audio = {"waveform": y.contiguous(), "sample_rate": sr}
        # 32 kHz, not 48: H3 emits 32 kHz and every other audio path in this
        # file assumes it. A downstream node that trusts a wrong rate here
        # mis-times everything after it.
        return (out, audio if audio is not None else
                {"waveform": torch.zeros(1, 2, 1), "sample_rate": 32000})


def _cut_is_cold(holds, s, handle):
    """A cut at world frame s (window k ends at s-1, window k+1 starts at s)
    is COLD when the whole handle band around it is at hold 1: both handles
    are then genuine real-time baseline context and the splice crossfade
    blends regenerated against baseline exactly as the shipped single-window
    path does. Anything else is a HOT cut, inside a burst."""
    lo = max(0, s - handle)
    hi = min(len(holds) - 1, s + handle - 1)
    return all(int(h) == 1 for h in holds[lo:hi + 1])


def _plan_windows(holds, n, budget, handle, snap, cover=False):
    """Greedy left-to-right window plan. Budget is counted in DILATED
    frames (the thing that actually sets cost and VRAM), the cut is snapped
    to the best boundary within `snap` frames of the largest feasible one,
    and cold cuts / token starts / hold plateaus are preferred in that order
    so no cut lands inside a ramp shoulder if any alternative exists.

    cover=False plans over the held span only; frames outside it pass
    through as baseline at splice time. cover=True tiles the WHOLE clip:
    calm frames cost 1 dilated frame each and cut cold by construction, and
    every frame gets the pass-2 repaint. That matters whenever the baseline
    wire is not already at target quality (the upscale recipes), where a
    passed-through frame keeps baseline resolution."""
    pre = [0] * (n + 1)
    for f in range(n):
        pre[f + 1] = pre[f] + int(holds[f])

    def hsum(x, y):                                   # inclusive, world holds
        return pre[y + 1] - pre[x] if y >= x else 0

    def span(c0, c1):
        return max(0, c0 - handle), min(n - 1, c1 + handle)

    def cost(c0, c1, hot_lo, hot_hi):
        a, b = span(c0, c1)
        lead = hsum(a, c0 - 1) if hot_lo else (c0 - a)
        trail = hsum(c1 + 1, b) if hot_hi else (b - c1)
        raw = hsum(c0, c1) + lead + trail
        return raw, _legal_ceil(raw)

    held = [i for i, h in enumerate(holds) if int(h) > 1]
    if not held and not cover:
        a, b = 0, n - 1
        raw, dil = 0 + n, _legal_ceil(n)
        return [{"k": 0, "core": (0, n - 1), "span": (a, b), "raw": n,
                 "dilated": dil, "hot_lo": False, "hot_hi": False,
                 "cut_at": None, "cut": None, "residual": dil - n}], held

    lo = 0 if cover else held[0]
    hi = n - 1 if cover else held[-1]
    budget = max(_legal_ceil(1), int(budget))         # 39 is the grid floor
    out, c0, hot_lo = [], lo, False
    while True:
        best_c1 = None
        for c1 in range(c0, hi + 1):
            last = c1 >= hi
            hot_hi = (not last) and not _cut_is_cold(holds, c1 + 1, handle)
            if cost(c0, c1, hot_lo, hot_hi)[1] <= budget:
                best_c1 = c1
        assert best_c1 is not None, (
            f"max_dilated_frames={budget} is below the smallest possible "
            f"window ({cost(c0, c0, hot_lo, False)[1]} dilated frames at "
            f"handle_frames={handle}); raise the budget or cut the handles")
        if best_c1 >= hi:
            c1, kind, hot_hi = hi, None, False
        else:
            lo = max(c0, best_c1 - int(snap))
            ranked = []
            for c in range(lo, best_c1 + 1):
                s = c + 1
                cold = _cut_is_cold(holds, s, handle)
                tok = _is_tok_start(s)
                flat = int(holds[s - 1]) == int(holds[s])   # not a ramp shoulder
                ranked.append((4 * cold + 2 * tok + flat, c, cold))
            score, c1, cold = max(ranked)
            kind, hot_hi = ("cold" if cold else "hot"), (not cold)
        a, b = span(c0, c1)
        raw, dil = cost(c0, c1, hot_lo, hot_hi)
        out.append({"k": len(out), "core": (c0, c1), "span": (a, b),
                    "raw": raw, "dilated": dil, "hot_lo": hot_lo,
                    "hot_hi": hot_hi, "cut_at": (c1 + 1) if kind else None,
                    "cut": kind, "residual": dil - raw})
        if c1 >= hi:
            break
        c0, hot_lo = c1 + 1, hot_hi
    return out, held


class H3WindowPlan:
    """Split one hold map into N windows that each fit a dilated-frame
    budget, and emit window k's crop. The requeue pair's front half."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-12; the classic pipeline nodes are unchanged.\n\n"
        "Rolling-window regeneration for cards that cannot hold the whole "
        "dilated pass. H3 Segment Crop cuts ONE window around the held span; "
        "this splits that span into as many windows as your budget needs and "
        "hands you window k. The one-click flow: queue once, read the plan "
        "report for the window count, then set the queue BATCH COUNT to that "
        "number and queue once more; the 'window' widget increments itself "
        "per batch item (its control defaults to 'increment', exactly like a "
        "seed widget). Each recovered window feeds H3 Window Collect, which "
        "reassembles once all N exist. "
        "Every window is an independent queue item, so an OOM on window 3 "
        "does not cost you windows 1 and 2.\n\n"
        "THE BUDGET IS IN DILATED FRAMES, not world frames: the dilated "
        "length is what sets both the bill and the VRAM peak. Read your "
        "single-window number off H3 Segment Crop's report and set "
        "max_dilated_frames below whatever your card survived.\n\n"
        "Coverage. 'full clip' (default) tiles windows over every frame, "
        "so calm spans are repainted too; they are cheap (1 dilated frame "
        "per frame, cold cuts by construction). 'held span' regenerates "
        "only where the hold map fires and splices into the baseline "
        "everywhere else, which is cheaper but has a trap on the upscale "
        "recipes: the passed-through frames keep BASELINE resolution, so "
        "the clip visibly goes soft the moment motion calms down. Pick "
        "'held span' only when the baseline wire is already at the same "
        "resolution as pass 2.\n\n"
        "Seam policy. A COLD cut is a boundary where the whole handle band "
        "is at hold 1: both handles are real baseline context and the splice "
        "crossfade behaves exactly as the shipped single-window path does. "
        "The plan snaps cuts to cold boundaries, then to token starts, then "
        "to hold plateaus, so a cut never lands inside a ramp shoulder if "
        "anything else is available. A HOT cut (inside a burst) is the case "
        "with real risk: the handles there inherit the world hold instead of "
        "1 so both sides are repaired at the same rate, the crossfade is "
        "turned OFF and the seam becomes a hard cut at a pinned frame "
        "(pin-and-trim: the overlap is generated as context, then thrown "
        "away by the next window overwriting it). Two independent samples of "
        "the same frames cross-faded is a dissolve, not a cut, and on audio "
        "it doubles or smears a percussive hit. Splice windows in ASCENDING "
        "k order, which H3 Window Collect does for you.\n\n"
        "The report is the price tag before anything runs: window count, "
        "each window's world span and dilated frames, and which cuts came "
        "out cold versus hot. If the report says a cut is hot, consider "
        "raising the budget, or lowering d_max on the oracle instead: "
        "de-roping a burst at 2x with no seam at all often beats a visible "
        "join in the middle of the action.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE", {"tooltip": "baseline frames, world clock"}),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "from the oracle, H3 Manual Hold Map, or H3 Motion Editor"}),
            "max_dilated_frames": ("INT", {"default": 209, "min": 39, "max": 3600,
                                   "tooltip": "budget per window in SMEARED frames (17k+5). "
                                              "209 = 17x12+5, 62 tokens"}),
            "window": ("INT", {"default": 0, "min": 0, "max": 64,
                       "control_after_generate": True,
                       "tooltip": "which window to emit this queue item; clamped to the plan. "
                                  "Leave the control on 'increment', set the queue batch "
                                  "count to the report's window count, and queue ONCE: "
                                  "each batch item renders the next window"}),
            "handle_frames": ("INT", {"default": 12, "min": 2, "max": 48,
                              "tooltip": "context frames kept each side, same meaning as H3 Segment Crop"}),
        }, "optional": {
            "coverage": (["full clip", "held span"],
                         {"default": "full clip",
                          "tooltip": "'full clip' tiles windows over EVERY frame, so calm spans "
                                     "also get the pass-2 repaint (cheap: they cost 1 dilated "
                                     "frame each and cut cold). 'held span' regenerates only "
                                     "where the hold map fires; frames outside it pass through "
                                     "as baseline. On an upscale recipe passed-through frames "
                                     "keep BASELINE resolution, which reads as the clip going "
                                     "soft the moment motion calms down"}),
            "snap_search": ("INT", {"default": 24, "min": 0, "max": 96,
                            "tooltip": "how far back from the largest feasible cut to look for a "
                                       "cold one / a token start. 0 = always cut at the budget limit"}),
            "grid_align": ("BOOLEAN", {"default": True,
                           "tooltip": "grow a hold-1 handle so sum(holds) lands on the 17k+5 grid "
                                      "exactly, instead of letting H3 Time Smear freeze the "
                                      "window's last frame. Interior seams multiply that freeze "
                                      "by N-1, so it is on by default here"}),
            **_cost_widgets(with_fps=True),
            "edge_protect": ("INT", {"default": 0, "min": 0, "max": 48,
                             "tooltip": "(alpha) frames held at 1 on EACH side of every hot cut, re-planning until every cut reads cold. A burst that ends at a window edge has no 'after' to slow into and comes back fast after recovery (measured 2026-08-23 on a chained segment: 1.55x -> 1.06x with one token group protected). 0 = off, the shipped hot-cut behaviour"}),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "IMAGE", "IMAGE", "INT",
                    "INT", "STRING")
    RETURN_NAMES = ("images", "hold_map", "splice_map", "first_frame",
                    "last_frame", "window_count", "dilated_frames", "report")
    FUNCTION = "plan"
    CATEGORY = "image/minimax/motion"

    def plan(self, images, hold_map, max_dilated_frames=209, window=0,
             handle_frames=12, coverage="full clip", snap_search=24,
             grid_align=True, fps=24, s_per_step=0.0, est_steps=18,
             overhead_s=OVERHEAD_S, edge_protect=0):
        images = images.detach().cpu()
        holds = [int(h) for h in json.loads(hold_map)["holds"]]
        n = images.shape[0]
        assert len(holds) == n, f"hold map covers {len(holds)}, clip has {n}"

        cover = coverage == "full clip"
        plan, held = _plan_windows(holds, n, max_dilated_frames,
                                   handle_frames, snap_search, cover)
        protected_cuts = []
        if edge_protect:
            # a burst that ends at a window edge comes back fast after recovery
            # (measured 2026-08-23): hold one band at 1 on each side of every
            # HOT cut and re-plan ONCE. One round only: iterating moves the
            # cuts and flattens a long burst entirely (a 90-frame burst went
            # from 9 windows to 1). Cuts still hot after the round are reported.
            hot = [x["core"][1] + 1 for x in plan if x["hot_hi"]]
            for c in hot:
                for f in range(max(0, c - int(edge_protect)), min(n, c + int(edge_protect))):
                    holds[f] = 1
                protected_cuts.append(c)
            if hot:
                plan, held = _plan_windows(holds, n, max_dilated_frames,
                                           handle_frames, snap_search, cover)
        if grid_align:
            # grow EVERY window, not just the emitted one, so the plan the
            # report states does not depend on which k you happen to be on
            for x in plan:
                xa, xb, x["residual"] = _grid_grow(
                    holds, *x["span"], *x["core"], n, x["hot_lo"], x["hot_hi"])
                x["span"] = (xa, xb)
                x["raw"] = sum(_seg_holds(holds, xa, xb, *x["core"],
                                          x["hot_lo"], x["hot_hi"]))
        k = max(0, min(int(window), len(plan) - 1))
        w = plan[k]
        c0, c1 = w["core"]
        a, b = w["span"]
        seg_holds = _seg_holds(holds, a, b, c0, c1, w["hot_lo"], w["hot_hi"])
        seg = images[a:b + 1]
        splice = json.dumps({
            "start": a, "end": b, "world_len": n,
            # pin-and-trim: a hot side gets NO crossfade. The next window
            # overwrites it, which is the hard cut at the pinned frame.
            "handle_in": 0 if w["hot_lo"] else c0 - a,
            "handle_out": 0 if w["hot_hi"] else b - c1,
            "window": k, "window_count": len(plan), "hot_in": w["hot_lo"],
            "hot_out": w["hot_hi"]})

        dil_full = _legal_ceil(sum(holds))
        tot = sum(x["dilated"] for x in plan)
        cold = sum(1 for x in plan if x["cut"] == "cold")
        hot = sum(1 for x in plan if x["cut"] == "hot")
        span_txt = (f"the FULL clip f0-f{n - 1} (held span "
                    + (f"f{held[0]}-f{held[-1]})" if held else "empty)")
                    if cover else
                    ('f%d-f%d' % (held[0], held[-1]) if held else 'NOTHING'))
        lines = [f"plan: {len(plan)} window(s) over {span_txt} "
                 f"of {n}f, budget {max_dilated_frames} dilated frames, "
                 f"handles {handle_frames}"]
        if protected_cuts:
            rep.append(f"edge_protect {int(edge_protect)}: {len(protected_cuts)} hot cut(s) at {protected_cuts} held at 1 on both sides "
                       f"({sum(1 for h in holds if h > 1)} frames still held of {n}); on a long burst cut often this removes most of the dilation, the budget is the real constraint then")
        hot_handle = 0
        for x in plan:
            sa, sb = x["span"]
            xc0, xc1 = x["core"]
            cut = (f"cut at f{x['cut_at']} {x['cut'].upper()}"
                   if x["cut"] else
                   ("runs to the clip end" if cover else "ends at the held span"))
            core_d = sum(holds[xc0:xc1 + 1])
            hot_h = ((sum(holds[sa:xc0]) if x["hot_lo"] else 0)
                     + (sum(holds[xc1 + 1:sb + 1]) if x["hot_hi"] else 0))
            hot_handle += hot_h
            sides = [s for s, on in (("in", x["hot_lo"]), ("out", x["hot_hi"])) if on]
            lines.append(
                f"  w{x['k']}: f{sa}-f{sb} ({sb - sa + 1}f, core f{xc0}-f{xc1})"
                f" -> {x['dilated']}f dilated / {_token_count(x['dilated'])} "
                f"tok; {cut}"
                + (f"; hot handle {'+'.join(sides)} at world holds, "
                   f"{hot_h}f of the {x['raw']}f" if sides else "")
                + (f"; tail freeze {x['residual']}f" if x["residual"] else ""))
        lines.append(f"  cuts: {cold} cold, {hot} hot"
                     + ("; HOT cuts sit inside a burst: no cold boundary fit "
                        "the budget. Hard cut at a pinned frame, no "
                        "crossfade. Raise max_dilated_frames or lower d_max"
                        if hot else ""))
        if hot_handle > 0.4 * sum(x["raw"] for x in plan):
            lines.append(f"  WARNING: {hot_handle}f of dilated frames, "
                         f"{hot_handle / sum(x['raw'] for x in plan):.0%} of "
                         f"the total, is hot-cut handle context that gets "
                         f"regenerated twice and then thrown away. "
                         f"handle_frames costs handle x hold at a hot cut, "
                         f"so {handle_frames} handles at hold "
                         f"{max(holds)} is {handle_frames * max(holds)}f per "
                         f"side. Fewer, larger windows (raise "
                         f"max_dilated_frames) or shorter handles is the fix")
        if not held:
            lines.append("  WARNING: the hold map holds nothing, so there is "
                         "nothing to dilate; "
                         + ("windows are a straight repaint at hold 1"
                            if cover else "one pass-through window"))
        if not cover:
            pa, pb = plan[0]["span"][0], plan[-1]["span"][1]
            gaps = [g for g in (f"f0-f{pa - 1}" if pa > 0 else "",
                                f"f{pb + 1}-f{n - 1}" if pb < n - 1 else "")
                    if g]
            if gaps:
                lines.append(
                    f"  NOTE: {' and '.join(gaps)} pass through as baseline, "
                    f"unregenerated. On an upscale recipe those frames keep "
                    f"BASELINE resolution and the clip goes soft there; set "
                    f"coverage to 'full clip' to repaint them")
        lines.append("  " + _cost_report(n, dil_full, fps, s_per_step,
                                         est_steps, overhead_s,
                                         tail="the whole clip in one pass"))
        biggest = max(x["dilated"] for x in plan)
        lines.append(f"  peak window {biggest}f vs {dil_full}f in one pass "
                     f"({(_token_count(dil_full) / _token_count(biggest)) ** COST_EXP:.1f}x "
                     f"less work per step at the peak); {tot}f of dilated "
                     f"frames generated in total, "
                     f"{tot / max(dil_full, 1):.2f}x the one-pass total "
                     f"(above 1.0 the excess is duplicated handle context; "
                     f"below 1.0 the windows are also skipping quiet frames "
                     f"the one-pass number pays for)")
        lines.append(f"  emitting window {k} of {len(plan)}: f{a}-f{b}, "
                     f"{sum(seg_holds)} smeared frames")
        return (seg, json.dumps({"holds": seg_holds, "world_len": b - a + 1}),
                splice, seg[:1].clone(), seg[-1:].clone(), len(plan),
                int(w["dilated"]), "\n".join(lines))


class H3WindowCollect:
    """The requeue pair's back half: bank window k on disk, and once all N
    windows exist, replay the chained splice into the baseline."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-12; the classic pipeline nodes are unchanged.\n\n"
        "Collects the windows H3 Window Plan hands out. Each queue item "
        "writes its recovered window (and its retimed audio) to "
        "store_dir/run_name/wNNN.pt, then checks whether all window_count "
        "windows are on disk yet. Until they are, the outputs pass the "
        "baseline through unchanged and the report says which windows are "
        "still missing. On the queue item that completes the set, the "
        "windows are spliced into the baseline in ASCENDING k order (which "
        "is what makes a hot cut a hard cut: the later window overwrites the "
        "earlier one's discarded overlap) and the finished clip comes out.\n\n"
        "The ComfyUI queue is the loop driver, which is the whole point: "
        "every window is an independent queue item, so an OOM or a bad seam "
        "on window 3 costs you window 3 and nothing else. Requeue that one "
        "window with a different seed and the collect picks up the new file. "
        "Set write=false to reassemble from disk without re-banking.\n\n"
        "run_name keys the set. Change it whenever you change the plan: "
        "windows from two different budgets do not tile the same world and "
        "the collect cannot tell them apart.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "baseline": ("IMAGE", {"tooltip": "the full world clip, world clock"}),
            "segment": ("IMAGE", {"tooltip": "this window, recovered (H3 Exact Recover)"}),
            "splice_map": ("STRING", {"default": "", "forceInput": True,
                           "tooltip": "from H3 Window Plan, same queue item"}),
            "window_count": ("INT", {"default": 0, "min": 0, "max": 64,
                             "tooltip": "wire H3 Window Plan's window_count output; typed by "
                                        "hand it is the N this run is waiting for"}),
            "run_name": ("STRING", {"default": "window_run",
                         "tooltip": "keys the set on disk; change it when the plan changes"}),
            "feather_frames": ("INT", {"default": 6, "min": 0, "max": 24,
                               "tooltip": "crossfade width inside COLD handles; hot seams ignore it"}),
        }, "optional": {
            "store_dir": ("STRING", {"default": "output/h3_windows",
                          "tooltip": "where windows are banked between queue items. A relative "
                                     "path lands inside the ComfyUI working directory. Avoid "
                                     "/tmp: it is a RAM disk on most Linux installs, and the "
                                     "whole point of banking windows is surviving a crash or "
                                     "reboot"}),
            "baseline_audio": ("AUDIO",),
            "segment_audio": ("AUDIO", {"tooltip": "this window's track from H3 Audio Recover"}),
            "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
            "write": ("BOOLEAN", {"default": True,
                      "tooltip": "off: reassemble from what is already on disk, bank nothing"}),
            "store_dtype": (["float32 (exact)", "float16 (half the disk)"],
                            {"default": "float32 (exact)",
                             "tooltip": "float16 costs ~1/2048 of a level, below 8-bit output "
                                        "quantization, and halves a multi-hundred-MB window"}),
        }}

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "BOOLEAN", "STRING")
    RETURN_NAMES = ("images", "audio", "windows_on_disk", "complete", "report")
    FUNCTION = "collect"
    CATEGORY = "image/minimax/motion"

    def collect(self, baseline, segment, splice_map, window_count, run_name,
                feather_frames=6, store_dir="/tmp/h3_windows",
                baseline_audio=None, segment_audio=None, fps=24, write=True,
                store_dtype="float32 (exact)"):
        import glob
        import os

        baseline = baseline.detach().float().cpu()
        sp = json.loads(splice_map)
        k = int(sp.get("window", 0))
        n_win = max(int(window_count), k + 1)
        root = os.path.join(store_dir, run_name)
        os.makedirs(root, exist_ok=True)
        path = os.path.join(root, f"w{k:03d}.pt")

        if write:
            seg = segment.detach().cpu()
            if store_dtype.startswith("float16"):
                seg = seg.to(torch.float16)
            aud = None
            if segment_audio is not None:
                aud = {"waveform": segment_audio["waveform"].detach().cpu(),
                       "sample_rate": int(segment_audio["sample_rate"])}
            torch.save({"segment": seg, "splice_map": splice_map,
                        "audio": aud}, path)

        banked = {}
        for p in sorted(glob.glob(os.path.join(root, "w*.pt"))):
            i = int(os.path.basename(p)[1:4])
            banked[i] = p
        have = sorted(banked)
        missing = [i for i in range(n_win) if i not in banked]

        lines = [f"run '{run_name}': {len(have)} of {n_win} windows banked in "
                 f"{root}"]
        mb = 0.0
        for i in have:
            d = torch.load(banked[i], weights_only=False)
            s = json.loads(d["splice_map"])
            mb += os.path.getsize(banked[i]) / 1e6
            kind = ("hot" if s.get("hot_in") else "cold") + " in / " + \
                   ("hot" if s.get("hot_out") else "cold") + " out"
            lines.append(f"  w{i}: f{s['start']}-f{s['end']} "
                         f"({d['segment'].shape[0]}f, {kind})"
                         + ("" if d.get("audio") else ", video only"))
        lines.append(f"  {mb:.0f} MB on disk")

        if missing:
            lines.append(f"  waiting on window(s) "
                         f"{', '.join(str(i) for i in missing)}: set "
                         f"H3 Window Plan's 'window' to the next one and "
                         f"queue again. Baseline passed through unchanged")
            audio = baseline_audio if baseline_audio is not None else \
                {"waveform": torch.zeros(1, 2, 1), "sample_rate": 32000}
            return (baseline, audio, len(have), False, "\n".join(lines))

        splicer = H3SegmentSplice()
        out, audio = baseline, baseline_audio
        for i in range(n_win):
            d = torch.load(banked[i], weights_only=False)
            seg = d["segment"].float()
            if baseline_audio is not None and d.get("audio") is not None:
                out, audio = splicer.splice(out, seg, d["splice_map"],
                                            feather_frames, audio,
                                            d["audio"], fps)
            else:
                out, _ = splicer.splice(out, seg, d["splice_map"],
                                        feather_frames, None, None, fps)
        lines.append(f"  COMPLETE: {n_win} windows spliced into the baseline "
                     f"in ascending order"
                     + ("" if baseline_audio is not None else
                        "; video only, no baseline_audio wired"))
        if audio is None:
            audio = {"waveform": torch.zeros(1, 2, 1), "sample_rate": 32000}
        return (out, audio, len(have), True, "\n".join(lines))


def _cond_to_cpu(obj):
    """Deep copy a CONDITIONING onto the CPU, tensors detached.

    CONDITIONING is a list of [tensor, dict]; the dict can nest lists and
    dicts (H3 puts its keyframe/reference condition latents there). Anything
    that is not a tensor or a plain container is returned as-is, and the
    caller checks picklability before it writes.
    """
    if isinstance(obj, torch.Tensor):
        return obj.detach().to("cpu").clone()
    if isinstance(obj, dict):
        return {k: _cond_to_cpu(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        out = [_cond_to_cpu(v) for v in obj]
        return tuple(out) if isinstance(obj, tuple) else out
    return obj


def _cond_shape_report(cond):
    """One line per conditioning entry: the tensor shapes that matter."""
    lines = []
    for i, c in enumerate(cond):
        t = c[0]
        extra = []
        for k, v in sorted(c[1].items()):
            if isinstance(v, torch.Tensor):
                extra.append(f"{k}{tuple(v.shape)}")
            elif isinstance(v, (list, tuple)):
                extra.append(f"{k}[{len(v)}]")
        lines.append(f"  cond[{i}]: "
                     + (f"{tuple(t.shape)} {t.dtype}" if isinstance(t, torch.Tensor)
                        else type(t).__name__)
                     + (", " + ", ".join(extra) if extra else ""))
    return lines


class H3ConditioningBank:
    """Bank one encoded CONDITIONING to disk and serve it back without the
    text encoder. The `conditioning` input is LAZY, so on a bank hit the
    encode node (and the CLIP loader behind it) never executes."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-14.\n\n"
        "Caches an encoded prompt on disk so a queue item can reuse it "
        "without loading the text encoder. Wire it between the encode node "
        "(MiniMax H3 Image to Video / Reference to Video) and the guider. "
        "The first item encodes and banks; every later item that asks for "
        "the same bank_key reads the tensors off disk, and because the "
        "conditioning input is LAZY the encode node and its CLIP loader are "
        "not executed at all. On this stack the H3 text encoder is a ~15 GB "
        "resident model (21.2 GB peak measured on the 16 GB-simulated card), "
        "which is the largest single thing a small card has to make room "
        "for, and it has nothing to do with what you are generating.\n\n"
        "WHAT THIS DOES AND DOES NOT FIX. Inside one ComfyUI process, "
        "requeueing the SAME graph with only a downstream widget changed "
        "(the rolling-window flow: H3 Window Plan's 'window') already hits "
        "ComfyUI's own node cache, so the prompt is not re-encoded and this "
        "node changes nothing. What flushes that cache is everything else: "
        "queueing a different workflow in between (the default cache keeps "
        "only what the CURRENT prompt uses), restarting ComfyUI, or editing "
        "anything upstream of the encode. The bank survives all three, and "
        "it is shared across graphs: a window run, a seed hunt and an "
        "extension chain on one prompt encode once between them.\n\n"
        "STALENESS is the price. The key is yours to manage: wire the same "
        "STRING that feeds the encode node into 'prompt' and its hash "
        "joins the filename, so editing the prompt misses the bank and "
        "re-encodes instead of silently serving the old take. Nothing else "
        "is fingerprinted - change the reference image, the canvas or the "
        "clip length and you must change bank_key or set mode to refresh. "
        "Conditioning is banked on the CPU and the model moves it to the "
        "GPU itself, so a bank written under one VRAM mode loads under any "
        "other.")

    MODES = ["use bank if present (default)", "refresh (re-encode, overwrite)"]

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "conditioning": ("CONDITIONING", {"lazy": True,
                             "tooltip": "from the encode node; on a bank hit this link is "
                                        "never evaluated, so the text encoder never loads"}),
            "bank_key": ("STRING", {"default": "run",
                         "tooltip": "names the bank. One key per (prompt, reference, canvas, "
                                    "length): nothing but the prompt is fingerprinted for you"}),
            "store_dir": ("STRING", {"default": "output/h3_conditioning",
                          "tooltip": "a relative path lands inside the ComfyUI working "
                                     "directory. Avoid /tmp: it is a RAM disk on most Linux "
                                     "installs and the bank is meant to survive a reboot"}),
            "mode": (cls.MODES, {"default": cls.MODES[0]}),
        }, "optional": {
            "prompt": ("STRING", {"forceInput": True, "multiline": True,
                       "tooltip": "wire the same text that feeds the encode node; its hash "
                                  "joins the filename so an edited prompt cannot be served "
                                  "a stale bank"}),
        }}

    RETURN_TYPES = ("CONDITIONING", "STRING")
    RETURN_NAMES = ("conditioning", "report")
    FUNCTION = "bank"
    CATEGORY = "conditioning/minimax"

    # ---- keying -----------------------------------------------------------

    @staticmethod
    def _path(store_dir, bank_key, prompt):
        import hashlib
        import os
        import re
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", str(bank_key)) or "run"
        if prompt is not None:
            h = hashlib.sha1(str(prompt).encode("utf-8")).hexdigest()[:8]
            safe = f"{safe}__{h}"
        return os.path.join(store_dir, f"{safe}.cond.pt")

    # ---- lazy gate: this is the whole point of the node --------------------

    def check_lazy_status(self, bank_key, store_dir, mode,
                          conditioning=None, prompt=None):
        """Ask for the conditioning input ONLY when the bank cannot serve it.

        Returning an empty list tells ComfyUI everything needed is present,
        and the executor then never stages the encode node (execution.py
        make_input_strong_link is only called for the names returned here).
        """
        import os
        if conditioning is not None:
            return []
        if mode.startswith("refresh"):
            return ["conditioning"]
        p = self._path(store_dir, bank_key, prompt)
        try:
            ok = os.path.getsize(p) > 0
        except OSError:
            ok = False
        return [] if ok else ["conditioning"]

    # ---- run --------------------------------------------------------------

    def bank(self, conditioning=None, bank_key="run",
             store_dir="output/h3_conditioning", mode=MODES[0], prompt=None):
        import os
        path = self._path(store_dir, bank_key, prompt)

        if conditioning is None:                  # bank hit: TE never loaded
            payload = torch.load(path, map_location="cpu", weights_only=False)
            cond = payload["conditioning"]
            mb = os.path.getsize(path) / 1e6
            lines = [f"bank HIT: {path} ({mb:.1f} MB), text encoder not "
                     f"loaded for this item"]
            lines += _cond_shape_report(cond)
            if payload.get("prompt_head"):
                lines.append(f"  banked from prompt: {payload['prompt_head']}")
            return (cond, "\n".join(lines))

        # miss (or refresh): the encode ran, so bank it for the next item
        lines = [("bank REFRESH: re-encoded and overwriting "
                  if mode.startswith("refresh") else "bank MISS: encoded and "
                  "writing ") + path]
        lines += _cond_shape_report(conditioning)
        try:
            os.makedirs(store_dir or ".", exist_ok=True)
            tmp = path + ".tmp"
            torch.save({"conditioning": _cond_to_cpu(conditioning),
                        "prompt_head": (str(prompt)[:120] if prompt else ""),
                        "format": 1}, tmp)
            os.replace(tmp, path)                 # atomic: no half-written bank
            lines.append(f"  {os.path.getsize(path) / 1e6:.1f} MB banked; the "
                         f"next queue item on this key skips the text encoder")
        except Exception as e:                    # a cache must never kill a run
            lines.append(f"  NOT BANKED ({type(e).__name__}: {e}); the "
                         f"conditioning passes through unchanged and every "
                         f"item will keep re-encoding")
        return (conditioning, "\n".join(lines))


def _latent_pack(latent):
    """A LATENT as plain, storable objects.

    H3's `samples` is a comfy NestedTensor (video + audio), not a tensor, so
    it is stored as its member tensors and rebuilt on load. Storing the class
    itself would tie every bank file to comfy's current class layout.
    """
    out = {}
    for k, v in latent.items():
        if getattr(v, "is_nested", False) and hasattr(v, "unbind"):
            out[k] = {"__nested__": [t.detach().to("cpu").clone()
                                     for t in v.unbind()]}
        else:
            out[k] = _cond_to_cpu(v)
    return out


def _latent_unpack(payload):
    out = {}
    for k, v in payload.items():
        if isinstance(v, dict) and "__nested__" in v:
            from comfy.nested_tensor import NestedTensor
            out[k] = NestedTensor(tuple(v["__nested__"]))
        else:
            out[k] = v
    return out


def _latent_shape_report(latent):
    lines = []
    for k, v in sorted(latent.items()):
        if getattr(v, "is_nested", False) and hasattr(v, "unbind"):
            parts = [f"{tuple(t.shape)} {t.dtype}" for t in v.unbind()]
            lines.append(f"  {k}: nested[{len(parts)}] " + " + ".join(parts))
        elif isinstance(v, dict) and "__nested__" in v:
            parts = [f"{tuple(t.shape)} {t.dtype}" for t in v["__nested__"]]
            lines.append(f"  {k}: nested[{len(parts)}] " + " + ".join(parts))
        elif isinstance(v, torch.Tensor):
            lines.append(f"  {k}: {tuple(v.shape)} {v.dtype}")
    return lines


class H3LatentBank:
    """Bank a sampled LATENT to disk and serve it back without sampling.

    The sibling of H3 Conditioning Bank, same shape and same honesty: the
    `samples` input is LAZY, so on a hit the sampler upstream is never
    staged."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-14.\n\n"
        "Caches a sampled latent on disk so a later queue item reuses the "
        "pass instead of re-running it. The intended seat is straight after "
        "the PASS 1 sampler in the rolling-window graphs, where every "
        "consumer of that pass (VAE Decode, VAE Decode Audio, and H3 Jerk "
        "Oracle, which reads the latent directly) is downstream of this one "
        "node. Its `samples` input is LAZY: on a bank hit ComfyUI never "
        "stages the sampler, so the sigmas, the noise, the guider and the "
        "pass-1 text encode are not executed either. What is skipped is the "
        "SAMPLING. Everything downstream of the bank still runs on a hit: "
        "the VAE decodes and the oracle read the banked latent and do their "
        "work again, which is seconds against the pass they replace.\n\n"
        "WHY IT EXISTS. Requeueing an unchanged graph already hits ComfyUI's "
        "node cache, so a plain window requeue re-samples nothing. But the "
        "cache is dropped whenever another workflow is queued in between, "
        "whenever ComfyUI restarts, and whenever anything upstream is "
        "edited, and then window item 2 re-renders the whole baseline pass "
        "before it can start its own window. Latents are small: the H3 AV "
        "latent of a 107-frame 480x832 clip is 4.8 MB (24x32x52x30 video "
        "plus 32x2x178 audio, float32), against 513 MB for the same clip "
        "decoded to float32 frames. Bank the latent, not the frames.\n\n"
        "STALENESS is the contract, and it is on you. The filename is "
        "bank_key plus a hash of exactly two optional inputs: `seed` and "
        "`fingerprint`. Wire the sampler's noise seed into `seed`, and put "
        "anything else that decides the pass into `fingerprint` (a string "
        "you build: steps, scheduler, LoRA strength, resolution, prompt). "
        "NOTHING is fingerprinted for you beyond those two. Change a dial "
        "the key does not cover and you must change bank_key or set mode to "
        "refresh, or you will silently ship the old take. Latents are "
        "stored on the CPU and are float32 by default; float16 halves the "
        "file and is below the noise of a VAE decode, but it is not "
        "bit-identical, so keep float32 while you are comparing takes.")

    MODES = ["use bank if present (default)", "refresh (re-sample, overwrite)"]

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "samples": ("LATENT", {"lazy": True,
                        "tooltip": "from the sampler; on a bank hit this link is never "
                                   "evaluated, so the sampler does not run"}),
            "bank_key": ("STRING", {"default": "pass1",
                         "tooltip": "names the bank. One key per pass you want to keep"}),
            "store_dir": ("STRING", {"default": "output/h3_latent_bank",
                          "tooltip": "a relative path lands inside the ComfyUI working "
                                     "directory. Avoid /tmp: it is a RAM disk on most "
                                     "Linux installs and the bank is meant to survive a "
                                     "reboot"}),
            "mode": (cls.MODES, {"default": cls.MODES[0]}),
        }, "optional": {
            "seed": ("INT", {"forceInput": True, "min": 0, "max": 0xffffffffffffffff,
                     "tooltip": "wire the sampler's noise seed; it joins the filename, so a "
                                "new seed misses the bank instead of being served the old take"}),
            "fingerprint": ("STRING", {"forceInput": True, "multiline": True,
                            "tooltip": "anything else that decides this pass, as a string. "
                                       "Nothing is hashed for you except this and 'seed'"}),
            "store_dtype": (["float32 (exact)", "float16 (half the file)"],
                            {"default": "float32 (exact)"}),
        }}

    RETURN_TYPES = ("LATENT", "STRING")
    RETURN_NAMES = ("samples", "report")
    FUNCTION = "bank"
    CATEGORY = "latent/minimax"

    @staticmethod
    def _path(store_dir, bank_key, seed, fingerprint):
        import hashlib
        import os
        import re
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", str(bank_key)) or "pass1"
        if seed is not None or fingerprint is not None:
            key = f"{seed}|{fingerprint}".encode("utf-8")
            safe = f"{safe}__{hashlib.sha1(key).hexdigest()[:8]}"
        return os.path.join(store_dir, f"{safe}.latent.pt")

    def check_lazy_status(self, bank_key, store_dir, mode, samples=None,
                          seed=None, fingerprint=None, store_dtype=None):
        """Ask for the sampler's output ONLY when the bank cannot serve it."""
        import os
        if samples is not None:
            return []
        if mode.startswith("refresh"):
            return ["samples"]
        p = self._path(store_dir, bank_key, seed, fingerprint)
        try:
            ok = os.path.getsize(p) > 0
        except OSError:
            ok = False
        return [] if ok else ["samples"]

    def bank(self, samples=None, bank_key="pass1",
             store_dir="output/h3_latent_bank", mode=MODES[0], seed=None,
             fingerprint=None, store_dtype="float32 (exact)"):
        import os
        path = self._path(store_dir, bank_key, seed, fingerprint)

        if samples is None:                       # hit: the sampler never ran
            payload = torch.load(path, map_location="cpu", weights_only=False)
            latent = _latent_unpack(payload["latent"])
            lines = [f"bank HIT: {path} "
                     f"({os.path.getsize(path) / 1e6:.1f} MB), the sampler "
                     f"upstream was not executed"]
            lines += _latent_shape_report(latent)
            return (latent, "\n".join(lines))

        lines = [("bank REFRESH: re-sampled and overwriting "
                  if mode.startswith("refresh") else
                  "bank MISS: sampled and writing ") + path]
        lines += _latent_shape_report(samples)
        try:
            packed = _latent_pack(samples)
            if store_dtype.startswith("float16"):
                packed = _cond_to_half(packed)
            os.makedirs(store_dir or ".", exist_ok=True)
            tmp = path + ".tmp"
            torch.save({"latent": packed, "format": 1,
                        "seed": seed, "fingerprint": fingerprint}, tmp)
            os.replace(tmp, path)                 # atomic: no half-written bank
            lines.append(f"  {os.path.getsize(path) / 1e6:.1f} MB banked; the "
                         f"next queue item on this key skips the pass")
        except Exception as e:                    # a cache must never kill a run
            lines.append(f"  NOT BANKED ({type(e).__name__}: {e}); the latent "
                         f"passes through unchanged and every item will keep "
                         f"re-sampling")
        return (samples, "\n".join(lines))


def _cond_to_half(obj):
    """float32 -> float16 for storage only; integer tensors are left alone."""
    if isinstance(obj, torch.Tensor):
        return obj.to(torch.float16) if obj.dtype == torch.float32 else obj
    if isinstance(obj, dict):
        return {k: _cond_to_half(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        out = [_cond_to_half(v) for v in obj]
        return tuple(out) if isinstance(obj, tuple) else out
    return obj


class _AnyType(str):
    def __ne__(self, other):
        return False


ANY = _AnyType("*")


class H3ModeSwitch:
    """Lazy two-way switch: only the selected branch executes."""

    DESCRIPTION = (
        "Routes one of two inputs through, and only the selected branch "
        "executes (lazy evaluation), so a single workflow can carry both a "
        "fast turbo preview path and the full pipeline with a mode dropdown "
        "deciding which one actually runs. Wire any matching pair: VIDEO to "
        "VIDEO, IMAGE to IMAGE. Recommended use: mode 'preview' while "
        "iterating prompts and seeds, 'final' for the keeper.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "mode": (["preview", "final"], {"default": "preview"}),
        }, "optional": {
            "preview": (ANY, {"lazy": True}),
            "final": (ANY, {"lazy": True}),
        }}

    RETURN_TYPES = (ANY,)
    FUNCTION = "pick"
    CATEGORY = "utils/minimax"

    def check_lazy_status(self, mode, preview=None, final=None):
        return ["preview"] if mode == "preview" else ["final"]

    def pick(self, mode, preview=None, final=None):
        out = preview if mode == "preview" else final
        assert out is not None, f"selected branch '{mode}' is not wired"
        return (out,)


TIMESMEAR_CLASS_MAPPINGS = {
    "H3VideoFit": H3VideoFit,
    "H3JerkOracle": H3JerkOracle,
    "H3IndecisionOracle": H3IndecisionOracle,
    "H3ManualHoldMap": H3ManualHoldMap,
    "H3TimeSmear": H3TimeSmear,
    "H3ExactRecover": H3ExactRecover,
    "H3TrueClock": H3TrueClock,
    "H3DyRoPE": H3DyRoPE,
    "H3V2VInit": H3V2VInit,
    "H3TemporalInsert": H3TemporalInsert,
    "H3AddLatentGuide": H3AddLatentGuide,
    "H3MidInsert": H3MidInsert,
    "H3LatentUpscale": H3LatentUpscale,
    "H3InjectSchedule": H3InjectSchedule,
    "H3JerkHeatmap": H3JerkHeatmap,
    "H3AudioRecover": H3AudioRecover,
    "H3AudioSmear": H3AudioSmear,
    "H3ProbeSchedule": H3ProbeSchedule,
    "H3ExpertSchedule": H3ExpertSchedule,
    "H3TrajectoryBank": H3TrajectoryBank,
    "H3TrajectoryLoad": H3TrajectoryLoad,
    "H3MotionComposite": H3MotionComposite,
    "H3ModeSwitch": H3ModeSwitch,
    "H3MotionEditor": H3MotionEditor,
    "H3SegmentCrop": H3SegmentCrop,
    "H3SegmentSplice": H3SegmentSplice,
    "H3WindowPlan": H3WindowPlan,
    "H3WindowCollect": H3WindowCollect,
    "H3ConditioningBank": H3ConditioningBank,
    "H3LatentBank": H3LatentBank,
}
TIMESMEAR_DISPLAY_MAPPINGS = {
    "H3VideoFit": "H3 Video Fit (source clip -> 17k+5 frames) [alpha]",
    "H3JerkOracle": "H3 Jerk Oracle (profile / window / hold map)",
    "H3IndecisionOracle": "H3 Indecision Oracle (x0-jitter / blend) [experimental]",
    "H3ManualHoldMap": "H3 Manual Hold Map (ranges to holds, gate) [alpha]",
    "H3TimeSmear": "H3 Time Smear (integer holds)",
    "H3ExactRecover": "H3 Exact Recover (24fps frame selection)",
    "H3TrueClock": "H3 True Clock (density-corrected RoPE t-grid) [experimental]",
    "H3DyRoPE": "H3 DyRoPE (layer-wise / sigma-faded time geometry) [experimental]",
    "H3V2VInit": "H3 V2V Init (nested AV latent)",
    "H3TemporalInsert": "H3 Temporal Insert (insert token-times, freeze originals) [experimental]",
    "H3AddLatentGuide": "H3 Add Latent Guide (aligned latent rows) [experimental]",
    "H3MidInsert": "H3 Mid Insert (change the token grid MID-denoise) [experimental]",
    "H3LatentUpscale": "H3 Latent Upscale (video only, audio kept) [experimental]",
    "H3InjectSchedule": "H3 Inject Schedule (v2v sigmas, 0.70)",
    "H3JerkHeatmap": "H3 Jerk Heatmap (oracle overlay tile)",
    "H3AudioRecover": "H3 Audio Recover (hold-map atempo, pitch kept)",
    "H3AudioSmear": "H3 Audio Smear (hold-map stretch, pitch kept) [alpha]",
    "H3ProbeSchedule": "H3 Probe Schedule (early-oracle head)",
    "H3ExpertSchedule": "H3 Expert Schedule (base head, turbo tail)",
    "H3TrajectoryBank": "H3 Trajectory Bank (checkpoint every step)",
    "H3TrajectoryLoad": "H3 Trajectory Load (branch from a step)",
    "H3MotionComposite": "H3 Motion Composite (subject regen, background baseline)",
    "H3ModeSwitch": "H3 Mode Switch (preview / final, lazy)",
    "H3MotionEditor": "H3 Motion Editor (timeline, masks, automation) [alpha]",
    "H3SegmentCrop": "H3 Segment Crop (regen only the window) [alpha]",
    "H3SegmentSplice": "H3 Segment Splice (crossfade reassembly) [alpha]",
    "H3WindowPlan": "H3 Window Plan (split the pass into N windows) [alpha]",
    "H3WindowCollect": "H3 Window Collect (bank windows, splice when full) [alpha]",
    "H3ConditioningBank": "H3 Conditioning Bank (encode once, no TE per item) [alpha]",
    "H3LatentBank": "H3 Latent Bank (sample once, skip the pass) [alpha]",
}
