#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit test for chunked modulation with per-token mod rows (MAINodes issue #5).

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/test_vram_lab_modrows.py

Since ComfyUI #15375 a `mod_segments` row is either a scalar mod-row index or a
per-token LongTensor with one entry per row of that segment, which is what any
non-uniform video/audio noise mask produces (H3TemporalInsert builds exactly
that). The streamed helpers indexed a whole-segment row tensor against a
chunk-sized slice, so they could only work when the chunk happened to be the
whole segment.

Four properties, CPU only, no H3 weights:
  1. SCALAR ROWS UNCHANGED: on the path that already worked, the patched
     helpers are bit-identical (max_abs_diff == 0) to a FROZEN copy of the
     pre-change helpers, at chunk sizes 97, 333, 1024, 4096, 16384.
  2. PER-TOKEN ROWS EXACT: chunked == an unchunked reference, and the reference
     is core's own `_mod_scale_shift` / `_mod_gate` (comfy/ldm/minimax/model.py),
     not a local re-implementation. Chunk sizes 128, 300, 777, 1024, 16384 plus
     hand-cut partitions: a chunk that straddles the audio/video boundary, and
     chunks that start before / end inside / start inside / end after a segment.
  3. MODALITY EXTRACTION: `_mod_seg_kind` on scalar and tensor selectors built
     with core's `row_index * 3 + tag` convention; the timestep index varies
     within a segment, the modality tag does not.
  4. THE CONVENTION IS CORE'S: the claim behind property 3 is checked against
     the running core source, not assumed.
"""
import importlib.util
import os
import sys

sys.path.insert(0, "/mnt/work/ai/apps/ComfyUI")

import torch  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "vram_lab_modrows_uut", os.path.join(HERE, "vram_lab.py"))
V = importlib.util.module_from_spec(spec)
sys.modules["vram_lab_modrows_uut"] = V
spec.loader.exec_module(V)

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


# ---------------------------------------------------------------- frozen references
# The helpers EXACTLY as they stood before the #5 fix (MAINodes v1.1.3). Kept here
# so property 1 compares against code, not against a memory of it.

def _old_mod_scale_shift_range(h, shift, scale, segments, c0, c1):
    for a, b, row in segments:
        lo, hi = max(a, c0), min(b, c1)
        if lo < hi:
            h[lo - c0:hi - c0].mul_(1.0 + scale[row].to(h.dtype)).add_(shift[row].to(h.dtype))
    return h


def _old_mod_gate_range(x, gate, other, segments, c0, c1):
    for a, b, row in segments:
        lo, hi = max(a, c0), min(b, c1)
        if lo < hi:
            x[lo:hi].addcmul_(other[lo - c0:hi - c0], gate[row].to(x.dtype))
    return x


# ---------------------------------------------------------------- fixtures
HID = 24
S = 2048
# A packed layout in core's order: text, a conditioning video span, audio, video last
# (issue #5's arithmetic, 10565 + 5819 = 16384, is exactly "video is the tail").
T_TEXT, T_COND, T_AUD, T_VID = (0, 100), (100, 400), (400, 700), (700, S)
N_LEVELS = 6                       # t_row values 0..5 -> table rows 0..17
TABLE = N_LEVELS * 3


def table(scale=1.0):
    return torch.randn(TABLE, HID, dtype=torch.float32) * scale


def rows(n, tag, levels):
    """One per-token selector over n rows, core's `t_row * 3 + tag` convention."""
    t_row = torch.randint(0, levels, (n,), dtype=torch.long)
    t_row[0] = 0
    t_row[-1] = levels - 1         # make sure the level really varies inside the segment
    return t_row * 3 + tag


SCALAR_SEGMENTS = [
    (T_TEXT[0], T_TEXT[1], 0 * 3 + 1),        # text
    (T_COND[0], T_COND[1], 4 * 3 + 0),        # cond video (t_row 4)
    (T_AUD[0], T_AUD[1], 1 * 3 + 2),          # audio
    (T_VID[0], T_VID[1], 0 * 3 + 0),          # video
]
TENSOR_SEGMENTS = [
    (T_TEXT[0], T_TEXT[1], 0 * 3 + 1),
    (T_COND[0], T_COND[1], 4 * 3 + 0),
    (T_AUD[0], T_AUD[1], rows(T_AUD[1] - T_AUD[0], 2, N_LEVELS)),
    (T_VID[0], T_VID[1], rows(T_VID[1] - T_VID[0], 0, N_LEVELS)),
]

