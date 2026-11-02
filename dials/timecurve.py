"""Dial strength over clip time inside one generation (route 1 of docs/TIME_AND_AUDIO.md), MiniMax H3 only.

For the first k sampling steps a time-curve row runs the model twice on the same latent, without and with its dial,
and blends the two predictions per latent frame: v = v0 + M(t) * (v_dial - v0), M_video on the video latent frames and
M_audio on the audio latent frames ("follow": the same curve; "protect": 0). From step k on the row is off. H3 samples
batch size 1 only, so the branches are two calls; a curve that is 0 everywhere costs nothing, 1 everywhere one call.

H3's clock (comfy.ldm.minimax.model): video latent frame i covers FRAME_PER_TOKEN[i % 5] pixel frames at 24 fps
(1, 4, 4, 4, 4: 17 frames per 5 latent frames, 17k + 5 in all), audio latent frame j starts at j / 40 s; RoPE puts
pixel frame f and audio frame j on one axis at 5/3 f and j. A video latent frame's M is the curve's mean over its pixel
frames, an audio frame's M the curve at its start.

Curves: keyframes [[t, m], ...] in seconds or normalized clip time (0 = first frame, 1 = clip end) with linear or step
interpolation, or a feature of the rack's curve_audio (the music given to H3 as reference audio), shaped as
M = offset + gain * f with f = the feature scaled to 0..1 over the track, thresholded, attack/release smoothed and
optionally inverted.

De-rope (two passes): with Time Smear's hold_map_used on the rack, a sampler whose clip has the stretched length evaluates
the curves in real clip time. Stretched pixel frame s shows real frame r(s) (the held copies of a frame all show it) and
takes the curve at r(s) / 24 s; audio is stretched continuously by Audio Smear, so an audio frame takes the curve at its
start mapped piecewise linearly through the holds. A clip with the real length samples as without a hold map.
"""
import json
import math

import numpy as np
import torch

from comfy.ldm.minimax.model import FRAME_PER_TOKEN
from comfy.patcher_extension import WrappersMP
from comfy_extras.nodes_minimax_h3 import AUDIO_LATENT_FPS, FPS

from . import blocks, core, envelopes

WRAPPER_KEY = "mai_dial_timecurve"
FEATURES = ("rms", "onset", "low", "mid", "high")
FEATURE_RATE = 100  # analysis frames per second
BANDS = {"low": (0., 250.), "mid": (250., 4000.), "high": (4000., math.inf)}
SHAPING = {"gain": 1., "offset": 0., "threshold": 0., "attack": .01, "release": .15, "invert": False}


def check_spec(spec):
    """-> the row's time spec with defaults filled in."""
    kind = spec.get("type")
    out = {"type": kind, "steps": int(spec.get("steps", 2)), "audio": spec.get("audio", "follow")}
    if out["steps"] < 1:
        raise ValueError("time curve steps must be at least 1")
    if out["audio"] not in ("follow", "protect"):
        raise ValueError("time curve audio must be 'follow' or 'protect'")
    if kind == "keys":
        points = [(float(t), float(m)) for t, m in spec["points"]]
        if not points or any(not math.isfinite(t) or not math.isfinite(m) for t, m in points) or any(
                a[0] >= b[0] for a, b in zip(points, points[1:])):
            raise ValueError("time curve keys need finite [time, value] points with strictly increasing times")
        out.update(points=points, unit=spec.get("unit", "normalized"), interp=spec.get("interp", "linear"))
        if out["unit"] not in ("seconds", "normalized") or out["interp"] not in ("linear", "step"):
            raise ValueError("time curve keys: unit is 'seconds' or 'normalized', interp 'linear' or 'step'")
    elif kind == "audio":
        out["feature"] = spec.get("feature", "onset")
        if out["feature"] not in FEATURES:
            raise ValueError(f"time curve feature must be one of {', '.join(FEATURES)}")
        for key, default in SHAPING.items():
            out[key] = type(default)(spec.get(key, default))
        if not 0 <= out["threshold"] < 1 or out["attack"] < 0 or out["release"] < 0:
            raise ValueError("time curve shaping: threshold in [0, 1), attack and release >= 0 seconds")
    else:
        raise ValueError(f"unknown time curve type {kind!r}; choose keys or audio")
    return out


def audio_features(audio):
    """AUDIO -> {feature: [0..1] per analysis frame at FEATURE_RATE}, from the first clip mixed to mono."""
    wave = audio["waveform"][0].float().mean(0)
    sr = audio["sample_rate"]
    hop = round(sr / FEATURE_RATE)
    n_fft = 1 << max(8, int(math.log2(sr * .04)))  # 20-40 ms window
    mag = torch.stft(wave, n_fft, hop, window=torch.hann_window(n_fft), center=True, return_complex=True).abs()
    power = mag.square()
    freqs = torch.fft.rfftfreq(n_fft, 1 / sr)
    logmag = torch.log1p(mag)
    out = {"rms": power.mean(0).sqrt(), "onset": torch.nn.functional.pad((logmag[:, 1:] - logmag[:, :-1]).clamp_min(0).sum(0), (1, 0))}
    for name, (lo, hi) in BANDS.items():
        out[name] = power[(freqs >= lo) & (freqs < hi)].sum(0).sqrt()
    return {k: (v / v.max().clamp_min(1e-12)).numpy().astype(np.float64) for k, v in out.items()}


