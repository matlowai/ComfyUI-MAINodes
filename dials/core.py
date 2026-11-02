"""Dials: training-free steering directions for MiniMax H3, MOSS-Image and Krea 2, built from prompt pairs (ported from
ComfyUI-Dials). TEXT_PATHS says where each model family's seams are; a dial file records its family.

A dial is one vector added to every prompt token, at one of two seams (H3 names; TEXT_PATHS has the others):
  post  after H3's token_refiner, exactly where the DiT reads the prompt ("hook"). Applied by a diffusion-model wrapper
        that finds the module per call, so the module tree and weight paths stay unchanged, dials stack, and clones on
        other copies of the weights shift their own.
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
import collections
import hashlib
import json
import math
import os
import re

import torch
from safetensors import safe_open
from safetensors.torch import save, save_file

import comfy.model_management
import comfy.utils
from comfy.patcher_extension import WrappersMP
from comfy_extras.nodes_minimax_h3 import CANVAS_MULTIPLE, REF_IMAGE_SHORT_EDGE, adapt_canvas
import folder_paths

# One model family's prompt path. pre: Linear whose bias a pre dial shifts (None: post dials only). post: module whose
# output a post dial shifts. refine(dm, tokens): [n, dim] from the pre seam's output (the encoder output when there is no
# pre seam) to the post seam's output. cached: extra_conds refines the prompt once, so the DiT's context is the post seam.
TextPath = collections.namedtuple("TextPath", "family pre post refine cached")


def _moss_refine(dm, x):  # TextEmbedder.forward after its proj; text rope positions 0..n-1, as without references
    pe = dm.rope(0, 0, x.shape[0], x.device)
    x = x[None]
    for block in dm.text_embedder.blocks:
        x = block(x, pe)
    return x[0]


# diffusion model class -> its prompt path
TEXT_PATHS = {
    "MiniMaxH3Model": TextPath("MiniMax H3", "condition_proj", "token_refiner", lambda dm, x: dm.token_refiner(x), True),
    "MOSSImage": TextPath("MOSS-Image", "text_embedder.proj", "text_embedder", _moss_refine, False),
    # txtfusion has no biased projection up front; txtmlp ends in a Linear, so a post dial equals a txtmlp.3 bias diff
    "SingleStreamDiT": TextPath("Krea 2", None, "txtmlp", lambda dm, x: dm.txtmlp(dm.txtfusion(dm._unpack_context(x[None])))[0], False),
}
DEFAULT_FAMILY = "MiniMax H3"  # dial files from before families were recorded
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


def text_path(model):
    path = TEXT_PATHS.get(type(model.model.diffusion_model).__name__)
    if path is None:
        raise ValueError(f"Dials support {', '.join(p.family for p in TEXT_PATHS.values())} so far, got {type(model.model.diffusion_model).__name__}")
    return path


def dial_family(dial):
    return dial["meta"].get("model_family", DEFAULT_FAMILY)


def check_family(dial, path):
    if dial_family(dial) != path.family:
        raise ValueError(f"dial {dial['meta'].get('name', '?')} was made for {dial_family(dial)}; this model is {path.family}")


class ContextShift:
    """Diffusion-model wrapper adding a post dial to the refined prompt, for families whose extra_conds refines it once (H3).
    It reads the model it wraps per call, so a clone on another copy of the weights (multi-GPU, non-dynamic delegate)
    shifts its own prompt."""

    def __init__(self, shift):
        self.shift = shift

    def __call__(self, executor, x, timestep, context, transformer_options, **kwargs):
        context = executor.class_obj.preprocess_text_embeds(context)  # no-op when extra_conds already refined it
        return executor(x, timestep, context + self.shift.to(device=context.device, dtype=context.dtype), transformer_options, **kwargs)

    def to(self, device_or_dtype):  # sampling moves wrappers to the load device once (cast_to_load_options), not per call
        if isinstance(device_or_dtype, torch.device):
            self.shift = self.shift.to(device_or_dtype)
        return self


class PostShift(ContextShift):
    """Diffusion-model wrapper for families that refine the prompt inside every call: for the duration of the call, adds
    the shift to the output of the post module of the model being run."""

    def __init__(self, post, shift):
        super().__init__(shift)
        self.post = post

    def __call__(self, executor, *args, **kwargs):
        handle = executor.class_obj.get_submodule(self.post).register_forward_hook(self.add)
        try:
            return executor(*args, **kwargs)
        finally:
            handle.remove()

    def add(self, module, args, out):
        return out + self.shift.to(device=out.device, dtype=out.dtype)


POST_KEY = "mai_dial_post"


def apply_dial(m, dial, strength):
    """Apply one dial to a cloned ModelPatcher in place, with the math of ComfyUI-Dials' Apply Dial: pre is a bias diff,
    post adds strength * vec to the post module's output."""
    if dial["mode"] == "pre":
        m.add_patches({f"diffusion_model.{dial['target']}.bias": ("diff", (dial["vec"],))}, strength)
    else:
        shift = dial["vec"] * strength
        m.add_wrapper_with_key(WrappersMP.DIFFUSION_MODEL, POST_KEY, ContextShift(shift) if text_path(m).cached else PostShift(dial["target"], shift))


