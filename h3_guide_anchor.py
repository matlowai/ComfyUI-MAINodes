"""H3 Guide Anchor (alpha, 2026-09-20): where a guide sits on the target
timeline when references are also attached, as a graph parameter instead of a
core edit.

WHY THERE IS A CHOICE AT ALL. Core packs H3's rows in one order — text, guide
(keyframe) cond rows, reference rows, then the target streams — but the TIME
coordinate those guide rows carry is a separate decision from their row order.
Since the reference-advance fix landed, core measures guide anchors from the
target's own origin:

    cursor = text_len + sum(_ref_t_span(blk) for blk in refs)
    cond_t = cursor + FRAME_RESCALE * resolved_frame_index
    (`comfy/ldm/minimax/model.py:369-377` on 0.37.0)

so `frame_idx` names a frame of the video being generated, whatever else is
attached. Call that PIN. Before that fix the origin was `text_len` alone, so
every reference slid every guide earlier by that reference's own span. Call
that FLOAT.

Float was wrong as a DEFAULT — `frame_idx` silently meant a different frame
the moment a reference appeared, and nothing in the UI said so — which is why
core pins now and why this node's default is pin. It is not a useless
PLACEMENT, though, and the two have different jobs:

  pin    the guide holds its frame. What frame_idx promises, and what a
         plate-following swap needs: the pinned opening frame is the identity
         and the reference supplies the motion.
  float  the guide slides with its references, giving the plate more say over
         the opening framing. On a strong plate that can be the better shot.
         It is also the placement every result from before #15439 merged
         (`e01fb4c5`, which brought the pin with it) was measured on, so it
         is what a render from that era must be reproduced against. Every
         core on this box since then pins, this pack's own patched branches
         included - checked with the classifier over seven revisions.

NO PATCH, NO WRAPPER, NO RESTART. Unlike the other compat nodes in this pack,
this one touches nothing: it rewrites `resolved_frame_index` in the
conditioning and lets core's own arithmetic do the placement. The two
placements differ by exactly the reference advance, and core multiplies that
index by FRAME_RESCALE, so

    float == pin with   resolved_frame_index -= ref_span / FRAME_RESCALE

is an identity, not an approximation. `resolved_frame_index` is consumed in
exactly ONE place on the model side (the `cond_t` line above) and as a plain
float multiplier, so a fractional index is a legal input there — checked on
0.37.0, where it is read nowhere else in `comfy/`.

ORDER. Wire this AFTER every Add Guide node and after the reference source:
it reads the references that are already on the conditioning to size the
shift. That ordering is free on a stock graph, because `minimax_refs` is
written in exactly one place (`comfy_extras/nodes_minimax_h3.py:362`,
MiniMaxH3ReferenceToVideo) and that node is a conditioning SOURCE, so the
references necessarily exist before any guide node runs. If you build
references some other way, this node cannot see what has not been attached
yet, and it says so in its report rather than guessing.

WHAT IT REFUSES TO DO. It asks the running core which placement it implements
(`h3_capabilities.probe_core()["keyframe_anchor"]`) and will not act on a core
it cannot classify: pin and float are a sign flip apart, so guessing wrong
does not fail, it silently moves every guide the wrong way by the reference
span. An unprovable core gets the conditioning back untouched and a report
that says why.

KNOWN INTERACTION, not a bug in either node: `H3AddLatentGuide`'s row retime
(`motion.py`, `_install_guide_layout_patch`) maps each guide onto the target
TOKEN it duplicates, and only a guide starting on a token boundary has one.
A fractional index — which is what float mode produces whenever the reference
span is not a whole number of token spans — has no such boundary, so that
retime skips the guide on the stock clock and raises under DyRoPE / True
Clock rather than leave it mispositioned. The report names the guides this
would hit before you render.

NOT MEASURED, and deliberately not claimed: which placement looks better. The
node exists so that is an A/B a graph can run, not a question this docstring
answers.
"""

import logging

log = logging.getLogger("MAINodes.h3_guide_anchor")

MODES = ("pin", "float", "offset")


# --------------------------------------------------------------------------
# pure arithmetic: importable and testable with no ComfyUI present
# --------------------------------------------------------------------------

