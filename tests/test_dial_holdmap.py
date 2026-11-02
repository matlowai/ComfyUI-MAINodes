"""CPU checks for the rack's hold_map input (dials/timecurve.py): time curves in real clip time through H3 Time Smear's map.

  1. the mapping, by hand: a 22-frame real clip (7 latent frames) whose frames 5-9 are held 4x and last frame 3x is a
     39-frame stretched clip (12 latent frames); stretched pixel frames show real frames 0-4, 5 5 5 5 ... 9 9 9 9, 10-20,
     21 21 21, and a step at real frame 9 lands in stretched latent frames 6 (one of four) and 7 on; held copies of one
     real frame get that frame's curve value; audio frames map piecewise linearly (stretched 0.875 s = real 0.375 s);
  2. stage detection: a sampler whose clip has the real length is bit-identical to no hold map, the stretched length
     blends with the mapped weights, any other length fails with a clear error;
  3. no hold map, an empty string and an all-1 map are bit-identical to today's rack;
  4. old workflows: hold_map is the last input, optional and a socket, so saved widget values keep their slots.
"""
import json
import logging

import torch

from test_dial_rack import H, comfy, dial, nodes
from test_dial_timecurve import Fake, Guider, PIKA, fails, keys, same, sample, timecurve
from comfy.patcher_extension import WrappersMP

HOLDS = [1] * 5 + [4] * 5 + [1] * 11 + [3]
REAL, STRETCHED = [(1, 4, 7, 2, 2), (1, 3, 2, 37)], [(1, 4, 12, 2, 2), (1, 3, 2, 65)]  # 22 and 39 pixel frames
STEP = keys([[0, 0], [9 / 24, 1]], unit="seconds", interp="step", steps=3)


def rack(base, rows, ins, hold_map=None):
    return nodes.DialRack.execute(model=base, rack=json.dumps(rows), dials=ins, hold_map=hold_map).result[0]


def check_mapping():
    spec = timecurve.check_spec(STEP)
    video, audio = timecurve.frame_weights(spec, 12, 65, holds=HOLDS)
    assert video == [0] * 6 + [.25] + [1] * 5, video  # latent 6 = stretched 18-21 = real 8 8 8 9
    assert audio == [0.] * 35 + [1.] * 30, audio  # real frame 9 starts at stretched frame 21 = 0.875 s = audio frame 35
    stretched, _ = timecurve.frame_weights(spec, 12, 65)
    assert stretched != video  # without the map the step lands at stretched 0.375 s, inside the held span

    ramp = timecurve.check_spec(keys([[0, 0], [1, 1]]))
    video, audio = timecurve.frame_weights(ramp, 12, 65, holds=HOLDS)
    want = [0, 2.5, 5, 6, 7, 8, 8.25, 9.25, 12.5, 16.5, 19, (20 + 21 * 3) / 4]  # latent frames 2-4: four copies of real 5, 6, 7
    assert all(abs(v - w / 22) < 1e-12 for v, w in zip(video, want)), video
    assert abs(audio[35] - 9 / 22) < 1e-12 and abs(audio[10] - 5.25 / 22) < 1e-12  # 0.25 s = stretched frame 6: a quarter into frame 5
    assert abs(audio[64] - 21.8 / 22) < 1e-12  # 1.6 s = stretched frame 38.4, inside the last frame's three copies


def check_sampler(dtype):
    torch.manual_seed(5)
    base = comfy.model_patcher.ModelPatcher(Fake(dtype), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    text = torch.randn(1, 5, H + 3).to(dtype)
    ins = {"dial_0": dial("post", 21, "night")}
    rows = [{"input": "dial_0", "strength": 1.5, "time": STEP}]
    const = [{"input": "dial_0", "strength": 1.5}]
    held = json.dumps({"holds": HOLDS, "world_len": 22})
    for shapes in (REAL, STRETCHED):
        latents = [torch.randn(shapes[0]).to(dtype), torch.randn(shapes[1]).to(dtype)]
        today, calls = sample(rack(base, rows, ins), text, latents, shapes=shapes)
        for hold_map in ("", json.dumps({"holds": [1] * (22 if shapes is REAL else 39)})):
            out, _ = sample(rack(base, rows, ins, hold_map), text, latents, shapes=shapes)
            for got, want in zip(out, today):
                same(got, want)
        mapped, mapped_calls = sample(rack(base, rows, ins, held), text, latents, shapes=shapes)
        assert mapped_calls == calls == 9
        if shapes is REAL:
            for got, want in zip(mapped, today):
                same(got, want)
            continue
        plain, _ = sample(base, text, latents, shapes=shapes)
        dialled, _ = sample(rack(base, const, ins), text, latents, shapes=shapes)
        for got, want in zip(sample(rack(base, const, ins, held), text, latents, shapes=shapes)[0], dialled):
            same(got, want)  # rows without a time curve ignore the map
        for i in range(3):
            (v, a), (pv, pa), (dv, da) = mapped[i], plain[i], dialled[i]
            assert torch.equal(v[:, :, :6], pv[:, :, :6]) and torch.equal(v[:, :, 7:], dv[:, :, 7:])
            assert torch.equal(v[:, :, 6], torch.lerp(pv[:, :, 6], dv[:, :, 6], torch.tensor(.25, dtype=dtype)))
            assert torch.equal(a[..., :35], pa[..., :35]) and torch.equal(a[..., 35:], da[..., 35:])
        assert not torch.equal(mapped[0][0], today[0][0])
        for got, want in zip(mapped[3:], plain[3:]):
            same(got, want)

    m = rack(base, rows, ins, held)
    wrapper = m.get_wrappers(WrappersMP.SAMPLER_SAMPLE, timecurve.WRAPPER_KEY)[0]
    assert "22 real frames stretched to 39" in wrapper.compile(PIKA, Guider(STRETCHED)).report()
    assert "real time (22 frames" in wrapper.compile(PIKA, Guider(REAL)).report()
    fails(lambda: wrapper.compile(PIKA, Guider([(1, 4, 17, 2, 2), (1, 3, 2, 92)])), "hold_map_used from the H3 Time Smear")


def check_schema():
    inputs = nodes.DialRack.GET_SCHEMA().inputs
    assert [i.id for i in inputs] == ["model", "rack", "dials", "curve_audio", "hold_map"]
    assert inputs[-1].optional and inputs[-1].force_input and inputs[-1].get_io_type() == "STRING"  # Time Smear's socket


def main():
    check_mapping()
    for dtype in (torch.float32, torch.bfloat16):
        check_sampler(dtype)
    check_schema()
    print("dial hold map: real <-> stretched mapping, held copies, audio warp, stage detection, identity and schema passed")


if __name__ == "__main__":
    logging.disable(logging.INFO)
    main()
