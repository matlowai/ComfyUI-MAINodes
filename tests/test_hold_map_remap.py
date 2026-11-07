#!/usr/bin/env python3
"""Unit test for H3 Hold Map Remap, the scale / floor / ceiling dials on
an oracle-format hold map.

  python tests/test_hold_map_remap.py
      Synthetic, no GPU, no models.

What it checks:

  1. IDENTITY at the defaults: an oracle-shaped (token-aligned, ramped)
     map passes through bit-identical, including its segments string.
  2. SCALE acts above rest: hold' = 1 + (hold-1)*scale, so unheld frames
     far from a burst stay unheld, the peak lands where the formula says,
     and re-ramping widens shoulders only around the (now taller) burst.
  3. FLOOR is everywhere: floor 2 leaves no frame at rest, and the
     report says the whole clip is dilated.
  4. CEILING clamps after scaling and the result still satisfies the C1
     constraint (|d(t) - d(t+1)| <= 1 on the token grid).
  5. SCALE 0 flattens the map to rest entirely.
  6. DETERMINISM and idempotence: same dials in, same map out, twice;
     the defaults are a fixed point of the node's own output.
  7. CONTRACT errors: an empty map and a world_len mismatch both raise
     with a message, not silently pass through.

Exit code 0 = pass.
"""
import importlib.util
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

spec = importlib.util.spec_from_file_location(
    "mainodes_motion", os.path.join(HERE, "..", "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)


def mint(frame_holds, length, ramp=True, bridge=8):
    holds, segs, _ = motion._compile_hold_map(
        np.asarray(frame_holds, int), length, ramp, bridge)
    return json.dumps({"holds": holds, "world_len": length}), holds, segs


def remap(hold_map, **kw):
    args = dict(scale=1.0, floor=1, ceiling=8, fps=24, ramp=True, bridge=0)
    args.update(kw)
    return motion.H3HoldMapRemap().remap(hold_map, **args)


def holds_of(out_map):
    return json.loads(out_map)["holds"]


LENGTH = 90                                    # a legal 17k+5 length
BURST = [1] * LENGTH
for f in range(34, 51):
    BURST[f] = 4                               # one token-aligned burst
MAP, HOLDS0, SEGS0 = mint(BURST, LENGTH)


def test_identity():
    out_map, segs, report = remap(MAP)
    assert holds_of(out_map) == HOLDS0, "defaults must be a passthrough"
    assert segs == SEGS0, "segments must survive the passthrough"
    assert json.loads(out_map)["world_len"] == LENGTH


def test_scale_above_rest():
    out_map, _, _ = remap(MAP, scale=1.5)
    holds = holds_of(out_map)
    peak0 = max(HOLDS0)
    assert max(holds) == 1 + int((peak0 - 1) * 1.5 + 0.5)
    assert holds[0] == 1 and holds[-1] == 1, \
        "frames far from the burst stay at rest"
    # ramping may lift the shoulder next to the taller burst, never the
    # far field: everything outside burst +- (new peak) tokens is rest
    grown = max(holds) * 5                     # generous frame margin
    for f in range(LENGTH):
        if f < 34 - grown or f > 50 + grown:
            assert holds[f] == 1, f"far field grew at frame {f}"


def test_floor_everywhere():
    out_map, _, report = remap(MAP, floor=2)
    holds = holds_of(out_map)
    assert min(holds) == 2, "floor is the minimum everywhere"
    assert max(holds) == max(HOLDS0), "floor alone must not move the peak"
    assert "whole clip" in report


def test_ceiling_and_c1():
    out_map, _, _ = remap(MAP, scale=3.0, ceiling=5)
    holds = holds_of(out_map)
    assert max(holds) == 5, "ceiling clamps the scaled peak"
    tok = [holds[motion._frame_token(f, (LENGTH - 5) // 17 * 5 + 2)]
           for f in range(LENGTH)]
    diffs = [abs(a - b) for a, b in zip(tok[:-1], tok[1:])]
    assert max(diffs) <= 1, "C1 constraint must survive the clamp"


def test_scale_zero_flattens():
    out_map, segs, _ = remap(MAP, scale=0.0)
    assert holds_of(out_map) == [1] * LENGTH
    assert segs == ""


def test_idempotent():
    once, _, _ = remap(MAP, scale=2.0, floor=1, ceiling=6)
    twice, _, _ = remap(MAP, scale=2.0, floor=1, ceiling=6)
    assert once == twice, "same dials, same map"
    again, _, _ = remap(once)
    assert holds_of(again) == holds_of(once), \
        "the node's own output is a fixed point of the defaults"


def test_contract_errors():
    try:
        remap("")
        raise SystemExit("empty map must raise")
    except AssertionError:
        pass
    bad = json.dumps({"holds": [1, 1, 1], "world_len": 5})
    try:
        remap(bad)
        raise SystemExit("world_len mismatch must raise")
    except AssertionError:
        pass


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok {name}")
    print("all hold-map-remap tests passed")