PAIR_WEIGHT = re.compile(r"\s+::\s*(-?\d+(?:\.\d+)?)\s*$")
SET_LINE = re.compile(r"([+-])\s*(\d+(?:\.\d+)?)?\s+(.+)")


def parse_pairs(pairs, subjects):
    """-> (pairs, weights, {name: hold pairs}); bare '!' lines belong to group "".

    A side is a text (with optional (words:w) spans) or a prompt set [(text, weight)]. 'A ||| B :: w' weights a pair in
    the mean. Lines '+w text' / '-w text' (w defaults to 1) form one prompt set per subject: the weighted mean of the +
    prompts minus that of the - prompts, so one '+1' and one '-1' line equal a plain 'A ||| B' pair.
    """
    subs = [s.strip() for s in subjects.splitlines() if s.strip() and not s.strip().startswith("#")] or [None]
    out, weights, holds, members = [], [], {}, []
    for line in pairs.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = SET_LINE.fullmatch(line) if "|||" not in line else None
        if m:
            w = float(m.group(2) or 1)
            if w <= 0:
                raise ValueError(f"prompt set weights must be positive (the sign goes in front): {line[:80]}")
            members.append((w if m.group(1) == "+" else -w, m.group(3).strip()))
            continue
        weight = PAIR_WEIGHT.search(line)
        if weight:
            line = line[:weight.start()]
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
            if weight:
                raise ValueError("'::' weights apply to dial pairs, not hold pairs")
        if "|||" not in line:
            raise ValueError(f"each pair line needs 'A ||| B', got: {line[:80]}")
        a, b = (x.strip() for x in line.split("|||", 1))
        for s in subs:
            dest.append((a.replace("{subject}", s), b.replace("{subject}", s)) if s else (a, b))
            if dest is out:
                weights.append(float(weight.group(1)) if weight else 1.0)
    if members:
        neg, pos = [(-w, t) for w, t in members if w < 0], [(w, t) for w, t in members if w > 0]
        if not neg or not pos:
            raise ValueError("a prompt set needs at least one '+' line and one '-' line")
        for s in subs:
            side = lambda ms: [(t.replace("{subject}", s) if s else t, w / sum(w for w, _ in ms)) for w, t in ms]
            out.append((side(neg), side(pos)))
            weights.append(1.0)
    if not out:
        raise ValueError("no prompt pairs given")
    if not any(weights):
        raise ValueError("every '::' pair weight is 0, so the dial would be empty; give at least one pair a nonzero weight")
    return out, weights, holds


def side_terms(side):
    """A pair side -> [(prompt, coefficient)] whose weighted encodings sum to the side's encoding."""
    if isinstance(side, str):
        return weighted_terms(side)
    return [(t, w * c) for text, w in side for t, c in weighted_terms(text)]


