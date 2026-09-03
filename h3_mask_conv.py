"""H3 Mask Conversion (alpha): the ComfyUI #15988 fractional-mask fix as a
switchable instrument, so off/on is a graph parameter instead of a restart.

WHY. H3 puts a masked row at its OWN noise level: mask value m sends that row
into the network labelled `sigma_local = m * sigma`
(`comfy/ldm/minimax/model.py:619-641`, whose own comment says so). The network
therefore returns a velocity appropriate to `m * sigma`. But the outer CONST
conversion that turns velocity into x0 uses the GLOBAL sigma:

    x0 = x - sigma * v          what happens
    x0 = x - sigma * (m * v)    what the local label implies

Community PR #15988 (comfyanonymous/ComfyUI, author `poorpaper`, fixes #15981,
OPEN and unmerged as of 2026-09-03) closes that by scaling the returned
velocity by the mask before the conversion. Six lines, inserted immediately
after the wrapped `_forward` and BEFORE the audio carry conversion
(`model.py:572-579`).

ENDPOINTS ARE NOT AFFECTED, only fractional values. The sampler composites the
result anyway (`comfy/samplers.py:642`,
`out = out * denoise_mask + latent_image * (1 - denoise_mask)`), so a row at
m = 0 is replaced by the clean latent whatever the model said, and a row at
m = 1 is multiplied by one. Every row strictly between 0 and 1 changes.

WHAT THIS DOES. It installs a `WrappersMP.DIFFUSION_MODEL` wrapper, which sits
at exactly the PR's insertion point: core calls `_forward` through
`WrapperExecutor` (`model.py:572-577`) and applies the audio carry right after
(`:579`), so a wrapper's return value IS the `out` the PR edits. No core edit,
no restart, and the arm becomes a widget on one warm process.

ONE DELIBERATE DEVIATION FROM THE PR. The PR writes `out[0] * denoise_mask`
directly, which promotes a bf16 latent to the mask's float32 and so is not a
bit-exact identity at m = 1. This node multiplies in float32 and casts back to
the tensor's original dtype, which IS bit-exact at m = 1 (and slightly more
precise for fractional values). That matters because the m = 1 no-op is the
acceptance gate for the whole re-baseline: if `on` and `off` are not identical
when every mask value is one, the instrument is wrong and every cell behind it
is void. Numbers from this node will therefore not match a future upstream
merge in the last bits.

`scope` factors the two streams, because a shipped chain graph can carry three
different fractional paths at once (audio_strength, the prefix release ramp,
and H3DriftControl's per-step mask) and a whole-graph off/on cannot say which
one moved.

Wire: between the model and the sampler, like any model patch. It is a no-op
on any pass whose masks are all ones, and on any pass with no mask at all.
"""

import logging

import torch

log = logging.getLogger("MAINodes.h3_mask_conv")

MODES = ("off", "on")
SCOPES = ("both", "video only", "audio only")


# --------------------------------------------------------------------------
# pure arithmetic: importable and testable with no ComfyUI present
# --------------------------------------------------------------------------

def scale_by_mask(tensor, mask):
    """`tensor * mask` in float32, cast back to `tensor`'s dtype.

    Bit-exact identity when every mask value is 1.0: the float32 round trip is
    exact for bf16 / fp16 / fp32, and multiplying by one is exact.
    """
    if mask is None:
        return tensor
    m = mask.to(device=tensor.device, dtype=torch.float32)
    return (tensor.to(torch.float32) * m).to(tensor.dtype)


def apply_mask_conversion(out, denoise_mask, audio_denoise_mask, scope="both"):
    """The #15988 correction over a `[video, audio]` model output.

    Returns a NEW list; the input is not mutated. Streams the scope excludes
    are passed through by reference, unchanged.
    """
    if scope not in SCOPES:
        raise ValueError("scope must be one of %s" % (SCOPES,))
    res = list(out)
    if scope in ("both", "video only") and len(res) > 0:
        res[0] = scale_by_mask(res[0], denoise_mask)
    if scope in ("both", "audio only") and len(res) > 1:
        res[1] = scale_by_mask(res[1], audio_denoise_mask)
    return res


