"""Dial editor: move a post-refiner dial along probe directions or the dial library's top principal components, then save
the result as a new dial with its recipe.

  v' = v + sum_j c_j q_j    q = the bank's probe vectors p_k (c in probe units, "delta beta"), then the library's PC1/PC2
                            (unit vectors, c in |v| units)
The rack UI does the live readouts from the Gram numbers in editor_state(); export_edit() redoes the edit exactly from the
edit list. Edits:
  {"kind": "axis", "axis": id, "delta": d, "fit": "direct"|"joint", "bank": id, "bank_version": n}
  {"kind": "drag", "basis": "probes", "axes": [x, y], "delta": [a, b], "fit": ..., "bank": id, "bank_version": n}
  {"kind": "drag", "basis": "library_pca", "library_sha256": h, "components_sha256": h, "n_library": n, "delta": [a, b]}
Vector math only: whether an edit shows in renders is untested until someone renders it.
"""
import hashlib
import json
import math
import os

import torch

import folder_paths

from . import analysis, core

FITS = ("direct", "joint")
NEIGHBOURS = 5


def library(dial):
    """[(names, vector hash, vec)] of the saved dials in dials/ (not in "_" folders) in the dial's family and seam, one
    entry per distinct vector (x / x_hook aliases share one)."""
    space = (core.dial_family(dial), dial["mode"], dial["target"], dial["vec"].shape)
    out = {}
    for name in sorted(folder_paths.get_filename_list("loras")):
        name = name.replace("\\", "/")
        if not name.startswith("dials/") or any(d.startswith("_") for d in name.split("/")[1:-1]):
            continue
        try:
            d = core.load_dial(name)
        except ValueError:  # a non-dial file dropped into dials/
            continue
        if (core.dial_family(d), d["mode"], d["target"], d["vec"].shape) == space:
            sha = core.vector_sha256(d)
            out.setdefault(sha, ([], sha, d["vec"].double()))[0].append(name)
    return list(out.values())


def library_pca(vecs, hashes):
    """-> (library sha256, mean, [2, d] unit components). Components a library cannot span (fewer than 3 distinct
    vectors) are zero. Signs are fixed so the largest entry is positive."""
    x = torch.stack(vecs)
    mean = x.mean(0)
    _, s, vh = torch.linalg.svd(x - mean, full_matrices=False)
    comps = torch.zeros(2, x.shape[1], dtype=x.dtype)
    for i in range(min(2, len(s))):
        if s[i] > 1e-9 * s[0]:
            comps[i] = vh[i] * torch.sign(vh[i][vh[i].abs().argmax()])
    return hashlib.sha256("\n".join(sorted(hashes)).encode()).hexdigest(), mean, comps


def components_sha256(comps):
    return hashlib.sha256(comps.to(torch.float32).contiguous().numpy().tobytes()).hexdigest()


def context(dial_name):
    dial = core.load_dial(dial_name)
    if dial["mode"] != "post":
        raise ValueError("this is a pre-refiner dial, and the editor works in the post-refiner space of the probe bank")
    family = core.dial_family(dial)
    if family not in analysis.BANKS:
        raise ValueError(f"there is no probe bank for {family} yet")
    bank = analysis.read_bank(analysis.BANKS[family])
    probes = analysis.probe_vectors(dial, bank)  # refuses a bank in another space
    prof = analysis.profile(dial, bank, probes)
    lib = library(dial)
    key, mean, comps = library_pca([v for _, _, v in lib], [h for _, h, _ in lib]) if lib else (None, None, None)
    return {"dial": dial, "bank": bank, "profile": prof, "probes": probes, "library": lib, "library_sha256": key,
            "mean": mean, "components": comps}


def basis(ctx):
    """The edit directions q: probes, then PC1 and PC2 (zero without a library)."""
    pcs = ctx["components"] if ctx["components"] is not None else ctx["probes"].new_zeros(2, ctx["probes"].shape[1])
    return torch.cat([ctx["probes"], pcs])


def joint(x, probes, lam):
    return analysis.ridge_fit(x, probes, lam)[0]


