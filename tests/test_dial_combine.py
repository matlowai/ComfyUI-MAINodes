#!/usr/bin/env python3
"""Combine Dials provenance: the saved recipe matches the operation exactly, nests for repeated combines, and names its
parents and result by the same tensor hash presets use; orthogonalize against a zero vector leaves a unchanged.

  python tests/test_dial_combine.py      (same ComfyUI lookup as test_dial_rack.py)
"""
import importlib
import json
import tempfile

from test_dial_rack import H, core, dial, folder_paths, nodes, torch

presets = importlib.import_module("mai_dials.presets")


def combine(a, b, weight_a, weight_b, orthogonalize, name=""):
    out = nodes.CombineDials.execute(a=a, b=b, weight_a=weight_a, weight_b=weight_b, orthogonalize=orthogonalize, name=name)
    return out.result[0], out.ui.as_dict()["text"][0]


def main():
    A, B, C = dial("post", 31, "ca"), dial("post", 32, "cb"), dial("post", 33, "cc")
    with tempfile.TemporaryDirectory(prefix="M2_combine_") as tmp:
        folder_paths.add_model_folder_path("loras", tmp, is_default=True)
        for d in (A, B, C):
            core.save_dial(d, d["meta"]["name"])
        a, b, c = (core.load_dial(f"dials/{n}.safetensors") for n in ("ca", "cb", "cc"))
        assert "composition" not in a["meta"], "a plain dial has no recipe"

        first, _ = combine(a, b, 1.0, -0.5, True, name="first")
        va, vb = a["vec"].float(), b["vec"].float()
        assert torch.equal(first["vec"], va - (va @ vb) / (vb @ vb) * vb - 0.5 * vb)
        recipe = first["meta"]["composition"]
        assert recipe == {"kind": "combine", "weight_a": 1.0, "weight_b": -0.5, "orthogonalize_a_against_b": True,
                          "a": {"name": "ca", "vector_sha256": presets.dial_sha256("dials/ca.safetensors")},
                          "b": {"name": "cb", "vector_sha256": presets.dial_sha256("dials/cb.safetensors")},
                          "result_sha256": presets.dial_sha256("dials/first.safetensors")}, recipe
        saved = core.load_dial("dials/first.safetensors")
        assert json.loads(saved["meta"]["composition"]) == recipe
        assert core.vector_sha256(saved) == recipe["result_sha256"]

        second, _ = combine(saved, c, 2.0, 0.25, True, name="second")
        vs, vc = saved["vec"].float(), c["vec"].float()
        assert torch.equal(second["vec"], 2.0 * (vs - (vs @ vc) / (vc @ vc) * vc) + 0.25 * vc), "effective vector != operation order"
        tree = json.loads(core.load_dial("dials/second.safetensors")["meta"]["composition"])
        assert tree["a"]["composition"] == recipe and "composition" not in tree["b"], tree
        assert tree["a"]["vector_sha256"] == recipe["result_sha256"] and tree["b"]["name"] == "cc"
        unsaved, _ = combine(first, c, 1.0, 1.0, False)
        assert unsaved["meta"]["composition"]["a"]["composition"] == recipe, "in-memory recipe lost when chaining"

        zero = dict(b, vec=torch.zeros(H), meta={"name": "zero"})
        kept, report = combine(a, zero, 1.5, 3.0, True)
        assert torch.equal(kept["vec"], 1.5 * va) and not kept["vec"].isnan().any()
        assert "b is a zero vector: orthogonalize left a unchanged" in report, report
        assert kept["meta"]["composition"]["orthogonalize_a_against_b"] is True
        _, plain = combine(a, zero, 1.0, 0.0, False)
        assert "zero vector" not in plain
    print("dial combine: exact recipe, nested recipes, matching hashes and the zero-vector orthogonalize checks passed")


if __name__ == "__main__":
    main()
