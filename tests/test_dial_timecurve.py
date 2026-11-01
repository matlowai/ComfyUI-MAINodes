"""CPU checks for time-curve rows (dials/timecurve.py) through a real ModelPatcher, WrapperExecutor and H3's forward.

  1. an all-zero curve is bit-identical to no dial and never runs the dialled branch;
  2. a curve of 1 on every step equals today's constant hook row bit for bit (one call per step); with k = 2 the first
     two steps equal the constant row and the rest equal no dial;
  3. a step curve blends per latent frame: frames at 0 / 1 are exactly the plain / dialled prediction; audio follows
     the curve or, with protect, stays exactly the plain prediction;
  4. rows with one spec share a branch (float64 sum), different specs blend independently;
  5. the H3 clock: latent frames <-> pixel frames <-> seconds, audio frames at 40 Hz;
  6. audio features and shaping on synthetic signals; validation errors; the curve_audio input is last and optional.
"""
import importlib
import json
import logging
import math

import torch

from test_dial_rack import H, comfy, dial, nodes, rack
from test_dial_envelopes import Fake as EnvelopeFake
from comfy.patcher_extension import WrappersMP, WrapperExecutor

timecurve = importlib.import_module("mai_dials.timecurve")
PIKA = torch.tensor([1., .972973, .923077, .8, .571429, .333333, 0.])
SHAPES = [(1, 4, 7, 2, 2), (1, 3, 2, 37)]  # 7 latent frames = 22 pixel frames; round(22 / 24 * 40) = 37 audio frames


class Fake(EnvelopeFake):
    def __init__(self, dtype):
        super().__init__(dtype)
        dm = self.diffusion_model
        dm.calls = 0
        dm._forward = lambda x, timestep, context, transformer_options, **kw: forward(dm, x, context)


def forward(dm, x, context):
    dm.calls += 1
    c = torch.tanh(dm.preprocess_text_embeds(context)).mean(1)[0]
    v, a = x
    ramp = torch.arange(1, v.shape[2] + 1, dtype=v.dtype).reshape(1, 1, -1, 1, 1)
    return [v * .9 + torch.tanh(c[:v.shape[1]].reshape(1, -1, 1, 1, 1) * ramp), a * .8 + torch.sin(3 * c[:a.shape[1]].reshape(1, -1, 1, 1))]


class Guider:
    def __init__(self, shapes):
        self.inner_model = type("BaseModel", (), {"latent_shapes": shapes})()


def sample(patcher, text, latents, sigmas=PIKA, shapes=SHAPES):
    """-> (per-step [video, audio] predictions, diffusion-model calls)."""
    patcher.patch_model()
    try:
        dm = patcher.model.diffusion_model
        context = dm.preprocess_text_embeds(text)  # what extra_conds hands the DiT
        dm.calls = 0

        def run(guider, schedule, extra_args):
            opts = extra_args["model_options"]["transformer_options"]
            return [[t.detach().clone() for t in dm(latents, torch.tensor([float(s) * 1000]), context, {**opts, "sigmas": torch.tensor([float(s)])})]
                    for s in schedule[:-1]]
        extra_args = {"model_options": {"transformer_options": {"wrappers": patcher.wrappers}}}
        out = WrapperExecutor.new_executor(run, patcher.get_all_wrappers(WrappersMP.SAMPLER_SAMPLE)).execute(Guider(shapes), sigmas, extra_args)
        return out, dm.calls
    finally:
        patcher.unpatch_model()


def same(a, b):
    assert all(torch.equal(x, y) for x, y in zip(a, b)), "predictions differ"


def fails(fn, text):
    try:
        fn()
    except ValueError as exc:
        assert text in str(exc), str(exc)
    else:
        raise AssertionError(f"expected error: {text}")


def keys(points, **kw):
    return {"type": "keys", "points": points, **kw}


def check_clock():
    frames, audio, seconds = timecurve.clip_clock(7, 37)
    assert [list(r) for r in frames] == [[0], [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17], [18, 19, 20, 21]]
    assert seconds == 22 / 24 and audio[1] == 1 / 40
    assert timecurve.clip_clock(42, 235)[2] == 141 / 24  # Pika's 141 frames
    half = timecurve.check_spec(keys([[0, 0], [.5, 1]], interp="step"))
    video, audio = timecurve.frame_weights(half, 7, 37)
    assert video == [0, 0, 0, .5, 1, 1, 1], video  # pixel frame 11 = 11/24 s opens the step, inside latent frame 3
    assert audio == [0.] * 19 + [1.] * 18, audio  # j / 40 >= 11 / 24 from j = 19
    seconds = timecurve.check_spec(keys([[0, 0], [.5, 1]], unit="seconds"))
    video, _ = timecurve.frame_weights(seconds, 7, 37)
    assert abs(video[1] - sum(f / 24 / .5 for f in range(1, 5)) / 4) < 1e-12 and video[-1] == 1
    _, audio = timecurve.frame_weights(dict(half, audio="protect"), 7, 37)
    assert audio == [0.] * 37


