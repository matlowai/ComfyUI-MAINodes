#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit test for the streamed FinalLayer patch against core's calling contract
(MAINodes issue #4, ComfyUI #15908). CPU only, no H3 weights.

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/test_vram_lab_finallayer.py

#15908 added three positional arguments to FinalLayer.forward:

    forward(self, x, t_emb, video_seg, audio_seg, sigma, sample_sigmas, shifts)

Our patch captured its state in the 5th/6th/7th parameter slots, so core's new
positionals bound into them: `_fl` became the sigma Tensor and the first
dereference raised `'Tensor' object has no attribute 'adaln_proj'`.

The FinalLayer under test is a REAL comfy.ldm.minimax.model.FinalLayer built with
core's own `operations`, at small dims. Nothing about core is mocked; the only
instrumentation is a counter wrapped around our own streamed_final_layer_forward
so the "did not stream" claims are mechanical.

Five properties:
  1. THE OLD SIGNATURE REALLY BREAKS: the pre-fix closure raises the reported
     AttributeError under the current core contract (the test is not vacuous).
  2. CAPTURES INTACT: called positionally as core does (model.py:776) and by
     keyword, `_fl` / `_c` / `_e` are untouched, and nothing is positionally
     bindable to them.
  3. PDD MULTI-HEAD -> STOCK: with video_out/audio_out stacked to 2 heads the
     patch delegates to stock, the sigma schedule reaches stock (proved by core
     raising its own ValueError when it is None), and streaming is never called.
  4. UNPROVEN HEAD BANK -> STOCK: a weight whose shape does not divide
     out_features reads as unknown and falls back, it does not read as 1 head.
  5. SINGLE HEAD STREAMS AND MATCHES: streamed == stock for scalar rows and for
     per-token LongTensor rows (issue #5's form), at several chunk sizes.
"""
import importlib.util
import os
import sys

sys.path.insert(0, "/mnt/work/ai/apps/ComfyUI")

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "vram_lab_finallayer_uut", os.path.join(HERE, "vram_lab.py"))
V = importlib.util.module_from_spec(spec)
sys.modules["vram_lab_finallayer_uut"] = V
spec.loader.exec_module(V)

import comfy.ops  # noqa: E402
import comfy.ldm.minimax.model as h3m  # noqa: E402

torch.set_grad_enabled(False)
torch.manual_seed(0)

ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
    ok = ok and bool(cond)


def maxdiff(a, b):
    return float((a.float() - b.float()).abs().max().item())


# ---------------------------------------------------------------- the real FinalLayer
HID, T_DIM, VDIM, ADIM, EPS = 32, 16, 12, 8, 1e-6
LEVELS = 4                       # rows of the t_emb table
S = 512
VA, VB = 0, 400                  # video segment
AA, AB = 400, S                  # audio segment
OPS = comfy.ops.disable_weight_init


def fill_(mod):
    """disable_weight_init leaves parameters uninitialised; give them real values."""
    for p in mod.parameters():
        p.copy_(torch.randn(p.shape, dtype=torch.float32).to(p.dtype) * 0.2)
    return mod


def make_fl(heads=1):
    fl = h3m.FinalLayer(HID, T_DIM, VDIM, ADIM, EPS, dtype=torch.float32,
                        device=torch.device("cpu"), operations=OPS)
    fill_(fl)
    if heads != 1:               # what a PDD LoRA does: stack n heads into the head weights
        for lin, dim in ((fl.video_out, VDIM), (fl.audio_out, ADIM)):
            lin.weight = nn.Parameter(torch.randn(heads * dim, HID) * 0.2)
            lin.bias = nn.Parameter(torch.randn(heads * dim) * 0.2)
        # out_features stays the true output width; that is how core reads n
    return fl


X = torch.randn(S, HID, dtype=torch.float32)
T_EMB = torch.randn(LEVELS, T_DIM, dtype=torch.float32)
SIGMA = torch.tensor(0.5)
SAMPLE_SIGMAS = torch.tensor([1.0, 0.75, 0.5, 0.25, 0.0])
SHIFTS = (12.0, 3.0)
CORE_ARGS = (SIGMA, SAMPLE_SIGMAS, SHIFTS)

SEG_SCALAR = ((VA, VB, 0), (AA, AB, 1))
SEG_TENSOR = ((VA, VB, torch.randint(0, LEVELS, (VB - VA,), dtype=torch.long)),
              (AA, AB, torch.randint(0, LEVELS, (AB - AA,), dtype=torch.long)))
for _s in SEG_TENSOR:            # make sure the selectors really vary
    _s[2][0], _s[2][-1] = 0, LEVELS - 1


def stock(fl, video_seg, audio_seg, *extra):
    return h3m.FinalLayer.forward(fl, X, T_EMB, video_seg, audio_seg, *extra)


# ---------------------------------------------------------------- 1. the old signature
print("1. THE OLD SIGNATURE under the current core contract")
FL1 = make_fl(1)


def _old_fl_forward(x, t_emb, video_seg, audio_seg, _fl=FL1, _c=16384, _e=True):
    if x.shape[0] < 1:
        return type(_fl).forward(_fl, x, t_emb, video_seg, audio_seg)
    return V.streamed_final_layer_forward(_fl, x, t_emb, video_seg, audio_seg,
                                          chunk=_c, exact_gemm=_e)


try:
    _old_fl_forward(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1], *CORE_ARGS)
    check("   pre-fix closure raises", False, "it did not raise")
except AttributeError as e:
    check("   pre-fix closure raises AttributeError (issue #4)", True, str(e))
except Exception as e:  # noqa: BLE001
    check("   pre-fix closure raises AttributeError", False, "%s: %s" % (type(e).__name__, e))

check("   core FinalLayer.forward carries the #15908 arguments",
      list(h3m.FinalLayer.forward.__code__.co_varnames[:8])
      == ["self", "x", "t_emb", "video_seg", "audio_seg", "sigma", "sample_sigmas", "shifts"],
      str(h3m.FinalLayer.forward.__code__.co_varnames[:8]))

# ---------------------------------------------------------------- 2. captures intact
print("\n2. CAPTURES INTACT (positional as core calls, and by keyword)")
F1 = V._final_layer_forward_factory(FL1, 128, True, 1, None)
check("   nothing is positionally bindable to the captures (__defaults__ is None)",
      F1.__defaults__ is None, repr(F1.__defaults__))
kd = F1.__kwdefaults__
check("   _fl / _c / _e are keyword-only defaults",
      set(kd) == {"_fl", "_c", "_e"} and kd["_fl"] is FL1 and kd["_c"] == 128 and kd["_e"] is True,
      "keys=%s _c=%r _e=%r" % (sorted(kd), kd["_c"], kd["_e"]))

r_pos = F1(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1], *CORE_ARGS)
r_kw = F1(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1],
          sigma=SIGMA, sample_sigmas=SAMPLE_SIGMAS, shifts=SHIFTS)
kd = F1.__kwdefaults__
check("   after both calls the captures are unchanged",
      kd["_fl"] is FL1 and kd["_c"] == 128 and kd["_e"] is True)
check("   positional and keyword calls agree, max_abs_diff v %.3e a %.3e"
      % (maxdiff(r_pos[0], r_kw[0]), maxdiff(r_pos[1], r_kw[1])),
      maxdiff(r_pos[0], r_kw[0]) == 0.0 and maxdiff(r_pos[1], r_kw[1]) == 0.0)

# ---------------------------------------------------------------- 3. PDD multi-head
print("\n3. PDD MULTI-HEAD (2 stacked heads) -> stock, streaming never called")
FL2 = make_fl(2)
check("   head bank read as 2", V._final_layer_head_bank(FL2) == 2,
      "video_out.weight rows %d / out_features %d"
      % (FL2.video_out.weight.shape[0], FL2.video_out.out_features))

calls = {"n": 0}
_real_stream = V.streamed_final_layer_forward


def _counting_stream(*a, **k):
    calls["n"] += 1
    return _real_stream(*a, **k)


V.streamed_final_layer_forward = _counting_stream
F2 = V._final_layer_forward_factory(FL2, 128, True, 1, None)
r2 = F2(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1], *CORE_ARGS)
check("   streamed path not called", calls["n"] == 0, "calls=%d" % calls["n"])
s2 = stock(FL2, SEG_SCALAR[0], SEG_SCALAR[1], *CORE_ARGS)
check("   result == stock PDD blend, max_abs_diff v %.3e a %.3e"
      % (maxdiff(r2[0], s2[0]), maxdiff(r2[1], s2[1])),
      maxdiff(r2[0], s2[0]) == 0.0 and maxdiff(r2[1], s2[1]) == 0.0)
check("   the PDD blend is not the single-head answer (the test can tell them apart)",
      maxdiff(r2[0], nn.functional.linear(
          (FL2.norm(X[VA:VB]) * (1.0 + FL2.adaln_proj(T_EMB)[1][0]) + FL2.adaln_proj(T_EMB)[0][0]),
          FL2.video_out.weight[:VDIM], FL2.video_out.bias[:VDIM])) > 1e-4)

try:                             # sample_sigmas must have REACHED stock, in its own slot
    F2(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1], SIGMA, None, SHIFTS)
    check("   sample_sigmas reaches stock", False, "core did not raise on None")
except ValueError as e:
    check("   sample_sigmas reaches stock in its own slot (core's own ValueError)", True, str(e))
except TypeError as e:
    check("   sample_sigmas reaches stock", False, "arguments were dropped: %s" % e)

# by keyword too
try:
    F2(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1], sigma=SIGMA, sample_sigmas=None, shifts=SHIFTS)
    check("   keyword form reaches stock", False, "core did not raise on None")
except ValueError:
    check("   keyword form reaches stock as well", True)

# ---------------------------------------------------------------- 4. unproven bank
print("\n4. UNPROVEN HEAD BANK -> stock, never streaming")
FL3 = make_fl(1)
FL3.video_out.weight = nn.Parameter(torch.randn(VDIM + 1, HID) * 0.2)   # does not divide
check("   ragged weight reads as unknown, not as 1",
      V._final_layer_head_bank(FL3) is None, repr(V._final_layer_head_bank(FL3)))


class _OpaqueWeight:
    """A weight-like object with no plain `.shape` (a quantised/proxy layout)."""
    def __getattr__(self, k):
        raise AttributeError(k)


FL4 = make_fl(1)
object.__setattr__(FL4.video_out, "_parameters", dict(FL4.video_out._parameters))
FL4.video_out._parameters.pop("weight")
FL4.video_out.weight = _OpaqueWeight()
check("   opaque weight object reads as unknown",
      V._final_layer_head_bank(FL4) is None, repr(V._final_layer_head_bank(FL4)))

calls["n"] = 0
F3 = V._final_layer_forward_factory(FL3, 128, True, 1, None)
try:
    F3(X, T_EMB, SEG_SCALAR[0], SEG_SCALAR[1], *CORE_ARGS)
except Exception as e:  # noqa: BLE001  core will object to the ragged weight itself
    print("   (stock rejected the ragged weight, as it should: %s: %s)"
          % (type(e).__name__, str(e)[:80]))
check("   unknown bank never reaches the streamed path", calls["n"] == 0, "calls=%d" % calls["n"])
V.streamed_final_layer_forward = _real_stream

# ---------------------------------------------------------------- 5. single head streams
print("\n5. SINGLE HEAD: streamed == stock")
# Tolerance. exact_gemm=True chunks only the elementwise norm/mod fill into one
# fp32 buffer and then runs the head GEMM at the stock M, so it is expected to be
# BIT-identical (0.0) and is asserted as such. exact_gemm=False chunks the GEMM
# too, and a BLAS kernel is chosen by M, so it is only expected to agree to
# float32 accumulation noise; the bound is 1e-5 relative to the output amplitude
# and the measured value is printed.
for segname, (vseg, aseg) in (("scalar rows", SEG_SCALAR), ("per-token rows", SEG_TENSOR)):
    sv, sa = stock(FL1, vseg, aseg, *CORE_ARGS)
    amp = max(float(sv.abs().max()), float(sa.abs().max()))
    for chunk in (7, 128, 333, 400, 16384):
        for exact in (True, False):
            F = V._final_layer_forward_factory(FL1, chunk, exact, 1, None)
            v, a = F(X, T_EMB, vseg, aseg, *CORE_ARGS)
            d = max(maxdiff(v, sv), maxdiff(a, sa))
            if exact:
                check("   %-14s chunk %5d exact   max_abs_diff %.3e" % (segname, chunk, d),
                      d == 0.0)
            else:
                check("   %-14s chunk %5d chunked max_abs_diff %.3e (amp %.3f, bound %.1e)"
                      % (segname, chunk, d, amp, 1e-5 * amp), d <= 1e-5 * amp)

# and it really did stream
calls["n"] = 0
V.streamed_final_layer_forward = _counting_stream
V._final_layer_forward_factory(FL1, 128, True, 1, None)(X, T_EMB, *SEG_SCALAR, *CORE_ARGS)
check("   the single-head path does stream", calls["n"] == 1, "calls=%d" % calls["n"])
calls["n"] = 0
V._final_layer_forward_factory(FL1, 128, True, S + 1, None)(X, T_EMB, *SEG_SCALAR, *CORE_ARGS)
check("   below min_tokens it does not (%d rows < %d)" % (S, S + 1), calls["n"] == 0)
V.streamed_final_layer_forward = _real_stream

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
