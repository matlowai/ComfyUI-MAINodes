"""Sample-time envelopes for post-refiner dials.

H3 refines the prompt once per sampling, so its envelopes shift the cached context at each diffusion-model call. Families
that refine the prompt inside every call (MOSS-Image, Krea 2) get the shift at the post module instead: an apply-model
wrapper sets it for the duration of the call and the rack's ScheduledShift adds it to the post module's output.

Progress runs from 0 to 1 over the steps of each sampler call: with two sampler stages (split sigmas, or a second
pass at denoise < 1) an envelope is applied to each stage on its own.
"""
import bisect
import contextvars
import math

from comfy.patcher_extension import (WrappersMP, add_wrapper_with_key, copy_nested_dicts)

from . import core


WRAPPER_KEY = "mai_dial_envelopes"
SHIFT = contextvars.ContextVar("mai_dial_shift", default=None)  # set only while one apply-model call runs
SHAPES = {
    "constant": [(0., 1.), (1., 1.)],
    "early": [(0., 1.), (.5, 0.), (1., 0.)],
    "late": [(0., 0.), (.5, 0.), (1., 1.)],
    "bell": [(0., 0.), (.5, 1.), (1., 0.)],
}


def envelope_points(spec):
    if spec is None:
        spec = "constant"
    if isinstance(spec, str):
        spec = {"type": spec}
    kind = spec["type"]
    if kind in SHAPES:
        return SHAPES[kind]
    if kind != "manual":
        raise ValueError(f"unknown dial envelope {kind!r}; choose constant, early, late, bell or manual")
    points = [(float(p), float(v)) for p, v in spec["points"]]
    if (len(points) < 2 or any(not math.isfinite(p) or not math.isfinite(v) or not 0 <= p <= 1 for p, v in points)
            or any(a[0] >= b[0] for a, b in zip(points, points[1:]))):
        raise ValueError("manual envelope needs at least two finite [progress, gain] points, strictly increasing in [0, 1]")
    return points


def interpolate(points, x):
    i = bisect.bisect_right([p for p, _ in points], x)
    if i == 0:
        return points[0][1]
    if i == len(points):
        return points[-1][1]
    a, b = points[i - 1], points[i]
    if a[1] == b[1]:
        return a[1]
    return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])


class EnvelopeForward:
    """Compiled once per sampler invocation; no call counter or mutable model/global state."""

    def __init__(self, rows, sigmas):
        self.sigmas = sigmas.detach().double().cpu().tolist()
        if len(self.sigmas) < 2 or any(not math.isfinite(s) for s in self.sigmas) or any(
                a <= b for a, b in zip(self.sigmas, self.sigmas[1:])):
            raise ValueError("dial envelopes need a finite, strictly decreasing sampler sigma schedule")
        n = len(self.sigmas) - 1
        self.progress = [i / max(n - 1, 1) for i in range(n)]
        self.rows = [(label, dial, [strength * interpolate(points, p) for p in self.progress])
                     for label, dial, strength, points in rows]

    def report(self):
        text = "envelope sigmas (terminal omitted): " + ", ".join(f"{s:.6g}" for s in self.sigmas[:-1])
        for label, _, values in self.rows:
            text += f"\n{label} sampled strengths: " + ", ".join(f"{v:+.6g}" for v in values)
        return text

    def strengths(self, transformer_options):
        """Each row's strength at this model call's sigma."""
        sigma = transformer_options.get("sigmas")
        if sigma is None:
            raise ValueError("dial envelope: diffusion-model call has no sampler sigma")
        current = float(sigma.flatten()[0])
        if not math.isfinite(current) or not bool((sigma == current).all()):
            raise ValueError("dial envelopes need one finite shared sigma per model call")
        return [interpolate(list(zip([-s for s in self.sigmas[:-1]], values)), -current) for _, _, values in self.rows]

    def shifts(self, transformer_options):
        return [dial["vec"] * strength for (_, dial, _), strength in zip(self.rows, self.strengths(transformer_options)) if strength != 0]

    def __call__(self, executor, x, timestep, context, transformer_options, **kwargs):
        shifts = self.shifts(transformer_options)
        context = executor.class_obj.preprocess_text_embeds(context)  # no-op when extra_conds already refined it
        for shift in shifts:
            context = context + shift.to(device=context.device, dtype=context.dtype)
        return executor(x, timestep, context, transformer_options, **kwargs)


class EnvelopeShift(EnvelopeForward):
    """Apply-model wrapper for families whose post module runs inside every call; adds to the shift of outer racks."""

    def __call__(self, executor, x, t, c_concat=None, c_crossattn=None, control=None, transformer_options={}, **kwargs):
        total = SHIFT.get()
        for shift in self.shifts(transformer_options):
            total = shift if total is None else total + shift
        token = SHIFT.set(total)
        try:
            return executor(x, t, c_concat, c_crossattn, control, transformer_options, **kwargs)
        finally:
            SHIFT.reset(token)


class ScheduledShift(core.PostShift):
    """PostShift adding the envelope shift of the running apply-model call (none outside sampling)."""

    def __init__(self, post):
        super().__init__(post, None)

    def add(self, module, args, out):
        shift = SHIFT.get()
        return out if shift is None else out + shift.to(device=out.device, dtype=out.dtype)

    def to(self, device_or_dtype):
        return self


class EnvelopeSampler:
    def __init__(self, rows, node_id=None, report="", cached=True):
        self.rows = rows
        self.node_id = node_id
        self.base_report = report
        self.cached = cached

    def compile(self, sigmas):
        return (EnvelopeForward if self.cached else EnvelopeShift)(self.rows, sigmas)

    def __call__(self, executor, model, sigmas, extra_args, *args, **kwargs):
        compiled = self.compile(sigmas)
        extra_args = extra_args.copy()
        extra_args["model_options"] = copy_nested_dicts(extra_args["model_options"])
        options = extra_args["model_options"].setdefault("transformer_options", {})
        add_wrapper_with_key(WrappersMP.DIFFUSION_MODEL if self.cached else WrappersMP.APPLY_MODEL, WRAPPER_KEY, compiled, options)
        if self.node_id is not None:
            from server import PromptServer  # only inside a running ComfyUI; keeps the module importable in tests
            PromptServer.instance.send_sync("mai-dial-envelope", {"node": self.node_id, "text": self.base_report + "\n" + compiled.report()},
                                            PromptServer.instance.client_id)
        return executor(model, sigmas, extra_args, *args, **kwargs)


def apply_rack(model, rows, specs, node_id=None, report=""):
    path = core.text_path(model)
    outer = bool(model.get_wrappers(WrappersMP.SAMPLER_SAMPLE, WRAPPER_KEY))
    scheduled = any(s is not None for s in specs) or outer
    post = []
    for (label, dial, strength), spec in zip(rows, specs):
        if spec is not None and (dial["mode"] != "post" or dial["target"] != path.post):
            raise ValueError(f"step envelopes support post-refiner {path.post} dials only; pre-refiner rows cannot be scheduled")
        if scheduled and dial["mode"] == "post":
            post.append((label, dial, strength, envelope_points(spec)))
        else:
            core.apply_dial(model, dial, strength)
    if post:
        if not path.cached and not outer:  # one ScheduledShift adds the shift every envelope rack adds to
            model.add_wrapper_with_key(WrappersMP.DIFFUSION_MODEL, core.POST_KEY, ScheduledShift(path.post))
        model.add_wrapper_with_key(WrappersMP.SAMPLER_SAMPLE, WRAPPER_KEY, EnvelopeSampler(post, node_id, report, path.cached))
    return bool(post)
