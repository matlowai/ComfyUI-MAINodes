"""snap-gate: sign-in, per-account work and rating caps in front of an unmodified ComfyUI.

ComfyUI listens on 127.0.0.1 only; the gate listens on the port people and agents use and speaks plain HTTP and
WebSocket to it, so core and the pack keep updating untouched. Off (`--disabled`) it relays every byte unchanged.
On, every request needs a session (the sign-in form, or an account token as `Authorization: Bearer`), and the gate:
sets core's `comfy-user` header from the session (ComfyUI runs with --multi-user); owns prompt ids, history, queue,
jobs, WebSocket events and the Snap bridge per account; puts outputs in output/<account>/ or output/shared/ and serves
/view only from there or from the account's own runs; hides model files above the account's rating everywhere they
are listed and refuses prompts that name them; keeps the pack's shared preset folders for the admin. The admin sees and
can do everything, and rates files at /gate/admin.

    python snap_gate/gate.py account add kid --role kid            # asks for a password; --max-rating to change the cap
    python snap_gate/gate.py settings --idle-minutes 30            # sign in again after this long without a request
    python snap_gate/gate.py serve --port 8197 --upstream http://127.0.0.1:8198 --comfy-dir <ComfyUI> --state <dir>

SNAP-R40 a wrapper, never core · SNAP-R41 sessions set the user · SNAP-R42 work is owned · SNAP-R43 ratings cap files ·
SNAP-R44 unrated content is Adult · SNAP-R45 no paths outside the library · SNAP-R46 sessions persist, idle locks ·
SNAP-R47 sign-in waits · SNAP-R48 shared pack files are the admin's · SNAP-R49 the admin rates on /gate/admin ·
see docs/SNAP_RULES.md
"""
import argparse
import asyncio
import getpass
import hashlib
import hmac
import html
import json
import math
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
SHOWN = {"pg": "PG", "mature": "Mature", "adult": "Adult"}
ROLES = {"admin": "adult", "member": "mature", "kid": "pg"}  # role -> default max rating
# SNAP-R44: files here don't decide what a picture shows, so an unrated one counts as PG; anything else unrated is Adult
HELPER_FOLDERS = {"vae", "vae_approx", "text_encoders", "clip", "clip_vision", "upscale_models", "latent_upscale_models", "configs", "custom_nodes",
                  "audio_encoders", "background_removal", "detection", "frame_interpolation", "geometry_estimation", "optical_flow", "classifiers",
                  "face_recognition", "controlnet", "gligen"}
MODEL_EXT = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin")
HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"}
SESSION_SECONDS = 7 * 24 * 3600
IDLE_MINUTES = 30  # the default; `gate.py settings --idle-minutes` changes it (SNAP-R46)
FREE_TRIES = {"account": 3, "address": 10}  # failed sign-ins before the waits start; then 5 s, doubling, up to 15 min (SNAP-R47)
WAIT_FIRST, WAIT_CAP, FORGET = 5, 15 * 60, 3600
GRAPH = "snap/models.json"  # the admins' own model graph rates files (SNAP-R43)
# SNAP-R48: the pack's preset folders (models/loras/dials/presets/) are shared, so only the admin writes them; anyone else's
# save is kept in its own user data, in the shape the pack's load answers
PRESETS = {"/mainodes/render/presets": lambda preset: preset,
           "/mainodes/dials/presets": lambda rows: {"preset": {"format": "MAIDialRack preset", "version": 1, "rows": rows}, "warnings": []}}


def base(name):
    return str(name).replace("\\", "/").rsplit("/", 1)[-1]


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def scrypt(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=1 << 14, r=8, p=1, dklen=32).hex()


def write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, path)


