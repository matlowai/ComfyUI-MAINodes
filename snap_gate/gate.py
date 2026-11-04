"""snap-gate: sign-in, per-account work and rating caps in front of an unmodified ComfyUI.

ComfyUI listens on 127.0.0.1 only; the gate listens on the port people and agents use and speaks plain HTTP and
WebSocket to it, so core and the pack keep updating untouched. Off (`--disabled`) it relays every byte unchanged.
On, every request needs a session (the sign-in form, or an account token as `Authorization: Bearer`), and the gate:
sets core's `comfy-user` header from the session (ComfyUI runs with --multi-user); owns prompt ids, history, queue,
jobs, WebSocket events and the Snap bridge per account; puts outputs in output/<account>/ or output/shared/ and serves
/view only from there or from the account's own runs; hides model files above the account's rating everywhere they
are listed and refuses prompts that name them. The admin sees and can do everything.

    python snap_gate/gate.py account add kid --role kid            # asks for a password; --max-rating to change the cap
    python snap_gate/gate.py serve --port 8197 --upstream http://127.0.0.1:8198 --comfy-dir <ComfyUI> --state <dir>

SNAP-R40 a wrapper, never core · SNAP-R41 sessions set the user · SNAP-R42 work is owned · SNAP-R43 ratings cap files ·
SNAP-R44 unrated content is Adult · SNAP-R45 no paths outside the library · see docs/SNAP_RULES.md
"""
import argparse
import asyncio
import getpass
import hashlib
import hmac
import html
import json
import os
import posixpath
import re
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import quote

import aiohttp
from aiohttp import WSMsgType, web

PACK_GRAPH = Path(__file__).resolve().parent.parent / "snap_cards" / "models.json"
COOKIE = "snap_gate"
LEVELS = {"pg": 0, "general": 0, "mature": 1, "sensitive": 1, "questionable": 1, "adult": 2, "explicit": 2}  # shown as PG / Mature / Adult
CAPS = ["pg", "mature", "adult"]
ROLES = {"admin": "adult", "member": "mature", "kid": "pg"}  # role -> default max rating
# SNAP-R44: files here don't decide what a picture shows, so an unrated one counts as PG; anything else unrated is Adult
HELPER_FOLDERS = {"vae", "vae_approx", "text_encoders", "clip", "clip_vision", "upscale_models", "latent_upscale_models", "configs", "custom_nodes",
                  "audio_encoders", "background_removal", "detection", "frame_interpolation", "geometry_estimation", "optical_flow", "classifiers",
                  "face_recognition", "controlnet", "gligen"}
MODEL_EXT = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin")
HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"}
SESSION_SECONDS = 7 * 24 * 3600


def base(name):
    return str(name).replace("\\", "/").rsplit("/", 1)[-1]


def scrypt(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=1 << 14, r=8, p=1, dklen=32).hex()


def write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, path)


class Accounts:
    """state/accounts.json: name -> role, max_rating, salt + scrypt hash, sha256 of the API token, ComfyUI user id."""

    def __init__(self, state):
        self.path = Path(state) / "accounts.json"
        self.stamp, self.all = None, {}

    def load(self):
        st = self.path.stat().st_mtime_ns if self.path.exists() else None
        if st != self.stamp:
            self.all, self.stamp = (json.loads(self.path.read_text(encoding="utf-8")) if st else {}), st
        return self.all

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_json(self.path, self.all)
        self.stamp = self.path.stat().st_mtime_ns


