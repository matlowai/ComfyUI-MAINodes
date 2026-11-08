"""The critic's docket (U93): critique rows, one file each in the person's snap/critiques/<id>.json, written here so two
pages or two agents can't claim, write or make one row twice. Snap only keeps the rows; an agent claims one, reads its
packet (web/snap/critiques.js) and writes the verdict back. Nothing here calls a model (SNAP-R18).
A row is made once per subject key (take:<id>, record:<ref>:<part>, pair:<a>|<b>); `again` makes a new one. A claim is
one agent's until it writes, skips or lets go, or for CLAIM_S after its last touch. A critique of a private take keeps its
notes' words on the take, which the vault seals, never here (SNAP-R98: no plaintext of a private take on disk).
"Add as fixture" copies a picture into the person's fixtures folder (SNAP_CRITIC_FIXTURES, else user snap/critic_fixtures)
and appends to its fixtures.local.json; a sealed picture is refused (privacy fails closed).
SNAP-R101 the critic is a docket job · SNAP-R103 notes: severity, pass, region, owner, fix · SNAP-R157 an author amends its
own written row as a new row that supersedes it · SNAP-R108 a miss is one press
from a fixture · SNAP-R146 a live claim keeps its agent's page hold · SNAP-R18 local only · SNAP-R58 nothing trimmed · see
docs/snap/SNAP_RULES.md"""
import asyncio
import json
import os
import re
import secrets
import shutil
import time

import folder_paths
from aiohttp import web
from server import PromptServer

try:
    from . import snap_vault_server
except ImportError:  # no `cryptography`: nothing is sealed on this install
    snap_vault_server = None

routes = PromptServer.instance.routes
HERE = os.path.dirname(os.path.abspath(__file__))
DIR = "snap/critiques"
CLAIM_S = 1800
VERDICTS = ("clean", "flaws")
SEVERITIES = ("high", "medium", "low")
PASSES = ("scan", "map", "support", "cast", "beat", "cross_view", "cut_pair", "scale", "count", "sound")  # F-Q23: scale anchors against each other, eye heights against them; SNAP-R245 count, SNAP-R249 sound
SUBJECTS = ("take", "candidate", "record", "pair")
ID = re.compile(r"crit-[a-z0-9-]+")
lock = asyncio.Lock()


def now_ms():
    return int(time.time() * 1000)


def bad(text, status=400):
    return web.json_response({"error": text}, status=status)


def folder(request):
    path = PromptServer.instance.user_manager.get_request_user_filepath(request, DIR, create_dir=True)
    os.makedirs(path, exist_ok=True)
    return path


def sealed(path):
    return snap_vault_server is not None and os.path.exists(path) and snap_vault_server.snap_vault.sealed(path)


def private_take(request, take):
    """whether a take's record is sealed by the vault (its words then stay on it)"""
    if not take or not re.fullmatch(r"[A-Za-z0-9._-]+", take):
        return False
    path = PromptServer.instance.user_manager.get_request_user_filepath(request, f"snap/takes/{take}.json", create_dir=False)
    return bool(path) and sealed(path)


def read_all(root):
    rows = []
    for name in sorted(os.listdir(root)):
        if name.endswith(".json") and ID.fullmatch(name[:-5]):
            with open(os.path.join(root, name), encoding="utf-8") as f:
                rows.append(json.load(f))
    return sorted(rows, key=lambda r: r["created"])


def write(root, row):
    # strictly later than the row's last write: a claim, update and write in one millisecond read as three versions, so
    # a page merging by `updated` keeps the newest (F-G10 under a fast gate)
    row["updated"] = max(now_ms(), row.get("updated", 0) + 1)
    path = os.path.join(root, f"{row['id']}.json")
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(row, f, ensure_ascii=False)
    os.replace(tmp, path)
    PromptServer.instance.send_sync("mainodes-snap-critique", {"id": row["id"], "state": state(row)})
    return row


def state(row):
    return "skipped" if row.get("skipped") else "done" if row.get("done") else "claimed" if held(row) else "due"