def editor_state(dial_name):
    """Everything the editor UI needs for exact live readouts of v' = v + q.T c without another request."""
    ctx = context(dial_name)
    v, P, lam, prof = ctx["dial"]["vec"].double(), ctx["probes"], ctx["bank"]["ridge_lambda"], ctx["profile"]
    Q = basis(ctx)
    jq = torch.stack([joint(q, P, lam) for q in Q])
    resid = torch.stack([x - P.T @ joint(x, P, lam) for x in torch.cat([v[None], Q])])  # r(x) = x - P beta(x), linear
    mean = ctx["mean"] if ctx["mean"] is not None else torch.zeros_like(v)
    pc_of = lambda x: ((x - mean) @ Q[-2:].T).tolist()
    return {
        "dial": dial_name, "name": ctx["dial"]["meta"]["name"], "family": core.dial_family(ctx["dial"]),
        "vector_sha256": core.vector_sha256(ctx["dial"]), "info": core.dial_info(dial_name),
        "bank": {k: prof[k] for k in ("bank", "version", "lambda", "axes", "negative", "positive", "correlated", "condition")},
        "direct": prof["direct"], "joint": prof["joint"], "unexplained": prof["unexplained"],
        "vv": float(v @ v), "vq": (Q @ v).tolist(), "qq": (Q @ Q.T).tolist(), "jq": jq.tolist(), "rr": (resid @ resid.T).tolist(),
        "pc": pc_of(v), "library_sha256": ctx["library_sha256"],
        "components_sha256": components_sha256(ctx["components"]) if ctx["components"] is not None else None,
        "library": [{"names": names, "vector_sha256": h, "vw": float(v @ w), "qw": (Q @ w).tolist(), "ww": float(w @ w),
                     "direct": analysis.direct_coefficients(w, P).tolist(), "joint": joint(w, P, lam).tolist(), "pc": pc_of(w)}
                    for names, h, w in ctx["library"]],
    }


def number(x):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        raise ValueError(f"edit deltas must be finite numbers, got {x!r}")
    return float(x)


def check_edits(ctx, edits):
    """-> (c over basis(ctx), the edits as recorded). Each edit must name this bank, or this library's components."""
    bank, axes = ctx["bank"], [a["id"] for a in ctx["bank"]["axes"]]
    c, clean = [0.0] * (len(axes) + 2), []
    if not isinstance(edits, list) or not all(isinstance(e, dict) for e in edits):
        raise ValueError("edits must be a list of objects")
    for e in edits:
        kind, deltas = e.get("kind"), e.get("delta")
        if kind == "axis":
            deltas = [deltas]
        if kind not in ("axis", "drag") or not isinstance(deltas, list) or len(deltas) != (1 if kind == "axis" else 2):
            raise ValueError(f"malformed edit: {json.dumps(e)[:200]}")
        deltas = [number(d) for d in deltas]
        if kind == "drag" and e.get("basis") == "library_pca":
            if ctx["components"] is None or (e.get("library_sha256"), e.get("components_sha256")) != (ctx["library_sha256"], components_sha256(ctx["components"])):
                raise ValueError("the dial library changed since this edit was made (its principal components differ); reopen the editor")
            targets = [len(axes), len(axes) + 1]
            clean.append({"kind": "drag", "basis": "library_pca", "library_sha256": ctx["library_sha256"],
                          "components_sha256": e["components_sha256"], "n_library": len(ctx["library"]), "delta": deltas})
        else:
            if (e.get("bank"), e.get("bank_version")) != (bank["id"], bank["version"]):
                raise ValueError(f"edit made on probe bank {e.get('bank')} v{e.get('bank_version')}; this dial's bank is {bank['id']} v{bank['version']}")
            if e.get("fit") not in FITS:
                raise ValueError(f"edit fit must be one of {', '.join(FITS)}")
            names = [e.get("axis")] if kind == "axis" else e.get("axes")
            if not isinstance(names, list) or len(names) != len(deltas) or not all(n in axes for n in names):
                raise ValueError(f"unknown probe axis in {names!r}; the bank has {', '.join(axes)}")
            targets = [axes.index(n) for n in names]
            common = {"fit": e["fit"], "bank": bank["id"], "bank_version": bank["version"]}
            clean.append({"kind": "axis", "axis": names[0], "delta": deltas[0], **common} if kind == "axis" else
                         {"kind": "drag", "basis": "probes", "axes": names, "delta": deltas, **common})
        for j, d in zip(targets, deltas):
            c[j] += d
    return c, clean


