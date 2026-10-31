"""Dials: training-free steering directions for MiniMax H3, built from prompt pairs (ported from ComfyUI-Dials).

A dial is one vector added to every prompt token, at one of two seams:
  post  after H3's token_refiner, exactly where the DiT reads the prompt ("hook"). Applied as a ModelPatcher object
        patch that wraps token_refiner.forward, so the module tree and weight paths stay unchanged and dials stack.
  pre   into the bias of `condition_proj` (text encoder output -> DiT hidden). Saved as a standard `<layer>.diff_b` LoRA
        key, so the stock LoRA loader applies it too. The token refiner sits between this seam and the DiT, so pre
        dials only approximate post dials; above ~1 (hook units) they wash out the prompt.

Making a dial: for each pair (A, B), d = mean_tokens(enc(B)) - mean_tokens(enc(A)) at the chosen seam, averaged over pairs,
with the generic "more wording" directions (from built-in nuisance pairs) projected out (debias). File format and
folder (models/loras/dials/) are shared with ComfyUI-Dials, so dials made by either pack load in both.
"""
import json
import os
import re

import torch
from safetensors import safe_open
from safetensors.torch import save_file

import comfy.model_management
import folder_paths

# diffusion model class -> (text projection layer the pre seam biases, text refiner whose output the post seam shifts)
TEXT_PROJECTIONS = {"MiniMaxH3Model": ("condition_proj", "token_refiner")}
NUISANCE_PAIRS = [
    "{subject}. ||| {subject}, seen on an ordinary afternoon in natural light.",
    "{subject} in a room. ||| {subject} in a room with a window, a wooden table and two chairs.",
    "{subject} wearing a blue shirt. ||| {subject} wearing a red shirt.",
    "{subject} near a tree. ||| {subject} near a lamp post on a quiet street.",
    "{subject} in the center of the frame. ||| {subject} on the right side of the frame, slightly out of focus.",
    "A photo of {subject}. ||| A detailed, carefully composed photograph of {subject} taken with a 50mm lens.",
]
NUISANCE_SUBJECTS = "A woman\nA man\nA dog\nAn old car"
DIAL_SUBDIR = "dials"
KEY_SUFFIX = {"pre": "diff_b", "post": "dials_shift"}  # file key: diffusion_model.<target>.<suffix>


def text_modules(model):
    dm = model.model.diffusion_model
    names = TEXT_PROJECTIONS.get(type(dm).__name__)
    if names is None:
        raise ValueError(f"Dials support {', '.join(TEXT_PROJECTIONS)} so far, got {type(dm).__name__}")
    return names, dm.get_submodule(names[0]), dm.get_submodule(names[1])


class ShiftedForward:
    """Replacement for a text module's forward that adds a dial vector to its output (installed as an object patch)."""

    def __init__(self, forward, shift):
        self.forward = forward
        self.shift = shift

    def __call__(self, x, *args, **kwargs):
        out = self.forward(x, *args, **kwargs)
        return out + self.shift.to(device=out.device, dtype=out.dtype)


def apply_dial(m, dial, strength):
    """Apply one dial to a cloned ModelPatcher in place, exactly as ComfyUI-Dials' Apply Dial does."""
    if dial["mode"] == "pre":
        m.add_patches({f"diffusion_model.{dial['target']}.bias": ("diff", (dial["vec"],))}, strength)
    else:
        name = f"diffusion_model.{dial['target']}.forward"
        m.add_object_patch(name, ShiftedForward(m.get_model_object(name), dial["vec"] * strength))


def parse_pairs(pairs, subjects):
    subs = [s.strip() for s in subjects.splitlines() if s.strip() and not s.strip().startswith("#")] or [None]
    out = []
    for line in pairs.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "|||" not in line:
            raise ValueError(f"each pair line needs 'A ||| B', got: {line[:80]}")
        a, b = (x.strip() for x in line.split("|||", 1))
        for s in subs:
            out.append((a.replace("{subject}", s), b.replace("{subject}", s)) if s else (a, b))
    if not out:
        raise ValueError("no prompt pairs given")
    return out


def dial_files():
    return [f for f in folder_paths.get_filename_list("loras") if f.replace("\\", "/").startswith(f"{DIAL_SUBDIR}/")]


def save_dial(dial, name):
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", name):
        raise ValueError("dial name: letters, digits, '_' and '-' only (max 80)")
    root = os.path.join(folder_paths.get_folder_paths("loras")[0], DIAL_SUBDIR)
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, f"{name}.safetensors")
    meta = {k: (v if isinstance(v, str) else json.dumps(v)) for k, v in dial["meta"].items()}
    save_file({f"diffusion_model.{dial['target']}.{KEY_SUFFIX[dial['mode']]}": dial["vec"].to(torch.bfloat16).contiguous()}, path, metadata=meta)
    return path