def shape(values, spec, rate=FEATURE_RATE):
    """Feature (0..1) -> M per analysis frame: threshold, attack/release follower, invert, then offset + gain * f."""
    x = np.clip((values - spec["threshold"]) / (1 - spec["threshold"]), 0, None)
    coef = [1 - math.exp(-1 / (s * rate)) if s > 0 else 1. for s in (spec["attack"], spec["release"])]
    y, level = np.empty_like(x), x[0]
    for i, v in enumerate(x):
        level += coef[0 if v > level else 1] * (v - level)
        y[i] = level
    if spec["invert"]:
        y = 1 - y
    return spec["offset"] + spec["gain"] * y


def curve_fn(spec, duration, features=None):
    """-> f(seconds array) giving M."""
    if spec["type"] == "audio":
        values = shape(features[spec["feature"]], spec)
        times = np.arange(len(values)) / FEATURE_RATE
        return lambda t: np.interp(t, times, values)
    scale = duration if spec["unit"] == "normalized" else 1.
    times = np.array([t * scale for t, _ in spec["points"]])
    values = np.array([m for _, m in spec["points"]])
    if spec["interp"] == "step":
        return lambda t: values[np.clip(np.searchsorted(times, t, side="right") - 1, 0, None)]
    return lambda t: np.interp(t, times, values)


def clip_clock(latent_t, audio_t):
    """-> (pixel-frame index ranges per video latent frame, audio frame start times, clip seconds)."""
    starts = np.cumsum([0] + [FRAME_PER_TOKEN[i % 5] for i in range(latent_t)])
    return [range(starts[i], starts[i + 1]) for i in range(latent_t)], np.arange(audio_t) / AUDIO_LATENT_FPS, starts[-1] / FPS


def frame_weights(spec, latent_t, audio_t, features=None, holds=None):
    """-> (M per video latent frame, M per audio latent frame), lists of floats; holds: the stretched clip's hold map."""
    frames, audio_times, duration = clip_clock(latent_t, audio_t)
    if holds is not None:
        real = np.repeat(np.arange(len(holds)), holds)
        frames = [real[r.start:r.stop] for r in frames]
        audio_times = np.interp(audio_times, np.cumsum([0] + holds) / FPS, np.arange(len(holds) + 1) / FPS)
        duration = len(holds) / FPS
    f = curve_fn(spec, duration, features)
    video = [float(np.mean(f(np.array(r) / FPS))) for r in frames]
    audio = [0.] * audio_t if spec["audio"] == "protect" else [float(v) for v in f(audio_times)]
    return video, audio


class TimeCurveForward:
    """Diffusion-model wrapper, compiled once per sampler call. groups: [(label, shift, spec, video M, audio M)]."""

    def __init__(self, groups, sigmas, clock=""):
        self.clock = clock
        self.sigmas = sigmas.tolist()
        n = len(self.sigmas) - 1
        self.groups = []
        for label, shift, spec, video, audio in groups:  # tensors on the sampling device once, not copied per call
            weights = (torch.tensor(video, device=sigmas.device).reshape(1, 1, -1, 1, 1), torch.tensor(audio, device=sigmas.device).reshape(1, 1, 1, -1))
            values = video + audio
            self.groups.append({"label": label, "shift": shift.to(sigmas.device), "steps": min(spec["steps"], n), "until": self.sigmas[min(spec["steps"], n)],
                                "weights": weights, "zero": not any(values), "one": all(v == 1 for v in values), "video": video, "audio": audio})

    def report(self):
        lines = [f"time curves over {self.clock}; sigmas " + ", ".join(f"{s:.6g}" for s in self.sigmas[:-1])]
        for g in self.groups:
            lines.append(f"{g['label']}: two-branch blend on steps 0-{g['steps'] - 1}, off after; "
                         f"video M per latent frame: {blocks.runs([round(v, 2) for v in g['video']])}")
            lines.append(f"  audio M per audio frame: {blocks.runs([round(v, 2) for v in g['audio']])}")
        return "\n".join(lines)

    def __call__(self, executor, x, timestep, context, transformer_options, **kwargs):
        current = float(transformer_options["sigmas"].flatten()[0])
        live = [g for g in self.groups if current > g["until"] and not g["zero"]]
        if not live:
            return executor(x, timestep, context, transformer_options, **kwargs)
        refined = executor.class_obj.preprocess_text_embeds(context)  # no-op when extra_conds already refined it

        def dialled(g):
            return executor(x, timestep, refined + g["shift"].to(device=refined.device, dtype=refined.dtype), transformer_options, **kwargs)
        if len(live) == 1 and live[0]["one"]:
            return dialled(live[0])
        base = executor(x, timestep, context, transformer_options, **kwargs)
        if len(live) == 1:  # lerp returns either branch exactly where M is 0 or 1
            return [torch.lerp(b, d, w.to(b)) for b, d, w in zip(base, dialled(live[0]), live[0]["weights"])]
        out = list(base)
        for g in live:
            out = [o + w.to(b) * (d - b) for o, b, d, w in zip(out, base, dialled(g), g["weights"])]
        return out


