#!/usr/bin/env python3
"""Unit test for H3 True Clock's keep_fine_bands option.

  python tests/test_true_clock_fine_bands.py
      Synthetic, no GPU, no files, no ComfyUI install (a stand-in for
      comfy.ldm.minimax.model with the core's rope_freqs is registered).
      Checks:

        1. OFF IS OFF: keep_fine_bands 0 (and an unarmed process) returns
           the core's angles bit for bit,
        2. SPLICE: with K > 0, the target video rows' K leading temporal
           bands (both duplicated halves) equal the stock-grid angles and
           every other temporal band equals the true-clock angles, i.e.
           t-angles = cat(stock[:K], true[K:]) * inv_freq per row,
        3. UNTOUCHED: text and audio rows, and the h/w columns, are
           unchanged,
        4. DISARM: the sampler wrapper resets the bands after sampling,
           even when the inner sampler raises.

Exit code 0 = pass.
"""
import importlib.util
import os
import sys
import types

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# --- stand-in for comfy.ldm.minimax.model (the parts the patch touches) ----
FRAME_PER_TOKEN = (1, 4, 4, 4, 4)
FRAME_RESCALE = 5.0 / 3.0
BANDS = 16


class _Rope(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer("inv_freq", 1.0 / (10000 ** (torch.arange(BANDS, dtype=torch.float32) / BANDS)))


class MiniMaxH3Model(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.rope = _Rope()

    def rope_freqs(self, position_ids, device):   # verbatim shape of the core's
        pos = position_ids.to(torch.float32).to(device)
        inv = self.rope.inv_freq.to(device)
        per_axis = pos.unsqueeze(-1) * inv.view(1, 1, -1)
        t_f, h_f, w_f = per_axis.unbind(dim=1)
        half = torch.cat((t_f, h_f, w_f), dim=-1)
        return torch.cat((half, half), dim=-1)


def _video_t_spans(n):
    return [FRAME_RESCALE * FRAME_PER_TOKEN[k % 5] for k in range(n)]


mm = types.ModuleType("comfy.ldm.minimax.model")
mm.FRAME_PER_TOKEN, mm.FRAME_RESCALE = FRAME_PER_TOKEN, FRAME_RESCALE
mm.MiniMaxH3Model, mm._video_t_spans = MiniMaxH3Model, _video_t_spans
for name in ("comfy", "comfy.ldm", "comfy.ldm.minimax"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["comfy.ldm.minimax.model"] = mm
sys.modules["comfy.ldm.minimax"].model = mm

sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("mainodes_motion", os.path.join(ROOT, "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)

FAILS = []


def check(name, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + name + ("  " + detail if detail else ""))
    if not ok:
        FAILS.append(name)


# 124-frame clock: native / 2x / 4x / 2x / native plateaus aligned to the latent grid
strides = [4] * 4 + [2] * 8 + [1] * 9 + [2] * 4 + [4] * 4
holds, k4 = [], 0
for k in range(37):
    if FRAME_PER_TOKEN[k % 5] == 1:
        holds.append(1)
    else:
        s = strides[k4]
        k4 += 1
        holds += [4 // s] * s
assert sum(holds) == 124
spans = motion.true_clock_spans(holds)
n = len(spans)

# packed rows: 7 text rows, 20 audio rows, then n video tokens x 6 rows each
TEXT, AUDIO, RPF = 7, 20, 6
origin = float(TEXT)
true_grid = motion.dyrope_grid(spans, origin)
stock_grid = motion.dyrope_grid(motion.dyrope_stock_spans(n), origin)
rows = []
rows += [[float(i), 0.0, 0.0] for i in range(TEXT)]
rows += [[origin + i % 10, 0.0, (-1.0) ** i] for i in range(AUDIO)]
for t in true_grid:
    rows += [[t, 0.1 * r, -0.2 * r] for r in range(RPF)]
position_ids = torch.tensor(rows, dtype=torch.float64)
start = TEXT + AUDIO

model = MiniMaxH3Model()
core = MiniMaxH3Model.rope_freqs
reference = core(model, position_ids, "cpu")

motion._install_true_clock_patch()
motion._install_fine_band_patch()
patched = mm.MiniMaxH3Model.rope_freqs
check("patch installed once", getattr(patched, "_h3_fine_bands", False))
motion._install_fine_band_patch()
check("idempotent install", mm.MiniMaxH3Model.rope_freqs is patched)

print("1) off is off")
motion._TRUE_CLOCK["spans"], motion._TRUE_CLOCK["fine_bands"] = None, 0
check("unarmed process", torch.equal(patched(model, position_ids, "cpu"), reference))
motion._TRUE_CLOCK["spans"], motion._TRUE_CLOCK["fine_bands"] = spans, 0
check("armed clock, K = 0", torch.equal(patched(model, position_ids, "cpu"), reference))

inv = model.rope.inv_freq.double()
for K in (1, 2, 5):
    print(f"2-3) splice, K = {K}")
    motion._TRUE_CLOCK["spans"], motion._TRUE_CLOCK["fine_bands"] = spans, K
    out = patched(model, position_ids, "cpu")
    t_true = torch.tensor(true_grid, dtype=torch.float64).repeat_interleave(RPF)
    t_stock = torch.tensor(stock_grid, dtype=torch.float64).repeat_interleave(RPF)
    want_t = torch.cat((t_stock[:, None] * inv[None, :K], t_true[:, None] * inv[None, K:]), dim=1).float()
    check("video t-bands = cat(stock[:K], true[K:])", torch.allclose(out[start:, :BANDS], want_t, atol=1e-4),
          f"max err {float((out[start:, :BANDS] - want_t).abs().max()):.2e}")
    check("second half mirrors first", torch.equal(out[:, :48], out[:, 48:]))
    check("video h/w bands unchanged", torch.equal(out[start:, BANDS:48], reference[start:, BANDS:48]))
    check("text + audio rows unchanged", torch.equal(out[:start], reference[:start]))
    differs = not torch.equal(out[start:, :K], reference[start:, :K])
    check("leading bands actually changed", differs)

print("4) disarm")


class _Inner:
    def __init__(self, fail):
        self.fail = fail

    def sample(self, *a, **k):
        seen = (list(motion._TRUE_CLOCK["spans"]), motion._TRUE_CLOCK["fine_bands"])
        if self.fail:
            raise RuntimeError("boom")
        return seen


seen = motion._TrueClockSampler(_Inner(False), spans, 2).sample()
check("armed during sample", seen == (list(spans), 2))
check("disarmed after sample", motion._TRUE_CLOCK["spans"] is None and motion._TRUE_CLOCK["fine_bands"] == 0)
try:
    motion._TrueClockSampler(_Inner(True), spans, 3).sample()
except RuntimeError:
    pass
check("disarmed after a failing sample", motion._TRUE_CLOCK["spans"] is None and motion._TRUE_CLOCK["fine_bands"] == 0)

print("5) node signature")
it = motion.H3TrueClock.INPUT_TYPES()
check("keep_fine_bands is optional, default 0", it["optional"]["keep_fine_bands"][1]["default"] == 0)
check("required inputs unchanged", list(it["required"]) == ["sampler", "hold_map"])

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
