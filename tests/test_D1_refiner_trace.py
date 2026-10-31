"""D1: real ModelPatcher lifecycle, tensor parity, context capture and isolation."""
import importlib

from test_dial_rack import H, core, comfy, torch

trace_module = importlib.import_module("mai_dials.D1_trace")


class Refiner(torch.nn.Module):
    def forward(self, x, transformer_options=None):
        return x.tanh()


class MiniMaxH3Model(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.condition_proj = torch.nn.Linear(H, H)
        self.token_refiner = Refiner()


class Fake(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.diffusion_model = MiniMaxH3Model()


def main():
    torch.manual_seed(7)
    base = comfy.model_patcher.ModelPatcher(
        Fake(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    x = torch.randn(5, H)
    unpatched = base.model.diffusion_model.token_refiner.forward
    plain = unpatched(x)
    traced, trace = trace_module.install_trace(base, "first")
    other, other_trace = trace_module.install_trace(base, "second")
    traced.patch_model()
    try:
        for sigma, branch in ((1.0, 0), (1.0, 1), (0.5, 0)):
            opts = {"sigmas": torch.tensor([sigma]), "sample_sigmas": torch.tensor([1., .5, 0.]),
                    "cond_or_uncond": [branch]}
            out = traced.model.diffusion_model.token_refiner(x, transformer_options=opts)
            assert torch.equal(out, plain)
        assert len(trace.calls) == 3
        assert [c["nearest_schedule_index"] for c in trace.calls] == [0, 0, 1]
        assert [c["cond_or_uncond"] for c in trace.calls] == [[0], [1], [0]]
        assert all(c["schedule_distance"] == 0 for c in trace.calls)
        assert other_trace.calls == []
    finally:
        traced.unpatch_model()
    assert base.model.diffusion_model.token_refiner.forward == unpatched
    assert torch.equal(base.model.diffusion_model.token_refiner(x), plain)
    assert len(trace.calls) == 3
    # Calls made without sampling context (e.g. Make Dial) remain valid, with explicit nulls.
    other.patch_model()
    try:
        assert torch.equal(other.model.diffusion_model.token_refiner(x), plain)
        assert other_trace.calls[0]["sigmas"] is None
    finally:
        other.unpatch_model()
    shifted = base.clone()
    shift = torch.randn(H)
    core.apply_dial(shifted, {"mode": "post", "target": "token_refiner", "vec": shift}, .5)
    traced_shift, _ = trace_module.install_trace(shifted, "stacked")
    traced_shift.patch_model()
    try:
        assert torch.equal(traced_shift.model.diffusion_model.token_refiner(x), plain + shift * .5)
    finally:
        traced_shift.unpatch_model()
    print("D1 refiner trace: all checks passed")


if __name__ == "__main__":
    main()
