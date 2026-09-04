"""H3 capability probe and block-patch collision report (alpha, 2026-08-23).

Two questions a graph cannot answer from a ComfyUI version string, because
users run stable, stale nightlies and same-day checkouts interchangeably:

1. What can the RUNNING core do for H3? Per-token latent masks (#15375),
   arbitrary guide positions and clip guides (#15439), references that
   compose with keyframes, the tokenizer special tokens (#15808), the two
   condition-row noise-aug dials, the TAE decoder, the 2 fps Qwen view.
   Every answer here is read from the installed source, never from a
   version number, so a nightly that carries the commit answers yes and a
   tagged release that does not answers no.

2. Who else has a hand on the model? Several packs replace H3's double
   blocks through ``set_model_patch_replace`` (this pack's Streamed Blocks,
   first/last-block caches), several replace ``_forward`` or the final layer
   through object patches (Sol packs, this pack's trim_forward), and some
   rewrite the core classes at import time. Comfy keeps ONE replacement per
   block key, so stacking is last-writer-wins and silent. This module lists
   the owners before Streamed Blocks installs so the collision is loud.

Nothing here changes a render. The node passes MODEL through untouched and
prints; the hook in Streamed Blocks only logs.
"""
from __future__ import annotations

import inspect
import logging
import os
import re
import subprocess
import sys

log = logging.getLogger("MAINodes.h3_capabilities")

MINIMAX_EXTRA_TOKENS = ("<d>", "</d>", "<|cutoff|>", "<|lyrics_start|>",
                        "<|lyrics_end|>", "<|caption_start|>", "<|caption_end|>")


def _src(mod):
    try:
        return inspect.getsource(mod)
    except Exception:  # noqa: BLE001
        return ""


def _import(name):
    try:
        return __import__(name, fromlist=["*"])
    except Exception:  # noqa: BLE001
        return None


def _comfy_root():
    m = _import("comfy.model_base")
    if m is None:
        return None
    return os.path.dirname(os.path.dirname(os.path.abspath(m.__file__)))