SHIFT, SCALE, GATE = table(0.3), table(0.2), table(0.5)
X0 = torch.randn(S, HID, dtype=torch.float32)
H0 = torch.randn(S, HID, dtype=torch.float32)
OTHER = torch.randn(S, HID, dtype=torch.float32)


def cuts_uniform(chunk):
    c = list(range(0, S, chunk))
    return c + [S]


def run_scale_shift(fn, segments, cuts):
    """Apply a chunked scale/shift helper over the whole sequence, chunk by chunk."""
    out = torch.empty_like(H0)
    for c0, c1 in zip(cuts[:-1], cuts[1:]):
        h = H0[c0:c1].clone()
        fn(h, SHIFT, SCALE, segments, c0, c1)
        out[c0:c1] = h
    return out


def run_gate(fn, segments, cuts):
    x = X0.clone()
    for c0, c1 in zip(cuts[:-1], cuts[1:]):
        fn(x, GATE, OTHER[c0:c1], segments, c0, c1)
    return x


def ref_scale_shift(segments):
    """core comfy/ldm/minimax/model.py::_mod_scale_shift, whole sequence, no chunks."""
    h = H0.clone()
    return h3m._mod_scale_shift(h, SHIFT, SCALE, segments)


def ref_gate(segments):
    x = X0.clone()
    return h3m._mod_gate(x, GATE, OTHER, segments)


# ---------------------------------------------------------------- 1. scalar rows
print("1. SCALAR ROWS: patched == frozen pre-#5 helpers")
for chunk in (97, 333, 1024, 4096, 16384):
    cuts = cuts_uniform(chunk)
    d_ss = maxdiff(run_scale_shift(V._mod_scale_shift_range, SCALAR_SEGMENTS, cuts),
                   run_scale_shift(_old_mod_scale_shift_range, SCALAR_SEGMENTS, cuts))
    d_g = maxdiff(run_gate(V._mod_gate_range, SCALAR_SEGMENTS, cuts),
                  run_gate(_old_mod_gate_range, SCALAR_SEGMENTS, cuts))
    check("   chunk %5d  scale_shift max_abs_diff %.3e" % (chunk, d_ss), d_ss == 0.0)
    check("   chunk %5d  gate        max_abs_diff %.3e" % (chunk, d_g), d_g == 0.0)

# and the scalar path still agrees with core itself
d = maxdiff(run_scale_shift(V._mod_scale_shift_range, SCALAR_SEGMENTS, cuts_uniform(333)),
            ref_scale_shift(SCALAR_SEGMENTS))
check("   scalar chunked == core _mod_scale_shift, max_abs_diff %.3e" % d, d == 0.0)
d = maxdiff(run_gate(V._mod_gate_range, SCALAR_SEGMENTS, cuts_uniform(333)),
            ref_gate(SCALAR_SEGMENTS))
check("   scalar chunked == core _mod_gate,        max_abs_diff %.3e" % d, d == 0.0)

# the old helpers really do fail on the new row form: the test is not vacuous
try:
    run_scale_shift(_old_mod_scale_shift_range, TENSOR_SEGMENTS, cuts_uniform(1024))
    check("   frozen helper raises on per-token rows", False, "it did not raise")
except RuntimeError as e:
    check("   frozen helper raises on per-token rows (this is issue #5)", True,
          str(e).split("\n")[0][:110])

# ---------------------------------------------------------------- 2. per-token rows
print("\n2. PER-TOKEN ROWS: chunked == unchunked core reference")
R_SS, R_G = ref_scale_shift(TENSOR_SEGMENTS), ref_gate(TENSOR_SEGMENTS)
for chunk in (128, 300, 777, 1024, 16384):
    cuts = cuts_uniform(chunk)
    d_ss = maxdiff(run_scale_shift(V._mod_scale_shift_range, TENSOR_SEGMENTS, cuts), R_SS)
    d_g = maxdiff(run_gate(V._mod_gate_range, TENSOR_SEGMENTS, cuts), R_G)
    check("   chunk %5d  scale_shift max_abs_diff %.3e" % (chunk, d_ss), d_ss == 0.0)
    check("   chunk %5d  gate        max_abs_diff %.3e" % (chunk, d_g), d_g == 0.0)

