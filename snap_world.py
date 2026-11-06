"""World records (U87): the writes of web/snap/world.js, done here so two pages saving one record can't drop each
other's version. One file per record, user snap/<kind>/<id>.json (snap/_archived/<kind>/ once archived), every version
inside; a version is appended, never edited. The hash is sha-256 of the body as canonical JSON (keys sorted).
SNAP-R60 world versions and pins · SNAP-R62 clean-up is the person's choice · SNAP-R18 local only · SNAP-R58 results are
never trimmed · SNAP-R96 a private take's record and media stay containers in the export unless the person
includes them decrypted · SNAP-R93/R94 instruction and skill records · SNAP-R95 imported ones land off · SNAP-R116 every
write is told to open pages, and /world/rev says when the files changed · see docs/snap/SNAP_RULES.md"""
import asyncio
import hashlib
import json
import os
import re
import time
import zipfile

import folder_paths
from aiohttp import web
from server import PromptServer

try:
    from . import snap_vault_server
except ImportError:  # no `cryptography`: snap_bridge refuses private takes on a privacy-on install, so none is sealed here
    snap_vault_server = None


def sealed(path):
    return snap_vault_server is not None and snap_vault_server.snap_vault.sealed(path)

routes = PromptServer.instance.routes
KINDS = ("cast", "card", "set_snapshot", "location", "instruction", "skill", "book", "story", "look")  # SNAP-R84 locations · SNAP-R93/R94 agent instructions, a person's skill versions · SNAP-R67 the Book
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


def told(kind, rid, by, client):
    """every open page hears of a write (F-D01: a page loaded before another writer saved a record never saw it): it reads
    the records again and says who wrote; the writing page knows its own client id and stays quiet"""
    PromptServer.instance.send_sync("snap_world", {"ref": f"{kind}:{rid}", "by": by, "client": client})


@routes.get("/mainodes/snap/world/rev")
async def rev(request):
    """a fingerprint of this person's record files and instruction marks (names, sizes, times), so a page can tell before
    a tool reads its records whether anything wrote them since it loaded, a script or a hand edit included"""
    um = PromptServer.instance.user_manager
    root = um.get_request_user_filepath(request, "snap", create_dir=False)
    h = hashlib.sha256()
    marks = os.path.join(root, "instructions.json")
    if os.path.isfile(marks):
        st = os.stat(marks)
        h.update(f"instructions.json:{st.st_size}:{st.st_mtime_ns};".encode())
    for d in [*KINDS, *(f"_archived/{k}" for k in KINDS)]:
        folder = os.path.join(root, d)
        for e in sorted(os.scandir(folder), key=lambda e: e.name) if os.path.isdir(folder) else []:
            if e.name.endswith(".json"):
                st = e.stat()
                h.update(f"{d}/{e.name}:{st.st_size}:{st.st_mtime_ns};".encode())
    return web.json_response({"rev": h.hexdigest()[:16]})


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
    if made:
        told(kind, rid, by, q.get("client"))
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
    told(kind, rid, q.get("by", "person"), q.get("client"))
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
    told(kind, rid, q.get("by", "person"), q.get("client"))
    return web.json_response({"record": r})


# ---- clean-up (U87 §4.5): sizes, export to a zip, import one back, delete; always the person's act ----------------
MEDIA = re.compile(r"\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|wav|flac|mp3|ogg|m4a)$", re.I)


def user_snap(request):
    return PromptServer.instance.user_manager.get_request_user_filepath(request, "snap", create_dir=False)


def inside(root, rel):
    path = os.path.abspath(os.path.join(root, rel))
    return path if os.path.commonpath((root, path)) == root else None


def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from strings(v)


def input_media(record):
    """input/ files a record names (reference pictures, plates), the ones that exist"""
    root = folder_paths.get_input_directory()
    found = {s for s in strings(record) if MEDIA.search(s)}
    return sorted(f for f in found if (p := inside(root, f)) and os.path.isfile(p))


