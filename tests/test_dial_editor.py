#!/usr/bin/env python3
"""Dial editor (CPU, synthetic vectors): edit math, removing an axis under the direct and the joint fit, the Gram numbers
the UI computes its live readouts from, library PCA, export provenance round trip, no overwrite, family/seam refusals,
and zero vectors giving neutral values."""
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
core = importlib.import_module("mai_dials.core")
editor = importlib.import_module("mai_dials.editor")
presets = importlib.import_module("mai_dials.presets")

D = 32
POST = "diffusion_model.token_refiner.dials_shift"
BANK = {"bank": "test-bank", "bank_version": 1}


def e(i, scale=1.0):
    v = torch.zeros(D, dtype=torch.float64)
    v[i] = scale
    return v


def bf(v):  # what a saved dial holds
    return v.to(torch.bfloat16).double()


def close(a, b, tol=1e-6):
    return torch.allclose(torch.as_tensor(a, dtype=torch.float64), torch.as_tensor(b, dtype=torch.float64), atol=tol)


def write(root, name, vec, key=POST, family=None):
    meta = {"name": Path(name).stem, **({"model_family": family} if family else {})}
    save_file({key: vec.to(torch.bfloat16)}, str(root / "dials" / f"{name}.safetensors"), metadata=meta)


def setup(root, lam):
    """Bank: light, mood (correlated with light, cos 0.6) and motion; a small library of four dials plus aliases."""
    folder_paths.folder_names_and_paths["loras"] = ([str(root)], folder_paths.supported_pt_extensions)
    folder_paths.filename_list_cache.clear()  # the previous check's temp folder is gone
    (root / "dials" / "_probes").mkdir(parents=True, exist_ok=True)
    probes = {"light": e(0, 2.0), "mood": bf(e(0, 1.2) + e(1, 1.6)), "motion": e(2)}
    axes = []
    for axis, p in probes.items():
        write(root, f"_probes/{axis}", p)
        axes.append({"id": axis, "negative": f"less {axis}", "positive": f"more {axis}", "file": f"dials/_probes/{axis}.safetensors"})
    (root / "dials" / "_probes" / "bank.json").write_text(json.dumps({"id": "test-bank", "version": 1, "ridge_lambda": lam, "axes": axes,
                                                                      "correlated": [["light", "mood", 0.6]]}))
    analysis.BANKS["MiniMax H3"] = "dials/_probes/bank.json"
    write(root, "evil", e(0, 3.0) + e(1) + e(5, 2.0))
    write(root, "evil_hook", e(0, 3.0) + e(1) + e(5, 2.0))  # alias: same vector
    write(root, "warm", e(0, -2.0) + e(6))
    write(root, "storm", e(2, 2.0) + e(7))
    write(root, "pre", e(0), key="diffusion_model.condition_proj.diff_b")
    write(root, "krea", e(0), family="Krea 2")
    return {k: bf(p) for k, p in probes.items()}


