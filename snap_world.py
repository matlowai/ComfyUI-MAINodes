"""World records (U87): the writes of web/snap/world.js, done here so two pages saving one record can't drop each
other's version. One file per record, user snap/<kind>/<id>.json (snap/_archived/<kind>/ once archived), every version
inside; a version is appended, never edited. The hash is sha-256 of the body as canonical JSON (keys sorted).
SNAP-R60 world versions and pins · SNAP-R18 local only · SNAP-R58 results are never trimmed · see docs/SNAP_RULES.md"""
import asyncio
import hashlib
import json
import os
import re
import time

from aiohttp import web
from server import PromptServer

routes = PromptServer.instance.routes
KINDS = ("cast", "card", "set_snapshot")
FIELDS = ("draft", "plates")  # a set's working copy and its camera plates live beside the versions
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
lock = asyncio.Lock()


def digest(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def where(request, kind, rid):
    """the record's file (the archived one when only that exists) and the other place it could be"""
    if kind not in KINDS:
        raise web.HTTPBadRequest(text=json.dumps({"error": f"No record kind {kind!r}; the kinds are {', '.join(KINDS)}"}), content_type="application/json")
    if not isinstance(rid, str) or not ID.fullmatch(rid):
        raise web.HTTPBadRequest(text=json.dumps({"error": f"A record id is letters, digits, '.', '_' and '-' (got {rid!r})"}), content_type="application/json")
    um = PromptServer.instance.user_manager
    live, parked = (um.get_request_user_filepath(request, f"snap/{d}/{rid}.json", create_dir=False) for d in (kind, f"_archived/{kind}"))
    return (parked, live) if os.path.exists(parked) and not os.path.exists(live) else (live, parked)


def read(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write(path, record):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False)
    os.replace(tmp, path)


def fresh(kind, rid, by):
    return {"id": rid, "kind": kind, "created": int(time.time() * 1000), "by": by, "head": 0, "archived": None, "versions": []}


@routes.post("/mainodes/snap/world/save")
async def save(request):
    """append a version unless the head already holds this body (if_absent: unless any version does); returns the record"""
    q = await request.json()
    kind, rid, body, by = q.get("kind"), q.get("id"), q.get("body"), q.get("by", "person")
    if not isinstance(body, dict):
        return web.json_response({"error": "body is the record's content, an object"}, status=400)
    path, _ = where(request, kind, rid)
    h = digest(body)
    async with lock:
        r = read(path) or fresh(kind, rid, by)
        same = next((v for v in r["versions"] if v["hash"] == h), None) if q.get("if_absent") else next((v for v in r["versions"] if v["n"] == r["head"] and v["hash"] == h), None)
        if same is None:
            same = {"n": (r["versions"][-1]["n"] if r["versions"] else 0) + 1, "hash": h, "at": int(q.get("at") or time.time() * 1000), "by": by, "note": q.get("note", ""),
                    **({"listed": bool(q["listed"])} if q.get("listed") is not None else {}), "body": body}
            r["versions"].append(same)
            r["head"] = same["n"]
            made = True
        else:
            made = False
        r["updated"] = int(time.time() * 1000)
        if made:
            write(path, r)
    return web.json_response({"ref": f"{kind}:{rid}@{same['n']}", "made": made, "n": same["n"], "record": r})


@routes.post("/mainodes/snap/world/fields")
async def fields(request):
    """set a record's fields outside its versions (draft, plates); null clears one"""
    q = await request.json()
    kind, rid, patch = q.get("kind"), q.get("id"), q.get("fields") or {}
    wrong = [k for k in patch if k not in FIELDS]
    if wrong:
        return web.json_response({"error": f"fields takes {', '.join(FIELDS)}, not {', '.join(wrong)}"}, status=400)
    path, _ = where(request, kind, rid)
    async with lock:
        r = read(path) or fresh(kind, rid, q.get("by", "person"))
        for k, v in patch.items():
            if v is None:
                r.pop(k, None)
            else:
                r[k] = v
        r["updated"] = int(time.time() * 1000)
        write(path, r)
    return web.json_response({"record": r})


@routes.post("/mainodes/snap/world/archive")
async def archive(request):
    """archived: true moves the file to snap/_archived/<kind>/, false moves it back; the record keeps resolving either way"""
    q = await request.json()
    kind, rid, to = q.get("kind"), q.get("id"), bool(q.get("archived"))
    path, other = where(request, kind, rid)
    async with lock:
        r = read(path)
        if r is None:
            return web.json_response({"error": f"No {kind} record {rid}"}, status=404)
        if bool(r.get("archived")) != to:
            r["archived"] = time.strftime("%Y-%m-%dT%H:%M:%S") if to else None
            os.makedirs(os.path.dirname(other), exist_ok=True)
            os.replace(path, other)  # a move: the record goes whole to the other place
            write(other, r)
    return web.json_response({"record": r})