def hold_basis(directions, nuisance):
    """One column per group; redundant groups contribute zero. One group is its unit direction off the nuisance basis."""
    if len(directions) == 1:
        h = directions[0]
        h = h - nuisance @ (nuisance.T @ h) if nuisance is not None else h
        return (h / h.norm().clamp_min(1e-12)).unsqueeze(1)
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


NAME = re.compile(r"[A-Za-z0-9_\-]{1,80}")  # dial, folder and preset names


def check_dial_name(name):
    if not NAME.fullmatch(name):
        raise ValueError("dial name: letters, digits, '_' and '-' only (max 80)")


def dial_tensors(dial):
    """What a dial file holds: one bf16 tensor keyed diffusion_model.<target>.<diff_b|dials_shift>."""
    return {f"diffusion_model.{dial['target']}.{KEY_SUFFIX[dial['mode']]}": dial["vec"].to(torch.bfloat16).contiguous()}


def dial_bytes(dial, info=None):
    """The dial file: its tensor, its metadata (non-strings as JSON) and, given info, the checked dial_info."""
    meta = {k: (v if isinstance(v, str) else json.dumps(v)) for k, v in dial["meta"].items()}
    if info is not None:
        meta["dial_info"] = json.dumps(check_dial_info(info))
    return save(dial_tensors(dial), metadata=meta)


def save_dial(dial, name, info=None):
    check_dial_name(name)
    root = os.path.join(folder_paths.get_folder_paths("loras")[0], DIAL_SUBDIR)
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, f"{name}.safetensors")
    with open(path, "wb") as f:
        f.write(dial_bytes(dial, info))
    return path


def tensors_sha256(tensors):
    """Hash of a dial file's tensors (keys and bytes in key order, never the metadata), so editing info keeps it."""
    h = hashlib.sha256()
    for key in sorted(tensors):
        h.update(key.encode())
        h.update(tensors[key].contiguous().view(-1).view(torch.uint8).numpy().tobytes())
    return h.hexdigest()


def vector_sha256(dial):
    """Hash of the tensor the dial saves as, equal to presets.dial_sha256 of its file, so recipes find parents by content."""
    return tensors_sha256(dial_tensors(dial))


def dial_parent(dial):
    """A parent dial as recorded in a recipe: name, vector hash, and its own recipe when it was combined or edited too."""
    out = {"name": dial["meta"].get("name"), "vector_sha256": vector_sha256(dial)}
    recipe = dial["meta"].get("composition")
    if recipe:
        out["composition"] = json.loads(recipe) if isinstance(recipe, str) else recipe
    return out


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


INFO_DEFAULTS = {"version": 2}  # every strength unknown, no evidence
INFO_EVIDENCE = ("creator", "one-seed", "multi-seed", "multi-scene")


def check_dial_info(info):
    """-> info v2: labels, per-side ("neg", "pos") useful/overcook strengths where None means unknown, evidence, pipeline,
    notes."""
    if not isinstance(info, dict):
        raise ValueError("dial info must be an object")
    if info.get("version") != 2:
        raise ValueError(f"unknown dial info version {info.get('version')!r}")
    out = {"version": 2}
    for key, limit in (("description", 2000), ("negative", 60), ("positive", 60), ("pipeline", 60), ("notes", 500)):
        v = info.get(key, "")
        if not isinstance(v, str) or len(v) > limit:
            raise ValueError(f"dial info '{key}' must be text of at most {limit} characters")
        out[key] = v
    for name in ("neg", "pos"):
        side = info.get(name, {})
        if not isinstance(side, dict):
            raise ValueError(f"dial info '{name}' must be an object with useful and overcook")
        out[name] = {}
        for key in ("useful", "overcook"):
            v = side.get(key)
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 < v <= 20):
                raise ValueError(f"dial info '{name}.{key}' must be a strength above 0 and at most 20, or null (unknown)")
            out[name][key] = None if v is None else float(v)
        if None not in out[name].values() and out[name]["overcook"] < out[name]["useful"]:
            raise ValueError(f"the {name} overcook strength must be at least its useful strength")
    if info.get("evidence") not in (None, *INFO_EVIDENCE):
        raise ValueError(f"dial info 'evidence' must be one of {', '.join(INFO_EVIDENCE)} or null")
    out["evidence"] = info.get("evidence")
    return out


