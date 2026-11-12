"""H3 Attention Measure (alpha): a per-key log-weight on H3 self-attention.

WHY. H3 self-attention is plain `optimized_attention(q, k, v)` with no
per-key weighting (comfy/ldm/minimax/model.py:173-199). Every key carries
the same softmax mass regardless of how much WORLD TIME the token it came
from actually represents. Retiming a clip by integer frame holds (the
time-smear that seeds a de-rope pass) splits one temporal cell into n
near-identical children, so that region's mass in every query's softmax is
multiplied by about n. Truthful RoPE coordinates fix the GEOMETRY of the
time axis; they do not fix the MEASURE.

WHAT THIS DOES. It adds `strength * log(1 / dup_j)` to the pre-softmax logit
of every TARGET VIDEO key j, where dup_j is how many times over the token's
own span the retimed clip repeats one world instant (1.0 when nothing is
held). Audio, text, cond and reference rows get 0. The addition is done
without touching any attention kernel: 8 extra channels are appended to q
and k, one of which carries the constant and the log-weight, so the dot
product picks up exactly one extra term and everything else (backend,
mask, dtype, memory layout) is unchanged. At S = 40k the extra tensors are
8/128 of q and k and nothing else.

The uniform case (every hold 1) must be a no-op: log(1) = 0, so the added
channel contributes exactly zero and the output is the stock output up to
the float noise of a wider head dimension. That is the acceptance gate,
`tests/test_attention_measure.py`.

Hypothesis under test, nothing measured yet.

Wire: the SAME hold_map string H3 Time Smear emits (`hold_map_used`) into
`hold_map` here, and the model this pass samples with into `model`.
"""

import json
import logging
import math

import torch

log = logging.getLogger("MAINodes.h3_measure")

# The H3 temporal token rhythm: 5 tokens cover 17 pixel frames as
# (1, 4, 4, 4, 4). comfy/ldm/minimax/model.py:30 FRAME_PER_TOKEN. Kept as a
# local constant so the pure functions below import with no ComfyUI present.
FRAME_PER_TOKEN = (1, 4, 4, 4, 4)

# how many channels we append to q and k. 8 keeps head_dim a multiple of 8,
# which the flash / sage paths require, and 128 + 8 stays under the 256 cap.
PAD = 8

MODES = ("off", "log_measure")

# markers in an already-installed override that mean the pass is not dense
_SPARSE_MARKERS = ("sol_attn", "sparse", "sla_", "_sla", "vsa")


# --------------------------------------------------------------------------
# pure geometry: which packed rows are target video, and what each one weighs
# --------------------------------------------------------------------------

def token_frame_spans(latent_t):
    """(start, span) in DILATED pixel frames for each of the latent_t target
    video temporal tokens. Mirrors _video_t_spans (model.py:95) without the
    5/3 RoPE rescale: we want frames here, not RoPE units."""
    out = []
    cur = 0
    for k in range(int(latent_t)):
        span = FRAME_PER_TOKEN[k % 5]
        out.append((cur, span))
        cur += span
    return out


def world_of_frame(holds):
    """Expand a hold map into a dilated-frame -> world-frame index."""
    return [j for j, h in enumerate(holds) for _ in range(int(h))]


def token_logw(latent_t, holds, strength=1.0):
    """log-weight per TEMPORAL video token for the hold map `holds`.

    dup_j = (dilated frames token j spans) / (world frames it represents),
    the world duration being the sum of 1/hold over the dilated frames in
    the span. A token that sits inside one held group of width h gets
    dup = h exactly; a token straddling a hold boundary gets the harmonic
    blend, which is the only reading that keeps total world duration
    conserved. logw_j = -log(dup_j), so an unheld clip is all zeros.
    """
    spans = token_frame_spans(latent_t)
    frames = spans[-1][0] + spans[-1][1] if spans else 0
    world = world_of_frame(holds)
    if len(world) != frames:
        raise ValueError(
            "hold map covers %d dilated frames, the latent covers %d "
            "(latent_t %d). Wire the SAME hold_map_used the smear emitted."
            % (len(world), frames, latent_t))
    out = []
    for start, span in spans:
        dur = 0.0
        for d in range(start, start + span):
            dur += 1.0 / float(holds[world[d]])
        out.append(-float(strength) * math.log(span / dur))
    return out


