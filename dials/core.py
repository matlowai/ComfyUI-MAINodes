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

Two pair-text extensions (MAINodes only):
  ! A ||| B      a hold pair: the mean of these pairs is projected out of the dial, so the dial cannot move that quality
                 (e.g. an expressive-face dial that keeps the voice's loudness unchanged).
  ![name] A ||| B  a named hold group: each group's mean is projected out separately; unnamed holds form group "".
  (words:w)      inside A or B: those words count w times what they add to the text around them, i.e.
                 enc = enc(text without the span) + w * (enc(text) - enc(text without the span)), in token-mean space.
                 H3's tokenizer ignores prompt weights, so this is the only place the syntax means anything.
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
    """-> (pairs, {name: hold pairs}); bare '!' lines belong to group ""."""
    subs = [s.strip() for s in subjects.splitlines() if s.strip() and not s.strip().startswith("#")] or [None]
    out, holds = [], {}
    for line in pairs.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        dest = out
        if line.startswith("!"):
            line = line.lstrip("!").strip()
            group = ""
            if line.startswith("["):
                if "]" not in line:
                    raise ValueError("named hold pair needs '![name] A ||| B'")
                group, line = line[1:].split("]", 1)
                group, line = group.strip(), line.strip()
            dest = holds.setdefault(group, [])
        if "|||" not in line:
            raise ValueError(f"each pair line needs 'A ||| B', got: {line[:80]}")
        a, b = (x.strip() for x in line.split("|||", 1))
        for s in subs:
            dest.append((a.replace("{subject}", s), b.replace("{subject}", s)) if s else (a, b))
    if not out:
        raise ValueError("no prompt pairs given")
    return out, holds


def hold_basis(directions, nuisance):
    """One column per group; redundant groups contribute zero. Keep the original one-group arithmetic."""
    if len(directions) == 1:
        h = directions[0]
        h = h - nuisance @ (nuisance.T @ h) if nuisance is not None else h
        return (h / h.norm()).unsqueeze(1)
    basis = nuisance if nuisance is not None else directions[0].new_empty((directions[0].numel(), 0))
    columns = []
    for h in directions:
        unit = (h / h.norm().clamp_min(1e-12)).unsqueeze(1)
        q, r = torch.linalg.qr(torch.cat((basis, unit), dim=1), mode="reduced")
        tol = torch.finfo(h.dtype).eps * max(q.shape)
        if basis.shape[1] < h.numel() and abs(float(r[-1, -1])) > tol:
            columns.append(basis.shape[1])
            basis = q
        else:
            columns.append(None)
    return torch.stack([basis[:, i] if i is not None else torch.zeros_like(directions[0]) for i in columns], dim=1)


WEIGHTED_SPAN = re.compile(r"\(([^():]+):\s*(-?\d+(?:\.\d+)?)\)")


def weighted_terms(text):
    """'(words:w)' markup -> [(prompt, coefficient)]; the coefficient-weighted sum of the prompts' encodings is the weighted
    encoding. Each span adds w times its own contribution over the text without any spans (first order, no cross terms)."""
    spans = list(WEIGHTED_SPAN.finditer(text))
    if not spans:
        return [(text, 1.0)]

    def keep(i):
        out, pos = [], 0
        for j, m in enumerate(spans):
            out += [text[pos:m.start()], m.group(1) if j == i else ""]
            pos = m.end()
        return re.sub(r" ([,.;:!?])", r"\1", re.sub(r"\s+", " ", "".join(out + [text[pos:]]))).strip()

    weights = [float(m.group(2)) for m in spans]
    terms = [(keep(None), 1.0 - sum(weights))] + [(keep(i), w) for i, w in enumerate(weights)]
    return [(t, c) for t, c in terms if c != 0]


def plain_text(text):
    return WEIGHTED_SPAN.sub(r"\1", text)


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


def nuisance_basis(diffs, dims):
    return torch.linalg.svd(diffs, full_matrices=False)[2][:dims].T


def make_dial(clip, model, pairs, subjects, name, mode, debias=True, calibrate=True, nuisance_dims=3):
    """Returns (dial, report). mode: "post" (hook) or "pre" (LoRA file)."""
    (pre_name, post_name), proj, refiner = text_modules(model)
    prompts, holds = parse_pairs(pairs, subjects)
    nuisance = parse_pairs("\n".join(NUISANCE_PAIRS), subjects if subjects.strip() else NUISANCE_SUBJECTS)[0] if debias else []
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

    def side(text, which):
        return sum(c * encode(t)[which] for t, c in weighted_terms(text))

    def diffs(pp, which):
        return torch.stack([side(b, which) - side(a, which) for a, b in pp])

    def basis_for(which):
        if not nuisance:
            return None
        return nuisance_basis(diffs(nuisance, which), nuisance_dims)

    def remove(v, basis):
        return v - basis @ (basis.T @ v) if basis is not None else v

    def hold_directions(which, basis):
        if not holds:
            return None
        return hold_basis([diffs(pp, which).mean(0) for pp in holds.values()], basis)

    which = 1 if mode == "pre" else 2
    d, basis = diffs(prompts, which), basis_for(which)
    hold = hold_directions(which, basis)
    raw = d.mean(0)
    debiased = remove(raw, basis)
    vec = remove(debiased, hold)
    removed = 1 - float(debiased.norm() ** 2 / raw.norm() ** 2)
    held = 1 - float(vec.norm() ** 2 / debiased.norm() ** 2)
    agree = float(torch.nn.functional.cosine_similarity(torch.stack([remove(remove(x, basis), hold) for x in d]), vec.unsqueeze(0)).mean())
    note = f"; hold pairs removed {held:.0%} of the dial (cos with the held quality {float(debiased @ hold[:, 0]) / float(debiased.norm()):+.2f})" if holds else ""
    if holds:
        shares = {group: float((debiased @ hold[:, i]) ** 2 / debiased.square().sum().clamp_min(1e-24))
                  for i, group in enumerate(holds)}
        if len(holds) > 1:
            note = f"; hold pairs removed {held:.0%} of the dial"
    if calibrate and mode == "pre":
        # the refiner's final RMSNorm shrinks a pre-refiner shift: rescale so strength 1 = one average pair difference after it
        basis2 = basis_for(2)
        post_target = remove(remove(diffs(prompts, 2).mean(0), basis2), hold_directions(2, basis2))
        probe = [plain_text(t) for pair in prompts[:8] for t in pair]
        shift = torch.stack([refiner(encode(t)[0] + vec.to(dtype)).float().mean(0) - encode(t)[2] for t in probe]).mean(0)
        along = float(shift @ (post_target / post_target.norm().clamp_min(1e-12)))
        scale = float(post_target.norm()) / along if along > 0 else 1.0
        vec = vec * scale
        note += f", calibrated x{scale:.2f}"
    if holds:
        note += "\n" + "; ".join(f"hold group [{group}] removed {share:.1%}" for group, share in shares.items())
    dial = {"vec": vec.cpu(), "target": pre_name if mode == "pre" else post_name, "mode": mode,
            "meta": {"name": name, "pairs": prompts, "n_pairs": str(len(prompts)), "pair_agreement_cos": f"{agree:.3f}",
                     "inject": f"{mode}_refiner", "debias_removed": f"{removed:.3f}" if debias else "off",
                     "calibrated": str(bool(calibrate and mode == "pre")), "format": "ComfyUI-Dials v1"}}
    if holds:
        dial["meta"].update({"holds": [pair for pp in holds.values() for pair in pp], "hold_removed": f"{held:.3f}",
                             "hold_groups": holds, "hold_group_removed": shares})
    report = dial_label(dial) + (f"; debias removed {removed:.0%} of the raw dial (generic wording shift)" if debias else "") + note
    if agree < 0.4:
        report += "\nlow pair agreement: the pairs differ in more than one way; tighten the wording"
    return dial, report


def rack_hold_shift(rows, holds):
    """Project the summed post shift out of the holds' span; report squared-norm shares in row order."""
    post = [(label, d, s) for label, d, s in rows if d["mode"] == "post"]
    target = holds[0][1]["target"]
    if any(d["target"] != target for _, d, _ in post + holds):
        raise ValueError("hold rows and active post-refiner rows must use the same target")
    directions = [d["vec"].double() for _, d, _ in holds]
    total = sum((s * d["vec"].double() for _, d, s in post), torch.zeros_like(directions[0]))
    if len(directions) == 1:
        h = directions[0]
        basis = (h / h.norm().clamp_min(1e-12)).unsqueeze(1)
    else:
        basis = hold_basis(directions, None)
    along = basis.T @ total
    shift = total - basis @ along
    shares = along.square() / total.square().sum().clamp_min(1e-24)
    lines = [f"post-refiner shift after holds |{float(shift.norm()):.1f}| (before {float(total.norm()):.1f})"]
    lines += [f"H  {label}: removed {float(shares[i]):.1%} of the summed shift's squared norm"
              for i, (label, _, _) in enumerate(holds)]
    return dict(holds[0][1], vec=shift.float()), "\n".join(lines)


def make_picture_dial(clip, model, pictures_a, pictures_b, prompt, name, debias=True, nuisance_dims=3):
    """Make a post-refiner dial from two IMAGE batches; pool tag-1 tokens only, with equal weight per picture.

    The full vision/text sequence passes through the projection and refiner before pooling. Equal-size batches
    pair by index for agreement; unequal batches use B's mean minus A's mean without a pair-agreement estimate.
    """
    def items(pictures):
        return ({"type": "image", "data": pictures[i:i + 1]} for i in range(len(pictures)))
    return _make_reference_dial(clip, model, items(pictures_a), items(pictures_b), prompt, name,
                                "pictures", debias, nuisance_dims)


def video_reference(frames, fps):
    """Sample a decoded IMAGE batch at 2 fps (or its lower native rate), retaining source timestamps."""
    indices = torch.arange(0, len(frames), max(float(fps) / 2, 1)).long()
    return {"type": "video", "data": frames[indices], "timestamps": (indices.double() / float(fps)).tolist()}


def make_video_dial(clip, model, videos_a, videos_b, prompt, name, debias=True, nuisance_dims=3):
    """Video sides are iterables of (frames, fps); each clip contributes one text-token mean."""
    a = [video_reference(frames, fps) for frames, fps in videos_a]
    b = [video_reference(frames, fps) for frames, fps in videos_b]
    dial, report = _make_reference_dial(clip, model, a, b, prompt, name, "videos", debias, nuisance_dims)
    dial["meta"].update({"video_sample_fps": 2, "timestamps_a": [x["timestamps"] for x in a],
                         "timestamps_b": [x["timestamps"] for x in b]})
    return dial, report + "; video sampled at up to 2 fps with timestamps; audio excluded"


def _make_reference_dial(clip, model, items_a, items_b, prompt, name, source, debias, nuisance_dims):
    (_, post_name), proj, refiner = text_modules(model)
    comfy.model_management.load_models_gpu([model])
    device = comfy.model_management.get_torch_device()
    dtype = model.model.get_dtype_inference()

    def encode(text, item=None):
        kwargs = {} if item is None else {"minimax_ref_items": [item]}
        ctx, extra = clip.encode_from_tokens_scheduled(clip.tokenize(text, **kwargs))[0]
        ctx = ctx[0].to(device, dtype)
        if item is None:
            mask = torch.ones(ctx.shape[0], dtype=torch.bool, device=device)
        else:
            tags = extra.get("minimax_token_tags")
            if tags is None:
                raise ValueError("reference dial requires minimax_token_tags from the H3 text encoder")
            tags = torch.as_tensor(tags, device=device)
            mask = tags.reshape(-1) == 1
            if not mask.any():
                raise ValueError("reference dial needs at least one text token (minimax_token_tags == 1)")
        return refiner(proj(ctx))[mask].float().mean(0)

    a = torch.stack([encode(prompt, item) for item in items_a])
    b = torch.stack([encode(prompt, item) for item in items_b])
    paired = len(a) == len(b)
    diffs = b - a if paired else None
    raw = diffs.mean(0) if paired else b.mean(0) - a.mean(0)
    basis = None
    if debias:
        nuisance = parse_pairs("\n".join(NUISANCE_PAIRS), NUISANCE_SUBJECTS)[0]
        cache = {}
        for pair in nuisance:
            for text in pair:
                if text not in cache:
                    cache[text] = encode(text)
        nuisance_diffs = torch.stack([cache[y] - cache[x] for x, y in nuisance])
        basis = nuisance_basis(nuisance_diffs, nuisance_dims)
    vec = raw - basis @ (basis.T @ raw) if basis is not None else raw
    removed = 1 - float(vec.norm().square() / raw.norm().square().clamp_min(1e-12)) if raw.norm() > 0 else 0.0
    agree = None
    if paired and vec.norm() > 0:
        clean = diffs - (diffs @ basis) @ basis.T if basis is not None else diffs
        agree = float(torch.nn.functional.cosine_similarity(clean, vec.unsqueeze(0)).mean())
    dial = {"vec": vec.cpu(), "target": post_name, "mode": "post",
            "meta": {"name": name, "pairs": [[i, i] for i in range(len(a))] if paired else [],
                     "n_pairs": str(len(a)) if paired else "0", "pair_agreement_cos": f"{agree:.3f}" if agree is not None else "n/a",
                     "inject": "post_refiner", "debias_removed": f"{removed:.3f}" if debias else "off",
                     "calibrated": "False", "format": "ComfyUI-Dials v1", "source": source, "prompt": prompt,
                     f"n_{source}_a": len(a), f"n_{source}_b": len(b), "paired_by_index": paired,
                     "token_pooling": "minimax_token_tags == 1"}}
    report = dial_label(dial) + f"; {source} A={len(a)}, B={len(b)}; text tokens only"
    report += "; paired by index" if paired else f"; side means only; pair agreement n/a (unequal {source} counts)"
    if debias:
        report += f"; debias removed {removed:.0%} of the raw dial (generic wording shift)"
    if vec.norm() == 0:
        report += f"\nzero dial: the {source} sides have no remaining mean difference; pair agreement n/a"
    elif agree is not None and agree < 0.4:
        report += f"\nlow pair agreement: the {source} differ in more than one way; match framing, light and background"
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
