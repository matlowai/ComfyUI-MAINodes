#!/usr/bin/env python3
"""ROADMAP workstream 1 "wheel vs renders": do a dial's probe axes show up in its renders?

For each rendered arm (dial d at strength s, same prompt/seed as a control), predict the change on five
pixel-measurable probe axes from the dial's probe profile and compare with the measured change against the control.

  probe profile: ridge joint fit of the dial vector on the 14 h3-probes-v1 axes (lambda from the bank), beta_k.
                 predicted push on axis k = s * beta_k (in "probe units": 1 = one probe dial at strength 1).
  render metrics (decoded at 320 px wide, every 2nd frame):
     colour_temp  (+ = cold)      -> -(mean R - mean B)
     time_of_day  (+ = night)     -> -(mean luma Y)
     light_contrast (+ = dramatic)-> std of luma
     motion       (+ = moving)    -> mean |frame difference| of luma
     texture      (+ = rough)     -> mean |Laplacian| of luma
  measured = metric(arm) - metric(control).

Output: per arm, predicted push and measured delta per axis; then per axis the sign agreement over arms whose
|predicted push| >= 0.15, and Spearman rank correlation over all arms. Single seed, single scene: a restaged scene
moves every metric, so read agreement rates, not single arms.

usage: dials_wheel_vs_renders.py <out.json> <control.mp4> <label=dialfile:strength=arm.mp4> ...
"""
import json
import subprocess
import sys

import numpy as np
import torch
from safetensors.torch import load_file

DIALS = os.environ.get("DIALS_DIR", "models/loras/dials/")  # run from the ComfyUI root
BANK = DIALS + "_probes/h3-probes-v1.json"
AXES = ["colour_temp", "time_of_day", "light_contrast", "motion", "texture"]


def vec(path):
    return next(iter(load_file(path).values())).float().flatten()


def profile(v, P, ids, lam):
    G = P.T @ P + lam * torch.eye(P.shape[1])
    beta = torch.linalg.solve(G, P.T @ v)
    resid = v - P @ beta
    return dict(zip(ids, beta.tolist())), float(resid.norm() ** 2 / v.norm() ** 2)


def frames(mp4, w=320):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", mp4], capture_output=True, text=True, check=True).stdout.split(",")
    W, H = int(probe[0]), int(probe[1])
    h = int(round(H * w / W / 2) * 2)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", mp4, "-vf", f"select=not(mod(n\\,2)),scale={w}:{h}", "-vsync", "0",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32)


def metrics(mp4):
    f = frames(mp4)
    y = 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]
    lap = np.abs(4 * y[:, 1:-1, 1:-1] - y[:, :-2, 1:-1] - y[:, 2:, 1:-1] - y[:, 1:-1, :-2] - y[:, 1:-1, 2:])
    return {"colour_temp": -float(f[..., 0].mean() - f[..., 2].mean()), "time_of_day": -float(y.mean()),
            "light_contrast": float(y.std(axis=(1, 2)).mean()), "motion": float(np.abs(np.diff(y, axis=0)).mean()),
            "texture": float(lap.mean())}


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1]) if len(a) > 2 else float("nan")


def main():
    out, control, arms = sys.argv[1], sys.argv[2], sys.argv[3:]
    bank = json.load(open(BANK))
    ids = [a["id"] for a in bank["axes"]]
    P = torch.stack([vec(DIALS + a["file"].split("dials/", 1)[1]) for a in bank["axes"]], 1)
    base = metrics(control)
    rows = []
    for arm in arms:
        label, rest = arm.split("=", 1)
        spec, mp4 = rest.split("=", 1)
        dial, s = spec.rsplit(":", 1)
        beta, unexplained = profile(vec(DIALS + dial), P, ids, bank["ridge_lambda"])
        m = metrics(mp4)
        rows.append({"arm": label, "dial": dial, "strength": float(s), "unexplained": unexplained,
                     "pred": {k: float(s) * beta[k] for k in AXES}, "meas": {k: m[k] - base[k] for k in AXES},
                     "top_axes": sorted(beta.items(), key=lambda kv: -abs(kv[1]))[:3]})
    summary = {}
    for k in AXES:
        pr = np.array([r["pred"][k] for r in rows])
        me = np.array([r["meas"][k] for r in rows])
        big = np.abs(pr) >= 0.15
        agree = int(np.sum(np.sign(pr[big]) == np.sign(me[big])))
        summary[k] = {"n_confident": int(big.sum()), "sign_agree": agree, "spearman_all": spearman(pr, me)}
    json.dump({"control": control, "base": base, "rows": rows, "summary": summary}, open(out, "w"), indent=1)
    print(f"{'axis':15} confident  sign-agree  spearman(all {len(rows)} arms)")
    for k, v in summary.items():
        print(f"{k:15} {v['n_confident']:9d}  {v['sign_agree']:10d}  {v['spearman_all']:+.2f}")


if __name__ == "__main__":
    main()