def edit_math():
    with tempfile.TemporaryDirectory(prefix="editor_math_") as scratch:
        root = Path(scratch)
        p = setup(root, 1e-9)
        ctx = editor.context("dials/evil.safetensors")
        v = ctx["dial"]["vec"].double()

        # the library: same family and seam only, aliases folded into one entry
        names = sorted(n for names, _, _ in ctx["library"] for n in names)
        assert names == ["dials/evil.safetensors", "dials/evil_hook.safetensors", "dials/storm.safetensors", "dials/warm.safetensors"], names
        assert len(ctx["library"]) == 3

        # v' = v + sum delta_k p_k; a probe drag adds along both probes; a PCA drag along the two unit components
        out, clean = editor.edited_vector(ctx, [{"kind": "axis", "axis": "motion", "delta": 0.5, "fit": "direct", **BANK},
                                                {"kind": "axis", "axis": "light", "delta": -0.25, "fit": "joint", **BANK},
                                                {"kind": "drag", "basis": "probes", "axes": ["mood", "motion"], "delta": [1.0, -2.0], "fit": "direct", **BANK}])
        assert close(out, v + 0.5 * p["motion"] - 0.25 * p["light"] + p["mood"] - 2.0 * p["motion"])
        assert clean[2] == {"kind": "drag", "basis": "probes", "axes": ["mood", "motion"], "delta": [1.0, -2.0], "fit": "direct", **BANK}
        pca = {"kind": "drag", "basis": "library_pca", "library_sha256": ctx["library_sha256"],
               "components_sha256": editor.components_sha256(ctx["components"]), "delta": [0.3, -0.7], "junk": "dropped"}
        out, clean = editor.edited_vector(ctx, [pca])
        assert close(out, v + 0.3 * ctx["components"][0] - 0.7 * ctx["components"][1]) and "junk" not in clean[0] and clean[0]["n_library"] == 3
        assert editor.edited_vector(ctx, [])[0].equal(v)

        # direct removal: the axis' projection is gone, but a correlated probe's coefficient moves too
        P, direct = ctx["probes"], analysis.direct_coefficients(v, ctx["probes"])
        out, _ = editor.edited_vector(ctx, [{"kind": "axis", "axis": "light", "delta": float(-direct[0]), "fit": "direct", **BANK}])
        after = analysis.direct_coefficients(out, P)
        assert abs(float(after[0])) < 1e-9 and not close(after[1], direct[1]) and close(after[2], direct[2]), (direct, after)

        # joint removal (lambda ~ 0): subtracting the fitted component zeroes that joint coefficient and leaves the others
        beta = analysis.ridge_fit(v, P, 1e-9)[0]
        out, _ = editor.edited_vector(ctx, [{"kind": "axis", "axis": "light", "delta": float(-beta[0]), "fit": "joint", **BANK}])
        assert close(out, v - beta[0] * p["light"])
        after = analysis.ridge_fit(out, P, 1e-9)[0]
        assert abs(float(after[0])) < 1e-6 and close(after[1:], beta[1:], 1e-6), (beta, after)

        # the Gram numbers the UI uses reproduce the exact readouts for any c
        state = editor.editor_state("dials/evil.safetensors")
        assert json.dumps(state, allow_nan=False) and state["bank"]["correlated"] == [["light", "mood", 0.6]]
        c = torch.tensor([0.4, -1.1, 0.7, 0.9, -0.2], dtype=torch.float64)
        vq, qq, jq, rr = (torch.tensor(state[k], dtype=torch.float64) for k in ("vq", "qq", "jq", "rr"))
        Q = editor.basis(ctx)
        x = v + Q.T @ c
        assert close(state["vv"] + 2 * c @ vq + c @ qq @ c, x @ x)
        assert close(torch.tensor(state["joint"]) + c @ jq, analysis.ridge_fit(x, P, 1e-9)[0], 1e-5)
        one = torch.cat([torch.ones(1, dtype=torch.float64), c])
        assert close((one @ rr @ one).sqrt() / x.norm(), analysis.ridge_fit(x, P, 1e-9)[1])
        assert close(torch.tensor(state["pc"]) + c @ qq[:, 3:], (x - ctx["mean"]) @ ctx["components"].T)
        lib = {item["names"][0]: item for item in state["library"]}
        w = core.load_dial("dials/storm.safetensors")["vec"].double()
        assert close(lib["dials/storm.safetensors"]["vw"] + c @ torch.tensor(lib["dials/storm.safetensors"]["qw"], dtype=torch.float64), x @ w)

        # stale or foreign edits are refused
        for bad, words in (({"kind": "axis", "axis": "light", "delta": 1, "fit": "joint", "bank": "test-bank", "bank_version": 2}, "probe bank"),
                           ({"kind": "axis", "axis": "voice", "delta": 1, "fit": "joint", **BANK}, "unknown probe axis"),
                           ({"kind": "axis", "axis": "light", "delta": float("nan"), "fit": "joint", **BANK}, "finite"),
                           ({"kind": "axis", "axis": "light", "delta": 1, "fit": "cosine", **BANK}, "fit"),
                           (dict(pca, library_sha256="0" * 64), "library changed")):
            try:
                editor.edited_vector(ctx, [bad])
            except ValueError as err:
                assert words in str(err), (bad, err)
            else:
                raise AssertionError(f"accepted {bad}")
        # a malformed edit is quoted whole: an agent reads the error to fix its call
        long_edit = {"kind": "spin", "note": "y" * 400 + " the end"}
        try:
            editor.edited_vector(ctx, [long_edit])
        except ValueError as err:
            assert str(err) == f"malformed edit: {json.dumps(long_edit)}", err
        else:
            raise AssertionError("accepted a malformed edit")


def pca_checks():
    vecs = [e(0, 1.0), e(0, 3.0), e(1, 2.0) + e(0, 2.0), e(0, 2.0) - e(1, 2.0)]  # spread along e0 and e1 only
    hashes = [f"{i}" * 64 for i in range(4)]
    key, mean, comps = editor.library_pca(vecs, hashes)
    assert close(mean, e(0, 2.0)) and close(comps @ comps.T, torch.eye(2)), comps
    assert close(comps[:, 2:], torch.zeros(2, D - 2)) and close(comps[0].abs(), e(1)) and close(comps[1].abs(), e(0))
    assert all(float(c[c.abs().argmax()]) > 0 for c in comps), "sign convention: largest entry positive"
    assert editor.library_pca(list(reversed(vecs)), list(reversed(hashes)))[0] == key, "keyed by the set of hashes"
    _, _, two = editor.library_pca([e(0), e(1)], ["a" * 64, "b" * 64])
    assert close(two[0].norm(), 1.0) and close(two[1], torch.zeros(D)), "two dials span one component"
    _, _, one = editor.library_pca([e(3)], ["c" * 64])
    assert close(one, torch.zeros(2, D)) and not one.isnan().any()