def mask_summary(mask, name):
    """A one-line description of how fractional a mask actually is.

    The re-baseline needs to know, per render, whether the pass had anything
    for the fix to change at all. `frac` counts values strictly between 0 and
    1; if it is zero the node cannot have altered this stream.
    """
    if mask is None:
        return "%s: none" % name
    m = mask.detach().to(torch.float32).reshape(-1)
    n = int(m.numel())
    zero = int((m <= 1e-6).sum())
    one = int((m >= 1.0 - 1e-6).sum())
    frac = n - zero - one
    return ("%s: %d rows, %d at 0, %d at 1, %d fractional"
            % (name, n, zero, one, frac))


# --------------------------------------------------------------------------
# the wrapper
# --------------------------------------------------------------------------

def _wrappers_diffusion_model():
    from comfy.patcher_extension import WrappersMP
    return WrappersMP.DIFFUSION_MODEL


def _make_wrapper(scope, state):
    def wrapper(executor, *args, **kwargs):
        out = executor(*args, **kwargs)
        dm = kwargs.get("denoise_mask")
        am = kwargs.get("audio_denoise_mask")
        if state["calls"] == 0:
            # once per run, so the ledger and the console can say whether this
            # pass had any fractional row for the fix to act on
            log.info("H3MaskConversion: scope=%s | %s | %s", scope,
                     mask_summary(dm, "video mask"),
                     mask_summary(am, "audio mask"))
            state["first"] = (mask_summary(dm, "video mask"),
                              mask_summary(am, "audio mask"))
        state["calls"] += 1
        if dm is None and am is None:
            return out
        return apply_mask_conversion(out, dm, am, scope)
    return wrapper


class H3MaskConversion:
    """Install (or not) the #15988 fractional-mask velocity conversion."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip":
                    "the H3 model this pass samples with"}),
                "mode": (list(MODES), {"default": "off", "tooltip":
                    "off = stock ComfyUI, the arm every existing result was "
                    "measured on. on = PR #15988 semantics, velocity scaled "
                    "by the denoise mask before the x0 conversion. A pass "
                    "whose masks are all 0 or 1 renders identically either "
                    "way; only fractional rows move."}),
            },
            "optional": {
                "scope": (list(SCOPES), {"default": "both", "tooltip":
                    "which stream the correction applies to. A shipped chain "
                    "graph can carry three fractional paths at once "
                    "(audio_strength, the prefix release ramp, and drift "
                    "control's per-step mask); use this to say which one "
                    "moved the result."}),
            },
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "patch"
    CATEGORY = "model_patches/minimax/motion"
    DESCRIPTION = __doc__

    def patch(self, model, mode, scope="both"):
        if mode not in MODES:
            raise ValueError("mode must be one of %s" % (MODES,))
        if scope not in SCOPES:
            raise ValueError("scope must be one of %s" % (SCOPES,))

        if mode == "off":
            rep = ("H3 mask conversion OFF: stock ComfyUI. Masked rows are "
                   "evaluated at m*sigma and converted with the global sigma. "
                   "This is the arm every pre-2026-09-03 fractional-mask "
                   "result was measured on.")
            log.info("H3MaskConversion: off, nothing installed")
            return (model, rep)

        m = model.clone()
        state = {"calls": 0, "first": None}
        m.add_wrapper_with_key(_wrappers_diffusion_model(),
                               "h3_mask_conversion",
                               _make_wrapper(scope, state))
        rep = ("H3 mask conversion ON (PR #15988), scope '%s': the returned "
               "velocity is scaled by the denoise mask before the x0 "
               "conversion, so a row masked at m converts over m*sigma - the "
               "same distance it was evaluated at. Endpoints are unchanged; "
               "only rows strictly between 0 and 1 move. Multiplication is "
               "done in float32 and cast back, which is bit-exact at m=1 "
               "(the PR promotes instead, so the last bits will differ from "
               "a future upstream merge)." % scope)
        log.info("H3MaskConversion: on, scope %s", scope)
        return (m, rep)


NODE_CLASS_MAPPINGS = {"H3MaskConversion": H3MaskConversion}
NODE_DISPLAY_NAME_MAPPINGS = {"H3MaskConversion": "H3 Mask Conversion (#15988)"}