class Gate:
    def __init__(self, upstream, comfy_dir, state, disabled):
        self.upstream, self.disabled = upstream.rstrip("/"), disabled
        self.user_dir = Path(comfy_dir) / "user"
        self.state = Path(state)
        self.accounts = Accounts(state)
        owners = self.state / "owners.json"
        self.owners = json.loads(owners.read_text(encoding="utf-8")) if owners.exists() else {}  # prompt_id -> account
        self.sessions = {}    # cookie token -> (account, expires)
        self.clients = {}     # websocket client id -> account (SNAP-R42: an id is never handed to another account)
        self.produced = {}    # account -> {(type, subfolder, filename)} its runs wrote
        self.lists = (0, {})  # (time, folder -> file names) from ComfyUI's /models
        self.http = None

    # ---- accounts and sessions (SNAP-R41) ---------------------------------------------------------------------------
    def account(self, request):
        """The signed-in account name, or None."""
        tok = request.cookies.get(COOKIE)
        if tok in self.sessions:
            name, expires = self.sessions[tok]
            if expires > time.time() and name in self.accounts.load():
                return name
            self.sessions.pop(tok, None)
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            digest = hashlib.sha256(auth[7:].strip().encode()).hexdigest()
            for name, a in self.accounts.load().items():
                if a.get("token") and hmac.compare_digest(a["token"], digest):
                    return name
        return None

    def is_admin(self, name):
        return self.accounts.load()[name]["role"] == "admin"

    async def comfy_user(self, name):
        """The account's ComfyUI user id, created through core's own /users the first time."""
        a = self.accounts.load()[name]
        if not a.get("comfy_user"):
            async with self.http.post(self.upstream + "/users", json={"username": name}) as r:
                if r.status != 200:
                    raise web.HTTPBadGateway(text=f"ComfyUI refused to create user {name}: {await r.text()}")
                a["comfy_user"] = await r.json()
            self.accounts.save()
        return a["comfy_user"]

    def start_session(self, name, target):
        tok = secrets.token_urlsafe(32)
        self.sessions[tok] = (name, time.time() + SESSION_SECONDS)
        resp = web.HTTPFound(target)
        resp.set_cookie(COOKIE, tok, httponly=True, samesite="Strict", max_age=SESSION_SECONDS, path="/")
        return resp

    async def login_page(self, request):
        target = safe_next(request.query.get("next"))
        token = request.query.get("token")
        if token:  # an agent's headless page signs in with its account token (snap_agent_page.sh)
            digest = hashlib.sha256(token.encode()).hexdigest()
            for name, a in self.accounts.load().items():
                if a.get("token") and hmac.compare_digest(a["token"], digest):
                    await self.comfy_user(name)
                    return self.start_session(name, target)
            await asyncio.sleep(0.5)
            return page(target, "That sign-in link has expired. Ask the admin for a new one.", 401)
        return page(target)

    async def login(self, request):
        origin = request.headers.get("Origin")
        if origin and origin.split("://", 1)[-1] != request.host:
            return web.Response(status=403)
        form = await request.post()
        name, password, target = str(form.get("username", "")).strip().lower(), str(form.get("password", "")), safe_next(form.get("next"))
        a = self.accounts.load().get(name)
        if not a or not hmac.compare_digest(a["hash"], scrypt(password, a["salt"])):
            await asyncio.sleep(0.5)
            return page(target, "That name and password don't match.", 401)
        await self.comfy_user(name)
        return self.start_session(name, target)

    async def logout(self, request):
        self.sessions.pop(request.cookies.get(COOKIE), None)
        resp = web.HTTPFound("/gate/login")
        resp.del_cookie(COOKIE, path="/")
        return resp

    async def me(self, request):
        name = self.account(request)
        if name is None:
            return web.json_response({"error": "not signed in"}, status=401)
        a = self.accounts.load()[name]
        return web.json_response({"account": name, "role": a["role"], "max_rating": a["max_rating"]})

    # ---- ratings (SNAP-R43, SNAP-R44) -------------------------------------------------------------------------------
    def ratings(self):
        """File name -> level from the pack's model graph under the admins' own snap/models.json. Other accounts can write
        their own user data, so their model graphs never rate anything."""
        entries = {base(e["file"]): e for e in json.loads(PACK_GRAPH.read_text(encoding="utf-8"))["files"]}
        for a in self.accounts.load().values():
            f = self.user_dir / str(a.get("comfy_user")) / "snap" / "models.json"
            if a["role"] == "admin" and a.get("comfy_user") and f.is_file():
                for e in json.loads(f.read_text(encoding="utf-8")):
                    entries[base(e["file"])] = {**entries.get(base(e["file"]), {}), **{k: v for k, v in e.items() if v is not None}}
        out = {}
        for name, e in entries.items():
            if str(e.get("rating")).lower() in LEVELS:
                out[name] = LEVELS[str(e["rating"]).lower()]
            elif "nsfw" in (e.get("tags") or []):
                out[name] = LEVELS["adult"]
        return out

    async def model_lists(self):
        if time.time() - self.lists[0] < 5:
            return self.lists[1]
        async with self.http.get(self.upstream + "/models") as r:
            folders = await r.json()

        async def files(f):
            async with self.http.get(f"{self.upstream}/models/{quote(f)}") as r:
                return f, (await r.json() if r.status == 200 else [])
        self.lists = (time.time(), dict(await asyncio.gather(*map(files, folders))))
        return self.lists[1]

    async def hidden(self, name):
        """Every name this account must not see or load: files as /models lists them, embeddings also without extension."""
        a = self.accounts.load()[name]
        cap = LEVELS[a["max_rating"]]
        if a["role"] == "admin" or cap >= LEVELS["adult"]:
            return set()
        rated, out = self.ratings(), set()
        for folder, names in (await self.model_lists()).items():
            for n in names:
                level = rated.get(base(n), LEVELS["pg"] if folder in HELPER_FOLDERS else LEVELS["adult"])
                if level > cap:
                    out.add(n)
                    if folder == "embeddings":
                        out.add(os.path.splitext(n)[0])
        return out

    # ---- relaying ---------------------------------------------------------------------------------------------------
    async def send(self, request, name, body=None, path_qs=None, plain=False):
        """The request as ComfyUI gets it: the account's comfy-user, no gate cookie or token. `plain` asks for an
        uncompressed answer the gate can read."""
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
        if name is not None:
            headers = {k: v for k, v in headers.items() if k.lower() not in ("comfy-user", "authorization", "cookie")}
            headers["comfy-user"] = await self.comfy_user(name)
        if plain:
            headers["Accept-Encoding"] = "identity"
        if body is not None:
            headers = {k: v for k, v in headers.items() if k.lower() != "content-length"}
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        else:
            data = request.content if request.body_exists else None
        try:
            return await self.http.request(request.method, self.upstream + (path_qs or request.path_qs), headers=headers, data=data, allow_redirects=False)
        except aiohttp.ClientConnectionError:
            raise web.HTTPBadGateway(text=f"ComfyUI isn't answering at {self.upstream}.")

    async def relay(self, request, name, **kw):
        up = await self.send(request, name, **kw)
        async with up:
            out = web.StreamResponse(status=up.status, reason=up.reason, headers={k: v for k, v in up.headers.items() if k.lower() not in HOP})
            await out.prepare(request)
            async for chunk in up.content.iter_chunked(1 << 16):
                await out.write(chunk)
            await out.write_eof()
            return out

    async def fetch(self, request, name, **kw):
        """(status, parsed JSON or raw text) of the request sent on to ComfyUI."""
        async with await self.send(request, name, plain=True, **kw) as up:
            text = await up.text()
            try:
                return up.status, json.loads(text)
            except ValueError:
                return up.status, text

    async def get(self, path):
        async with self.http.get(self.upstream + path) as r:
            return await r.json()

    # ---- ownership (SNAP-R42) ---------------------------------------------------------------------------------------
    def owns(self, name, prompt_id):
        return self.is_admin(name) or self.owners.get(prompt_id) == name

    def record(self, name, outputs):
        """Remember the files a run of this account wrote (history outputs or an `executed` event's output)."""
        seen = self.produced.setdefault(name, set())
        for v in (outputs or {}).values():
            for item in v if isinstance(v, list) else []:
                if isinstance(item, dict) and "filename" in item:
                    seen.add((item.get("type", "output"), posixpath.normpath(item.get("subfolder") or "."), item["filename"]))

    def own_history(self, name, history):
        mine = {pid: h for pid, h in history.items() if self.owns(name, pid)}
        for pid, h in mine.items():
            self.record(self.owners.get(pid), h.get("outputs"))
        return mine

    async def refuse(self, message, status=400):
        return web.json_response({"error": {"type": "snap_gate", "message": message, "details": message, "extra_info": {}}, "node_errors": {}}, status=status)

    async def prompt(self, request, name):
        body = await request.json()
        admin, hidden = self.is_admin(name), await self.hidden(name)
        for nid, node in (body.get("prompt") or {}).items():
            inputs = node.get("inputs") or {}
            for key, v in inputs.items():
                if not isinstance(v, str):
                    continue
                if names_any([v], hidden):
                    return await self.refuse(f"Node {nid} loads a file this account can't use (above its rating). Ask the admin.", 403)
                if not admin and os.path.isabs(v) and os.path.exists(v):  # SNAP-R45
                    return await self.refuse(f"Node {nid} reads a path outside ComfyUI's folders, which only the admin can do.", 403)
                if key == "filename_prefix":
                    inputs[key] = bucket(name, v)
                    if inputs[key] is None:
                        return await self.refuse(f"Node {nid} saves outside this account's folder.", 403)
        pid = body.get("prompt_id")
        if pid and pid in self.owners and self.owners[pid] != name:
            return await self.refuse("That prompt id belongs to another account.", 403)
        if body.get("client_id") not in [c for c, a in self.clients.items() if a == name]:
            body["client_id"] = f"snapgate-{name}"  # never a broadcast, never another account's page
        extra = body.setdefault("extra_data", {})
        extra["snap_user"], extra["snap_max_rating"] = name, self.accounts.load()[name]["max_rating"]
        status, out = await self.fetch(request, name, body=body)
        if status == 200 and isinstance(out, dict) and out.get("prompt_id"):
            self.owners[out["prompt_id"]] = name
            write_json(self.state / "owners.json", self.owners)
        return web.json_response(out, status=status) if not isinstance(out, str) else web.Response(text=out, status=status)

    async def view_ok(self, request, name):
        q = request.query
        filename, kind = q.get("filename", ""), q.get("type", "output")
        if filename.startswith("blake3:"):
            return False  # core resolves hashes without an owner
        for t, cut in (("output", 9), ("input", 8), ("temp", 7)):
            if filename.endswith(f"[{t}]"):
                filename, kind = filename[:-cut], t
        if kind == "input":
            return True  # uploads are shared until they get buckets (U65 notes)
        sub = posixpath.normpath((q.get("subfolder") or ".").replace("\\", "/"))
        top = sub.split("/")[0]
        if kind == "output" and top in (name, "shared"):
            return True
        key = (kind, sub, base(filename))
        if key not in self.produced.get(name, set()):
            self.own_history(name, await self.get("/history"))
        return key in self.produced.get(name, set())

    async def ws(self, request, name):
        cid = request.query.get("clientId", "")
        if name is not None and cid and self.clients.get(cid, name) != name:
            return web.Response(status=403, text="That client id belongs to another account.")
        down = web.WebSocketResponse(max_msg_size=0)
        await down.prepare(request)
        headers = {k: request.headers[k] for k in ("Host", "Origin", "User-Agent") if k in request.headers}
        try:
            up = await self.http.ws_connect(self.upstream.replace("http", "ws", 1) + "/ws" + (f"?clientId={quote(cid)}" if cid else ""), headers=headers, max_msg_size=0)
        except aiohttp.ClientError:
            await down.close()
            return down
        sid = cid

        async def to_page():
            nonlocal sid
            async for m in up:
                if m.type == WSMsgType.BINARY:
                    await down.send_bytes(m.data)
                    continue
                if m.type != WSMsgType.TEXT:
                    break
                if name is not None:
                    msg = json.loads(m.data)
                    data = msg.get("data") if isinstance(msg.get("data"), dict) else {}
                    if msg.get("type") == "status" and data.get("sid"):
                        sid = data["sid"]
                        self.clients[sid] = name
                    pid = data.get("prompt_id")
                    if pid and not self.owns(name, pid):
                        continue
                    if msg.get("type") == "executed" and pid:
                        self.record(self.owners.get(pid, name), data.get("output"))
                await down.send_str(m.data)

        async def to_comfy():
            async for m in down:
                if m.type == WSMsgType.TEXT:
                    await up.send_str(m.data)
                elif m.type == WSMsgType.BINARY:
                    await up.send_bytes(m.data)
                else:
                    break

        tasks = [asyncio.create_task(to_page()), asyncio.create_task(to_comfy())]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in tasks:
            t.cancel()
        await up.close()
        await down.close()
        return down

    # ---- the routes -------------------------------------------------------------------------------------------------
    async def handle(self, request):
        if self.disabled:
            return await (self.ws(request, None) if request.path in ("/ws", "/api/ws") else self.relay(request, None))
        name = self.account(request)
        if name is None:
            if request.method == "GET" and "text/html" in request.headers.get("Accept", ""):
                raise web.HTTPFound("/gate/login?next=" + quote(request.path_qs, safe=""))
            return web.json_response({"error": "Sign in first: open /gate/login, or send an account token as Authorization: Bearer."}, status=401)
        p = request.path[4:] if request.path.startswith("/api/") else request.path
        m, admin = request.method, self.is_admin(name)
        if p == "/ws":
            return await self.ws(request, name)
        if p == "/users":
            if m == "GET":  # the page is one person's, so the frontend never shows core's user picker
                return web.json_response({"storage": "server", "migrated": True})
            return web.json_response({"error": "Accounts are made with snap-gate, not here."}, status=403)
        if p.startswith("/internal") and not admin:
            return web.json_response({"error": "Only the admin can open this."}, status=403)
        if m == "POST" and p == "/prompt":
            return await self.prompt(request, name)
        if m == "POST" and p == "/mainodes/snap/register":  # the pack keys pages by comfy-user (SNAP-R30): a page is the account's own socket
            body = await request.json()
            if self.clients.get(body.get("client")) != name:
                return web.json_response({"error": "Register your own page: that client id isn't a socket of this account."}, status=403)
            return await self.relay(request, name, body=body)
        if admin:
            return await self.relay(request, name)

        if m == "GET" and p == "/view":
            return await self.relay(request, name) if await self.view_ok(request, name) else web.Response(status=404)
        if m == "GET" and (p.startswith("/view_metadata/") or p.startswith("/experiment/models/preview/")):
            fn, hidden = request.query.get("filename", "") if p.startswith("/view_metadata/") else p.split("/", 6)[-1], await self.hidden(name)
            if fn in hidden or base(fn) in {base(h) for h in hidden}:
                return web.Response(status=404)
            return await self.relay(request, name)
        if p.startswith("/mainodes/"):  # pack routes take and list file names too (dials are LoRAs): same rule, generically
            hidden = await self.hidden(name)
            body = await request.json() if m == "POST" and request.content_type == "application/json" else None
            if names_any([*request.query.values(), body], hidden):
                return web.json_response({"error": "That file isn't available to this account."}, status=404)
            if m == "POST":
                return await self.relay(request, name, **({"body": body} if body is not None else {}))
        if m == "GET" and (p in ("/object_info", "/embeddings") or p.startswith(("/object_info/", "/models/", "/experiment/models/", "/mainodes/"))):
            status, out = await self.fetch(request, name)
            if isinstance(out, str):
                return web.Response(text=out, status=status)
            return web.json_response(scrub(out, await self.hidden(name)) if status == 200 else out, status=status)
        if m == "GET" and p == "/history":  # core pages the whole history; page this account's own the same way
            items = list(self.own_history(name, await self.get("/history")).items())
            n, offset = request.query.get("max_items"), request.query.get("offset")
            if n is not None:
                items = items[int(offset):int(offset) + int(n)] if offset is not None and int(offset) >= 0 else items[-int(n):] if int(n) else []
            return web.json_response(dict(items))
        if m == "GET" and p.startswith("/history/"):
            return web.json_response(self.own_history(name, (await self.fetch(request, name))[1]))
        if m == "GET" and p == "/queue":
            status, out = await self.fetch(request, name)
            return web.json_response({k: [i for i in v if self.owns(name, i[1])] for k, v in out.items()}, status=status)
        if m == "GET" and p == "/jobs":
            q = {k: v for k, v in request.query.items() if k not in ("limit", "offset")}
            status, out = await self.fetch(request, name, path_qs=request.path + ("?" + "&".join(f"{k}={quote(v)}" for k, v in q.items()) if q else ""))
            if status != 200:
                return web.json_response(out, status=status)
            jobs = [j for j in out["jobs"] if self.owns(name, j["id"])]
            offset, limit = int(request.query.get("offset", 0) or 0), request.query.get("limit")
            page_ = jobs[offset:offset + int(limit)] if limit else jobs[offset:]
            return web.json_response({"jobs": page_, "pagination": {"offset": offset, "limit": int(limit) if limit else None, "total": len(jobs), "has_more": offset + len(page_) < len(jobs)}})
        if p.startswith("/jobs/") and not p.endswith("/cancel"):
            return await self.relay(request, name) if self.owns(name, p.split("/")[2]) else web.json_response({"error": "Job not found"}, status=404)
        if m == "POST" and p.startswith("/jobs/") and p.endswith("/cancel") and p != "/jobs/cancel":
            return await self.relay(request, name) if self.owns(name, p.split("/")[2]) else web.json_response({"cancelled": False})
        if m == "POST" and p == "/jobs/cancel":
            body = await request.json()
            body["job_ids"] = [j for j in body.get("job_ids") or [] if isinstance(j, str) and self.owns(name, j)]
            return await self.relay(request, name, body=body)
        if m == "POST" and p in ("/queue", "/history"):
            body = await request.json()
            if body.pop("clear", False):
                current = await self.get(p)
                ids = [i[1] for v in current.values() for i in v] if p == "/queue" else list(current)
                body["delete"] = list(body.get("delete") or []) + ids
            body["delete"] = [i for i in body.get("delete") or [] if self.owns(name, i)]
            return await self.relay(request, name, body=body)
        if m == "POST" and p == "/interrupt":
            body = await request.json() if request.body_exists else {}
            running = [i[1] for i in (await self.get("/queue"))["queue_running"]]
            pid = body.get("prompt_id") or next(iter(running), None)
            if not pid or not self.owns(name, pid):
                return web.json_response({"error": "Only the account that queued a run (or the admin) can stop it."}, status=403)
            return await self.relay(request, name, body={"prompt_id": pid})
        return await self.relay(request, name)


