#!/usr/bin/env python3
"""Unit test for H3 Mask Conversion (h3_mask_conv.py), the #15988 fractional-
mask fix as a switchable instrument. CPU only, no GPU, no files.

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/test_mask_conversion.py

Sections 4 and 5 use comfy if it is importable and skip if it is not;
everything else is comfy-free.

Seven properties:
  1. NULL GATE: with every mask value 1.0, `on` must return the input tensors
     BIT-FOR-BIT, in every dtype. This is the acceptance gate for the whole
     re-baseline - if it fails, `on` and `off` differ for reasons that have
     nothing to do with the fix and every cell behind it is void.
  2. NO MASK: no mask at all is a pass-through by reference.
  3. SCOPE: `video only` / `audio only` touch exactly one stream, so a chain
     graph carrying three fractional paths can be factored.
  4. THE PR's TEST 1: a clean latent pushed to x = clean + sigma*m*v is
     recovered by the GLOBAL-sigma CONST conversion only after the velocity
     is scaled by m.
  5. THE PR's TEST 2: the audio scaling happens BEFORE the carry conversion,
     which is where a DIFFUSION_MODEL wrapper sits by construction (core
     applies the carry at model.py:579, after the wrapped call).
  6. THE PR's CONTRACT CHECK: at sigma=0.45, mask=205/256 the PR reports a
     baseline max x0 error of 0.6487081 and a patched 4.77e-7. Reproduce the
     shape of that on CPU.
  7. NO MUTATION: the model's own output list is not edited in place.
"""
import importlib.util
import os
import sys

