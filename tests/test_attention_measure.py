#!/usr/bin/env python3
"""Unit test for H3 Attention Measure (h3_measure.py). CPU only, no GPU, no
files. Section 6 uses comfy if it is importable and skips if it is not;
everything else is comfy-free.

    python tests/test_attention_measure.py

Six properties:
  1. NULL GATE: a uniform hold map (every hold 1) makes log w exactly zero
     everywhere, so the widened-head path must reproduce stock attention.
     The number printed is max|dx| against the same backend on the same
     tensors; the mechanism is only a no-op if that number is float noise.
  2. DUPLICATE COLLAPSE: keys duplicated pairwise, each copy given
     log(1/2), give the softmax output of the un-duplicated sequence.
     This is the whole hypothesis, stated as arithmetic.
  3. STRENGTH 0 == MODE OFF: both return the input model untouched, with no
     clone and no override.
  4. NON-VIDEO ROWS: text / cond / reference / audio rows carry weight 0.
  5. SPARSE REFUSAL: an installed sparse override is a hard error, because
     this measurement runs dense.
  6. ROW MAPPING: the rows we weight are exactly the rows the core's own
     PackedLayout marks as target video, with and without a reference block
     in front of them.
"""
import importlib.util
import json
import math
import os
import sys

import torch

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "h3_measure", os.path.join(HERE, "h3_measure.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
    ok = ok and bool(cond)


def backend(q, k, v, heads, mask=None, attn_precision=None,
            skip_reshape=False, skip_output_reshape=False, **kwargs):
    """Stand-in for comfy's attention_pytorch: same SDPA call, same scale
    convention (kwargs["scale"] when given, dim_head ** -0.5 otherwise)."""
    extra = {}
    if kwargs.get("scale") is not None:
        extra["scale"] = kwargs["scale"]
    out = torch.nn.functional.scaled_dot_product_attention(
        q, k, v, attn_mask=mask, dropout_p=0.0, is_causal=False, **extra)
    if not skip_output_reshape:
        b, h, s, d = out.shape
        out = out.transpose(1, 2).reshape(b, s, h * d)
    return out


def layout(text, audio, video_rows, latent_t):
    segs = [(0, text, "text"),
            (text, text + audio, "audio"),
            (text + audio, text + audio + video_rows, "video")]
    return {"segments": segs, "latent_t": latent_t,
            "seq_len": text + audio + video_rows}


# ---------------------------------------------------------------- 1. null gate
# latent_t 10 -> 34 dilated frames; a uniform map is 34 holds of 1.
LT, TEXT, AUD, FRAME_ROWS = 10, 10, 8, 2
VID = LT * FRAME_ROWS
LAY = layout(TEXT, AUD, VID, LT)
S = LAY["seq_len"]

# Widening the head from 128 to 136 changes the reduction the SDPA kernel
# runs, so "bit-identical" is not on offer: the gate is one ulp of the
# working dtype (the gate below allows 8, which is what a 38-key softmax
# reduction accumulates), which is the same standing the H3 dense path
# already gives a rerun of itself.
for dtype in (torch.float64, torch.float32, torch.float16, torch.bfloat16):
    torch.manual_seed(0)
    q = torch.randn(1, 4, S, 128, dtype=dtype)
    k = torch.randn(1, 4, S, 128, dtype=dtype)
    v = torch.randn(1, 4, S, 128, dtype=dtype)
    ov = m.make_override([1] * 34, 1.0)
    got = ov(backend, q, k, v, 4, mask=None, skip_reshape=True,
             skip_output_reshape=True,
             transformer_options={"mainodes_h3_layout": LAY})
    ref = backend(q, k, v, 4, mask=None, skip_reshape=True,
                  skip_output_reshape=True)
    dx = (got.double() - ref.double()).abs().max().item()
    scale_ = ref.double().abs().max().item()
    ulp = torch.finfo(dtype).eps * scale_
    check("null gate, uniform hold map is stock attention (%s)" % dtype,
          dx <= 8 * ulp + 1e-15,
          "max|dx| = %.3e = %.1f ulp (1 ulp = %.3e, |ref|max = %.3f, "
          "bit-identical = %s)"
          % (dx, dx / ulp, ulp, scale_, torch.equal(got, ref)))

lw = m.token_logw(LT, [1] * 34, 1.0)
check("uniform map gives exactly zero log w",
      all(x == 0.0 for x in lw), "logw = %s" % lw[:3])


# -------------------------------------------------- 2. duplicate collapse toy
# holds all 2 over 17 world frames = 34 dilated frames = latent_t 10, so every
# temporal token has duplication factor exactly 2 (log w = -log 2).
holds2 = [2] * 17
lw2 = m.token_logw(LT, holds2, 1.0)
check("holds all 2 gives -log 2 on every token",
      max(abs(x + math.log(2.0)) for x in lw2) < 1e-12,
      "logw[0] = %.12f, want %.12f" % (lw2[0], -math.log(2.0)))

torch.manual_seed(1)
dt = torch.float64
q = torch.randn(1, 3, S, 8, dtype=dt)
k_head = torch.randn(1, 3, TEXT + AUD, 8, dtype=dt)
v_head = torch.randn(1, 3, TEXT + AUD, 8, dtype=dt)
# 5 distinct video "cells", each present twice (two temporal tokens of
# FRAME_ROWS rows each), which is exactly what a hold of 2 produces.
cells_k = torch.randn(1, 3, 5, FRAME_ROWS, 8, dtype=dt)
cells_v = torch.randn(1, 3, 5, FRAME_ROWS, 8, dtype=dt)
dup_k = cells_k.repeat_interleave(2, dim=2).reshape(1, 3, VID, 8)
dup_v = cells_v.repeat_interleave(2, dim=2).reshape(1, 3, VID, 8)
uni_k = cells_k.reshape(1, 3, 5 * FRAME_ROWS, 8)
uni_v = cells_v.reshape(1, 3, 5 * FRAME_ROWS, 8)

ov = m.make_override(holds2, 1.0)
got = ov(backend, q, torch.cat((k_head, dup_k), 2), torch.cat((v_head, dup_v), 2),
         3, mask=None, skip_reshape=True, skip_output_reshape=True,
         transformer_options={"mainodes_h3_layout": LAY})
ref = backend(q, torch.cat((k_head, uni_k), 2), torch.cat((v_head, uni_v), 2),
              3, mask=None, skip_reshape=True, skip_output_reshape=True)
dx = (got - ref).abs().max().item()
check("duplicated keys at log(1/2) equal the un-duplicated softmax",
      dx < 1e-6, "max|dx| = %.3e" % dx)

# and the same run WITHOUT the correction is not the un-duplicated output
raw = backend(q, torch.cat((k_head, dup_k), 2), torch.cat((v_head, dup_v), 2),
              3, mask=None, skip_reshape=True, skip_output_reshape=True)
draw = (raw - ref).abs().max().item()
check("uncorrected duplication does move the output (the thing being fixed)",
      draw > 1e-3, "max|dx| = %.3e" % draw)


# ------------------------------------------------ 3. strength 0 == mode off
class FakeModel:
    def __init__(self):
        self.model_options = {"transformer_options": {}}
        self.cloned = False

    def clone(self):
        self.cloned = True
        return self


hm = json.dumps({"holds": holds2, "world_len": 17})
node = m.H3AttentionMeasure()
a = FakeModel()
out_a = node.patch(a, hm, "off", 1.0)[0]
b = FakeModel()
out_b = node.patch(b, hm, "log_measure", 0.0)[0]
check("mode off installs nothing",
      out_a is a and not a.cloned
      and "optimized_attention_override" not in a.model_options["transformer_options"],
      "cloned = %s" % a.cloned)
check("strength 0 installs nothing (same as off)",
      out_b is b and not b.cloned
      and "optimized_attention_override" not in b.model_options["transformer_options"],
      "cloned = %s" % b.cloned)


# ------------------------- 3b. the install path: override + layout wrapper
class FakePatcher(FakeModel):
    def __init__(self):
        FakeModel.__init__(self)
        self.wrappers = {}

    def add_wrapper_with_key(self, kind, key, fn):
        self.wrappers[(kind, key)] = fn


class FakeLayout:
    segments = LAY["segments"]
    seq_len = LAY["seq_len"]


p = FakePatcher()
node.patch(p, hm, "log_measure", 1.0)
ov_installed = p.model_options["transformer_options"].get("optimized_attention_override")
check("log_measure clones and installs an override + one wrapper",
      p.cloned and getattr(ov_installed, "mainodes_attention_measure", False)
      and len(p.wrappers) == 1,
      "wrapper keys = %s" % [k[1] for k in p.wrappers])

seen = {}
to_live = {}
wrap = list(p.wrappers.values())[0]


def fake_executor(*args, **kwargs):
    seen["layout"] = dict(args[3]["mainodes_h3_layout"])
    return "out"


x = [torch.zeros(1, 24, LT, 8, 8), torch.zeros(1, 32, 2, 40)]
res = wrap(fake_executor, x, torch.tensor([1.0]), torch.zeros(1, 226, 5120),
           to_live, minimax_payload={"layout": FakeLayout()})
check("the forward wrapper publishes the layout, then removes it",
      res == "out" and seen["layout"]["latent_t"] == LT
      and seen["layout"]["seq_len"] == LAY["seq_len"]
      and "mainodes_h3_layout" not in to_live,
      "published latent_t = %s, seq_len = %s, left behind = %s"
      % (seen["layout"]["latent_t"], seen["layout"]["seq_len"], list(to_live)))

try:
    m.make_override(holds2, 1.0)(backend, torch.zeros(1, 2, S, 8),
                                 torch.zeros(1, 2, S, 8),
                                 torch.zeros(1, 2, S, 8), 2, mask=None,
                                 skip_reshape=True, transformer_options={})
    check("an unpublished layout is a loud error", False, "no error raised")
except RuntimeError as e:
    check("an unpublished layout is a loud error",
          "no packed layout" in str(e), str(e)[:80])


# ----------------------------------------------------- 4. non-video rows are 0
w = m.row_logw(LAY["segments"], LT, S, holds2, 1.0)
head_max = w[:TEXT + AUD].abs().max().item()
vid_vals = sorted(set(w[TEXT + AUD:].tolist()))
check("text and audio rows carry weight 0",
      head_max == 0.0, "max|w| on the first %d rows = %r" % (TEXT + AUD, head_max))
check("every video row carries -log 2",
      len(vid_vals) == 1 and abs(vid_vals[0] + math.log(2.0)) < 1e-12,
      "distinct video weights = %s" % vid_vals)

# reference + cond rows are non-video segments and get 0 by the same rule
segs_ref = [(0, 4, "text"), (4, 9, "cond"), (9, 13, "ref_img"),
            (13, 16, "ref_audio"), (16, 24, "audio"), (24, 24 + VID, "video")]
w2 = m.row_logw(segs_ref, LT, 24 + VID, holds2, 1.0)
check("cond / ref_img / ref_audio rows carry weight 0",
      w2[:24].abs().max().item() == 0.0,
      "max|w| on rows 0-23 = %r" % w2[:24].abs().max().item())


# ------------------------------------------------------- 5. sparse refusal
def sol_attn_style_override(func, q, k, v, heads, **kw):
    return func(q, k, v, heads, **kw)


sol_attn_style_override.__module__ = "sol_attn_minimax_v5"
c = FakeModel()
c.model_options["transformer_options"]["optimized_attention_override"] = \
    sol_attn_style_override
try:
    node.patch(c, hm, "log_measure", 1.0)
    check("sparse override refused", False, "no error raised")
except RuntimeError as e:
    check("sparse override refused", "runs dense" in str(e), str(e)[:110])

check("block range parser", m.parse_blocks("") is None
      and m.parse_blocks("0-2,5") == {0, 1, 2, 5},
      "'0-2,5' -> %s" % sorted(m.parse_blocks("0-2,5")))

# a hold map that does not cover the latent is an error, not a silent shift
try:
    m.token_logw(LT, [2] * 16, 1.0)
    check("short hold map raises", False, "no error raised")
except ValueError as e:
    check("short hold map raises", "dilated frames" in str(e), str(e)[:90])


# ------------------- 6. the row mapping, against the real core PackedLayout
# Optional: needs comfy on sys.path. The core builds the packed sequence, so
# it is the only honest reference for "which rows are the target video".
try:
    sys.argv = [sys.argv[0], "--cpu"]
    import comfy.options
    comfy.options.enable_args_parsing()
    from comfy.ldm.minimax.model import PackedLayout
except Exception as e:  # noqa: BLE001
    print("SKIP core PackedLayout cross-check (%s: %s)" % (type(e).__name__, e))
else:
    for refs in (None, [{"kind": "image", "latent_t": 1, "latent_h": 32,
                         "latent_w": 32, "ref_audio_t": 0}]):
        L = PackedLayout(226, 10, 32, 32, 40, refs=refs)
        wl = m.row_logw(L.segments, 10, L.seq_len, holds2, 1.0)
        mine = (wl != 0).nonzero().flatten()
        core = L.img_pos[L.img_update]      # the rows the core denoises as video
        check("weighted rows are exactly the core's target video rows (%s)"
              % ("no refs" if refs is None else "one image ref"),
              torch.equal(mine, core),
              "rows %d..%d, n = %d; segments %s"
              % (mine[0], mine[-1], mine.numel(), L.segments))

print("\n" + ("ALL PASS" if ok else "FAILURES"))
sys.exit(0 if ok else 1)
