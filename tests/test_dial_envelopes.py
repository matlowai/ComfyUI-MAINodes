"""CPU envelope gates through real ModelPatcher/WrapperExecutor and H3's cached-context call path."""
import importlib
import json
import logging

from test_dial_rack import H, core, nodes, comfy, torch, chain, dial, rack
from comfy.patcher_extension import WrappersMP, WrapperExecutor, get_all_wrappers
from comfy.ldm.minimax.model import MiniMaxH3Model as H3

envelopes = importlib.import_module("mai_dials.envelopes")
PIKA = torch.tensor([1., .972973, .923077, .8, .571429, .333333, 0.])
BASE20 = torch.linspace(1., 0., 21)


class MiniMaxH3Model(torch.nn.Module):
    def __init__(self, dtype):
        super().__init__()
        self.hidden_size = H
        self.condition_proj = torch.nn.Linear(H + 3, H, dtype=dtype)
        self.token_refiner = torch.nn.Sequential(torch.nn.Linear(H, H, dtype=dtype), torch.nn.Tanh())

    preprocess_text_embeds = H3.preprocess_text_embeds
    forward = H3.forward

    def _forward(self, x, timestep, context, transformer_options, **kwargs):
        assert kwargs["payload"] == "preserved"
        return self.preprocess_text_embeds(context)


class Fake(torch.nn.Module):
    def __init__(self, dtype):
        super().__init__()
        self.diffusion_model = MiniMaxH3Model(dtype)


def sample(patcher, x, sigmas, calls=None, raw=False):
    patcher.patch_model()
    try:
        dm = patcher.model.diffusion_model
        context = x if raw else dm.preprocess_text_embeds(x)
        saved = context.clone()
        options = {"wrappers": patcher.wrappers, "sample_sigmas": sigmas}
        extra_args = {"model_options": {"transformer_options": options}}

        def run(model, schedule, extra_args, marker):
            assert marker == "sampler args preserved"
            opts = extra_args["model_options"]["transformer_options"]
            outputs, reports = [], []
            for wrapper in get_all_wrappers(WrappersMP.DIFFUSION_MODEL, opts):
                if isinstance(wrapper, envelopes.EnvelopeForward):
                    reports.append(wrapper.report())
            for sigma, branch in calls or [(s, 0) for s in schedule[:-1]]:
                call_opts = {**opts, "sigmas": torch.tensor([float(sigma)]), "cond_or_uncond": [branch]}
                outputs.append(dm([torch.zeros(1), torch.zeros(1)], float(sigma) * 1000, context,
                                  call_opts, payload="preserved").detach().clone())
            assert torch.equal(context, saved), "cached context was mutated"
            return outputs, reports

        result = WrapperExecutor.new_executor(run, patcher.get_all_wrappers(WrappersMP.SAMPLER_SAMPLE)).execute(
            patcher, sigmas, extra_args, "sampler args preserved")
        assert get_all_wrappers(WrappersMP.DIFFUSION_MODEL, options) == [], "runtime wrapper leaked into input options"
        return result
    finally:
        patcher.unpatch_model()


def equal(a, b):
    assert len(a) == len(b)
    assert all(torch.equal(x, y) for x, y in zip(a, b)), "tensor outputs differ"


def fails(fn, text):
    try:
        fn()
    except ValueError as exc:
        assert text in str(exc), str(exc)
    else:
        raise AssertionError(f"expected error: {text}")