def held(row):
    c = row.get("claimed")
    return bool(c) and not row.get("done") and not row.get("skipped") and now_ms() - c["touched"] < CLAIM_S * 1000


def holders(request):
    """the agents holding a live claim, each with its row: the bridge keeps such an agent's page hold (F-G05, SNAP-R146)"""
    return {r["claimed"]["by"].removeprefix("agent:"): r for r in read_all(folder(request)) if held(r)}


def find(root, rid):
    if not isinstance(rid, str) or not ID.fullmatch(rid):
        raise web.HTTPBadRequest(text=json.dumps({"error": f"critique is an id like crit-…, from list_critiques; not {rid!r}"}), content_type="application/json")
    path = os.path.join(root, f"{rid}.json")
    if not os.path.exists(path):
        raise web.HTTPNotFound(text=json.dumps({"error": f"No critique {rid} (list_critiques lists them)"}), content_type="application/json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def since(root):
    """when this person's critic started: takes that landed before it have no rows (no backlog of old work)"""
    path = os.path.join(root, "_since.json")
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"since": now_ms()}, f)
    with open(path, encoding="utf-8") as f:
        return json.load(f)["since"]


@routes.get("/mainodes/snap/critiques")
async def critiques(request):
    root = folder(request)
    async with lock:
        return web.json_response({"rows": read_all(root), "since": since(root), "claim_s": CLAIM_S, "now": now_ms()})


@routes.get("/mainodes/snap/critic")
async def critic(request):
    with open(os.path.join(HERE, "snap_cards", "critic.json"), encoding="utf-8") as f:
        table = json.load(f)
    root = fixtures_root(request)
    local = os.path.join(root, "fixtures.local.json")
    return web.json_response({**table, "fixtures": {"root": root, "local": local, "added": len(json.load(open(local, encoding="utf-8"))["fixtures"]) if os.path.exists(local) else 0}})


@routes.post("/mainodes/snap/critique/due")
async def due(request):
    """one row per subject key; again: true makes a new one beside it (asked again)"""
    q = await request.json()
    s = q.get("subject") or {}
    if s.get("kind") not in SUBJECTS:
        return bad(f"subject.kind is one of {', '.join(SUBJECTS)}; not {s.get('kind')!r}")
    if not isinstance(q.get("key"), str) or not q["key"] or not isinstance(q.get("title"), str) or not q["title"].strip():
        return bad("a critique row needs its subject key and a title (the question, in the person's words)")
    root = folder(request)
    async with lock:
        rows = read_all(root)
        was = next((r for r in reversed(rows) if r["key"] == q["key"]), None)
        if was and not q.get("again"):
            return web.json_response({"critique": was, "made": False})
        row = {"id": f"crit-{now_ms():x}-{secrets.token_hex(2)}", "key": q["key"], "subject": s, "title": q["title"].strip(), "purpose": q.get("purpose"), "checklist": q.get("checklist") or "still",
               "trigger": q.get("trigger") or "asked", "about": q.get("about") or {}, "by": q.get("by") or "snap", "created": now_ms(), "claimed": None, "done": None, "skipped": None,
               "packet": None, "verdict": None, "passes": {}, "notes": [], **({"context": q["context"]} if q.get("context") else {}), **({"replaces": was["id"]} if was else {})}
        return web.json_response({"critique": write(root, row), "made": True})


@routes.post("/mainodes/snap/critique/claim")
async def claim(request):
    q = await request.json()
    by = q.get("by")
    if not isinstance(by, str) or not by:
        return bad("claim needs by (the agent's name, agent:<name>)")
    root = folder(request)
    async with lock:
        row = find(root, q.get("id"))
        if row.get("done") or row.get("skipped"):
            return bad(f"{row['title']} was already {'written' if row.get('done') else 'skipped'} by {(row.get('done') or row.get('skipped'))['by']}: ask for it again (critique {{again: true}}) to read it anew", 409)
        c = row.get("claimed")
        if q.get("release"):
            if c and c["by"] == by:
                row["claimed"] = None
                write(root, row)
            return web.json_response({"critique": row, "released": True})
        if held(row) and c["by"] != by:
            return bad(f"{row['title']} is claimed by {c['by']} since {time.strftime('%H:%M:%S', time.localtime(c['at'] / 1000))}: pick another due row (list_critiques {{state: \"due\"}}); a claim nobody touches lapses after {CLAIM_S // 60} min", 409)
        took_over = c["by"] if c and c["by"] != by else None
        row["claimed"] = {"by": by, "at": c["at"] if c and not took_over else now_ms(), "touched": now_ms(), **({"took_over_from": took_over} if took_over else {})}
        return web.json_response({"critique": write(root, row), "mine": True})


