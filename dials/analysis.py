"""Probe-bank profiles of dials: how much of each probe direction (a hypothesis-labelled A -> B pair dial) a dial contains.

direct  (v.p)/(p.p) per probe, in probe units (1 = one probe's worth). Easy to read; correlated probes share credit.
joint   ridge fit v ~ P beta on unit-norm probes with lambda relative to a unit probe, beta converted back to probe units.
        unexplained = |v - P beta| / |v|. This is a linear approximation of the vector, not a partition of its meaning.
The bank is a JSON manifest in the loras folder listing the probe dial files; probes and dial must share one space.
"""
import json

import torch

import folder_paths

from . import core

BANKS = {"MiniMax H3": "dials/_probes/h3-probes-v1.json"}  # model family -> probe bank manifest


def direct_coefficients(v, probes):
    pp = probes.square().sum(1)
    return torch.where(pp > 0, probes @ v / pp.clamp_min(1e-24), torch.zeros_like(pp))


def ridge_fit(v, probes, lam):
    """-> (beta in probe units, unexplained share). Zero probes get beta 0; a zero v has nothing unexplained (0)."""
    norms = probes.norm(dim=1)
    unit = probes / norms.clamp_min(1e-12)[:, None]
    gamma = torch.linalg.pinv(unit @ unit.T + lam * torch.eye(len(unit), dtype=unit.dtype)) @ (unit @ v)
    beta = torch.where(norms > 0, gamma / norms.clamp_min(1e-12), torch.zeros_like(gamma))
    vn = float(v.norm())
    return beta, float((v - unit.T @ gamma).norm()) / vn if vn > 0 else 0.0


def gram_condition(probes):
    """Condition number of the unit-probe Gram matrix (zero probes left out); large = probes are nearly collinear."""
    norms = probes.norm(dim=1)
    unit = probes[norms > 0] / norms[norms > 0, None]
    return float(torch.linalg.cond(unit @ unit.T)) if len(unit) else 1.0


def read_bank(manifest):
    with open(folder_paths.get_full_path_or_raise("loras", manifest), encoding="utf-8") as f:
        return json.load(f)


def probe_vectors(dial, bank):
    """[n, d] float64 probe vectors of the bank; refuses a bank in another space than the dial."""
    probes = [core.load_dial(a["file"]) for a in bank["axes"]]
    space = {(d["mode"], d["target"]) for d in probes}
    if space != {(dial["mode"], dial["target"])}:
        raise ValueError(f"different space: the probe bank is {', '.join(f'{m} {t}' for m, t in sorted(space))}, "
                         f"the dial is {dial['mode']} {dial['target']}")
    return torch.stack([d["vec"].double() for d in probes])


def profile(dial, bank, p):
    v = dial["vec"].double()
    beta, unexplained = ridge_fit(v, p, bank["ridge_lambda"])
    return {"bank": bank["id"], "version": bank["version"], "lambda": bank["ridge_lambda"],
            "axes": [a["id"] for a in bank["axes"]], "negative": [a["negative"] for a in bank["axes"]],
            "positive": [a["positive"] for a in bank["axes"]], "direct": direct_coefficients(v, p).tolist(),
            "joint": beta.tolist(), "unexplained": unexplained, "norm": float(v.norm()), "condition": gram_condition(p),
            "correlated": bank.get("correlated", [])}


def dial_profile(dial_name):
    """Profile of one dial file on its family's probe bank."""
    dial = core.load_dial(dial_name)
    family = core.dial_family(dial)
    if family not in BANKS:
        raise ValueError(f"no probe bank for {family} yet")
    bank = read_bank(BANKS[family])
    return profile(dial, bank, probe_vectors(dial, bank))