class StateFile:
    """A JSON object in the gate's state folder, read again when the file changes. accounts.json: name -> role, max_rating,
    salt + scrypt hash, sha256 of the API token, ComfyUI user id. sessions.json: sha256 of a sign-in cookie -> account,
    expires, seen (last request). settings.json: the admin's settings (idle_minutes)."""

    def __init__(self, state, name):
        self.path = Path(state) / name
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
        self.accounts = StateFile(state, "accounts.json")
        self.sessions = StateFile(state, "sessions.json")
        self.settings = StateFile(state, "settings.json")
        self.saved = 0        # when sessions.json was last written (seen times are written at most once a minute)
        self.fails = {}       # ("account", name) or ("address", ip) -> (failed sign-ins, wait until, last failure)
        owners = self.state / "owners.json"
        self.owners = json.loads(owners.read_text(encoding="utf-8")) if owners.exists() else {}  # prompt_id -> account
        self.clients = {}     # websocket client id -> account (SNAP-R42: an id is never handed to another account)
        self.produced = {}    # account -> {(type, subfolder, filename)} its runs wrote
        self.lists = (0, {})  # (time, folder -> file names) from ComfyUI's /models
        self.http = None

    # ---- accounts and sessions (SNAP-R41, SNAP-R46, SNAP-R47) ---------------------------------------------------------
    def account(self, request):
        """The signed-in account name, or None. A session idle past the admin's limit locks until the person signs in
        again, and marks the request `idle` so the answer can say why; one past its expiry ends."""
        tok = request.cookies.get(COOKIE)
        if tok:
            key, now = sha(tok), time.time()
            s = self.sessions.load().get(key)
            if self.live(s) and s["account"] in self.accounts.load():
                s["seen"] = now
                if now - self.saved > 60:
                    self.save_sessions()
                return s["account"]
            if s and s["expires"] > now:
                request["idle"] = True
                if not s.get("locked"):
                    s["locked"] = True
                    self.save_sessions()
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            digest = sha(auth[7:].strip())
            for name, a in self.accounts.load().items():
                if a.get("token") and hmac.compare_digest(a["token"], digest):
                    return name
        return None

    def idle_seconds(self):
        return float(self.settings.load().get("idle_minutes", IDLE_MINUTES)) * 60

    def live(self, s):
        now = time.time()
        return s is not None and not s.get("locked") and s["expires"] > now and now - s["seen"] < self.idle_seconds()

    def save_sessions(self):
        self.sessions.all = {k: s for k, s in self.sessions.all.items() if s["expires"] > time.time()}
        self.sessions.save()
        self.saved = time.time()

    def wait(self, keys):
        """Seconds before these sign-in keys (("account", name), ("address", ip)) may try again."""
        now = time.time()
        return max([0] + [self.fails[k][1] - now for k in keys if k in self.fails])

    def failed(self, keys):
        now = time.time()
        for k in keys:
            n, _, last = self.fails.get(k, (0, 0, 0))
            n = n + 1 if now - last < FORGET else 1
            free = FREE_TRIES[k[0]]
            self.fails[k] = (n, now + min(WAIT_CAP, WAIT_FIRST * 2 ** (n - free)) if n >= free else 0, now)

    def signed_in(self, keys):
        for k in keys:
            self.fails.pop(k, None)

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

    def start_session(self, request, name, target):
        tok, now, sessions = secrets.token_urlsafe(32), time.time(), self.sessions.load()
        sessions.pop(sha(request.cookies.get(COOKIE, "")), None)  # the page's old (locked) session
        sessions[sha(tok)] = {"account": name, "expires": now + SESSION_SECONDS, "seen": now}
        self.save_sessions()
        resp = web.HTTPFound(target)
        resp.set_cookie(COOKIE, tok, httponly=True, samesite="Strict", max_age=SESSION_SECONDS, path="/")
        return resp

    async def login_page(self, request):
        target = safe_next(request.query.get("next"))
        token = request.query.get("token")
        if token:  # an agent's headless page signs in with its account token (snap_agent_page.sh)
            keys = [("address", request.remote)]
            if self.wait(keys) > 0:
                return page(target, "Too many tries.", 429, wait=self.wait(keys))
            digest = sha(token)
            for name, a in self.accounts.load().items():
                if a.get("token") and hmac.compare_digest(a["token"], digest):
                    self.signed_in(keys)
                    await self.comfy_user(name)
                    return self.start_session(request, name, target)
            self.failed(keys)
            await asyncio.sleep(0.5)
            return page(target, "That sign-in link has expired. Ask the admin for a new one.", 401, wait=self.wait(keys))
        if request.query.get("idle"):
            s = self.sessions.load().get(sha(request.cookies.get(COOKIE, "")))
            return page(target, name=s["account"] if s else "", note=f"Locked after {when(self.idle_seconds())} without use. Sign in to carry on; open pages keep their work.")
        return page(target)

    async def login(self, request):
        if cross_site(request):
            return web.Response(status=403)
        form = await request.post()
        name, password, target = str(form.get("username", "")).strip().lower(), str(form.get("password", "")), safe_next(form.get("next"))
        a = self.accounts.load().get(name)
        keys = [("address", request.remote)] + ([("account", name)] if a else [])
        if self.wait(keys) > 0:
            return page(target, "Too many tries.", 429, name, self.wait(keys))
        if not a or not hmac.compare_digest(a["hash"], scrypt(password, a["salt"])):
            self.failed(keys)
            await asyncio.sleep(0.5)
            return page(target, "That name and password don't match.", 401, name, self.wait(keys))
        self.signed_in(keys)
        await self.comfy_user(name)
        return self.start_session(request, name, target)

    async def logout(self, request):
        tok = request.cookies.get(COOKIE)
        if tok and self.sessions.load().pop(sha(tok), None):
            self.save_sessions()
        resp = web.HTTPFound("/gate/login")
        resp.del_cookie(COOKIE, path="/")
        return resp

    async def me(self, request):
        name = self.account(request)
        if name is None:
            return web.json_response({"error": "not signed in"}, status=401)
        a = self.accounts.load()[name]
        return web.json_response({"account": name, "role": a["role"], "max_rating": a["max_rating"]})

    # ---- the admin's ratings page (SNAP-R49) ------------------------------------------------------------------------
    async def admin_page(self, request):
        name = self.account(request)
        if name is None:
            raise web.HTTPFound("/gate/login?" + ("idle=1&" if request.get("idle") else "") + "next=/gate/admin")
        if not self.is_admin(name):
            return web.Response(status=403, text="Only the admin can rate files.")
        status, own = await self.userdata(name, "GET", GRAPH)
        mine = {base(e["file"]): str(e.get("rating")).lower() for e in own} if status == 200 and isinstance(own, list) else {}
        rated, content, helpers, unrated = self.ratings(), [], [], 0
        for folder, names in sorted((await self.model_lists()).items()):
            files = sorted(n for n in names if n.lower().endswith(MODEL_EXT))
            if not files:
                continue
            rows = []
            for n in files:
                own_level = CAPS[LEVELS[mine[base(n)]]] if mine.get(base(n)) in LEVELS else ""
                unrated += folder not in HELPER_FOLDERS and base(n) not in rated
                options = "".join(f'<option value="{v}"{" selected" if v == own_level else ""}>{label}</option>' for v, label in (("", "Unrated"), *SHOWN.items()))
                folder_part, _, file = n.replace("\\", "/").rpartition("/")
                rows.append(f'<li data-name="{html.escape(n.lower())}"><span class="f">{html.escape(folder_part + "/" if folder_part else "")}<b>{html.escape(file)}</b></span>'
                            f'<select data-file="{html.escape(base(n))}" data-v="{own_level}" aria-label="rating of {html.escape(file)}">{options}</select>'
                            f'<span class="as">{"" if own_level else "counts as " + SHOWN[CAPS[level(rated, folder, n)]]}</span></li>')
            (helpers if folder in HELPER_FOLDERS else content).append(f'<section><h2>{html.escape(folder)} <span>{len(files)}</span></h2><ul>{"".join(rows)}</ul></section>')
        body = "".join(content) + (f'<details><summary>Helper files: VAEs, text encoders, upscalers and the like. Unrated ones count as PG.</summary>{"".join(helpers)}</details>' if helpers else "")
        text = ADMIN.replace("{account}", html.escape(name)).replace("{unrated}", str(unrated)).replace("{body}", body or '<p class="intro">No model files yet.</p>')
        return web.Response(content_type="text/html", text=text)

    async def rate(self, request):
        """Write one file's `rating` in the signed-in admin's snap/models.json, the file the gate rates from."""
        name = self.account(request)
        if name is None or not self.is_admin(name) or cross_site(request):
            return web.json_response({"error": "Only the admin can rate files, from /gate/admin."}, status=403)
        body = await request.json()
        file, rating = base(body.get("file", "")), body.get("rating")
        if rating not in (None, *CAPS):
            return web.json_response({"error": "A rating is pg, mature, adult, or null for unrated."}, status=400)
        folders = [f for f, names in (await self.model_lists()).items() if file in {base(n) for n in names}]
        if not folders:
            return web.json_response({"error": f"There's no model file {file} here."}, status=404)
        status, own = await self.userdata(name, "GET", GRAPH)
        own = own if status == 200 else []
        if not isinstance(own, list):
            return web.json_response({"error": f"Your {GRAPH} doesn't parse; fix it before rating here."}, status=409)
        at = next((i for i, e in enumerate(own) if base(e.get("file")) == file), None)
        if at is None:
            own.append({"file": file, "rating": rating})
        else:
            own[at] = {**own[at], "rating": rating}
        status, out = await self.userdata(name, "POST", GRAPH, "?overwrite=true", json.dumps(own, indent=1))
        if status != 200:
            return web.json_response({"error": f"ComfyUI didn't save {GRAPH}: {out}"}, status=502)
        return web.json_response({"file": file, "rating": rating, "counts_as": SHOWN[CAPS[level(self.ratings(), folders[0], file)]]})

    # ---- ratings (SNAP-R43, SNAP-R44) -------------------------------------------------------------------------------
    def ratings(self):
        """File name -> level from the pack's model graph under the admins' own snap/models.json. Other accounts can write
        their own user data, so their model graphs never rate anything."""
        entries = {base(e["file"]): e for e in json.loads(PACK_GRAPH.read_text(encoding="utf-8"))["files"]}
        for a in self.accounts.load().values():
            f = self.user_dir / str(a.get("comfy_user")) / GRAPH
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
                if level(rated, folder, n) > cap:
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

    async def userdata(self, name, method, file="", query="", data=None):
        """(status, parsed JSON or raw text) of core's /userdata as this account's own ComfyUI user."""
        url = f"{self.upstream}/userdata" + (f"/{quote(file, safe='')}" if file else "") + query
        headers = {"comfy-user": await self.comfy_user(name), "Accept-Encoding": "identity"}
        async with self.http.request(method, url, headers=headers, data=data) as r:
            text = await r.text()
            try:
                return r.status, json.loads(text)
            except ValueError:
                return r.status, text

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

    async def own_presets(self, request, name, p, body):
        """A non-admin's side of the pack's shared preset folders (SNAP-R48): a save goes to its own user data as
        snap/presets/<dials|render>/<name>.json; its list is the shared presets, then its own; a load finds its own copy
        first. None: the request goes on to the pack."""
        root = next(r for r in PRESETS if p == r or p.startswith(r + "/"))
        folder, preset = "snap/presets/" + root.split("/")[2], p[len(root) + 1:]
        if not preset:
            shared = await self.get(root)
            status, files = await self.userdata(name, "GET", query="?dir=" + quote(folder))
            mine = sorted(f[:-5] for f in files if f.endswith(".json")) if status == 200 else []
            return web.json_response(shared + [n for n in mine if n not in shared])
        own, valid = f"{folder}/{preset}.json", re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", preset)
        if request.method == "GET" and valid:
            status, out = await self.userdata(name, "GET", own)
            return web.json_response(out) if status == 200 else None
        if request.method != "POST":
            return None
        if not valid:
            return web.json_response({"error": "preset name: letters, digits, '_' and '-' only (max 80)"}, status=400)
        answer = PRESETS[root](body)
        status, out = (409, None) if preset in await self.get(root) else await self.userdata(name, "POST", own, "?overwrite=false", json.dumps(answer))
        if status == 409:
            return web.json_response({"error": "Preset already exists. Choose a new name."}, status=409)
        return web.json_response(answer if status == 200 else {"error": str(out)}, status=status)

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
        sid, tok = cid, request.cookies.get(COOKIE)
        key = sha(tok) if name is not None and tok and sha(tok) in self.sessions.load() else None

        async def to_page():
            nonlocal sid
            async for m in up:
                if key and not self.live(self.sessions.load().get(key)):
                    break  # SNAP-R46: a locked or signed-out session's page gets nothing more; it reconnects after sign-in
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
            idle = request.get("idle", False)
            if request.method == "GET" and "text/html" in request.headers.get("Accept", ""):
                raise web.HTTPFound("/gate/login?" + ("idle=1&" if idle else "") + "next=" + quote(request.path_qs, safe=""))
            if idle:
                return web.json_response({"error": f"Locked after {when(self.idle_seconds())} without use: sign in again at /gate/login. Open pages keep their work.", "locked": True}, status=401)
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
            if p.startswith(tuple(PRESETS)):
                answer = await self.own_presets(request, name, p, body)
                if answer is not None:
                    return answer
            if m == "POST" and p == "/mainodes/dials/info":  # SNAP-R48: it rewrites a shared dial file in place
                return web.json_response({"error": "Dial files are shared: only the admin can change their info."}, status=403)
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


