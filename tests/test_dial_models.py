#!/usr/bin/env python3
"""Dials on MOSS-Image and Krea 2: the TEXT_PATHS adapters, family checks and envelopes.

  python tests/test_dial_models.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files: tiny instances of the real MOSSImage and SingleStreamDiT classes in a ModelPatcher.
  1. each adapter's refine runs the model's own text path (MOSS: TextEmbedder after proj; Krea: txtfusion + txtmlp), and
     Make Dial's post dial is the pair mean of post-seam token means;
  2. a post dial shifts the post module's output by strength * vec and reaches the DiT; on Krea it equals a txtmlp.3 bias
     diff, the reason Krea has no separate pre seam (Make Dial refuses pre there); a MOSS pre dial biases text_embedder.proj;
  3. dial files record their family; the rack and Combine Dials refuse another family's dial, and old files count as H3;
     picture dials and the probe bank say clearly that they are H3 only;
  4. step envelopes: constant equals the plain rack bit for bit, each step of an early envelope equals the rack at that
     step's strength, nested envelope racks add up, and nothing is shifted outside sampling.
Exit code 0 = pass.
"""
import importlib
import json
import os
import tempfile
import zlib

from test_dial_rack import comfy, core, folder_paths, nodes, torch
import comfy.model_management
import comfy.ops
from comfy.ldm.krea2.model import SingleStreamDiT
from comfy.ldm.moss_image.model import MOSSImage
from comfy.patcher_extension import WrapperExecutor, WrappersMP, get_all_wrappers

envelopes = importlib.import_module("mai_dials.envelopes")
analysis = importlib.import_module("mai_dials.analysis")
presets = importlib.import_module("mai_dials.presets")
OPS = comfy.ops.disable_weight_init
SIGMAS = torch.tensor([1., .8, .5, .2, 0.])
PAIRS = "{subject} by day ||| {subject} at night\n{subject} under warm light ||| {subject} under cold light"
SUBJECTS = "A man\nA dog"


def tiny(cls, **kw):
    torch.manual_seed(3)
    dm = cls(operations=OPS, **kw)
    for p in dm.parameters():
        p.data = torch.randn_like(p) * 0.2
    return dm


FAMILIES = {
    "MOSS-Image": (lambda: tiny(MOSSImage, dim=32, ffn_dim=64, num_heads=2, num_layers=1, text_dim=24, latent_channels=4), 24),
    "Krea 2": (lambda: tiny(SingleStreamDiT, features=32, tdim=16, txtdim=16, heads=2, kvheads=2, multiplier=2, layers=1,
                            channels=4, txtlayers=3, txtheads=2, txtkvheads=2), 48),
}


class Fake(torch.nn.Module):
    def __init__(self, dm):
        super().__init__()
        self.diffusion_model = dm

    def get_dtype_inference(self):
        return torch.float32


class FakeClip:
    def __init__(self, dim):
        self.dim = dim

    def tokenize(self, text):
        return text

    def encode_from_tokens_scheduled(self, text):
        vecs = [torch.randn(self.dim, generator=torch.Generator().manual_seed(zlib.crc32(w.encode()))) for w in text.split()]
        return [[torch.stack(vecs).unsqueeze(0), {}]]


def patcher(family):
    make, dim = FAMILIES[family]
    return comfy.model_patcher.ModelPatcher(Fake(make()), load_device=torch.device("cpu"), offload_device=torch.device("cpu")), FakeClip(dim)


def post_tokens(dm, ctx):
    """The post seam as the model computes it in its own forward."""
    if isinstance(dm, MOSSImage):
        return dm.text_embedder(ctx[None], dm.rope(0, 0, ctx.shape[0], ctx.device))[0]
    return dm.txtmlp(dm.txtfusion(dm._unpack_context(ctx[None])))[0]


def patched(m, fn):
    comfy.model_management.unload_all_models()  # Make Dial leaves the base loaded, which would skip the clone's weight patches
    m.patch_model()
    try:
        return fn(m.model.diffusion_model).detach().clone()
    finally:
        m.unpatch_model()


def forward(dm, transformer_options={}):
    x = torch.randn(1, 4, 4, 4, generator=torch.Generator().manual_seed(9))
    ctx = FakeClip(24 if isinstance(dm, MOSSImage) else 48).encode_from_tokens_scheduled("a dog at night")[0][0]
    return dm(x, torch.tensor([0.5]), ctx, transformer_options=transformer_options)