def ref_time_span(blk):
    """The time-axis span one reference block occupies ahead of the target.

    Mirrors core's `_ref_t_span`. The mirror is the FALLBACK only: callers go
    through `total_ref_span`, which prefers core's own helper when the running
    core has one, so a core that changes its packing changes this node with
    it instead of drifting away from it in silence.
    """
    kind = blk["kind"]
    if kind == "image":
        return 1.0
    if kind == "audio":
        return float(blk["ref_audio_t"])
    if kind in ("video", "video_audio"):
        from_audio = float(blk["ref_audio_t"])
        vt = blk["latent_t"]
        try:
            import comfy.ldm.minimax.model as _mm
            spans = sum(_mm._video_t_spans(vt))
        except Exception:                                      # noqa: BLE001
            # 5/3 per pixel frame, FRAME_PER_TOKEN = (1, 4, 4, 4, 4) per 5
            spans = float(vt)
        return max(from_audio, float(spans))
    return 0.0


def total_ref_span(refs, core_helper=None):
    """Sum of the reference spans, using core's helper when it has one."""
    fn = core_helper or ref_time_span
    return float(sum(fn(blk) for blk in refs or ()))


def index_delta(mode, span, rescale, core_mode, offset_frames=0.0):
    """How much to ADD to every `resolved_frame_index`.

    `core_mode` is what the running core already does, so the delta is the
    correction from there to what the user asked for — which is why this is
    a sign flip and not a constant, and why an unclassified core is refused
    upstream of here rather than defaulted.
    """
    if rescale <= 0:
        raise ValueError("FRAME_RESCALE must be positive, got %r" % (rescale,))
    if mode == "offset":
        return float(offset_frames)
    if mode not in ("pin", "float"):
        raise ValueError("unknown anchor mode %r" % (mode,))
    if core_mode not in ("pin", "float"):
        raise ValueError("unclassified core anchor %r" % (core_mode,))
    if mode == core_mode:
        return 0.0
    shift = float(span) / float(rescale)
    return -shift if mode == "float" else shift


def retimed_keyframes(keyframes, delta):
    """Copy `keyframes` with every index shifted by `delta`.

    Copies rather than mutates: one conditioning dict is shared by every
    branch downstream of the node that made it, so editing a keyframe in
    place would retime guides on graph branches this node is not wired into.
    """
    out = []
    for kf in keyframes or ():
        new = dict(kf)
        new["resolved_frame_index"] = float(kf.get("resolved_frame_index", 0)) + float(delta)
        out.append(new)
    return out


# --------------------------------------------------------------------------
# the running core
# --------------------------------------------------------------------------

def core_anchor_mode():
    """"pin" / "float" / "unknown" for the running core, via the probe."""
    try:
        try:
            from . import h3_capabilities as caps            # inside the pack
        except ImportError:                                  # loaded by path
            import h3_capabilities as caps
        return caps.probe_core().get("keyframe_anchor", "unknown")
    except Exception as e:                                   # noqa: BLE001
        log.warning("H3 Guide Anchor: capability probe failed (%s: %s); "
                    "treating the core as unknown", type(e).__name__, e)
        return "unknown"


def core_frame_rescale():
    """Core's FRAME_RESCALE, or None when it cannot be read."""
    try:
        import comfy.ldm.minimax.model as _mm
        return float(_mm.FRAME_RESCALE)
    except Exception:                                        # noqa: BLE001
        return None


def core_ref_span_helper():
    """Core's own `_ref_t_span`, or None on a core that predates it."""
    try:
        import comfy.ldm.minimax.model as _mm
        return getattr(_mm, "_ref_t_span", None)
    except Exception:                                        # noqa: BLE001
        return None


def token_boundary_warning(keyframes):
    """Names the retimed guides `H3AddLatentGuide`'s retime cannot map.

    Returns a list of human-readable strings, empty when every guide still
    starts on a target token boundary (or when the retime is not loaded).
    """
    try:
        try:
            from .motion import guide_token_index
        except ImportError:
            from motion import guide_token_index             # noqa: F401
    except Exception:                                        # noqa: BLE001
        return []
    out = []
    for i, kf in enumerate(keyframes or ()):
        idx = kf.get("resolved_frame_index", 0)
        if float(idx) != int(idx) or guide_token_index(int(idx)) is None:
            out.append("guide %d at frame %.4f" % (i, float(idx)))
    return out


# --------------------------------------------------------------------------
# the node
# --------------------------------------------------------------------------