def clean_note(n, i):
    if not isinstance(n, dict):
        raise ValueError(f"notes[{i}] is an object {{severity, pass, text, region, owner, fix}}")
    if n.get("severity") not in SEVERITIES:
        raise ValueError(f"notes[{i}].severity is one of {', '.join(SEVERITIES)}; not {n.get('severity')!r}")
    if n.get("pass") not in PASSES:
        raise ValueError(f"notes[{i}].pass is one of {', '.join(PASSES)}; not {n.get('pass')!r}")
    if not isinstance(n.get("text"), str) or not n["text"].strip():
        raise ValueError(f"notes[{i}].text says the flaw in a sentence")
    r = n.get("region")
    if r is not None and not (isinstance(r, list) and len(r) == 4 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in r)):
        raise ValueError(f"notes[{i}].region is [x, y, w, h] in fractions of the subject picture (0 to 1); not {r!r}")
    return n


@routes.post("/mainodes/snap/critique/write")
async def write_critique(request):
    q = await request.json()
    by = q.get("by")
    if q.get("verdict") not in VERDICTS:
        return bad(f"verdict is one of {', '.join(VERDICTS)}; not {q.get('verdict')!r}")
    try:
        notes = [clean_note(n, i) for i, n in enumerate(q.get("notes") or [])]
    except ValueError as e:
        return bad(str(e))
    passes = q.get("passes") or {}
    wrong = [k for k in passes if k not in PASSES]
    if wrong:
        return bad(f"passes takes {', '.join(PASSES)} (one line each of what the pass found); not {', '.join(wrong)}")
    root = folder(request)
    async with lock:
        row = find(root, q.get("id"))
        c = row.get("claimed")
        if row.get("done") and q.get("amend"):
            # F-K10 (SNAP-R157): the author of a written row amends it as a new row that supersedes it; the old one stays
            if row["done"]["by"] != by:
                return bad(f"{row['title']} was written by {row['done']['by']}: only its author amends it; you can ask for it again (critique {{again: true}})", 409)
            if row.get("superseded_by"):
                return bad(f"{row['id']} was already amended by {row['superseded_by']}: amend that one", 409)
            old = row
            row = {**{k: old[k] for k in ("key", "subject", "title", "purpose", "checklist", "trigger", "about", "by", "packet") if k in old}, **({"context": old["context"]} if old.get("context") else {}),
                   "id": f"crit-{now_ms():x}-{secrets.token_hex(2)}", "created": now_ms(), "claimed": None, "done": None, "skipped": None, "verdict": None, "passes": {}, "notes": [], "supersedes": old["id"]}
            old["superseded_by"] = row["id"]
            write(root, old)
            c = None
        elif row.get("done"):
            return bad(f"{row['title']} was already written by {row['done']['by']}: its author can amend it (write_critique {{critique, amend: true, ...}}: a new row that supersedes it), or ask for it again (critique {{again: true}})", 409)
        if held(row) and c["by"] != by:
            return bad(f"{row['title']} is claimed by {c['by']}: only the claimer writes it", 409)
        secret = row["subject"].get("kind") == "take" and private_take(request, row["subject"].get("take"))
        row.update({"verdict": q["verdict"], "passes": passes, "done": {"by": by, "at": now_ms()}, "claimed": c or {"by": by, "at": now_ms(), "touched": now_ms()},
                    "notes": [{k: v for k, v in n.items() if not (secret and k in ("text", "fix"))} | ({"words": "on the take (private: sealed with it)"} if secret else {}) for n in notes],
                    **({"private": True} if secret else {}), **({"packet": q["packet"]} if q.get("packet") else {})})
        return web.json_response({"critique": write(root, row)})


