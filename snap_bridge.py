"""The /mainodes/snap routes: Library cards, semantic Library search, and a local bridge so CLI agents
(tools/snap_mcp.py) call the same Snap tools the open page runs.
The page owns the graph, so the server only relays a call to it over the websocket and waits for the page's answer."""
import asyncio
import hashlib
import json
import os
import secrets
import subprocess
from pathlib import Path

import aiohttp
import numpy as np
from aiohttp import web

import folder_paths
from server import PromptServer

TIMEOUT = 30
tools = []         # the tool table the open Snap page registered
pages = []         # websocket client ids of the tabs that registered, oldest first; a call goes to the newest still connected


def page():
    """The tab calls go to: the one that registered last and is still connected (a closed tab hands back to the one before)."""
    return next((c for c in reversed(pages) if c in PromptServer.instance.sockets), None)
pending = {}       # call id -> future answered by /mainodes/snap/result


def error(message, status=400):
    return web.json_response({"error": message}, status=status)


routes = PromptServer.instance.routes


@routes.post("/mainodes/snap/register")
async def register(request):
    body = await request.json()
    tools[:] = body["tools"]
    pages[:] = [c for c in pages if c != body["client"] and c in PromptServer.instance.sockets] + [body["client"]]
    return web.json_response({"tools": len(tools)})


@routes.get("/mainodes/snap/tools")
async def listing(request):
    return web.json_response({"tools": tools})


@routes.post("/mainodes/snap/call")
async def call(request):
    body = await request.json()
    client = page()
    if not tools or client is None:
        return error("No Snap page is open: open ComfyUI in a browser first.", 503)
    if body.get("tool") not in {t["name"] for t in tools}:
        return error(f"Unknown Snap tool {body.get('tool')!r}.", 404)
    call_id = secrets.token_hex(8)
    pending[call_id] = asyncio.get_running_loop().create_future()
    await PromptServer.instance.send("mainodes-snap-call", {"id": call_id, "tool": body["tool"], "args": body.get("args") or {}}, client)
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
    if future and not future.done() and body.get("client") in pages:
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


# Semantic search: EmbeddingGemma 2 runs in tools/snap_embedder.py, a sidecar in its own venv (ComfyUI's transformers is
# too old for it), started on the first search. Until it answers, the page keeps its keyword search.
EMBEDDER_PYTHON = os.environ.get("MAINODES_SNAP_EMBEDDER_PYTHON", "")
EMBEDDER_PORT = int(os.environ.get("MAINODES_SNAP_EMBEDDER_PORT", "8418"))
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