def scrub(o, hidden):
    """Every list in a model listing (or /object_info's combos) without the hidden names, generically (SNAP-R43)."""
    if isinstance(o, list):
        return [scrub(x, hidden) for x in o if not ((isinstance(x, str) and x in hidden) or (isinstance(x, dict) and x.get("name") in hidden))]
    if isinstance(o, dict):
        return {k: scrub(v, hidden) for k, v in o.items()}
    return o


def names_any(values, hidden):
    """Whether any string in these values (nested JSON included) names a hidden file, by its name or its file name."""
    bases = {base(h) for h in hidden}
    todo = list(values)
    while todo:
        v = todo.pop()
        if isinstance(v, str) and (v in hidden or (v.lower().endswith(MODEL_EXT) and base(v) in bases)):
            return True
        todo += v.values() if isinstance(v, dict) else v if isinstance(v, list) else []
    return False


def bucket(name, prefix):
    """A save prefix inside the account's folder (or shared/), or None when it climbs out."""
    v = posixpath.normpath(prefix.replace("\\", "/")).lstrip("/")
    out = v if v.split("/")[0] in (name, "shared") and "/" in v else f"{name}/{v}"
    return None if ".." in out.split("/") else out


def safe_next(target):
    target = str(target or "/")
    return target if target.startswith("/") and not target.startswith("//") else "/"


