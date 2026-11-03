"""Pure-function tests for h3_drift (no ComfyUI, no GPU)."""
import importlib.util
import os
import sys

import torch

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("h3_drift", os.path.join(HERE, "h3_drift.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ok = True

def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok = ok and cond

# schedule values: dedupe, descending, drop non-finite/negative
vals = m._schedule_values(torch.tensor([0.8, 0.8, 1.0, 0.0, -1.0, float("nan"), 0.4]))
def near(a, b, tol=1e-6): return abs(a - b) < tol
check("schedule dedupe/sort", len(vals) == 4 and all(near(a, b) for a, b in zip(vals, (1.0, 0.8, 0.4, 0.0))))

# next sigma + ratio (float32 tensors round-trip 0.8 as 0.80000001..)
check("next sigma", near(m.next_schedule_sigma(0.8, vals), 0.4))
check("ratio", near(m.matched_noise_ratio(0.8, vals), 0.5))
check("ratio at floor", m.matched_noise_ratio(0.0, vals) == 0.0)

# weights: 12 = 8 matched + 4 taper -> eight 1.0 then .75 .5 .25 .0
w = m.temporal_prefix_weights(12, 4)
check("weights shape", len(w) == 12)
check("weights matched", w[:8] == (1.0,) * 8)
check("weights taper", all(abs(a - b) < 1e-9 for a, b in zip(w[8:], (0.75, 0.5, 0.25, 0.0))))

# frames -> steps on the 17k+5 grid
check("39f -> 12 steps", m.frames_to_steps(39) == 12)
check("90f -> 27 steps", m.frames_to_steps(90) == 27)
try:
    m.frames_to_steps(40)
    check("off-grid refused", False)
except ValueError:
    check("off-grid refused", True)

# mask application: video region rewritten, audio region untouched
B, C, T, H, W = 1, 24, 20, 4, 4
video_elems = C * T * H * W
audio_elems = 64
packed = torch.ones(B, 1, video_elems + audio_elems)
out, h3_mask = m.apply_dynamic_prefix_mask(packed, (B, C, T, H, W), 12, 0.5, 4)
video = out[..., :video_elems].reshape(B, C, T, H, W)
check("prefix step0 = ratio", abs(float(video[0, 0, 0, 0, 0]) - 0.5) < 1e-9)
check("taper end exact", float(video[0, 0, 11, 0, 0]) == 0.0)
check("post-prefix untouched", float(video[0, 0, 12, 0, 0]) == 1.0)
check("audio untouched", bool(torch.all(out[..., video_elems:] == 1.0)))
check("h3 mask ceil-quantized", float(h3_mask[0, 0, 8, 0, 0]) == torch.ceil(torch.tensor(0.375 * 256)).item() / 256)
check("original mask unmodified", bool(torch.all(packed == 1.0)))

# state: matched+taper must equal prefix
try:
    m._DriftState((B, C, T, H, W), 12, 9, 4)
    check("sum mismatch refused", False)
except ValueError:
    check("sum mismatch refused", True)

sys.exit(0 if ok else 1)
