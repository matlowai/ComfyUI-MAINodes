"""H3 Cond Strength (alpha, 2026-09-20): one conditioning strength per KIND —
guides separately from references, video separately from audio, and per
individual reference — where core has one dial per stream for all of them.

WHAT CORE DOES TODAY. Every visual condition row, whether it came from a guide
(`minimax_keyframes`) or from a reference (`minimax_refs`), is noised by the
same scalar before it enters the sequence:

    aug = payload.get("visual_cond_noise_aug", VISUAL_COND_TIMESTEP)   # 0.999
    for z in payload.get("cond_video_latents", []):
        r = patchify_video(...)
        if aug < 1.0:
            r = aug * r + (1.0 - aug) * noise
    (`comfy/ldm/minimax/model.py:533-546` on 0.37.0, `_cond_video_rows`)

and the audio stream has the identical shape one method down
(`_cond_audio_rows`, `:548-559`, `audio_cond_noise_aug`, seed + 1). So "hold
this opening frame exactly, but treat the style plate loosely" is not
expressible: turning the plate down turns the guide down with it. That is the
gap this node fills. The dials themselves are core's; what is missing is that
there is ONE of them per stream.

HOW, WITHOUT OWNING CORE'S ARITHMETIC. The patched row builders do not
reimplement the blend. Each calls CORE'S OWN function once per condition
latent, with a payload copy carrying just that latent and just that latent's
strength, and concatenates the results. Core deliberately restarts the same
RNG stream for every condition ("every condition intentionally restarts the
same RNG stream", its own comment), so splitting one call into N calls draws
the SAME noise each time and a uniform strength is bit-identical to stock —
which the tests assert as an equality, not a tolerance, on both streams. The
property worth keeping: this node cannot drift from core's blend, because it
never spells it. A vendored `_forward` would trade that away at the
architecture level, and `vram_lab`'s copy (pinned to 0.33, dormant since
0.37 landed) is the standing evidence for what that costs.

ONE SOURCE OBJECT, ONE PLAN SLOT. Rows are matched to strengths through an
explicit classification of what produced them, never through positional
coincidence:

    cond_video_latents = [guide_video ...] + [ref_image / ref_video ...]
    cond_audio_latents = [guide_audio ...] + [ref_audio ...]
    (both orders set by MiniMaxH3.extra_conds and mirrored by the packer)

Each row carries the kind AND the index of the source object that produced
it, so a reference carrying both a clip and its soundtrack is one slot
governing both streams, an audio-only guide never shifts the video mapping,
and a blank in a per-reference list keeps its position instead of sliding
later values onto the wrong plate. The counts are recomputed from the payload
and the node REFUSES if they do not account for every latent core is about to
blend: a silent off-by-one here applies the plate's strength to the guide and
the render succeeds looking subtly wrong.

THE LABEL, AND WHAT THIS CANNOT DO. A cond row carries a timestep label as
well as its content, and core derives both kinds' labels, per stream, from
that same single scalar:

    seg_t = {..., "cond": max(t_v, vis_aug), "ref_img": max(t_v, vis_aug),
                  "cond_audio": max(t_a, aud_aug), "ref_audio": max(t_a, aud_aug)}
    (`comfy/ldm/minimax/model.py:636-638`)

Content can be split from outside core; that dict cannot, because it is built
inline in a 182-line `_forward` with no seam between it and the rows it
labels. So when two strengths on one stream differ, ONE kind is labelled at
the other's noise level. `label_follows` says which kind tells the truth. It
is an honest widget over a real limitation, not a tuning knob.

The mismatch is bounded, and the bound says where to look for it:

    |label_applied - label_correct| = |max(t, a_label) - max(t, a_kind)|
                                   <= |a_label - a_kind|

collapsing to zero once the stream's t overtakes both augmentations — an
early-sampling effect, largest at a wide split. THIS NODE MAKES THAT
MEASURABLE WITHOUT A CORE COPY: hold the strengths fixed and flip
`label_follows`, and the row CONTENT is bit-identical between the two arms
while only the label moves. Run that A/B before anyone edits core. If it
turns out to matter, the fix is a small upstream patch adding per-kind keys
that fall back to today's scalars — not a pack that owns `_forward`.

NOT MEASURED, and not claimed: that any of this looks better. The node makes
guide-vs-reference strength an A/B; which way it falls is a render's answer.
"""