def level(rated, folder, name):
    """A listed file's level: its rating, else what SNAP-R44 gives an unrated file in that folder."""
    return rated.get(base(name), LEVELS["pg"] if folder in HELPER_FOLDERS else LEVELS["adult"])


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


def cross_site(request):
    origin = request.headers.get("Origin")
    return bool(origin) and origin.split("://", 1)[-1] != request.host


def when(seconds):
    """'40 seconds', '3 minutes': rounded up."""
    n, unit = (math.ceil(seconds), "second") if seconds < 60 else (math.ceil(seconds / 60), "minute")
    return f"{n} {unit}{'' if n == 1 else 's'}"


def page(target, error="", status=200, name="", wait=0, note=""):
    """The sign-in card, with the name filled in again. `wait` (seconds) says when to try again and holds the button until
    then (SNAP-R47)."""
    wait = math.ceil(wait)
    if wait:
        error += f" Try again in {when(wait)}."
    msg = (f'<p class="err" role="alert">{html.escape(error)}</p>' if error else "") + (f'<p class="note">{html.escape(note)}</p>' if note else "")
    text = LOGIN.replace("{next}", html.escape(target)).replace("{name}", html.escape(name)).replace("{message}", msg).replace("{wait}", str(wait))
    return web.Response(status=status, content_type="text/html", text=text, headers={"Retry-After": str(wait)} if wait else None)


