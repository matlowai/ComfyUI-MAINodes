#!/usr/bin/env python3
"""H3 Cond Strength: the source->row mapping, the labels, and the equality the
design rests on, on BOTH streams. Run from the ComfyUI root:

    python custom_nodes/ComfyUI-MAINodes/tests/test_h3_cond_strength.py

No GPU, no weights, no model instance: the row builders read nothing off
`self` but `patch_size`, so a stub stands in for the 50-layer transformer and
core's real builders do the arithmetic.

The load-bearing assertions are the bit-identity ones. The node splits ONE
call to core's blend into N calls, which is only safe because core restarts
the same RNG stream for every condition - so a uniform strength must come
back BIT-IDENTICAL, not close, on video and on audio.
"""
import os, sys
sys.path.insert(0, os.getcwd())
import comfy.options; comfy.options.enable_args_parsing()
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
from importlib import import_module

import torch

cs = import_module("ComfyUI-MAINodes.h3_cond_strength")
import comfy.ldm.minimax.model as mm

DEV = torch.device("cpu")
NAMES = {s: cs.core_cond_rows_name(s) for s in cs.ORDER}
assert NAMES["video"], "this core has no video condition-row builder to patch"
assert NAMES["audio"], "this core has no audio condition-row builder to patch"
STOCK = {s: getattr(mm.MiniMaxH3Model, n) for s, n in NAMES.items()}  # pre-patch


class Stub:
    patch_size = (1, 2, 2)


def vlat(seed, t=1, h=4, w=4):
    return torch.randn(1, 24, t, h, w, generator=torch.Generator().manual_seed(seed))


def alat(seed, t=4):
    return torch.randn(1, 32, 2, t, generator=torch.Generator().manual_seed(seed))


def payload(guides, refs, **extra):
    """guides/refs are lists of "v", "a" or "va" - which streams each carries."""
    kfs, rfs, vl, al = [], [], [], []
    for i, g in enumerate(guides):
        kf = {"resolved_frame_index": i}
        if "v" in g:
            kf["latent"] = vlat(10 + i)
        if "a" in g:
            kf["audio_latent"] = alat(50 + i)
        kfs.append(kf)
    for j, r in enumerate(refs):
        ref = {"kind": {"v": "image", "a": "audio", "va": "video_audio"}[r]}
        if "v" in r:
            ref["latent"] = vlat(100 + j)
        if "a" in r:
            ref["audio_latent"] = alat(150 + j)
        rfs.append(ref)
    for kf in kfs:
        if kf.get("latent") is not None:
            vl.append(kf["latent"])
    for ref in rfs:
        if ref.get("latent") is not None:
            vl.append(ref["latent"])
    for kf in kfs:
        if kf.get("audio_latent") is not None:
            al.append(kf["audio_latent"])
    for ref in rfs:
        if ref.get("audio_latent") is not None:
            al.append(ref["audio_latent"])
    p = {"keyframes": kfs, "refs": rfs, "cond_video_latents": vl,
         "cond_audio_latents": al, "seed": 1234}
    p.update(extra)
    return p


# ------------------------------------------------ the source classification
p = payload(["v", "a"], ["v", "a", "va"])
assert cs.classify_sources(p, "video") == [
    ("guide_video", 0), ("ref_image", 0), ("ref_video", 2)], cs.classify_sources(p, "video")
assert cs.classify_sources(p, "audio") == [
    ("guide_audio", 1), ("ref_audio", 1), ("ref_audio", 2)], cs.classify_sources(p, "audio")
# reference 2 is ONE source object appearing on both streams under its own
# index, and the audio-only guide never shifts the video mapping
print("source classification: ok (one object, one slot, across streams)")

# ---------------------------------------------------------- the plan build
spec = cs.build_spec(guide_strength=1.0, reference_strength=0.5,
                     guide_audio_strength=0.9, reference_audio_strength=0.4)
plan, src = cs.build_plan(p, spec, "video")
assert plan == [1.0, 0.5, 0.5], plan
plan, src = cs.build_plan(p, spec, "audio")
assert plan == [0.9, 0.4, 0.4], plan

# a per-reference entry governs BOTH rows of the object it names
spec = cs.build_spec(guide_strength=1.0, reference_strength=0.5,
                     reference_audio_strength=0.4,
                     reference_strengths=",,0.2")      # reference object 2
