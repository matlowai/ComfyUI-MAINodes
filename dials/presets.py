"""Versioned rack presets: file references and settings, never dial weights."""
import json
import math
import re
from pathlib import Path

from safetensors import safe_open

import folder_paths

from . import core, envelopes, timecurve

FORMAT = "MAIDialRack preset"
VERSION = 1


def preset_dir():
    return Path(folder_paths.get_folder_paths("loras")[0]) / "dials" / "presets"


def preset_path(name):
    if not core.NAME.fullmatch(name):
        raise ValueError("preset name: letters, digits, '_' and '-' only (max 80)")
    return preset_dir() / f"{name}.json"


def list_presets():
    root = preset_dir()
    return sorted(p.stem for p in root.glob("*.json") if core.NAME.fullmatch(p.stem))


def preset_rows(rows):
    if not isinstance(rows, list):
        raise ValueError("preset rows must be a list")
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("each preset row must be an object")
        if "input" in row:
            raise ValueError("Presets use saved dial files. Save connected dials and choose their files first.")
        dial = row.get("dial", "").replace("\\", "/")
        if not dial.startswith("dials/") or any(p in ("", ".", "..") for p in dial.split("/")):
            raise ValueError("preset rows must name a file inside dials/")
        strength = row.get("strength", 0)
        if isinstance(strength, bool) or not isinstance(strength, (int, float)) or not math.isfinite(strength):
            raise ValueError("preset strength must be a finite number")
        on, solo = row.get("on", True), row.get("solo", False)
        if not isinstance(on, bool) or not isinstance(solo, bool):
            raise ValueError("preset on and solo must be booleans")
        sha = row.get("sha256")
        if sha is not None and (not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha)):
            raise ValueError("preset sha256 must be a lowercase SHA-256 hash or null")
        result.append(dict(dial=dial, sha256=sha, strength=strength, on=on, solo=solo))
        if "hold" in row:
            if not isinstance(row["hold"], bool):
                raise ValueError("preset hold must be a boolean")
            result[-1]["hold"] = row["hold"]
        if "envelope" in row:
            if row.get("hold"):
                raise ValueError("a hold row cannot have a step envelope")
            try:
                envelopes.envelope_points(row["envelope"])
            except (KeyError, TypeError) as e:
                raise ValueError(f"invalid preset envelope: {row['envelope']!r}") from e
            result[-1]["envelope"] = row["envelope"]
        if "blocks" in row:
            w = row["blocks"]
            if not isinstance(w, list) or not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in w):
                raise ValueError("preset blocks must be a list of finite numbers")
            result[-1]["blocks"] = w
        if "time" in row:
            try:
                timecurve.check_spec(row["time"])
            except (KeyError, TypeError, AttributeError) as e:
                raise ValueError(f"invalid preset time curve: {row['time']!r}") from e
            result[-1]["time"] = row["time"]
    return result


def dial_sha256(dial):
    """Hash of the dial file's tensors only, so editing a dial's info metadata does not invalidate presets."""
    path = folder_paths.get_full_path("loras", dial)
    if path is None:
        return None
    with safe_open(path, "pt") as f:
        return core.tensors_sha256({k: f.get_tensor(k) for k in f.keys()})


def check_rows(rows):
    warnings = []
    for i, row in enumerate(rows):
        actual = dial_sha256(row["dial"])
        reason = "missing" if actual is None else "sha256 mismatch" if row["sha256"] != actual else None
        if reason:
            warnings.append(dict(row=i, dial=row["dial"], reason=reason, expected=row["sha256"], actual=actual))
    return warnings


def save_preset(name, rows):
    path = preset_path(name)
    rows = preset_rows(rows)
    for row in rows:
        actual = dial_sha256(row["dial"])
        if actual is not None:
            row["sha256"] = actual
    preset = dict(format=FORMAT, version=VERSION, rows=rows)
    payload = json.dumps(preset, indent=2, allow_nan=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as f:
        f.write(payload)
    return dict(preset=preset, warnings=check_rows(rows))


def load_preset(name):
    with preset_path(name).open(encoding="utf-8") as f:
        preset = json.load(f)
    if not isinstance(preset, dict) or preset.get("format") != FORMAT or type(preset.get("version")) is not int or preset["version"] != VERSION:
        raise ValueError("unsupported rack preset format or version (expected MAIDialRack preset v1)")
    rows = preset_rows(preset.get("rows"))
    return dict(preset=dict(format=FORMAT, version=VERSION, rows=rows), warnings=check_rows(rows))