def check_audio():
    sr = 32000
    t = torch.arange(4 * sr) / sr
    wave = .05 * torch.where(t < 2, torch.sin(2 * math.pi * 100 * t), torch.sin(2 * math.pi * 6000 * t))
    clicks = [.5, 1.5, 2.5, 3.5]
    g = torch.Generator().manual_seed(0)
    for c in clicks:
        i = int(c * sr)
        wave[i:i + 160] += torch.randn(160, generator=g)
    f = timecurve.audio_features({"waveform": torch.stack([wave, wave])[None], "sample_rate": sr})
    assert set(f) == set(timecurve.FEATURES) and all(abs(v.max() - 1) < 1e-9 for v in f.values())
    onset = torch.tensor(f["onset"])
    peaks = sorted(torch.topk(onset, 4).indices.tolist())
    assert all(abs(p / 100 - c) <= .02 for p, c in zip(peaks, clicks)), peaks
    low, high = torch.tensor(f["low"]), torch.tensor(f["high"])
    assert low[20:180].median() > 10 * low[220:380].median() and high[220:380].median() > 10 * high[20:180].median()  # median: skip the clicks

    spec = timecurve.check_spec({"type": "audio", "feature": "rms", "attack": 0, "release": 0})
    x = torch.linspace(0, 1, 11, dtype=torch.float64).numpy()
    assert list(timecurve.shape(x, spec)) == list(x)
    assert all(abs(a - b) < 1e-12 for a, b in zip(timecurve.shape(x, dict(spec, threshold=.5)), [0] * 6 + [.2, .4, .6, .8, 1]))
    assert all(abs(a - b) < 1e-12 for a, b in zip(timecurve.shape(x, dict(spec, invert=True, gain=2, offset=-.5)), 2 * (1 - x) - .5))
    step = torch.tensor([0.] * 10 + [1.] * 40 + [0.] * 50).double().numpy()
    y = timecurve.shape(step, dict(spec, attack=.1, release=.2))
    assert abs(y[19] - (1 - math.exp(-1))) < 1e-9 and abs(y[69] - y[49] * math.exp(-1)) < 1e-9  # 10 frames = 0.1 s, 20 = 0.2 s
    video, audio = timecurve.frame_weights(timecurve.check_spec({"type": "audio", "feature": "onset"}), 7, 37, f)
    assert len(video) == 7 and len(audio) == 37 and max(video) <= 1


