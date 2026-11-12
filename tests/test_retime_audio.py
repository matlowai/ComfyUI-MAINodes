#!/usr/bin/env python3
"""Unit test for H3 Retime Audio, the dilated-clock soundtrack composer.

  python tests/test_retime_audio.py
      Synthetic, no GPU, no models (torchaudio needed for stretched mode).

What it checks:

  1. LENGTH: every mode lands on the same dilated length, the sum of the
     run targets, so the bed always matches the kept dilated video.
  2. RATE-1 SPANS carry the baseline verbatim (mid-span, away from the
     5 ms crossfades) in varispeed and generated modes.
  3. VARISPEED drops pitch by the hold factor: a 1 kHz tone in a x4 span
     comes back with its dominant frequency near 250 Hz.
  4. STRETCHED keeps pitch: the same tone stays near 1 kHz.
  5. GENERATED fills held spans from the pass-2 track at the mapped
     dilated offsets and keeps the baseline elsewhere.
  6. TRANSIENT ANCHORING: a click inside a held span lands unstretched at
     its exactly-mapped dilated position, at full amplitude, in both
     stretched and varispeed beds; a click in a rate-1 span is left to
     the verbatim baseline (no double-hit).
  7. CONTRACT: generated mode without a generated track raises; an empty
     hold map raises.

Exit code 0 = pass.
"""
import json
import math
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from motion import H3RetimeAudio  # noqa: E402

SR, FPS = 32000, 24
FAIL = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        FAIL.append(msg)


def audio(x):
    return {"waveform": x.float()[None, None, :], "sample_rate": SR}


def dominant_hz(x):
    spec = torch.fft.rfft(x * torch.hann_window(x.shape[0])).abs()
    return torch.argmax(spec).item() * SR / x.shape[0]


# 90 world frames, one x4 burst on frames 34..50 (token-aligned)
HOLDS = [1] * 34 + [4] * 17 + [1] * 39
MAP = json.dumps({"holds": HOLDS, "world_len": 90})
SPF = SR / FPS
N_WORLD = int(90 / FPS * SR)

t = torch.arange(N_WORLD) / SR
TONE = 0.4 * torch.sin(2 * math.pi * 1000 * t)

node = H3RetimeAudio()
geo = node._geometry(HOLDS, SR, FPS)
N_DIL = sum(g[5] for g in geo)
burst = next(g for g in geo if g[0] > 1)          # (h, count, s0, s1, t0, tgt)

outs = {}
for mode in ("stretched", "varispeed", "generated"):
    gen = audio(0.4 * torch.sin(2 * math.pi * 3000 * torch.arange(N_DIL) / SR))
    out, report = node.retime(audio(TONE.clone()), MAP, FPS, mode, False,
                              generated=gen)
    outs[mode] = out["waveform"][0, 0]
    check(out["waveform"].shape[-1] == N_DIL, f"{mode}: dilated length {N_DIL}")
    check(mode in report, f"{mode}: report names the mode")

# 2. rate-1 spans verbatim (probe the middle of the leading span)
probe = slice(int(10 * SPF), int(20 * SPF))
for mode in ("varispeed", "generated"):
    check(torch.equal(outs[mode][probe], TONE[probe]),
          f"{mode}: rate-1 span is the baseline verbatim")

# 3 + 4. pitch inside the held span
h, _, s0, s1, t0, tgt = burst
mid = slice(t0 + tgt // 4, t0 + 3 * tgt // 4)
f_vari = dominant_hz(outs["varispeed"][mid])
f_stretch = dominant_hz(outs["stretched"][mid])
check(abs(f_vari - 250) < 25, f"varispeed: 1 kHz -> {f_vari:.0f} Hz (~250)")
check(abs(f_stretch - 1000) < 50, f"stretched: 1 kHz stays {f_stretch:.0f} Hz")

# 5. generated fills the held span with the pass-2 track
f_gen = dominant_hz(outs["generated"][mid])
check(abs(f_gen - 3000) < 50, f"generated: held span is pass 2 ({f_gen:.0f} Hz)")

# 6. transient anchoring
CLICK_HELD = int(40 * SPF)                        # world frame 40, inside x4
CLICK_REST = int(10 * SPF)                        # world frame 10, rate 1
clicky = TONE.clone() * 0.05
clicky[CLICK_HELD:CLICK_HELD + 32] = 1.0
clicky[CLICK_REST:CLICK_REST + 32] = 1.0
expected = t0 + (CLICK_HELD - s0) * h
for mode in ("stretched", "varispeed"):
    out, report = node.retime(audio(clicky.clone()), MAP, FPS, mode, True)
    y = out["waveform"][0, 0]
    win = y[expected - 400:expected + 800].abs()
    peak_at = expected - 400 + torch.argmax(win).item()
    check(win.max() > 0.95,
          f"{mode}+anchor: click lands at full amplitude ({win.max():.2f})")
    check(abs(peak_at - expected) < int(0.005 * SR),
          f"{mode}+anchor: click within 5 ms of its mapped position")
    check("re-anchored" in report and "0 transient" not in report,
          f"{mode}+anchor: report counts the anchor")
    rest_peak = y[CLICK_REST - 100:CLICK_REST + 300].abs().max()
    check(rest_peak > 0.95, f"{mode}+anchor: rate-1 click stays verbatim")

# 7. contract errors
for bad_call, msg in (
        (lambda: node.retime(audio(TONE), MAP, FPS, "generated", False),
         "generated mode without a track raises"),
        (lambda: node.retime(audio(TONE), "", FPS, "stretched", False),
         "empty hold map raises")):
    try:
        bad_call()
        check(False, msg)
    except AssertionError:
        check(True, msg)

if FAIL:
    print(f"\n{len(FAIL)} FAILED")
    sys.exit(1)
print("\nall retime-audio tests passed")