def take_media(take):
    root = folder_paths.get_output_directory()
    out = []
    for m in take.get("media") or []:
        if m.get("type", "output") == "output" and (p := inside(root, os.path.join(m.get("subfolder", ""), m.get("filename", "")))) and os.path.isfile(p):
            out.append(os.path.relpath(p, root))
    return out


def records_of(snap):
    for kind in KINDS:
        for archived, d in ((False, os.path.join(snap, kind)), (True, os.path.join(snap, "_archived", kind))):
            if os.path.isdir(d):
                for f in sorted(os.listdir(d)):
                    if f.endswith(".json"):
                        path = os.path.join(d, f)
                        try:
                            r = read(path)
                        except (OSError, ValueError):
                            continue
                        if isinstance(r, dict) and r.get("versions") is not None:
                            yield path, r


def takes_of(snap):
    d, user = os.path.join(snap, "takes"), os.path.basename(os.path.dirname(snap))
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.endswith(".json"):
            p = os.path.join(d, f)
            try:
                yield p, snap_vault_server.record(p, user) if sealed(p) else read(p)
            except (OSError, ValueError):
                continue


def name_of(r):
    head = next((v for v in r["versions"] if v["n"] == r.get("head")), None)
    b = (head or {}).get("body") or {}
    snap = (b.get("brick") or {}).get("snapshot")
    return b.get("name") or (f"{snap.get('name')}, end of {snap.get('shot')}" if snap else None) or b.get("title") or r["id"]


def size(path):
    return os.path.getsize(path) if os.path.isfile(path) else 0


@routes.get("/mainodes/snap/sizes")
async def sizes(request):
    """every record with its versions, bytes (its file and the input/ media it names) and the takes that pin it; the takes'
    own bytes; the export zips there are. Nothing is left out (SNAP-R58)"""
    snap = user_snap(request)
    def find():
        takes = list(takes_of(snap))
        pins = {}
        for _, t in takes:
            for ref, p in ((t or {}).get("world") or {}).items():
                pins.setdefault(ref, []).append({"take": t["id"], "n": p.get("n")})
        iroot, oroot = folder_paths.get_input_directory(), folder_paths.get_output_directory()
        rows = []
        for path, r in records_of(snap):
            media = input_media(r)
            ref = f"{r['kind']}:{r['id']}"
            rows.append({"ref": ref, "kind": r["kind"], "id": r["id"], "name": name_of(r), "head": r.get("head"), "archived": r.get("archived"),
                         "versions": [{"n": v["n"], "at": v.get("at"), "by": v.get("by"), "note": v.get("note", ""), "listed": v.get("listed"), "pinned_by": [p["take"] for p in pins.get(ref, []) if p["n"] == v["n"]]} for v in r["versions"]],
                         "bytes": size(path), "media": media, "media_bytes": sum(size(os.path.join(iroot, m)) for m in media), "pinned_by": [p["take"] for p in pins.get(ref, [])]})
        tm = [(p, t, take_media(t or {})) for p, t in takes]
        exports = []
        for root, sub, typ in ((oroot, "snap_exports", "output"), (iroot, "snap_imports", "input")):
            d = os.path.join(root, sub)
            exports += [{"file": f, "subfolder": sub, "type": typ, "bytes": size(os.path.join(d, f))} for f in sorted(os.listdir(d)) if f.endswith(".zip")] if os.path.isdir(d) else []
        return {"records": rows, "takes": {"count": len(takes), "kept_encrypted": sum(1 for _, t in takes if (t or {}).get("kept_encrypted")), "bytes": sum(size(p) for p, _, _ in tm), "media_bytes": sum(size(os.path.join(oroot, m)) for _, _, ms in tm for m in ms)},
                "total_bytes": sum(x["bytes"] + x["media_bytes"] for x in rows), "exports": exports}
    return web.json_response(await asyncio.to_thread(find))


