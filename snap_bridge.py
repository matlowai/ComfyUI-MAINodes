"""The /mainodes/snap routes: Library cards, semantic Library search, and a local bridge so CLI agents
(tools/snap_mcp.py) call the same Snap tools the open page runs.
The page owns the graph, so the server only relays a call to it over the websocket and waits for the page's answer.
Also the metadata switch on saved files: a prompt queued with Snap's metadata off saves without its prompt and workflow,
and private takes are marked for the lock badge and the export (SNAP-R20); and the copy score Snap's camera plates and
take checks run in the queue (SNAP-R21); and onboarding's kits (SNAP-R25).
SNAP-R12 identity LoRAs are private · SNAP-R18 local only · SNAP-R20 metadata switch, private takes marked · SNAP-R25 onboarding
proposes, never downloads · SNAP-R27 locks follow the current rules · SNAP-R30 the agent front door: pages per user, a
health listing, errors that say what to do · SNAP-R33 the rating cap's second line · SNAP-R36 quiet sound ·
SNAP-R37 privacy per install · SNAP-R38 metadata off writes none, the rest is named · SNAP-R39 ratings from how a thing
was made · SNAP-R65 the Work card's jobs and progress, an agent page's own screenshot · SNAP-R74 Load Audio lists input/snap/ ·
SNAP-R139 proposals kept on the server · SNAP-R78 a stale tab says so, agents ask (request_reload), the person reloads · SNAP-R83 the agents' window: one visible
Chrome agents drive, reload and restart, the default with the person's tab; never headless · SNAP-R96 private takes saved
encrypted (snap_vault_server.py) · SNAP-R98 their ffmpeg steps work in RAM scratch · SNAP-R93/R94 the pack's notes end
the bridge tools' descriptions, /info names the docs and skills, a call names its agent · SNAP-R135 a hold on a page ends
with its job: use_page null, the MCP connection closing, or 10 idle minutes; the page shows the idle time · see docs/snap/SNAP_RULES.md"""
import asyncio
import glob
import hashlib
import itertools
import json
import logging
import os
import re
import secrets
import subprocess
import uuid
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

import time

import aiohttp
import numpy as np
import torch
from aiohttp import web

from comfy.cli_args import args
import folder_paths
import nodes
from comfy_api.latest import InputImpl, io
from comfy_execution.progress import get_progress_state
from comfy_execution.utils import get_executing_context
from comfy_extras.nodes_video import SaveVideo
from server import PromptServer

from . import snap_faces, snap_instructions, snap_privacy
from .dials import core as dial_core
try:
    from . import snap_vault_server
except ImportError as e:  # the vault needs the `cryptography` package (pyproject); private takes on a privacy-on install are then refused
    snap_vault_server = None
    vault_missing = f"{e}"

from .video_out import MAIVideoOut

TIMEOUT = 30
# the tabs that registered, oldest first: websocket client id -> the ComfyUI user whose page it is (the comfy-user header,
# set by snap-gate per account), when it registered and when it last answered, the Snap code it loaded, whether it is a
# headless (agent's) page, whether its person turned "Let agents see" on, and its tool table. A call goes to a page of the
# caller's own user that is still connected, so one account's agent never drives another's page (U72 F20), and
# "Let agents see" is what lets agents drive a person's tab (the operator, 2026-11-05: "this is the whole point of this control")
pages = {}
PACK = Path(__file__).parent
PAGE_SH = PACK / "tools" / "snap_agent_page.sh"
WEB = PACK / "web"


def served_code():
    """A short hash of the Snap code the server serves now (each web file's name, size and change time): a page that
    loaded other code runs older code than a reload would give it."""
    h = hashlib.sha1()
    for p in sorted(WEB.rglob("*.js")):
        st = p.stat()
        h.update(f"{p.relative_to(WEB)}|{st.st_size}|{st.st_mtime_ns}".encode())
    return h.hexdigest()[:12]


def user_of(request):
    try:
        return PromptServer.instance.user_manager.get_request_user_id(request)
    except KeyError as e:  # a --multi-user server needs the comfy-user header (snap-gate sets it per account)
        raise web.HTTPForbidden(text=json.dumps({"error": f"{e.args[0]}: send your ComfyUI user as the comfy-user header"}), content_type="application/json")


def open_pages(user):
    """This user's tabs still connected, oldest first (a closed tab hands back to the one before)."""
    return [c for c, p in pages.items() if p["user"] == user and c in PromptServer.instance.sockets]


def chosen(user, code=None, target=None):
    """The page calls go to: the page `target` names (an agent bound with use_page); else the newest visible tab agents
    see: the agents' window or a tab whose person turned "Let agents see" on (SNAP-R83: the person's main tab is the
    default). While a person's tab is open nothing else is picked by default: a tab with the control off is never
    driven, and calls never go to a hidden page instead. Only a server with no person's tab at all (a test server) falls
    back to an agent's headless page, one running the code the server serves now first, newest first."""
    found, code = open_pages(user), code or served_code()
    if target:
        return target if target in found else None
    seeing = [c for c in found if pages[c]["sees"] and not pages[c]["headless"]]
    if seeing:
        return seeing[-1]
    if any(not pages[c]["headless"] for c in found):
        return None
    agents = [c for c in found if pages[c]["headless"]]
    return max(agents, key=lambda c: (pages[c]["code"] == code, agents.index(c))) if agents else None


def stale_note(client, base):
    p = pages[client]
    # registered_first is when this server first heard from the tab (a tab open across a restart re-registers then), not
    # when its code was loaded
    since = f"connected to this server since {time.strftime('%H:%M', time.localtime(p['registered_first']))}" + ("" if p["code"] else ", from before pages reported their code")
    who = "an agent's page" if p["headless"] else "a person's visible tab"
    ask = (" It shows its person a 'Snap was updated: reload' bar; request_reload shows it again with your name." if p["banner"] and not p["headless"]
           else " Its code is older than the reload bar, so ask its person to reload it." if not p["headless"] else "")
    if p.get("managed"):
        return (f"This Snap page (the agents' window, {since}) runs older Snap code than the server serves now, so tools added since are missing. "
                f"Reload it yourself: the chrome tool {{\"action\": \"reload\"}} (or bash {PAGE_SH} {base} reload).")
    return (f"This Snap page ({who}, {since}) runs older Snap code than the server serves now, so tools added since are missing.{ask} "
            f"Or use the agents' window, which you reload yourself: bash {PAGE_SH} {base} (it starts the visible window if it isn't open; never headless).")


def page_name(c):
    """How a page reads to agents and people: whose it is, its id's first six characters, and the tab it shows."""
    p = pages[c]
    whose = (f"agent page{f' ({drivers[c]})' if c in drivers else ''}" if p["headless"] else "agents' window" if p.get("managed")
             else f"{p.get('who') or 'person'}'s tab")
    return f"{whose} {c[:6]} · {p.get('title') or 'Snap'}"


def find_page(user, ref):
    """A page of this user named by its id, a unique start of its id, or its name."""
    found = open_pages(user)
    hits = [c for c in found if c == ref] or [c for c in found if c.startswith(ref)] or [c for c in found if page_name(c) == ref]
    return hits[0] if len(hits) == 1 else None


UNNAMED = "an unnamed agent"


def agent_of(request):
    return request.headers.get("X-Snap-Agent") or UNNAMED


def health(user, agent=None, target=None):
    now, found, code = time.time(), open_pages(user), served_code()
    to = chosen(user, code, target or bound.get((user, agent)))
    return [{"id": c, "name": page_name(c), "title": pages[c].get("title"), "who": pages[c].get("who"), "driven_by": drivers.get(c), **({"driver_idle_s": round(now - touched.get(c, now))} if c in drivers else {}), "yours": bound.get((user, agent)) == c, "registered_s_ago": round(now - pages[c]["registered"]), "last_answer_s_ago": None if pages[c]["answered"] is None else round(now - pages[c]["answered"]),
             "code_current": pages[c]["code"] == code, "headless": pages[c]["headless"], "managed": pages[c].get("managed", False), "sees": pages[c]["sees"], "tools": len(pages[c]["tools"]), "calls_go_here": c == to} for c in found]
pending = {}       # call id -> (future answered by /mainodes/snap/result, the page it was sent to)
# Which agent drives which page (the operator, 2026-11-05: "easily select which web ui instance you want to interact with and
# not collide"). An agent names itself with the X-Snap-Agent header (snapcall.py: SNAP_AGENT; snap_mcp.py: one name per
# connection); use_page binds it to a page for its session and makes it that page's one driver; the page shows "Driven
# by" with a Release button. Another agent reaching a driven page gets an error naming the driver, never a silent switch.
drivers = {}   # page client id -> the agent driving it
touched = {}   # page client id -> when its driver last called (a hold idle for HOLD_IDLE_S lapses, SNAP-R135)
HOLD_IDLE_S = 600
lapsed = {}    # (user, agent) -> what its hold lapsed on (said once, on its next call)
bound = {}     # (user, agent) -> page client id
released = {}  # (user, agent) -> the page name the person released from it (said once, on its next call)


def error(message, status=400):
    return web.json_response({"error": message}, status=status)