def row_logw(segments, latent_t, seq_len, holds, strength=1.0):
    """Per-ROW log-weight over the whole packed sequence [S].

    `segments` is the core's contiguous (start, stop, kind) table
    (model.py:464-469, kinds text / cond / cond_audio / ref_img / ref_audio /
    audio / video). Only the TARGET video segment is weighted; text, cond,
    reference and every audio row stay at 0, which is what "the measure
    correction applies to the retimed stream only" means.
    """
    w = torch.zeros(int(seq_len), dtype=torch.float64)
    vid = [s for s in segments if s[2] == "video"]
    if len(vid) != 1:
        raise ValueError("expected exactly one target video segment, got %d"
                         % len(vid))
    start, stop, _ = vid[0]
    n = stop - start
    if int(latent_t) <= 0 or n % int(latent_t):
        raise ValueError("video segment of %d rows is not divisible by "
                         "latent_t %d" % (n, latent_t))
    frame_rows = n // int(latent_t)
    lw = token_logw(latent_t, holds, strength)
    for k, val in enumerate(lw):
        if val != 0.0:
            w[start + k * frame_rows: start + (k + 1) * frame_rows] = val
    return w


def parse_blocks(spec, default_all=True):
    """"" / "all" -> None (every block); "0-24" / "0,3,7-9" -> a set."""
    spec = (spec or "").strip().lower()
    if not spec or spec == "all":
        return None if default_all else set()
    out = set()
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return out


def parse_hold_map(hold_map):
    """The JSON H3 Time Smear speaks: {"holds": [...], "world_len": n}."""
    if not (hold_map or "").strip():
        raise ValueError("H3AttentionMeasure needs a hold map; wire "
                         "H3 Time Smear's hold_map_used into hold_map")
    m = json.loads(hold_map)
    holds = [int(h) for h in m["holds"]]
    if any(h < 1 for h in holds):
        raise ValueError("hold map has a hold < 1")
    return holds, int(m.get("world_len", len(holds)))


# --------------------------------------------------------------------------
# the override
# --------------------------------------------------------------------------

def _describe(fn):
    return "%s.%s" % (getattr(fn, "__module__", "?"),
                      getattr(fn, "__qualname__", type(fn).__name__))


def is_sparse_override(fn):
    if fn is None or getattr(fn, "mainodes_attention_measure", False):
        return False
    tag = _describe(fn).lower()
    return any(mark in tag for mark in _SPARSE_MARKERS)


