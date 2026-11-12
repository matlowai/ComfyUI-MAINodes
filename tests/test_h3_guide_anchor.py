#!/usr/bin/env python3
"""H3 Guide Anchor: the sign logic, and the identity it rests on. Run from
the ComfyUI root:

    python custom_nodes/ComfyUI-MAINodes/tests/test_h3_guide_anchor.py

No GPU, no weights, no model. The end-to-end section builds core's REAL
`PackedLayout` (cheap: it only lays out coordinates) and reads the time
coordinate core gives the guide rows, so the claim "float == pin with the
index shifted by -ref_span / FRAME_RESCALE" is checked against core's own
arithmetic rather than against a copy of it.
"""
import os, sys
sys.path.insert(0, os.getcwd())
import comfy.options; comfy.options.enable_args_parsing()
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
from importlib import import_module

import torch

ga = import_module("ComfyUI-MAINodes.h3_guide_anchor")
caps = import_module("ComfyUI-MAINodes.h3_capabilities")
import comfy.ldm.minimax.model as mm

R = float(mm.FRAME_RESCALE)

# ---------------------------------------------------------------- sign logic
# The whole node is one signed shift, and the sign depends on what the core
# already does. Every combination is spelled out because getting one wrong is
# silent: the render succeeds and the guide is a reference-span out of place.
assert ga.index_delta("pin", 7.0, R, "pin") == 0.0
assert ga.index_delta("float", 7.0, R, "float") == 0.0
assert ga.index_delta("float", 7.0, R, "pin") == -7.0 / R
assert ga.index_delta("pin", 7.0, R, "float") == +7.0 / R
assert ga.index_delta("offset", 7.0, R, "pin", offset_frames=-2.5) == -2.5
assert ga.index_delta("offset", 7.0, R, "unknown", offset_frames=3.0) == 3.0
assert ga.index_delta("pin", 0.0, R, "float") == 0.0        # no refs, no shift
for bad in ("unknown", None, "PIN"):
    try:
        ga.index_delta("float", 7.0, R, bad)
    except ValueError:
        pass
    else:
        raise AssertionError("an unclassified core must refuse, not default: %r" % (bad,))
try:
    ga.index_delta("pin", 7.0, 0.0, "float")
except ValueError:
    pass
else:
    raise AssertionError("FRAME_RESCALE <= 0 must raise, not divide")
print("sign logic: ok")

# ------------------------------------------------------------- span helpers
blocks = [{"kind": "image"},
          {"kind": "audio", "ref_audio_t": 6},
          {"kind": "video_audio", "ref_audio_t": 3, "latent_t": 2}]
mine = ga.total_ref_span(blocks)
theirs = ga.total_ref_span(blocks, mm._ref_t_span)
assert mine == theirs, ("the local mirror disagrees with core's _ref_t_span",
                        mine, theirs)
assert ga.total_ref_span([]) == 0.0 and ga.total_ref_span(None) == 0.0
print("ref spans: ok (mirror agrees with core, %.4f)" % theirs)

# -------------------------------------------------------------- no mutation
kfs = [{"resolved_frame_index": 0, "latent": "L0"},
       {"resolved_frame_index": 12, "latent": "L1"}]
out = ga.retimed_keyframes(kfs, -4.2)
assert [k["resolved_frame_index"] for k in kfs] == [0, 12], "input was mutated"
assert [k["resolved_frame_index"] for k in out] == [-4.2, 7.8]
assert out[0]["latent"] == "L0", "the rest of the keyframe must survive"
print("copy semantics: ok")

# ------------------------------------------------------- the node end to end
def cond(keyframes, refs):
    return [[torch.zeros(1, 4, 8), {"minimax_keyframes": keyframes,
                                    "minimax_refs": refs}]]

refs = [{"kind": "image"}, {"kind": "image"}]          # span 2.0
span = ga.total_ref_span(refs, mm._ref_t_span)
core_mode = caps.probe_core()["keyframe_anchor"]
assert core_mode == "pin", ("this checkout's core is %r; the end-to-end "
                            "section below assumes a pinning core" % core_mode)

c = cond([{"resolved_frame_index": 5}], refs)
same, rep = ga.apply_guide_anchor(c, "pin")
assert same[0][1]["minimax_keyframes"][0]["resolved_frame_index"] == 5.0
assert "bit-identical" in rep, rep

floated, rep = ga.apply_guide_anchor(c, "float")
got = floated[0][1]["minimax_keyframes"][0]["resolved_frame_index"]
assert abs(got - (5.0 - span / R)) < 1e-12, (got, span, R)
assert c[0][1]["minimax_keyframes"][0]["resolved_frame_index"] == 5, "input mutated"

empty, rep = ga.apply_guide_anchor([[torch.zeros(1, 4, 8), {}]], "float")
assert "nothing to do" in rep, rep
print("node: ok")

# --------------------------------------------- the identity, through core
# Build the layout core would build for the retimed index and read the time
# coordinate it assigns the guide's first row. Float must land exactly where a
# pre-#15439 core put it: text_len + FRAME_RESCALE * frame_idx, with the
# references contributing nothing.
TEXT_LEN, LAT_T, LAT_H, LAT_W, AUDIO_T = 11, 4, 4, 4, 3
IMG_REFS = [{"kind": "image", "latent_h": 4, "latent_w": 4},
            {"kind": "image", "latent_h": 4, "latent_w": 4}]
IMG_SPAN = ga.total_ref_span(IMG_REFS, mm._ref_t_span)


def guide_t(frame_index, refs):
    kf = [{"resolved_frame_index": frame_index,
           "latent": torch.zeros(1, 24, 1, LAT_H, LAT_W)}]
    layout = mm.PackedLayout(TEXT_LEN, LAT_T, LAT_H, LAT_W, AUDIO_T,
                             keyframes=kf, refs=refs)
    start, stop, kind = next(s for s in layout.segments if s[2] == "cond")
    assert stop > start, "no cond rows were emitted"
    col = layout.position_ids[start:stop, 0]
    assert torch.allclose(col, col[0]), "a one-latent-frame guide is one time value"
    return float(col[0])


for idx in (0, 5, 12):
    pinned = guide_t(idx, IMG_REFS)
    assert abs(pinned - (TEXT_LEN + IMG_SPAN + R * idx)) < 1e-9, pinned
    delta = ga.index_delta("float", IMG_SPAN, R, "pin")
    floated_t = guide_t(idx + delta, IMG_REFS)
    want = TEXT_LEN + R * idx                       # the pre-#15439 placement
    assert abs(floated_t - want) < 1e-9, (idx, floated_t, want)
    # and with no references at all the two placements coincide, which is why
    # the bug hid for as long as it did
    assert abs(guide_t(idx, []) - want) < 1e-9
print("identity through core's PackedLayout: ok (frames 0, 5, 12; span %.1f)" % IMG_SPAN)

# a mixed reference set, where the span is not a whole number of frames
MIXED = [{"kind": "image", "latent_h": 4, "latent_w": 4},
         {"kind": "audio", "ref_audio_t": 5}]
MIXED_SPAN = ga.total_ref_span(MIXED, mm._ref_t_span)
d = ga.index_delta("float", MIXED_SPAN, R, "pin")
assert abs(guide_t(7 + d, MIXED) - (TEXT_LEN + R * 7)) < 1e-9
print("identity holds for a mixed reference set too (span %.1f, delta %+.4f)"
      % (MIXED_SPAN, d))

print("\nALL OK")
