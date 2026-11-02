"""CPU gates for per-block dial strengths on a tiny real MiniMax H3 model (comfy.ldm.minimax, random weights).

  python tests/test_dial_blocks.py      (ComfyUI two levels up, or $COMFYUI_ROOT)

Checks: all-ones profiles equal today's paths bit for bit (one row, summed rows with a pre row, holds, one enveloped
row); delta injection (the text rows entering block i carry w_i * s * v, read through a tracing block patch); mixed
profiles equal an independent float64 per-block reference in any row order; holds project every block delta;
envelopes x blocks; chained racks and foreign block patches stack; old rows keep the refiner hook; errors; presets.
"""
import importlib
import itertools
import json
import logging

from test_dial_rack import core, nodes, comfy, torch, rack
import comfy.ops
from comfy.patcher_extension import WrappersMP, WrapperExecutor, copy_nested_dicts, get_all_wrappers
from comfy.ldm.minimax.model import MiniMaxH3Model

blocks = importlib.import_module("mai_dials.blocks")
presets = importlib.import_module("mai_dials.presets")
H, N, TEXT = 32, 8, 5
PIKA = torch.tensor([1., .972973, .923077, .8, .571429, .333333, 0.])
FIRST, SECOND, MIDDLE = [1.] * 4 + [0.] * 4, [0.] * 4 + [1.] * 4, [0., 0., 1., 1., 1., 0., 0., 0.]
ONES = [1.] * N


class Fake(torch.nn.Module):
    def __init__(self, dtype):
        super().__init__()
        self.diffusion_model = MiniMaxH3Model(
            hidden_size=H, num_layers=N, token_refiner_num_layers=1, num_attention_heads=2, attention_head_dim=16,
            ffn_hidden_size=64, latents_dim=4, audio_latents_dim=8, text_dim=24, timestep_input_dim=16,
            time_embed_hidden_size=H, time_embed_dim=16, rope_inv_freq_len=2, dtype=dtype, operations=comfy.ops.disable_weight_init)
        for p in [*self.diffusion_model.parameters(), *self.diffusion_model.buffers()]:
            p.data = (torch.randn(p.shape) * 0.2).to(p.dtype)
        self.requires_grad_(False)


def dial(mode, seed, name):
    g = torch.Generator().manual_seed(seed)
    return {"vec": torch.randn(H, generator=g) * 0.5, "target": "token_refiner" if mode == "post" else "condition_proj",
            "mode": mode, "meta": {"name": name}}


class Trace:
    """Records the text rows entering each block, after any dial patch wrapping it."""

    def __init__(self, log):
        self.log = log

    def __call__(self, args, extra):
        a, b, _ = args["layout"].segments[0]
        self.log.append(args["img"][a:b].clone())
        return extra["original_block"](args)


def traced(base):
    log = []
    m = base.clone()
    for i in range(N):
        m.set_model_patch_replace(Trace(log), "dit", "double_block", i)
    return m, log


def sample(patcher, inputs, sigmas=PIKA):
    """One model call per step, through the sampler and diffusion-model wrappers, with H3's cached refined text."""
    x, raw = inputs
    patcher.patch_model()
    try:
        dm = patcher.model.diffusion_model
        context = dm.preprocess_text_embeds(raw)
        options = {**patcher.model_options["transformer_options"], "wrappers": patcher.wrappers, "sample_sigmas": sigmas}

        def steps(model, schedule, extra_args):
            opts = extra_args["model_options"]["transformer_options"]
            return [[t.clone() for t in dm(x, s.reshape(1) * 1000, context, {**opts, "sigmas": s.reshape(1)})] for s in schedule[:-1]]
        return WrapperExecutor.new_executor(steps, patcher.get_all_wrappers(WrappersMP.SAMPLER_SAMPLE)).execute(
            patcher, sigmas, {"model_options": copy_nested_dicts({"transformer_options": options})})
    finally:
        patcher.unpatch_model()


def same(a, b):
    return all(torch.equal(x, y) for p, q in zip(a, b) for x, y in zip(p, q))


def max_diff(a, b):
    return max(float((x.float() - y.float()).abs().max()) for p, q in zip(a, b) for x, y in zip(p, q))


def fails(fn, text):
    try:
        fn()
    except ValueError as e:
        assert text in str(e), str(e)
    else:
        raise AssertionError(f"expected error: {text}")