import logging

import torch

log = logging.getLogger("MAINodes.h3_cond_strength")

PAYLOAD_KEY = "mainodes_cond_strength"
WRAPPER_KEY = "h3_cond_strength"
LABELS = ("guides", "references", "core")

# -1 on a widget means "say nothing about this kind": whatever the graph
# already set (an H3AddLatentGuide upstream sets the visual dial too) survives.
INHERIT = -1.0

# per stream: core's single dial, the latents it covers, and the kinds that
# can land in it. Adding a stream is adding a row here.
STREAMS = {
    "video": {"aug_key": "visual_cond_noise_aug",
              "latents_key": "cond_video_latents",
              "latent_field": "latent",
              "guide_kind": "guide_video",
              "ref_kinds": ("ref_image", "ref_video")},
    "audio": {"aug_key": "audio_cond_noise_aug",
              "latents_key": "cond_audio_latents",
              "latent_field": "audio_latent",
              "guide_kind": "guide_audio",
              "ref_kinds": ("ref_audio",)},
}
ORDER = ("video", "audio")


# --------------------------------------------------------------------------
# pure: importable and testable with no ComfyUI present
# --------------------------------------------------------------------------

def parse_strengths(text, count):
    """"0.9, , 0.2" -> [0.9, None, 0.2], padded with None to `count`.

    Raises on anything that is not a number in [0, 1], or on more entries than
    there are slots: a typo here silently retunes the wrong plate.
    """
    if not text or not text.strip():
        return [None] * count
    parts = [p.strip() for p in text.replace(";", ",").split(",")]
    while parts and not parts[-1]:
        parts.pop()                  # a trailing comma is punctuation, not a slot
    if len(parts) > count:
        raise ValueError(
            "this list has %d value(s) but the conditioning has %d slot(s)"
            % (len(parts), count))
    out = []
    for p in parts:
        if not p:
            # An EMPTY SLOT KEEPS ITS PLACE. "0.9,,0.2" means first 0.9, second
            # left to the fallback, third 0.2 - dropping the blank instead
            # would slide 0.2 onto reference 2 and retune the wrong plate,
            # which is exactly the failure this list exists to avoid.
            out.append(None)
            continue
        try:
            v = float(p)
        except ValueError:
            raise ValueError("%r is not a number" % (p,))
        if not 0.0 <= v <= 1.0:
            raise ValueError("%r is outside [0, 1]" % (p,))
        out.append(v)
    return out + [None] * (count - len(out))


def classify_sources(payload, stream):
    """What produced each latent of `stream`, in the order core packs them.

    Returns [(kind, source_index), ...] aligned to that stream's latents list,
    where `source_index` is the position of the GUIDE or REFERENCE OBJECT that
    produced the row - so a reference carrying both a clip and its soundtrack
    is source j on both streams, and an audio-only guide does not shift the
    video mapping.

    Mirrors extra_conds' own predicates rather than assuming a count: a
    keyframe may carry audio only, a reference either or both.
    """
    conf = STREAMS[stream]
    field = conf["latent_field"]
    out = []
    for i, kf in enumerate(payload.get("keyframes") or ()):
        if kf.get(field) is not None:
            out.append((conf["guide_kind"], i))
    for j, ref in enumerate(payload.get("refs") or ()):
        if ref.get(field) is None:
            continue
        if stream == "audio":
            kind = "ref_audio"
        else:
            kind = "ref_image" if ref.get("kind") == "image" else "ref_video"
        out.append((kind, j))
    return out