def make_override(holds, strength, blocks=None, previous=None, state=None):
    """Build the optimized_attention_override callable.

    Signature per comfy/ldm/modules/attention.py:187-193: the wrapper takes
    the tensors out of their containers (we deliberately expose no
    `container_function`, so q/k/v arrive as plain tensors) and calls us as
    override(func, q, k, v, heads, **kwargs). `previous` chains an override
    that was already installed, the way sol_attn_minimax_v5.py:480-509 does.
    """
    cache = {}
    state = {"calls": 0} if state is None else state

    def override(func, q, k, v, heads, mask=None, attn_precision=None,
                 skip_reshape=False, skip_output_reshape=False, **kwargs):

        def dense(qq, kk, vv, sr, extra=None, sor=None):
            target = func if previous is None else _partial_previous(previous, func)
            kw = dict(kwargs)
            if extra:
                kw.update(extra)
            return target(qq, kk, vv, heads, mask=mask,
                          attn_precision=attn_precision, skip_reshape=sr,
                          skip_output_reshape=(skip_output_reshape
                                               if sor is None else sor), **kw)

        to = kwargs.get("transformer_options") or {}
        layout = to.get("mainodes_h3_layout")
        if layout is None:
            raise RuntimeError(
                "H3AttentionMeasure: no packed layout was published for this "
                "forward. The node installs a diffusion-model wrapper that "
                "stashes it; this attention call did not go through it "
                "(wrong model object, or a patch replaced the forward).")

        # BTHD either way: the backends accept skip_reshape=True for both.
        if skip_reshape:
            b, h, s, d = q.shape
        else:
            b, s, hd = q.shape
            d = hd // heads
            h = heads
            q = q.view(b, s, h, d).transpose(1, 2)
            k = k.view(b, k.shape[1], h, d).transpose(1, 2)
            v = v.view(b, v.shape[1], h, d).transpose(1, 2)

        if s != layout["seq_len"] or k.shape[2] != s:
            # the text token refiner runs its own short self-attention before
            # the packed sequence exists; it carries no video rows.
            return dense(q, k, v, True)

        idx = state["calls"]
        state["calls"] = idx + 1
        if blocks is not None and idx not in blocks:
            return dense(q, k, v, True)
        if d + PAD > 256:
            raise RuntimeError("H3AttentionMeasure: head_dim %d + %d exceeds "
                               "the 256 the attention backends allow" % (d, PAD))

        key = (s, d, layout["latent_t"], q.device.type, str(q.dtype))
        logw = cache.get(key)
        if logw is None:
            logw = row_logw(layout["segments"], layout["latent_t"], s,
                            holds, strength)
            logw = logw.to(device=q.device, dtype=q.dtype).view(1, 1, s, 1)
            cache[key] = logw

        # scale convention: every backend in comfy/ldm/modules/attention.py
        # uses kwargs["scale"] when given and dim_head ** -0.5 otherwise, on
        # the head dim it RECEIVES. We pin the scale to the ORIGINAL d so the
        # widened head does not change the temperature, and put the constant
        # on q so the resulting scaled logit is q.k / sqrt(d) + strength*logw.
        scale = kwargs.get("scale")
        if scale is None:
            scale = float(d) ** -0.5
        const = 1.0 / scale

        pad_q = q.new_zeros((b, h, s, PAD))
        pad_q[..., 0] = const
        pad_k = k.new_zeros((b, h, s, PAD))
        pad_k[..., 0:1] = logw
        # V IS WIDENED TOO. Every comfy backend derives the OUTPUT head width
        # from Q, not from V (attention.py:568 and :846,
        # `out.transpose(1, 2).reshape(b, -1, heads * dim_head)` with
        # dim_head read off q at :546). A wide q against a narrow v therefore
        # reshapes the result to the wrong width and raises. The appended v
        # channels are zeros, so the extra output channels are exactly zero
        # whatever the attention weights are, and they are sliced off here.
        # We always ask the backend for the unreshaped [b, heads, S, d] form
        # and do the caller's reshape ourselves on the sliced tensor.
        dv = v.shape[-1]
        pad_v = v.new_zeros(v.shape[:-1] + (PAD,))
        out = dense(torch.cat((q, pad_q), dim=-1),
                    torch.cat((k, pad_k), dim=-1),
                    torch.cat((v, pad_v), dim=-1), True,
                    extra={"scale": scale}, sor=True)
        out = out[..., :dv]
        if skip_output_reshape:
            return out
        return out.transpose(1, 2).reshape(out.shape[0], -1,
                                           out.shape[1] * dv)

    override.mainodes_attention_measure = True
    return override


def _partial_previous(previous, func):
    def call(*a, **kw):
        return previous(func, *a, **kw)
    return call


# --------------------------------------------------------------------------
# the node
# --------------------------------------------------------------------------