def reference(base, steps):
    """Independent per-block float64 sums of (w_i - w_{i-1}) s v, installed as plain block patches."""
    m = base.clone()
    for i in range(N):
        d = sum(((w[i] - (w[i - 1] if i else 0.)) * s) * v["vec"].double() for v, s, w in steps)
        if torch.is_tensor(d) and bool(d.any()):
            m.set_model_patch_replace(blocks.BlockShift(d.float()), "dit", "double_block", i)
    return m


def check(dtype):
    torch.manual_seed(7)
    base = comfy.model_patcher.ModelPatcher(Fake(dtype), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    inputs = ([torch.randn(1, 4, 2, 4, 4).to(dtype), torch.randn(1, 8, 2, 6).to(dtype)], torch.randn(1, TEXT, 24).to(dtype))
    A, B, C, P = dial("post", 1, "a"), dial("post", 2, "b"), dial("post", 3, "c"), dial("pre", 4, "p")
    ins = {"dial_0": A, "dial_1": B, "dial_2": C, "dial_3": P, "dial_4": A}
    row = lambda i, s, **kw: {"input": f"dial_{i}", "strength": s, **kw}
    plain = sample(base, inputs)
    out = {"dtype": str(dtype)}

    # 1. parity: all-ones profiles against today's paths
    cases = {"one row 0.6": [row(0, .6)], "two rows + pre": [row(0, 1.5), row(3, .7), row(1, -.47)],
             "hold": [row(0, 1.), row(1, -.5), row(2, 0., hold=True)], "early envelope": [row(0, 1.3, envelope="early"), row(3, .2)]}
    for name, rows in cases.items():
        old = rack(base, rows, ins)
        new = rack(base, [dict(r, blocks=ONES) if not r.get("hold") and r["input"] != "dial_3" else r for r in rows], ins)
        assert "patches_replace" not in old.model_options["transformer_options"], "rows without blocks left the refiner hook"
        assert not new.get_wrappers(WrappersMP.DIFFUSION_MODEL, core.POST_KEY), "a profiled rack kept the refiner hook"
        assert same(sample(new, inputs), sample(old, inputs)), f"all-ones parity failed: {name}"
    two = [row(0, 1.3, envelope="early"), row(1, -.47)]
    out["two_enveloped_rows_all_ones_max_abs"] = max_diff(
        sample(rack(base, [dict(r, blocks=ONES) for r in two], ins), inputs), sample(rack(base, two, ins), inputs))
    out["parity_exact"] = list(cases)

    # 2. delta injection: the text rows entering block i carry w_i * s * v
    m, base_in = traced(base)
    sample(m, inputs, PIKA[:2])
    entering = {}
    for name, w in (("ones", ONES), ("first", FIRST), ("second", SECOND), ("middle", MIDDLE)):
        m, log = traced(base)
        sample(rack(m, [row(0, 1.5, blocks=w)], ins), inputs, PIKA[:2])
        entering[name] = log
    shift = (A["vec"] * 1.5).to(dtype)
    for i in range(4):
        assert torch.equal(entering["second"][i], base_in[i]), "second half touched an early block"
        assert torch.equal(entering["first"][i], entering["ones"][i]), "first half differs from all-ones before block 4"
    assert torch.equal(entering["second"][4], base_in[4] + shift), "second half did not add the dial at block 4"
    assert torch.equal(entering["first"][4], entering["ones"][4] - shift), "first half did not remove the dial at block 4"
    assert torch.equal(entering["middle"][2], base_in[2] + shift) and torch.equal(entering["middle"][1], base_in[1])
    assert not torch.equal(entering["first"][5], base_in[5]), "blocks before the drop should keep the dial's effect"
    assert same(sample(rack(base, [row(0, 1.5, blocks=[0.] * N)], ins), inputs), plain), "all-zero profile changed the output"
    out["first_half_block4_vs_base_max_abs"] = float((entering["first"][4].float() - base_in[4].float()).abs().max())

    # 3. mixed profiles: float64 per-block sums, row order free
    mixed = [row(0, 1.5, blocks=FIRST), row(1, -.47, blocks=MIDDLE), row(2, .8), row(3, .7)]
    expected = sample(reference(rack(base, [row(3, .7)], ins), [(A, 1.5, FIRST), (B, -.47, MIDDLE), (C, .8, ONES)]), inputs)
    for order in itertools.permutations(mixed):
        assert same(sample(rack(base, list(order), ins), inputs), expected), "mixed profiles depend on row order"
    halves = [(A, .6, [.5] * N), (A, .6, [.5] * N)]  # identical profiles sum once per block
    assert same(sample(rack(base, [row(0, .6, blocks=[.5] * N), row(4, .6, blocks=[.5] * N)], ins), inputs),
                sample(reference(base, halves), inputs))

    # 4. holds project every block delta
    assert same(sample(rack(base, [row(0, 1., blocks=SECOND), row(4, 1., hold=True)], ins), inputs), plain), "hold did not cancel"
    held = rack(base, [row(0, 1., blocks=FIRST), row(1, -.5, blocks=MIDDLE), row(2, 0., hold=True)], ins)
    u = C["vec"].double() / C["vec"].double().norm()
    ref = base.clone()
    for i in range(N):
        d = sum(((w[i] - (w[i - 1] if i else 0.)) * s) * v["vec"].double() for v, s, w in [(A, 1., FIRST), (B, -.5, MIDDLE)])
        if torch.is_tensor(d) and bool(d.any()):
            ref.set_model_patch_replace(blocks.BlockShift((d - u * (u @ d)).float()), "dit", "double_block", i)
    assert same(sample(held, inputs), sample(ref, inputs)), "held profiles != projected reference"

    # 5. envelopes x blocks: each call's per-block deltas use that sigma's strengths
    timed = rack(base, [row(0, 1., envelope="early", blocks=FIRST), row(1, -.5, blocks=MIDDLE)], ins)
    got = sample(timed, inputs)
    for i, g in enumerate([1., .6, .2, 0., 0., 0.]):
        rows = ([row(0, g, blocks=FIRST)] if g else []) + [row(1, -.5, blocks=MIDDLE)]
        assert same([got[i]], [sample(rack(base, rows, ins), inputs)[i]]), f"envelope x blocks step {i}"
    assert not get_all_wrappers(WrappersMP.DIFFUSION_MODEL, timed.model_options["transformer_options"]), "wrapper leaked"

    # 6. stacking: a second rack and a foreign block patch keep working
    chained = rack(rack(base, [row(0, 1.5, blocks=FIRST)], ins), [row(1, -.47, blocks=MIDDLE)], ins)
    together = rack(base, [row(0, 1.5, blocks=FIRST), row(1, -.47, blocks=MIDDLE)], ins)
    out["chained_vs_one_rack_max_abs"] = max_diff(sample(chained, inputs), sample(together, inputs))
    assert out["chained_vs_one_rack_max_abs"] < (2e-2 if dtype == torch.bfloat16 else 1e-5)
    m, log = traced(base)
    sample(rack(m, [row(0, 1.5, blocks=SECOND)], ins), inputs, PIKA[:2])
    assert len(log) == N and torch.equal(log[4], base_in[4] + shift), "foreign block patch was dropped"

    # 7. errors and untouched input
    fails(lambda: rack(base, [row(3, .5, blocks=FIRST)], ins), "pre-refiner rows cannot take block strengths")
    fails(lambda: rack(base, [row(0, .5, blocks=[1.] * 3)], ins), "cover 3 blocks; this model has 8")
    fails(lambda: rack(base, [row(0, .5, blocks=FIRST, envelope="late"), row(1, 0., hold=True)], ins), "cannot share a rack")
    report = nodes.DialRack.execute(model=base, rack=json.dumps(mixed), dials=ins).ui.as_dict()["text"][0]
    assert "block strengths over 8 model blocks:" in report and "dial_0: a: 0-3 ×1, 4-7 ×0" in report, report
    assert same(sample(base, inputs), plain), "the input model was modified"
    return out


def main():
    evidence = [check(dtype) for dtype in (torch.float32, torch.bfloat16)]
    w = [0.5] * 50
    assert presets.preset_rows([{"dial": "dials/x.safetensors", "strength": 1, "blocks": w}])[0]["blocks"] == w
    fails(lambda: presets.preset_rows([{"dial": "dials/x.safetensors", "blocks": [1, "a"]}]), "preset blocks")
    assert blocks.runs([1., 1., 0., .5]) == "0-1 ×1, 2 ×0, 3 ×0.5"
    print(json.dumps(evidence, indent=2))
    print("dial blocks: parity, delta injection, mixed profiles, holds, envelopes, stacking and errors passed")


if __name__ == "__main__":
    logging.disable(logging.INFO)
    main()
