#!/usr/bin/env python3
"""Unit test for H3 DyRoPE's layer-wise / sigma-faded time geometry.

  python tests/test_dyrope.py
      CPU only, no GPU, no files. Needs comfy on sys.path (the real
      comfy.ldm.minimax.model is the reference the compact grid is checked
      against, and the real rope_freqs is what the wrapper chains onto).

  Six properties, one per section:
    1. COMPACT GRID: the node's rebuilt "stock" grid is exactly the core's
       _video_t_grid(n, origin) — DyRoPE must not invent its own idea of
       the geometry the model was trained on,
    2. PHYSICAL SPANS: holds all-1 makes physical == compact (True Clock's
       own identity property, re-asserted here because DyRoPE's whole
       premise is that the two lists differ),
    3. BLOCK MAP: physical_blocks 0..24 patches exactly {0..24} and nothing
       else; compact_blocks patches the same set with the inverse meaning,
    4. FADE WEIGHTS: 1.0 at sigma_max, 0.0 at fade_end, 0.5 at the midpoint,
       clamped outside,
    5. ROPE WRAPPER: on a hand-built position_ids (text + audio + video rows)
       the video segment is identified correctly, the alternate t column is
       the compact grid, and every non-video row is bit-identical,
    6. IDENTITY ARMS: physical_all never requests the alternate table and
       registers no block patches; compact_all leaves _TRUE_CLOCK disarmed
       for the whole wrapped sample call.

Exit code 0 = pass.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "mainodes_motion", os.path.join(os.path.dirname(HERE), "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)

import torch
import comfy.ldm.minimax.model as mm

R = motion.ROPE_UNITS_PER_FRAME
FAILS = []

# captured BEFORE anything in this file arms the node: section 3 installs the
# rope_freqs chain as a side effect of wrap(), so "stock" has to be taken now
STOCK_ROPE_FREQS = mm.MiniMaxH3Model.rope_freqs
assert not getattr(STOCK_ROPE_FREQS, "_h3_dyrope", False)


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


# ---- stubs -----------------------------------------------------------------

class FakeBlock:
    pass


class FakeDiffusionModel:
    def __init__(self, n=50):
        self.blocks = [FakeBlock() for _ in range(n)]


class FakeInner:
    """Innermost model object; model.model.diffusion_model is what the node reads."""
    def __init__(self, n=50):
        self.diffusion_model = FakeDiffusionModel(n)


class FakePatcher:
    """Minimum of ModelPatcher the node touches: clone + the two registrars."""
    def __init__(self, n=50):
        self.model = FakeInner(n)
        self.replaces = {}
        self.wrappers = {}
        self.model_options = {"transformer_options": {}}
        self.object_patches = {}
        self.clones = 0

    def clone(self):
        c = FakePatcher.__new__(FakePatcher)
        c.model = self.model
        c.replaces = dict(self.replaces)
        c.wrappers = {k: dict(v) for k, v in self.wrappers.items()}
        c.model_options = self.model_options
        c.object_patches = dict(self.object_patches)
        c.clones = self.clones + 1
        return c

    def set_model_patch_replace(self, patch, name, block_name, number, transformer_index=None):
        self.replaces[(name, block_name, number)] = patch

    def add_wrapper(self, wrapper_type, wrapper):
        self.wrappers.setdefault(wrapper_type, {}).setdefault(None, []).append(wrapper)


class StubSampler:
    """Inner SAMPLER; records the module state visible DURING sample()."""
    def __init__(self):
        self.seen = None

    def max_denoise(self, model_wrap, sigmas):
        return False

    def sample(self, *args, **kwargs):
        self.seen = {"clock": motion._TRUE_CLOCK["spans"],
                     "active": motion._DYROPE["active"],
                     "mode": motion._DYROPE["mode"],
                     "sigma_max": motion._DYROPE["sigma_max"]}
        return "SAMPLED"


class StubRope(torch.nn.Module):
    """Just enough of MiniMaxH3Model for the real rope_freqs to run."""
    def __init__(self, length=16):
        super().__init__()
        self.rope = torch.nn.Module()
        self.rope.register_buffer("inv_freq", torch.linspace(1.0, 0.01, length))


HOLDS = [4 if 132 <= f <= 150 else 1 for f in range(243)]   # the pier cell's map
HOLD_MAP = json.dumps({"holds": HOLDS})


# ---- 1) compact grid rebuild ----------------------------------------------

print("1) compact grid rebuild == comfy.ldm.minimax.model._video_t_grid(n, origin)")
for n, origin in [(5, 0.0), (61, 123.0), (243, 7.5), (1, 0.0), (17, 512.0)]:
    mine = motion.dyrope_grid(motion.dyrope_stock_spans(n), origin)
    core = mm._video_t_grid(n, origin).tolist()
    worst = max(abs(a - b) for a, b in zip(mine, core)) if n else 0.0
    check("n=%d origin=%s" % (n, origin),
          len(mine) == len(core) and worst == 0.0,
          "len %d/%d worst abs diff %.3e (first %.6f last %.6f)"
          % (len(mine), len(core), worst, mine[0], mine[-1]))

# and the spans themselves against the core helper
for n in (5, 61, 243):
    check("stock spans n=%d" % n,
          motion.dyrope_stock_spans(n) == mm._video_t_spans(n),
          "sum %.6f == %.6f" % (sum(motion.dyrope_stock_spans(n)), sum(mm._video_t_spans(n))))


# ---- 2) physical spans, holds all-1 ---------------------------------------

print("2) true_clock_spans(all-1) == compact spans")
# LEGAL lengths only (17k+5): at an illegal length _snap_holds pads the clip,
# and pad frames are copies of the last world frame that cost no world time, so
# physical is legitimately SHORTER than compact even with holds all 1.
for length in (39, 73, 141, 243):
    phys = motion.true_clock_spans([1] * length)
    comp = motion.dyrope_stock_spans(len(phys))
    worst = max(abs(a - b) for a, b in zip(phys, comp))
    check("holds=[1]*%d" % length,
          len(phys) == len(comp) and worst < 1e-12,
          "%d tokens, worst abs diff %.3e, sums %.6f / %.6f"
          % (len(phys), worst, sum(phys), sum(comp)))

phys = motion.true_clock_spans(HOLDS)
comp = motion.dyrope_stock_spans(len(phys))
check("pier map (holds 4 on 132-150) really differs",
      phys != comp and sum(phys) < sum(comp),
      "%d tokens, physical sum %.6f (= 243 x 5/3 = %.6f), compact sum %.6f"
      % (len(phys), sum(phys), 243 * R, sum(comp)))


# ---- 3) block map ----------------------------------------------------------

print("3) block map: which blocks get a double_block replacement")


def wrap_once(mode, lo=0, hi=24, fade_end=0.5, model=None, sampler=None):
    reset_state()
    m = model or FakePatcher(50)
    s = sampler or StubSampler()
    out = motion.H3DyRoPE().wrap(m, s, HOLD_MAP, mode, lo, hi, fade_end)
    return m, s, out


for mode, lo, hi in [("physical_blocks", 0, 24), ("compact_blocks", 0, 24),
                     ("physical_blocks", 25, 49), ("physical_blocks", 40, 49)]:
    _, _, (out_model, _, report) = wrap_once(mode, lo, hi)
    keys = sorted(k[2] for k in out_model.replaces)
    want = list(range(lo, hi + 1))
    unpatched = sorted(set(range(50)) - set(keys))
    check("%s %d..%d" % (mode, lo, hi),
          keys == want and all(k[:2] == ("dit", "double_block") for k in out_model.replaces),
          "patched %d block(s) %d..%d, unpatched %d (%d..%d)"
          % (len(keys), keys[0], keys[-1], len(unpatched),
             unpatched[0], unpatched[-1]))

_, _, (out_model, _, _) = wrap_once("physical_all")
check("physical_all registers nothing", out_model.replaces == {} and out_model.clones == 0,
      "replaces=%r clones=%d (same object returned)" % (out_model.replaces, out_model.clones))
_, _, (out_model, _, _) = wrap_once("compact_all")
check("compact_all registers nothing", out_model.replaces == {} and out_model.clones == 0,
      "replaces=%r clones=%d" % (out_model.replaces, out_model.clones))
_, _, (out_model, _, _) = wrap_once("fade_physical_to_compact")
n_w = sum(len(v) for d in out_model.wrappers.values() for v in d.values())
check("fade registers no block patch, one diffusion_model wrapper",
      out_model.replaces == {} and n_w == 1,
      "replaces=%r wrappers=%r" % (out_model.replaces, list(out_model.wrappers)))


# ---- 4) fade weights -------------------------------------------------------

print("4) fade weight: 1.0 at sigma_max, 0.0 at fade_end, 0.5 at the midpoint")
S_MAX, F_END = 1.0, 0.5
cases = [(1.0, 1.0), (0.5, 0.0), (0.75, 0.5), (2.0, 1.0), (0.0, 0.0), (0.625, 0.25)]
for sigma, want in cases:
    got = motion.dyrope_fade_weight(sigma, S_MAX, F_END)
    check("sigma=%.3f" % sigma, abs(got - want) < 1e-12,
          "w=%.6f (want %.6f)" % (got, want))
check("degenerate sigma_max == fade_end",
      motion.dyrope_fade_weight(0.4, 0.5, 0.5) == 0.0
      and motion.dyrope_fade_weight(0.6, 0.5, 0.5) == 1.0,
      "below -> %.1f, above -> %.1f" % (motion.dyrope_fade_weight(0.4, 0.5, 0.5),
                                        motion.dyrope_fade_weight(0.6, 0.5, 0.5)))


# ---- 5) rope wrapper on a hand-built position_ids --------------------------

print("5) rope_freqs wrapper: video-row detection, alternate t column, other rows untouched")

TEXT_ROWS, AUDIO_T, ROWS_PER_FRAME = 11, 7, 6
spans_phys = motion.true_clock_spans(HOLDS)
T_LAT = len(spans_phys)
spans_comp = motion.dyrope_stock_spans(T_LAT)
ORIGIN = float(TEXT_ROWS)

pos = torch.zeros(TEXT_ROWS + AUDIO_T * 2 + T_LAT * ROWS_PER_FRAME, 3, dtype=torch.float64)
pos[:TEXT_ROWS, 0] = torch.arange(TEXT_ROWS, dtype=torch.float64)
a0 = TEXT_ROWS
pos[a0:a0 + AUDIO_T * 2, 0] = (ORIGIN + torch.arange(AUDIO_T, dtype=torch.float64)).repeat(2)
pos[a0:a0 + AUDIO_T, 2] = -1.5
pos[a0 + AUDIO_T:a0 + AUDIO_T * 2, 2] = 1.5
v0 = a0 + AUDIO_T * 2
g_phys = motion.dyrope_grid(spans_phys, ORIGIN)
pos[v0:, 0] = torch.tensor(g_phys, dtype=torch.float64).repeat_interleave(ROWS_PER_FRAME)
pos[v0:, 1] = torch.arange(T_LAT * ROWS_PER_FRAME, dtype=torch.float64) % 3.0 - 1.0
pos[v0:, 2] = torch.arange(T_LAT * ROWS_PER_FRAME, dtype=torch.float64) % 2.0 - 0.5

start, rpf = motion.dyrope_video_rows(pos, T_LAT)
check("video rows located", (start, rpf) == (v0, ROWS_PER_FRAME),
      "start=%d rows_per_frame=%d (want %d/%d), seq_len=%d"
      % (start, rpf, v0, ROWS_PER_FRAME, pos.shape[0]))

alt = motion.dyrope_retimed_position_ids(pos, start, rpf, motion.dyrope_grid(spans_comp, ORIGIN))
g_comp = motion.dyrope_grid(spans_comp, ORIGIN)
got = alt[start::rpf, 0].tolist()
check("alternate t column == compact grid",
      max(abs(a - b) for a, b in zip(got, g_comp)) < 1e-12,
      "first %.6f/%.6f last %.6f/%.6f" % (got[0], g_comp[0], got[-1], g_comp[-1]))
check("non-video rows bit-identical",
      bool(torch.equal(alt[:start], pos[:start])),
      "%d rows (text %d + audio %d) compared with torch.equal" % (start, TEXT_ROWS, AUDIO_T * 2))
check("video h/w columns bit-identical",
      bool(torch.equal(alt[start:, 1:], pos[start:, 1:])),
      "%d video rows, columns 1:3" % (pos.shape[0] - start))
check("alternate t column is per-frame constant",
      bool(torch.equal(alt[start:, 0].view(T_LAT, rpf),
                       alt[start::rpf, 0][:, None].expand(T_LAT, rpf))),
      "%d tokens x %d rows" % (T_LAT, rpf))

# now the installed wrapper, end to end
stub = StubRope()
stock_fn = STOCK_ROPE_FREQS                       # unpatched core method
stock_angles = stock_fn(stub, pos, torch.device("cpu"))
motion._install_dyrope_rope_patch()
plain = mm.MiniMaxH3Model.rope_freqs              # our chained version
check("wrapper installed once (idempotent)",
      plain is not stock_fn and getattr(plain, "_h3_dyrope", False)
      and (motion._install_dyrope_rope_patch() or mm.MiniMaxH3Model.rope_freqs is plain),
      "rope_freqs marked _h3_dyrope, second install is a no-op")
reset_state()
un_armed = plain(stub, pos, torch.device("cpu"))
check("disarmed wrapper is a bit-identical pass-through",
      bool(torch.equal(un_armed, stock_angles)),
      "shape %s, torch.equal vs the unpatched core method" % (tuple(un_armed.shape),))

motion._DYROPE.update({"active": True, "mode": "physical_blocks", "n_tokens": T_LAT,
                       "spans_phys": spans_phys, "spans_comp": spans_comp})
default = plain(stub, pos, torch.device("cpu"))
altang = motion._DYROPE["alt_angles"]
check("physical_blocks: default table is COMPACT, alternate is PHYSICAL",
      altang is not None and torch.equal(altang, un_armed) and not torch.equal(default, un_armed),
      "alt == the physical angles: %s; default differs: %s; shapes %s"
      % (torch.equal(altang, un_armed), not torch.equal(default, un_armed),
         tuple(default.shape)))

motion._DYROPE.update({"mode": "compact_blocks", "alt_angles": None})
default_c = plain(stub, pos, torch.device("cpu"))
check("compact_blocks: default table is PHYSICAL, alternate is COMPACT",
      torch.equal(default_c, un_armed) and torch.equal(motion._DYROPE["alt_angles"], default),
      "default == physical angles: %s; alt == the compact angles: %s"
      % (torch.equal(default_c, un_armed), torch.equal(motion._DYROPE["alt_angles"], default)))

motion._DYROPE.update({"mode": "fade_physical_to_compact", "alt_angles": None,
                       "sigma_max": 1.0, "fade_end": 0.5, "sigma": 1.0})
f_hi = plain(stub, pos, torch.device("cpu"))
motion._DYROPE["sigma"] = 0.5
motion._DYROPE["alt_angles"] = None
f_lo = plain(stub, pos, torch.device("cpu"))
check("fade at sigma_max == physical, at fade_end == compact, no alternate",
      torch.equal(f_hi, un_armed) and torch.equal(f_lo, default)
      and motion._DYROPE["alt_angles"] is None,
      "w(1.0)=%.3f w(0.5)=%.3f" % (motion.dyrope_fade_weight(1.0, 1.0, 0.5),
                                   motion.dyrope_fade_weight(0.5, 1.0, 0.5)))

motion._DYROPE["sigma"] = 0.75
motion._DYROPE["alt_angles"] = None
plain(stub, pos, torch.device("cpu"))
mid = [0.5 * a + 0.5 * b for a, b in zip(spans_phys, spans_comp)]
check("fade midpoint interpolates SPANS (monotone grid)",
      abs(motion._DYROPE["last_weight"] - 0.5) < 1e-12
      and all(s > 0 for s in mid)
      and all(b > a for a, b in zip(motion.dyrope_grid(mid), motion.dyrope_grid(mid)[1:])),
      "w=%.3f, %d mixed spans all positive, grid strictly increasing"
      % (motion._DYROPE["last_weight"], len(mid)))

# the mis-rotation guard
bad = pos.clone()
bad[v0 + 3 * rpf, 0] += 0.25
motion._DYROPE.update({"mode": "physical_blocks", "alt_angles": None, "sigma": None})
try:
    plain(stub, bad, torch.device("cpu"))
    check("mis-rotation guard raises", False, "no exception")
except RuntimeError as e:
    check("mis-rotation guard raises", "do not carry the armed t-grid" in str(e),
          str(e).split("\n")[0][:110])
reset_state()


# ---- 6) identity arms ------------------------------------------------------

print("6) identity arms: physical_all == True Clock, compact_all == no node")

m, s, (out_model, wrapped, report) = wrap_once("physical_all")
check("physical_all arms the True Clock spans at node time",
      motion._TRUE_CLOCK["spans"] == motion.true_clock_spans(HOLDS)
      and motion._DYROPE["active"] is False,
      "spans len %d, _DYROPE active=%s" % (len(motion._TRUE_CLOCK["spans"]),
                                           motion._DYROPE["active"]))
sig = torch.linspace(0.7, 0.0, 7)
res = wrapped.sample(object(), sig)
check("physical_all: True Clock armed during sample, no alternate requested",
      res == "SAMPLED" and s.seen["clock"] == motion.true_clock_spans(HOLDS)
      and s.seen["active"] is False and motion._DYROPE["alt_requested"] == 0,
      "seen clock len=%d active=%s alt_requested=%d"
      % (len(s.seen["clock"]), s.seen["active"], motion._DYROPE["alt_requested"]))
check("physical_all: disarmed after sample",
      motion._TRUE_CLOCK["spans"] is None and motion._DYROPE["active"] is False,
      "_TRUE_CLOCK[spans]=%r _DYROPE[active]=%r"
      % (motion._TRUE_CLOCK["spans"], motion._DYROPE["active"]))

m, s, (out_model, wrapped, report) = wrap_once("compact_all")
check("compact_all leaves True Clock disarmed at node time",
      motion._TRUE_CLOCK["spans"] is None and motion._DYROPE["active"] is False,
      "_TRUE_CLOCK[spans]=%r" % (motion._TRUE_CLOCK["spans"],))
wrapped.sample(object(), sig)
check("compact_all: _TRUE_CLOCK[spans] is None DURING the sample call",
      s.seen["clock"] is None and s.seen["active"] is False
      and motion._DYROPE["alt_requested"] == 0,
      "seen clock=%r active=%r alt_requested=%d"
      % (s.seen["clock"], s.seen["active"], motion._DYROPE["alt_requested"]))

m, s, (out_model, wrapped, report) = wrap_once("fade_compact_to_physical")
wrapped.sample(object(), sig)
check("fade: sigma_max read off the schedule's first sigma",
      abs(s.seen["sigma_max"] - float(sig[0])) < 1e-9 and s.seen["active"] is True,
      "sigma_max=%.6f (sigmas[0]=%.6f) active=%s"
      % (s.seen["sigma_max"], float(sig[0]), s.seen["active"]))
reset_state()

print("7) report string")
_, _, (_, _, report) = wrap_once("physical_blocks", 0, 24)
print("    " + report.replace("\n", "\n    "))
check("report names mode, tokens, both sums and the block split",
      "physical_blocks" in report and "tokens=%d" % len(spans_phys) in report
      and "blocks 0-24 -> physical" in report and "%.6f" % (243 * R) in report,
      "%d chars" % len(report))
reset_state()

print()
if FAILS:
    print("FAILED: " + ", ".join(FAILS))
    sys.exit(1)
print("all dyrope checks passed")