def page(target, error="", status=200):
    err = f'<p class="err">{html.escape(error)}</p>' if error else ""
    return web.Response(status=status, content_type="text/html", text=LOGIN.replace("{next}", html.escape(target)).replace("{error}", err))


LOGIN = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Snap</title><style>
:root{color-scheme:dark;--bg:#111214;--card:#1a1b1f;--line:#2c2e35;--text:#ececf1;--dim:#9a9ca6;--accent:#6aa2ff;--err:#ff8a8a}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
form{width:min(360px,100%);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 26px}
.mark{display:flex;align-items:center;gap:10px;font-weight:650;font-size:20px;margin-bottom:22px}
.mark i{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#6aa2ff,#b46aff 55%,#ff6a9a)}
label{display:block;color:var(--dim);font-size:13px;margin:14px 0 6px}
input{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:#0f1013;color:var(--text);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
button{margin-top:22px;width:100%;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#0b1020;font:600 15px system-ui,sans-serif;cursor:pointer}
.err{color:var(--err);margin:14px 0 0;font-size:14px}.foot{color:var(--dim);font-size:12.5px;margin:18px 0 0}
</style></head><body><form method="post" action="/gate/login"><div class="mark"><i></i>Snap</div>
<input type="hidden" name="next" value="{next}">
<label for="u">Name</label><input id="u" name="username" autocomplete="username" autofocus required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
{error}<button type="submit">Sign in</button><p class="foot">Accounts are set up by this machine's admin.</p></form></body></html>"""


async def serve(args):
    gate = Gate(args.upstream, args.comfy_dir, args.state, args.disabled)
    gate.http = aiohttp.ClientSession(auto_decompress=False, timeout=aiohttp.ClientTimeout(total=None, sock_connect=10))
    if not args.disabled:
        users = await gate.get("/users")
        if "users" not in users:
            sys.exit(f"snap-gate: ComfyUI at {args.upstream} runs single-user; start it with --multi-user, or run the gate with --disabled.")
    app = web.Application(client_max_size=0)
    if not args.disabled:
        app.router.add_get("/gate/login", gate.login_page)
        app.router.add_post("/gate/login", gate.login)
        app.router.add_get("/gate/logout", gate.logout)
        app.router.add_get("/gate/me", gate.me)
    app.router.add_route("*", "/{tail:.*}", gate.handle)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, args.listen, args.port).start()
    print(f"snap-gate {'off (pass-through)' if args.disabled else 'on'}: http://{args.listen}:{args.port} -> {args.upstream}", flush=True)
    await asyncio.Event().wait()


def account_cli(args):
    accounts = Accounts(args.state)
    all_ = accounts.load()
    if args.action == "list":
        for name, a in all_.items():
            print(f"{name}\t{a['role']}\tmax {a['max_rating']}\t{'token' if a.get('token') else ''}")
        return
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", args.name):
        sys.exit("Account names are 1-32 of a-z, 0-9, _ and -.")
    if args.action in ("set", "token") and args.name not in all_:
        sys.exit(f"No account {args.name}; add it first.")
    if args.action == "token":
        token = secrets.token_urlsafe(32)
        all_[args.name]["token"] = hashlib.sha256(token.encode()).hexdigest()
        accounts.save()
        print(token)
        return
    a = all_.get(args.name, {"role": args.role or "member", "comfy_user": None})
    a["role"] = args.role or a["role"]
    a["max_rating"] = args.max_rating or (a.get("max_rating") if not args.role else None) or ROLES[a["role"]]
    if args.action == "add" or args.password_file:
        password = Path(args.password_file).read_text().strip() if args.password_file else getpass.getpass(f"Password for {args.name}: ")
        a["salt"] = secrets.token_hex(16)
        a["hash"] = scrypt(password, a["salt"])
    all_[args.name] = a
    accounts.save()
    print(f"{args.name}: {a['role']}, max {a['max_rating']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--listen", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8197)
    s.add_argument("--upstream", default="http://127.0.0.1:8198")
    s.add_argument("--comfy-dir", required=True, help="ComfyUI's base directory (its user/ folder holds the admins' model graph)")
    s.add_argument("--state", required=True, help="the gate's own folder: accounts.json, owners.json (keep it outside ComfyUI's user/)")
    s.add_argument("--disabled", action="store_true", help="relay everything unchanged: no sign-in, no filtering")
    a = sub.add_parser("account")
    a.add_argument("action", choices=["add", "set", "token", "list"])
    a.add_argument("name", nargs="?", default="")
    a.add_argument("--role", choices=list(ROLES))
    a.add_argument("--max-rating", choices=CAPS)
    a.add_argument("--password-file")
    a.add_argument("--state", required=True)
    args = parser.parse_args()
    if args.cmd == "serve":
        asyncio.run(serve(args))
    else:
        account_cli(args)


if __name__ == "__main__":
    main()
