"""Pure-function tests for h3_color_carry (no ComfyUI, no GPU)."""
import importlib.util
import os
import sys

import torch

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "h3_color_carry", os.path.join(HERE, "h3_color_carry.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ok = True

def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok = ok and cond

def near(a, b, tol=1e-5):
    return abs(float(a) - float(b)) < tol

# stats on synthetic frames: mid-gray with known saturation
frames = torch.full((8, 64, 64, 3), 0.5)
frames[..., 0] = 0.7   # push red -> saturation nonzero
st = m.tensor_scene_color_stats(frames)
check("stats version", st["version"] == m.STATS_VERSION)
check("stats luma triplet", len(st["luma_percentiles"]) == 3)
check("stats sane luma", 100 < st["luma_percentiles"][1] < 180)

# coherent delta: needs two agreeing signs, min magnitude
check("coherent both pos", near(m._coherent_delta((2.0, 3.0, -1.0), 1.0), 2.5))
check("coherent split -> 0", m._coherent_delta((2.0, -3.0), 1.0) == 0.0)
check("coherent under min -> 0", m._coherent_delta((0.3, 0.4), 1.0) == 0.0)

# transform: identical stats -> identity
b, s = m.scene_color_transform(st, st)
check("identity transform", b == 0.0 and s == 1.0)

# transform clamps
bright = dict(st)
bright["luma_percentiles"] = [v + 40 for v in st["luma_percentiles"]]
b, s = m.scene_color_transform(bright, st)
check("luma clamp", near(b, 6.0 / 255.0))

# rgb transform preserves shape, respects brightness
img = torch.full((2, 8, 8, 3), 0.5)
out = m.apply_rgb_color_transform(img, 0.1, 1.0)
check("rgb brightness", near(float(out[0, 0, 0, 0]), 0.6))
check("rgb shape", tuple(out.shape) == (2, 8, 8, 3))

# smoothstep taper: 0 at old edge, 1 beside the future, monotone
w = m.temporal_delta_weights(12)
check("taper ends", w[0] == 0.0 and near(w[-1], 1.0))
check("taper monotone", bool(torch.all(w[1:] >= w[:-1])))

# lowpass: shape preserved, constant field unchanged
d = torch.ones(1, 24, 12, 6, 6)
lp = m.spatial_lowpass(d, 3)
check("lowpass shape", tuple(lp.shape) == (1, 24, 12, 6, 6))
check("lowpass constant", bool(torch.allclose(lp, d)))
try:
    m.spatial_lowpass(d, 4)
    check("even kernel refused", False)
except ValueError:
    check("even kernel refused", True)

# frames -> steps
check("39f -> 12", m.frames_to_steps(39) == 12)
try:
    m.frames_to_steps(40)
    check("off-grid refused", False)
except ValueError:
    check("off-grid refused", True)

# correct_prefix_in_place: prefix region moves by tapered delta, rest untouched
target = torch.zeros(1, 24, 20, 6, 6)
delta = torch.ones(1, 24, 12, 6, 6)
out = m.correct_prefix_in_place(target, 12, delta, 1)
check("prefix step0 unchanged (taper 0)", float(out[0, 0, 0, 0, 0]) == 0.0)
check("prefix last step full delta", near(float(out[0, 0, 11, 0, 0]), 1.0))
check("post-prefix untouched", float(out[0, 0, 12, 0, 0]) == 0.0)
check("original untouched", bool(torch.all(target == 0.0)))

# q rides the data's device (torch.quantile raises on a cpu q vs a cuda input).
# No cuda here by rule, so the check intercepts torch.quantile and compares the
# device of both arguments - on CPU that is only meaningful because the q tensor
# is now built from luma.device/sat.device rather than defaulting to cpu.
_seen = []
_real_quantile = torch.quantile
def _spy(inp, q, *a, **kw):
    _seen.append((inp.device, q.device if torch.is_tensor(q) else inp.device))
    return _real_quantile(inp, q, *a, **kw)
torch.quantile = _spy
try:
    m.tensor_scene_color_stats(frames)
finally:
    torch.quantile = _real_quantile
check("quantile q device follows data (2 call sites)", len(_seen) == 2)
check("quantile q device matches input", all(a == b for a, b in _seen))
_src = open(os.path.join(HERE, "h3_color_carry.py")).read()
check("q built with device=", _src.count("device=luma.device") == 1
      and _src.count("device=sat.device") == 1)

sys.exit(0 if ok else 1)
