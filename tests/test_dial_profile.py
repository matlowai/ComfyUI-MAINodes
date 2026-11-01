#!/usr/bin/env python3
"""Probe-bank profiles: direct coefficients, ridge joint fit, unexplained share, zero vectors, space checks, cache (CPU)."""
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

HERE = Path(__file__).resolve().parent
COMFY = os.environ.get("COMFYUI_ROOT") or str(HERE.parents[2])
sys.path.insert(0, COMFY)
import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True  # before model_management picks a device
import folder_paths  # noqa: E402
import torch  # noqa: E402
from safetensors.torch import save_file  # noqa: E402

pkg_dir = HERE.parent / "dials"
spec = importlib.util.spec_from_file_location("mai_dials", pkg_dir / "__init__.py", submodule_search_locations=[str(pkg_dir)])
sys.modules["mai_dials"] = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sys.modules["mai_dials"])
analysis = importlib.import_module("mai_dials.analysis")
presets = importlib.import_module("mai_dials.presets")

D = 32
POST = "diffusion_model.token_refiner.dials_shift"


def e(i, scale=1.0):
    v = torch.zeros(D, dtype=torch.float64)
    v[i] = scale
    return v


def close(a, b, tol=1e-6):
    return torch.allclose(torch.as_tensor(a, dtype=torch.float64), torch.as_tensor(b, dtype=torch.float64), atol=tol)


def math_checks():
    probes = torch.stack([e(0, 2.0), e(1), e(0) * 3 + e(2) * 0.3, torch.zeros(D, dtype=torch.float64)])

    # identical direction: two probes' worth of probe 0 plus half of probe 1
    v = 2 * probes[0] + 0.5 * probes[1]
    direct = analysis.direct_coefficients(v, probes)
    assert close(direct[:2], [2.0, 0.5]) and direct[3] == 0, direct
    assert direct[2] > 1.0, "a correlated probe shares the direct credit"
    beta, unexplained = analysis.ridge_fit(v, probes, 1e-9)
    assert close(beta, [2.0, 0.5, 0.0, 0.0], 1e-4) and unexplained < 1e-6, (beta, unexplained)

    # opposing and mixed signs flip the coefficients
    assert close(analysis.direct_coefficients(-v, probes), -direct)
    assert close(analysis.ridge_fit(-v, probes, 1e-9)[0], -beta, 1e-4)

    # orthogonal to every probe: nothing explained
    beta, unexplained = analysis.ridge_fit(e(5), probes, 0.1)
    assert close(analysis.direct_coefficients(e(5), probes), torch.zeros(4)) and close(beta, torch.zeros(4)) and close(unexplained, 1.0)

    # two orthogonal dials can both carry probe 2 (shared affinity the cosine matrix cannot show)
    a, b = e(0) + e(3), e(2) - e(3)
    assert float(a @ b) < 0 and analysis.direct_coefficients(a, probes)[2] > 0 and analysis.direct_coefficients(b, probes)[2] > 0

    # zero dial and zero probe: neutral values, never NaN
    beta, unexplained = analysis.ridge_fit(torch.zeros(D, dtype=torch.float64), probes, 0.1)
    assert unexplained == 0.0 and close(beta, torch.zeros(4)) and not analysis.direct_coefficients(torch.zeros(D, dtype=torch.float64), probes).isnan().any()
    assert torch.isfinite(analysis.ridge_fit(v, probes, 0.1)[0]).all()

    # lambda shrinks the joint fit toward zero; the unexplained share grows toward 1
    shares = [analysis.ridge_fit(v, probes, lam)[1] for lam in (1e-6, 0.1, 1.0, 100.0)]
    assert shares == sorted(shares) and shares[-1] > 0.9, shares

    # collinear probes show up in the Gram condition number
    assert analysis.gram_condition(probes[:2]) < 1.01 and analysis.gram_condition(probes[:3]) > 50


def bank_checks():
    with tempfile.TemporaryDirectory(prefix="P3_profile_") as scratch:
        root = Path(scratch)
        folder_paths.add_model_folder_path("loras", str(root), is_default=True)
        (root / "dials" / "_probes").mkdir(parents=True)
        axes = []
        for i, (axis, neg, pos) in enumerate((("motion", "still", "moving"), ("light", "flat", "dramatic"))):
            save_file({POST: e(i, 2.0).to(torch.bfloat16)}, str(root / "dials" / "_probes" / f"{axis}.safetensors"))
            axes.append({"id": axis, "negative": neg, "positive": pos, "file": f"dials/_probes/{axis}.safetensors"})
        manifest = root / "dials" / "_probes" / "bank.json"
        manifest.write_text(json.dumps({"id": "test-bank", "version": 1, "ridge_lambda": 0.01, "axes": axes}))
        bank = "dials/_probes/bank.json"

        save_file({POST: (e(0, 4.0) + e(9)).to(torch.bfloat16)}, str(root / "dials" / "mix.safetensors"))
        sha = presets.dial_sha256("dials/mix.safetensors")
        p = analysis.dial_profile("dials/mix.safetensors", sha, bank)
        assert p["axes"] == ["motion", "light"] and p["positive"] == ["moving", "dramatic"] and close(p["direct"], [2.0, 0.0])
        assert 0.2 < p["unexplained"] < 0.3 and p["bank"] == "test-bank" and p["version"] == 1, p
        assert p["correlated"] == [], "a bank without correlated pairs lists none"
        assert json.dumps(p, allow_nan=False)

        # cached by vector hash and bank version; a changed vector or bank version is recomputed
        assert analysis.dial_profile("dials/mix.safetensors", sha, bank) is p
        save_file({POST: e(1, 2.0).to(torch.bfloat16)}, str(root / "dials" / "mix.safetensors"))
        changed = analysis.dial_profile("dials/mix.safetensors", presets.dial_sha256("dials/mix.safetensors"), bank)
        assert close(changed["direct"], [0.0, 1.0]) and changed["unexplained"] < 0.2, changed
        manifest.write_text(json.dumps({"id": "test-bank", "version": 2, "ridge_lambda": 0.01, "axes": axes[::-1]}))
        assert analysis.dial_profile("dials/mix.safetensors", presets.dial_sha256("dials/mix.safetensors"), bank)["axes"] == ["light", "motion"]

        # a pre-refiner dial is a different space: refused, not projected
        save_file({"diffusion_model.condition_proj.diff_b": e(0).to(torch.bfloat16)}, str(root / "dials" / "pre.safetensors"))
        try:
            analysis.dial_profile("dials/pre.safetensors", presets.dial_sha256("dials/pre.safetensors"), bank)
        except ValueError as err:
            assert "different space" in str(err)
        else:
            raise AssertionError("a pre-refiner dial was profiled against a post-refiner bank")


if __name__ == "__main__":
    math_checks()
    bank_checks()
    print("test_dial_profile: PASS")
