#!/usr/bin/env python3
"""Rack preset round-trip, changed/missing files, format and name validation (CPU, no model weights)."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

HERE = Path(__file__).resolve().parent
COMFY = os.environ.get("COMFYUI_ROOT") or str(HERE.parents[2])
sys.path.insert(0, COMFY)
import folder_paths

spec = importlib.util.spec_from_file_location("dial_presets", HERE.parent / "dials" / "presets.py")
presets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(presets)


def rejects(fn, *args, exception=ValueError):
    try:
        fn(*args)
    except exception:
        return
    raise AssertionError(f"{fn.__name__} accepted {args}")


def main():
    root = Path(tempfile.mkdtemp(prefix="B2_presets_"))
    folder_paths.add_model_folder_path("loras", str(root), is_default=True)
    (root / "dials").mkdir()
    dial = root / "dials" / "test.safetensors"
    dial.write_bytes(b"first dial contents")
    expected = hashlib.sha256(dial.read_bytes()).hexdigest()
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

    dial.write_bytes(b"changed dial contents")
    changed = presets.load_preset("test_-9")
    assert changed["preset"] == document, "load must preserve the expected hash and all rows"
    assert [w["reason"] for w in changed["warnings"]] == ["sha256 mismatch", "missing"]
    assert changed["warnings"][0]["actual"] == hashlib.sha256(dial.read_bytes()).hexdigest()
    dial.rename(dial.with_suffix(".parked"))
    missing = presets.load_preset("test_-9")
    assert missing["preset"] == document
    assert [w["reason"] for w in missing["warnings"]] == ["missing", "missing"]
    assert presets.list_presets() == ["test_-9"]
    rejects(presets.save_preset, "test_-9", [], exception=FileExistsError)
    assert json.loads(presets.preset_path("test_-9").read_text()) == document
    assert presets.save_preset("empty", [])["preset"]["rows"] == []
    assert presets.preset_path("a" * 80).name == "a" * 80 + ".json"
    for name in ("", "../escape", "/absolute", "a/b", "a\\b", ".", "a.json", "space name", "é", "a\n", "a" * 81):
        rejects(presets.save_preset, name, [])
        rejects(presets.load_preset, name)
    for row in (dict(input="dial_0"), dict(dial="../escape"), dict(dial="dials/../escape"),
                dict(dial="dials/x", strength=float("nan")), dict(dial="dials/x", strength=float("inf")),
                dict(dial="dials/x", solo="false"), dict(dial="dials/x", sha256="oops")):
        rejects(presets.save_preset, "invalid", [row])
    for i, value in enumerate((dict(format="other", version=1, rows=[]),
                               dict(format=presets.FORMAT, version=2, rows=[]),
                               dict(format=presets.FORMAT, version=True, rows=[]),
                               dict(format=presets.FORMAT, version=1, rows={}))):
        presets.preset_path(f"bad_{i}").write_text(json.dumps(value))
        rejects(presets.load_preset, f"bad_{i}")
    print("dial presets: all checks passed (round-trip, hash mismatch, missing rows, no overwrite, names, schema)")
    print(f"fixtures retained at {root}")


if __name__ == "__main__":
    main()
