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
was made · see docs/SNAP_RULES.md"""
import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
import uuid
from pathlib import Path

import time

import aiohttp
import numpy as np
import torch
from aiohttp import web

import comfy.clip_model
import comfy.model_management
from comfy.cli_args import args
import folder_paths
import nodes
from comfy_api.latest import InputImpl, io
from comfy_extras.nodes_video import SaveVideo
from server import PromptServer

from . import snap_privacy
from .dials import core as dial_core
from .video_out import MAIVideoOut

TIMEOUT = 30
tools = []         # the tool table the open Snap page registered
# the tabs that registered, oldest first: websocket client id -> the ComfyUI user whose page it is (the comfy-user header,
# set by snap-gate per account), when it registered and when it last answered. A call goes to the newest page of the
# caller's own user that is still connected, so one account's agent never drives another's page
pages = {}
PAGE_SH = Path(__file__).parent / "tools" / "snap_agent_page.sh"


def user_of(request):
    try:
        return PromptServer.instance.user_manager.get_request_user_id(request)
    except KeyError as e:  # a --multi-user server needs the comfy-user header (snap-gate sets it per account)
        raise web.HTTPForbidden(text=json.dumps({"error": f"{e.args[0]}: send your ComfyUI user as the comfy-user header"}), content_type="application/json")


def open_pages(user):
    """This user's tabs still connected, oldest first (a closed tab hands back to the one before)."""
    return [c for c, p in pages.items() if p["user"] == user and c in PromptServer.instance.sockets]


def health(user):
    now, found = time.time(), open_pages(user)
    return [{"registered_s_ago": round(now - pages[c]["registered"]), "last_answer_s_ago": None if pages[c]["answered"] is None else round(now - pages[c]["answered"]),
             "calls_go_here": c == found[-1]} for c in found]
pending = {}       # call id -> (future answered by /mainodes/snap/result, the page it was sent to)


def error(message, status=400):
    return web.json_response({"error": message}, status=status)


routes = PromptServer.instance.routes


@routes.post("/mainodes/snap/register")
async def register(request):
    body = await request.json()
    tools[:] = body["tools"]
    for c in [c for c in pages if c not in PromptServer.instance.sockets]:
        del pages[c]
    pages.pop(body["client"], None)  # re-registering (focus, reconnect) makes it the newest
    pages[body["client"]] = {"user": user_of(request), "registered": time.time(), "answered": None}
    return web.json_response({"tools": len(tools)})


@routes.get("/mainodes/snap/tools")
async def listing(request):
    """The tool table, and the caller's open Snap pages: when each registered and last answered (a health check)."""
    return web.json_response({"tools": tools, "pages": health(user_of(request))})


@routes.post("/mainodes/snap/call")
async def call(request):
    body = await request.json()
    found = open_pages(user_of(request))
    if not tools or not found:
        base = f"{request.scheme}://{request.host}"
        return error(f"No Snap page is open for you on this ComfyUI. Open {base}/?snap in a browser, or start a headless one for yourself: "
                     f"bash {PAGE_SH} {base} (it returns once the page has registered).", 503)
    if body.get("tool") not in {t["name"] for t in tools}:
        return error(f"Unknown Snap tool {body.get('tool')!r}: GET /mainodes/snap/tools lists them.", 404)
    client, call_id = found[-1], secrets.token_hex(8)
    pending[call_id] = (asyncio.get_running_loop().create_future(), client)
    await PromptServer.instance.send("mainodes-snap-call", {"id": call_id, "tool": body["tool"], "args": body.get("args") or {}}, client)
    try:
        return web.json_response(await asyncio.wait_for(pending[call_id][0], TIMEOUT))
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


CARDS = Path(__file__).parent / "snap_cards"
GRAPHS = {"models.json", "methods.json", "kits.json", "nsfw_terms.json"}  # data with their own routes, not Library cards


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
    graph = json.loads((CARDS / "models.json").read_text(encoding="utf-8"))
    return web.json_response({"models": graph["files"], "families": graph["families"]})


@routes.get("/mainodes/snap/methods")
async def method_registry(request):
    """The pack's method registry (snap_cards/methods.json): the slots and the methods that fill them; the person's own
    (userdata snap/methods.json) are read and merged by the page."""
    return web.json_response(json.loads((CARDS / "methods.json").read_text(encoding="utf-8")))


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
    except Exception:
        on = snap_privacy.switched_on(folder_paths.get_user_directory())
        logging.exception("Snap: privacy rules unreadable" + ("; this prompt is marked private" if on else ""))
        found = {"private": ["privacy rules unreadable"] if on else [], "nsfw": []}
        rated, rated_why = snap_privacy.LEVELS["adult"], ["rating rules unreadable"]
    swapped, kept = {}, []
    for nid, node in list(prompt.items()) if off else []:
        inputs = node.get("inputs") or {}
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
                           "rating": snap_privacy.NAMES[rated], "rating_why": rated_why, **({"kept": kept} if kept else {})}
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
    notes = [f"node {nid} ({node.get('class_type')}) saves without a filename_prefix, so its file may land outside {extra.get('snap_user')}'s output folder"
             for nid, node in prompt.items() if saves_without_prefix(node.get("class_type"))]
    found = snap_privacy.above(prompt, snap_privacy.model_graph(folder_paths.get_user_directory()), cap, folders_of)
    if found:
        logging.warning("Snap: %s's prompt names files above their %s cap (nodes %s); refused", extra.get("snap_user"), extra["snap_max_rating"], ", ".join(found))
        shown = "PG" if cap == 0 else str(extra["snap_max_rating"]).capitalize()
        json_data["prompt"] = {nid: {"class_type": "MAIRatingRefused", "inputs": {"why": f"Node {nid} ({title}) loads a file rated above this account's {shown} cap. Ask the admin."},
                                     "_meta": prompt[nid].get("_meta", {})} for nid, title in found.items()}
    if notes:
        logging.warning("Snap: %s", "; ".join(notes))
        json_data.setdefault("extra_data", {})["snap_notes"] = notes
    return json_data


