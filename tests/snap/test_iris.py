"""SNAP-R134 keep eye colour (snap_iris.py), CPU only, no server: the node's math on two drawn eyes (skin, sclera, a
coloured iris disc with a pupil, a dark outline ring and a highlight; the mask a disc over each iris and its outline, as
SAM's "pupil:2" gives). Checks: the iris moves to the Cast's colour (strength 1) and part way (0.6); L unchanged; pupil,
outline, highlight, sclera and skin byte-identical (no halo outside the eroded mask, none on an iris edge that meets the
sclera without an outline); an empty-mask frame, a too-big
mask and a lone blob (not a pair of irises) pass through byte-identical with a reason; a grey Cast iris and a Cast
without an iris skip; strength 0 is the identity. Loads snap_iris.py by path with a stub for comfy_api (the math needs only torch).
usage: SNAP_TEST_OUT=... python -I tests/snap/test_iris.py"""
import importlib.util
import json
import os
import sys
import types

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

stub = types.ModuleType("comfy_api.latest")
stub.io = types.SimpleNamespace(ComfyNode=object, NodeOutput=object)
sys.modules.setdefault("comfy_api", types.ModuleType("comfy_api"))
sys.modules["comfy_api.latest"] = stub
spec = importlib.util.spec_from_file_location("snap_iris", C.PACK / "snap_iris.py")
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

H = W = 1000  # the two irises ~1 % of the frame, as in a full-body turnaround (over 2 % reads as a face, not irises)
yy, xx = torch.meshgrid(torch.arange(H, dtype=torch.float32), torch.arange(W, dtype=torch.float32), indexing="ij")
cx = torch.where(xx < 500, 380.0, 620.0)  # two eyes side by side, each drawn around its own centre
d = ((yy - 500) ** 2 + (xx - cx) ** 2).sqrt()
PUPIL, IRIS, RING = d < 14, (d >= 14) & (d < 40), (d >= 40) & (d < 44)
SCLERA = (((yy - 500) / 60) ** 2 + ((xx - cx) / 110) ** 2 < 1) & (d >= 44)
HIGHLIGHT = ((yy - 485) ** 2 + (xx - cx - 15) ** 2).sqrt() < 5
MASK = (d < 43).float()  # over each iris and part of its outline, as a real mask spills


def eye(iris_a, iris_b, outline=True):
    """Two drawn eyes as an 8-bit-quantised IMAGE (1, H, W, 3): iris L 34 at the top to 52 at the bottom."""
    lab = torch.empty(H, W, 3)
    lab[:] = torch.tensor([80.0, 12.0, 15.0])  # skin
    lab[SCLERA] = torch.tensor([93.0, 0.0, 1.0])
    iris = IRIS & ~HIGHLIGHT
    lab[..., 0][iris] = (34 + 18 * (yy - 460) / 80).clamp(34, 52)[iris]
    lab[..., 1][iris], lab[..., 2][iris] = iris_a, iris_b
    lab[PUPIL] = torch.tensor([12.0, 1.0, 1.0])
    lab[RING] = torch.tensor([10.0, 1.0, 2.0] if outline else [55.0, 2.0, 4.0])
    lab[HIGHLIGHT] = torch.tensor([97.0, 0.0, 0.0])
    return (S.lab_to_rgb(lab).clamp(0, 1) * 255).round()[None] / 255


def iris_ab(img):
    lab = S.rgb_to_lab(img[0])
    core = IRIS & ~HIGHLIGHT & (d >= 20) & (d < 36)
    return lab[..., 1][core].median().item(), lab[..., 2][core].median().item()


frame, cast, grey = eye(3.0, 9.0), eye(17.8, 33.0), eye(1.0, 2.0)  # an olive-grey redraw iris, an amber Cast, a grey Cast
target = iris_ab(cast)
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if detail else ""))