def load_dial(dial_name):
    path = folder_paths.get_full_path_or_raise("loras", dial_name)  # resolves inside the loras folders only
    with safe_open(path, "pt") as f:
        keys = list(f.keys())
        if len(keys) != 1 or not keys[0].startswith("diffusion_model."):
            raise ValueError(f"{dial_name} is not a dial file (expected one diffusion_model.<layer>.<diff_b|dials_shift> key)")
        vec = f.get_tensor(keys[0]).float()
        meta = dict(f.metadata() or {})
    target, suffix = keys[0][len("diffusion_model."):].rsplit(".", 1)
    mode = {v: k for k, v in KEY_SUFFIX.items()}.get(suffix)
    if mode is None:
        raise ValueError(f"{dial_name}: unknown dial key suffix '{suffix}'")
    meta.setdefault("name", os.path.splitext(os.path.basename(dial_name))[0])
    return {"vec": vec, "target": target, "mode": mode, "meta": meta}


def dial_label(dial):
    m = dial["meta"]
    return (f"{m.get('name', '?')} ({dial['mode']}_refiner, {dial['target']}): {m.get('n_pairs', '?')} pairs, "
            f"pair agreement cos {m.get('pair_agreement_cos', '?')}, |dial| {float(dial['vec'].norm()):.1f}")


def make_dial(clip, model, pairs, subjects, name, mode, debias=True, calibrate=True, nuisance_dims=3):
    """Returns (dial, report). mode: "post" (hook) or "pre" (LoRA file)."""
    (pre_name, post_name), proj, refiner = text_modules(model)
    prompts = parse_pairs(pairs, subjects)
    nuisance = parse_pairs("\n".join(NUISANCE_PAIRS), subjects if subjects.strip() else NUISANCE_SUBJECTS) if debias else []
    comfy.model_management.load_models_gpu([model])
    device = comfy.model_management.get_torch_device()
    dtype = model.model.get_dtype_inference()
    cache = {}

    def encode(text):  # -> (pre-refiner tokens, pre token mean, post token mean), means in float32
        if text not in cache:
            ctx = clip.encode_from_tokens_scheduled(clip.tokenize(text))[0][0][0].to(device, dtype)
            pre = proj(ctx)
            cache[text] = (pre, pre.float().mean(0), refiner(pre).float().mean(0))
        return cache[text]

    def diffs(pp, which):
        return torch.stack([encode(b)[which] - encode(a)[which] for a, b in pp])

    def nuisance_basis(which):
        if not nuisance:
            return None
        return torch.linalg.svd(diffs(nuisance, which), full_matrices=False)[2][:nuisance_dims].T  # [hidden, k]

    def remove(v, basis):
        return v - basis @ (basis.T @ v) if basis is not None else v

    which = 1 if mode == "pre" else 2
    d, basis = diffs(prompts, which), nuisance_basis(which)
    raw = d.mean(0)
    vec = remove(raw, basis)
    removed = 1 - float(vec.norm() ** 2 / raw.norm() ** 2)
    agree = float(torch.nn.functional.cosine_similarity(torch.stack([remove(x, basis) for x in d]), vec.unsqueeze(0)).mean())
    note = ""
    if calibrate and mode == "pre":
        # the refiner's final RMSNorm shrinks a pre-refiner shift: rescale so strength 1 = one average pair difference after it
        post_target = remove(diffs(prompts, 2).mean(0), nuisance_basis(2))
        probe = [t for pair in prompts[:8] for t in pair]
        shift = torch.stack([refiner(encode(t)[0] + vec.to(dtype)).float().mean(0) - encode(t)[2] for t in probe]).mean(0)
        along = float(shift @ (post_target / post_target.norm().clamp_min(1e-12)))
        scale = float(post_target.norm()) / along if along > 0 else 1.0
        vec = vec * scale
        note = f", calibrated x{scale:.2f}"
    dial = {"vec": vec.cpu(), "target": pre_name if mode == "pre" else post_name, "mode": mode,
            "meta": {"name": name, "pairs": prompts, "n_pairs": str(len(prompts)), "pair_agreement_cos": f"{agree:.3f}",
                     "inject": f"{mode}_refiner", "debias_removed": f"{removed:.3f}" if debias else "off",
                     "calibrated": str(bool(calibrate and mode == "pre")), "format": "ComfyUI-Dials v1"}}
    report = dial_label(dial) + (f"; debias removed {removed:.0%} of the raw dial (generic wording shift)" if debias else "") + note
    if agree < 0.4:
        report += "\nlow pair agreement: the pairs differ in more than one way; tighten the wording"
    return dial, report


def rack_report(rows):
    """rows: [(label, dial, strength)] actually applied. Norms, the combined post-refiner shift, and overlapping pairs."""
    if not rows:
        return "no active dials: model unchanged"
    lines = [f"{s:+.2f}  {label}  |dial| {float(d['vec'].norm()):.1f}  ({d['mode']})" for label, d, s in rows]
    post = [(label, d["vec"].float(), s) for label, d, s in rows if d["mode"] == "post"]
    if len(post) > 1:
        total = sum(s * v for _, v, s in post)
        biggest = max(abs(s) * float(v.norm()) for _, v, s in post)
        lines.append(f"combined post-refiner shift |{float(total.norm()):.1f}| (largest single row {biggest:.1f})")
        for i in range(len(post)):
            for j in range(i + 1, len(post)):
                c = float(torch.nn.functional.cosine_similarity(post[i][1], post[j][1], dim=0))
                if abs(c) >= 0.5:
                    lines.append(f"overlap: {post[i][0]} and {post[j][0]} cos {c:+.2f}" + (" (they reinforce)" if c > 0 else " (they cancel)"))
    return "\n".join(lines)