def sample(m, sigmas=SIGMAS):
    """One apply-model call per step through the patcher's sampler wrappers, as ComfyUI's sampler makes them."""
    comfy.model_management.unload_all_models()
    m.patch_model()
    try:
        dm = m.model.diffusion_model

        def apply(x, t, c_concat, c_crossattn, control, transformer_options):
            return forward(dm, transformer_options).detach().clone()

        def run(model, schedule, extra_args):
            opts = extra_args["model_options"]["transformer_options"]
            out = []
            for s in schedule[:-1]:
                call = {**opts, "sigmas": torch.tensor([float(s)])}
                out.append(WrapperExecutor.new_executor(apply, get_all_wrappers(WrappersMP.APPLY_MODEL, call)).execute(None, s, None, None, None, call))
            return out

        extra_args = {"model_options": {"transformer_options": {"wrappers": m.wrappers}}}
        return WrapperExecutor.new_executor(run, m.get_all_wrappers(WrappersMP.SAMPLER_SAMPLE)).execute(m, sigmas, extra_args)
    finally:
        m.unpatch_model()
        assert envelopes.SHIFT.get() is None, "envelope shift leaked out of the call"


def rack(m, rows, dials):
    return nodes.DialRack.execute(model=m, rack=json.dumps(rows), dials=dials).result[0]


def fails(fn, text):
    try:
        fn()
    except ValueError as exc:
        assert text in str(exc), str(exc)
    else:
        raise AssertionError(f"expected error: {text}")


def check_family(family):
    m, clip = patcher(family)
    dm = m.model.diffusion_model
    path = core.text_path(m)
    assert path.family == family
    ctx = clip.encode_from_tokens_scheduled("a dog at night")[0][0][0]
    pre = dm.get_submodule(path.pre)(ctx) if path.pre else ctx
    assert torch.equal(path.refine(dm, pre), post_tokens(dm, ctx)), "adapter refine differs from the model's text path"

    dial, report = core.make_dial(clip, m, PAIRS, SUBJECTS, "night", "post", debias=False)
    mean = lambda t: post_tokens(dm, clip.encode_from_tokens_scheduled(t)[0][0][0]).float().mean(0)
    expected = torch.stack([mean(b) - mean(a) for a, b in core.parse_pairs(PAIRS, SUBJECTS)[0]]).mean(0)
    assert torch.allclose(dial["vec"], expected, atol=1e-6), "post dial is not the pair mean at the post seam"
    assert (dial["target"], dial["mode"], dial["meta"]["model_family"]) == (path.post, "post", family)
    debiased, _ = core.make_dial(clip, m, PAIRS, SUBJECTS, "night", "post")
    assert debiased["vec"].norm() < dial["vec"].norm() and "debias removed" in _

    steered = m.clone()
    core.apply_dial(steered, dial, 1.5)
    assert torch.allclose(patched(steered, lambda d: post_tokens(d, ctx)), post_tokens(dm, ctx) + 1.5 * dial["vec"], atol=1e-6)
    assert not torch.allclose(patched(steered, forward), forward(dm).detach()), "post dial did not reach the DiT"

    if path.pre is None:
        fails(lambda: core.make_dial(clip, m, PAIRS, SUBJECTS, "x", "pre"), f"{family} has no pre_refiner seam")
        as_bias = m.clone()
        as_bias.add_patches({"diffusion_model.txtmlp.3.bias": ("diff", (dial["vec"],))}, 1.5)
        assert torch.allclose(patched(as_bias, forward), patched(steered, forward), atol=1e-5), "post dial != txtmlp.3 bias diff"
    else:
        pre_dial, report = core.make_dial(clip, m, PAIRS, SUBJECTS, "x", "pre")
        assert pre_dial["target"] == path.pre and "calibrated" in report
        biased = m.clone()
        core.apply_dial(biased, pre_dial, 1.0)
        assert torch.allclose(patched(biased, lambda d: d.get_submodule(path.pre)(ctx)), pre + pre_dial["vec"], atol=1e-6)

    image = torch.rand(1, 8, 8, 3)
    fails(lambda: core.make_picture_dial(clip, m, [image], [image], ["<Picture 1>"], "x"), f"MiniMax H3 only (its encoder reads them); this model is {family}")
    return m, clip, dial