CSS = """:root{color-scheme:dark;--bg:#111214;--card:#1a1b1f;--line:#2c2e35;--text:#ececf1;--dim:#9a9ca6;--accent:#6aa2ff;--err:#ff8a8a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
.mark{display:flex;align-items:center;gap:10px;font-weight:650;font-size:20px;margin-bottom:22px}
.mark i{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#6aa2ff,#b46aff 55%,#ff6a9a)}
input,select{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:#0f1013;color:var(--text);font:inherit}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
.err{color:var(--err);margin:14px 0 0;font-size:14px}
"""

LOGIN = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Snap</title><style>""" + CSS + """
body{min-height:100vh;display:grid;place-items:center;padding:16px}
form{width:min(360px,100%);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 26px}
label{display:block;color:var(--dim);font-size:13px;margin:14px 0 6px}
button{margin-top:22px;width:100%;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#0b1020;font:600 15px system-ui,sans-serif;cursor:pointer}
button:disabled{background:var(--line);color:var(--dim);cursor:default}
.note{color:var(--dim);margin:14px 0 0;font-size:14px}.foot{color:var(--dim);font-size:12.5px;margin:18px 0 0}
</style></head><body><form method="post" action="/gate/login"><div class="mark"><i></i>Snap</div>
<input type="hidden" name="next" value="{next}">
<label for="u">Name</label><input id="u" name="username" value="{name}" autocomplete="username" autofocus required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
{message}<button type="submit" data-wait="{wait}">Sign in</button><p class="foot">Accounts are set up by this machine's admin.</p></form>
<script>{if(document.getElementById("u").value)document.getElementById("p").focus();
const b=document.querySelector("button"),end=Date.now()+1000*b.dataset.wait;
const tick=()=>{const s=Math.ceil((end-Date.now())/1000);b.disabled=s>0;b.textContent=s>0?`Try again in ${s<60?s+" s":Math.ceil(s/60)+" min"}`:"Sign in";if(s>0)setTimeout(tick,250);};tick();}</script></body></html>"""

ADMIN = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ratings · Snap</title><style>""" + CSS + """
main{max-width:860px;margin:0 auto;padding:28px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}header .mark{margin:0}.mark small{color:var(--dim);font-weight:500}
.who{color:var(--dim);font-size:13.5px}.who a{color:var(--accent);text-decoration:none;margin-left:12px}
.intro{color:var(--dim);font-size:14px;margin:14px 0 18px;max-width:660px}
.bar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.bar input{max-width:320px}
#status{font-size:13.5px;color:var(--dim)}#status.bad{color:var(--err)}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:14px;overflow:hidden}
h2{font-size:13px;font-weight:600;color:var(--dim);margin:0;padding:12px 18px 8px}h2 span{font-weight:500;opacity:.7;margin-left:4px}
ul{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:minmax(0,1fr) 128px 132px;gap:12px;align-items:center;padding:8px 18px;border-top:1px solid var(--line)}
.f{overflow-wrap:anywhere;font-size:14px;color:var(--dim)}.f b{color:var(--text);font-weight:500}
li select{padding:7px 10px;border-left:4px solid var(--line)}
select[data-v=pg]{border-left-color:#5fd38d}select[data-v=mature]{border-left-color:#f2b84b}select[data-v=adult]{border-left-color:#ff6a9a}
.as{color:var(--dim);font-size:12.5px}
summary{cursor:pointer;color:var(--dim);font-size:14px;margin:20px 0 12px}
@media(max-width:560px){li{grid-template-columns:minmax(0,1fr) 116px}.as{grid-column:1/-1;margin-top:-6px}}
</style></head><body><main><header><div class="mark"><i></i>Snap <small>· Ratings</small></div>
<div class="who">{account}<a href="/">Open Snap</a><a href="/gate/logout">Sign out</a></div></header>
<p class="intro">PG accounts see PG files, Mature accounts PG and Mature, Adult accounts everything. A file nobody has rated
counts as Adult until you rate it ({unrated} unrated now). Changes apply at once and are kept in your snap/models.json.</p>
<div class="bar"><input id="q" type="search" placeholder="Filter files" aria-label="Filter files"><span id="status" role="status"></span></div>
{body}</main>
<script>
const status = (text, bad) => { const s = document.getElementById("status"); s.textContent = text; s.className = bad ? "bad" : ""; };
for (const sel of document.querySelectorAll("li select")) sel.addEventListener("change", async () => {
  sel.disabled = true;
  try {
    const r = await fetch("/gate/admin/rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: sel.dataset.file, rating: sel.value || null }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    for (const s of document.querySelectorAll(`li select[data-file="${CSS.escape(d.file)}"]`)) {
      s.value = d.rating || ""; s.dataset.v = d.rating || "";
      s.closest("li").querySelector(".as").textContent = d.rating ? "" : "counts as " + d.counts_as;
    }
    status(`Saved: ${d.file} is ${d.rating ? sel.selectedOptions[0].text : "unrated (counts as " + d.counts_as + ")"}.`);
  } catch (e) { status("Not saved: " + e.message, true); }
  finally { sel.disabled = false; }
});
document.getElementById("q").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  for (const li of document.querySelectorAll("li")) li.hidden = !li.dataset.name.includes(q);
  for (const sec of document.querySelectorAll("section")) sec.hidden = !sec.querySelector("li:not([hidden])");
  if (q) for (const d of document.querySelectorAll("details")) d.open = true;
});
</script></body></html>"""


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
        app.router.add_get("/gate/admin", gate.admin_page)
        app.router.add_post("/gate/admin/rating", gate.rate)
    app.router.add_route("*", "/{tail:.*}", gate.handle)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, args.listen, args.port).start()
    print(f"snap-gate {'off (pass-through)' if args.disabled else 'on'}: http://{args.listen}:{args.port} -> {args.upstream}", flush=True)
    await asyncio.Event().wait()