def dial_info(dial_name):
    """The dial file's own 'dial_info' metadata (labels, per-side strengths, evidence), or all unknown."""
    with safe_open(folder_paths.get_full_path_or_raise("loras", dial_name), "pt") as f:
        stored = (f.metadata() or {}).get("dial_info")
    return check_dial_info(json.loads(stored) if stored else INFO_DEFAULTS)


def save_dial_info(dial_name, info):
    """Write the info into a dial file's metadata; the vector is copied unchanged and the file replaced atomically. Only
    dial files in loras/dials/ are rewritten, never another LoRA."""
    info = check_dial_info(info)
    if not dial_name.replace("\\", "/").startswith(f"{DIAL_SUBDIR}/"):
        raise ValueError(f"{dial_name} is not in loras/{DIAL_SUBDIR}/: dial info is saved into dial files only")
    load_dial(dial_name)  # refuses a file that is not one dial vector
    path = folder_paths.get_full_path_or_raise("loras", dial_name)
    with safe_open(path, "pt") as f:
        tensors = {k: f.get_tensor(k) for k in f.keys()}
        meta = dict(f.metadata() or {})
    meta["dial_info"] = json.dumps(info)
    save_file(tensors, path + ".tmp", metadata=meta)
    os.replace(path + ".tmp", path)
    return info


def dial_geometry(names):
    """Rack UI readouts for dial files: vector norm, injection mode, and cosine between every two dials."""
    dials = [load_dial(n) for n in names]
    vecs = [d["vec"] for d in dials]
    return {"norm": [float(v.norm()) for v in vecs], "mode": [d["mode"] for d in dials], "info": [dial_info(n) for n in names],
            "cos": [[float(torch.nn.functional.cosine_similarity(a, b, dim=0)) if a.shape == b.shape else None for b in vecs] for a in vecs]}


def dial_label(dial):
    m = dial["meta"]
    return (f"{m.get('name', '?')} ({dial['mode']}_refiner, {dial['target']}): {m.get('n_pairs', '?')} pairs, "
            f"pair agreement cos {m.get('pair_agreement_cos', '?')}, |dial| {float(dial['vec'].norm()):.1f}")


def nuisance_pairs(subjects):
    """The built-in nuisance pairs over the dial's subjects (the default subjects when it has none)."""
    return parse_pairs("\n".join(NUISANCE_PAIRS), subjects if subjects.strip() else NUISANCE_SUBJECTS)[0]


def nuisance_basis(pairs, mean, dims):
    """The generic 'more wording' directions: the top `dims` right singular vectors of the nuisance pair differences, with
    mean(text) the text's token mean at the dial's seam."""
    return torch.linalg.svd(torch.stack([mean(b) - mean(a) for a, b in pairs]), full_matrices=False)[2][:dims].T