def export_checks():
    with tempfile.TemporaryDirectory(prefix="editor_export_") as scratch:
        root = Path(scratch)
        p = setup(root, 0.1)
        edits = [{"kind": "axis", "axis": "light", "delta": -1.0, "fit": "joint", **BANK}]
        out = editor.export_edit("dials/evil.safetensors", edits, "_editor_test/evil_cooler")
        saved = core.load_dial("dials/_editor_test/evil_cooler.safetensors")
        assert out["file"] == "dials/_editor_test/evil_cooler.safetensors" and saved["meta"]["name"] == "evil_cooler"
        assert close(saved["vec"], bf(bf(e(0, 3.0) + e(1) + e(5, 2.0)) - 1.0 * p["light"]))
        recipe = json.loads(saved["meta"]["composition"])
        assert recipe == {"kind": "edit", "parent": {"name": "evil", "vector_sha256": presets.dial_sha256("dials/evil.safetensors")},
                          "edits": edits, "result_sha256": presets.dial_sha256("dials/_editor_test/evil_cooler.safetensors")}, recipe
        assert out["composition"] == recipe and out["vector_sha256"] == recipe["result_sha256"]
        assert json.loads(saved["meta"]["parents"]) == ["evil"] and saved["meta"]["model_family"] == "MiniMax H3"
        info = core.dial_info("dials/_editor_test/evil_cooler.safetensors")
        assert info["evidence"] is None and info["pos"] == info["neg"] == {"useful": None, "overcook": None} and "untested" in info["notes"]

        # readouts: size, cosine with the parent, neighbours (parent and its alias left out), coefficient changes
        v, x = core.load_dial("dials/evil.safetensors")["vec"].double(), saved["vec"].double()
        assert close(out["norm"], x.norm()) and close(out["cos_parent"], (x @ v) / (x.norm() * v.norm()))
        assert [n["dial"] for n in out["neighbours"]] == ["dials/storm.safetensors", "dials/warm.safetensors"], out["neighbours"]
        assert out["joint_change"][0] < -0.5 and json.dumps(out, allow_nan=False)

        # never overwrite; an edited dial can be edited again and its recipe nests
        before = (root / "dials" / "_editor_test" / "evil_cooler.safetensors").read_bytes()
        try:
            editor.export_edit("dials/evil.safetensors", [], "_editor_test/evil_cooler")
        except FileExistsError:
            pass
        else:
            raise AssertionError("an existing dial was overwritten")
        assert (root / "dials" / "_editor_test" / "evil_cooler.safetensors").read_bytes() == before
        again = editor.export_edit("dials/_editor_test/evil_cooler.safetensors", [], "evil_twice",
                                   info={"version": 2, "description": "mine", "evidence": "creator", "pos": {"useful": 1.0}})
        tree = json.loads(core.load_dial("dials/evil_twice.safetensors")["meta"]["composition"])
        assert tree["parent"]["composition"] == recipe and again["info"]["description"] == "mine"
        for name in ("../escape", "a/b/c", "bad name", ""):
            try:
                editor.export_edit("dials/evil.safetensors", [], name)
            except ValueError as err:
                assert "dial name" in str(err)
            else:
                raise AssertionError(f"accepted name {name!r}")

        # only post-refiner dials of a family with a probe bank
        for dial, words in (("dials/pre.safetensors", "pre-refiner"), ("dials/krea.safetensors", "no probe bank for Krea 2")):
            for fn in (lambda: editor.editor_state(dial), lambda: editor.export_edit(dial, [], "refused")):
                try:
                    fn()
                except ValueError as err:
                    assert words in str(err), err
                else:
                    raise AssertionError(f"{dial} was edited")
        assert not (root / "dials" / "refused.safetensors").exists()


def zero_checks():
    with tempfile.TemporaryDirectory(prefix="editor_zero_") as scratch:
        root = Path(scratch)
        setup(root, 0.1)
        write(root, "zero", torch.zeros(D, dtype=torch.float64))
        state = editor.editor_state("dials/zero.safetensors")
        json.dumps(state, allow_nan=False)
        assert state["vv"] == 0 and state["unexplained"] == 0 and all(x == 0 for x in state["direct"] + state["joint"])
        out = editor.export_edit("dials/zero.safetensors", [], "zero_copy")
        json.dumps(out, allow_nan=False)
        assert out["norm"] == 0 and out["cos_parent"] == 0 and out["unexplained"] == 0
        assert all(n["cos"] == 0 for n in out["neighbours"]), out["neighbours"]


if __name__ == "__main__":
    edit_math()
    pca_checks()
    export_checks()
    zero_checks()
    print("test_dial_editor: PASS")