@routes.post("/mainodes/snap/critique/update")
async def update(request):
    """the page's own fields on a row: the packet it pinned, the take notes it mirrored, a skip, a fixture stamp"""
    q = await request.json()
    patch = q.get("set") or {}
    wrong = [k for k in patch if k not in ("packet", "mirrored", "skipped", "verdict_set", "fixtures")]
    if wrong:
        return bad(f"update sets packet, mirrored, skipped, verdict_set or fixtures; not {', '.join(wrong)}")
    root = folder(request)
    async with lock:
        row = find(root, q.get("id"))
        if "skipped" in patch and patch["skipped"] and (held(row) and row["claimed"]["by"] != patch["skipped"].get("by")):
            return bad(f"{row['title']} is claimed by {row['claimed']['by']}: only the claimer skips it", 409)
        row.update(patch)
        if row.get("claimed") and held(row):
            row["claimed"]["touched"] = now_ms()
        return web.json_response({"critique": write(root, row)})


# ---- fixtures (SNAP-R108): the person's catches become regression pictures for the critic -------------------------
def fixtures_root(request):
    env = os.environ.get("SNAP_CRITIC_FIXTURES")
    path = env or PromptServer.instance.user_manager.get_request_user_filepath(request, "snap/critic_fixtures", create_dir=True)
    os.makedirs(path, exist_ok=True)
    return path


def picture_path(rel):
    """input/… or output/… as the page names a picture; refused outside those folders"""
    kind, _, rest = (rel or "").partition("/")
    base = {"input": folder_paths.get_input_directory(), "output": folder_paths.get_output_directory()}.get(kind)
    if not base or not rest:
        raise ValueError(f"picture is input/<file> or output/<file>; not {rel!r}")
    path = os.path.realpath(os.path.join(base, rest))
    if os.path.commonpath([path, os.path.realpath(base)]) != os.path.realpath(base) or not os.path.isfile(path):
        raise ValueError(f"{rel} isn't a file in this server's {kind} folder")
    return path


@routes.post("/mainodes/snap/critique/fixture")
async def fixture(request):
    q = await request.json()
    try:
        src = picture_path(q.get("picture"))
    except ValueError as e:
        return bad(str(e))
    if sealed(src):  # a private take's picture stays sealed: never copied out in plain (fails closed)
        return bad("This picture is a private take's, kept encrypted: it can't become a fixture (fixtures are plain files)", 403)
    if q.get("polarity") not in ("positive", "negative"):
        return bad("polarity is positive (the picture has the flaw) or negative (it is clean)")
    if q["polarity"] == "positive" and not (q.get("expected") or []):
        return bad("a positive fixture names its flaw: expected [{flaw, where, severity, owner}]")
    root = fixtures_root(request)
    os.makedirs(os.path.join(root, "pictures"), exist_ok=True)
    local = os.path.join(root, "fixtures.local.json")
    async with lock:
        data = json.load(open(local, encoding="utf-8")) if os.path.exists(local) else {"about": "the person's own fixtures, added from Snap (Add as fixture); run_fixtures.py reads them beside the pack's", "fixtures": []}
        fid = f"L{len(data['fixtures']) + 1:02d}"
        name = f"{fid}{os.path.splitext(src)[1].lower()}"
        shutil.copyfile(src, os.path.join(root, "pictures", name))
        f = {"id": fid, "polarity": q["polarity"], "what": q.get("what") or "", "context": q.get("context") or "", "context_pictures": [], "expected": q.get("expected") or [],
             "allowed_true_minor": [], "must_not_flag": [], "note": q.get("note") or "", "picture": f"pictures/{name}", "added": {"at": now_ms(), "by": q.get("by") or "person", "from": q.get("from") or {}}}
        data["fixtures"].append(f)
        tmp = f"{local}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as out:
            json.dump(data, out, ensure_ascii=False, indent=1)
        os.replace(tmp, local)
    return web.json_response({"fixture": f, "file": local, "count": len(data["fixtures"])})