def make_dial(clip, model, pairs, subjects, name, mode, debias=True, nuisance_dims=3):
    """Returns (dial, report). mode: "post" (hook) or "pre" (LoRA file)."""
    path = text_path(model)
    if mode == "pre" and path.pre is None:
        raise ValueError(f"{path.family} has no pre_refiner seam (no biased projection before its text refiner); use post_refiner")
    dm = model.model.diffusion_model
    proj = dm.get_submodule(path.pre) if path.pre else None
    prompts, weights, holds = parse_pairs(pairs, subjects)
    nuisance = nuisance_pairs(subjects) if debias else []
    probe = [plain_text(t) for pair in prompts[:8] for s in pair for t, _ in ([(s, 1)] if isinstance(s, str) else s)] if mode == "pre" else []
    texts = [t for pp in (prompts, nuisance, *holds.values()) for pair in pp for s in pair for t, _ in side_terms(s)] + probe
    # every text through the encoder before the model loads, so a low-VRAM encoder load cannot evict the DiT mid-dial
    states = {t: clip.encode_from_tokens_scheduled(clip.tokenize(t))[0][0][0] for t in dict.fromkeys(texts)}
    comfy.model_management.load_models_gpu([model])
    device = comfy.model_management.get_torch_device()
    dtype = model.model.get_dtype_inference()
    pair_weights = torch.tensor(weights, device=device)
    cache = {}

    def encode(text):  # -> (pre-refiner tokens, pre token mean, post token mean), means in float32
        if text not in cache:
            ctx = states[text].to(device, dtype)
            pre = proj(ctx) if proj is not None else ctx
            cache[text] = (pre, pre.float().mean(0), path.refine(dm, pre).float().mean(0))
        return cache[text]

    def side(s, which):
        return sum(c * encode(t)[which] for t, c in side_terms(s))

    def mean(d):  # pair-weighted mean of pair differences
        return (pair_weights[:, None] * d).sum(0) / pair_weights.abs().sum()

    def diffs(pp, which):
        return torch.stack([side(b, which) - side(a, which) for a, b in pp])

    def basis_for(which):
        return nuisance_basis(nuisance, lambda t: encode(t)[which], nuisance_dims) if nuisance else None

    def remove(v, basis):
        return v - basis @ (basis.T @ v) if basis is not None else v

    def hold_directions(which, basis):
        if not holds:
            return None
        return hold_basis([diffs(pp, which).mean(0) for pp in holds.values()], basis)

    which = 1 if mode == "pre" else 2
    d, basis = diffs(prompts, which), basis_for(which)
    hold = hold_directions(which, basis)
    raw = mean(d)
    debiased = remove(raw, basis)
    vec = remove(debiased, hold)
    removed = 1 - float(debiased.norm() ** 2 / (raw.norm() ** 2).clamp_min(1e-12))
    held = 1 - float(vec.norm() ** 2 / (debiased.norm() ** 2).clamp_min(1e-12))
    agree = float(torch.nn.functional.cosine_similarity(torch.stack([remove(remove(x, basis), hold) for x in d]), vec.unsqueeze(0)).mean())
    note, shares = "", {}
    if holds:
        shares = {group: float((debiased @ hold[:, i]) ** 2 / debiased.square().sum().clamp_min(1e-24)) for i, group in enumerate(holds)}
        note = f"; hold pairs removed {held:.0%} of the dial"
        if len(holds) == 1:
            note += f" (cos with the held quality {float(debiased @ hold[:, 0]) / max(float(debiased.norm()), 1e-12):+.2f})"
    if mode == "pre":
        # the refiner's final RMSNorm shrinks a pre-refiner shift: rescale so strength 1 = one average pair difference after it
        basis2 = basis_for(2)
        post_target = remove(remove(mean(diffs(prompts, 2)), basis2), hold_directions(2, basis2))
        shift = torch.stack([path.refine(dm, encode(t)[0] + vec.to(dtype)).float().mean(0) - encode(t)[2] for t in probe]).mean(0)
        along = float(shift @ (post_target / post_target.norm().clamp_min(1e-12)))
        scale = float(post_target.norm()) / along if along > 0 else 1.0
        vec = vec * scale
        note += f", calibrated x{scale:.2f}"
    if len(holds) > 1:
        note += "\n" + "; ".join(f"hold group [{group}] removed {share:.1%}" for group, share in shares.items())
    dial = {"vec": vec.cpu(), "target": path.pre if mode == "pre" else path.post, "mode": mode,
            "meta": {"name": name, "model_family": path.family, "pairs": prompts, "n_pairs": str(len(prompts)),
                     **({"pair_weights": weights} if any(w != 1 for w in weights) else {}), "pair_agreement_cos": f"{agree:.3f}",
                     "inject": f"{mode}_refiner", "debias_removed": f"{removed:.3f}" if debias else "off",
                     "calibrated": str(mode == "pre"), "format": "ComfyUI-Dials v1"}}
    if holds:
        dial["meta"].update({"hold_groups": holds, "hold_removed": f"{held:.3f}", "hold_group_removed": shares})
    report = dial_label(dial) + (f"; debias removed {removed:.0%} of the raw dial (generic wording shift)" if debias else "") + note
    if agree < 0.4:
        report += "\nlow pair agreement: the pairs differ in more than one way; tighten the wording"
    return dial, report


