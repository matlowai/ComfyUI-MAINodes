#!/usr/bin/env python3
"""Dial Rack parity and row semantics.

  python tests/test_dial_rack.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files: a stand-in model with H3's text-module names (condition_proj, token_refiner) wrapped in a
real ComfyUI ModelPatcher, so the test exercises ComfyUI's own object-patch nesting and weight-patch stacking.
Checks:
  1. a rack equals the chain of single Apply Dial steps (clone + apply per dial), bit for bit, for post (hook) and
     pre (LoRA-file) dials mixed;
  2. off rows, zero-strength rows and non-solo rows (when something is soloed) change nothing;
  3. an all-off rack returns the input model untouched;
  4. dials saved to models/loras/dials round-trip and are found by the rack by file name;
  5. a row naming an unwired input fails with a clear error;
  6. the report flags strongly overlapping dials.
Exit code 0 = pass.
"""
import importlib.util
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


def rack(base, rows, dials=None):
    return nodes.DialRack.execute(model=base, rack=json.dumps(rows), dials=dials).result[0]


def main():
    torch.manual_seed(0)
    base = comfy.model_patcher.ModelPatcher(Fake(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    x = torch.randn(5, H)
    A, B, C = dial("post", 1, "a"), dial("post", 2, "b"), dial("pre", 3, "c")
    ins = {"dial_0": A, "dial_1": B, "dial_2": C}
    row = lambda i, s, **kw: dict({"on": True, "input": f"dial_{i}", "strength": s, "solo": False}, **kw)
    plain = run(base, x)

    full = rack(base, [row(0, 1.0), row(1, -0.5), row(2, 0.7)], ins)
    assert torch.equal(run(full, x), run(chain(base, [(A, 1.0), (B, -0.5), (C, 0.7)]), x)), "rack != chain"
    assert not torch.equal(run(full, x), plain), "rack had no effect"

    off = rack(base, [row(0, 1.0), row(1, -0.5, on=False), row(2, 0.0)], ins)
    assert torch.equal(run(off, x), run(chain(base, [(A, 1.0)]), x)), "off / zero rows changed the output"
    solo = rack(base, [row(0, 1.0), row(1, -0.5, solo=True), row(2, 0.7)], ins)
    assert torch.equal(run(solo, x), run(chain(base, [(B, -0.5)]), x)), "solo did not isolate its row"
    assert rack(base, [row(0, 1.0, on=False)], ins) is base, "all-off rack must return the input model"
    assert torch.equal(run(base, x), plain), "the input model was modified"

    with tempfile.TemporaryDirectory() as tmp:
        folder_paths.add_model_folder_path("loras", tmp, is_default=True)
        core.save_dial(A, "rack_test_a")
        loaded = core.load_dial("dials/rack_test_a.safetensors")
        assert loaded["mode"] == "post" and loaded["target"] == "token_refiner"
        by_file = rack(base, [{"on": True, "dial": "dials/rack_test_a.safetensors", "strength": 1.0}])
        # the file is stored in bf16, so compare against the chain with the loaded (rounded) vector
        assert torch.equal(run(by_file, x), run(chain(base, [(loaded, 1.0)]), x)), "file row != chain"
        assert "dials/rack_test_a.safetensors" in core.dial_files()

    try:
        rack(base, [row(5, 1.0)], ins)
        raise AssertionError("missing input did not raise")
    except ValueError as e:
        assert "dial_5" in str(e)

    near = dial("post", 1, "a2")
    near["vec"] = A["vec"] + 0.1 * B["vec"]
    report = nodes.DialRack.execute(model=base, rack=json.dumps([row(0, 1.0), row(1, 1.0)]), dials={"dial_0": A, "dial_1": near}).ui.as_dict()["text"][0]
    assert "overlap" in report and "reinforce" in report, report
    print("dial rack: all checks passed")


if __name__ == "__main__":
    main()
