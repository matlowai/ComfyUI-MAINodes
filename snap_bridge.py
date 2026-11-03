"""The /mainodes/snap routes: Library cards, and a local bridge so CLI agents (tools/snap_mcp.py) call the same Snap tools
the open page runs.
The page owns the graph, so the server only relays a call to it over the websocket and waits for the page's answer."""
import asyncio
import itertools
import json
from pathlib import Path

from aiohttp import web
from server import PromptServer

TIMEOUT = 30
tools = []    # the tool table the open Snap page registered
pending = {}  # call id -> future answered by /mainodes/snap/result
ids = itertools.count(1)


def error(message, status=400):
    return web.json_response({"error": message}, status=status)


routes = PromptServer.instance.routes


@routes.post("/mainodes/snap/register")
async def register(request):
    tools[:] = (await request.json())["tools"]
    return web.json_response({"tools": len(tools)})


@routes.get("/mainodes/snap/tools")
async def listing(request):
    return web.json_response({"tools": tools})


@routes.post("/mainodes/snap/call")
async def call(request):
    body = await request.json()
    if not tools:
        return error("No Snap page is open: open ComfyUI in a browser first.", 503)
    if body.get("tool") not in {t["name"] for t in tools}:
        return error(f"Unknown Snap tool {body.get('tool')!r}.", 404)
    call_id = str(next(ids))
    pending[call_id] = asyncio.get_running_loop().create_future()
    await PromptServer.instance.send("mainodes-snap-call", {"id": call_id, "tool": body["tool"], "args": body.get("args") or {}})
    try:
        return web.json_response(await asyncio.wait_for(pending[call_id], TIMEOUT))
    except TimeoutError:
        return error(f"The Snap page did not answer within {TIMEOUT} s.", 504)
    finally:
        pending.pop(call_id, None)


@routes.post("/mainodes/snap/result")
async def result(request):
    body = await request.json()
    future = pending.get(str(body.get("id")))
    if future and not future.done():  # with several tabs open the first answer wins
        future.set_result({k: body[k] for k in ("result", "error") if k in body})
    return web.json_response({})


CARDS = Path(__file__).parent / "snap_cards"


@routes.get("/mainodes/snap/cards")
async def cards(request):
    """Library cards shipped with the pack (snap_cards/*.json); user cards will live under the user directory."""
    found = []
    for f in sorted(CARDS.glob("*.json")):
        found += json.loads(f.read_text(encoding="utf-8"))
    return web.json_response({"cards": found})
