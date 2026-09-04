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

ONE LINE THAT LOOKS LIKE A DEVIATION FROM THE PR, AND IS NOT. The PR writes
`out[0] * denoise_mask`; this node writes the same product and casts the
result to the velocity's dtype. On a real render the two are bit-identical
(measured 2026-09-04, 4.98 M-element latent, both GPU and CPU), because core
hands the forward a mask that is ALREADY in the inference dtype:
`_apply_model` casts every extra cond with `convert_tensor(extra, dtype,
device)` (`comfy/model_base.py:232`), and the mask itself was quantised to
k/256 (`model_base.py:2232`), a grid bf16 represents exactly (all 257 values
checked). So both forms are bf16 velocity times bf16 mask, rounded once. The
cast here is a no-op on the real path and only matters in a unit test that
feeds a float32 mask. Even there the PR's float32 promotion is erased one
line downstream: `_apply_model` calls `model_output.float()` before CONST's
x0 conversion (`model_base.py:253`), so at m = 1 both forms are the off arm
to the bit. Upstream parity is therefore an EQUALITY test, fractional rows
included, not a tolerance. (An earlier version of this docstring claimed the
opposite, and claimed the cast was "slightly more precise": it is not, and
neither claim survived measurement.)

What the cast DOES protect is `out[1]`. The audio carry conversion right
after the wrapped call (`model.py:579`) rounds its coefficient to
`out[1].dtype`. A float32-promoted audio velocity would change that
coefficient (1.6016 in bf16 vs 1.6000 in fp32 at sigma_v = 0.5, shift 12/3)
and move audio at m = 1, so the stream keeps its own dtype.

NOT chosen, and why: keeping the video product in float32 (the output is
about to be `.float()`ed anyway) would remove one bf16 rounding on fractional
rows, rms 7.6e-4 against the model's own bf16 output rounding of 1.3e-3. It
costs nothing and sits below the sibling-take band, but it would leave this
node permanently one rounding away from upstream on exactly the rows the fix
exists for, and matching upstream is the whole reason the shim can be
trusted. Match the PR.

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


MODES = ("auto", "off", "on")
SCOPES = ("both", "video only", "audio only")


# --------------------------------------------------------------------------
# pure arithmetic: importable and testable with no ComfyUI present
# --------------------------------------------------------------------------

def scale_by_mask(tensor, mask):
    """`tensor * mask`, the PR's expression, cast to `tensor`'s dtype.

    Torch computes a bf16/fp16 product in float32 and rounds once, and
    promotes a mixed bf16 x fp32 product to float32, so this IS the float32
    product rounded once to the velocity's dtype in every case (tested
    against the explicit form in three dtypes). Bit-exact identity when every
    mask value is 1.0. On the real path the mask already carries the
    velocity's dtype (see the module docstring) and the cast is a no-op.
    """
    if mask is None:
        return tensor
    return (tensor * mask.to(device=tensor.device)).to(tensor.dtype)


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
        sig = (mask_summary(dm, "video mask"), mask_summary(am, "audio mask"))
        if sig != state.get("last"):
            # RECORD ON CHANGE, not once per run. A multi-pass graph runs pass 1
            # with no mask and pass 2 with the fractional one through the SAME
            # node instance, so a first-call-only probe records "no masks" and
            # says nothing about the pass the fix actually acts on.
            #
            # WHY A FILE AND NOT THE CONSOLE. Measured 2026-09-03: a log call
            # from inside a diffusion_model wrapper does not reach the journal,
            # while the node's own patch-time log on the SAME logger does, and
            # other modules' WARNINGs do. The mechanism was not chased; the
            # observation is enough to say the console is not a usable channel
            # from in here. This file is how a run proves the wrapper actually
            # executed and on what - the failure mode this node already hit
            # once was silent in every other channel.
            _note("%s | call %d | scope=%s | %s | %s"
                  % (_now(), state["calls"], scope, sig[0], sig[1]))
            state["last"] = sig
            state["first"] = state.get("first") or sig
        state["calls"] += 1
        if dm is None and am is None:
            return out
        return apply_mask_conversion(out, dm, am, scope)
    return wrapper


# --------------------------------------------------------------------------
# one helper, three entry points (the node below, H3 Core Compatibility,
# and H3StreamedBlocks)
# --------------------------------------------------------------------------

REPORTS = {
    "off": ("H3 mask conversion OFF: stock ComfyUI. Masked rows are evaluated "
            "at m*sigma and converted with the global sigma. This is the arm "
            "every pre-2026-09-03 fractional-mask result was measured on."),
    "native": ("H3 mask conversion not installed: the running core already "
               "scales the returned velocity by the denoise mask "
               "(#15988 semantics are native). Installing ours too would give "
               "mask^2 * v."),
    "legacy_no_model_mask": ("H3 mask conversion not installed: this core "
                             "predates #15375, so H3 never puts a masked row "
                             "at its own local sigma and there is nothing to "
                             "correct. The sampler's mask blending is "
                             "untouched."),
    "not_h3": ("H3 mask conversion not installed: this MODEL's diffusion_model "
               "is not a MiniMax H3 model. The correction is H3-specific and a "
               "generic diffusion_model mask scaler would be wrong."),
}


def core_mask_velocity_state():
    """`mask_velocity_conversion` from the capability probe, or 'unknown'.

    Kept as a module function on purpose: it is the single seam a test can
    stand a known core state on without a second ComfyUI checkout.
    """
    try:
        try:
            from . import h3_capabilities as caps      # inside the pack
        except ImportError:                            # loaded file-by-path
            import h3_capabilities as caps
        return caps.probe_core().get("mask_velocity_conversion", "unknown")
    except Exception as e:                             # noqa: BLE001
        log.warning("H3 mask conversion: capability probe failed (%s: %s); "
                    "treating the core as unknown", type(e).__name__, e)
        return "unknown"