def rack_post_shift(rows):
    """All post rows as one shift summed in float64: chained bf16 hook additions round differently in each row order."""
    post = [(d, s) for _, d, s in rows if d["mode"] == "post"]
    return dict(post[0][0], vec=sum(s * d["vec"].double() for d, s in post).float())


def rack_hold_shift(rows, holds):
    """Project the summed post shift out of the holds' span; report squared-norm shares in row order."""
    post = [(label, d, s) for label, d, s in rows if d["mode"] == "post"]
    target = holds[0][1]["target"]
    if any(d["target"] != target for _, d, _ in post + holds):
        raise ValueError("hold rows and active post-refiner rows must use the same target")
    directions = [d["vec"].double() for _, d, _ in holds]
    total = sum((s * d["vec"].double() for _, d, s in post), torch.zeros_like(directions[0]))
    basis = hold_basis(directions, None)
    along = basis.T @ total
    shift = total - basis @ along
    shares = along.square() / total.square().sum().clamp_min(1e-24)
    lines = [f"post-refiner shift after holds |{float(shift.norm()):.1f}| (before {float(total.norm()):.1f})"]
    lines += [f"H  {label}: removed {float(shares[i]):.1%} of the summed shift's squared norm"
              for i, (label, _, _) in enumerate(holds)]
    return dict(holds[0][1], vec=shift.float()), "\n".join(lines)


PICTURE_FRAMINGS = {
    "content": "A video of the subject in <Picture 1>.",
    "look": "A video with the colours, light and look of <Picture 1>.",
    "bare": "A video of <Picture 1>.",
}


def make_picture_dial(clip, model, pictures_a, pictures_b, prompts, name, debias=True, nuisance_dims=3):
    """Make a post-refiner dial from two lists of IMAGE batches (any sizes); pool tag-1 tokens only, with equal weight
    per picture. Each picture is encoded with every prompt (framing) and its token means are averaged.

    The full vision/text sequence passes through the projection and refiner before pooling. Equal picture counts
    pair by index for agreement; unequal counts use B's mean minus A's mean without a pair-agreement estimate.
    """
    def items(batches):
        for pictures in batches:
            h, w = pictures.shape[1:3]
            scale = min(1.0, REF_IMAGE_SHORT_EDGE / min(w, h))
            for i in range(len(pictures)):
                yield {"type": "image", "data": resize(pictures[i:i + 1], w * scale, h * scale)}
    return _make_reference_dial(clip, model, items(pictures_a), items(pictures_b), prompts, name,
                                "pictures", debias, nuisance_dims)


MAX_VIDEO_SAMPLES = 16  # 8 s at 2 fps