async def lapse(user):
    """SNAP-R135: a hold whose driver made no call for HOLD_IDLE_S ends by itself (the blind critic finished its run and
    left the agents' window 'Driven by: critic-v10' until someone released it); its agent hears so on its next call"""
    now = time.time()
    for c in [c for c, a in drivers.items() if c in pages and pages[c]["user"] == user and now - touched.get(c, now) > HOLD_IDLE_S]:
        agent = drivers.pop(c)
        bound.pop((user, agent), None)
        lapsed[(user, agent)] = f"{page_name(c)} (no call from {agent} for {round((now - touched.pop(c)) / 60)} min)"
        await PromptServer.instance.send("mainodes-snap-driver", {"agent": None}, c)


def held_by(client, agent):
    """the refusal for a call or use_page on a page another agent drives; F-E23: an unnamed call says it is unnamed"""
    idle = round((time.time() - touched.get(client, time.time())) / 60)
    unnamed = "This call carries no agent name (set SNAP_AGENT for snapcall.py, or the X-Snap-Agent header), so it can't be the page's driver. " if agent == UNNAMED else ""
    return error(f"{unnamed}{page_name(client)} is driven by {drivers[client]} (last call {idle} min ago; a hold lapses after {HOLD_IDLE_S // 60} idle min): pick another page (list_pages, use_page), or ask the person to press Release on it.", 409)


routes = PromptServer.instance.routes


@routes.post("/mainodes/snap/register")
async def register(request):
    body = await request.json()
    for c in [c for c in pages if c not in PromptServer.instance.sockets]:
        del pages[c]
        drivers.pop(c, None)
        touched.pop(c, None)
    was = pages.pop(body["client"], None)  # re-registering (focus, reconnect) makes it the newest
    now = time.time()
    # SNAP-R83: a tab in the agents' window is found by its client id among that Chrome's pages; it counts as a tab that sees
    managed = not body.get("headless") and body["client"] in {c for _, c in await chrome_pages()}
    pages[body["client"]] = {"user": user_of(request), "registered": now, "registered_first": was["registered_first"] if was else now, "answered": None,
                             "code": body.get("code"), "headless": bool(body.get("headless")), "managed": managed, "sees": bool(body.get("sees")) or managed, "tools": body["tools"],
                             "title": body.get("title"), "who": body.get("who"), "banner": bool(body.get("banner"))}
    return web.json_response({"tools": len(body["tools"]), "code_current": body.get("code") == served_code(), "driven_by": drivers.get(body["client"]), "managed": managed})


@routes.post("/mainodes/snap/page")
async def page_info(request):
    """A page says which tab or shot it shows now (its name follows), without becoming the newest page."""
    body = await request.json()
    if body.get("client") in pages and pages[body["client"]]["user"] == user_of(request):
        pages[body["client"]]["title"] = body.get("title")
    return web.json_response({})


@routes.post("/mainodes/snap/release")
async def release(request):
    """The person's Release on a driven page: its agent lets go, and hears so on its next call."""
    body = await request.json()
    client, user = body.get("client"), user_of(request)
    agent = drivers.pop(client, None) if client in pages and pages[client]["user"] == user else None
    if agent:
        touched.pop(client, None)
        bound.pop((user, agent), None)
        released[(user, agent)] = page_name(client)
        await PromptServer.instance.send("mainodes-snap-driver", {"agent": None}, client)
    return web.json_response({"released": agent})


