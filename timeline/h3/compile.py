"""H3Backend: a semantic plan -> a legal MiniMax-H3 ComfyUI graph.

This file is gloriously H3-specific and that is the point. All grid law
(17n+5, adds-a-multiple-of-17, expand-to-end semantics, the under-39 pad),
window placement, guide placement and hold-map dithering live here, behind
the four-method backend seam. Nothing above timeline/h3/ knows any of it.

v0 compiles the GENERATION-DENSITY lane onto the v3.1 windowed recipe, the graph
minted as t2c_w45e_v001.api.json:

    source clip -> H3VideoFit -> [head frames untouched]
                              -> [window crop] -> VAEEncode
                              -> H3TemporalInsert (the compiled hold map)
                              -> SamplerCustomAdvanced at inject
                              -> VAEDecode -> H3ExactRecover -> splice

COMPILER VERSION is part of the compiled section's identity: bump it
whenever the emitted graph changes for an unchanged plan.
"""
import copy
import hashlib
import json
import os

from .. import price, schema
from ..backend import CompileResult, VideoModelBackend
from . import gridlaw as G
from .recipe import PROFILE
from .spec import SPEC

COMPILER_VERSION = "h3-compile-0.3"   # 0.3: no identity TimeSmear pass; a
                                      # too-short window widens instead of
                                      # padding the output (0.2: artifact/
                                      # receipt split, density rename)

EPS = 1e-6