def is_h3_model(model):
    """True when this ModelPatcher wraps a MiniMax H3 diffusion model."""
    dm = getattr(getattr(model, "model", None), "diffusion_model", None)
    if dm is None:
        return False
    for cls in type(dm).__mro__:
        if cls.__name__ == "MiniMaxH3Model":
            return True
        if "minimax" in (getattr(cls, "__module__", "") or "").lower():
            return True
    return False


def apply_h3_mask_velocity_compat(model, scope="both", mode="auto"):
    """Install the #15988 correction on `model` iff it is wanted and safe.

    Returns ``(model, report)``. The model is a clone whenever anything was
    installed, and the ORIGINAL object when nothing was.

    mode:
      auto  consult the capability probe. compat_needed -> install;
            native or legacy -> no-op with a report line; unknown -> warn and
            no-op (an unprovable core is the double-scaling risk).
      on    research override: install regardless of the core state.
      off   research override: install nothing.

    The install is idempotent: our key is removed before it is added, so a
    graph that runs H3StreamedBlocks and the compatibility node on the same
    chain ends with ONE wrapper, not a squared mask.
    """
    if mode not in MODES:
        raise ValueError("mode must be one of %s" % (MODES,))
    if scope not in SCOPES:
        raise ValueError("scope must be one of %s" % (SCOPES,))

    if mode == "off":
        log.info("H3 mask conversion: off, nothing installed")
        return model, REPORTS["off"]

    state = core_mask_velocity_state() if mode == "auto" else None
    if mode == "auto":
        if state in ("native", "legacy_no_model_mask"):
            log.info("H3 mask conversion: core state %s, nothing installed", state)
            return model, REPORTS[state]
        if state != "compat_needed":
            log.warning("H3 mask conversion NOT applied: core state=%s; refusing "
                        "to risk scaling the velocity twice. Run the H3 "
                        "Capability Probe to see who owns "
                        "MiniMaxH3Model.forward.", state)
            return model, (
                "H3 mask conversion not installed: the capability probe reports "
                "core state '%s', so it cannot be proven that nothing else "
                "already scales the velocity. Refusing rather than risking "
                "mask^2 * v. Force it with mode 'on' if you know the core."
                % state)

    if not is_h3_model(model):
        log.warning("H3 mask conversion NOT applied: diffusion_model is %s, not "
                    "MiniMax H3",
                    type(getattr(getattr(model, "model", None),
                                 "diffusion_model", None)).__name__)
        return model, REPORTS["not_h3"]

    m = model.clone()
    wtype = _wrappers_diffusion_model()
    try:
        # ALWAYS remove ours first. Both entry points may run on one chain,
        # and add_wrapper_with_key APPENDS to the key's list.
        m.remove_wrappers_with_key(wtype, WRAPPER_KEY)
    except AttributeError:                                  # pragma: no cover
        log.warning("H3 mask conversion: this ComfyUI's ModelPatcher has no "
                    "remove_wrappers_with_key; a second application would "
                    "stack a second wrapper")
    state_box = {"calls": 0, "first": None}
    m.add_wrapper_with_key(wtype, WRAPPER_KEY, _make_wrapper(scope, state_box))
    skipped = install_first(m)

    rep = ("H3 mask conversion ON (PR #15988), scope '%s'%s: the returned "
           "velocity is scaled by the denoise mask before the x0 conversion, "
           "so a row masked at m converts over m*sigma - the same distance it "
           "was evaluated at. Endpoints are unchanged; only rows strictly "
           "between 0 and 1 move. The product is the PR's own expression cast "
           "to the stream's dtype: bit-exact at m=1, and bit-identical to "
           "#15988 on a real render (core hands the wrapper a mask in the "
           "inference dtype), so parity with upstream is an equality."
           % (scope, ", core state 'compat_needed'" if mode == "auto"
              else ", forced by mode 'on'"))
    if skipped:
        rep += ("\n\nInstalled AHEAD of the diffusion_model wrapper(s) %s. "
                "A wrapper that calls executor.original() skips every wrapper "
                "after it (the SLA pack does), so being last would have made "
                "this node inert while still reporting success." % sorted(skipped))
    rep += "\n\nProof that it ran: %s (one line per change of mask shape)." % FIRED_LOG
    log.info("H3MaskConversion: on (mode %s), scope %s, ahead of %s",
             mode, scope, sorted(skipped) or "nothing else")
    return m, rep


class H3MaskConversion:
    """Install (or not) the #15988 fractional-mask velocity conversion."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip":
                    "the H3 model this pass samples with"}),
                "mode": (list(MODES), {"default": "auto", "tooltip":
                    "auto = ask the running core (H3 Capability Probe's "
                    "mask_velocity_conversion) and install only when it is "
                    "'compat_needed'; native, pre-#15375 and unprovable cores "
                    "get nothing. off = stock ComfyUI, the arm every "
                    "pre-2026-09-03 result was measured on. on = force PR "
                    "#15988 semantics, velocity scaled by the denoise mask "
                    "before the x0 conversion. off and on are the research "
                    "override: they are how an A/B is a widget instead of a "
                    "restart. A pass whose masks are all 0 or 1 renders "
                    "identically either way; only fractional rows move."}),
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
        return apply_h3_mask_velocity_compat(model, scope, mode)


NODE_CLASS_MAPPINGS = {"H3MaskConversion": H3MaskConversion}
NODE_DISPLAY_NAME_MAPPINGS = {"H3MaskConversion": "H3 Mask Conversion (#15988)"}