big = torch.zeros(H, W)
big[:500, :] = 1  # half the frame: a face or a body, not irises
frames = torch.cat([frame, frame, frame, frame])
masks = torch.stack([MASK, torch.zeros(H, W), big, MASK * (xx < 500)])  # the last: one eye-like blob (a profile, a hair bell)
out, rep = S.keep_eye_colour(frames, masks, cast, MASK[None], 1.0)
before, after = iris_ab(frame), iris_ab(out[:1])
dist = lambda ab: ((ab[0] - target[0]) ** 2 + (ab[1] - target[1]) ** 2) ** 0.5
check("iris moves to the Cast at strength 1", dist(after) < 2 and dist(before) > 20, f"distance {dist(before):.1f} -> {dist(after):.1f}, target {target[0]:.1f},{target[1]:.1f}")
L0, L1 = S.rgb_to_lab(frame[0])[..., 0], S.rgb_to_lab(out[0])[..., 0]
changed = (out[0] != frame[0]).any(-1)
check("L unchanged on the touched pixels", (L1 - L0)[changed].abs().max().item() < 1.0, f"max |dL| {(L1 - L0)[changed].abs().max().item():.2f} over {int(changed.sum())} px (8-bit rounding)")
core = -torch.nn.functional.max_pool2d(-MASK[None, None], 3, 1, 1)[0, 0] > 0.5
check("nothing outside the eroded mask changes (no halo)", not (changed & ~core).any(), f"{int((changed & ~core).sum())} px")
for part, m in (("pupil", PUPIL), ("outline", RING), ("highlight", HIGHLIGHT), ("sclera", SCLERA), ("skin", ~(SCLERA | (d < 44)))):
    check(f"{part} byte-identical", torch.equal(out[0][m], frame[0][m]))
check("empty-mask frame byte-identical, with a reason", torch.equal(out[1], frames[1]) and rep["per_frame"][1]["why"] == "no iris found", rep["per_frame"][1].get("why"))
check("too-big mask frame byte-identical, with a reason", torch.equal(out[2], frames[2]) and "too big" in rep["per_frame"][2]["why"], rep["per_frame"][2].get("why"))
check("a lone blob is not a pair of irises: byte-identical, with a reason", torch.equal(out[3], frames[3]) and "not a pair" in rep["per_frame"][3]["why"], rep["per_frame"][3].get("why"))
check("report: target, touched 1 of 4, mean shift", rep["skipped"] is None and rep["touched"] == 1 and rep["frames"] == 4 and rep["target"]["chroma"] > 30 and rep["mean_shift"] == rep["per_frame"][0]["shift"], json.dumps(rep))
check("output keeps shape, dtype, device", out.shape == frames.shape and out.dtype == frames.dtype and out.device == frames.device)

# u102b's halo: no dark outline, the iris fades straight into the sclera (an edge ring at L 55) and the mask spills onto
# the sclera, as SAM's does on a real frame; the edge next to the white must not turn orange
soft = eye(3.0, 9.0, outline=False)
outs, _ = S.keep_eye_colour(soft, (d < 46).float()[None], cast, MASK[None], 1.0)
edge = (torch.nn.functional.max_pool2d(SCLERA.float()[None, None], 3, 1, 1)[0, 0] > 0) & ~SCLERA
check("no halo where the iris meets the sclera", torch.equal(outs[0][edge], soft[0][edge]) and dist(iris_ab(outs)) < 2, f"{int((outs[0][edge] != soft[0][edge]).any(-1).sum())} of {int(edge.sum())} edge px changed")

out6, _ = S.keep_eye_colour(frame, MASK[None], cast, MASK[None], 0.6)
moved, moved6 = dist(before) - dist(after), dist(before) - dist(iris_ab(out6))
check("strength 0.6 goes part way", 0.5 * moved < moved6 < 0.7 * moved, f"distance {dist(before):.1f} -> {dist(iris_ab(out6)):.1f}")
out0, rep0 = S.keep_eye_colour(frame, MASK[None], cast, MASK[None], 0.0)
check("strength 0 is the identity", torch.equal(out0, frame), f"touched {rep0['touched']}")
outg, repg = S.keep_eye_colour(frame, MASK[None], grey, MASK[None], 1.0)
check("a grey Cast iris skips, never invents colour", outg is frame and "grey" in (repg["skipped"] or ""), repg["skipped"])
outn, repn = S.keep_eye_colour(frame, MASK[None], cast, torch.zeros(1, H, W), 1.0)
check("a Cast without a found iris skips", outn is frame and repn["skipped"] == "the Cast picture's iris: no iris found", repn["skipped"])
rgb = torch.rand(64, 64, 3)
check("Lab round trip", (S.lab_to_rgb(S.rgb_to_lab(rgb)) - rgb).abs().max().item() < 1e-4)

n = sum(r["ok"] for r in results)
json.dump({"suite": "iris", "passed": n, "total": len(results), "results": results}, open(C.out("ui", "test_iris_result.json"), "w"), indent=1)
print(f"iris {n}/{len(results)}")