def main():
    torch.manual_seed(813)
    evidence = []
    for dtype in (torch.float32, torch.bfloat16):
        base = comfy.model_patcher.ModelPatcher(Fake(dtype), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
        x = torch.randn(1, 7, H + 3).to(dtype)
        a, b, pre = dial("post", 12, "motion"), dial("post", 13, "grade"), dial("pre", 14, "pre")
        ins = {"dial_0": a, "dial_1": b, "dial_2": pre}
        row = lambda i, s, **kw: {"input": f"dial_{i}", "strength": s, **kw}
        old = chain(base, [(a, 1.3), (pre, .2), (b, -.47)])
        constant = rack(base, [row(0, 1.3, envelope="constant"), row(2, .2), row(1, -.47)], ins)
        assert constant.object_patches == {}, "scheduled row also installed an old refiner shift"
        assert not base.wrappers
        for name, schedule in (("pika6", PIKA), ("synthetic20", BASE20)):
            expected, _ = sample(old, x, schedule)
            got, reports = sample(constant, x, schedule)
            equal(got, expected)
            assert reports[0]["rows"][0]["strengths"] == [1.3] * (len(schedule) - 1)
            evidence.append({"dtype": str(dtype), "schedule": name, "constant_max_abs_diff": 0.0, "steps": len(got)})

        zero = rack(base, [row(0, 2., envelope={"type": "manual", "points": [[0, 0], [1, 0]]})], ins)
        plain, _ = sample(base, x, PIKA)
        equal(sample(zero, x, PIKA)[0], plain)
        assert sample(zero, x, PIKA)[1][0]["rows"][0]["strengths"] == [0.] * 6

        early = rack(base, [row(0, 1., envelope="early"), row(1, -.5)], ins)
        got, reports = sample(early, x, PIKA)
        values = reports[0]["rows"][0]["strengths"]
        assert all(abs(a - b) < 1e-12 for a, b in zip(values, [1., .6, .2, 0., 0., 0.]))
        for i, strength in enumerate(values):
            steps = ([(a, strength)] if strength else []) + [(b, -.5)]
            equal([got[i]], [sample(chain(base, steps), x, PIKA)[0][i]])
        # Repeat a sigma for separate CFG branches, then evaluate between actual steps.
        mid = float((PIKA[1] + PIKA[2]) / 2)
        repeated, _ = sample(early, x, PIKA, [(PIKA[1], 0), (PIKA[1], 1), (mid, 0), (PIKA[4], 0)])
        equal([repeated[0]], [repeated[1]])
        midpoint_strength = envelopes.interpolate(list(zip([-float(s) for s in PIKA[:-1]], values)), -mid)
        equal([repeated[2]], [sample(chain(base, [(a, midpoint_strength), (b, -.5)]), x, PIKA)[0][0]])
        assert abs(midpoint_strength - .4) < 1e-6

        # Per-sample compilation survives schedule changes, interleaved clones, and partial denoise schedules.
        late = rack(base, [row(0, 1., envelope="late")], ins)
        early_clone = early.clone()
        sample(late, x, BASE20)
        sample(early_clone, x, PIKA[2:])
        equal(sample(early, x, PIKA)[0], got)
        equal(sample(base, x, PIKA)[0], plain)
        equal(sample(constant, x, PIKA, raw=True)[0], sample(old, x, PIKA, raw=True)[0])

        # A later rack's constant post rows remain after the upstream envelope.
        first = rack(base, [row(0, 1.3, envelope="constant")], ins)
        second = rack(first, [row(1, -.47), row(2, .2)], ins)
        equal(sample(second, x, PIKA)[0], sample(old, x, PIKA)[0])
        filtered = rack(base, [row(0, 1., on=False, envelope="late"), row(1, -.5, solo=True), row(0, 1., envelope="early")], ins)
        equal(sample(filtered, x, PIKA)[0], sample(chain(base, [(b, -.5)]), x, PIKA)[0])
        assert rack(base, [row(0, 1., on=False, envelope="early")], ins) is base
        fails(lambda: rack(base, [row(2, .2, envelope="early")], ins), "pre-refiner")

    for spec in ("unknown", {"type": "manual", "points": [[0, 1], [0, 2]]},
                 {"type": "manual", "points": [[0, 1], [1, float("nan")]]}):
        fails(lambda: envelopes.envelope_points(spec), "envelope")
    manual = envelopes.envelope_points({"type": "manual", "points": [[.2, -1.], [.8, 2.]]})
    assert envelopes.interpolate(manual, 0) == -1 and envelopes.interpolate(manual, 1) == 2
    assert abs(envelopes.interpolate(manual, .5) - .5) < 1e-12
    for shape, expected in (("constant", [1., 1., 1., 1., 1., 1.]), ("early", [1., .6, .2, 0., 0., 0.]),
                            ("late", [0., 0., 0., .2, .6, 1.]), ("bell", [0., .4, .8, .8, .4, 0.])):
        compiled = envelopes.EnvelopeForward([("a", a, 1., envelopes.envelope_points(shape))], PIKA)
        actual = compiled.report()["rows"][0]["strengths"]
        assert len(actual) == 6 and all(abs(a - b) < 1e-12 for a, b in zip(actual, expected))
        fails(lambda: compiled(None, None, None, None, {}), "no sampler sigma")
        fails(lambda: compiled(None, None, None, None, {"sigmas": torch.tensor([1., .5])}), "shared sigma")
    fails(lambda: envelopes.EnvelopeForward([], torch.tensor([1., 1., 0.])), "strictly decreasing")
    assert len(envelopes.EnvelopeForward([("a", a, 1., manual)], torch.tensor([.5, 0.])).progress) == 1
    assert not any("D1" in k for k in nodes.NODE_CLASS_MAPPINGS), "D1 diagnostics still registered"
    print(json.dumps({"constant_parity": evidence, "zero_max_abs_diff": 0.0, "checks": "all passed"}, indent=2))
    print("dial envelopes: constant/zero, sigma selection, ordering, isolation, filtering and validation passed")


if __name__ == "__main__":
    logging.disable(logging.INFO)
    with torch.no_grad():
        main()