def _graph_hash(graph):
    """Content hash of the minted graph, so the artifact can assert the
    execution without carrying a machine path to it."""
    return hashlib.sha256(json.dumps(graph, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


# ------------------------------------------------------------ hold maps

def quantize_to_tokens(ratios):
    """Envelopes quantize to LATENT frames (spec): a ratio is constant
    across a latent token's frames, because that is the granularity the
    model's time axis actually has. MEAN over the token's covered frames —
    the honest average of what the user drew, not the max (which would
    silently overprice a ramp)."""
    n = len(ratios)
    t_lat = 0
    while G.tok_start_frame(t_lat) < n:
        t_lat += 1
    out = list(ratios)
    for t in range(t_lat):
        a = G.tok_start_frame(t)
        b = min(G.tok_start_frame(t + 1), n)
        if b > a:
            m = sum(ratios[a:b]) / float(b - a)
            for f in range(a, b):
                out[f] = m
    return out


def dither_holds(ratios, target):
    """Integer per-frame holds that hit the drawn AVERAGE.

    Holds are integers per world frame, so a drawn 2.5x can only be met in
    aggregate: this spends the `target - n` extra frames along the curve by
    error diffusion (cumulative rounding), which puts them where the ratio
    is high and reproduces mixed rates exactly — a flat 2.5x comes out as
    alternating 3,2,3,2 (mean 2.5), not as 2s with a lump of 3s at one end.

    Deterministic: int(cum + 0.5), never banker's rounding.
    """
    n = len(ratios)
    extra = int(target) - n
    assert extra >= 0, f"target {target} below the world length {n}"
    weight = [max(0.0, float(r) - 1.0) for r in ratios]
    total = sum(weight)
    if total <= EPS:                     # flat 1.0 curve: spread the grid pad
        weight = [1.0] * n
        total = float(n)
    holds = [1] * n
    cum, prev = 0.0, 0
    for i in range(n):
        cum += weight[i] / total * extra
        k = int(cum + 0.5)
        holds[i] += k - prev
        prev = k
    holds[-1] += extra - prev            # any 1-frame rounding residue
    assert sum(holds) == target and min(holds) >= 1
    return holds


def place_window(support_lo, support_hi, frames, min_len=None):
    """Window placement from the envelope's support. -> (start, len, widened).

    Rules, all H3's: the window START sits on a 17-multiple (T2a rule 1 —
    hold spans that start on a native anchor recover exactly), the window
    LENGTH is on the 17k+5 grid, and the window must fit inside the clip.
    Falls back to the whole clip when the support cannot be bracketed.

    THE MINIMUM GENERATION LENGTH (2026-08-15, minted from a render). A
    window shorter than the model's minimum legal generation length is a
    trap: the pixel path pads it back up on its way through, and the splice
    around it then hands back a clip LONGER than the plan asked for. The
    answer is to widen the REGENERATED REGION, symmetrically for v0, by
    absorbing neighbouring source frames until it reaches that minimum — the
    region grows, the output length does not change. The alternatives were
    both rejected: flooring the output pads the timeline (measured: a
    22-frame window rendered 141 frames for a 124-frame plan), and
    generate-then-trim moves the tail splice out from under the last-frame
    guide. min_len comes from the MODEL SPEC, never a literal.

    `widened` is None when nothing was absorbed, else a dict naming how many
    source frames each side the region grew by, for the report.
    """
    min_len = int(SPEC.min_generation_length if min_len is None else min_len)
    if support_lo is None:
        w0 = 0
        wlen = frames if G.is_legal(frames) else G.grid_floor(frames)
        return w0, max(wlen, 5), None
    w0 = (support_lo // G.LEGAL_STEP) * G.LEGAL_STEP
    while True:
        wlen = G.grid_ceil(support_hi - w0 + 1)
        if w0 + wlen <= frames:
            break
        if w0 >= G.LEGAL_STEP:
            w0 -= G.LEGAL_STEP           # slide the window earlier and retry
            continue
        w0 = 0
        wlen = frames if G.is_legal(frames) else G.grid_floor(frames)
        return w0, max(wlen, 5), None
    if wlen >= min_len:
        return w0, wlen, None
    return _widen_to_min(w0, wlen, support_lo, support_hi, frames, min_len)


def _widen_to_min(w0, wlen, support_lo, support_hi, frames, min_len):
    """Grow a too-short window to the minimum generation length, centred on
    the drawn burst as closely as the 17-phase allows.

    The absorbed edges are SOURCE frames the user did not ask to change; they
    are regenerated at density 1.0, which is what a windowed render already
    does either side of a burst. Symmetry is an AIM, not a promise: the
    window start has to sit on a 17-multiple, so with only one group to
    spend the burst can land off-centre by up to 17 frames. Hard constraints
    beat the aim in this order: the burst stays inside the region, the region
    stays inside the clip, the start stays on the phase.

    If the clip itself cannot hold a minimum-length region, the whole clip
    becomes the region and H3Backend.validate is what refuses a clip that
    short.
    """
    target = G.grid_ceil(min_len)
    if target > frames:
        wlen2 = max(frames if G.is_legal(frames) else G.grid_floor(frames), 5)
        return 0, wlen2, {"from_len": wlen, "to_len": wlen2, "before": w0,
                          "after": max(0, wlen2 - wlen - w0),
                          "min_len": min_len, "clip_limited": True}
    mid = (support_lo + support_hi) / 2.0
    ideal = mid - target / 2.0                    # centred on the burst
    lo = 0
    hi = min(support_lo, frames - target)         # burst in, region in clip
    start = int(round(ideal / G.LEGAL_STEP)) * G.LEGAL_STEP
    start = max(lo, min(start, (hi // G.LEGAL_STEP) * G.LEGAL_STEP))
    return start, target, {"from_len": wlen, "to_len": target,
                           "before": max(0, w0 - start),
                           "after": max(0, (start + target) - (w0 + wlen)),
                           "min_len": min_len, "clip_limited": False}


def compile_temporal(ratios, frames, expand_to_end=True):
    """The whole temporal compile, separated from graph emission so tests
    and the price meter can call it without touching ComfyUI.

    -> dict with window, holds (window-local), dilated length, tokens, note.
    """
    q = quantize_to_tokens(ratios)
    hot = [f for f, r in enumerate(q) if r > 1.0 + EPS]
    w0, wlen, widened = place_window(hot[0] if hot else None,
                                     hot[-1] if hot else None, frames)
    win = q[w0:w0 + wlen]
    want = sum(win)
    target = G.legal_ceil(int(want + 0.5))
    holds = dither_holds(win, target)
    note = None
    if expand_to_end:
        holds, note = G.expand_hold_map_to_end(holds)
    dilated = sum(holds)
    assert G.is_legal(dilated), f"{dilated} off the 17k+5 grid"
    added = dilated - wlen
    assert added % G.LEGAL_STEP == 0, (
        f"added {added} frames, not a multiple of {G.LEGAL_STEP} "
        "(adds-multiple-of-17 law)")
    return {
        "window_start": w0, "window_len": wlen,
        "holds": holds, "dilated_frames": dilated,
        "world_tokens": G.token_count_exact(wlen),
        "dilated_tokens": G.token_count_exact(dilated),
        "added_frames": added,
        "drawn_average": (want / wlen) if wlen else 1.0,
        "achieved_average": dilated / float(wlen) if wlen else 1.0,
        "guide_dilated_idx": sum(holds[:wlen - 1]),
        "expand_note": note,
        "widened": widened,
        "runs": G.hold_runs_str(holds),
    }


def ranges_from_holds(holds, window_start=0, fps=24.0, decimals=4):
    """Compiled hold map -> the `ranges` convention H3ManualHoldMap parses.

    A FORMATTER, not a decision. The holds are the compiler's own output,
    the window offset puts them back on the world clock, and the seconds
    are that clock's. Runs at hold 1 are left out (a range is a request to
    spend frames, and 1 is the default), ends are inclusive, and the ends
    land back on their own frames when parsed at the same fps.
    """
    out, f, n = [], 0, len(holds)
    while f < n:
        h = int(holds[f])
        g = f
        while g + 1 < n and int(holds[g + 1]) == h:
            g += 1
        if h > 1:
            a = (int(window_start) + f) / float(fps)
            b = (int(window_start) + g) / float(fps)
            out.append(f"{a:.{decimals}f}s-{b:.{decimals}f}s:{h}")
        f = g + 1
    return ", ".join(out)


# ------------------------------------------------------------ graph emission

def _prompt_of(plan):
    return schema.setting(plan, "prompt", "") or ""


def emit_graph(plan, comp, ov):
    """Mint the .api.json. Node ids and titles crib t2c_w45e_v001 so a diff
    against the hand-built graph reads straight."""
    clip = plan["clip"]
    frames = int(clip["frames"])
    w0, wlen = comp["window_start"], comp["window_len"]
    dil = comp["dilated_frames"]
    hold_json = json.dumps({"holds": comp["holds"], "world_len": wlen})
    width = int(clip.get("width") or ov["width"])
    height = int(clip.get("height") or ov["height"])

    g = {
        "127": {"class_type": "UNETLoader",
                "inputs": {"unet_name": ov["unet"], "weight_dtype": "default"},
                "_meta": {"title": "base model"}},
        "128": {"class_type": "CLIPLoader",
                "inputs": {"clip_name": ov["clip"], "type": "minimax",
                           "device": "default"},
                "_meta": {"title": "text encoder"}},
        "119": {"class_type": "VAELoader", "inputs": {"vae_name": ov["vae"]},
                "_meta": {"title": "video VAE"}},
        "300": {"class_type": "PathchSageAttentionKJ",
                "inputs": {"model": ["127", 0], "sage_attention": "auto",
                           "allow_compile": False},
                "_meta": {"title": "sage attention"}},
        "301": {"class_type": "MiniMaxH3MemoryEfficientSageAttentionPatch",
                "inputs": {"model": ["300", 0]},
                "_meta": {"title": "H3 sage patch"}},
        "302": {"class_type": "MiniMaxChunkFeedForward",
                "inputs": {"model": ["301", 0], "chunks": 2,
                           "seq_threshold": 65536},
                "_meta": {"title": "chunked FF"}},
        "135": {"class_type": "KSamplerSelect",
                "inputs": {"sampler_name": ov["sampler"]},
                "_meta": {"title": "sampler"}},
        "400": {"class_type": "LoadVideo",
                "inputs": {"file": os.path.basename(clip["path"])},
                "_meta": {"title": f"world clip: {frames}f {width}x{height} "
                                   f"{clip.get('fps', 24)}fps"}},
        "401": {"class_type": "GetVideoComponents", "inputs": {"video": ["400", 0]},
                "_meta": {"title": "components"}},
        "402": {"class_type": "H3VideoFit",
                "inputs": {"images": ["401", 0], "mode": "trim tail (default)",
                           "max_frames": 0, "fps": ["401", 2],
                           "audio": ["401", 1]},
                "_meta": {"title": "fit to 17k+5"}},
        "410": {"class_type": "ImageFromBatch",
                "inputs": {"image": ["402", 0], "batch_index": w0,
                           "length": wlen},
                "_meta": {"title": f"WINDOW crop world frames {w0}..{w0 + wlen - 1} "
                                   f"({w0} on the 17-phase; {wlen} legal)"}},
        "403": {"class_type": "VAEEncode",
                "inputs": {"pixels": ["410", 0], "vae": ["119", 0]},
                "_meta": {"title": f"encode the {wlen}f window"}},
        "404": {"class_type": "H3TemporalInsert",
                "inputs": {"samples": ["403", 0], "hold_map": hold_json,
                           "init_mode": "lerp", "length": 0, "noise_seed": 0,
                           "expand_to_end": False},
                "_meta": {"title": f"compiled hold map, window-local: "
                                   f"{comp['runs']} = {dil}f. "
                                   f"expand_to_end already applied by the "
                                   f"compiler, so the node must not rewrite "
                                   f"it again"}},
        "522": {"class_type": "H3InjectSchedule",
                "inputs": {"model": ["302", 0], "scheduler": ov["scheduler"],
                           "total_steps": int(schema.setting(plan, "steps")),
                           "inject": float(schema.setting(plan, "regen_strength")),
                           "preset": "custom"},
                "_meta": {"title": "inject = plan settings.regen_strength"}},
        "523": {"class_type": "RandomNoise",
                "inputs": {"noise_seed": int(schema.setting(plan, "seed"))},
                "_meta": {"title": "seed from the plan"}},
        "524": {"class_type": "MiniMaxH3ImageToVideo",
                "inputs": {"clip": ["128", 0], "vae": ["119", 0],
                           "prompt": _prompt_of(plan), "width": width,
                           "height": height, "length": dil},
                "_meta": {"title": f"conditioning only; length = DILATED {dil} "
                                   f"so AddGuide resolves on the dilated clock"}},
        "405": {"class_type": "ImageFromBatch",
                "inputs": {"image": ["402", 0],
                           "batch_index": w0 + wlen - 1, "length": 1},
                "_meta": {"title": f"TAIL GUIDE source: world frame "
                                   f"{w0 + wlen - 1} (window-local {wlen - 1})"}},
        "406": {"class_type": "MiniMaxH3AddGuide",
                "inputs": {"positive": ["524", 0], "vae": ["119", 0],
                           "latent": ["524", 1], "image": ["405", 0],
                           "frame_idx": comp["guide_dilated_idx"]},
                "_meta": {"title": f"tail guide at dilated "
                                   f"{comp['guide_dilated_idx']} = the prefix "
                                   f"sum of the hold map up to the final world "
                                   f"frame (content-exact placement)"}},
        "525": {"class_type": "BasicGuider",
                "inputs": {"model": ["302", 0], "conditioning": ["406", 0]},
                "_meta": {"title": "guider"}},
        "526": {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["523", 0], "guider": ["525", 0],
                           "sampler": ["135", 0], "sigmas": ["522", 0],
                           "latent_image": ["404", 0]},
                "_meta": {"title": "only the inserted token-times are denoised"}},
        "530": {"class_type": "VAEDecode",
                "inputs": {"samples": ["526", 0], "vae": ["119", 0]},
                "_meta": {"title": f"decode the DILATED {dil}f window"}},
        "531": {"class_type": "H3ExactRecover",
                "inputs": {"images": ["530", 0], "hold_map": ["404", 2]},
                "_meta": {"title": f"recover: {dil}f -> {wlen}f world clock"}},
    }

    # splice: head + window (+ tail). Pieces the window does not cover are
    # the ORIGINAL pixels, never a VAE round trip.
    #
    # The recovered window goes STRAIGHT into the splice. The hand-built
    # recipe passed it through an H3TimeSmear at dilation 1 with no hold map
    # to get CPU images for ImageBatch; H3ExactRecover already returns
    # `.cpu()`, so that pass had nothing to do — and a pass with nothing to
    # do is not free: at dilation 1 it still snaps its output up to the
    # legal floor, which silently added 17 frames to any window shorter than
    # that (measured 2026-08-15: a 124-frame plan rendered 141 frames). A
    # node that is only conditionally an identity does not belong in the
    # graph, so it is not emitted (compiler 0.3).
    tail_start = w0 + wlen
    last = "531"
    if w0 > 0:
        g["411"] = {"class_type": "ImageFromBatch",
                    "inputs": {"image": ["402", 0], "batch_index": 0,
                               "length": w0},
                    "_meta": {"title": f"HEAD: original frames 0..{w0 - 1}, "
                                       f"untouched pixels"}}
        g["412"] = {"class_type": "ImageBatch",
                    "inputs": {"image1": ["411", 0], "image2": [last, 0]},
                    "_meta": {"title": f"SPLICE head + window at frame {w0} "
                                       f"(17-phase cut)"}}
        last = "412"
    if tail_start < frames:
        g["414"] = {"class_type": "ImageFromBatch",
                    "inputs": {"image": ["402", 0], "batch_index": tail_start,
                               "length": frames - tail_start},
                    "_meta": {"title": f"TAIL: original frames {tail_start}.."
                                       f"{frames - 1}, untouched pixels"}}
        g["415"] = {"class_type": "ImageBatch",
                    "inputs": {"image1": [last, 0], "image2": ["414", 0]},
                    "_meta": {"title": f"SPLICE + tail at frame {tail_start}"}}
        last = "415"

    g["540"] = {"class_type": "CreateVideo",
                "inputs": {"images": [last, 0], "audio": ["402", 2],
                           "fps": 24, "bit_depth": 8},
                "_meta": {"title": f"world clock {frames}f + the SOURCE clip's "
                                   f"own audio -> in sync"}}
    g["541"] = {"class_type": "SaveVideo",
                "inputs": {"video": ["540", 0], "format": "auto",
                           "codec": "auto",
                           "filename_prefix": schema.setting(
                               plan, "output_prefix")},
                "_meta": {"title": "compiled from a timeline plan"}}
    return g


# ------------------------------------------------------------------ backend

DEFAULT_OVERRIDES = {
    # model wiring: not semantic, not a recipe finding — just what this box
    # has installed. Overridable per plan via settings.backend.h3.
    "unet": "minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "clip": "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae": "minimax_h3/minimax_h3_video_vae_fp16.safetensors",
    "sampler": "gradient_estimation",
    "scheduler": "beta",
    "width": 1152,
    "height": 640,
}


class H3Backend(VideoModelBackend):
    backend_id = "h3"

    def __init__(self, spec=SPEC, profile=PROFILE):
        self.spec = spec
        self.profile = profile

    # ---- protocol

    def capabilities(self):
        return {
            "backend": self.backend_id,
            "model_spec": self.spec.version,
            "recipe_profile": self.profile.version,
            "compiler": COMPILER_VERSION,
            "lanes_compiled": ("generation_density",),
            "lanes_known_not_compiled": ("regional_refine", "pin", "refs",
                                         "continuation"),
            "fps": self.spec.fps,
            "legal_lengths": f"{self.spec.temporal_group_size}k+"
                             f"{self.spec.length_offset}",
            "audio_exact_lengths": self.spec.audio_exact_lengths(250),
            "sync_policies_implemented": ("exact_trim",),
            "max_density_supported": None,   # cost, not legality, is the limit
            "notes": ["density is met in aggregate: holds are integers per "
                      "world frame and the compiler dithers mixed rates",
                      "window start snaps to a 17-multiple; window length to "
                      "the 17k+5 grid"],
        }

    def validate(self, plan, ctx=None):
        p = list(schema.validate(plan))
        frames = int((plan.get("clip") or {}).get("frames") or 0)
        lanes = [l for l in plan.get("lanes", []) if l.get("enabled", True)]
        density = [l for l in lanes
                   if schema.lane_type(l) == "generation_density"]
        for l in lanes:
            if schema.lane_type(l) != "generation_density":
                p.append(f"lane type {l.get('type')!r} is not compiled by the "
                         f"H3 backend yet (v0 compiles: generation_density)")
        if not density:
            p.append("no enabled generation_density lane: nothing to compile")
        if len(density) > 1:
            p.append(f"{len(density)} generation_density lanes; v0 compiles "
                     "exactly one")
        sp = schema.setting(plan, "sync_policy")
        if sp != "exact_trim":
            p.append(f"sync_policy {sp!r} is declared but NOT IMPLEMENTED in "
                     "v0 (TODO T2); only 'exact_trim' compiles")
        if frames and frames < 39:
            p.append(f"clip is {frames} frames; the grid floors at 39 and the "
                     "compiler would invent frames")
        return p

    def compile(self, plan, ctx=None):
        problems = self.validate(plan)
        if problems:
            raise schema.PlanError("; ".join(problems))
        ctx = dict(ctx or {})
        ov = dict(DEFAULT_OVERRIDES)
        ov.update(schema.backend_settings(plan, self.backend_id))
        clip = plan["clip"]
        frames = int(clip["frames"])
        lane = schema.density_lanes(plan)[0]
        ratios = schema.envelope_per_frame(lane["envelope"], frames)
        ceiling = float(lane.get("ceiling", 4.0))
        warnings = []
        if max(ratios) > ceiling + EPS:
            warnings.append(f"density envelope peaks at {max(ratios):.2f}x "
                            f"above the lane ceiling {ceiling:g}; clamped")
            ratios = [min(r, ceiling) for r in ratios]

        comp = compile_temporal(
            ratios, frames,
            expand_to_end=bool(schema.setting(plan, "hold_expansion_to_clip_end")))
        graph = emit_graph(plan, comp, ov)
        wd = comp["widened"]
        if wd:
            warnings.append(
                f"the drawn burst needs only {wd['from_len']} world frames, "
                f"below the model's minimum generation length "
                f"{wd['min_len']}: the REGENERATED REGION was widened to "
                f"{wd['to_len']} frames by absorbing {wd['before']} source "
                f"frames before it and {wd['after']} after. The output is "
                f"still {frames} frames — the region grew, the timeline did "
                f"not"
                + (" (clip too short for a full-length window, so the whole "
                   "clip is the region)" if wd["clip_limited"] else ""))

        budget_s = float(schema.setting(plan, "max_regen_seconds") or 0)
        if budget_s and comp["dilated_frames"] / float(self.spec.fps) > budget_s:
            warnings.append(
                f"one pass of {comp['dilated_frames']}f "
                f"({comp['dilated_frames'] / self.spec.fps:.1f}s generated) is "
                f"over the {budget_s:g}s budget. v0 COMPILES ONE WINDOW ONLY: "
                f"split it with H3 Window Plan, or lower the envelope. "
                f"[TODO T2: multi-window compilation]")
        if not self.spec.audio_is_exact(comp["dilated_frames"]):
            # Not a refusal (review round 3, item 6): an inexact length is a
            # question the DELIVERY policy answers. exact_trim, the only
            # implemented policy, takes audio from the source clip at the
            # world length, which is exact by construction for a single
            # clip; the drift only accumulates when segments are CHAINED.
            warnings.append(
                f"dilated length {comp['dilated_frames']} is not audio-exact "
                f"(nearest exact lengths {self.spec.audio_exact_lengths(250)}; "
                f"error {self.spec.audio_error_ms(comp['dilated_frames']):.1f} "
                f"ms). sync_policy=exact_trim handles it for a single clip; "
                f"do not CHAIN this segment until pad/resample/conform_at_end "
                f"exist [TODO T2]")

        graph_path = ctx.get("graph_path")
        if graph_path:
            graph_path = os.path.abspath(graph_path)
            os.makedirs(os.path.dirname(graph_path), exist_ok=True)
            with open(graph_path, "w", encoding="utf-8") as fh:
                json.dump(graph, fh, indent=1)

        est = self.estimate(plan, dict(ctx, _compiled=comp))
        # DETERMINISTIC half: byte-stable for identical inputs. No paths, no
        # timestamps, no machine-dependent numbers (review round 3, item 4).
        artifact = {
            "window": {"start": comp["window_start"], "len": comp["window_len"]},
            "hold_map": {"holds": comp["holds"], "world_len": comp["window_len"]},
            "dilated_frames": comp["dilated_frames"],
            "tokens": {"world": comp["world_tokens"],
                       "dilated": comp["dilated_tokens"]},
            "guide_dilated_idx": comp["guide_dilated_idx"],
            "added_frames": comp["added_frames"],
            "drawn_average_density": comp["drawn_average"],
            "achieved_average_density": comp["achieved_average"],
            "expand_note": comp["expand_note"],
            "widened": comp["widened"],
            "graph_sha256": _graph_hash(graph),
            "equivalent_clip_time_x": round(est.multiplier, 6),
        }
        # CIRCUMSTANCE half: where it was written, what it cost HERE, what
        # the operator should see.
        receipt = {
            "graph_path": graph_path,
            "estimate": est.as_dict(),
            "warnings": warnings,
            "sync_policy": schema.setting(plan, "sync_policy"),
        }
        schema.put_compiled(plan, self.backend_id, artifact, receipt, versions={
            "model_spec": self.spec.version,
            "recipe_profile": self.profile.version,
            "compiler": COMPILER_VERSION})
        return CompileResult(graph, copy.deepcopy(
            schema.get_compiled(plan, self.backend_id)),
            self._report(plan, comp, est, warnings), warnings)

    def estimate(self, plan, ctx=None):
        ctx = dict(ctx or {})
        comp = ctx.get("_compiled")
        if comp is None:
            frames = int(plan["clip"]["frames"])
            lane = schema.density_lanes(plan)[0]
            comp = compile_temporal(
                schema.envelope_per_frame(lane["envelope"], frames), frames,
                expand_to_end=bool(schema.setting(
                    plan, "hold_expansion_to_clip_end")))
        clip = plan["clip"]
        ov = dict(DEFAULT_OVERRIDES)
        ov.update(schema.backend_settings(plan, self.backend_id))
        width = int(clip.get("width") or ov["width"])
        height = int(clip.get("height") or ov["height"])
        frames = int(clip["frames"])
        plain = G.token_count_exact(frames if G.is_legal(frames)
                                    else G.grid_floor(frames))
        geom = price.Geometry(
            work_units_plan=comp["dilated_tokens"],
            work_units_plain=plain,
            steps=max(1, int(round(int(schema.setting(plan, "steps"))
                                   * float(schema.setting(plan,
                                                          "regen_strength"))))),
            frames_plan=comp["dilated_frames"], frames_plain=frames,
            fps=float(clip.get("fps") or self.spec.fps),
            pixels=width * height,
            note=f"window {comp['window_len']}f = {comp['world_tokens']} tokens "
                 f"of the clip's {plain}; the head/tail frames are not "
                 f"regenerated at all")
        model = price.ComplexityModel(
            self.profile.get("cost_exponent"),
            self.profile.get("speed_anchors"),
            label=f"recipe {self.profile.version}")
        rec = ctx.get("recorder_path")
        calib = (price.Calibration.from_recorder(
                     rec, device=ctx.get("device"), model=ctx.get("model_tag"),
                     pixels=width * height)
                 if rec else price.Calibration([]))
        free = ctx.get("free_bytes")
        if free is None and ctx.get("port"):
            free, _ = price.system_stats(ctx["port"])
        return price.estimate(geom, model, calib, free,
                              overhead_s=self.profile.get("overhead_seconds"))

    # ---- reporting

    def _report(self, plan, comp, est, warnings):
        lines = [
            f"H3 compile {COMPILER_VERSION} (spec {self.spec.version}, recipe "
            f"{self.profile.version}) of plan {plan.get('id', '?')[:8]} "
            f"rev {plan.get('revision', 0)}",
            f"window: world frames {comp['window_start']}.."
            f"{comp['window_start'] + comp['window_len'] - 1} "
            f"({comp['window_len']}f, start on the 17-phase)",
            f"hold map: {comp['runs']} = {comp['dilated_frames']}f dilated "
            f"(+{comp['added_frames']} = {comp['added_frames'] // G.LEGAL_STEP}"
            f"x17), tokens {comp['world_tokens']} -> {comp['dilated_tokens']}",
            f"generation density: drawn average {comp['drawn_average']:.3f}x, "
            f"achieved {comp['achieved_average']:.3f}x (integer holds, "
            f"dithered). Output stays on the world clock: same length, same "
            f"speed, more frames underneath the motion",
            f"tail guide at dilated frame {comp['guide_dilated_idx']}",
        ]
        if comp["widened"]:
            wd = comp["widened"]
            lines.append(f"region widened: {wd['from_len']}f -> {wd['to_len']}f "
                         f"(+{wd['before']} before, +{wd['after']} after) to "
                         f"reach the minimum generation length {wd['min_len']}")
        if comp["expand_note"]:
            lines.append(comp["expand_note"])
        lines += est.lines
        for w in warnings:
            lines.append("WARNING: " + w)
        return "\n".join(lines)