def build_plan(payload, spec, stream):
    """One strength (or None = leave alone) per latent of `stream`.

    Returns (plan, sources). Raises when the sources do not account for every
    latent core is about to blend, which is the check that keeps the
    guide/plate mapping honest across core versions.
    """
    conf = STREAMS[stream]
    latents = payload.get(conf["latents_key"]) or []
    sources = classify_sources(payload, stream)
    if len(sources) != len(latents):
        raise RuntimeError(
            "H3 Cond Strength: core packs %d %s condition latent(s) but the "
            "payload accounts for %d (%s). The kind of each row cannot be "
            "established, and guessing would apply a reference's strength to "
            "a guide. Refusing."
            % (len(latents), stream, len(sources),
               ", ".join(k for k, _ in sources) or "none"))

    guide = spec.get(conf["guide_kind"])
    per_guide = spec.get("per_guide") or {}
    ref_default = spec.get("ref_default_" + stream)
    per_ref = spec.get("per_reference") or {}

    plan = []
    for kind, idx in sources:
        table, fallback = ((per_guide, guide) if kind == conf["guide_kind"]
                           else (per_ref, ref_default))
        v = table.get(idx)
        plan.append(fallback if v is None else v)
    return plan, sources


def label_value(plan, sources, guide_kind, label_follows, current):
    """The scalar this stream's dial should carry, or None to leave it.

    `current` is what the payload already says, so "core" really means
    untouched rather than reset to the default.
    """
    if label_follows == "core":
        return None
    if label_follows == "guides":
        chosen = [v for v, (k, _) in zip(plan, sources) if k == guide_kind]
    elif label_follows == "references":
        chosen = [v for v, (k, _) in zip(plan, sources) if k != guide_kind]
    else:
        raise ValueError("unknown label_follows %r" % (label_follows,))
    vals = [v for v in chosen if v is not None]
    if not vals:
        return None
    # several sources of one kind at different strengths cannot share one
    # label either; the strongest (closest to clean) is the conservative
    # choice, being the one whose content the model is most expected to trust
    picked = max(vals)
    return None if picked == current else picked


def label_mismatch(plan, sources, applied_label):
    """Rows whose content strength differs from the label they will carry."""
    if applied_label is None:
        return []
    return ["%s %d at %.4f" % (kind, idx, v)
            for v, (kind, idx) in zip(plan, sources)
            if v is not None and v != applied_label]


def runtime_spec(payload, spec, stream):
    """Resolve `spec` against one payload for one stream.

    Returns (plan, label, sources, notes), or None when the stream carries no
    condition rows. Called from the wrapper rather than from the patched row
    builder because the LABEL has to be in the payload before `_forward` reads
    it, and `_forward` computes its timestep table before it asks for rows.

    "inherit" is resolved against the payload's value BEFORE the label is
    touched, so overriding the label for one kind cannot silently retune the
    other.
    """
    conf = STREAMS[stream]
    if not (payload.get(conf["latents_key"]) or []):
        return None
    plan, sources = build_plan(payload, spec, stream)
    base = payload.get(conf["aug_key"])
    resolved = [base if v is None else v for v in plan]
    label = label_value(resolved, sources, conf["guide_kind"],
                        spec.get("label_follows", "core"), base)
    return resolved, label, sources, label_mismatch(resolved, sources, label)


# --------------------------------------------------------------------------
# the core-side patch
# --------------------------------------------------------------------------

# stream -> the method names that have built its rows, newest core first
COND_ROWS_METHODS = {"video": ("_cond_video_rows", "_visual_cond_rows"),
                     "audio": ("_cond_audio_rows",)}


def core_cond_rows_name(stream="video"):
    """Which method this core builds `stream`'s condition rows with."""
    try:
        import comfy.ldm.minimax.model as _mm
    except Exception:                                        # noqa: BLE001
        return None
    for name in COND_ROWS_METHODS[stream]:
        if hasattr(_mm.MiniMaxH3Model, name):
            return name
    return None


