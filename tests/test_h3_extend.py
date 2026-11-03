#!/usr/bin/env python3
"""Extension arithmetic and the four nodes, no GPU. Run from the ComfyUI root:
    python custom_nodes/ComfyUI-MAINodes/tests/test_h3_extend.py
"""
import os, sys, json
sys.path.insert(0, os.getcwd())
import comfy.options
comfy.options.enable_args_parsing()
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
from importlib import import_module
import torch
ct = import_module("ComfyUI-MAINodes.capsule_types")
ex = import_module("ComfyUI-MAINodes.h3_extend")

# grid helpers: core rounds length UP, guides DOWN
assert ct.align_up(72) == 73 and ct.align_up(141) == 141 and ct.align_up(1) == 5
assert ct.align_down(72) == 56 and ct.align_down(39) == 39 and ct.align_down(22) == 22 and ct.align_down(3) == 1 and ct.align_down(0) == 0
tb = ct.Timebase()
assert str(tb.ticks(141)) == "235" and str(tb.ticks(39)) == "65" and str(tb.ticks(102)) == "170"
assert str(tb.ticks(22)) == "110/3" and not tb.clock_aligned(22) and tb.clock_aligned(90)

# the atom
P = ex.H3ExtensionPlan()
plan, length, handle, new, report, e2e = P.plan(141, "seamless (39-frame handle)", 39, 0, "auto", "auto", 24, 1, 141)
assert e2e is False
p = json.loads(plan)
assert (length, handle, new) == (141, 39, 102), (length, handle, new)
assert p["resolved"]["length_ticks"] == "235" and p["resolved"]["handle_ticks"] == "65" and p["resolved"]["new_ticks"] == "170"
h = ct.Handle.from_dict(p["handle"])
assert (h.source.start, h.source.end, h.destination.start, h.destination.end) == (102, 141, 0, 39)
assert h.protected and not h.retime_allowed and h.visual_anchor in ("guide", "per_token_mask") and h.audio_anchor == "guide"
assert "NOT INTEGER" not in report
# canonical digest is stable across key order
assert ct.digest({"a": 1, "b": [1, 2]}) == ct.digest({"b": [1, 2], "a": 1})

# 22 is legal on the grid, not on the clock: the plan says so
plan22, l22, h22, n22, rep22, _ = P.plan(141, "custom (use handle_frames)", 22, 0, "guide", "guide", 24, 1, 141)
assert h22 == 22 and "not an integer" in rep22, rep22
# new_frames raises the generation length and rounds UP
plan3, l3, h3, n3, rep3, _ = P.plan(141, "seamless (39-frame handle)", 39, 120, "guide", "guide", 24, 1, 141)
assert l3 == ct.align_up(159) == 175 and n3 == 120 and json.loads(plan3)["resolved"]["surplus_frames"] == 16, (l3, n3)
# scene cut: no handle, audio regenerates
plan0, l0, h0, n0, rep0, _ = P.plan(141, "scene cut (no handle, global refs only)", 39, 0, "auto", "auto", 24, 1, 141)
assert h0 == 0 and json.loads(plan0)["handle"]["audio_anchor"] == "regenerated" and json.loads(plan0)["handle"]["visual_anchor"] == "none"

# tail + trim round trip on synthetic frames/audio at 32 kHz
frames = torch.arange(141).float().view(141, 1, 1, 1).expand(141, 4, 4, 3).contiguous()
sr = 32000
audio = {"waveform": torch.arange(141 * sr // 24).float().view(1, 1, -1), "sample_rate": sr}
tail, ta, idx, hjson, trep = ex.H3TailContext().tail(frames, plan, audio)
assert tail.shape[0] == 39 and idx == 0 and float(tail[0, 0, 0, 0]) == 102
assert ta["waveform"].shape[-1] == 39 * sr // 24 == 52000 and float(ta["waveform"][0, 0, 0]) == 102 * sr // 24
assert "WARNING" not in trep, trep
kept, ka, gend, gspan, rrep, pimg, paud = ex.H3Trim().trim(frames, plan, 141, audio)
assert pimg.shape[0] == 39 and paud["waveform"].shape[-1] == 39 * sr // 24
assert kept.shape[0] == 102 and float(kept[0, 0, 0, 0]) == 39 and gend == 243 and json.loads(gspan)["ticks"] == "170"
assert ka["waveform"].shape[-1] == 102 * sr // 24 and float(ka["waveform"][0, 0, 0]) == 39 * sr // 24
# protect prefix on a hold map
hm = json.dumps({"holds": [4] * 141, "world_len": 141})
hm2, prep = ex.H3ProtectPrefix().protect(hm, plan)
holds = json.loads(hm2)["holds"]
assert holds[:39] == [1] * 39 and holds[39:124] == [4] * 85 and holds[124:] == [1] * 17  # non-final: suffix protected too
print(report)
print(trep)
print(rrep)
print(prep)
print("PASS")
# seam normalize: a prefix rendered 10% darker and 5% bluer gets mapped back, and the new material gets the same gains
src = torch.rand(39, 8, 8, 3) * 0.6 + 0.2
gen = (src.clamp(0, 1) ** 2.2 * torch.tensor([0.9, 0.9, 0.95])) ** (1 / 2.2)
new = torch.rand(12, 8, 8, 3) * 0.5 + 0.2
sa = {"waveform": torch.randn(1, 1, 52000) * 0.05, "sample_rate": 32000}
ga = {"waveform": torch.randn(1, 1, 52000) * 0.02, "sample_rate": 32000}
na = {"waveform": torch.randn(1, 1, 136000) * 0.02, "sample_rate": 32000}
out, oa, srep = ex.H3SeamNormalize().normalize(src, gen, new, "channels (linear-light RGB gains)", 1.25, sa, ga, na)
assert out.shape == new.shape and (out.mean() > new.mean())
assert abs(oa["waveform"].pow(2).mean().sqrt().item() / na["waveform"].pow(2).mean().sqrt().item() - 2.5) < 0.2
assert "gains R" in srep and "audio gain" in srep
print(srep)