@routes.post("/mainodes/snap/world/export")
async def export(request):
    """a zip in output/snap_exports/: manifest.json, the records' files, the input/ media they name, and with with_takes
    the takes that pin them with their output media"""
    q = await request.json()
    refs, with_takes, decrypt = q.get("refs") or [], bool(q.get("with_takes")), bool(q.get("decrypt_private"))
    snap = user_snap(request)
    wanted = {tuple(r.split("@")[0].split(":", 1)) for r in refs}
    def make():
        found = [(p, r) for p, r in records_of(snap) if (r["kind"], r["id"]) in wanted]
        missing = sorted(f"{k}:{i}" for k, i in wanted - {(r["kind"], r["id"]) for _, r in found})
        if missing:
            raise web.HTTPNotFound(text=json.dumps({"error": f"No record {', '.join(missing)}"}), content_type="application/json")
        iroot, oroot = folder_paths.get_input_directory(), folder_paths.get_output_directory()
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out = os.path.join(oroot, "snap_exports", f"snap-world-{stamp}.zip")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        manifest = {"made": stamp, "records": [], "takes": [], "files": [], "kept_encrypted": []}
        user = os.path.basename(os.path.dirname(snap))

        def put(z, path, name, take):
            """A private take's files go in as their containers, or decrypted when the person asked and holds the key."""
            if not sealed(path):
                z.write(path, name)
            elif decrypt and not take.get("locked"):
                z.writestr(name, snap_vault_server.plain(path, user))
            else:
                z.write(path, name)
                manifest["kept_encrypted"].append(name)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for p, r in found:
                z.write(p, f"records/{r['kind']}/{r['id']}.json")
                manifest["records"].append({"ref": f"{r['kind']}:{r['id']}", "head": r.get("head"), "versions": [{"n": v["n"], "hash": v["hash"]} for v in r["versions"]]})
                for m in input_media(r):
                    if f"input/{m}" not in manifest["files"]:
                        z.write(os.path.join(iroot, m), f"media/input/{m}")
                        manifest["files"].append(f"input/{m}")
            if with_takes:
                refs_here = {f"{r['kind']}:{r['id']}" for _, r in found}
                for p, t in takes_of(snap):
                    if t and refs_here & set((t.get("world") or {}).keys()):
                        put(z, p, f"takes/{t['id']}.json", t)
                        manifest["takes"].append(t["id"])
                        for m in take_media(t):
                            put(z, os.path.join(oroot, m), f"media/output/{m}", t)
                            manifest["files"].append(f"output/{m}")
            z.writestr("manifest.json", json.dumps(manifest, indent=1))
        return {"file": os.path.basename(out), "subfolder": "snap_exports", "type": "output", "bytes": size(out), "manifest": manifest}
    return web.json_response(await asyncio.to_thread(make))


def landed_off(snap, refs, zipname):
    """SNAP-R95: an imported note or skill version is another person's text reaching this person's agents, so it lands
    off (snap/instructions.json, the person's marks) until they turn it on in the Agent library"""
    if not refs:
        return
    path = os.path.join(snap, "instructions.json")
    marks = read(path) or {}
    for r in refs:
        marks.setdefault("off", {})[r.split("@")[0]] = {"at": int(time.time() * 1000), "by": "import", "from": zipname}
    write(path, marks)