def _make_patched(prev, stream):
    conf = STREAMS[stream]

    def patched(self, payload, device):
        plan = (payload.get(PAYLOAD_KEY) or {}).get(stream)
        latents = payload.get(conf["latents_key"]) or []
        if not plan or not latents:
            return prev(self, payload, device)
        if len(plan) != len(latents):
            raise RuntimeError(
                "H3 Cond Strength: the %s plan covers %d latent(s) but this "
                "call carries %d. The rows changed between the wrapper and "
                "the row builder, so which strength belongs to which kind is "
                "no longer known. Refusing."
                % (stream, len(plan), len(latents)))
        if all(v is None for v in plan):
            return prev(self, payload, device)
        rows = []
        for z, strength in zip(latents, plan):
            sub = dict(payload)
            sub.pop(PAYLOAD_KEY, None)
            sub[conf["latents_key"]] = [z]
            if strength is not None:
                sub[conf["aug_key"]] = strength
            rows.append(prev(self, sub, device))
        rows = [r for r in rows if r is not None]
        return torch.cat(rows, dim=0) if rows else None

    patched._h3_cond_strength = True
    return patched


def install_cond_rows_patch():
    """Chain the per-kind split onto core's row builders, once per stream.

    Same sanctioned chaining shape as `_install_guide_layout_patch` and the
    DyRoPE rope patch in motion.py: wrap whatever is bound now, stay inert
    unless a payload asks for the split, and never install twice.
    """
    import comfy.ldm.minimax.model as _mm
    installed = {}
    for stream in ORDER:
        name = core_cond_rows_name(stream)
        if name is None:
            if stream == "video":
                raise RuntimeError(
                    "H3 Cond Strength: this core's MiniMaxH3Model has none of "
                    "%s, so there is no seam to split the condition rows at."
                    % (COND_ROWS_METHODS["video"],))
            log.warning("H3 Cond Strength: this core has no audio condition "
                        "row builder; the audio stream is left to core")
            continue
        installed[stream] = name
        prev = getattr(_mm.MiniMaxH3Model, name)
        if getattr(prev, "_h3_cond_strength", False):
            continue
        setattr(_mm.MiniMaxH3Model, name, _make_patched(prev, stream))
        log.info("H3 Cond Strength: chained onto MiniMaxH3Model.%s", name)
    return installed


def _make_wrapper(spec, state):
    """Put the resolved plans where the patched row builders will find them.

    The payload dict reaches `_forward` by reference, so writing the key here
    - inside the DIFFUSION_MODEL wrapper, which core runs between `forward`
    and `_forward` - is what makes this a per-GRAPH setting rather than a
    process-wide one. Remove the node and no payload carries the key, so the
    chained methods are passthroughs again with no uninstall step.
    """
    def wrapper(executor, *args, **kwargs):
        payload = kwargs.get("minimax_payload")
        if isinstance(payload, dict):
            plans, labels, notes = {}, {}, []
            for stream in ORDER:
                got = runtime_spec(payload, spec, stream)
                if got is None:
                    continue
                plan, label, _sources, stream_notes = got
                plans[stream] = plan
                if label is not None:
                    labels[stream] = label
                notes += ["%s %s" % (stream, n) for n in stream_notes]
            if plans:
                payload[PAYLOAD_KEY] = plans
                for stream, label in labels.items():
                    payload[STREAMS[stream]["aug_key"]] = label
                if not state.get("seen"):
                    log.info("H3 Cond Strength: plan %s, labels %s%s",
                             {s: ["inherit" if v is None else round(float(v), 4)
                                  for v in p] for s, p in plans.items()},
                             {s: round(float(v), 4) for s, v in labels.items()}
                             or "unchanged",
                             ("; mismatched: " + ", ".join(notes)) if notes else "")
                state["seen"] = state.get("seen", 0) + 1
        return executor(*args, **kwargs)
    return wrapper