import torch

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "h3_mask_conv", os.path.join(HERE, "h3_mask_conv.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
    ok = ok and bool(cond)


def have_comfy():
    # installed layout is <ComfyUI>/custom_nodes/<pack>; a git worktree of the
    # pack lives anywhere, and silently skipping 4/5/6 there loses the PR
    # contract checks exactly where the work is being done.
    for root in (os.path.dirname(os.path.dirname(HERE)),
                 os.environ.get("COMFYUI_ROOT", ""),
                 "/mnt/work/ai/apps/ComfyUI"):
        if root and os.path.isdir(os.path.join(root, "comfy", "ldm", "minimax")):
            if root not in sys.path:
                sys.path.insert(0, root)
            break
    try:
        import comfy.model_sampling  # noqa: F401
        return True
    except Exception as e:
        print("   (comfy not importable: %s: %s)" % (type(e).__name__, e))
        return False


# ------------------------------------------------------ 1. the null gate
print("\n1. NULL GATE: mask of ones is bit-exact")
for dtype in (torch.float32, torch.bfloat16, torch.float16):
    v = torch.randn(1, 24, 7, 8, 8).to(dtype)
    a = torch.randn(1, 32, 2, 40).to(dtype)
    out = m.apply_mask_conversion(
        [v, a], torch.ones(1, 1, 7, 8, 8), torch.ones(1, 32, 2, 40), "both")
    same = (torch.equal(out[0], v) and torch.equal(out[1], a)
            and out[0].dtype is dtype and out[1].dtype is dtype)
    check("   %-9s bit-exact at m=1" % str(dtype).replace("torch.", ""), same)

# a mask that is all ones EXCEPT one row must move exactly that row
v = torch.ones(1, 1, 2, 2, 2)
mask = torch.ones(1, 1, 2, 2, 2)
mask[0, 0, 1] = 0.5
out = m.apply_mask_conversion([v, None], mask, None, "video only")[0]
check("   one fractional row moves, the rest do not",
      torch.equal(out[0, 0, 0], v[0, 0, 0]) and torch.equal(out[0, 0, 1], v[0, 0, 1] * 0.5))

# ------------------------------------------------------ 2. no mask
print("\n2. NO MASK: pass-through by reference")
v, a = torch.randn(2, 3), torch.randn(2, 3)
out = m.apply_mask_conversion([v, a], None, None, "both")
check("   both streams returned by reference", out[0] is v and out[1] is a)

# ------------------------------------------------------ 3. scope
print("\n3. SCOPE: one stream at a time")
for scope, want_v, want_a in (("both", True, True),
                              ("video only", True, False),
                              ("audio only", False, True)):
    v, a = torch.full((2, 2), 2.0), torch.full((2, 2), 3.0)
    half = torch.full((2, 2), 0.5)
    out = m.apply_mask_conversion([v, a], half, half, scope)
    moved_v = torch.equal(out[0], v * 0.5)
    moved_a = torch.equal(out[1], a * 0.5)
    check("   %-11s video %s audio %s" % (scope, moved_v, moved_a),
          moved_v == want_v and moved_a == want_a)
try:
    m.apply_mask_conversion([torch.zeros(1)], None, None, "nonsense")
    check("   an unknown scope is refused", False, "no error raised")
except ValueError:
    check("   an unknown scope is refused", True)

# ------------------------------------------------------ 4/5/6. the PR
if have_comfy():
    from comfy.model_sampling import CONST

    print("\n4. PR TEST 1: masked video x0 recovery")
    video_output = torch.full((1, 2, 1, 2, 2), 2.0)
    audio_output = torch.full((1, 2, 2, 3), 3.0)
    video_mask = torch.tensor([[[[[1.0, 0.75], [0.5, 0.25]]]]])
    audio_mask = torch.tensor([[[[1.0, 0.5, 0.25], [0.75, 0.5, 0.0]]]])
    sigma = torch.tensor([0.5])
    clean = torch.arange(video_output.numel(), dtype=torch.float32).reshape_as(video_output)
    x = clean + sigma.reshape(1, 1, 1, 1, 1) * video_mask * video_output

    corr = m.apply_mask_conversion([video_output, audio_output],
                                   video_mask, audio_mask, "both")
    check("   velocity scaled by the video mask",
          torch.equal(corr[0], video_output * video_mask))
    check("   velocity scaled by the audio mask",
          torch.equal(corr[1], audio_output * audio_mask))
    denoised = CONST.calculate_denoised(None, sigma, corr[0], x)
    err = (denoised - clean).abs().max().item()
    check("   global-sigma CONST recovers the clean latent", err < 1e-5,
          "max |x0 - clean| = %.3e" % err)

    uncorrected = CONST.calculate_denoised(None, sigma, video_output, x)
    err_off = (uncorrected - clean).abs().max().item()
    check("   and does NOT without the fix", err_off > 1e-2,
          "max |x0 - clean| = %.4f" % err_off)

    print("\n5. PR TEST 2: audio scaled before the carry conversion")
    a_out = torch.full((1, 1, 2, 2), 3.0)
    a_mask = torch.tensor([[[[0.75, 0.5], [0.25, 0.0]]]])
    corr = m.apply_mask_conversion([torch.ones(1, 1, 1, 1, 1), a_out],
                                   None, a_mask, "audio only")
    check("   audio velocity scaled at the wrapper's return point",
          torch.equal(corr[1], a_out * a_mask))

    print("\n6. PR CONTRACT CHECK: sigma=0.45, mask=205/256")
    print("   (PR reports baseline 0.6487081 -> patched 4.77e-7 on an RTX 5090)")
    sigma = torch.tensor([0.45])
    mv = 205.0 / 256.0
    mask = torch.full((1, 1, 2, 4, 4), mv)
    g = torch.Generator().manual_seed(0)
    v = torch.randn(1, 24, 2, 4, 4, generator=g)
    clean = torch.randn(1, 24, 2, 4, 4, generator=g)
    x = clean + sigma.reshape(1, 1, 1, 1, 1) * mv * v
    base = (CONST.calculate_denoised(None, sigma, v, x) - clean).abs().max().item()
    corr = m.apply_mask_conversion([v, None], mask, None, "video only")[0]
    patched = (CONST.calculate_denoised(None, sigma, corr, x) - clean).abs().max().item()
    check("   baseline error is visible", base > 1e-2, "%.7f" % base)
    check("   patched error is float noise", patched < 1e-5, "%.3e" % patched)
    check("   the fix removes the error entirely", patched < base / 1e4,
          "ratio %.1e" % (patched / base))
else:
    print("\n4/5/6. SKIPPED (comfy not importable)")

# ------------------------------- 6b. WRAPPER ORDER (the SLA skip hazard)
print("\n6b. WRAPPER ORDER: we must run FIRST")
print("   (a wrapper calling executor.original() skips every wrapper after it;")
print("    the SLA pack does exactly that at sla/patch.py:202)")

w = {"h3_sla_state": ["sla"], "h3_mask_conversion": ["mine"], "other": ["o"]}
moved = m.reorder_first(w, "h3_mask_conversion")
check("   our key is moved to the front", list(w)[0] == "h3_mask_conversion",
      str(list(w)))
check("   every other key survives, in order",
      list(w)[1:] == ["h3_sla_state", "other"] and moved == ["h3_sla_state", "other"],
      str(list(w)))
check("   the wrapper lists are the same objects",
      w["h3_sla_state"] == ["sla"] and w["h3_mask_conversion"] == ["mine"])
w2 = {"only": ["x"]}
check("   a dict without our key is untouched",
      m.reorder_first(w2, "h3_mask_conversion") == [] and list(w2) == ["only"])

# and the real hazard, end to end: a skipping wrapper must not silence us
class FakeExec:
    def __init__(self, wrappers, original):
        self.wrappers, self.original, self.idx = list(wrappers), original, 0
    def __call__(self, *a, **k):
        nxt = FakeExec(self.wrappers, self.original); nxt.idx = self.idx + 1
        return nxt.execute(*a, **k)
    def execute(self, *a, **k):
        if self.idx >= len(self.wrappers):
            return self.original(*a, **k)
        return self.wrappers[self.idx](self, *a, **k)

def skipping_wrapper(executor, *a, **k):      # what SLA does
    return executor.original(*a, **k)

fired = {"n": 0}
def ours(executor, *a, **k):
    fired["n"] += 1
    return executor(*a, **k)

orig = lambda *a, **k: ["out"]
FakeExec([skipping_wrapper, ours], orig).execute()
check("   BEHIND a skipping wrapper we never run (the bug)", fired["n"] == 0)
fired["n"] = 0
FakeExec([ours, skipping_wrapper], orig).execute()
check("   AHEAD of it we do (the fix)", fired["n"] == 1)

# ------------------------------------------------------ 7. no mutation
print("\n7. NO MUTATION of the model's output list")
v = torch.full((2, 2), 2.0)
before = v.clone()
m.apply_mask_conversion([v, v], torch.full((2, 2), 0.5), None, "video only")
check("   the caller's tensor is untouched", torch.equal(v, before))

summary = m.mask_summary(torch.tensor([0.0, 0.5, 1.0, 1.0]), "video mask")
check("   mask_summary counts fractional rows",
      "1 fractional" in summary and "1 at 0" in summary and "2 at 1" in summary,
      summary)

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