@routes.post("/mainodes/snap/world/import")
async def import_zip(request):
    """bring an export back (on this account or another install): records that aren't here are written whole; a record
    that is here gains the versions it lacks when their numbers come after its newest (else they are reported, never
    renumbered: takes pin numbers); media and takes are written only where nothing is"""
    q = await request.json()
    root = {"output": folder_paths.get_output_directory(), "input": folder_paths.get_input_directory()}.get(q.get("type", "output"))
    zpath = root and inside(root, os.path.join(q.get("subfolder", ""), q.get("file", "")))
    if not zpath or not os.path.isfile(zpath):
        return web.json_response({"error": f"No export {q.get('subfolder', '')}/{q.get('file', '')} in {q.get('type', 'output')}/"}, status=404)
    snap = user_snap(request)
    def bring():
        done = {"records": [], "merged": [], "conflicts": [], "files": [], "takes": [], "kept": []}
        dests = {"input": folder_paths.get_input_directory(), "output": folder_paths.get_output_directory()}
        with zipfile.ZipFile(zpath) as z:
            for name in z.namelist():
                parts = name.split("/")
                if name.endswith("/"):
                    continue
                if parts[0] == "records" and len(parts) == 3 and parts[1] in KINDS and ID.fullmatch(parts[2][:-5]):
                    rec = json.loads(z.read(name))
                    path = os.path.join(snap, parts[1], parts[2])
                    here = read(path) if os.path.exists(path) else read(os.path.join(snap, "_archived", parts[1], parts[2])) if os.path.exists(os.path.join(snap, "_archived", parts[1], parts[2])) else None
                    if here is None:
                        write(path, rec)
                        done["records"].append(f"{parts[1]}:{rec['id']}")
                        continue
                    have = {v["hash"] for v in here["versions"]}
                    top = max((v["n"] for v in here["versions"]), default=0)
                    for v in rec["versions"]:
                        if v["hash"] in have:
                            continue
                        if v["n"] > top:
                            here["versions"].append(v)
                            top = v["n"]
                            here["head"] = v["n"]
                            done["merged"].append(f"{parts[1]}:{rec['id']}@{v['n']}")
                        else:
                            done["conflicts"].append(f"{parts[1]}:{rec['id']}@{v['n']} (this record already has a different v{v['n']})")
                    write(path if os.path.exists(path) else os.path.join(snap, "_archived", parts[1], parts[2]), here)
                elif parts[0] == "takes" and len(parts) == 2 and ID.fullmatch(parts[1][:-5]):
                    path = os.path.join(snap, "takes", parts[1])
                    if os.path.exists(path):
                        done["kept"].append(f"takes/{parts[1]}")
                    else:
                        os.makedirs(os.path.dirname(path), exist_ok=True)
                        with open(path, "wb") as f:
                            f.write(z.read(name))
                        done["takes"].append(parts[1][:-5])
                elif parts[0] == "media" and len(parts) > 2 and parts[1] in dests:
                    dest = inside(dests[parts[1]], "/".join(parts[2:]))
                    if dest is None:
                        continue
                    if os.path.exists(dest):
                        done["kept"].append("/".join(parts[1:]))
                    else:
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with open(dest, "wb") as f:
                            f.write(z.read(name))
                        done["files"].append("/".join(parts[1:]))
        landed_off(snap, [r for r in done["records"] + done["merged"] if r.split(":")[0] in ("instruction", "skill")], os.path.basename(zpath))
        return done
    async with lock:
        return web.json_response(await asyncio.to_thread(bring))


@routes.post("/mainodes/snap/world/delete")
async def delete(request):
    """the person's delete (an agent's waits as a proposal in the page): one version (n), or the whole record file. The
    media it names stay in input/; takes that pinned it keep what it put in, so they still run as they were"""
    q = await request.json()
    kind, rid, n = q.get("kind"), q.get("id"), q.get("n")
    path, _ = where(request, kind, rid)
    async with lock:
        r = read(path)
        if r is None:
            return web.json_response({"error": f"No {kind} record {rid}"}, status=404)
        if n is None:
            os.remove(path)
            told(kind, rid, q.get("by", "person"), q.get("client"))
            return web.json_response({"deleted": f"{kind}:{rid}", "record": None})
        if not any(v["n"] == n for v in r["versions"]):
            return web.json_response({"error": f"{kind}:{rid} has no version {n}"}, status=404)
        r["versions"] = [v for v in r["versions"] if v["n"] != n]
        if not r["versions"] and not r.get("draft"):
            os.remove(path)
            told(kind, rid, q.get("by", "person"), q.get("client"))
            return web.json_response({"deleted": f"{kind}:{rid}", "record": None})
        if r["head"] == n:
            r["head"] = max((v["n"] for v in r["versions"]), default=0)
        r["updated"] = int(time.time() * 1000)
        write(path, r)
    told(kind, rid, q.get("by", "person"), q.get("client"))
    return web.json_response({"deleted": f"{kind}:{rid}@{n}", "record": r})
