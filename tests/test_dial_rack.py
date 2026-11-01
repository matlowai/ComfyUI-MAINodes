#!/usr/bin/env python3
"""Dial Rack parity and row semantics.

  python tests/test_dial_rack.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files: a stand-in model with H3's text-module names (condition_proj, token_refiner) wrapped in a
real ComfyUI ModelPatcher, so the test exercises ComfyUI's own object-patch nesting and weight-patch stacking.
Checks:
  1. a rack equals the chain of single Apply Dial steps (clone + apply per dial), bit for bit, for one post (hook) row
     and pre (LoRA-file) rows; two or more post rows equal one Apply Dial of their float64 sum, in any row order;
  2. off rows, zero-strength rows and non-solo rows (when something is soloed) change nothing;
  3. an all-off rack returns the input model untouched;
  4. dials saved to models/loras/dials round-trip and are found by the rack by file name;
  5. a row naming an unwired input fails with a clear error;
  6. the report flags strongly overlapping dials;
  7. holds cancel identical dials, remove overlapping directions together, and leave the no-hold path exact.
Exit code 0 = pass.
"""
import importlib.util
import itertools
import json
import os
import sys
import tempfile

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
COMFY = os.environ.get("COMFYUI_ROOT") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))  # COMFYUI_ROOT for checkouts outside custom_nodes
sys.path.insert(0, COMFY)

import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True  # before model_management picks a device
import comfy.model_patcher  # noqa: E402
import folder_paths  # noqa: E402


def load_dials_package():
    pkg_dir = os.path.join(HERE, "..", "dials")
    spec = importlib.util.spec_from_file_location("mai_dials", os.path.join(pkg_dir, "__init__.py"), submodule_search_locations=[pkg_dir])
    pkg = importlib.util.module_from_spec(spec)
    sys.modules["mai_dials"] = pkg
    spec.loader.exec_module(pkg)
    return importlib.import_module("mai_dials.core"), importlib.import_module("mai_dials.nodes")


core, nodes = load_dials_package()
nodes.DialRack.hidden = type("Hidden", (), {"unique_id": None})  # set by the executor in ComfyUI
H = 16


class MiniMaxH3Model(torch.nn.Module):  # the class name is what the rack checks
    def __init__(self):
        super().__init__()
        self.condition_proj = torch.nn.Linear(H, H)
        self.token_refiner = torch.nn.Sequential(torch.nn.Linear(H, H), torch.nn.Tanh(), torch.nn.Linear(H, H))