assert cs.build_plan(p, spec, "video")[0] == [1.0, 0.5, 0.2]
assert cs.build_plan(p, spec, "audio")[0] == [None, 0.4, 0.2]
print("plan build: ok (per-reference override spans both of its streams)")

# inherit stays inherit
spec = cs.build_spec(reference_strength=0.7)
assert cs.build_plan(p, spec, "video")[0] == [None, 0.7, 0.7]

# counts that do not add up are refused, not guessed
bad = payload(["v"], ["v"])
bad["cond_video_latents"] = bad["cond_video_latents"][:1]
for stream in ("video",):
    try:
        cs.build_plan(bad, cs.build_spec(guide_strength=1.0), stream)
    except RuntimeError as e:
        assert "Refusing" in str(e)
    else:
        raise AssertionError("a count mismatch must refuse")

for text, count, want in (("", 2, [None, None]), ("0.5", 2, [0.5, None]),
                          ("0.5, 0.25", 2, [0.5, 0.25]), ("0.5;0.25", 2, [0.5, 0.25]),
                          # a blank KEEPS its slot; dropping it would slide
                          # every later value onto the wrong reference
                          ("0.9,,0.2", 3, [0.9, None, 0.2]),
                          (",0.4", 2, [None, 0.4]), ("0.5,", 2, [0.5, None])):
    assert cs.parse_strengths(text, count) == want, (text, want)
for bad_text in ("nope", "1.5", "-0.1", "0.5,0.5,0.5"):
    try:
        cs.parse_strengths(bad_text, 2)
    except ValueError:
        pass
    else:
        raise AssertionError("bad strengths must raise: %r" % bad_text)
print("parsing: ok")

# --------------------------------------------------------------- the label
src_v = [("guide_video", 0), ("ref_image", 0)]
assert cs.label_value([1.0, 0.5], src_v, "guide_video", "guides", None) == 1.0
assert cs.label_value([1.0, 0.5], src_v, "guide_video", "references", None) == 0.5
assert cs.label_value([1.0, 0.5], src_v, "guide_video", "core", None) is None
assert cs.label_value([0.9, 0.9], src_v, "guide_video", "guides", 0.9) is None
assert cs.label_value([None, 0.5], src_v, "guide_video", "guides", None) is None
src3 = src_v + [("ref_video", 1)]
assert cs.label_value([1.0, 0.8, 0.5], src3, "guide_video", "references", None) == 0.8
assert cs.label_mismatch([1.0, 0.5], src_v, 1.0) == ["ref_image 0 at 0.5000"]
assert cs.label_mismatch([1.0, 0.5], src_v, None) == []
print("label choice: ok")

# ------------------------------------------------------------- the patches
installed = cs.install_cond_rows_patch()
assert installed == NAMES, installed
patched = {s: getattr(mm.MiniMaxH3Model, n) for s, n in NAMES.items()}
for s in cs.ORDER:
    assert patched[s] is not STOCK[s] and getattr(patched[s], "_h3_cond_strength", False)
assert cs.install_cond_rows_patch() == NAMES
for s in cs.ORDER:
    assert getattr(mm.MiniMaxH3Model, NAMES[s]) is patched[s], \
        "installing twice must not stack a second chain on %s" % s

stub = Stub()

# inert without a plan, on both streams
p = payload(["va", "va"], ["v", "a"], visual_cond_noise_aug=0.8,
            audio_cond_noise_aug=0.7)
for s in cs.ORDER:
    assert torch.equal(patched[s](stub, p, DEV), STOCK[s](stub, p, DEV))
print("inert without a plan: ok (bit-identical, both streams)")

# THE EQUALITY: a uniform plan must reproduce stock exactly, because core
# reseeds per condition. If this ever fails, the per-latent split is not a
# refactor of core's blend and the node is unsafe.
for aug in (1.0, 0.999, 0.8, 0.25, 0.0):
    p = payload(["va", "v"], ["v", "va", "a"],
                visual_cond_noise_aug=aug, audio_cond_noise_aug=aug)
    want = {s: STOCK[s](stub, p, DEV) for s in cs.ORDER}
    n = {s: len(p[cs.STREAMS[s]["latents_key"]]) for s in cs.ORDER}
    p[cs.PAYLOAD_KEY] = {s: [aug] * n[s] for s in cs.ORDER}
    for s in cs.ORDER:
        assert torch.equal(patched[s](stub, p, DEV), want[s]), \
            "uniform %s plan diverged from stock at aug=%s" % (s, aug)