def apply_guide_anchor(positive, mode="pin", offset_frames=0.0):
    """Retime every guide on `positive`. Returns (conditioning, report)."""
    core_mode = core_anchor_mode()
    rescale = core_frame_rescale()

    if rescale is None:
        return positive, ("H3 Guide Anchor: not applied — this core's "
                          "comfy.ldm.minimax.model could not be imported, so "
                          "FRAME_RESCALE is unknown and an index shift has no "
                          "defined size.")
    if mode != "offset" and core_mode not in ("pin", "float"):
        return positive, (
            "H3 Guide Anchor: not applied — the running core's guide "
            "placement could not be classified (keyframe_anchor=%r). pin and "
            "float are one sign apart, so a guess would not fail, it would "
            "move every guide the wrong way by the whole reference span. Use "
            "mode=offset to shift by hand, or check H3 Capability Probe."
            % (core_mode,))

    helper = core_ref_span_helper()
    lines, touched, total = [], 0, 0
    out = []
    for cond, extra in positive:
        keyframes = extra.get("minimax_keyframes")
        if not keyframes:
            out.append([cond, extra])
            continue
        total += len(keyframes)
        refs = extra.get("minimax_refs") or ()
        span = total_ref_span(refs, helper)
        delta = index_delta(mode, span, rescale, core_mode, offset_frames)
        new_extra = extra.copy()
        new_extra["minimax_keyframes"] = retimed_keyframes(keyframes, delta)
        out.append([cond, new_extra])
        touched += len(keyframes)
        lines.append("  %d guide(s), %d reference(s), span %.4f -> delta %+0.4f frames"
                     % (len(keyframes), len(refs), span, delta))
        for kf, new in zip(keyframes, new_extra["minimax_keyframes"]):
            lines.append("    frame %.4f -> %.4f"
                         % (float(kf.get("resolved_frame_index", 0)),
                            float(new["resolved_frame_index"])))

    if not total:
        return positive, ("H3 Guide Anchor: nothing to do — this conditioning "
                          "carries no guides. Wire this node after Add Guide.")

    head = ("H3 Guide Anchor: mode=%s, core=%s, %d guide(s) retimed."
            % (mode, core_mode, touched))
    if mode != "offset" and mode == core_mode:
        head += (" The core already places guides this way, so every delta is "
                 "zero and this render is bit-identical to one built without "
                 "this node.")
    warn = []
    for _cond, extra in out:
        warn += token_boundary_warning(extra.get("minimax_keyframes"))
    if warn:
        lines.append("  NOTE: H3AddLatentGuide's row retime cannot map "
                     + ", ".join(warn)
                     + " onto a target token; on the stock clock it leaves "
                       "them alone, under DyRoPE / True Clock it raises. Core's "
                       "own image guides are unaffected.")
    return out, "\n".join([head] + lines)


class H3GuideAnchor:
    """Pin a guide to its frame, or let it float with the references."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": ("CONDITIONING", {"tooltip":
                    "the H3 conditioning carrying the guides. Wire this AFTER "
                    "every Add Guide node and after the reference source."}),
                "mode": (list(MODES), {"default": "pin", "tooltip":
                    "pin: the guide holds frame_idx whatever references are "
                    "attached — what frame_idx promises, and what a "
                    "plate-following swap needs. float: the guide is measured "
                    "from the prompt text instead, so each reference slides it "
                    "earlier by that reference's own span; looser, gives the "
                    "plate more say over the opening framing, and it is the "
                    "placement renders from before #15439 were measured on. "
                    "offset: "
                    "no opinion, just add offset_frames to every guide."}),
            },
            "optional": {
                "offset_frames": ("FLOAT", {"default": 0.0, "min": -9999.0,
                                            "max": 9999.0, "step": 0.01,
                                            "tooltip":
                    "mode=offset only: pixel frames to add to every guide's "
                    "index, relative to whatever the running core already "
                    "does. Fractional is legal — the model multiplies this "
                    "index by FRAME_RESCALE and reads it nowhere else."}),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "STRING")
    RETURN_NAMES = ("positive", "report")
    FUNCTION = "retime"
    CATEGORY = "conditioning/minimax"
    DESCRIPTION = __doc__

    def retime(self, positive, mode, offset_frames=0.0):
        out, report = apply_guide_anchor(positive, mode, offset_frames)
        log.info(report.splitlines()[0])
        return (out, report)


NODE_CLASS_MAPPINGS = {"H3GuideAnchor": H3GuideAnchor}
NODE_DISPLAY_NAME_MAPPINGS = {"H3GuideAnchor": "H3 Guide Anchor (pin / float)"}