class TimeCurveSampler(envelopes.EnvelopeSampler):
    """Sampler wrapper; rows [(label, dial, strength, spec)] with the same spec share one dialled branch (shifts summed in
    float64). The clip's latent shapes come from the model being sampled."""
    key = WRAPPER_KEY

    def __init__(self, rows, features, holds=None, node_id=None, report=""):
        super().__init__(rows, node_id, report)
        self.features = features
        self.holds = holds

    def compile(self, sigmas, model):
        latent_shapes = model.inner_model.latent_shapes
        latent_t, audio_t = latent_shapes[0][2], latent_shapes[1][-1]
        frames = clip_clock(latent_t, 0)[0][-1].stop
        holds, clock = self.holds, ""
        if holds is not None and frames == len(holds):
            holds, clock = None, f", real time ({frames} frames, the hold map's real length)"
        elif holds is not None:
            if frames != sum(holds):
                raise ValueError(f"the rack's hold map covers {len(holds)} real and {sum(holds)} stretched frames, but this sampler's "
                                 f"clip has {frames}: wire hold_map_used from the H3 Time Smear that made this clip")
            clock = f", curves in real time through the hold map ({len(holds)} real frames stretched to {frames})"
        groups = {}
        for label, dial, strength, spec in self.rows:
            groups.setdefault(repr(spec), (spec, []))[1].append((label, dial, strength))
        compiled = []
        for spec, rows in groups.values():
            shift = core.rack_post_shift(rows)["vec"] if len(rows) > 1 else rows[0][1]["vec"] * rows[0][2]
            compiled.append((" + ".join(label for label, _, _ in rows), shift, spec, *frame_weights(spec, latent_t, audio_t, self.features, holds)))
        return TimeCurveForward(compiled, sigmas, f"a {frames / FPS:.3f} s clip ({latent_t} video, {audio_t} audio latent frames){clock}")


def read_holds(hold_map):
    return [int(h) for h in json.loads(hold_map)["holds"]] if hold_map else None


def attach_holds(model, hold_map):
    """De-rope stage 2 on the model a rack made for stage 1: its time curves follow real clip time through the hold map.
    Returns the model unchanged when it has no time-curve rows."""
    samplers = model.get_wrappers(WrappersMP.SAMPLER_SAMPLE, WRAPPER_KEY)
    if not samplers:
        return model
    m = model.clone()
    m.remove_wrappers_with_key(WrappersMP.SAMPLER_SAMPLE, WRAPPER_KEY)
    for s in samplers:
        m.add_wrapper_with_key(WrappersMP.SAMPLER_SAMPLE, WRAPPER_KEY, TimeCurveSampler(s.rows, s.features, read_holds(hold_map), s.node_id, s.base_report))
    return m


def apply_rack(model, rows, specs, curve_audio=None, hold_map=None, node_id=None, report=""):
    """rows [(label, dial, strength)] with their time specs, on a clone; hold_map: H3 Time Smear's hold_map_used JSON.
    Returns (report lines, UI data for the curves)."""
    if core.text_path(model).family != "MiniMax H3":
        raise ValueError("time curves support MiniMax H3 only (they blend video and audio latent frames); remove the row's time curve")
    specs = [check_spec(s) for s in specs]
    for (label, dial, _), spec in zip(rows, specs):
        if dial["mode"] != "post":
            raise ValueError(f"{label}: time curves support post-refiner dials only; pre-refiner rows cannot vary over time")
    features = None
    if any(s["type"] == "audio" for s in specs):
        if curve_audio is None:
            raise ValueError("an audio-driven time curve needs the music: connect it to the rack's curve_audio input")
        features = audio_features(curve_audio)
    model.add_wrapper_with_key(WrappersMP.SAMPLER_SAMPLE, WRAPPER_KEY,
                               TimeCurveSampler([(*row, spec) for row, spec in zip(rows, specs)], features, read_holds(hold_map), node_id, report))
    text = "\n".join(f"  {label}: {spec['type']} curve, first {spec['steps']} steps, audio {spec['audio']}" for (label, *_), spec in zip(rows, specs))
    ui = {}
    if curve_audio is not None:
        wave = curve_audio["waveform"][0].float().mean(0)
        bins = wave[:len(wave) // 600 * 600].reshape(600, -1).abs().amax(1) if len(wave) >= 600 else wave.abs()
        ui = {"seconds": len(wave) / curve_audio["sample_rate"], "peaks": [round(float(v), 3) for v in bins / bins.max().clamp_min(1e-12)],
              "rate": FEATURE_RATE, "features": {k: [round(float(v), 3) for v in a] for k, a in (features or audio_features(curve_audio)).items()}}
    return "time curves (two-branch blend; sampled M appears when sampling starts):\n" + text, ui