def check_blend(dtype):
    torch.manual_seed(11)
    base = comfy.model_patcher.ModelPatcher(Fake(dtype), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    text = torch.randn(1, 5, H + 3).to(dtype)
    latents = [torch.randn(SHAPES[0]).to(dtype), torch.randn(SHAPES[1]).to(dtype)]
    a, b = dial("post", 21, "night"), dial("post", 22, "motion")
    ins = {"dial_0": a, "dial_1": b, "dial_2": a}
    row = lambda i, s, **kw: {"input": f"dial_{i}", "strength": s, **kw}
    plain, calls = sample(base, text, latents)
    assert calls == 6
    constant, _ = sample(rack(base, [row(0, 1.5)], ins), text, latents)

    zero, calls = sample(rack(base, [row(0, 1.5, time=keys([[0, 0], [1, 0]], steps=6))], ins), text, latents)
    assert calls == 6, "an all-zero curve ran the dialled branch"
    for got, want in zip(zero, plain):
        same(got, want)
    ones, calls = sample(rack(base, [row(0, 1.5, time=keys([[0, 1]], steps=6))], ins), text, latents)
    assert calls == 6, "an all-one curve ran the plain branch"
    for got, want in zip(ones, constant):
        same(got, want)
    early, calls = sample(rack(base, [row(0, 1.5, time=keys([[0, 1]]))], ins), text, latents)
    assert calls == 6
    for i, got in enumerate(early):
        same(got, constant[i] if i < 2 else plain[i])
    assert not any(torch.equal(x, y) for x, y in zip(constant[0], plain[0]))

    half = keys([[0, 0], [.5, 1]], interp="step", steps=3)
    blended = {}
    for audio in ("follow", "protect"):
        steps, calls = sample(rack(base, [row(0, 1.5, time=dict(half, audio=audio))], ins), text, latents)
        assert calls == 9
        blended[audio] = steps
        for i, (v, au) in enumerate(steps):
            if i >= 3:
                same([v, au], plain[i])
                continue
            (pv, pa), (dv, da) = plain[i], constant[i]
            assert torch.equal(v[:, :, :3], pv[:, :, :3]) and torch.equal(v[:, :, 4:], dv[:, :, 4:])
            assert torch.equal(v[:, :, 3], torch.lerp(pv[:, :, 3], dv[:, :, 3], torch.tensor(.5, dtype=dtype)))
            if audio == "protect":
                assert torch.equal(au, pa)
            else:
                assert torch.equal(au[..., :19], pa[..., :19]) and torch.equal(au[..., 19:], da[..., 19:])

    # two rows with one spec share a branch whose shift is the rack's float64 sum; two specs blend independently
    shared, calls = sample(rack(base, [row(0, 1.5, time=half), row(1, -.7, time=half)], ins), text, latents)
    assert calls == 9
    both, _ = sample(rack(base, [row(0, 1.5), row(1, -.7)], ins), text, latents)
    assert torch.equal(shared[0][0][:, :, 4:], both[0][0][:, :, 4:])
    ramp = keys([[0, 1], [1, 0]], steps=1)
    two, calls = sample(rack(base, [row(0, 1.5, time=half), row(1, -.7, time=ramp)], ins), text, latents)
    assert calls == 6 + 2 * 1 + 2
    only_b, _ = sample(rack(base, [row(1, -.7)], ins), text, latents)
    wa, wb = (timecurve.frame_weights(timecurve.check_spec(s), 7, 37) for s in (half, ramp))
    for k, (p, da, db) in enumerate(zip(plain[0], constant[0], only_b[0])):
        w = [torch.tensor(x[k], dtype=dtype).reshape((1, 1, -1, 1, 1) if k == 0 else (1, 1, 1, -1)) for x in (wa, wb)]
        assert torch.allclose(two[0][k].float(), (p + w[0] * (da - p) + w[1] * (db - p)).float(), atol=1e-2 if dtype == torch.bfloat16 else 1e-6)
    same(two[1], blended["follow"][1])  # step 1: only the 3-step row is live

    # a time row on top of other rows: the plain branch keeps them, rows without a time curve are unchanged
    mixed, _ = sample(rack(base, [row(1, -.7), row(0, 1.5, time=keys([[0, 0]], steps=6))], ins), text, latents)
    for got, want in zip(mixed, only_b):
        same(got, want)
    assert rack(base, [row(0, 1.5, on=False, time=half)], ins) is base

    fails(lambda: rack(base, [{"input": "dial_0", "strength": 1, "time": {"type": "audio"}}], ins), "curve_audio")
    fails(lambda: rack(base, [row(0, 1, time=half), row(1, 1, hold=True)], ins), "hold rows and time curves")
    fails(lambda: rack(base, [row(0, 1, time=half, envelope="early")], ins), "step envelope")
    fails(lambda: rack(base, [row(0, 1, time=half, blocks=[1.] * 50)], ins), "block strengths")
    fails(lambda: rack(base, [row(0, 1, time={"type": "wave"})], ins), "unknown time curve type")
    fails(lambda: rack(base, [row(0, 1, time=keys([[0, 0], [0, 1]]))], ins), "strictly increasing")
    fails(lambda: rack(base, [row(0, 1, time=dict(half, audio="mute"))], ins), "follow")
    pre = dial("pre", 23, "pre")
    fails(lambda: rack(base, [row(0, 1, time=half)], {"dial_0": pre}), "post-refiner")


def check_ui():
    sr = 16000
    audio = {"waveform": torch.randn(1, 2, 3 * sr) * .1, "sample_rate": sr}
    base = comfy.model_patcher.ModelPatcher(Fake(torch.float32), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    out = nodes.DialRack.execute(model=base, rack=json.dumps([{"input": "dial_0", "strength": 1, "time": {"type": "audio", "feature": "rms"}}]),
                                 dials={"dial_0": dial("post", 1, "a")}, curve_audio=audio)
    data = out.ui["timecurve"][0]
    assert abs(data["seconds"] - 3) < 1e-9 and len(data["peaks"]) == 600 and max(data["peaks"]) == 1
    assert data["rate"] == 100 and len(data["features"]["onset"]) == 301
    assert "time curves" in out.ui["text"][0]
    presets = importlib.import_module("mai_dials.presets")
    spec = {"type": "audio", "feature": "low", "gain": 2, "audio": "protect"}
    assert presets.preset_rows([{"dial": "dials/x.safetensors", "strength": 1, "time": spec}])[0]["time"] == spec
    fails(lambda: presets.preset_rows([{"dial": "dials/x.safetensors", "strength": 1, "time": {"type": "keys"}}]), "invalid preset time curve")
    inputs = nodes.DialRack.GET_SCHEMA().inputs
    assert inputs[-2].id == "curve_audio" and inputs[-2].optional


def main():
    check_clock()
    check_audio()
    for dtype in (torch.float32, torch.bfloat16):
        check_blend(dtype)
    check_ui()
    print("dial time curves: zero/one identity, per-frame blend, audio follow/protect, groups, clock, features and validation passed")


if __name__ == "__main__":
    logging.disable(logging.INFO)
    main()