print("uniform plan == stock, bit-exact on video AND audio "
      "at aug 1.0 / 0.999 / 0.8 / 0.25 / 0.0: ok")

# a split plan moves only the rows it names, on each stream
for stream, rows_per in (("video", None), ("audio", None)):
    p = payload(["va"], ["va"], visual_cond_noise_aug=1.0, audio_cond_noise_aug=1.0)
    stock_rows = STOCK[stream](stub, p, DEV)
    p[cs.PAYLOAD_KEY] = {stream: [1.0, 0.5]}
    split = patched[stream](stub, p, DEV)
    half = split.shape[0] // 2
    assert torch.equal(split[:half], stock_rows[:half]), "%s guide rows moved" % stream
    assert not torch.equal(split[half:], stock_rows[half:]), \
        "%s reference rows did not move" % stream
print("split plan: ok (moves the reference rows, leaves the guide, both streams)")

# a plan that no longer matches the latents is refused, not applied blind
p = payload(["v"], ["v"])
p[cs.PAYLOAD_KEY] = {"video": [1.0]}
try:
    patched["video"](stub, p, DEV)
except RuntimeError as e:
    assert "Refusing" in str(e)
else:
    raise AssertionError("a stale plan must refuse")
print("stale plan: refused")

# ----------------------------------------------------------- the wrapper
def fake_executor(*args, **kwargs):
    return "out"


spec = cs.build_spec(guide_strength=1.0, reference_strength=0.5,
                     guide_audio_strength=0.9, reference_audio_strength=0.4,
                     label_follows="guides")
state = {}
p = payload(["va"], ["v", "a"], visual_cond_noise_aug=0.95,
            audio_cond_noise_aug=0.85)
assert cs._make_wrapper(spec, state)(fake_executor, minimax_payload=p) == "out"
assert p[cs.PAYLOAD_KEY] == {"video": [1.0, 0.5], "audio": [0.9, 0.4]}, p[cs.PAYLOAD_KEY]
assert p["visual_cond_noise_aug"] == 1.0 and p["audio_cond_noise_aug"] == 0.9, \
    "both labels must follow the guides"
assert state["seen"] == 1

# inherit survives the label override: the guide asked for nothing, so it keeps
# the 0.95 the graph set even though the label is rewritten to 0.5
spec2 = cs.build_spec(reference_strength=0.5, label_follows="references")
p = payload(["v"], ["v"], visual_cond_noise_aug=0.95)
cs._make_wrapper(spec2, {})(fake_executor, minimax_payload=p)
assert p[cs.PAYLOAD_KEY]["video"] == [0.95, 0.5], p[cs.PAYLOAD_KEY]
assert p["visual_cond_noise_aug"] == 0.5

# THE A/B THIS NODE EXISTS TO MAKE POSSIBLE: same strengths, opposite label.
# The content plan must be identical in both arms and only the label differ,
# or the experiment is not measuring the label.
arms = {}
for follows in ("guides", "references"):
    p = payload(["v"], ["v"], visual_cond_noise_aug=0.999)
    cs._make_wrapper(cs.build_spec(guide_strength=1.0, reference_strength=0.5,
                                   label_follows=follows), {})(
        fake_executor, minimax_payload=p)
    arms[follows] = (p[cs.PAYLOAD_KEY]["video"], p["visual_cond_noise_aug"])
assert arms["guides"][0] == arms["references"][0] == [1.0, 0.5], arms
assert arms["guides"][1] == 1.0 and arms["references"][1] == 0.5, arms
print("label-only A/B: ok (content plan identical, only the label moves)")

# a payload with no condition rows at all is left completely alone
p = {"seed": 1}
cs._make_wrapper(spec, {})(fake_executor, minimax_payload=p)
assert cs.PAYLOAD_KEY not in p and "visual_cond_noise_aug" not in p
# and a video-only payload gets no audio plan
p = payload(["v"], ["v"])
cs._make_wrapper(spec, {})(fake_executor, minimax_payload=p)
assert set(p[cs.PAYLOAD_KEY]) == {"video"}, p[cs.PAYLOAD_KEY]
print("empty / single-stream payloads: untouched where they should be")

print("\nALL OK")