def _wrappers_diffusion_model():
    from comfy.patcher_extension import WrappersMP
    return WrappersMP.DIFFUSION_MODEL


def is_h3_model(model):
    """True when this ModelPatcher wraps a MiniMax H3 diffusion model."""
    try:
        from .h3_mask_conv import is_h3_model as _is
    except ImportError:                                      # loaded by path
        from h3_mask_conv import is_h3_model as _is
    return _is(model)


def _opt(value):
    """A widget value -> a strength, or None for 'say nothing'."""
    return None if value is None or value < 0 else float(value)


def build_spec(guide_strength=INHERIT, reference_strength=INHERIT,
               reference_strengths="", guide_audio_strength=INHERIT,
               reference_audio_strength=INHERIT, label_follows="guides",
               n_slots=999):
    """The node's widgets -> the internal per-kind spec.

    `per_reference` is keyed by REFERENCE OBJECT index and governs every row
    that object contributes, which is what keeps one source conditioning
    object on one plan slot across both streams. `per_guide` has the same
    shape and no widget yet; the plan builder already honours it.
    """
    per_ref_list = parse_strengths(reference_strengths, n_slots)
    return {"guide_video": _opt(guide_strength),
            "guide_audio": _opt(guide_audio_strength),
            "ref_default_video": _opt(reference_strength),
            "ref_default_audio": _opt(reference_audio_strength),
            "per_reference": {i: v for i, v in enumerate(per_ref_list)
                              if v is not None},
            "per_guide": {},
            "label_follows": label_follows}


def spec_is_empty(spec):
    """True when the spec asks for nothing at all."""
    return not any([spec["guide_video"] is not None,
                    spec["guide_audio"] is not None,
                    spec["ref_default_video"] is not None,
                    spec["ref_default_audio"] is not None,
                    spec["per_reference"], spec["per_guide"]])


def apply_h3_cond_strength(model, guide_strength=INHERIT,
                           reference_strength=INHERIT, reference_strengths="",
                           guide_audio_strength=INHERIT,
                           reference_audio_strength=INHERIT,
                           label_follows="guides"):
    """Install the per-kind split on `model`. Returns (model, report)."""
    if not is_h3_model(model):
        return model, ("H3 Cond Strength: not applied — this MODEL's "
                       "diffusion_model is not a MiniMax H3 model.")

    spec = build_spec(guide_strength, reference_strength, reference_strengths,
                      guide_audio_strength, reference_audio_strength,
                      label_follows)
    if spec_is_empty(spec):
        return model, ("H3 Cond Strength: nothing asked for — every strength "
                       "is -1 (inherit), so the graph is unchanged. Set one in "
                       "[0, 1]; 1.0 is clean and core's own video default is "
                       "0.999.")

    installed = install_cond_rows_patch()

    m = model.clone()
    wtype = _wrappers_diffusion_model()
    try:
        m.remove_wrappers_with_key(wtype, WRAPPER_KEY)
    except AttributeError:                                   # pragma: no cover
        log.warning("H3 Cond Strength: this ModelPatcher has no "
                    "remove_wrappers_with_key; a second application would "
                    "stack a second wrapper")
    state = {"seen": 0}
    m.add_wrapper_with_key(wtype, WRAPPER_KEY, _make_wrapper(spec, state))

    def fmt(v):
        return "inherit (unchanged)" if v is None else "%.4f" % v

    rep = ["H3 Cond Strength: installed on %s."
           % ", ".join("MiniMaxH3Model.%s" % n for n in installed.values()),
           "  video  guides: %s   references: %s"
           % (fmt(spec["guide_video"]), fmt(spec["ref_default_video"])),
           "  audio  guides: %s   references: %s"
           % (fmt(spec["guide_audio"]), fmt(spec["ref_default_audio"]))]
    if spec["per_reference"]:
        rep.append("  per reference object: %s (index -> strength; governs "
                   "that reference's video AND audio rows)"
                   % {k: round(v, 4)
                      for k, v in sorted(spec["per_reference"].items())})
    rep.append("  label_follows=%s" % label_follows)
    if label_follows != "core":
        rep.append("  NOTE: core labels a stream's guide rows and reference "
                   "rows with ONE timestep, so whichever kind this does not "
                   "follow carries the other's noise level. The mismatch is "
                   "bounded by the gap between the two strengths and vanishes "
                   "late in sampling. Holding the strengths fixed and flipping "
                   "label_follows is a content-identical A/B of exactly that.")
    rep.append("  1.0 is clean; lower mixes in the same seeded noise core "
               "would have used. The resolved plan is logged once per run.")
    return m, "\n".join(rep)


