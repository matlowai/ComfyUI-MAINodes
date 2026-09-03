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

import datetime
import logging
import os

import torch

log = logging.getLogger("MAINodes.h3_mask_conv")

# Where the wrapper records that it ran. Override per run so a night loop can
# keep one file per arm; the default is deliberately outside any git checkout.
FIRED_LOG = os.environ.get("MAINODES_MASKCONV_LOG", "/tmp/h3maskconv_fired.log")


def _now():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _note(line):
    """Append one line to FIRED_LOG. Never raises: a diagnostic must not be
    able to kill a render."""
    try:
        with open(FIRED_LOG, "a") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


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


WRAPPER_KEY = "h3_mask_conversion"


def reorder_first(wrappers, key):
    """Move `key` to the FRONT of a `{key: [wrapper, ...]}` dict, in place.

    THIS IS NOT COSMETIC. `WrapperExecutor` calls the list in order, each
    wrapper expected to call `executor(...)` so the next one runs. A wrapper
    that calls `executor.original(...)` instead jumps straight to the wrapped
    function and SILENTLY SKIPS EVERY WRAPPER AFTER IT.

    The SLA pack does exactly that (`ComfyUI-PlagueKind-Nodes-only-sparse/
    sla/patch.py:202`, `out = executor.original(...)`). Since a model patch
    node registers its wrapper when it runs, and SLA is wired before the
    sampler, anything downstream of SLA lands later in the list and never
    executes. This node was inert on every SLA graph until it was put first,
    and the failure was invisible: the node logged that it had installed, the
    render succeeded, and the arm silently reproduced the control.

    First is also the CORRECT position on its own merits: #15988 scales the
    velocity the model finally returns, so this wants to be the outermost
    wrapper, seeing whatever the rest of the chain produced.

    Returns the keys that were behind us and are now after us.
    """
    if key not in wrappers:
        return []
    others = [k for k in wrappers if k != key]
    mine = wrappers[key]
    kept = {k: wrappers[k] for k in others}
    wrappers.clear()
    wrappers[key] = mine
    wrappers.update(kept)
    return others


def install_first(patcher):
    """Put our diffusion_model wrapper ahead of every other one on `patcher`."""
    wrappers = patcher.wrappers.get(_wrappers_diffusion_model())
    if not wrappers:
        return []
    return reorder_first(wrappers, WRAPPER_KEY)


def _make_wrapper(scope, state):
    def wrapper(executor, *args, **kwargs):
        out = executor(*args, **kwargs)
        dm = kwargs.get("denoise_mask")
        am = kwargs.get("audio_denoise_mask")
        if state["calls"] == 0:
            # WHY A FILE AND NOT THE CONSOLE. Measured 2026-09-03: a log call
            # from inside a diffusion_model wrapper does not reach the journal,
            # while the node's own patch-time log on the SAME logger does, and
            # other modules' WARNINGs do. The mechanism was not chased; the
            # observation is enough to say the console is not a usable channel
            # from in here. This file is how a run proves the wrapper actually
            # executed and what mask shapes it saw - which matters because the
            # failure mode this node already hit once was silent.
            _note("%s | scope=%s | %s | %s"
                  % (_now(), scope, mask_summary(dm, "video mask"),
                     mask_summary(am, "audio mask")))
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
                               WRAPPER_KEY,
                               _make_wrapper(scope, state))
        skipped = install_first(m)
        rep = ("H3 mask conversion ON (PR #15988), scope '%s': the returned "
               "velocity is scaled by the denoise mask before the x0 "
               "conversion, so a row masked at m converts over m*sigma - the "
               "same distance it was evaluated at. Endpoints are unchanged; "
               "only rows strictly between 0 and 1 move. Multiplication is "
               "done in float32 and cast back, which is bit-exact at m=1 "
               "(the PR promotes instead, so the last bits will differ from "
               "a future upstream merge)." % scope)
        if skipped:
            rep += ("\n\nInstalled AHEAD of the diffusion_model wrapper(s) %s. "
                    "A wrapper that calls executor.original() skips every "
                    "wrapper after it (the SLA pack does), so being last would "
                    "have made this node inert while still reporting success."
                    % sorted(skipped))
        log.info("H3MaskConversion: on, scope %s, ahead of %s",
                 scope, sorted(skipped) or "nothing else")
        return (m, rep)


NODE_CLASS_MAPPINGS = {"H3MaskConversion": H3MaskConversion}
NODE_DISPLAY_NAME_MAPPINGS = {"H3MaskConversion": "H3 Mask Conversion (#15988)"}