# hand-cut partitions that exercise every chunk/segment relationship
PARTITIONS = {
    "straddles the audio/video boundary (650..750)": [0, 650, 750, S],
    "chunk fully inside the video segment":          [0, 700, 900, 1100, S],
    "starts before a segment, ends inside it":       [0, 380, 500, S],
    "starts inside a segment, ends after it":        [0, 500, 900, S],
    "cut exactly on every segment edge":             [0, 100, 400, 700, S],
    "cut one row off every segment edge":            [0, 99, 101, 399, 401, 699, 701, S],
    "one row per chunk at a boundary":               [0, 698, 699, 700, 701, 702, S],
}
for name, cuts in PARTITIONS.items():
    d_ss = maxdiff(run_scale_shift(V._mod_scale_shift_range, TENSOR_SEGMENTS, cuts), R_SS)
    d_g = maxdiff(run_gate(V._mod_gate_range, TENSOR_SEGMENTS, cuts), R_G)
    check("   %-46s scale_shift %.3e gate %.3e" % (name, d_ss, d_g),
          d_ss == 0.0 and d_g == 0.0)

# the per-token selector must actually be exercised: a segment whose rows are all
# equal would pass every check above for the wrong reason.
vrow = TENSOR_SEGMENTS[3][2]
check("   the video selector really varies (%d distinct table rows)"
      % int(vrow.unique().numel()), int(vrow.unique().numel()) > 1)

# ---------------------------------------------------------------- 3. modality tag
print("\n3. MODALITY EXTRACTION (_mod_seg_kind)")
for tag, kind in ((0, "video"), (1, "text"), (2, "audio")):
    scal = 4 * 3 + tag
    check("   scalar row %2d -> tag %d (%s)" % (scal, tag, kind),
          V._mod_seg_kind(scal) % 3 == tag)
    sel = rows(64, tag, N_LEVELS)
    check("   tensor rows %s.. -> tag %d (%s), %d distinct levels"
          % (sel[:4].tolist(), tag, kind, int((sel // 3).unique().numel())),
          V._mod_seg_kind(sel) % 3 == tag and int((sel // 3).unique().numel()) > 1)

check("   _exact_av_rows' video test agrees on both forms",
      (V._mod_seg_kind(TENSOR_SEGMENTS[3][2]) % 3 == 0)
      and (V._mod_seg_kind(SCALAR_SEGMENTS[3][2]) % 3 == 0)
      and (V._mod_seg_kind(TENSOR_SEGMENTS[2][2]) % 3 == 2))
check("   _PrecProbe._seg_kind survives a tensor row",
      V._PrecProbe._seg_kind(TENSOR_SEGMENTS[2][2]).endswith("audio"),
      V._PrecProbe._seg_kind(TENSOR_SEGMENTS[2][2]))
try:
    V._mod_seg_kind(torch.zeros(0, dtype=torch.long))
    check("   empty per-token row raises", False, "it did not raise")
except ValueError as e:
    check("   empty per-token row raises ValueError", True, str(e))

# ---------------------------------------------------------------- 4. core's convention
print("\n4. THE CONVENTION IS CORE'S, checked against the running source")
import inspect  # noqa: E402
src = inspect.getsource(h3m.MiniMaxH3Model._forward)
check("   rows_to_mod_index builds t_row * 3 + tag", "t_row[v] * 3 + tag" in src,
      "comfy/ldm/minimax/model.py, core %s"
      % os.popen("git -C /mnt/work/ai/apps/ComfyUI rev-parse --short HEAD").read().strip())
check("   every per-token call site passes ONE tag for the segment",
      src.count("rows_to_mod_index(video_rows_t, seg_tag[kind])") == 1
      and src.count("rows_to_mod_index(audio_rows_t, seg_tag[kind])") == 1)
check("   core reads both row forms through one helper (_mod_row)",
      "def _mod_row(vecs, row, dtype)" in inspect.getsource(h3m))

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
