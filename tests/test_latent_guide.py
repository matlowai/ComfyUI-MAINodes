#!/usr/bin/env python3
"""Unit test for H3 Add Latent Guide and the cond-row clock follow.

  python tests/test_latent_guide.py
      CPU only, no GPU, no files, no model. Needs comfy on sys.path: the real
      comfy.ldm.minimax.model.PackedLayout is both the thing being patched and
      the reference every "bit-identical" claim is measured against (the
      unpatched __init__ is captured at import and run side by side).

  Seven sections, one per packet check:
    1. NO GUIDE: with the patch installed and no keyframes, position_ids and
       every index tensor are bit-identical to the unpatched builder — the
       node is a no-op for every graph that does not use it,
    2. FULL GUIDE, STOCK CLOCK: the cond rows' t column equals the target
       video rows' t column and their (h, w) columns match row for row; the
       whole layout is still bit-identical to the unpatched build, i.e. the
       retime is a receipt here and not a change,
    3. FULL GUIDE + TRUE CLOCK: still equal after the clock rewrite moves the
       target off the stock grid (and the move is measured, not assumed),
    4. PARTIAL GUIDE at token_idx=k under True Clock AND under DyRoPE: the
       cond rows equal the target's rows k..k+vt-1. The unpatched build is
       shown to FAIL the same check, with the deviation in rotary units —
       that is the trap this node exists to prevent
       (the aligned-guide A/B/C study, 2026-08-28,
       "Instrument gate": 156.7 / 447.5 units off on dense samples),
    5. VALIDATION: mismatched (h, w) raises, token_idx overflow raises, a
       batched guide raises, and an unmappable block raises under a rewritten
       clock instead of falling back to the stock grid,
    6. OTHER MODALITIES: text rows and target audio rows are bit-identical
       with and without a guide,
    7. D6 COST: the token-row cost of the three minted graphs' geometry.

Exit code 0 = pass.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "mainodes_motion", os.path.join(os.path.dirname(HERE), "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)

import json

import torch
import comfy.ldm.minimax.model as mm

FAILS = []

# captured BEFORE anything installs the chain: every "bit-identical" claim in
# this file is a comparison against THIS function, not an assertion
STOCK_PACKED_INIT = mm.PackedLayout.__init__
assert not getattr(STOCK_PACKED_INIT, "_h3_guide_rows", False)


def check(name, ok, detail):
    print(("  PASS  " if ok else "  FAIL  ") + name + "  " + detail)
    if not ok:
        FAILS.append(name)


def reset_state():
    motion._TRUE_CLOCK["spans"] = None
    motion._DYROPE.update({"active": False, "mode": None, "n_tokens": 0,
                           "spans_phys": None, "spans_comp": None, "blocks": (),
                           "fade_end": 0.5, "sigma_max": None, "sigma": None,
                           "alt_angles": None, "alt_table": None,
                           "alt_requested": 0, "last_weight": None})
    motion._GUIDE_LAYOUTS.clear()


def stock_layout(**kw):
    """A PackedLayout built by the UNPATCHED core __init__."""
    obj = mm.PackedLayout.__new__(mm.PackedLayout)
    STOCK_PACKED_INIT(obj, **kw)
    return obj


def kf(vt, resolved_frame_index):
    return {"resolved_frame_index": int(resolved_frame_index),
            "latent": torch.zeros(1, 24, int(vt), LAT_H, LAT_W)}


def guide_span(layout):
    """(start, stop) of the single cond segment."""
    seg = [(a, b) for a, b, kind in layout.segments if kind == "cond"]
    assert len(seg) == 1, seg
    return seg[0]


def video_span(layout):
    seg = [(a, b) for a, b, kind in layout.segments if kind == "video"]
    return seg[-1]


def rows_of_token(layout, k):
    """Row slice of target video token k."""
    v0, v1 = video_span(layout)
    rpf = (v1 - v0) // T_LAT
    return v0 + k * rpf, rpf


class StubRope(torch.nn.Module):
    """Just enough of MiniMaxH3Model for the real rope_freqs to run."""
    def __init__(self, length=16):
        super().__init__()
        self.rope = torch.nn.Module()
        self.rope.register_buffer("inv_freq", torch.linspace(1.0, 0.01, length))


TEXT_LEN, LAT_H, LAT_W, AUDIO_T = 13, 4, 6, 9
FRAME_ROWS = (LAT_H // 2) * (LAT_W // 2)          # 6
HOLDS = [3] * 39                                   # the 3-hold map of D4 t3
SPANS = motion.true_clock_spans(HOLDS)
T_LAT = len(SPANS)
BASE = dict(text_len=TEXT_LEN, latent_t=T_LAT, latent_h=LAT_H, latent_w=LAT_W,
            audio_t=AUDIO_T)

print("geometry: text %d  t_lat %d  latent %dx%d (%d rows/frame)  audio_t %d"
      % (TEXT_LEN, T_LAT, LAT_H, LAT_W, FRAME_ROWS, AUDIO_T))


# ---- 1) no guide: the patch is invisible -----------------------------------

print("1) no guide: patched builder == unpatched builder, bit for bit")

before = stock_layout(**BASE)
motion._install_guide_layout_patch()
patched_init = mm.PackedLayout.__init__
check("patch installed once (idempotent)",
      patched_init is not STOCK_PACKED_INIT
      and getattr(patched_init, "_h3_guide_rows", False)
      and (motion._install_guide_layout_patch() or
           mm.PackedLayout.__init__ is patched_init),
      "PackedLayout.__init__ marked _h3_guide_rows, second install is a no-op")

after = mm.PackedLayout(**BASE)
check("position_ids bit-identical",
      bool(torch.equal(after.position_ids, before.position_ids)),
      "%d rows x 3, torch.equal against the unpatched builder"
      % after.position_ids.shape[0])
for attr in ("img_pos", "img_update", "audio_pos", "audio_update"):
    check("%s bit-identical" % attr,
          bool(torch.equal(getattr(after, attr), getattr(before, attr))),
          "%d entries" % getattr(after, attr).shape[0])
check("seq_len / segments unchanged",
      after.seq_len == before.seq_len and after.segments == before.segments,
      "seq_len %d, segments %r" % (after.seq_len, after.segments))
check("no record kept for a guide-free layout",
      motion._GUIDE_LAYOUTS == {},
      "_GUIDE_LAYOUTS is empty (%d entries)" % len(motion._GUIDE_LAYOUTS))


# ---- 2) full guide, stock clock --------------------------------------------

print("2) full guide (vt == t_lat) at token_idx 0, stock clock")

reset_state()
full = dict(BASE, keyframes=[kf(T_LAT, 0)])
lay = mm.PackedLayout(**full)
raw = stock_layout(**full)
g0, g1 = guide_span(lay)
v0, v1 = video_span(lay)
check("one cond segment of t_lat frames",
      (g1 - g0) == T_LAT * FRAME_ROWS and (v1 - v0) == T_LAT * FRAME_ROWS,
      "cond rows %d..%d (%d), target video rows %d..%d (%d)"
      % (g0, g1, g1 - g0, v0, v1, v1 - v0))
check("cond t column == target video t column",
      bool(torch.equal(lay.position_ids[g0:g1, 0], lay.position_ids[v0:v1, 0])),
      "torch.equal on %d rows, first %.6f last %.6f"
      % (g1 - g0, float(lay.position_ids[g0, 0]), float(lay.position_ids[g1 - 1, 0])))
check("cond (h, w) columns == target (h, w) columns, row for row",
      bool(torch.equal(lay.position_ids[g0:g1, 1:], lay.position_ids[v0:v1, 1:])),
      "torch.equal on %d rows x columns 1:3" % (g1 - g0))
check("whole guided layout still bit-identical to the unpatched build",
      bool(torch.equal(lay.position_ids, raw.position_ids)),
      "the stock retime is a receipt, not a change: %d rows torch.equal"
      % lay.position_ids.shape[0])
rec = motion._GUIDE_LAYOUTS[lay.seq_len]
check("record keyed on seq_len, block mapped to token 0",
      rec["seq_len"] == lay.seq_len and rec["blocks"][0]["token_idx"] == 0
      and rec["blocks"][0]["vt"] == T_LAT and rec["rows_per_frame"] == FRAME_ROWS,
      "seq_len %d, video_start %d, rows/frame %d, block %r"
      % (rec["seq_len"], rec["video_start"], rec["rows_per_frame"],
         {k: rec["blocks"][0][k] for k in ("start", "stop", "vt", "token_idx")}))


# ---- 3) full guide + True Clock --------------------------------------------

print("3) full guide + H3 True Clock (3-hold map): equal AFTER the rewrite")

reset_state()
motion._install_true_clock_patch()
motion._TRUE_CLOCK["spans"] = SPANS
lay_tc = mm.PackedLayout(**full)
motion._TRUE_CLOCK["spans"] = None
stock_lay = mm.PackedLayout(**full)

v0, v1 = video_span(lay_tc)
g0, g1 = guide_span(lay_tc)
dev = float((lay_tc.position_ids[v0:v1, 0] - stock_lay.position_ids[v0:v1, 0]).abs().max())
check("the clock actually moved the target (else this test proves nothing)",
      dev > 1.0,
      "max |dt| target vs stock grid = %.4f rotary units over %d tokens"
      % (dev, T_LAT))
check("cond t column == retimed target t column",
      bool(torch.equal(lay_tc.position_ids[g0:g1, 0], lay_tc.position_ids[v0:v1, 0])),
      "torch.equal on %d rows, guide first %.6f last %.6f"
      % (g1 - g0, float(lay_tc.position_ids[g0, 0]),
         float(lay_tc.position_ids[g1 - 1, 0])))
check("non-video rows untouched by the retime",
      bool(torch.equal(lay_tc.position_ids[:g0], stock_lay.position_ids[:g0])),
      "%d text rows compared with torch.equal" % g0)


# ---- 4) partial guide under True Clock and under DyRoPE --------------------

print("4) partial guide at token_idx=k: cond rows == target rows k..k+vt-1")

K, VT = 4, 6
part = dict(BASE, keyframes=[kf(VT, motion.guide_frame_index(K))])

reset_state()
motion._TRUE_CLOCK["spans"] = SPANS
lay_p = mm.PackedLayout(**part)
trap = stock_layout(**part)              # what core builds with no node
motion._TRUE_CLOCK["spans"] = None

g0, g1 = guide_span(lay_p)
t0, rpf = rows_of_token(lay_p, K)
tgt = slice(t0, t0 + VT * rpf)
check("partial guide: cond rows == target rows %d..%d (True Clock)" % (K, K + VT - 1),
      bool(torch.equal(lay_p.position_ids[g0:g1], lay_p.position_ids[tgt])),
      "torch.equal on the FULL row (t, h, w), %d rows, guide t %.6f..%.6f"
      % (g1 - g0, float(lay_p.position_ids[g0, 0]),
         float(lay_p.position_ids[g1 - 1, 0])))
trap_dev = float((trap.position_ids[g0:g1, 0] - trap.position_ids[tgt, 0]).abs().max())
check("THE TRAP: core alone leaves the guide off the target under True Clock",
      not torch.equal(trap.position_ids[g0:g1, 0], trap.position_ids[tgt, 0])
      and trap_dev > 1.0,
      "unpatched build: max |guide t - target t| = %.4f rotary units" % trap_dev)
check("the retime only moved the cond rows",
      bool(torch.equal(lay_p.position_ids[:g0], trap.position_ids[:g0]))
      and bool(torch.equal(lay_p.position_ids[g1:], trap.position_ids[g1:]))
      and bool(torch.equal(lay_p.position_ids[g0:g1, 1:], trap.position_ids[g0:g1, 1:])),
      "rows 0..%d and %d..%d bit-identical; cond (h, w) columns unchanged"
      % (g0, g1, lay_p.position_ids.shape[0]))

# ...and now the same guide under DyRoPE's per-forward rope table
print("   under H3 DyRoPE (compact_blocks: default table physical, alt compact)")
stub = StubRope()
motion._install_dyrope_rope_patch()
rope = mm.MiniMaxH3Model.rope_freqs
spans_comp = motion.dyrope_stock_spans(T_LAT)
motion._DYROPE.update({"active": True, "mode": "compact_blocks", "n_tokens": T_LAT,
                       "spans_phys": SPANS, "spans_comp": spans_comp,
                       "alt_angles": None})
ang = rope(stub, lay_p.position_ids, torch.device("cpu"))
alt = motion._DYROPE["alt_angles"]
check("DyRoPE default table: guide angle rows == target angle rows",
      bool(torch.equal(ang[g0:g1], ang[tgt])),
      "torch.equal on %d x %d angles (physical grid)"
      % (g1 - g0, ang.shape[1]))
check("DyRoPE alternate table: guide angle rows == target angle rows",
      alt is not None and bool(torch.equal(alt[g0:g1], alt[tgt])),
      "torch.equal on %d x %d angles (compact grid), and the two tables differ: %s"
      % (g1 - g0, alt.shape[1], not torch.equal(alt, ang)))
# the same rope call with the record dropped is the DyRoPE half of the trap
motion._GUIDE_LAYOUTS.clear()
motion._DYROPE["alt_angles"] = None
ang_trap = rope(stub, lay_p.position_ids, torch.device("cpu"))
alt_trap = motion._DYROPE["alt_angles"]
check("THE TRAP: without the record, DyRoPE's alternate table strands the guide",
      bool(torch.equal(ang_trap[g0:g1], ang_trap[tgt]))
      and not torch.equal(alt_trap[g0:g1], alt_trap[tgt]),
      "default table still equal (the layout carried it), alternate table NOT: "
      "the rope wrapper rewrote out[start:, 0] only")
reset_state()


# ---- 5) validation -------------------------------------------------------

print("5) validation: the node raises, and an unmappable block raises")

node = motion.H3AddLatentGuide()
POS = [[torch.zeros(1, TEXT_LEN, 8), {}]]        # minimal CONDITIONING
target_latent = {"samples": torch.zeros(1, 24, T_LAT, LAT_H, LAT_W)}

ok_pos, report = node.add(POS, target_latent,
                          {"samples": torch.zeros(1, 24, VT, LAT_H, LAT_W)},
                          token_idx=K, noise_aug=0.999)
check("the happy path sets the keyframe and the noise aug",
      ok_pos[0][1]["minimax_keyframes"][0]["resolved_frame_index"]
      == motion.guide_frame_index(K)
      and ok_pos[0][1]["minimax_visual_cond_noise_aug"] == 0.999
      and POS[0][1] == {},
      "resolved_frame_index %d for token_idx %d, aug %.3f, input conditioning "
      "untouched" % (ok_pos[0][1]["minimax_keyframes"][0]["resolved_frame_index"],
                     K, ok_pos[0][1]["minimax_visual_cond_noise_aug"]))


def expect(name, fn, want, exc=ValueError):
    try:
        fn()
        check(name, False, "no exception")
    except exc as e:
        check(name, want in str(e), str(e).split("\n")[0][:120])


expect("mismatched (h, w) raises",
       lambda: node.add(POS, target_latent,
                        {"samples": torch.zeros(1, 24, T_LAT, LAT_H + 2, LAT_W)}),
       "must equal the target's")
expect("token_idx overflow raises",
       lambda: node.add(POS, target_latent,
                        {"samples": torch.zeros(1, 24, T_LAT, LAT_H, LAT_W)},
                        token_idx=1),
       "overruns the target's")
expect("batched guide raises",
       lambda: node.add(POS, target_latent,
                        {"samples": torch.zeros(2, 24, T_LAT, LAT_H, LAT_W)}),
       "batch must be 1")

# an anchor that is NOT a token boundary (core's image AddGuide can make one):
# fine on the stock clock, a raise under a rewritten one
odd = dict(BASE, keyframes=[kf(VT, 3)])          # pixel frame 3 is mid-token
reset_state()
lay_odd = mm.PackedLayout(**odd)
raw_odd = stock_layout(**odd)
check("off-boundary anchor is left alone under the stock clock",
      bool(torch.equal(lay_odd.position_ids, raw_odd.position_ids)),
      "core's own grid is the right answer there; %d rows torch.equal"
      % lay_odd.position_ids.shape[0])
motion._TRUE_CLOCK["spans"] = SPANS
try:
    mm.PackedLayout(**odd)
    check("off-boundary anchor RAISES under True Clock", False, "no exception")
except RuntimeError as e:
    check("off-boundary anchor RAISES under True Clock",
          "cannot be mapped" in str(e) and "H3 True Clock" in str(e),
          str(e).split("\n")[0][:150])
reset_state()


# ---- 6) text and audio rows -------------------------------------------------

print("6) text rows and target audio rows: bit-identical with and without a guide")

plain = mm.PackedLayout(**BASE)
guided = mm.PackedLayout(**full)


def seg(layout, kind):
    return [(a, b) for a, b, k in layout.segments if k == kind][-1]


a0, a1 = seg(plain, "audio")
b0, b1 = seg(guided, "audio")
check("text rows identical",
      bool(torch.equal(plain.position_ids[:TEXT_LEN], guided.position_ids[:TEXT_LEN])),
      "%d rows torch.equal" % TEXT_LEN)
check("target audio rows identical (different row offsets, same coordinates)",
      (a1 - a0) == (b1 - b0)
      and bool(torch.equal(plain.position_ids[a0:a1], guided.position_ids[b0:b1])),
      "plain rows %d..%d vs guided rows %d..%d, %d rows torch.equal"
      % (a0, a1, b0, b1, a1 - a0))
c0, c1 = seg(plain, "video")
d0, d1 = seg(guided, "video")
check("target video rows identical too",
      bool(torch.equal(plain.position_ids[c0:c1], guided.position_ids[d0:d1])),
      "plain rows %d..%d vs guided rows %d..%d, %d rows torch.equal"
      % (c0, c1, d0, d1, c1 - c0))
check("the guide is the only added segment",
      [k for _, _, k in guided.segments] == ["text", "cond", "audio", "video"]
      and guided.seq_len - plain.seq_len == T_LAT * FRAME_ROWS,
      "segments %r, seq_len %d -> %d (+%d)"
      % ([k for _, _, k in guided.segments], plain.seq_len, guided.seq_len,
         guided.seq_len - plain.seq_len))
reset_state()


# ---- 7) D6: the token-row cost of the minted graphs ------------------------

print("7) D6 cost: sequence length of ctrl vs full guide vs span-only guide")

# p4demo_t2c_c_ctrl_v001: 1152x640, the windowed insert 17 -> 27 tokens
G_TEXT = 213          # the trainer's prompt length; text is the only free term
G_H, G_W = 640 // 16, 1152 // 16
G_ROWS = (G_H // 2) * (G_W // 2)
CTRL_HOLDS = json.loads(
    '{"holds": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, '
    '2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, '
    '2, 2, 2, 2, 2, 1, 1, 1, 1, 1], "world_len": 56}')["holds"]
_h, dilated, t_base, t_dil, plan = motion.temporal_insert_map(CTRL_HOLDS)
inserted = [n for n, (_t, _lo, _hi, _w, exact) in enumerate(plan) if exact < 0]
lo = max(0, min(inserted) - 1)
hi = min(t_dil - 1, max(inserted) + 1)
span_vt = hi - lo + 1
from comfy_extras.nodes_minimax_h3 import temporal_shape
_len, t_lat_g, audio_t_g = temporal_shape(dilated)
assert t_lat_g == t_dil, (t_lat_g, t_dil)

ctrl = mm.PackedLayout(G_TEXT, t_dil, G_H, G_W, audio_t_g)
guide_full = mm.PackedLayout(G_TEXT, t_dil, G_H, G_W, audio_t_g,
                             keyframes=[{"resolved_frame_index": 0,
                                         "latent": torch.zeros(1, 24, t_dil, G_H, G_W)}])
guide_span_l = mm.PackedLayout(
    G_TEXT, t_dil, G_H, G_W, audio_t_g,
    keyframes=[{"resolved_frame_index": motion.guide_frame_index(lo),
                "latent": torch.zeros(1, 24, span_vt, G_H, G_W)}])
print("    window: %d world frames -> %d dilated frames, %d -> %d tokens; "
      "inserted tokens %s" % (len(CTRL_HOLDS), dilated, t_base, t_dil,
                              motion._index_runs(inserted)))
print("    span-only guide covers tokens %d..%d (%d of %d) = inserted +1 each side"
      % (lo, hi, span_vt, t_dil))
for name, lay in (("ctrl / noiseinit (no guide)", ctrl),
                  ("guide_base (full guide)", guide_full),
                  ("span-only guide", guide_span_l)):
    print("    %-28s seq_len %6d   video rows %5d   guide rows %5d   %.3fx ctrl"
          % (name, lay.seq_len, t_dil * G_ROWS,
             lay.seq_len - ctrl.seq_len, lay.seq_len / ctrl.seq_len))
check("full guide adds exactly one target video's worth of rows",
      guide_full.seq_len - ctrl.seq_len == t_dil * G_ROWS,
      "+%d rows = %d tokens x %d rows/frame (text %d, audio %d rows)"
      % (guide_full.seq_len - ctrl.seq_len, t_dil, G_ROWS, G_TEXT, audio_t_g * 2))
check("span-only guide costs its span and nothing else",
      guide_span_l.seq_len - ctrl.seq_len == span_vt * G_ROWS,
      "+%d rows (%.3fx ctrl) vs the full guide's +%d (%.3fx)"
      % (guide_span_l.seq_len - ctrl.seq_len, guide_span_l.seq_len / ctrl.seq_len,
         guide_full.seq_len - ctrl.seq_len, guide_full.seq_len / ctrl.seq_len))
reset_state()

print()
if FAILS:
    print("FAILED: " + ", ".join(FAILS))
    sys.exit(1)
print("all latent-guide checks passed")