def resize(images, w, h):
    """Shrink an IMAGE batch to about w x h (CANVAS_MULTIPLE steps, as ComfyUI sizes H3 references); never enlarge."""
    if w >= images.shape[2] and h >= images.shape[1]:
        return images
    w = max(CANVAS_MULTIPLE, round(w / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)
    h = max(CANVAS_MULTIPLE, round(h / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)
    return comfy.utils.common_upscale(images.movedim(-1, 1), w, h, "lanczos", "disabled").movedim(1, -1)


def video_reference(frames, fps, samples=MAX_VIDEO_SAMPLES):
    """First `samples` frames at 2 fps (or the native rate if lower), on the H3 reference canvas, with the sample times
    H3's own reference videos get (i / 2 s; the frame times below 2 fps)."""
    indices = torch.arange(0, len(frames), max(float(fps) / 2, 1)).long()[:samples]
    cw, ch = adapt_canvas(frames.shape[2], frames.shape[1])
    return {"type": "video", "data": resize(frames[indices], cw, ch), "timestamps": [i / min(float(fps), 2.0) for i in range(len(indices))]}


def make_video_dial(clip, model, videos_a, videos_b, prompt, name, debias=True, nuisance_dims=3):
    """Video sides are lists of (frames, fps); each clip contributes one text-token mean. Every clip is cut to the same
    number of 2 fps samples, so the per-block timestamp tokens match on both sides and cannot become part of the dial."""
    samples = min([MAX_VIDEO_SAMPLES] + [math.ceil(len(f) / max(float(fps) / 2, 1)) for f, fps in videos_a + videos_b])
    a = [video_reference(frames, fps, samples) for frames, fps in videos_a]
    b = [video_reference(frames, fps, samples) for frames, fps in videos_b]
    dial, report = _make_reference_dial(clip, model, a, b, [prompt], name, "videos", debias, nuisance_dims)
    dial["meta"].update({"video_sample_fps": 2, "timestamps_a": [x["timestamps"] for x in a],
                         "timestamps_b": [x["timestamps"] for x in b]})
    return dial, report + f"; every clip cut to {samples} samples at up to 2 fps (equal timestamps on both sides); audio excluded"


def _make_reference_dial(clip, model, items_a, items_b, prompts, name, source, debias, nuisance_dims):
    path = text_path(model)
    if path.family != "MiniMax H3":
        raise ValueError(f"dials from {source} work on MiniMax H3 only (its encoder reads them); this model is {path.family}")
    dm = model.model.diffusion_model
    proj, refiner = dm.get_submodule(path.pre), dm.get_submodule(path.post)
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

    a = torch.stack([torch.stack([encode(p, item) for p in prompts]).mean(0) for item in items_a])
    b = torch.stack([torch.stack([encode(p, item) for p in prompts]).mean(0) for item in items_b])
    paired = len(a) == len(b)
    diffs = b - a if paired else None
    raw = diffs.mean(0) if paired else b.mean(0) - a.mean(0)
    basis = nuisance_basis(nuisance_pairs(""), encode, nuisance_dims) if debias else None
    vec = raw - basis @ (basis.T @ raw) if basis is not None else raw
    removed = 1 - float(vec.norm().square() / raw.norm().square().clamp_min(1e-12))
    agree = None
    if paired and vec.norm() > 0:
        clean = diffs - (diffs @ basis) @ basis.T if basis is not None else diffs
        agree = float(torch.nn.functional.cosine_similarity(clean, vec.unsqueeze(0)).mean())
    dial = {"vec": vec.cpu(), "target": path.post, "mode": "post",
            "meta": {"name": name, "model_family": path.family, "pairs": [[i, i] for i in range(len(a))] if paired else [],
                     "n_pairs": str(len(a)) if paired else "0", "pair_agreement_cos": f"{agree:.3f}" if agree is not None else "n/a",
                     "inject": "post_refiner", "debias_removed": f"{removed:.3f}" if debias else "off",
                     "calibrated": "False", "format": "ComfyUI-Dials v1", "source": source, "prompt": "\n".join(prompts),
                     f"n_{source}_a": len(a), f"n_{source}_b": len(b), "paired_by_index": paired,
                     "token_pooling": "minimax_token_tags == 1"}}
    report = dial_label(dial) + f"; {source} A={len(a)}, B={len(b)}; text tokens only"
    if len(prompts) > 1:
        report += f"; {len(prompts)} framings averaged"
    report += "; paired by index" if paired else f"; side means only; pair agreement n/a (unequal {source} counts)"
    if debias:
        report += f"; debias removed {removed:.0%} of the raw dial (generic wording shift)"
    if vec.norm() == 0:
        report += f"\nzero dial: the {source} sides have no remaining mean difference; pair agreement n/a"
    elif agree is not None and agree < 0.4:
        report += f"\nlow pair agreement: the {source} differ in more than one way; match framing, light and background"
    return dial, report


def interactions(dots, strengths):
    """Exact energy bookkeeping for rows of one space (never mix pre and post), from their dot products v_i·v_j.

    |sum s_i v_i|^2 = sum_i own_i + sum_{i<j} pair_ij with own_i = s_i^2 |v_i|^2 and pair_ij = 2 s_i s_j v_i·v_j
    (> 0 reinforcing, < 0 cancelling); shares are of |sum s_i v_i|^2. push_i = s_i v_i·u along the unit combined shift
    u, so the pushes add up to |sum s_i v_i|. Zero vectors and a fully cancelled sum give 0, never NaN."""
    dots = torch.as_tensor(dots, dtype=torch.float64)
    s = torch.as_tensor(strengths, dtype=torch.float64)
    norm = dots.diagonal().clamp_min(0).sqrt()
    scale = torch.outer(norm, norm)
    cos = torch.where(scale > 0, dots / scale.clamp_min(1e-300), 0.0)
    weighted = torch.outer(s, s) * dots
    own = weighted.diagonal()
    pair = 2 * (weighted - torch.diag(own))
    energy = float(weighted.sum())
    cancelled = energy <= 1e-12 * float(own.sum())  # rounding residue of an exact cancellation
    combined = 0.0 if cancelled else math.sqrt(energy)
    share = 0.0 if cancelled else 1 / energy
    return {"norm": norm.tolist(), "cos": cos.tolist(), "own": own.tolist(), "pair": pair.tolist(), "combined": combined,
            "own_share": (own * share).tolist(), "pair_share": (pair * share).tolist(),
            "push": (weighted.sum(1) / combined if combined else torch.zeros_like(own)).tolist()}


def interaction_lines(labels, it, threshold=0.05):
    """Compact rack-report summary: the pairs that reinforce or cancel by at least `threshold` of |sum|^2, and who pushes."""
    if not it["combined"]:
        return ["the post-refiner rows sum to zero"]
    n = len(labels)
    pairs = sorted((it["pair_share"][i][j], f"{labels[i]} × {labels[j]}") for i in range(n) for j in range(i + 1, n))
    lines = [f"pairs add {sum(p for p, _ in pairs):+.0%} of |sum|² to the rows alone"]
    for word, chosen in (("reinforcing", [x for x in reversed(pairs) if x[0] >= threshold]), ("cancelling", [x for x in pairs if x[0] <= -threshold])):
        if chosen:
            lines.append(f"{word}: " + ", ".join(f"{name} {p:+.0%}" for p, name in chosen[:3]))
    lines.append("push along the sum: " + ", ".join(f"{label} {p / it['combined']:+.0%}" for label, p in zip(labels, it["push"])))
    return lines


def dial_interactions(rows):
    """rows [{"dial": file, "strength": s}] -> dots between same-space dials (null across spaces), so the UI can redo the
    bookkeeping for any strengths, plus the exact interactions of the post-refiner rows at these strengths."""
    dials = [load_dial(r["dial"]) for r in rows]
    vecs = [d["vec"].double() for d in dials]
    space = [(d["mode"], d["target"], d["vec"].shape) for d in dials]
    dots = [[float(a @ b) if space[i] == space[j] else None for j, b in enumerate(vecs)] for i, a in enumerate(vecs)]
    post = [i for i, d in enumerate(dials) if d["mode"] == "post"]
    out = {"mode": [d["mode"] for d in dials], "dot": dots, "post": post}
    if post:
        out["interactions"] = interactions([[dots[i][j] for j in post] for i in post], [float(rows[i]["strength"]) for i in post])
    return out


def rack_report(rows):
    """rows: [(label, dial, strength)] actually applied. Norms, the combined post-refiner shift, and which rows reinforce
    or cancel each other."""
    if not rows:
        return "no active dials: model unchanged"
    lines = [f"{s:+.2f}  {label}  |dial| {float(d['vec'].norm()):.1f}  ({d['mode']})" for label, d, s in rows]
    post = [(label, d["vec"].double(), s) for label, d, s in rows if d["mode"] == "post"]
    if len(post) > 1:
        v = torch.stack([x for _, x, _ in post])
        it = interactions(v @ v.T, [s for _, _, s in post])
        biggest = max(abs(s) * float(x.norm()) for _, x, s in post)
        lines.append(f"combined post-refiner shift |{it['combined']:.1f}| (largest single row {biggest:.1f})")
        lines += interaction_lines([label for label, _, _ in post], it)
    return "\n".join(lines)
