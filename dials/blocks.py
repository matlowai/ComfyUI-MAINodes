"""Per-block strengths for post-refiner rack rows.

H3 packs the refined text into the same residual stream as video and audio, so a post-refiner dial can also enter
that stream later. A row's profile w[0..n-1] is how much of the dial (times the row strength) the text rows carry
into block i: before block i the rack adds (w_i - w_{i-1}) * strength * v to the text span, w_{-1} = 0, through
ModelPatcher ("double_block", i) patches. All ones is the plain hook (everything enters before block 0). A drop to
0 after block k subtracts the dial there, but blocks up to k have already read it.
"""
from comfy.patcher_extension import WrappersMP

from . import core, envelopes


class BlockShift:
    """dit ("double_block", i) patch: add this block's dial delta to the text rows, then run the block or the patch it wraps."""

    def __init__(self, shift, previous=None):
        self.shift = shift
        self.previous = previous

    def __call__(self, args, extra):
        h = args["img"]
        a, b, _ = next(s for s in args["layout"].segments if s[2] == "text")
        h[a:b] += self.shift.to(device=h.device, dtype=h.dtype)
        if self.previous is not None:
            return self.previous(args, extra)
        return extra["original_block"](args)


def block_shifts(rows, profiles, basis=None):
    """rows [(dial, strength)] -> {block: delta}, summed in float64 like the rack's post shift. One row without holds
    keeps the single hook's float32 product, so an all-ones profile reproduces either path bit for bit."""
    shifts = {}
    for i in range(len(profiles[0])):
        gains = [(w[i] - (w[i - 1] if i else 0.)) * s for w, (_, s) in zip(profiles, rows)]
        if not any(gains):
            continue
        if len(rows) == 1 and basis is None:
            shifts[i] = rows[0][0]["vec"] * gains[0]
            continue
        d = sum(g * dial["vec"].double() for (dial, _), g in zip(rows, gains) if g)
        if basis is not None:
            d = d - basis @ (basis.T @ d)
        shifts[i] = d.float()
    return shifts


def with_shifts(transformer_options, shifts):
    """A copy of one model call's options with the block patches added (wrapping any already there)."""
    options = transformer_options.copy()
    replace = options["patches_replace"] = dict(options.get("patches_replace", {}))
    dit = replace["dit"] = dict(replace.get("dit", {}))
    for i, shift in shifts.items():
        dit[("double_block", i)] = BlockShift(shift, dit.get(("double_block", i)))
    return options


class BlockEnvelopeForward(envelopes.EnvelopeForward):
    def __init__(self, rows, sigmas, profiles):
        super().__init__(rows, sigmas)
        self.profiles = profiles

    def __call__(self, executor, x, timestep, context, transformer_options, **kwargs):
        rows = [(dial, s) for (_, dial, _), s in zip(self.rows, self.strengths(transformer_options))]
        return executor(x, timestep, context, with_shifts(transformer_options, block_shifts(rows, self.profiles)), **kwargs)


class BlockEnvelopeSampler(envelopes.EnvelopeSampler):
    def __init__(self, rows, profiles, node_id=None, report=""):
        super().__init__(rows, node_id, report)
        self.profiles = profiles

    def compile(self, sigmas, model):
        return BlockEnvelopeForward(self.rows, sigmas, self.profiles)


def runs(w):
    """[1, 1, 0, 0] -> '0-1 ×1, 2-3 ×0'"""
    out, start = [], 0
    for i in range(1, len(w) + 1):
        if i == len(w) or w[i] != w[start]:
            out.append(f"{start}-{i - 1} ×{w[start]:g}" if i - 1 > start else f"{start} ×{w[start]:g}")
            start = i
    return ", ".join(out)


def apply_rack(model, rows, specs, profiles, holds=(), node_id=None, report=""):
    """rows [(label, dial, strength)] with their envelopes and block profiles (None = all ones); pre rows keep the
    single-dial chain. Returns the report lines for the profiles."""
    if core.text_path(model).family != "MiniMax H3":
        raise ValueError("block strengths support MiniMax H3 only; remove the row's block profile")
    n = len(model.model.diffusion_model.blocks)
    post, weights = [], []
    for (label, dial, strength), spec, w in zip(rows, specs, profiles):
        if dial["mode"] != "post":
            if w is not None:
                raise ValueError(f"{label}: pre-refiner rows cannot take block strengths; use a post-refiner dial")
            if spec is not None:
                raise ValueError("step envelopes support post-refiner token_refiner dials only; pre-refiner rows cannot be scheduled")
            core.apply_dial(model, dial, strength)
            continue
        w = [1.] * n if w is None else [float(x) for x in w]
        if len(w) != n:
            raise ValueError(f"{label}: block strengths cover {len(w)} blocks; this model has {n}")
        post.append((label, dial, strength, envelopes.envelope_points(spec)))
        weights.append(w)
    text = "\n".join([f"block strengths over {n} model blocks:"] + [f"  {label}: {runs(w)}" for (label, *_), w in zip(post, weights)])
    if any(spec is not None for spec in specs):
        model.add_wrapper_with_key(WrappersMP.SAMPLER_SAMPLE, envelopes.WRAPPER_KEY,
                                   BlockEnvelopeSampler(post, weights, node_id, report + "\n" + text))
        return text + "\nenvelopes: sampled strengths appear here when sampling starts"
    basis = core.hold_basis([d["vec"].double() for _, d, _ in holds], None) if holds else None
    dit = model.model_options["transformer_options"].get("patches_replace", {}).get("dit", {})
    for i, shift in block_shifts([(d, s) for _, d, s, _ in post], weights, basis).items():
        model.set_model_patch_replace(BlockShift(shift, dit.get(("double_block", i))), "dit", "double_block", i)
    return text
