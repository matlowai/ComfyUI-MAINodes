"""Snap <-> Astrid on the server (PROTOCOL_V1_1): where Astrid is on this machine (the person's settings "Astrid on this
machine": its launcher and Runtime data root), and the one way the server runs it: tools/astrid_push.py as a child
process outside ComfyUI's Python, in an environment built here (no key or token of this server's reaches it), on
loopback, for a request from this machine only; and the receipt of where each Cut went.
SNAP-R215 every archive is probed before the answer · SNAP-R224 the push is the person's, one job per Book, on loopback ·
SNAP-R225 Snap remembers where a Cut went · SNAP-R18 local only ·
see docs/snap/SNAP_RULES.md"""
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web
from comfy.cli_args import args
from server import PromptServer

PUSH = Path(__file__).parent / "tools" / "astrid_push.py"
LAUNCHER, DATA_ROOT, APP = "MAINodes.Snap.AstridLauncher", "MAINodes.Snap.AstridDataRoot", "MAINodes.Snap.AstridApp"  # the page registers them (snap_view.js)
LOOPBACK = {"127.0.0.1", "::1"}
routes = PromptServer.instance.routes


def where(request):
    """{launcher, data_root, app} from the person's ComfyUI settings; with `said` (why Astrid can't run) when the
    launcher isn't set or isn't usable (app, the App's address for Open in Astrid, stays: it needs no launcher)"""
    path = PromptServer.instance.user_manager.get_request_user_filepath(request, "comfy.settings.json")
    settings = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            settings = json.load(f)
    launcher, root = str(settings.get(LAUNCHER) or "").strip(), str(settings.get(DATA_ROOT) or "").strip()
    app = str(settings.get(APP) or "http://127.0.0.1:5180").strip().rstrip("/")
    out = {"app": app} if urlsplit(app).hostname in ("127.0.0.1", "localhost", "::1") else {"app": None, "said": f"The Astrid App address {app!r} isn't this machine (Settings > MAINodes > Snap > Astrid)"}
    if not launcher:
        return {**out, "said": "Astrid isn't set up on this machine: say where its launcher is (Settings > MAINodes > Snap > Astrid)"}
    if not (os.path.isabs(launcher) and os.path.isfile(launcher) and os.access(launcher, os.X_OK)):
        return {**out, "said": f"The Astrid launcher {launcher!r} isn't an executable file on this machine (Settings > MAINodes > Snap > Astrid)"}
    if root and not os.path.isdir(root):
        return {**out, "said": f"The Astrid data root {root!r} isn't a folder on this machine (Settings > MAINodes > Snap > Astrid)"}
    return {"launcher": launcher, "data_root": root or None, **out}


def prepare(request):
    """what running Astrid needs for this request: (launcher, the child's environment) or a refusal. The environment is
    built, never inherited: PATH, HOME, the Runtime's data root, this server's loopback base and the agent name the child
    calls back with (the lab found Astrid's host inheriting provider keys from a tool shell; ComfyUI's environment is
    not Astrid's to read)"""
    if request.remote not in LOOPBACK:
        return None, {"ok": False, "error": "not_loopback", "message": f"Astrid runs only for a request from this machine; this one came from {request.remote}"}
    at = where(request)
    if "said" in at:
        return None, {"ok": False, "error": "no_launcher", "message": at["said"]}
    return (at["launcher"], {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": os.path.expanduser("~"), "SNAP_BASE": f"http://127.0.0.1:{args.port}", "SNAP_AGENT": "snap-push",
                             **({"ASTRID_RUNTIME_DATA_ROOT": at["data_root"]} if at["data_root"] else {})}), None