BRIDGE_TOOLS = [
    {"name": "list_pages", "description": "Every Snap page of yours on this server: id, name (whose it is, the id's first six characters, the tab or shot it shows), title, headless (an agent's own page), sees (its person lets agents see and drive it), driven_by (the agent holding it, if any), driver_idle_s (seconds since that agent's last call; a hold lapses after 600), yours (you hold it) and calls_go_here (where your next call goes). Pick one with use_page.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}},
    {"name": "use_page", "description": "Bind yourself to one Snap page for this session: your calls go there until you pick another, pass null, or the person presses Release on it. When your job ends, pass null: a finished agent that keeps a hold leaves the page 'Driven by' it (a hold with no call for 10 minutes lapses by itself, SNAP-R135). One agent drives a page at a time: a page another agent holds is refused, naming it. page: an id, the start of one, or a name from list_pages. Name yourself with the X-Snap-Agent header (snapcall.py: SNAP_AGENT; snap_mcp.py names each connection), or every unnamed caller shares one binding.",
     "inputSchema": {"type": "object", "properties": {"page": {"type": ["string", "null"]}}, "required": ["page"]}},
    {"name": "chrome", "description": "The agents' window (SNAP-R83): one visible Chrome on this machine, with its own profile and a localhost DevTools port, that agents drive, reload and restart; never headless. It counts as a tab that sees, so with no use_page your calls go to it (or to the person's newest tab with 'Let agents see' on). action status (default): whether it runs, its DevTools port, and each tab in it (url, title, the Snap page it is, its code_current, who drives it). reload: reload its Snap tabs (page: one of them, an id, the start of one or a name), e.g. after this ComfyUI restarted, and wait until each registers again with the code the server serves now. start: open it if it isn't running (and a Snap tab in it if it has none). restart: close it (every process of its profile) and open it again. Nothing here works headless: start and restart need a display.",
     "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["status", "reload", "start", "restart"]}, "page": {"type": "string"}}}},
    {"name": "request_reload", "description": "Ask the person to reload a Snap tab that runs older Snap code than the server serves now (list_pages: code_current false): the tab shows a 'Snap was updated: reload to get the new tools' bar with your name (X-Snap-Agent) and a Reload button. It never reloads the tab itself; the person does (SNAP-R5). page: an id, the start of one, or a name from list_pages (default: the page your calls go to). Answers whether the bar was shown; a tab whose code predates the bar can't show it, so say it in words to the person.",
     "inputSchema": {"type": "object", "properties": {"page": {"type": "string"}}}},
]


async def bridge_tool(request, user, agent, tool, args):
    if tool == "chrome":
        return await chrome_tool(request, user, args)
    if tool == "list_pages":
        await lapse(user)
        return web.json_response({"result": {"pages": health(user, agent), "you": agent}})
    if tool == "request_reload":
        client = find_page(user, args["page"]) if args.get("page") else chosen(user, target=bound.get((user, agent)))
        if not client:
            return error(f"No open Snap page {args.get('page')!r} of yours; your pages: {'; '.join(page_name(c) for c in open_pages(user)) or 'none'} (list_pages).", 404)
        if pages[client]["code"] == served_code():
            return web.json_response({"result": {"page": page_name(client), "shown": False, "said": f"{page_name(client)} runs the Snap code the server serves now: nothing to reload"}})
        if not pages[client]["banner"]:
            return web.json_response({"result": {"page": page_name(client), "shown": False, "said": f"{page_name(client)} runs Snap code from before the reload bar, so it can't show it: ask its person in words to reload the tab"}})
        await PromptServer.instance.send("mainodes-snap-reload", {"agent": agent}, client)
        return web.json_response({"result": {"page": page_name(client), "shown": True, "said": f"{page_name(client)} shows 'Snap was updated: reload to get the new tools ({agent} asked)'; the person reloads it, nothing reloads by itself"}})
    await lapse(user)
    ref = args.get("page")
    was = bound.pop((user, agent), None)
    if was and drivers.get(was) == agent:
        del drivers[was]
        touched.pop(was, None)
        await PromptServer.instance.send("mainodes-snap-driver", {"agent": None}, was)
    if ref is None:
        return web.json_response({"result": {"page": None, "said": f"{agent} drives no page now: calls go where the defaults say (list_pages)"}})
    client = find_page(user, ref)
    if not client:
        return error(f"No open Snap page {ref!r} of yours; your pages: {'; '.join(page_name(c) for c in open_pages(user)) or 'none'} (list_pages).", 404)
    if drivers.get(client, agent) != agent:
        return held_by(client, agent)
    drivers[client], bound[(user, agent)], touched[client] = agent, client, time.time()
    released.pop((user, agent), None)
    lapsed.pop((user, agent), None)
    await PromptServer.instance.send("mainodes-snap-driver", {"agent": agent}, client)
    return web.json_response({"result": {"page": {"id": client, "name": page_name(client)}, "said": f"{agent} now drives {page_name(client)}; the page shows it and its person can Release it. When your job ends, use_page {{page: null}} lets it go (an idle hold lapses after {HOLD_IDLE_S // 60} min)"}})


@routes.get("/mainodes/snap/tools")
async def listing(request):
    """The tool table of the page calls go to, and the caller's open Snap pages: each one's id (the X-Snap-Page header
    names one), when it registered and last answered, whether it runs the code the server serves now, whether it is an
    agent's own page, whether its person lets agents see (and drive) it, and where calls go (a health check)."""
    user, agent = user_of(request), agent_of(request)
    target = request.headers.get("X-Snap-Page")
    to = chosen(user, target=find_page(user, target) if target else bound.get((user, agent)))
    out = {"tools": (pages[to]["tools"] if to else []) + [{**t, "description": t["description"] + snap_instructions.tail(t["name"])} for t in BRIDGE_TOOLS], "pages": health(user, agent, find_page(user, target) if target else None), "code": served_code()}
    if to and pages[to]["code"] != out["code"]:
        out["warning"] = stale_note(to, f"{request.scheme}://{request.host}")
    return web.json_response(out)


@routes.get("/mainodes/snap/info")
async def info(request):
    """Where this server and its Snap live (U72 F22): the pack folder (tools/snap_agent_page.sh, tools/snapcall.py are in
    it), the code it serves, ComfyUI's base, input and output folders. ?input=<path> says whether that file is in input/."""
    q = {"pack": str(PACK), "code": served_code(), "agent_page": str(PAGE_SH), "snapcall": str(PACK / "tools" / "snapcall.py"), "mcp": str(PACK / "tools" / "snap_mcp.py"),
         "base": str(Path(folder_paths.base_path)), "input": folder_paths.get_input_directory(), "output": folder_paths.get_output_directory(),
         "upload": "POST /upload/image (multipart: image=<file>, subfolder=snap) puts a picture into input/; its value is <subfolder>/<name>", **snap_instructions.info()}
    if "input" in request.query:
        root = os.path.abspath(folder_paths.get_input_directory())
        path = os.path.abspath(os.path.join(root, request.query["input"]))
        q["input_exists"] = os.path.commonpath((root, path)) == root and os.path.isfile(path)
        if q["input_exists"]:  # F-C30: what the file is, and same-named uploads that came later ("x (1).wav")
            q["input_sha256"] = await asyncio.to_thread(lambda: hashlib.sha256(Path(path).read_bytes()).hexdigest())
            stem, ext, when = *os.path.splitext(path), os.path.getmtime(path)
            stem = re.sub(r" \(\d+\)$", "", stem)  # "x (1).wav" and "x.wav" are uploads of one name
            same = glob.glob(f"{glob.escape(stem)}{glob.escape(ext)}") + glob.glob(f"{glob.escape(stem)} (*){glob.escape(ext)}")
            q["input_newer"] = sorted(os.path.relpath(f, root).replace(os.sep, "/") for f in same if f != path and os.path.getmtime(f) > when)
    return web.json_response(q)


@routes.get("/mainodes/snap/input_audio")
async def input_audio(request):
    """Audio files Snap put under input/snap/ (uploads with subfolder=snap, Cast voices), as Load Audio values: core Load
    Audio lists only the input folder's top level (anime dogfood F-C08, SNAP-R74)"""
    root = os.path.join(folder_paths.get_input_directory(), "snap")
    found = [os.path.relpath(os.path.join(d, f), folder_paths.get_input_directory()).replace(os.sep, "/") for d, _, fs in os.walk(root) for f in fs]
    return web.json_response(sorted(folder_paths.filter_files_content_types(found, ["audio"])))


@routes.post("/mainodes/snap/input_exists")
async def input_exists(request):
    """Which of these input/ paths are files on this server (UI-08, SNAP-R119): core lists only the input folder's top
    level, so a picture in a subfolder read "missing" though it renders. {files: [path, ...]} -> {files: {path: bool}};
    a path outside input/ is false"""
    files = (await request.json()).get("files") or []
    root = os.path.abspath(folder_paths.get_input_directory())

    def there(f):
        p = os.path.abspath(os.path.join(root, f))
        return os.path.commonpath((root, p)) == root and os.path.isfile(p)
    return web.json_response({"files": {f: there(f) for f in files if isinstance(f, str)}})


@routes.post("/mainodes/snap/call")
async def call(request):
    body = await request.json()
    base = f"{request.scheme}://{request.host}"
    user, agent, code = user_of(request), agent_of(request), served_code()
    if body.get("tool") in {t["name"] for t in BRIDGE_TOOLS}:
        return await bridge_tool(request, user, agent, body["tool"], body.get("args") or {})
    if (user, agent) in released:
        return error(f"The person pressed Release on {released.pop((user, agent))}, so {agent} drives no page now: pick one (list_pages, use_page) and call again.", 409)
    await lapse(user)
    if (user, agent) in lapsed:
        return error(f"Your hold on {lapsed.pop((user, agent))} lapsed, so {agent} drives no page now: pick one (list_pages, use_page) and call again.", 409)
    target = request.headers.get("X-Snap-Page") or body.get("page")
    client = chosen(user, code, (find_page(user, target) or target) if target else bound.get((user, agent)))
    if client and drivers.get(client, agent) != agent:
        return held_by(client, agent)
    if client in drivers:
        touched[client] = time.time()
    if not client:
        if (user, agent) in bound:
            bound.pop((user, agent))
            return error(f"The page {agent} was driving closed: pick another (list_pages, use_page) and call again.", 409)
        if target:
            return error(f"No open Snap page {target!r} of yours (X-Snap-Page); your open pages: {', '.join(open_pages(user)) or 'none'} (GET /mainodes/snap/tools lists them).", 404)
        tabs = [c for c in open_pages(user) if not pages[c]["headless"]]
        return error((f"Your Snap tab{'s have' if len(tabs) > 1 else ' has'} 'Let agents see' off, so agents don't drive {'them' if len(tabs) > 1 else 'it'}, and calls never go to another page instead (SNAP-R83): ask the person to press it in Snap's top bar, or use "
                      if tabs else f"No Snap page is open for you on this ComfyUI: it may have been locked or closed. Ask the person to open {base}/?snap and press 'Let agents see', or open ")
                     + f"the agents' window: bash {PAGE_SH} {base} (or the chrome tool {{\"action\": \"start\"}}): a visible Chrome, never headless; it returns once the page has registered.", 503)
    stale = pages[client]["code"] != code
    if body.get("tool") not in {t["name"] for t in pages[client]["tools"]}:
        return error(f"Unknown Snap tool {body.get('tool')!r}: GET /mainodes/snap/tools lists them." + (f" {stale_note(client, base)}" if stale else ""), 404)
    call_id = secrets.token_hex(8)
    pending[call_id] = (asyncio.get_running_loop().create_future(), client)
    await PromptServer.instance.send("mainodes-snap-call", {"id": call_id, "tool": body["tool"], "args": body.get("args") or {}, "agent": agent}, client)  # the agent names what it writes (SNAP-R95)
    page = {"id": client, "name": page_name(client), "headless": pages[client]["headless"], "sees": pages[client]["sees"], "driven_by": drivers.get(client), "code_current": not stale}
    try:
        out = await asyncio.wait_for(pending[call_id][0], TIMEOUT)
        if stale:  # said inside the answer, where every client shows it
            note = stale_note(client, base)
            if "error" in out:
                out["error"] = f"{out['error']} ({note})"
            elif isinstance(out.get("result"), dict):
                out["result"] = {**out["result"], "page_warning": note}
            else:
                out["warning"] = note
        return web.json_response({**out, "page": page})
    except TimeoutError:
        return error(f"The Snap page did not answer within {TIMEOUT} s. Long work returns at once (run, then run_status with wait_s); "
                     "GET /mainodes/snap/tools shows when your page last answered.", 504)
    finally:
        pending.pop(call_id, None)


@routes.post("/mainodes/snap/result")
async def result(request):
    body = await request.json()
    future, client = pending.get(str(body.get("id")), (None, None))
    if future and not future.done() and body.get("client") == client:  # only the page the call went to answers it
        pages.get(client, {})["answered"] = time.time()
        future.set_result({k: body[k] for k in ("result", "error") if k in body})
    return web.json_response({})


# The Work card's sources (SNAP-R65): every job on the queue and in the history, each with its Snap job stamp, read in one
# pass without copying prompts or workflows; and the running prompt's per-node progress, so a page that didn't queue it
# (another tab, an agent's page) shows a percentage too. Read-only: core's routing is not patched.
def job_row(prompt_id, extra, state, history=None):
    row = {"id": prompt_id, "state": state, "job": extra.get("snap_job"), "client": extra.get("client_id"), "user": extra.get("snap_user")}
    if history is None:
        return row
    status = history.get("status") or {}
    for name, data in status.get("messages") or []:
        if name == "execution_start":
            row["started"] = data.get("timestamp")
        elif name in ("execution_success", "execution_error", "execution_interrupted"):
            row["finished"] = data.get("timestamp")
            if name == "execution_error":
                row["error"] = {k: data.get(k) for k in ("node_id", "node_type", "exception_type", "exception_message", "traceback")}
            if name == "execution_interrupted":
                row["state"] = "interrupted"
    row["state"] = row["state"] if row["state"] == "interrupted" else ("success" if status.get("status_str") == "success" else "error" if status.get("status_str") == "error" else "done")
    row["outputs"] = [{"node": node, "filename": f["filename"], "subfolder": f.get("subfolder", ""), "type": f.get("type", "output")}
                      for node, out in (history.get("outputs") or {}).items() for v in out.values() if isinstance(v, list) for f in v if isinstance(f, dict) and f.get("filename")]
    return row


@routes.get("/mainodes/snap/jobs")
async def jobs(request):
    """The queue (running, then pending in order) and every history entry that finished at or after `since` (ms since
    the epoch; default the last 24 hours), as rows {id, state, job, client, user, started, finished, error, outputs}.
    Nothing is left out by count (SNAP-R58); `since` is the only window and the answer names it."""
    since = float(request.query.get("since", time.time() * 1000 - 86400000))
    q = PromptServer.instance.prompt_queue
    running, pending = q.get_current_queue_volatile()
    done = q.get_history(map_function=lambda h: job_row(h["prompt"][1], h["prompt"][3], "done", h))
    rows = [job_row(i[1], i[3], "running") for i in running] + [job_row(i[1], i[3], "queued") for i in sorted(pending, key=lambda i: i[0])]
    rows += [r for r in done.values() if (r.get("finished") or r.get("started") or 0) >= since]
    for r in rows:  # F-C25: a finished job whose page closed is adopted by another page (POST /mainodes/snap/adopt)
        r["client_open"] = r["client"] in PromptServer.instance.sockets
    return web.json_response({"since": since, "rows": rows, "count": len(rows)})


adopted = set()  # prompt ids whose take a page has taken on writing (one page each)


@routes.post("/mainodes/snap/adopt")
async def adopt(request):
    """F-C25: a finished job whose queuing page closed has no take yet; the first live page that asks writes it, every
    later one hears it is taken, so two open pages never write it twice. {id} -> {mine}"""
    body = await request.json()
    pid = str(body.get("id"))
    mine = pid not in adopted
    adopted.add(pid)
    return web.json_response({"id": pid, "mine": mine})


PROPOSALS = "snap/proposals.json"
ANSWERS = ("accepted", "rejected", "failed", "withdrawn")
proposals_lock = asyncio.Lock()


def read_proposals(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@routes.get("/mainodes/snap/proposals")
async def proposals(request):
    """SNAP-R139: agents' proposals live here, not in the page that made them, so a reload or a second page keeps them"""
    async with proposals_lock:
        return web.json_response({"rows": read_proposals(PromptServer.instance.user_manager.get_request_user_filepath(request, PROPOSALS))})


@routes.post("/mainodes/snap/proposals")
async def proposals_write(request):
    """{add: {tool, args, reason, ...}} -> the row with the next id (p1, p2, ...); {id, status, result} answers one:
    running only from waiting (so one page applies it), an answer from waiting or running"""
    q = await request.json()
    path = PromptServer.instance.user_manager.get_request_user_filepath(request, PROPOSALS)
    async with proposals_lock:
        rows = read_proposals(path)
        if q.get("add"):
            row = {**q["add"], "id": f"p{max([int(r['id'][1:]) for r in rows] or [0]) + 1}", "status": "waiting", "created": int(time.time() * 1000)}
            rows.append(row)
        else:
            row = next((r for r in rows if r["id"] == q.get("id")), None)
            if row is None:
                return web.json_response({"error": f"No proposal {q.get('id')} (list_proposals lists them)"}, status=404)
            status = q.get("status")
            if status not in ("running", *ANSWERS):
                return web.json_response({"error": f"status is running or one of {', '.join(ANSWERS)}; not {status!r}"}, status=400)
            if row["status"] not in (("waiting",) if status == "running" else ("waiting", "running")):
                return web.json_response({"error": f"{row['id']} is {row['status']} already", "row": row}, status=409)
            row.update({"status": status, "answered": int(time.time() * 1000), **({"result": q["result"]} if "result" in q else {})})
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False)
        os.replace(tmp, path)
    PromptServer.instance.send_sync("mainodes-snap-proposals", {"id": row["id"], "status": row["status"]})
    return web.json_response({"row": row})


@routes.get("/mainodes/snap/progress")
async def progress(request):
    """The running prompt's nodes as core tracks them: {prompt_id, nodes: {id: {state, value, max}}}; empty when idle."""
    reg, running = get_progress_state(), PromptServer.instance.prompt_queue.get_current_queue_volatile()[0]
    if not running or reg.prompt_id not in [i[1] for i in running]:
        return web.json_response({"prompt_id": None, "nodes": {}})
    return web.json_response({"prompt_id": reg.prompt_id, "nodes": {k: {"state": v["state"].value, "value": v["value"], "max": v["max"]} for k, v in reg.nodes.items()}})


# The agents' window (SNAP-R83, the operator, 2026-11-06: "an open chrome window you can control and hook into and restart and
# make it non headless always"): one visible Chrome that tools/snap_agent_page.sh starts with its own profile and a
# 127.0.0.1 DevTools port, which it tells this server (kept in the user folder, so a restarted server still knows it).
# The bridge finds a tab in it by the client id in the tab's sessionStorage, treats it as a tab that sees, captures it for
# screenshot, and reloads it after an update. Local only (SNAP-R18): a 127.0.0.1 port the launcher started.
CHROME = Path(folder_paths.get_user_directory()) / "snap_chrome.json"


def chrome_state():
    return json.loads(CHROME.read_text()) if CHROME.exists() else {}


@routes.post("/mainodes/snap/chrome")
async def chrome_attach(request):
    """the launcher says where the agents' window listens: {cdp, profile}"""
    body = await request.json()
    port = body.get("cdp")
    if not isinstance(port, int) or not 0 < port < 65536:
        return error(f"cdp must be the window's Chrome DevTools port (a number), not {port!r}")
    CHROME.write_text(json.dumps({"cdp": port, "profile": body.get("profile")}))
    return web.json_response(chrome_state())


cdp_ids = itertools.count(1)


async def cdp(ws, method, params=None):
    n = next(cdp_ids)
    await ws.send_json({"id": n, "method": method, "params": params or {}})
    async for msg in ws:
        out = json.loads(msg.data)
        if out.get("id") == n:
            if "error" in out:
                raise RuntimeError(f"{method}: {out['error'].get('message')}")
            return out["result"]
    raise RuntimeError(f"{method}: Chrome closed the connection")


async def chrome_targets():
    """the window's tabs as DevTools lists them, or [] when it isn't running"""
    port = chrome_state().get("cdp")
    if not port:
        return []
    try:
        async with aiohttp.ClientSession() as session:
            got = await (await session.get(f"http://127.0.0.1:{port}/json/list", timeout=aiohttp.ClientTimeout(total=3))).json()
    except (aiohttp.ClientError, TimeoutError, ValueError):
        return []
    return [t for t in got if t.get("type") == "page"]


async def chrome_pages():
    """(DevTools target, Snap client id) for each tab of the window that runs ComfyUI (a tab of another site has no id)"""
    out = []
    async with aiohttp.ClientSession() as session:
        for t in await chrome_targets():
            try:
                async with session.ws_connect(t["webSocketDebuggerUrl"], max_msg_size=0, timeout=aiohttp.ClientWSTimeout(ws_close=3)) as ws:
                    found = await asyncio.wait_for(cdp(ws, "Runtime.evaluate", {"expression": "sessionStorage.getItem('clientId')", "returnByValue": True}), 3)
            except (aiohttp.ClientError, TimeoutError, RuntimeError):
                continue
            if found.get("result", {}).get("value"):
                out.append((t, found["result"]["value"]))
    return out


async def chrome_run(base, action):
    """start or restart the window through the launcher, outside this server's process tree (systemd-run when there is one)"""
    proc = await asyncio.create_subprocess_exec("bash", str(PAGE_SH), base, action, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    return proc.returncode, out.decode(errors="replace").strip()


async def chrome_tool(request, user, args):
    base, action = f"{request.scheme}://{request.host}", args.get("action", "status")
    if action not in ("status", "reload", "start", "restart"):
        return error(f"action is one of status, reload, start, restart; not {action!r}")
    if action in ("start", "restart"):
        code, said = await chrome_run(base, action)
        if code:
            return error(said, 503)
    tabs, code = await chrome_pages(), served_code()
    if action == "reload":
        want = (find_page(user, args["page"]) or args["page"]) if args.get("page") else None
        hit = [(t, c) for t, c in tabs if c in pages and pages[c]["user"] == user and want in (None, c)]  # only this server's tabs
        if not hit:
            return error(f"No Snap tab {args.get('page') or ''} of this ComfyUI in the agents' window; its tabs: {', '.join(t['url'] for t, _ in tabs) or 'none'} (chrome {{\"action\": \"status\"}})"
                         if tabs or args.get("page") else f"The agents' window isn't running on this machine: start it with the chrome tool {{\"action\": \"start\"}} or bash {PAGE_SH} {base}", 404)
        async with aiohttp.ClientSession() as session:
            for t, _ in hit:
                async with session.ws_connect(t["webSocketDebuggerUrl"], max_msg_size=0) as ws:
                    u = urlsplit(t["url"])
                    if "snap" in parse_qs(u.query, keep_blank_values=True):
                        await cdp(ws, "Page.reload", {"ignoreCache": True})
                    else:  # F-F14: a tab opened without ?snap came back on Graph view; it reopens on Snap (same tab: sessionStorage kept)
                        await cdp(ws, "Page.navigate", {"url": urlunsplit(u._replace(query=f"{u.query}&snap" if u.query else "snap"))})
        for _ in range(100):  # each reloaded tab registers again (its client id stays: sessionStorage is the tab's)
            if all(c in pages and pages[c]["code"] == code and pages[c]["registered"] > time.time() - 30 for _, c in hit):
                break
            await asyncio.sleep(0.25)
    rows = [{"tab": t["id"], "url": t["url"], "title": t["title"], "page": c if c in pages else None, "name": page_name(c) if c in pages else None,
             "code_current": pages[c]["code"] == code if c in pages else None, "driven_by": drivers.get(c)} for t, c in tabs]
    running = bool(await chrome_targets()) or bool(tabs)
    return web.json_response({"result": {"running": running, "cdp": chrome_state().get("cdp"), "tabs": rows,
                                         **({"reloaded": [r for r in rows if r["page"] and (not args.get("page") or r["page"] == (find_page(user, args["page"]) or args["page"]))]} if action == "reload" else {}),
                                         **({"said": said} if action in ("start", "restart") else {})}})


@routes.post("/mainodes/snap/page_shot")
async def page_shot(request):
    """A picture of the calling tab of the agents' window as Chrome renders it: {mimeType, data (base64 JPEG), width, height}."""
    body = await request.json()
    client, width = body.get("client"), int(body.get("max_width") or 1600)
    if client not in pages or not pages[client].get("managed"):
        return error("Only a tab of the agents' window can be captured this way (SNAP-R83); a person's tab shares itself with 'Let agents see'. Meanwhile take_frames shows a take's frames and read_ui what the page shows.", 403)
    async with aiohttp.ClientSession() as session:
        for t, c in await chrome_pages():
            if c != client:
                continue
            async with session.ws_connect(t["webSocketDebuggerUrl"], max_msg_size=0) as ws:
                size = (await cdp(ws, "Page.getLayoutMetrics"))["cssVisualViewport"]
                k = min(1.0, width / size["clientWidth"])
                shot = await cdp(ws, "Page.captureScreenshot", {"format": "jpeg", "quality": 85, "clip": {"x": 0, "y": 0, "width": size["clientWidth"], "height": size["clientHeight"], "scale": k}})
                return web.json_response({"mimeType": "image/jpeg", "data": shot["data"], "width": round(size["clientWidth"] * k), "height": round(size["clientHeight"] * k)})
    return error("This tab is no longer in the agents' window (its Chrome closed or restarted): chrome {\"action\": \"status\"} lists its tabs; take_frames and read_ui work meanwhile.", 404)


CARDS = Path(__file__).parent / "snap_cards"
GRAPHS = {"models.json", "methods.json", "kits.json", "nsfw_terms.json", "pack_notes.json"}  # data with their own routes, not Library cards


@routes.get("/mainodes/snap/cards")
async def cards(request):
    """Library cards shipped with the pack (snap_cards/*.json); user cards will live under the user directory."""
    found = []
    for f in sorted(CARDS.glob("*.json")):
        if f.name not in GRAPHS:
            found += json.loads(f.read_text(encoding="utf-8"))
    return web.json_response({"cards": found})


@routes.get("/mainodes/snap/models")
async def model_graph(request):
    """The pack's model graph (snap_cards/models.json): the families a file's name says it belongs to, and how the files
    it knows fit together; the person's own entries (userdata snap/models.json) are read and merged by the page."""
    await asyncio.to_thread(rate_released)  # a dial dropped in since the last look gets its rating before the page reads ratings
    graph = json.loads((CARDS / "models.json").read_text(encoding="utf-8"))
    return web.json_response({"models": graph["files"], "families": graph["families"]})


# what a LoRA file says about itself, for an agent judging its kind (U84, SNAP-R55): Snap makes no LLM call, the agent is
# the LLM. Header only: training tags (ss_*), base model, network dim / alpha and the rank its tensors have, trigger
# words, modelspec and other text fields, the tags it was trained on (most frequent first), size, folder; nothing is cut
# (SNAP-R58)
BIG = {"ss_tag_frequency", "ss_dataset_dirs", "ss_bucket_info", "ss_datasets", "ss_reg_dataset_dirs"}


@routes.get("/mainodes/snap/lora_info")
async def lora_info(request):
    name = request.query.get("file", "")
    path = folder_paths.get_full_path("loras", name)
    if not path:
        return error(f"No LoRA {name!r} in the loras folders; list_loras names them", 404)
    found = snap_privacy.header(path)
    if found is None:
        return error(f"{name} has no safetensors header Snap can read")
    meta = {k: str(v) for k, v in (found.get("__metadata__") or {}).items() if k not in BIG}
    tags = {}
    try:
        for folder in json.loads(found.get("__metadata__", {}).get("ss_tag_frequency") or "{}").values():
            for t, n in folder.items():
                tags[t] = tags.get(t, 0) + n
    except (ValueError, AttributeError):
        pass
    down = next((v["shape"] for k, v in found.items() if k != "__metadata__" and re.search(r"(lora_down|lora_A)(\.default)?\.weight$", k)), None)
    keys = [k for k in found if k != "__metadata__"]
    return web.json_response({
        "file": name, "folder": os.path.dirname(name.replace("\\", "/")) or None, "size_mb": round(os.path.getsize(path) / 1e6, 1),
        "training": {k: v for k, v in meta.items() if k.startswith("ss_")},
        "trained_tags": [t for t, _ in sorted(tags.items(), key=lambda x: -x[1])],
        "triggers": [v for k, v in meta.items() if k.lower().rsplit(".", 1)[-1] in snap_privacy.TRIGGER_KEYS],
        "modelspec": {k: v for k, v in meta.items() if k.startswith("modelspec.")},
        "other": {k: v for k, v in meta.items() if not k.startswith(("ss_", "modelspec."))},
        "rank_from_tensors": down[0] if down else None, "tensors": len(keys), "key_prefix": os.path.commonprefix(keys).rsplit(".", 1)[0] if keys else None,
        "beside": beside(path)})


def beside(path):
    """Text files that came with a LoRA (dogfood F-D08: ORB360's trained caption is prompts/*.txt next to it): in its own
    folder every .txt/.md/.json and its prompts/ folder; in a shared folder only files named after it. Whole, never cut"""
    folder, stem = os.path.dirname(path), os.path.splitext(os.path.basename(path))[0]
    own = os.path.abspath(folder) not in {os.path.abspath(p) for p in folder_paths.get_folder_paths("loras")}
    found = []
    for d in [folder, os.path.join(folder, "prompts")]:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            if os.path.isfile(p) and f.lower().endswith((".txt", ".md", ".json")) and (own or f.startswith(stem)):
                with open(p, encoding="utf-8", errors="replace") as fh:
                    found.append({"file": os.path.relpath(p, folder).replace(os.sep, "/"), "text": fh.read()})
    return found


@routes.get("/mainodes/snap/methods")
async def method_registry(request):
    """The pack's method registry (snap_cards/methods.json): the slots and the methods that fill them; the person's own
    (userdata snap/methods.json) are read and merged by the page. A need with `own_folder` is a folder under models/ that
    ComfyUI doesn't list (RelayVSR reads models/relayvsr itself): `present` says whether any .safetensors file is there."""
    reg = json.loads((CARDS / "methods.json").read_text(encoding="utf-8"))
    for need in (n for m in reg["methods"] for n in m.get("needs", []) if n.get("own_folder")):
        root = Path(folder_paths.models_dir) / need["folder"]
        need["present"] = any(root.glob("*.safetensors")) or any(root.glob("*/*.safetensors"))  # where RelayVSR looks: the folder or a variant folder in it
    return web.json_response(reg)


@routes.get("/mainodes/snap/kits")
async def kits(request):
    """The pack's onboarding kits (snap_cards/kits.json: intent -> setups, files, node packs), and where each model folder and
    custom_nodes live on this machine, so a download proposal can name its exact target. Snap never downloads (SNAP-R18)."""
    found = json.loads((CARDS / "kits.json").read_text(encoding="utf-8"))
    # the folder named like its key when there is one (diffusion_models lists the legacy models/unet first)
    targets = {name: next((p for p in paths if os.path.basename(p) == name), paths[0]) for name, (paths, _) in folder_paths.folder_names_and_paths.items() if paths}
    return web.json_response({**found, "folders": {**targets, "output": folder_paths.get_output_directory()}})  # output: where run_status says files are


# Semantic search: EmbeddingGemma 2 runs in tools/snap_embedder.py, a sidecar in its own venv (ComfyUI's transformers is
# too old for it), started on the first search. Until it answers, the page keeps its keyword search.
EMBEDDER_PYTHON = os.environ.get("MAINODES_SNAP_EMBEDDER_PYTHON", "")
# one sidecar per server: its port follows ComfyUI's (8188 -> 8418), so two installs never share one
EMBEDDER_PORT = int(os.environ.get("MAINODES_SNAP_EMBEDDER_PORT", args.port + 230))
EMBEDDER = f"http://127.0.0.1:{EMBEDDER_PORT}"
QUERY = "task: search result | query: "
embedder = {"proc": None, "ready": False}
vectors = {}  # (card id, text sha1) or (card id, image path, mtime) -> 256d vector


def card_text(card):
    return f"title: {card['title']} | text: {card['kind']}. {card['text']}"


def start_embedder():
    """Start the sidecar unless it is already starting; returns why semantic search is unavailable, or None."""
    log = Path(folder_paths.get_user_directory()) / "default" / "snap" / "embedder.log"
    proc = embedder["proc"]
    if proc is not None:
        return None if proc.poll() is None else f"the embedder exited with code {proc.returncode}, see {log}"
    if not os.path.isfile(EMBEDDER_PYTHON):
        return f"no embedder interpreter at {EMBEDDER_PYTHON} (set MAINODES_SNAP_EMBEDDER_PYTHON)"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "ab") as out:  # the sidecar nices itself to 19 and limits torch to 4 threads
        embedder["proc"] = subprocess.Popen([EMBEDDER_PYTHON, "-I", str(Path(__file__).parent / "tools" / "snap_embedder.py"), "--port", str(EMBEDDER_PORT)],
                                            stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    return None


@routes.post("/mainodes/snap/search")
async def search(request):
    """Rank cards by meaning. `kinds` limits ranking to what the slot accepts; a card's image counts when its score is higher."""
    body = await request.json()
    kinds = body.get("kinds")
    found = [c for c in body["cards"] if not kinds or c["kind"] in kinds]
    roots = [folder_paths.get_input_directory(), folder_paths.get_output_directory(), folder_paths.get_user_directory(), str(CARDS)]
    images = {}
    for c in found:
        path = (body.get("images") or {}).get(c["id"])
        if path is None:
            continue
        if not any(folder_paths.is_within_directory(r, path) for r in roots) or not os.path.isfile(path):
            return error(f"Image for {c['id']} is not a file in ComfyUI's input, output or user folders: {path}")
        images[c["id"]] = (c["id"], path, os.stat(path).st_mtime)

    text_keys = [(c["id"], hashlib.sha1(card_text(c).encode()).hexdigest()) for c in found]
    new_texts = [i for i, k in enumerate(text_keys) if k not in vectors]
    new_images = [k for k in images.values() if k not in vectors]
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as session:
            if not embedder["ready"]:
                async with session.get(EMBEDDER + "/health") as r:
                    if not (await r.json())["ready"]:
                        return web.json_response({"engine": "keyword", "warming": True})
                embedder["ready"] = True
            async with session.post(EMBEDDER + "/embed", json={"texts": [QUERY + body["query"]] + [card_text(found[i]) for i in new_texts],
                                                               "images": [k[1] for k in new_images]}) as r:
                out = await r.json()
    except aiohttp.ClientConnectionError:
        embedder["ready"] = False
        reason = start_embedder()
        return web.json_response({"engine": "keyword", "unavailable": reason} if reason else {"engine": "keyword", "warming": True})
    if "error" in out:
        return error(f"Embedder: {out['error']}", 502)

    query = np.array(out["texts"][0], dtype=np.float32)
    for k, v in zip([text_keys[i] for i in new_texts] + new_images, out["texts"][1:] + out["images"]):
        vectors[k] = np.array(v, dtype=np.float32)
    scores = [float(vectors[k] @ query) for k in text_keys]
    for i, c in enumerate(found):
        if c["id"] in images:
            scores[i] = max(scores[i], float(vectors[images[c["id"]]] @ query))
    order = sorted(range(len(found)), key=lambda i: -scores[i])
    return web.json_response({"ids": [found[i]["id"] for i in order], "scores": [round(scores[i], 4) for i in order], "engine": "embeddinggemma-2"})


# The metadata switch (SNAP-R20). Core's savers write the executed prompt and the workflow, LoRA file names included, into
# every file, and only the global --disable-metadata turns that off; the prompt they write is the one queued, so a page
# can't leave the names out. A Snap page with metadata off marks its queued workflow (extra.snap_metadata false): that
# prompt has core's savers and the pack's MAIVideoOut swapped for these twins, which save the same file without the two
# (and without MAIVideoOut's meta.json), and a node with a `save_metadata` switch (VHS Video Combine) gets it off. Any
# other node that asks for them still runs, and the take names it: "writes metadata anyway" (SNAP-R38). Every prompt is
# also checked for private and NSFW files, for the take's lock badge and the export filter (SNAP-R37), and rated from its
# text and the files it loads, for the take's rating (SNAP-R39).
class MAISaveImagePrivate(nodes.SaveImage):
    DESCRIPTION = "Saves the images to your ComfyUI output directory without the prompt and workflow in the file (Snap saves with it while metadata is off)."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": nodes.SaveImage.INPUT_TYPES()["required"]}


class MAIPreviewImagePrivate(nodes.PreviewImage):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": nodes.PreviewImage.INPUT_TYPES()["required"]}


class MAISaveVideoPrivate(SaveVideo):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id, schema.display_name = "MAISaveVideoPrivate", "Save Video (no metadata)"
        schema.description = "Saves the video to your ComfyUI output directory without the prompt and workflow in the file (Snap saves with it while metadata is off)."
        return schema

    @classmethod
    def execute(cls, video, **kwargs):
        cls.hidden.prompt = cls.hidden.extra_pnginfo = None  # cls is this run's own clone
        if isinstance(video, InputImpl.VideoFromFile):  # a stream copy keeps the source file's tags (a take's own prompt)
            src = video.get_stream_source()
            ext = os.path.splitext(src)[1] if isinstance(src, str) else ".mp4"
            if not isinstance(src, str):
                src = os.path.join(folder_paths.get_temp_directory(), f"snap_nometa_in_{uuid.uuid4().hex}{ext}")
                video.save_to(src)
            out = os.path.join(folder_paths.get_temp_directory(), f"snap_nometa_{uuid.uuid4().hex}{ext}")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0", "-map_metadata", "-1", "-c", "copy", out], check=True, timeout=600)
            video = InputImpl.VideoFromFile(out)
        return super().execute(video=video, **kwargs)


class MAIVideoOutPrivate(MAIVideoOut):
    DESCRIPTION = "MAI Video Out without the prompt and workflow in the file and without meta.json (Snap saves with it while metadata is off)."

    @classmethod
    def INPUT_TYPES(cls):
        return {k: v for k, v in MAIVideoOut.INPUT_TYPES().items() if k != "hidden"}

    def save(self, *args, **kwargs):
        return super().save(*args, **{**kwargs, "write_meta": False})


PRIVATE_SAVES = {"SaveImage": "MAISaveImagePrivate", "PreviewImage": "MAIPreviewImagePrivate", "SaveVideo": "MAISaveVideoPrivate", "MAIVideoOut": "MAIVideoOutPrivate"}


def writes_metadata(class_type):
    """Whether a node asks for the prompt or the workflow (savers write them into their files)."""
    cls = nodes.NODE_CLASS_MAPPINGS.get(class_type)
    if cls is None:
        return False
    if hasattr(cls, "define_schema"):  # V3: what the node declares (core adds both to every output node)
        return bool({io.Hidden.prompt, io.Hidden.extra_pnginfo} & set(cls.define_schema().hidden or []))
    return bool({"PROMPT", "EXTRA_PNGINFO"} & set(cls.INPUT_TYPES().get("hidden", {}).values()))


def loaded(value):
    """The real paths (symlinks followed) a string input would load from any model folder, or as an absolute path."""
    if os.path.isabs(value):
        return [os.path.realpath(value)] if os.path.isfile(value) else []
    return [os.path.realpath(p) for p in (folder_paths.get_full_path(f, value) for f in folder_paths.folder_names_and_paths) if p]


def metadata_gate(json_data):
    prompt = json_data.get("prompt")
    if not isinstance(prompt, dict):
        return json_data
    extra = json_data.setdefault("extra_data", {})
    workflow = (extra.get("extra_pnginfo") or {}).get("workflow")
    off = isinstance(workflow, dict) and (workflow.get("extra") or {}).get("snap_metadata") is False
    # rules that can't be read mark the take private and say so; they never stop the render (SNAP-R27). Core queues the
    # prompt unchanged when a handler raises, so nothing may escape from here
    try:
        graph = snap_privacy.model_graph(folder_paths.get_user_directory())
        found = snap_privacy.marks(prompt, workflow, graph, loaded)
        if graph["broken"] and graph["private"]:
            logging.error("Snap: privacy rules unreadable (%s); this prompt is marked private until they are fixed", ", ".join(graph["broken"]))
        cap = snap_privacy.LEVELS.get(str(extra.get("snap_max_rating")).lower())
        # an account capped below Adult always has its prompt's words rated; anyone else only with their setting on
        words = (cap is not None and cap < snap_privacy.LEVELS["adult"]) or ((workflow or {}).get("extra") or {}).get("snap_rate_words") is True
        rated, rated_why = snap_privacy.rating(prompt, graph, folders_of, gated=cap is not None, words=words)
        for lvl, who in snap_privacy.pinned(workflow):
            if lvl:
                rated, rated_why = max(rated, lvl), rated_why + [f"{who} is rated {snap_privacy.NAMES[lvl]}"]
    except Exception:
        on = snap_privacy.switched_on(folder_paths.get_user_directory())
        logging.exception("Snap: privacy rules unreadable" + ("; this prompt is marked private" if on else ""))
        found = {"private": ["privacy rules unreadable"] if on else [], "nsfw": []}
        rated, rated_why = snap_privacy.LEVELS["adult"], ["rating rules unreadable"]
    # U79: where privacy is on, a private take is saved encrypted with its recipe (SNAP-R96); rules that can't be read
    # still seal it (fail closed)
    if snap_vault_server is not None:
        try:
            vault = snap_vault_server.seal_prompt(json_data, found, writes_metadata)
        except Exception as e:  # core would queue it unchanged, saved in plain: refuse it instead (fail closed)
            logging.exception("Snap vault: couldn't check this prompt for private takes; refused")
            vault = {}
            json_data["prompt"] = {"vault": {"class_type": "MAIRatingRefused", "inputs": {"why": f"Snap couldn't check this prompt for private takes ({e}), so nothing of it runs. Tell the operator; the server log has the error."}}}
    elif found["private"] and snap_privacy.switched_on(folder_paths.get_user_directory()):
        vault = {}
        json_data["prompt"] = {"vault": {"class_type": "MAIRatingRefused", "inputs": {"why": f"This install keeps private takes encrypted, and the vault can't load ({vault_missing}): pip install cryptography in ComfyUI's Python."}}}
    else:
        vault = {}
    prompt = json_data["prompt"]
    swapped, kept = dict(vault.get("swapped", {})), []
    for nid, node in list(prompt.items()) if off else []:
        inputs = node.get("inputs") or {}
        if nid in swapped:
            continue
        if node.get("class_type") in PRIVATE_SAVES:
            swapped[nid] = node["class_type"]
            node["class_type"] = PRIVATE_SAVES[node["class_type"]]
        elif inputs.get("save_metadata") is True:  # the node's own switch (VHS Video Combine)
            inputs["save_metadata"] = False
        elif writes_metadata(node.get("class_type")):
            kept.append(f"node {nid} ({node.get('_meta', {}).get('title') or node['class_type']}) writes metadata anyway")
    if kept:
        logging.warning("Snap: metadata is off, but %s", "; ".join(kept))
    # the page's take reads these from /history: the lock badge, the export filter, the saver each node really is, and
    # the nodes that kept their metadata
    extra["snap_marks"] = {"private": bool(found["private"]), "nsfw": bool(found["nsfw"]), "why": found["private"] + found["nsfw"], "metadata": not off, "swapped": swapped,
                           "rating": snap_privacy.NAMES[rated], "rating_why": rated_why, **({"kept": kept} if kept else {}),
                           **({"vault": vault["owner"], "encrypted": True} if vault.get("swapped") else {}), **({"vault_notes": vault["notes"]} if vault.get("notes") else {})}
    return json_data


# The rating cap a second time (SNAP-R33). snap-gate puts the signed-in account and its cap in every prompt's extra_data
# (snap_user, snap_max_rating) and refuses files above the cap first; here a prompt that still names one becomes one
# MAIRatingRefused per such node, which fails validation, so nothing of it runs (core would run the other outputs). Ratings come from the pack's model graph under the admins'
# own snap/models.json (SNAP-R32). With no gate there is no cap, and nothing changes. A saver with no filename_prefix
# can't be kept in the account's output folder by the gate: it is noted (log + extra_data.snap_notes), never refused.
class MAIRatingRefused:
    """Stands in for a node that loads a file above the signed-in account's rating: it fails validation, so nothing runs."""
    DEV_ONLY = True
    CATEGORY = "MAINodes/snap"
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "refuse"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"why": ("STRING", {})}}

    @classmethod
    def VALIDATE_INPUTS(cls, why):
        return why

    def refuse(self, why):
        raise RuntimeError(why)


def folders_of(value):
    """The model folders that hold this name (none for text or an absolute path)."""
    return [] if os.path.isabs(value) else [f for f in folder_paths.folder_names_and_paths if folder_paths.get_full_path(f, value)]


def saves_without_prefix(class_type):
    """A saver (an output node named Save…, e.g. SaveLoRA) with no filename_prefix input: where it writes is its own."""
    cls = nodes.NODE_CLASS_MAPPINGS.get(class_type)
    if cls is None or "save" not in class_type.lower():
        return False
    info = cls.GET_NODE_INFO_V1() if hasattr(cls, "GET_NODE_INFO_V1") else {"output_node": getattr(cls, "OUTPUT_NODE", False), "input": cls.INPUT_TYPES()}
    return bool(info["output_node"]) and not any("filename_prefix" in (g or {}) for g in info["input"].values())


def rating_cap(json_data):
    prompt, extra = json_data.get("prompt"), json_data.get("extra_data") or {}
    cap = snap_privacy.LEVELS.get(str(extra.get("snap_max_rating")).lower())
    if cap is None or not isinstance(prompt, dict):
        return json_data
    try:
        notes = [f"node {nid} ({node.get('class_type')}) saves without a filename_prefix, so its file may land outside {extra.get('snap_user')}'s output folder"
                 for nid, node in prompt.items() if saves_without_prefix(node.get("class_type"))]
        graph, shown = snap_privacy.model_graph(folder_paths.get_user_directory()), "PG" if cap == 0 else str(extra["snap_max_rating"]).capitalize()
        title = lambda nid: (prompt[nid].get("_meta") or {}).get("title") or prompt[nid].get("class_type")
        refused = {nid: f"Node {nid} ({t}) loads a file rated above this account's {shown} cap. Ask the admin." for nid, t in snap_privacy.above(prompt, graph, cap, folders_of).items()}
        # U90: words that rate the prompt Adult are refused here too, for any cap below Adult (they always count there,
        # SNAP-R39), so the run never renders only to be hidden from its own account
        for nid, k, term in snap_privacy.said(prompt, graph, folders_of) if cap < snap_privacy.LEVELS["adult"] else []:
            refused.setdefault(nid, f"Node {nid} ({title(nid)}): its {k} says \"{term}\", which rates this prompt Adult, above this account's {shown} cap. Change the words, or ask the admin.")
        # a pinned record rated above the cap (a Cast the person rated Adult): what the re-run plan said the server refuses
        over = [f"{who} is rated {snap_privacy.NAMES[lvl].capitalize()}" for lvl, who in snap_privacy.pinned((extra.get("extra_pnginfo") or {}).get("workflow")) if lvl > cap]
        if over:
            refused["world"] = f"{', '.join(over)}, above this account's {shown} cap. Pick another version or record, or ask the admin."
    except Exception as e:  # core would queue it unchanged, past the cap: refuse it instead (fail closed)
        logging.exception("Snap: couldn't check this prompt against %s's cap; refused", extra.get("snap_user"))
        notes, refused = [], {"cap": f"Snap couldn't check this prompt against this account's cap ({e}), so nothing of it runs. Tell the admin; the server log has the error."}
    if refused:
        logging.warning("Snap: %s's prompt rates above their %s cap (nodes %s); refused", extra.get("snap_user"), extra["snap_max_rating"], ", ".join(refused))
        json_data["prompt"] = {nid: {"class_type": "MAIRatingRefused", "inputs": {"why": why}, "_meta": prompt.get(nid, {}).get("_meta", {})} for nid, why in refused.items()}  # "world" and "cap" are no node
    if notes:
        logging.warning("Snap: %s", "; ".join(notes))
        json_data.setdefault("extra_data", {})["snap_notes"] = notes
    return json_data


def queued_rating():
    """The rating the running prompt was queued with (extra_data.snap_marks.rating: its text and the files it loads), or
    None outside a run (the Dial editor's export is a route, not a run)."""
    ctx = get_executing_context()
    running = PromptServer.instance.prompt_queue.get_current_queue_volatile()[0] if ctx else []
    marks = next((item[3].get("snap_marks") or {} for item in running if item[1] == ctx.prompt_id), {})
    return snap_privacy.LEVELS.get(str(marks.get("rating")).lower())


def rate_dial(file, texts, parents):
    """A dial saved here is rated as what made it (SNAP-R39, SNAP-R54): Adult when its sentences hold one of the terms,
    raised to its parent dials' ratings and to the rating of the run that made it (a dial from pictures or videos
    inherits from its inputs that way: the files and words of the prompt that loaded them). A parent nobody rated leaves
    the new dial unrated too, so it counts as the gate counts its parent."""
    user = folder_paths.get_user_directory()
    graph = snap_privacy.model_graph(user)
    lvl, term = snap_privacy.text_level("\n".join(t for t in texts if t), graph)
    found = [snap_privacy.rated(graph, p, ["loras"]) for p in parents]
    if None in found:
        return
    run = queued_rating()
    why = ([f'its sentences say "{term}"'] if term else []) + ([f"the run that made it was rated {snap_privacy.NAMES[run]}"] if run else [])
    snap_privacy.record(user, "loras", file, max([lvl, run or 0, *found]), why + [f"made from {p}, rated {snap_privacy.NAMES[r]}" for p, r in zip(parents, found)])


def rate_released():
    """SNAP-R54: a dial file in loras/dials/ that nothing rates (a released dial someone downloaded or copied in) is rated
    from the sentences and parents its own metadata records, once, in user/snap_ratings.json; one that can't be told
    that way stays unrated."""
    user = folder_paths.get_user_directory()
    graph = snap_privacy.model_graph(user)

    def level(name, seen=()):
        r = snap_privacy.rated(graph, name, ["loras"])
        if r is not None or name in seen:
            return r
        path = folder_paths.get_full_path("loras", name)
        found = path and snap_privacy.dial_rating(graph, snap_privacy.metadata(path) or {}, lambda p: level(f"{dial_core.DIAL_SUBDIR}/{p}.safetensors", (*seen, name)))
        if found:
            snap_privacy.record(user, "loras", name, *found)
            graph["made"][f"loras/{name}"] = {"rating": snap_privacy.NAMES[found[0]]}
        return found[0] if found else None
    for name in folder_paths.get_filename_list("loras"):
        if name.replace("\\", "/").startswith(dial_core.DIAL_SUBDIR + "/"):
            level(name.replace("\\", "/"))


dial_core.on_saved.append(rate_dial)
rate_released()
# before metadata_gate: it sees the prompt as queued, not the twins and refusals metadata_gate swaps in
PromptServer.instance.add_on_prompt_handler(rating_cap)
PromptServer.instance.add_on_prompt_handler(metadata_gate)


# The same rules, read again now (SNAP-R27): the LoRA rows' lock, and the takes' lock for a rule added after they ran.
# Marking only, never hiding: names the page already lists, booleans for takes; nothing is queued or saved.
@routes.get("/mainodes/snap/private_loras")
async def private_loras(request):
    def find():
        graph, names = snap_privacy.model_graph(folder_paths.get_user_directory()), folder_paths.get_filename_list("loras")
        if not graph["private"]:  # SNAP-R37: privacy is off on this install
            return {"loras": [], "privacy": False}
        # a broken link loads nothing; asking core for it would log a warning per row on every page load (U76 L6)
        dead = lambda n: any(os.path.islink(p) and not os.path.exists(p) for p in (os.path.join(d, n) for d in folder_paths.get_folder_paths("loras")))
        # unreadable rules lock every row, as they mark every take
        return {"loras": names if graph["broken"] else [n for n in names if not dead(n) and snap_privacy.why(n, loaded(n), graph)], "privacy": True}
    return web.json_response(await asyncio.to_thread(find))


@routes.get("/mainodes/snap/take_marks")
async def take_marks(request):
    folder = Path(PromptServer.instance.user_manager.get_request_user_filepath(request, "snap/takes", create_dir=False))

    def find():
        graph, found, unread = snap_privacy.model_graph(folder_paths.get_user_directory()), {}, []
        for f in sorted(folder.glob("*.json")):
            # one half-written or hand-broken take file is named and skipped, never a 500 that hides every lock (U76 L5)
            try:
                t = json.loads(f.read_text(encoding="utf-8"))
                m = snap_privacy.marks(t.get("prompt") or {}, t.get("graph"), graph, loaded)
                tid = t["id"]
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
                unread.append(f"{f.name}: {e}")
                continue
            if m["private"] or m["nsfw"]:
                found[tid] = {"private": bool(m["private"]), "nsfw": bool(m["nsfw"])}
        # the page shows no locks at all while privacy is off (SNAP-R37)
        return {"takes": found, "privacy": graph["private"], **({"unreadable": unread} if unread else {})}
    return web.json_response(await asyncio.to_thread(find))


# Quiet sound (U76, from U78): H3 renders an ambience-only soundscape near-silent (about -57 dB mean, against -27..-41 dB
# for one that names the sounds the action makes). The page reads a take's loudness once it is captured and notes "sound
# is quiet" below about -45 dB; nothing changes until the person picks an action. "Make it louder" queues LoadVideo ->
# MAISnapLouder -> Save Video, which lands as a version of the take: EBU R128 loudnorm (I=-23, TP=-2) on the sound, the
# picture copied as it is (Save Video reuses the stream).
def volume(path):
    """(mean dB, max dB) of a file's sound from ffmpeg volumedetect, or None when it has no sound."""
    r = subprocess.run(["nice", "-n", "10", "ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, timeout=120)
    mean, peak = re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr), re.search(r"max_volume: (-?[\d.]+) dB", r.stderr)
    return (float(mean[1]), float(peak[1])) if mean and peak else None


@routes.get("/mainodes/snap/loudness")
async def loudness(request):
    q = request.query
    root = folder_paths.get_directory_by_type(q.get("type", "output"))
    path = os.path.abspath(os.path.join(root or "", q.get("subfolder", ""), q.get("filename", "")))
    if root is None or os.path.commonpath([path, os.path.abspath(root)]) != os.path.abspath(root) or not os.path.isfile(path):
        return error("No such file in output, input or temp", 404)
    if snap_vault_server is not None and snap_vault_server.on():
        def measure():
            with snap_vault_server.plain_copy(path, snap_vault_server.requester(request)) as p:
                return volume(p)
        try:
            found = await asyncio.to_thread(measure)
        except snap_vault_server.snap_vault.Locked as e:
            return web.json_response({"error": str(e), "locked": True}, status=423)
    else:
        found = await asyncio.to_thread(volume, path)
    return web.json_response({"sound": False} if found is None else {"sound": True, "mean_db": found[0], "max_db": found[1]})


class MAISnapLouder(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="MAISnapLouder", display_name="Make the sound louder (Snap)", category="MAINodes/snap",
                         description="Loudness-normalises a video's sound to EBU R128 (ffmpeg loudnorm I=-23, TP=-2); the picture is copied as it is.",
                         inputs=[io.Video.Input("video")], outputs=[io.Video.Output()])

    @classmethod
    def execute(cls, video) -> io.NodeOutput:
        src, temp = video.get_stream_source(), folder_paths.get_temp_directory()
        if isinstance(src, BytesIO) and snap_vault_server is not None:  # a take kept encrypted, opened in memory: work in RAM scratch (SNAP-R98)
            with snap_vault_server.scratch("in.mp4") as a, snap_vault_server.scratch("out.mp4") as b:
                a.write_bytes(src.getbuffer())
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(a), "-c:v", "copy", "-af", "loudnorm=I=-23:TP=-2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", str(b)], check=True, timeout=600)
                return io.NodeOutput(InputImpl.VideoFromFile(BytesIO(b.read_bytes())))
        if not isinstance(src, str):  # a video made in this run (CreateVideo) has no file yet
            src = os.path.join(temp, f"snap_louder_in_{uuid.uuid4().hex}.mp4")
            video.save_to(src)
        out = os.path.join(temp, f"snap_louder_{uuid.uuid4().hex}.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "copy", "-af", "loudnorm=I=-23:TP=-2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", out], check=True, timeout=600)
        return io.NodeOutput(InputImpl.VideoFromFile(out))


class MAISnapCopyScore(io.ComfyNode):
    """How much each picture re-renders the reference's view (U48 section 3): the mean cosine of DINOv3 patch tokens taken
    at the same grid position, so it follows what sits where in the frame, which DINOv3's CLS (room identity) can't
    see. Validated as a copy detector against a known picture: copies 0.93-0.94, new views of the same room 0.52-0.65.
    A copy drawn again from another viewpoint (short03's aerials of the master, a mirrored master) keeps its parts but
    not their places, 0.52-0.58 there; the soft score (G1b) finds each patch's best match anywhere in the other picture,
    both ways, averaged: those copies 0.84-0.87, new views 0.69-0.81 (SNAP-R112)."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapCopyScore",
            display_name="Copy score (Snap)",
            category="MAINodes/snap",
            description="Scores each image against a reference picture by DINOv3 patch tokens at the same grid position: "
                        "about 0.93 for a re-render of the reference's view, about 0.6 for another view of the same place; and "
                        "a soft score that matches each patch anywhere in the other picture: about 0.84 for a copy drawn from "
                        "another viewpoint, 0.7-0.8 for a new view. Load DINOv3 with Load CLIP Vision.",
            inputs=[io.ClipVision.Input("clip_vision"), io.Image.Input("reference"), io.Image.Input("images")],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip_vision, reference, images) -> io.NodeOutput:
        def patches(x):
            return torch.nn.functional.normalize(snap_faces.encoder_tokens(clip_vision, x)[:, clip_vision.model.num_prefix_tokens:], dim=-1)

        ref = patches(reference[:1])
        scores, soft = [], []
        for chunk in images.split(16):
            p = patches(chunk)
            scores += (p * ref).sum(-1).mean(-1).tolist()
            sim = p @ ref[0].T  # every patch against every reference patch
            soft += ((sim.amax(-1).mean(-1) + sim.amax(-2).mean(-1)) / 2).tolist()
        return io.NodeOutput(ui={"copy_scores": [round(s, 4) for s in scores], "soft_scores": [round(s, 4) for s in soft]})
NODE_CLASS_MAPPINGS = {"MAISaveImagePrivate": MAISaveImagePrivate, "MAIPreviewImagePrivate": MAIPreviewImagePrivate,
                       "MAISaveVideoPrivate": MAISaveVideoPrivate, "MAIVideoOutPrivate": MAIVideoOutPrivate, "MAIRatingRefused": MAIRatingRefused, "MAISnapLouder": MAISnapLouder, "MAISnapCopyScore": MAISnapCopyScore}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISaveImagePrivate": "Save Image (no metadata)", "MAIPreviewImagePrivate": "Preview Image (no metadata)",
                              "MAIVideoOutPrivate": "MAI Video Out (no metadata)", "MAIRatingRefused": "Above the rating cap: refused", "MAISnapLouder": "Make the sound louder (Snap)", "MAISnapCopyScore": "Copy score (Snap)"}