def account_cli(args):
    accounts = StateFile(args.state, "accounts.json")
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
        all_[args.name]["token"] = sha(token)
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


def settings_cli(args):
    settings = StateFile(args.state, "settings.json")
    s = settings.load()
    if args.idle_minutes is not None:
        s["idle_minutes"] = args.idle_minutes
        settings.save()
    print(f"idle_minutes {s.get('idle_minutes', IDLE_MINUTES):g}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--listen", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8197)
    s.add_argument("--upstream", default="http://127.0.0.1:8198")
    s.add_argument("--comfy-dir", required=True, help="ComfyUI's base directory (its user/ folder holds the admins' model graph)")
    s.add_argument("--state", required=True, help="the gate's own folder: accounts.json, sessions.json, settings.json, owners.json (keep it outside ComfyUI's user/)")
    s.add_argument("--disabled", action="store_true", help="relay everything unchanged: no sign-in, no filtering")
    a = sub.add_parser("account")
    a.add_argument("action", choices=["add", "set", "token", "list"])
    a.add_argument("name", nargs="?", default="")
    a.add_argument("--role", choices=list(ROLES))
    a.add_argument("--max-rating", choices=CAPS)
    a.add_argument("--password-file")
    a.add_argument("--state", required=True)
    t = sub.add_parser("settings", help="the admin's settings; prints them")
    t.add_argument("--idle-minutes", type=float, help=f"sign in again after this long without a request (default {IDLE_MINUTES})")
    t.add_argument("--state", required=True)
    args = parser.parse_args()
    if args.cmd == "serve":
        asyncio.run(serve(args))
    elif args.cmd == "account":
        account_cli(args)
    else:
        settings_cli(args)


if __name__ == "__main__":
    main()