class H3CondStrength:
    """Set guide and reference conditioning strength separately, per stream."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip":
                    "the H3 model this pass samples with. Wire it like any "
                    "model patch, before the sampler."}),
                "guide_strength": ("FLOAT", {"default": INHERIT, "min": -1.0,
                                             "max": 1.0, "step": 0.001,
                                             "tooltip":
                    "how clean the GUIDE video rows (Add Guide / keyframes) "
                    "arrive. 1.0 = untouched, core's own default is 0.999, "
                    "lower mixes in the seeded noise core would have used. "
                    "-1 = say nothing, leaving whatever the graph already set."}),
                "reference_strength": ("FLOAT", {"default": INHERIT, "min": -1.0,
                                                 "max": 1.0, "step": 0.001,
                                                 "tooltip":
                    "the same, for REFERENCE video rows (Reference to Video). "
                    "This is the dial that could not be moved on its own "
                    "before: core noises guides and references with one "
                    "scalar per stream."}),
            },
            "optional": {
                "reference_strengths": ("STRING", {"default": "", "tooltip":
                    "optional per-reference override, comma separated, by "
                    "REFERENCE OBJECT in packed order (images, then videos, "
                    "then standalone audio). One entry governs everything that "
                    "reference contributes, clip and soundtrack alike. Blank "
                    "entries keep their slot and fall back to the stream's "
                    "dial; more values than references is an error, not a trim."}),
                "guide_audio_strength": ("FLOAT", {"default": INHERIT, "min": -1.0,
                                                   "max": 1.0, "step": 0.001,
                                                   "tooltip":
                    "guide rows on the AUDIO stream (a guide anchored with a "
                    "soundtrack). Core has the same single-dial limitation "
                    "there, and this splits it the same way."}),
                "reference_audio_strength": ("FLOAT", {"default": INHERIT,
                                                       "min": -1.0, "max": 1.0,
                                                       "step": 0.001, "tooltip":
                    "reference rows on the AUDIO stream."}),
                "label_follows": (list(LABELS), {"default": "guides", "tooltip":
                    "core gives a stream's guide rows and reference rows ONE "
                    "timestep label, so when two strengths differ, one kind is "
                    "labelled at the other's noise level. This says which kind "
                    "tells the truth. 'core' leaves the labels alone entirely. "
                    "Holding the strengths fixed and flipping this is a "
                    "content-identical A/B of the label itself."}),
            },
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "patch"
    CATEGORY = "model_patches/minimax"
    DESCRIPTION = __doc__

    def patch(self, model, guide_strength, reference_strength,
              reference_strengths="", guide_audio_strength=INHERIT,
              reference_audio_strength=INHERIT, label_follows="guides"):
        m, report = apply_h3_cond_strength(
            model, guide_strength, reference_strength, reference_strengths,
            guide_audio_strength, reference_audio_strength, label_follows)
        log.info(report.splitlines()[0])
        return (m, report)


NODE_CLASS_MAPPINGS = {"H3CondStrength": H3CondStrength}
NODE_DISPLAY_NAME_MAPPINGS = {"H3CondStrength": "H3 Cond Strength (per kind)"}