def check_envelopes(m, clip, dial):
    other, _ = core.make_dial(clip, m, "{subject} in calm weather ||| {subject} in a storm", SUBJECTS, "storm", "post", debias=False)
    ins = {"dial_0": dial, "dial_1": other}
    row = lambda i, s, **kw: {"input": f"dial_{i}", "strength": s, **kw}
    plain = sample(m)
    constant = rack(m, [row(0, 1.3, envelope="constant")], ins)
    expected = sample(rack(m, [row(0, 1.3)], ins))
    assert all(torch.equal(a, b) for a, b in zip(sample(constant), expected)), "constant envelope != plain rack"
    assert torch.equal(patched(constant, forward), forward(m.model.diffusion_model).detach()), "shifted outside sampling"

    early = rack(m, [row(0, 1., envelope="early")], ins)
    values = envelopes.EnvelopeForward([("a", dial, 1., envelopes.envelope_points("early"))], SIGMAS).rows[0][2]
    for i, (got, strength) in enumerate(zip(sample(early), values)):
        want = sample(rack(m, [row(0, strength)], ins))[i] if strength else plain[i]
        assert torch.equal(got, want), f"early envelope step {i} (strength {strength})"

    nested = rack(rack(m, [row(0, 1., envelope="constant")], ins), [row(1, -.5)], ins)
    both = sample(rack(m, [row(0, 1.), row(1, -.5)], ins))
    assert all(torch.allclose(a, b, atol=1e-5) for a, b in zip(sample(nested), both)), "nested envelope racks did not add"
    assert sum(isinstance(v, envelopes.ScheduledForward) for v in nested.object_patches.values()) == 1


def check_files(models):
    (moss, moss_dial), (krea, krea_dial) = models
    with tempfile.TemporaryDirectory(prefix="models_dials_") as tmp:
        folder_paths.add_model_folder_path("loras", tmp, is_default=True)
        core.save_dial(moss_dial, "moss_night")
        core.save_dial(krea_dial, "krea_night")
        old = {"vec": torch.ones(32), "target": "token_refiner", "mode": "post", "meta": {"name": "old_h3"}}
        core.save_dial(old, "old_h3")
        loaded = core.load_dial("dials/moss_night.safetensors")
        assert core.dial_family(loaded) == "MOSS-Image" and core.dial_family(core.load_dial("dials/old_h3.safetensors")) == "MiniMax H3"
        steered = rack(moss, [{"dial": "dials/moss_night.safetensors", "strength": 1}], None)
        assert list(steered.object_patches) == ["diffusion_model.text_embedder.forward"] and not steered.patches
        fails(lambda: rack(krea, [{"dial": "dials/moss_night.safetensors", "strength": 1}], None), "dial night was made for MOSS-Image; this model is Krea 2")
        fails(lambda: rack(moss, [{"dial": "dials/old_h3.safetensors", "strength": 1}], None), "was made for MiniMax H3; this model is MOSS-Image")
        fails(lambda: rack(moss, [{"dial": "dials/moss_night.safetensors", "strength": 1}, {"dial": "dials/old_h3.safetensors", "hold": True}], None),
              "was made for MiniMax H3")
        assert rack(krea, [{"dial": "dials/moss_night.safetensors", "strength": 0}], None) is krea, "an inactive row was checked"
        fails(lambda: analysis.dial_profile("dials/krea_night.safetensors", presets.dial_sha256("dials/krea_night.safetensors")),
              "no probe bank for Krea 2 yet")
        combine = lambda a, b: nodes.CombineDials.execute(a=a, b=b, weight_a=1., weight_b=.5, orthogonalize=False, name="").result[0]
        fails(lambda: combine(loaded, core.load_dial("dials/old_h3.safetensors")), "dial a was made for MOSS-Image, dial b for MiniMax H3")
        assert core.dial_family(combine(loaded, moss_dial)) == "MOSS-Image"


def main():
    models = []
    for family in FAMILIES:
        m, clip, dial = check_family(family)
        check_envelopes(m, clip, dial)
        models.append((m, dial))
    check_files(models)
    print("test_dial_models: PASS")


if __name__ == "__main__":
    main()