async def spawn(launcher, env, *argv):
    """tools/astrid_push.py <argv>: (exit code, its one JSON answer, whole; or what it printed when that isn't JSON)"""
    proc = await asyncio.create_subprocess_exec(sys.executable, "-I", str(PUSH), *argv, "--launcher", launcher, env=env, cwd=str(PUSH.parent),
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    text = out.decode(errors="replace").strip()
    try:
        return proc.returncode, json.loads(text)
    except ValueError:
        return proc.returncode or 1, {"ok": False, "error": "no_answer", "message": f"{text}\n{err.decode(errors='replace')}".strip()}


async def run(request, *argv):
    ready, refused = prepare(request)
    return (1, refused) if refused else await spawn(*ready, *argv)


# ---- the receipt (SNAP-R225): where each production's Cut went in Astrid, kept by the bridge, the only source of truth
# for the link (Astrid drops a manifest's snap block on re-export, lab check A7). One file per user, snap/astrid.json:
# {productions: {"production:<id>": {project {project_id, slug, name}, references, documents, style,
#   books: {"book:<id>": {timeline {timeline_id, name}, head, clips {cut: {clip, media, take, trim, ...}}, order, ...}}}}}
RECEIPT = "snap/astrid.json"
receipt_lock = asyncio.Lock()


def receipt_path(request):
    return PromptServer.instance.user_manager.get_request_user_filepath(request, RECEIPT)


def read_receipt(path):
    if not os.path.exists(path):
        return {"productions": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@routes.get("/mainodes/snap/astrid")
async def receipt(request):
    """the receipt whole, and whether Astrid is set up on this machine (setup: {launcher, data_root, app} or {said})"""
    async with receipt_lock:
        out = read_receipt(receipt_path(request))
    return web.json_response({**out, "setup": where(request), "jobs": job_rows(PromptServer.instance.user_manager.get_request_user_id(request))})


@routes.post("/mainodes/snap/astrid/link")
async def link(request):
    """{production, project?, references?, documents?, style?, book?, set?, clips?}: the production's fields are replaced
    when given; with book, `set` is merged into its entry and `clips` cut by cut (a swap names only the cuts it moved)"""
    q = await request.json()
    production = str(q.get("production") or "")
    if not production.startswith("production:"):
        return web.json_response({"error": "production is production:<id> (get_production of a Book names it)"}, status=400)
    path = receipt_path(request)
    async with receipt_lock:
        data = read_receipt(path)
        entry = data["productions"].setdefault(production.split("@")[0], {"books": {}})
        entry.update({k: q[k] for k in ("project", "references", "documents", "style") if k in q})
        if q.get("book"):
            book = entry["books"].setdefault(str(q["book"]).split("@")[0], {"clips": {}})
            book.update(q.get("set") or {})
            for cut, row in (q.get("clips") or {}).items():
                book["clips"][cut] = {**book["clips"].get(cut, {}), **row}
        entry["at"] = int(time.time() * 1000)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    PromptServer.instance.send_sync("mainodes-snap-astrid", {"production": production, "book": q.get("book")})
    return web.json_response({"production": production.split("@")[0], **entry})


# ---- the push (SNAP-R224): the person's button or their Book's auto-push setting, one job per Book on the Work card -----
# A push is one operation whatever starts it (tools/astrid_push.py push: import once, then swap what changed, then the
# context). One runs at a time per Book; a second request while it runs queues one more (a run of accepts makes one
# push after the one running). Jobs live here while the server runs, each with its answer whole (a reload asks again);
# a push that landed is in the receipt on disk.
WHATS = ("push", "cut", "context", "swap", "render", "proposal-note")
pushes = {}  # (user, book) -> the job row: {book, what, by, state: running|done|failed, started, ended, said, answer, again}


def job_rows(user):
    return [{k: v for k, v in j.items() if k != "next"} for (u, _), j in pushes.items() if u == user]


async def push_job(key, ready, argv):
    job = pushes[key]
    while True:
        code, answer = await spawn(*ready, *argv)
        job.update(state="done" if code == 0 and answer.get("ok") else "failed", ended=int(time.time() * 1000), answer=answer, said=answer.get("said") or answer.get("message") or "")
        PromptServer.instance.send_sync("mainodes-snap-astrid", {"book": job["book"], "job": job["state"]})
        if not job.get("next"):
            return
        argv, job["next"] = job["next"], None
        job.update(state="running", started=int(time.time() * 1000), ended=None, answer=None, said="pushing again: the Cut changed while the last push ran")
        PromptServer.instance.send_sync("mainodes-snap-astrid", {"book": job["book"], "job": "running"})


@routes.post("/mainodes/snap/astrid/push")
async def push(request):
    """{book, what (push | cut | context | swap | render | proposal-note), by (button | auto-push), client (the page that
    pressed), archive?, cut?, new_timeline?} -> the Book's job, started or queued behind the running one"""
    q = await request.json()
    book, what, by = str(q.get("book") or "").split("@")[0], q.get("what") or "push", q.get("by")
    if not book.startswith("book:") or what not in WHATS or by not in ("button", "auto-push"):
        return web.json_response({"error": f"push takes book (book:<id>), what ({', '.join(WHATS)}) and by (button or auto-push); got {book!r}, {what!r}, {by!r}"}, status=400)
    ready, refused = prepare(request)
    if refused:
        return web.json_response(refused, status=409)
    user = PromptServer.instance.user_manager.get_request_user_id(request)
    argv = [what, "--book", book, "--by", f"person ({by})", *(["--page", str(q["client"])] if q.get("client") else []), *(["--user", user] if args.multi_user else []),
            *(["--archive", str(q["archive"])] if q.get("archive") else []), *(["--cut", str(q["cut"])] if q.get("cut") else []), *(["--new-timeline"] if q.get("new_timeline") else [])]
    key, job = (user, book), pushes.get((user, book))
    if job and job["state"] == "running":
        job["next"] = argv
        PromptServer.instance.send_sync("mainodes-snap-astrid", {"book": book, "job": "queued"})
        return web.json_response({"queued": True, "said": "a push of this Book is running: one more runs after it", "job": {k: v for k, v in job.items() if k != "next"}})
    pushes[key] = {"book": book, "what": what, "by": f"person ({by})", "state": "running", "started": int(time.time() * 1000), "ended": None, "said": f"Pushing to Astrid ({what})", "answer": None}
    asyncio.create_task(push_job(key, ready, argv))
    PromptServer.instance.send_sync("mainodes-snap-astrid", {"book": book, "job": "running"})
    return web.json_response({"started": True, "job": pushes[key]})