class Fake(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.diffusion_model = MiniMaxH3Model()


def dial(mode, seed, name):
    g = torch.Generator().manual_seed(seed)
    return {"vec": torch.randn(H, generator=g), "target": "token_refiner" if mode == "post" else "condition_proj", "mode": mode,
            "meta": {"name": name, "n_pairs": "1", "pair_agreement_cos": "1.0"}}


def run(patcher, x):
    patcher.patch_model()
    try:
        dm = patcher.model.diffusion_model
        return dm.token_refiner(dm.condition_proj(x)).detach().clone()
    finally:
        patcher.unpatch_model()


def chain(base, steps):
    m = base
    for d, s in steps:
        m = m.clone()
        core.apply_dial(m, d, s)
    return m


def summed(steps):  # what the rack applies for several post rows: one dial at strength 1
    return dict(steps[0][0], vec=sum(s * d["vec"].double() for d, s in steps).float())


def rack(base, rows, dials=None):
    return nodes.DialRack.execute(model=base, rack=json.dumps(rows), dials=dials).result[0]


def check_holds(dtype):
    torch.manual_seed(5)
    base = comfy.model_patcher.ModelPatcher(Fake().to(dtype), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    x = torch.randn(5, H).to(dtype)
    A, B, C = dial("post", 1, "a"), dial("post", 2, "b"), dial("pre", 3, "c")
    ins = {"dial_0": A, "dial_1": B, "dial_2": C, "dial_3": A}
    row = lambda i, s, **kw: dict(input=f"dial_{i}", strength=s, **kw)
    rows = [row(0, 1), row(1, -0.5), row(2, 0.7)]
    expected = run(chain(base, [(C, 0.7), (summed([(A, 1), (B, -0.5)]), 1)]), x)
    for order in itertools.permutations(rows):
        assert torch.equal(run(rack(base, list(order), ins), x), expected), "row order changed the rack output"
    variants = [rows, [dict(r, hold=False) for r in rows], rows + [row(3, 1, hold=True, on=False)],
                [dict(r, solo=True) for r in rows] + [row(3, 1, hold=True)]]
    for variant in variants:
        assert torch.equal(run(rack(base, variant, ins), x), expected), "no-hold path changed"

    plain = run(base, x)
    identical = rack(base, [row(0, 1), row(3, 1, hold=True)], ins)
    cancelled = run(identical, x)
    assert torch.equal(cancelled, plain), "identical hold did not cancel its dial"
    for strength in (-3, 0, 4):
        assert torch.equal(run(rack(base, [row(0, 1), row(3, strength, hold=True)], ins), x), plain)
    assert rack(base, [row(3, 0, hold=True)], ins) is base, "hold-only rack changed the model"
    assert rack(base, [row(0, 1), row(3, 0, hold=True, solo=True)], ins) is base, "solo hold failed to isolate"
    pre_only = rack(base, [row(2, 0.7), row(3, 0, hold=True)], ins)
    assert torch.equal(run(pre_only, x), run(chain(base, [(C, 0.7)]), x)), "hold changed a pre-refiner shift"

    near = dict(A, vec=A["vec"] + 0.3 * B["vec"], meta={"name": "near"})
    zero = dict(A, vec=torch.zeros(H), meta={"name": "zero"})
    post = [("a", A, 1), ("b", B, -0.5)]
    holds = [("a", A, 0), ("near", near, 1), ("duplicate", A, -1), ("zero", zero, 1)]
    combined, report = core.rack_hold_shift(post, holds)
    directions = torch.stack([A["vec"], near["vec"]], dim=1).double()
    total = A["vec"].double() - 0.5 * B["vec"].double()
    reference = total - directions @ (torch.linalg.pinv(directions) @ total)
    assert torch.allclose(combined["vec"].double(), reference, atol=1e-12, rtol=1e-6)
    assert float((directions.T @ combined["vec"].double()).abs().max()) < 1e-12
    reordered, _ = core.rack_hold_shift(post, list(reversed(holds)))
    assert torch.allclose(combined["vec"], reordered["vec"], atol=1e-12, rtol=1e-6)
    assert "H  duplicate: removed 0.0%" in report and "H  zero: removed 0.0%" in report, report
    full_basis = [(str(i), dict(A, vec=torch.eye(H)[i]), 1) for i in range(H)] + holds
    fully_held, _ = core.rack_hold_shift(post, full_basis)
    assert torch.equal(fully_held["vec"], torch.zeros(H))

    e0, e1 = torch.eye(H)[:2]
    first = dict(A, vec=e0, meta={"name": "first"})
    overlap = dict(A, vec=e0 + e1, meta={"name": "overlap"})
    drive = dict(A, vec=3 * e0 + 4 * e1, meta={"name": "drive"})
    _, shares = core.rack_hold_shift([("drive", drive, 1)], [("first", first, 1), ("overlap", overlap, 1)])
    assert "H  first: removed 36.0%" in shares and "H  overlap: removed 64.0%" in shares, shares
    outside = dict(drive, vec=drive["vec"] + 5 * torch.eye(H)[2])
    retained, _ = core.rack_hold_shift([("outside", outside, 1)], [("first", first, 1), ("overlap", overlap, 1)])
    assert torch.allclose(retained["vec"], 5 * torch.eye(H)[2], atol=1e-12, rtol=0), "holds removed the orthogonal component"

    ins.update(dial_3=near, dial_4=zero)
    partial = rack(base, rows + [row(3, 0, hold=True), row(4, 1, hold=True)], ins)
    projected, _ = core.rack_hold_shift(post, [("near", near, 0), ("zero", zero, 1)])
    expected = run(chain(base, [(C, 0.7), (projected, 1)]), x)
    assert torch.equal(run(partial, x), expected), "held rack did not apply its combined shift"
    wrapper = partial.get_model_object("diffusion_model.token_refiner.forward")
    assert isinstance(wrapper, core.ShiftedForward) and not isinstance(wrapper.forward, core.ShiftedForward)
    zero_shift, _ = core.rack_hold_shift(post, [("zero", zero, 1)])
    assert torch.equal(zero_shift["vec"], total.float()), "zero hold removed an arbitrary direction"
    upstream = chain(base, [(B, 0.25)])
    ins["dial_3"] = A
    assert torch.equal(run(rack(upstream, [row(0, 1), row(3, 1, hold=True)], ins), x), run(upstream, x))
    for bad_rows, message in (([row(0, 1), row(2, 0, hold=True)], "pre-refiner rows cannot be hold rows"),
                              ([row(2, 1, hold=True)], "pre-refiner rows cannot be hold rows")):
        try:
            rack(base, bad_rows, ins)
            raise AssertionError("pre-refiner hold accepted")
        except ValueError as e:
            assert message in str(e)
    try:
        core.rack_hold_shift(post, [("wrong", dict(A, target="other_refiner"), 1)])
        raise AssertionError("different targets accepted")
    except ValueError as e:
        assert "same target" in str(e)
    output = nodes.DialRack.execute(model=base, rack=json.dumps([row(0, 1), row(3, 1, hold=True)]), dials=ins)
    report = output.ui.as_dict()["text"][0]
    assert "post-refiner shift after holds |0.0|" in report and "removed 100.0%" in report, report
    assert torch.equal(run(base, x), plain), "holds modified the input model"
    return dict(dtype=str(dtype), exact_no_hold_cases=len(variants), identical_hold_max_abs=float((cancelled - plain).abs().max()),
                two_hold_max_abs_dot=float((directions.T @ combined["vec"].double()).abs().max()),
                projection_reference_max_abs=float((combined["vec"].double() - reference).abs().max()),
                retained_orthogonal_norm=float(retained["vec"].norm()), report=report)


def main():
    torch.manual_seed(0)
    base = comfy.model_patcher.ModelPatcher(Fake(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    x = torch.randn(5, H)
    A, B, C = dial("post", 1, "a"), dial("post", 2, "b"), dial("pre", 3, "c")
    ins = {"dial_0": A, "dial_1": B, "dial_2": C}
    row = lambda i, s, **kw: dict({"on": True, "input": f"dial_{i}", "strength": s, "solo": False}, **kw)
    plain = run(base, x)

    full = rack(base, [row(0, 1.0), row(1, -0.5), row(2, 0.7)], ins)
    assert torch.equal(run(full, x), run(chain(base, [(C, 0.7), (summed([(A, 1.0), (B, -0.5)]), 1)]), x)), "rack != chain"
    one = rack(base, [row(0, 0.35), row(2, 0.7)], ins)
    assert torch.equal(run(one, x), run(chain(base, [(A, 0.35), (C, 0.7)]), x)), "one post row != chain"
    assert not torch.equal(run(full, x), plain), "rack had no effect"

    off = rack(base, [row(0, 1.0), row(1, -0.5, on=False), row(2, 0.0)], ins)
    assert torch.equal(run(off, x), run(chain(base, [(A, 1.0)]), x)), "off / zero rows changed the output"
    solo = rack(base, [row(0, 1.0), row(1, -0.5, solo=True), row(2, 0.7)], ins)
    assert torch.equal(run(solo, x), run(chain(base, [(B, -0.5)]), x)), "solo did not isolate its row"
    assert rack(base, [row(0, 1.0, on=False)], ins) is base, "all-off rack must return the input model"
    assert torch.equal(run(base, x), plain), "the input model was modified"

    scratch = tempfile.TemporaryDirectory(prefix="B5_rack_")
    tmp = scratch.name
    folder_paths.add_model_folder_path("loras", tmp, is_default=True)
    core.save_dial(A, "rack_test_a")
    loaded = core.load_dial("dials/rack_test_a.safetensors")
    assert loaded["mode"] == "post" and loaded["target"] == "token_refiner"
    by_file = rack(base, [{"on": True, "dial": "dials/rack_test_a.safetensors", "strength": 1.0}])
    # the file is stored in bf16, so compare against the chain with the loaded (rounded) vector
    assert torch.equal(run(by_file, x), run(chain(base, [(loaded, 1.0)]), x)), "file row != chain"
    held_file = rack(base, [{"dial": "dials/rack_test_a.safetensors", "strength": 1},
                            {"dial": "dials/rack_test_a.safetensors", "strength": 0, "hold": True}])
    assert torch.equal(run(held_file, x), plain), "file hold did not cancel its dial"

    try:
        rack(base, [row(5, 1.0)], ins)
        raise AssertionError("missing input did not raise")
    except ValueError as e:
        assert "dial_5" in str(e)

    near = dial("post", 1, "a2")
    near["vec"] = A["vec"] + 0.1 * B["vec"]
    report = nodes.DialRack.execute(model=base, rack=json.dumps([row(0, 1.0), row(1, 1.0)]), dials={"dial_0": A, "dial_1": near}).ui.as_dict()["text"][0]
    assert "overlap" in report and "reinforce" in report, report
    print(json.dumps({"hold_checks": [check_holds(dtype) for dtype in (torch.float32, torch.bfloat16)]}))
    print("dial rack: all checks passed")
    scratch.cleanup()


if __name__ == "__main__":
    main()