def _git_head(root):
    if not root or not os.path.isdir(os.path.join(root, ".git")):
        return None
    try:
        out = subprocess.run(["git", "-C", root, "log", "-1", "--format=%h %cs"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except Exception:  # noqa: BLE001
        return None


# ---- #15988: is the mask-velocity conversion native, needed, or unsafe? -----
#
# H3 evaluates a row masked at m as if it were at `m * sigma` (#15375, merged
# 2026-08-18), but the outer CONST conversion still divides by the GLOBAL
# sigma, so a fractional row converts over the wrong distance. Community PR
# #15988 fixes it with two multiplications inserted after the wrapped
# `_forward` and before the audio carry. This pack can install the same
# correction as a DIFFUSION_MODEL wrapper (h3_mask_conv.py) - but only when
# nothing else already does it, because a second multiplication gives
# `mask^2 * v`, which is a WORSE error than the bug.
#
# So the detector is deliberately asymmetric: it must never say
# `compat_needed` when some other implementation could already be scaling.
# Everything it cannot prove is `unknown`, and `unknown` means hands off.
#
# Whitespace and `*=` variants are tolerated; the PR may be reformatted or
# rebased before it merges, and a hash would be stale the day it lands.
_MASK_MULT_VIDEO = re.compile(
    r"out\s*\[\s*0\s*\]\s*(?:\*=|=\s*out\s*\[\s*0\s*\]\s*\*)\s*denoise_mask\b")
_MASK_MULT_AUDIO = re.compile(
    r"out\s*\[\s*1\s*\]\s*(?:\*=|=\s*out\s*\[\s*1\s*\]\s*\*)\s*audio_denoise_mask\b")
# the wrapped call: `WrapperExecutor.new_class_executor(self._forward, ...)`
_WRAPPED_FORWARD = re.compile(r"WrapperExecutor[\s\S]{0,400}?self\._forward")
# the outer audio carry, a single line assigning out[1] from the carried variable
_AUDIO_CARRY = re.compile(r"^[^\n\S]*out\s*\[\s*1\s*\]\s*=[^\n]*\bcarry\b[^\n]*$", re.M)

MASK_VELOCITY_STATES = ("native", "compat_needed", "legacy_no_model_mask", "unknown")


def classify_mask_velocity(forward_src, forward_owner, per_token_masks):
    """The `mask_velocity_conversion` state from `MiniMaxH3Model.forward` alone.

    ``forward_src`` is the source of THAT FUNCTION, not of the module: the
    module also holds tests, comments and the `mask_row_values` helper, any of
    which could spell the two multiplications without performing them.

    ``per_token_masks`` is the #15375 capability (True / False / "unknown").
    """
    src = forward_src or ""
    video = bool(_MASK_MULT_VIDEO.search(src))
    audio = bool(_MASK_MULT_AUDIO.search(src))
    if video and audio:
        # Someone already scales BOTH streams at the right point: core after
        # #15988 merges, or a pack that carries it. Either way we install
        # nothing. Ownership is not consulted here on purpose - the risk this
        # state exists to avoid is double scaling.
        return "native"
    if per_token_masks is False:
        # pre-#15375: no model-side local row timestep exists to correct
        return "legacy_no_model_mask"
    if video or audio:
        return "unknown"          # half a fix; completing it is not our call
    if per_token_masks is not True:
        return "unknown"          # comfy.model_base source unreadable
    if not src:
        return "unknown"          # forward source unreadable (compiled/exec'd)
    w = _WRAPPED_FORWARD.search(src)
    if w is None:
        return "unknown"          # no WrapperExecutor: our wrapper would never fire
    c = _AUDIO_CARRY.search(src)
    if c is None or c.start() < w.end():
        return "unknown"          # carry missing, or BEFORE the wrapped call
    if forward_owner != "comfy core":
        return "unknown"          # a foreign rewrite; its semantics are unproven
    return "compat_needed"


H3_MODEL_MODULE = "comfy.ldm.minimax.model"


def _forward_owner(fn):
    """Owner label for a core method, from BOTH its file and its __module__.

    `_owner_of` reads `co_filename`, which is the harder of the two to fake;
    `__module__` catches the case where a pack assigns a function it defined
    elsewhere onto the class. A rewrite this pack has actually met on disk
    reassigns `MiniMaxH3Model.forward`, `._forward` and `FinalLayer.forward`
    process-wide at node-execution time, so the class object alone proves
    nothing about what will run: both signals must say core, or the answer is
    the pack, and the mask-velocity state degrades to `unknown`.
    """
    owner = _owner_of(fn)
    mod = getattr(fn, "__module__", None)
    if owner == "comfy core" and mod and mod != H3_MODEL_MODULE:
        return mod
    return owner


def _h3_forward():
    """(source, owner) of the running `MiniMaxH3Model.forward`."""
    h3m = _import("comfy.ldm.minimax.model")
    cls = getattr(h3m, "MiniMaxH3Model", None) if h3m is not None else None
    fn = getattr(cls, "forward", None) if cls is not None else None
    if fn is None:
        return "", "?"
    return _src(fn), _forward_owner(fn)


def probe_core() -> dict:
    """Capabilities of the running ComfyUI for H3, read from source.

    Values: True / False / "unknown" (module missing or source unreadable).
    Keys are stable; new keys append.
    """
    caps = {}
    root = _comfy_root()
    caps["comfy_root"] = root
    caps["comfy_commit"] = _git_head(root)

    mb = _import("comfy.model_base")
    s = _src(mb)
    if not s:
        caps.update(per_token_masks="unknown", keyframe_plus_refs="unknown",
                    visual_cond_noise_aug="unknown", audio_cond_noise_aug="unknown")
    else:
        # #15375: masks pooled to the 2x2 token grid and audio latent frames
        caps["per_token_masks"] = "_pool_masks_to_token_grid" in s
        # refs APPEND to the keyframe list (fixed); the old code overwrote it
        if 'payload.get("cond_video_latents", []) +' in s:
            caps["keyframe_plus_refs"] = "native"
        elif "cond_video_latents" in s:
            caps["keyframe_plus_refs"] = "BROKEN (refs overwrite keyframes)"
        else:
            caps["keyframe_plus_refs"] = "unknown"
        caps["visual_cond_noise_aug"] = "minimax_visual_cond_noise_aug" in s
        caps["audio_cond_noise_aug"] = "minimax_audio_cond_noise_aug" in s

    h3m = _import("comfy.ldm.minimax.model")
    s = _src(h3m)
    caps["arbitrary_keyframe_position"] = ("resolved_frame_index" in s) if s else "unknown"
    caps["mask_rows_fractional"] = ("def mask_row_values" in s) if s else "unknown"
    _fsrc, _fowner = _h3_forward()
    caps["mask_velocity_conversion"] = classify_mask_velocity(
        _fsrc, _fowner, caps.get("per_token_masks"))
    caps["h3_forward_owner"] = _fowner

    nodes = _import("comfy_extras.nodes_minimax_h3")
    s = _src(nodes)
    if not s:
        caps.update(clip_guide="unknown", audio_guide="unknown", qwen_ref_video_2fps="unknown",
                    length_rounds_up="unknown")
    else:
        caps["clip_guide"] = "guide_frames % 17 != 5" in s or "guide_frames -= 1" in s
        caps["audio_guide"] = 'Input("audio"' in s and "AddGuide" in s
        caps["qwen_ref_video_2fps"] = "FPS // 2" in s
        caps["length_rounds_up"] = "def align_frame_count" in s

    tok = _import("comfy.text_encoders.minimax")
    s = _src(tok)
    caps["tokenizer_special_tokens"] = ("MINIMAX_EXTRA_TOKENS" in s) if s else "unknown"

    sd = _import("comfy.sd")
    s = _src(sd)
    caps["tae_h3_decoder"] = ("decoder.22.bias" in s and "MiniMax H3" in s) if s else "unknown"

    caps["sageattention"] = _import("sageattention") is not None
    return caps


# ---- who else patches H3 ---------------------------------------------------

_KNOWN_OWNERS = {
    # module-path fragment -> human label (kept coarse: the pack directory)
}


def _owner_of(fn):
    """custom_nodes/<pack> that a callable lives in, or 'comfy core', or module name."""
    try:
        code = getattr(fn, "__code__", None) or getattr(getattr(fn, "__call__", None), "__code__", None)
        path = code.co_filename if code else inspect.getfile(fn)
    except Exception:  # noqa: BLE001
        path = getattr(fn, "__module__", "?")
    path = str(path).replace("\\", "/")
    if "/custom_nodes/" in path:
        return path.split("/custom_nodes/", 1)[1].split("/", 1)[0]
    if "/comfy/" in path or "/comfy_extras/" in path:
        return "comfy core"
    return path


def block_patch_report(model=None) -> dict:
    """Every hand on the H3 model: block replacements, object patches,
    transformer_options keys, and import-time rewrites of the core classes.

    ``model`` is a ModelPatcher (optional). Without it only the import-time
    rewrites and loaded packs are reported.
    """
    rep = {"double_block_owners": {}, "object_patches": {}, "transformer_options": {},
           "class_rewrites": {}, "loaded_h3_packs": []}

    if model is not None:
        try:
            to = model.model_options.get("transformer_options", {})
            blocks = to.get("patches_replace", {}).get("dit", {})
            for key, fn in blocks.items():
                rep["double_block_owners"].setdefault(_owner_of(fn), []).append(key)
            for k, v in to.items():
                if k in ("patches_replace", "patches"):
                    continue
                rep["transformer_options"][k] = _owner_of(v) if callable(v) else type(v).__name__
            for name, obj in getattr(model, "object_patches", {}).items():
                rep["object_patches"][name] = _owner_of(obj)
        except Exception as e:  # noqa: BLE001
            rep["error"] = f"{type(e).__name__}: {e}"

    h3m = _import("comfy.ldm.minimax.model")
    if h3m is not None:
        for cls_name, attrs in (("MiniMaxH3Model", ("forward", "_forward")),
                                ("DiTBlock", ("forward",)),
                                ("Attention", ("forward",)),
                                ("FinalLayer", ("forward",))):
            cls = getattr(h3m, cls_name, None)
            if cls is None:
                continue
            for a in attrs:
                fn = getattr(cls, a, None)
                if fn is None:
                    continue
                owner = _owner_of(fn)
                if owner != "comfy core":
                    rep["class_rewrites"][f"{cls_name}.{a}"] = owner

    for name in list(sys.modules):
        if "custom_nodes" not in name and not name.startswith("custom_nodes"):
            continue
        low = name.lower()
        if any(t in low for t in ("minimax", "h3", "sol")):
            top = name.split(".")[1] if name.startswith("custom_nodes.") else name.split(".")[0]
            if top not in rep["loaded_h3_packs"]:
                rep["loaded_h3_packs"].append(top)
    return rep


def collision_warnings(report: dict, me: str = "ComfyUI-MAINodes") -> list:
    """Lines worth shouting about before this pack installs its own patches."""
    out = []
    for owner, keys in report.get("double_block_owners", {}).items():
        if owner != me:
            out.append(f"double_block replacement already owned by {owner} on {len(keys)} block(s) "
                       f"(e.g. {keys[0]}); Comfy keeps ONE replacement per block, the last install wins")
    for name, owner in report.get("object_patches", {}).items():
        if owner != me and ("_forward" in name or "final_layer" in name or "diffusion_model" in name):
            out.append(f"object patch {name} already owned by {owner}")
    for name, owner in report.get("class_rewrites", {}).items():
        out.append(f"core class {name} was rewritten at import time by {owner}; every model in this process sees it")
    return out


def format_report(caps: dict, rep: dict) -> str:
    lines = ["H3 capabilities (read from the installed source, not a version number)"]
    if caps.get("comfy_commit"):
        lines.append(f"  comfy: {caps['comfy_commit']}  ({caps.get('comfy_root')})")
    order = ("per_token_masks", "mask_rows_fractional", "mask_velocity_conversion",
             "clip_guide", "audio_guide",
             "arbitrary_keyframe_position", "keyframe_plus_refs", "length_rounds_up",
             "tokenizer_special_tokens", "visual_cond_noise_aug", "audio_cond_noise_aug",
             "qwen_ref_video_2fps", "tae_h3_decoder", "sageattention")
    notes = {
        "per_token_masks": "#15375 (2026-08-18): pin existing content with a latent mask; preferred over guides for continuation",
        "tokenizer_special_tokens": "#15808 (2026-08-22): <d> and six other tags tokenize as ONE token; dialogue/audio readings before it are suspect",
        "keyframe_plus_refs": "references and keyframe anchors in one graph; BROKEN on v0.33.1 and earlier",
        "mask_rows_fractional": "the H3 path accepts fractional mask rows; the generic mask path rounds to binary first",
        "length_rounds_up": "generation length rounds UP to 17k+5; clip guides and ref video round DOWN",
    }
    mvc_notes = {
        "native": "#15988 behaviour present in MiniMaxH3Model.forward; the MAINodes shim stays OFF",
        "compat_needed": "#15988 NOT native; H3 Core Compatibility / H3 Mask Conversion can correct it",
        "legacy_no_model_mask": "pre-#15375 core: no model-side mask timesteps, nothing to correct",
        "unknown": "cannot prove who scales the velocity; the shim stays OFF rather than risk mask^2*v",
    }
    for k in order:
        v = caps.get(k, "unknown")
        tag = {True: "yes", False: "NO"}.get(v, str(v))
        n = notes.get(k, "")
        if k == "mask_velocity_conversion":
            n = mvc_notes.get(str(v), "")
            if str(v) == "unknown" and caps.get("h3_forward_owner") not in (None, "comfy core", "?"):
                n += f" (MiniMaxH3Model.forward is owned by {caps['h3_forward_owner']})"
            tag = f"{tag:20s}"
        lines.append(f"  {k:28s} {tag:10s} {n}")
    lines.append("who has a hand on this model")
    if rep.get("double_block_owners"):
        for owner, keys in rep["double_block_owners"].items():
            lines.append(f"  double_block x{len(keys):<3d} {owner}")
    else:
        lines.append("  double_block       none (stock blocks)")
    for name, owner in rep.get("object_patches", {}).items():
        lines.append(f"  object_patch       {name} <- {owner}")
    for name, owner in rep.get("transformer_options", {}).items():
        lines.append(f"  transformer_option {name} <- {owner}")
    for name, owner in rep.get("class_rewrites", {}).items():
        lines.append(f"  CLASS REWRITE      {name} <- {owner}")
    if rep.get("loaded_h3_packs"):
        lines.append("  loaded H3 packs    " + ", ".join(sorted(rep["loaded_h3_packs"])))
    warns = collision_warnings(rep)
    if warns:
        lines.append("WARNINGS")
        lines += ["  " + w for w in warns]
    return "\n".join(lines)


class H3CapabilityProbe:
    """Print what the running core can do for H3 and who else patches the model."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {},
                "optional": {"model": ("MODEL", {"tooltip": "optional: list the block replacements and object patches already on this model"})}}

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "probe"
    CATEGORY = "MAINodes/alpha"
    OUTPUT_NODE = True
    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-23. Reads the installed ComfyUI source to say "
        "whether per-token masks (#15375), clip/audio guides and arbitrary positions (#15439), "
        "references alongside keyframes, the tokenizer special-token fix (#15808), the "
        "condition noise-aug dials and the H3 TAE are present, and lists every pack that has "
        "replaced a double block, patched _forward or the final layer, or rewrote a core class. "
        "Passes MODEL through untouched. Nothing here changes a render.")

    def probe(self, model=None):
        caps = probe_core()
        rep = block_patch_report(model)
        text = format_report(caps, rep)
        log.info("\n" + text)
        return {"ui": {"text": [text]}, "result": (model, text)}


NODE_CLASS_MAPPINGS = {"H3CapabilityProbe": H3CapabilityProbe}
NODE_DISPLAY_NAME_MAPPINGS = {"H3CapabilityProbe": "H3 Capability Probe (alpha)"}