class H3AttentionMeasure:
    """Give every retimed video key the softmax mass of the world time it
    actually represents, instead of the mass its duplicate count buys it."""

    DESCRIPTION = (
        "ALPHA, hypothesis under test. Adds strength * log(1/duplication) to "
        "the pre-softmax logit of every TARGET VIDEO key, from the same hold "
        "map H3 Time Smear used to retime the clip. Held frames become "
        "several near-identical tokens, and plain attention gives that "
        "region several times the softmax mass; this is the correction for "
        "that, and only that. Audio, text, conditioning and reference rows "
        "are untouched.\n\n"
        "mode off = installs nothing. strength is a ladder: 1.0 is full "
        "compensation, 0.5 half, 0.0 none. A uniform hold map (all 1) is a "
        "no-op by construction, which is what the unit test gates on.\n\n"
        "Dense only: it refuses to install on top of a sparse-attention "
        "override, because a sparse pass drops keys and the measure "
        "correction would then be measuring the sparsifier.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "hold_map": ("STRING", {"forceInput": True,
                         "tooltip": "H3 Time Smear's hold_map_used (the JSON "
                                    "with holds + world_len)"}),
            "mode": (list(MODES), {"default": "log_measure",
                     "tooltip": "off installs nothing at all"}),
            "strength": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 4.0,
                         "step": 0.05,
                         "tooltip": "multiplies log w. 1.0 = full "
                                    "compensation, 0.0 = none"}),
        }, "optional": {
            "blocks": ("STRING", {"default": "",
                       "tooltip": "block range to weight, e.g. 0-24. Empty = "
                                  "all. Counted as the order of full-sequence "
                                  "attention calls inside one forward"}),
        }}

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "patch"
    CATEGORY = "model_patches/minimax/motion"

    def patch(self, model, hold_map, mode, strength, blocks=""):
        if mode not in MODES:
            raise ValueError("mode must be one of %s" % (MODES,))
        if mode == "off" or float(strength) == 0.0:
            log.info("H3AttentionMeasure: mode=%s strength=%s, nothing "
                     "installed", mode, strength)
            return (model,)

        holds, world_len = parse_hold_map(hold_map)
        sel = parse_blocks(blocks)

        m = model.clone()
        to = m.model_options.setdefault("transformer_options", {})
        previous = to.get("optimized_attention_override")
        if is_sparse_override(previous):
            raise RuntimeError(
                "H3AttentionMeasure runs dense: a sparse attention override "
                "(%s) is already installed on this model. Remove it, or "
                "bypass the sparse node, for this pass."
                % _describe(previous))
        if previous is not None:
            log.info("H3AttentionMeasure: chaining onto %s",
                     _describe(previous))

        state = {"calls": 0}
        to["optimized_attention_override"] = make_override(
            holds, float(strength), blocks=sel, previous=previous, state=state)
        m.add_wrapper_with_key(_wrappers_diffusion_model(),
                               "h3_attention_measure",
                               _make_layout_wrapper(state))

        n_held = sum(1 for h in holds if h > 1)
        log.info("H3AttentionMeasure: strength %.3f, %d of %d world frames "
                 "held (dilated %d), blocks %s", float(strength), n_held,
                 world_len, sum(holds), "all" if sel is None else sorted(sel))
        return (m,)


def _wrappers_diffusion_model():
    from comfy.patcher_extension import WrappersMP
    return WrappersMP.DIFFUSION_MODEL


def _make_layout_wrapper(state):
    """Publish the packed layout into transformer_options for one forward.

    H3's forward (model.py:559) receives `minimax_payload`, which carries the
    layout extra_conds prebuilt for the run; the attention override receives
    only transformer_options, so the layout has to be stashed here. The same
    wrapper resets the per-forward attention call counter that `blocks` uses,
    because H3 publishes no block index of its own.
    """
    def wrapper(executor, *args, **kwargs):
        to = args[3] if len(args) > 3 else kwargs.get("transformer_options")
        payload = kwargs.get("minimax_payload") or {}
        layout = payload.get("layout")
        state["calls"] = 0
        published = False
        if to is not None and layout is not None:
            x = args[0] if args else kwargs.get("x")
            latent_t = int(x[0].shape[2])
            to["mainodes_h3_layout"] = {"segments": list(layout.segments),
                                        "latent_t": latent_t,
                                        "seq_len": int(layout.seq_len)}
            published = True
        try:
            return executor(*args, **kwargs)
        finally:
            state["calls"] = 0
            if published:
                to.pop("mainodes_h3_layout", None)
    return wrapper


NODE_CLASS_MAPPINGS = {"H3AttentionMeasure": H3AttentionMeasure}
NODE_DISPLAY_NAME_MAPPINGS = {"H3AttentionMeasure": "H3 Attention Measure"}
