#!/usr/bin/env python3
"""Unit test for H3 Mid Insert's `init_mode: duplicate`, the no-op remesh.

  python tests/test_midinsert_duplicate.py
      Synthetic, no GPU, no models. comfy.nested_tensor is stubbed.

duplicate makes every inserted token-time a VERBATIM copy of the nearer
bracketing base token, state and noise realisation both, so the dilated grid
carries more tokens and not one new value. That is the "stupid remesh": the
control that separates a token-count effect from a content effect.

What it checks:

  1. EVERY inserted token equals the base token it copies, maxabs 0.0, and
     the copy source is the nearer bracket (w >= 0.5 -> hi, else lo).
  2. NO NEW CONTENT: every dilated token-time in the output is bit-equal to
     some base token, i.e. the output's distinct-value set is a subset of
     the input's. Checked on the packet's own map (hold 2 on world 34..84).
  3. noise_topup IS IGNORED in duplicate mode: topup 0.0 and 1.0 give
     bit-identical output, and both equal the parent copy.
  4. THE DEFAULT IS UNCHANGED: no init_mode argument gives exactly the same
     tensor as init_mode="lerp", which is what every earlier arm rendered.
  5. Audio still passes through by reference and the report names the mode.

Exit code 0 = pass.
"""
import importlib.util
import os
import sys
import types

import torch

HERE = os.path.dirname(os.path.abspath(__file__))

if "comfy.nested_tensor" not in sys.modules:
    class _StubNested:
        def __init__(self, tensors):
            self.tensors = list(tensors)
            self.is_nested = True

        def unbind(self):
            return self.tensors

    _pkg = sys.modules.setdefault("comfy", types.ModuleType("comfy"))
    _mod = types.ModuleType("comfy.nested_tensor")
    _mod.NestedTensor = _StubNested
    _pkg.nested_tensor = _mod
    sys.modules["comfy.nested_tensor"] = _mod

spec = importlib.util.spec_from_file_location(
    "mainodes_motion", os.path.join(os.path.dirname(HERE), "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)

FAILS = []

# the density_noop packet's span: local x2 inside a 1x clip, world 34..84
HOLDS = [1] * 34 + [2] * 51 + [1] * 39
MAP = '{"holds": %s, "world_len": 124}' % HOLDS
C, T, H, W = 24, 37, 6, 10


def check(name, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + name + ("  " + detail if detail else ""))
    if not ok:
        FAILS.append(name)


def latent(seed=11):
    g = torch.Generator().manual_seed(seed)
    return {"samples": torch.randn(1, C, T, H, W, generator=g)}


def main():
    mid = motion.H3MidInsert()
    base = latent()["samples"]

    holds, dilated, t_base, t_dil, plan = motion.temporal_insert_map(HOLDS)
    expect = {}
    for n, (_t, lo, hi, w, exact) in enumerate(plan):
        expect[n] = exact if exact >= 0 else (hi if w >= 0.5 else lo)

    out, used, rep = mid.insert(samples=latent(), hold_map=MAP,
                                noise_topup=0.0, seed=1,
                                init_mode="duplicate")
    v = out["samples"]
    check("shape: 37 -> %d tokens" % t_dil,
          tuple(v.shape) == (1, C, t_dil, H, W), str(tuple(v.shape)))

    worst, bad = 0.0, []
    for n, src in expect.items():
        d = float((v[:, :, n] - base[:, :, src]).abs().max())
        worst = max(worst, d)
        if d != 0.0:
            bad.append(n)
    check("1. every dilated token is a verbatim copy of its nearer bracket "
          "(maxabs 0)", worst == 0.0, "maxabs %r, bad %s" % (worst, bad[:8]))

    # 2. no new content: every output token matches SOME base token exactly
    hits = []
    for n in range(t_dil):
        m = [j for j in range(T)
             if float((v[:, :, n] - base[:, :, j]).abs().max()) == 0.0]
        hits.append(bool(m))
    check("2. no new content: all %d dilated tokens are bit-equal to some "
          "base token" % t_dil, all(hits),
          "misses %s" % [n for n, h in enumerate(hits) if not h][:8])

    # 3. noise_topup is ignored
    out1, _u, _r = mid.insert(samples=latent(), hold_map=MAP,
                              noise_topup=1.0, seed=1, init_mode="duplicate")
    d = float((out1["samples"] - v).abs().max())
    check("3. noise_topup 1.0 == 0.0 in duplicate mode", d == 0.0,
          "maxabs %r" % d)

    # 4. the default path is untouched
    a, _u, _r = mid.insert(samples=latent(), hold_map=MAP, noise_topup=0.0,
                           seed=1)
    b, _u, _r = mid.insert(samples=latent(), hold_map=MAP, noise_topup=0.0,
                           seed=1, init_mode="lerp")
    d = float((a["samples"] - b["samples"]).abs().max())
    check("4. default == explicit lerp (earlier arms unchanged)", d == 0.0,
          "maxabs %r" % d)
    d = float((a["samples"] - v).abs().max())
    check("4b. lerp and duplicate actually differ", d > 0.0, "maxabs %r" % d)

    # 5. audio + report
    aud = torch.randn(1, 8, 64)
    nested = motion.__dict__  # noqa: F841  (module already imported)
    import comfy.nested_tensor as nt
    lat = {"samples": nt.NestedTensor((latent()["samples"], aud))}
    o2, _u, rep2 = mid.insert(samples=lat, hold_map=MAP, noise_topup=0.0,
                              seed=1, init_mode="duplicate")
    check("5. audio passes through by reference",
          o2["samples"].unbind()[1] is aud)
    check("5b. report names the mode", "init_mode duplicate" in rep2)
    check("5c. lerp report says so", "init_mode lerp" in _r)
    print("\n--- duplicate report\n" + rep2)

    print()
    if FAILS:
        print("FAILED: %d check(s): %s" % (len(FAILS), ", ".join(FAILS)))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
