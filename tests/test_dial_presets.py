#!/usr/bin/env python3
"""Rack preset round-trip, changed/missing files, format and name validation (CPU, no model weights)."""
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
presets = importlib.import_module("mai_dials.presets")


def rejects(fn, *args, exception=ValueError):
    try:
        fn(*args)
    except exception:
        return
    raise AssertionError(f"{fn.__name__} accepted {args}")


def main():
    scratch = tempfile.TemporaryDirectory(prefix="B2_presets_")
    root = Path(scratch.name)
    folder_paths.add_model_folder_path("loras", str(root), is_default=True)
    (root / "dials").mkdir()
    dial = root / "dials" / "test.safetensors"
    save_file({"diffusion_model.token_refiner.dials_shift": torch.ones(8)}, str(dial))
    expected = presets.dial_sha256("dials/test.safetensors")
    core = importlib.import_module("mai_dials.core")
    core.save_dial_info("dials/test.safetensors", {"description": "an edited description", "useful": 2, "overcook": 3})
    assert presets.dial_sha256("dials/test.safetensors") == expected, "editing dial info must not change the preset hash"
    assert core.dial_info("dials/test.safetensors")["pos"]["useful"] == 2.0
    for bad in ({"useful": 0}, {"useful": 3, "overcook": 2}, {"useful": True}, {"description": "x" * 2001}, {"negative": 5}, [], {"overcook": 21}):
        rejects(core.check_dial_info, bad)
    rejects(core.save_dial_info, "../../etc/passwd", {}, exception=FileNotFoundError)
    plain = root / "dials" / "plain.safetensors"
    save_file({"diffusion_model.token_refiner.dials_shift": torch.ones(8)}, str(plain))
    assert core.dial_info("dials/plain.safetensors") == core.check_dial_info(core.INFO_DEFAULTS), "a dial without info reads as the defaults"
    rows = [dict(dial="dials/test.safetensors", strength=-0.5, on=True, solo=True),
            dict(dial="dials/missing.safetensors", strength=2, on=False, solo=False, sha256="a" * 64)]
    saved = presets.save_preset("test_-9", rows)
    loaded = presets.load_preset("test_-9")
    assert saved == loaded
    assert loaded["preset"]["rows"][0]["sha256"] == expected
    assert loaded["preset"]["rows"][1] == rows[1]
    assert loaded["warnings"] == [dict(row=1, dial=rows[1]["dial"], reason="missing", expected="a" * 64, actual=None)]
    document = json.loads(presets.preset_path("test_-9").read_text())
    assert set(document) == {"format", "version", "rows"}
    assert document["format"] == "MAIDialRack preset" and document["version"] == 1
    assert all(set(row) == {"dial", "sha256", "strength", "on", "solo"} for row in document["rows"])
    assert "sha256" not in rows[0], "save mutated caller rows"
    held_rows = [dict(rows[0], hold=True, strength=0), dict(rows[1], hold=False)]
    held = presets.save_preset("holds", held_rows)
    assert presets.load_preset("holds") == held
    assert [r["hold"] for r in held["preset"]["rows"]] == [True, False]
    assert held["preset"]["rows"][0]["strength"] == 0
    shaped_rows = [dict(rows[0], envelope="early"),
                   dict(rows[1], envelope={"type": "manual", "points": [[0, 0], [0.5, 1], [1, 0]]})]
    shaped = presets.save_preset("envelopes", shaped_rows)
    assert presets.load_preset("envelopes") == shaped
    assert [r["envelope"] for r in shaped["preset"]["rows"]] == [r["envelope"] for r in shaped_rows]

    save_file({"diffusion_model.token_refiner.dials_shift": torch.zeros(8)}, str(dial))
    changed = presets.load_preset("test_-9")
    assert changed["preset"] == document, "load must preserve the expected hash and all rows"
    assert [w["reason"] for w in changed["warnings"]] == ["sha256 mismatch", "missing"]
    assert changed["warnings"][0]["actual"] == presets.dial_sha256("dials/test.safetensors") != expected
    dial.rename(dial.with_suffix(".parked"))
    missing = presets.load_preset("test_-9")
    assert missing["preset"] == document
    assert [w["reason"] for w in missing["warnings"]] == ["missing", "missing"]
    assert presets.list_presets() == ["envelopes", "holds", "test_-9"]
    rejects(presets.save_preset, "test_-9", [], exception=FileExistsError)
    assert json.loads(presets.preset_path("test_-9").read_text()) == document
    assert presets.save_preset("empty", [])["preset"]["rows"] == []
    assert presets.preset_path("a" * 80).name == "a" * 80 + ".json"
    for name in ("", "../escape", "/absolute", "a/b", "a\\b", ".", "a.json", "space name", "é", "a\n", "a" * 81):
        rejects(presets.save_preset, name, [])
        rejects(presets.load_preset, name)
    for row in (dict(input="dial_0"), dict(dial="../escape"), dict(dial="dials/../escape"),
                dict(dial="dials/x", strength=float("nan")), dict(dial="dials/x", strength=float("inf")),
                dict(dial="dials/x", solo="false"), dict(dial="dials/x", hold="false"), dict(dial="dials/x", sha256="oops")):
        rejects(presets.save_preset, "invalid", [row])
    for i, value in enumerate((dict(format="other", version=1, rows=[]),
                               dict(format=presets.FORMAT, version=2, rows=[]),
                               dict(format=presets.FORMAT, version=True, rows=[]),
                               dict(format=presets.FORMAT, version=1, rows={}))):
        presets.preset_path(f"bad_{i}").write_text(json.dumps(value))
        rejects(presets.load_preset, f"bad_{i}")
    print("dial presets: all checks passed (round-trip, hash mismatch, missing rows, no overwrite, names, schema)")
    for bad in ({"type": "wobble"}, {"type": "manual", "points": [[0.5, 1], [0.2, 0]]}, {}, 7):
        rejects(presets.preset_rows, [dict(dial="dials/x.safetensors", strength=1, envelope=bad)])
    rejects(presets.preset_rows, [dict(dial="dials/x.safetensors", strength=1, hold=True, envelope="early")])
    scratch.cleanup()


if __name__ == "__main__":
    main()
