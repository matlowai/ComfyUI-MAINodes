"""Versioned rack presets: file references and settings, never dial weights."""
import asyncio
import hashlib
import json
import math
import re
from pathlib import Path

import folder_paths

FORMAT = "MAIDialRack preset"
VERSION = 1


def preset_path(name):
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", name):
        raise ValueError("preset name: letters, digits, '_' and '-' only (max 80)")
    return Path(folder_paths.get_folder_paths("loras")[0]) / "dials" / "presets" / f"{name}.json"


def list_presets():
    root = preset_path("unused").parent
    return sorted(p.stem for p in root.glob("*.json") if re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", p.stem))


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
    return result


def dial_sha256(dial):
    path = folder_paths.get_full_path("loras", dial)
    if path is None:
        return None
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


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


def install_routes():
    from aiohttp import web
    from server import PromptServer

    srv = getattr(PromptServer, "instance", None)
    if srv is None or getattr(srv, "_mai_dial_preset_routes", False):
        return

    @srv.routes.get("/mainodes/dials/presets")
    async def listing(request):
        return web.json_response(await asyncio.to_thread(list_presets))

    async def respond(fn, *args):
        try:
            return web.json_response(await asyncio.to_thread(fn, *args))
        except FileExistsError:
            return web.json_response({"error": "Preset already exists. Choose a new name."}, status=409)
        except FileNotFoundError:
            return web.json_response({"error": "Preset not found."}, status=404)
        except (ValueError, TypeError, AttributeError) as e:
            return web.json_response({"error": str(e)}, status=400)

    @srv.routes.get("/mainodes/dials/presets/{name}")
    async def load(request):
        return await respond(load_preset, request.match_info["name"])

    @srv.routes.post("/mainodes/dials/presets/{name}")
    async def save(request):
        try:
            rows = await request.json()
        except ValueError:
            return web.json_response({"error": "Expected rack rows as JSON."}, status=400)
        return await respond(save_preset, request.match_info["name"], rows)

    srv._mai_dial_preset_routes = True
