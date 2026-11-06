"""Agent instructions and skills (U103/U104): the pack's notes (snap_cards/pack_notes.json, version 0 of the pack layer),
the notes an admin shared on a gated install (the install layer, read from the admins' own snap/instruction/ records the
way ratings read their model graphs), and the pack's skills (.claude/skills/<name>/SKILL.md, the files Claude Code
loads), served whole. A person's own notes and their versions of skills are world records (snap_world.py); the page
resolves the stack (web/snap/instructions.js).
SNAP-R93 layered instructions · SNAP-R94 skills are pack files a person's version sits over · SNAP-R32 only the admins'
files count install-wide · SNAP-R58 results are never trimmed · SNAP-R18 local only · see docs/SNAP_RULES.md"""
import hashlib
import json
import os
import re
from pathlib import Path

import folder_paths
import yaml
from aiohttp import web
from server import PromptServer

from . import snap_privacy

routes = PromptServer.instance.routes
PACK = Path(__file__).parent
NOTES = PACK / "snap_cards" / "pack_notes.json"
SKILLS = PACK / ".claude" / "skills"
NAME = re.compile(r"[a-z0-9][a-z0-9-]*")


def pack_notes():
    return json.loads(NOTES.read_text(encoding="utf-8"))["notes"]


def tail(name):
    """the pack's notes for one tool, as the line its description ends with (SNAP-R93); empty when it has none"""
    lines = [n["text"] if n["kind"] == "note" else f"{n['job']}: {n['choice']} ({n['why']})" for n in pack_notes() if n["scope"] == f"tool:{name}"]
    return f"\n\nPack notes (SNAP-R93): {' • '.join(lines)}. The person's resolved stack (instructions, or describe_recipe.instructions) adds to these and wins, notes they turned off included." if lines else ""


def front(text):
    """a SKILL.md's front matter (name, description, scope, rules) and its body"""
    m = re.match(r"(?s)^---\n(.*?)\n---\n(.*)$", text)
    return (yaml.safe_load(m.group(1)) or {}, m.group(2)) if m else ({}, text)


def skill_list():
    out = []
    for d in sorted(SKILLS.iterdir()) if SKILLS.is_dir() else []:
        f = d / "SKILL.md"
        if not f.is_file():
            continue
        raw = f.read_bytes()
        meta, _ = front(raw.decode("utf-8"))
        out.append({"name": d.name, "description": " ".join(str(meta.get("description", "")).split()), "scope": meta.get("scope") or [], "rules": meta.get("rules") or [],
                    "file": f".claude/skills/{d.name}/SKILL.md", "bytes": len(raw), "hash": hashlib.sha256(raw).hexdigest(),
                    "files": sorted(p.name for p in d.iterdir() if p.is_file() and p.name != "SKILL.md")})
    return out


@routes.get("/mainodes/snap/skills")
async def skills(request):
    """every pack skill (name, description, scope, rules, bytes, hash, the files beside it), or with ?name= one skill's
    whole text (?file= a file beside it); nothing is cut"""
    name, file = request.query.get("name"), request.query.get("file", "SKILL.md")
    if name is None:
        return web.json_response({"folder": ".claude/skills", "skills": skill_list()})
    names = [s["name"] for s in skill_list()]
    if not NAME.fullmatch(name) or name not in names:
        return web.json_response({"error": f"No skill {name!r}; the skills are {', '.join(names)}"}, status=404)
    path = (SKILLS / name / file).resolve()
    if path.parent != (SKILLS / name).resolve() or not path.is_file():
        return web.json_response({"error": f"{name} has no file {file!r}; it has SKILL.md{''.join(', ' + p.name for p in sorted((SKILLS / name).iterdir()) if p.name != 'SKILL.md')}"}, status=404)
    raw = path.read_bytes()
    return web.json_response({"name": name, "file": file, "text": raw.decode("utf-8"), "bytes": len(raw), "hash": hashlib.sha256(raw).hexdigest()})


def shared(request):
    """the install layer: on a gated install, every admin's instruction and skill records whose newest version is shared,
    except the caller's own (those are already the caller's person layer)"""
    user_dir = folder_paths.get_user_directory()
    admins = snap_privacy.owners(user_dir, [])
    if not admins:
        return []
    me = PromptServer.instance.user_manager.get_request_user_id(request)
    out = []
    for admin in sorted(admins - {me}):
        for kind in ("instruction", "skill"):
            d = Path(user_dir) / admin / "snap" / kind
            for f in sorted(d.glob("*.json")) if d.is_dir() else []:
                try:
                    r = json.loads(f.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                head = next((v for v in r.get("versions", []) if v["n"] == r.get("head")), None)
                if head and head["body"].get("shared") and not r.get("archived"):
                    out.append({"ref": f"install:{admin}/{r['id']}@{head['n']}", "kind": kind, "admin": admin, "id": r["id"], "n": head["n"], "at": head.get("at"), "by": head.get("by"), "body": head["body"]})
    return out


@routes.get("/mainodes/snap/pack_notes")
async def notes(request):
    """the pack layer (every note in snap_cards/pack_notes.json) and the install layer (admins' shared notes and skills)"""
    return web.json_response({"notes": pack_notes(), "install": shared(request)})


def info():
    """what /mainodes/snap/info adds: where the docs are and every skill (U104), so an agent finds them with no page open"""
    return {"docs": {"agent_start": str(PACK / "docs" / "AGENT_START.md"), "rules": str(PACK / "docs" / "SNAP_RULES.md"), "agents": str(PACK / "AGENTS.md"), "skills_folder": str(SKILLS)},
            "skills": [{k: s[k] for k in ("name", "description", "file", "bytes")} for s in skill_list()], "skills_url": "/mainodes/snap/skills",
            "skill_read": "GET /mainodes/snap/skills?name=<name> returns one skill whole (&file=<name> a file beside its SKILL.md); with a page open, read_skill {\"name\"} gives the person's version"}