def rate_dial(file, texts, parents):
    """A dial saved here is rated as what made it (SNAP-R39): Adult when its sentences hold one of the terms, else the
    highest of its parent dials' ratings, else PG. A parent nobody rated leaves the new dial unrated too, so it counts as
    the gate counts its parent."""
    user = folder_paths.get_user_directory()
    graph = snap_privacy.model_graph(user)
    lvl, term = snap_privacy.text_level("\n".join(t for t in texts if t), graph)
    found = [snap_privacy.rated(graph, p, ["loras"]) for p in parents]
    if None in found:
        return
    why = [f'its sentences say "{term}"'] if term else []
    snap_privacy.record(user, "loras", file, max([lvl, *found]), why + [f"made from {p}, rated {snap_privacy.NAMES[r]}" for p, r in zip(parents, found)])


dial_core.on_saved.append(rate_dial)
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
            return []
        return names if graph["broken"] else [n for n in names if snap_privacy.why(n, loaded(n), graph)]  # unreadable rules lock every row, as they mark every take
    return web.json_response({"loras": await asyncio.to_thread(find)})


@routes.get("/mainodes/snap/take_marks")
async def take_marks(request):
    folder = Path(PromptServer.instance.user_manager.get_request_user_filepath(request, "snap/takes", create_dir=False))

    def find():
        graph, found = snap_privacy.model_graph(folder_paths.get_user_directory()), {}
        for f in sorted(folder.glob("*.json")):
            t = json.loads(f.read_text(encoding="utf-8"))
            m = snap_privacy.marks(t.get("prompt") or {}, t.get("graph"), graph, loaded)
            if m["private"] or m["nsfw"]:
                found[t["id"]] = {"private": bool(m["private"]), "nsfw": bool(m["nsfw"])}
        return {"takes": found, "privacy": graph["private"]}  # the page shows no locks at all while privacy is off (SNAP-R37)
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
        if not isinstance(src, str):  # a video made in this run (CreateVideo) has no file yet
            src = os.path.join(temp, f"snap_louder_in_{uuid.uuid4().hex}.mp4")
            video.save_to(src)
        out = os.path.join(temp, f"snap_louder_{uuid.uuid4().hex}.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "copy", "-af", "loudnorm=I=-23:TP=-2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", out], check=True, timeout=600)
        return io.NodeOutput(InputImpl.VideoFromFile(out))


class MAISnapCopyScore(io.ComfyNode):
    """How much each picture re-renders the reference's view (U48 section 3): the mean cosine of DINOv3 patch tokens taken
    at the same grid position, so it follows what sits where in the frame, which DINOv3's CLS (room identity) can't
    see. Validated as a copy detector against a known picture: copies 0.93-0.94, new views of the same room 0.52-0.65."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapCopyScore",
            display_name="Copy score (Snap)",
            category="MAINodes/snap",
            description="Scores each image against a reference picture by DINOv3 patch tokens at the same grid position: "
                        "about 0.93 for a re-render of the reference's view, about 0.6 for another view of the same place. "
                        "Load DINOv3 with Load CLIP Vision.",
            inputs=[io.ClipVision.Input("clip_vision"), io.Image.Input("reference"), io.Image.Input("images")],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip_vision, reference, images) -> io.NodeOutput:
        def patches(x):  # whole frame resized to the encoder's square input, no crop: a set's landmarks sit at the edges
            comfy.model_management.load_model_gpu(clip_vision.patcher)
            px = comfy.clip_model.clip_preprocess(x.to(clip_vision.load_device), size=clip_vision.image_size, mean=clip_vision.image_mean, std=clip_vision.image_std, crop=False).float()
            seq = clip_vision.model(pixel_values=px)[0]
            return torch.nn.functional.normalize(seq[:, clip_vision.model.num_prefix_tokens:].float(), dim=-1)

        ref = patches(reference[:1])
        scores = [s for chunk in images.split(16) for s in (patches(chunk) * ref).sum(-1).mean(-1).tolist()]
        return io.NodeOutput(ui={"copy_scores": [round(s, 4) for s in scores]})
NODE_CLASS_MAPPINGS = {"MAISaveImagePrivate": MAISaveImagePrivate, "MAIPreviewImagePrivate": MAIPreviewImagePrivate,
                       "MAISaveVideoPrivate": MAISaveVideoPrivate, "MAIVideoOutPrivate": MAIVideoOutPrivate, "MAIRatingRefused": MAIRatingRefused, "MAISnapLouder": MAISnapLouder, "MAISnapCopyScore": MAISnapCopyScore}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISaveImagePrivate": "Save Image (no metadata)", "MAIPreviewImagePrivate": "Preview Image (no metadata)",
                              "MAIVideoOutPrivate": "MAI Video Out (no metadata)", "MAIRatingRefused": "Above the rating cap: refused", "MAISnapLouder": "Make the sound louder (Snap)", "MAISnapCopyScore": "Copy score (Snap)"}
