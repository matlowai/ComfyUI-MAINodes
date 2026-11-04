"""The /mainodes/snap routes: Library cards, semantic Library search, and a local bridge so CLI agents
(tools/snap_mcp.py) call the same Snap tools the open page runs.
The page owns the graph, so the server only relays a call to it over the websocket and waits for the page's answer.
Also the metadata switch on saved files: a prompt queued with Snap's metadata off saves without its prompt and workflow,
and private takes are marked for the lock badge and the export (SNAP-R20); and the copy score Snap's camera plates and
take checks run in the queue (SNAP-R21); and onboarding's kits (SNAP-R25).
SNAP-R12 identity LoRAs are private · SNAP-R18 local only · SNAP-R20 metadata switch, private takes marked · SNAP-R25 onboarding
proposes, never downloads · SNAP-R27 locks follow the current rules · see docs/SNAP_RULES.md"""
import asyncio
import hashlib
import json
import logging
import os
import secrets
import subprocess
from pathlib import Path

import aiohttp
import numpy as np
import torch
from aiohttp import web

import comfy.clip_model
import comfy.model_management
import folder_paths
import nodes
from comfy_api.latest import io
from comfy_extras.nodes_video import SaveVideo
from server import PromptServer

from . import snap_privacy

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
GRAPHS = {"models.json", "methods.json", "kits.json"}  # data with their own routes, not Library cards


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
    return web.json_response({**found, "folders": targets})


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


# The metadata switch (SNAP-R20). Core's savers write the executed prompt and the workflow, LoRA file names included, into
# every file, and only the global --disable-metadata turns that off; the prompt they write is the one queued, so a page
# can't leave the names out. A Snap page with metadata off marks its queued workflow (extra.snap_metadata false): that
# prompt has core's savers swapped for these twins, which save the same file without the two, and any other node that
# reads them is refused before anything runs. Every prompt is also checked for private and NSFW files, for the take's
# lock badge and the export filter; with metadata on, a private take saves as core saves it.
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
    def execute(cls, **kwargs):
        cls.hidden.prompt = cls.hidden.extra_pnginfo = None  # cls is this run's own clone
        return super().execute(**kwargs)


class MAIPrivateSaveRefused:
    """Stands in for a node that would write the prompt into its file while metadata is off: it fails validation, so nothing runs."""
    DEV_ONLY = True
    CATEGORY = "MAINodes/snap"
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "refuse"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"node": ("STRING", {})}}

    @classmethod
    def VALIDATE_INPUTS(cls, node):
        return (f"metadata is off (Snap's top bar), and {node} writes the prompt and workflow, LoRA names included, into its file. "
                "Save it with Save Image or Save Video, which Snap saves without them, or turn metadata on.")

    def refuse(self, node):
        raise RuntimeError(self.VALIDATE_INPUTS(node))


PRIVATE_SAVES = {"SaveImage": "MAISaveImagePrivate", "PreviewImage": "MAIPreviewImagePrivate", "SaveVideo": "MAISaveVideoPrivate"}


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
        if graph["broken"]:
            logging.error("Snap: privacy rules unreadable (%s); this prompt is marked private until they are fixed", ", ".join(graph["broken"]))
    except Exception:
        logging.exception("Snap: privacy rules unreadable; this prompt is marked private")
        found = {"private": ["privacy rules unreadable"], "nsfw": []}
    if not (off or found["private"] or found["nsfw"]):
        return json_data
    swapped = {}
    for nid, node in list(prompt.items()) if off else []:
        if node.get("class_type") in PRIVATE_SAVES:
            swapped[nid] = node["class_type"]
            node["class_type"] = PRIVATE_SAVES[node["class_type"]]
        elif writes_metadata(node.get("class_type")):
            prompt[nid] = {"class_type": "MAIPrivateSaveRefused", "inputs": {"node": node.get("_meta", {}).get("title") or node["class_type"]}, "_meta": node.get("_meta", {})}
    # the page's take reads these from /history: the lock badge, the export filter, and the saver each node really is
    extra["snap_marks"] = {"private": bool(found["private"]), "nsfw": bool(found["nsfw"]), "why": found["private"] + found["nsfw"], "metadata": not off, "swapped": swapped}
    return json_data


PromptServer.instance.add_on_prompt_handler(metadata_gate)


# The same rules, read again now (SNAP-R27): the LoRA rows' lock, and the takes' lock for a rule added after they ran.
# Marking only, never hiding: names the page already lists, booleans for takes; nothing is queued or saved.
@routes.get("/mainodes/snap/private_loras")
async def private_loras(request):
    def find():
        graph, names = snap_privacy.model_graph(folder_paths.get_user_directory()), folder_paths.get_filename_list("loras")
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
        return found
    return web.json_response({"takes": await asyncio.to_thread(find)})


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
                       "MAISaveVideoPrivate": MAISaveVideoPrivate, "MAIPrivateSaveRefused": MAIPrivateSaveRefused, "MAISnapCopyScore": MAISnapCopyScore}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISaveImagePrivate": "Save Image (no metadata)", "MAIPreviewImagePrivate": "Preview Image (no metadata)",
                              "MAIPrivateSaveRefused": "Metadata off: save refused", "MAISnapCopyScore": "Copy score (Snap)"}