def edited_vector(ctx, edits):
    """-> (v' in float64, the edits as recorded)."""
    c, clean = check_edits(ctx, edits)
    return ctx["dial"]["vec"].double() + basis(ctx).T @ torch.tensor(c, dtype=torch.float64), clean


def cosine(a, b):
    n = float(a.norm() * b.norm())
    return float(a @ b) / n if n > 0 else 0.0


def readouts(ctx, vec):
    """Size, cosine with the parent, nearest library dials (parent and result left out), probe coefficient changes."""
    v, P, lam = ctx["dial"]["vec"].double(), ctx["probes"], ctx["bank"]["ridge_lambda"]
    skip = {core.vector_sha256(ctx["dial"]), core.vector_sha256(dict(ctx["dial"], vec=vec.float()))}
    near = sorted(((cosine(vec, w), names) for names, h, w in ctx["library"] if h not in skip), reverse=True)[:NEIGHBOURS]
    beta, unexplained = analysis.ridge_fit(vec, P, lam)
    return {"norm": float(vec.norm()), "parent_norm": float(v.norm()), "cos_parent": cosine(vec, v),
            "neighbours": [{"dial": names[0], "same_vector": names[1:], "cos": c} for c, names in near], "axes": ctx["profile"]["axes"],
            "direct_change": (analysis.direct_coefficients(vec, P) - analysis.direct_coefficients(v, P)).tolist(),
            "joint_change": (beta - joint(v, P, lam)).tolist(), "unexplained": unexplained,
            "parent_unexplained": ctx["profile"]["unexplained"]}


def dial_path(name):
    """'name' or 'folder/name' inside models/loras/dials/, each part letters, digits, '_' and '-'."""
    parts = name.split("/")
    if not 1 <= len(parts) <= 2 or not all(core.NAME.fullmatch(p) for p in parts):
        raise ValueError("dial name: letters, digits, '_' and '-' only (max 80), optionally in one folder: folder/name")
    return os.path.join(folder_paths.get_folder_paths("loras")[0], core.DIAL_SUBDIR, *parts) + ".safetensors"


def export_edit(dial_name, edits, name, info=None):
    """Save parent + edits as models/loras/dials/<name>.safetensors, never replacing a file. info defaults to the parent's
    labels and description with every strength and the evidence unknown (an edited dial is untested)."""
    path = dial_path(name)
    ctx = context(dial_name)
    parent = ctx["dial"]
    if info is None:
        info = dict(core.dial_info(dial_name), neg={"useful": None, "overcook": None}, pos={"useful": None, "overcook": None},
                    evidence=None, notes=f"made in the Dial editor from {parent['meta']['name']}; output untested")
    info = core.check_dial_info(info)
    vec, edits = edited_vector(ctx, edits)
    dial = {"vec": vec.float(), "target": parent["target"], "mode": "post",
            "meta": {"name": name.rsplit("/", 1)[-1], "model_family": core.dial_family(parent), "parents": [parent["meta"]["name"]],
                     "inject": "post_refiner", "format": "ComfyUI-Dials v1"}}
    dial["meta"]["composition"] = {"kind": "edit", "parent": core.dial_parent(parent), "edits": edits,
                                   "result_sha256": core.vector_sha256(dial)}
    payload = core.dial_bytes(dial, info)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "xb") as f:  # "x": an existing dial is never replaced
        f.write(payload)
    saved = dial["vec"].to(torch.bfloat16).double()
    return {"file": f"dials/{name}.safetensors", "path": path, "vector_sha256": dial["meta"]["composition"]["result_sha256"],
            "composition": dial["meta"]["composition"], "info": info, **readouts(ctx, saved)}
