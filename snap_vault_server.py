"""The vault inside ComfyUI (U79): private takes saved encrypted at their own path, opened on the fly for the person
and the admins. Only where privacy is on (user/snap_privacy.json {"on": true}; `"vault": false` there turns the vault
alone off): with privacy off nothing here runs, and every saver, loader, /view and take record behaves as before.

- Savers: metadata_gate (snap_bridge.py) calls `seal_prompt` for every prompt. A private one gets Save Image, Preview
  Image, Save Video and MAI Video Out swapped for twins that render into memory and write a container (snap_vault.py)
  at the path and name core would have used, its recipe inside (or none with Save metadata off). A prompt that reads a
  container is private too, and Load Image / Load Image Mask / Load Video / Load Audio are swapped for twins that open it;
  any other node that names one is noted. The queuing account must have a vault key, and a reading one an unlocked key,
  else the prompt is refused at queue with a reason (MAIRatingRefused), never saved in plain.
- One middleware in front of core's routes: GET /view streams a container decrypted (Range, no-store) to its owner or an
  admin and answers 423 (a lock tile for <img>) while locked; GET/POST /userdata on snap/takes/*.json seals a private
  take's record and hands a locked page the record's listing stub (`kept_encrypted`, `locked`) without its prompt and
  graph; POST /upload/image with `snap_vault=1` writes the upload as a container (a frame of a private take); POST
  /prompt tells seal_prompt which ComfyUI user queued it.
- /mainodes/snap/vault/{status,setup,unlock,lock,rewrap,recover,recovery_key}: keys per account; snap-gate unlocks at sign-in.
Plaintext of a private take touches disk only in the RAM-backed scratch an ffmpeg step or a file-only loader needs
(/dev/shm/snap-vault-<pid>/), unlinked when the step ends; loaders open containers in memory.
SNAP-R37 privacy per install · SNAP-R96 a private take lives encrypted at its own path · SNAP-R97 writing needs no
passphrase, reading does, lock forgets · SNAP-R98 no plaintext of a private take on disk · SNAP-R99 a lost passphrase:
escrow or the recovery key, else lost · see docs/snap/SNAP_RULES.md
"""
import asyncio
import contextlib
import contextvars
import io
import json
import logging
import mimetypes
import os
import shutil
import subprocess
import time
import uuid
from fractions import Fraction
from pathlib import Path

import numpy as np
import torch
from aiohttp import web
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

import comfy.model_management
import folder_paths
import nodes
from comfy.cli_args import args
from comfy_api.latest import InputImpl, Types, io as cio
from comfy_execution.utils import get_executing_context
from comfy_extras.nodes_audio import LoadAudio, load as load_audio
from comfy_extras.nodes_video import LoadVideo, SaveVideo, preview_input_video
from server import PromptServer

from . import snap_privacy, snap_vault
from .video_out import MAIVideoOut

routes = PromptServer.instance.routes
asking = contextvars.ContextVar("snap_vault_asking", default=None)  # the ComfyUI user whose POST /prompt is being queued
SCRATCH = Path("/dev/shm" if os.path.isdir("/dev/shm") else folder_paths.get_temp_directory()) / f"snap-vault-{os.getpid()}"
LOCKED = "kept encrypted: unlock the vault (sign in) to open it"
FREE_TRIES, WAIT_FIRST, WAIT_CAP = 3, 5, 900  # wrong passphrases before the waits, as snap-gate's sign-in (SNAP-R47)
fails = {}  # ComfyUI user -> (wrong passphrases, wait until)
RECOVERY_SAID = "Write this recovery key down now: it is shown once and kept nowhere. With it (or an admin) a lost passphrase can be reset; without both, your private takes are gone."


def user_dir():
    return folder_paths.get_user_directory()


def on():
    """Whether this install keeps private takes encrypted: privacy on (SNAP-R37) and the vault not turned off."""
    if not snap_privacy.switched_on(user_dir()):
        return False
    try:
        return json.loads((Path(user_dir()) / "snap_privacy.json").read_text(encoding="utf-8")).get("vault") is not False
    except (OSError, ValueError, AttributeError):
        return True  # a broken switch file counts as on (SNAP-R37)


def admins():
    return snap_privacy.owners(user_dir(), []) or set()


def requester(request):
    try:
        return PromptServer.instance.user_manager.get_request_user_id(request)
    except KeyError:
        return None


def run_marks():
    """The running prompt's extra_data.snap_marks (its owner is `vault`)."""
    ctx = get_executing_context()
    running = PromptServer.instance.prompt_queue.get_current_queue_volatile()[0] if ctx else []
    return next((item[3].get("snap_marks") or {} for item in running if item[1] == ctx.prompt_id), {})


def seal_out(path, data, marks, stub=None):
    owner = marks.get("vault")
    pub = snap_vault.public(user_dir(), owner) if owner else None
    if pub is None:  # seal_prompt refuses such a prompt at queue; a key file edited since then lands here
        raise RuntimeError(f"Snap vault: {owner or 'this account'} has no vault key, so this private take can't be saved encrypted")
    snap_vault.seal(path, data, owner, pub, stub)


def plain(path, asker):
    """A container's plaintext for `asker` (raises snap_vault.Locked)."""
    return snap_vault.read_all(user_dir(), path, asker, admins())


@contextlib.contextmanager
def scratch(name):
    """A RAM-backed scratch file for a step that only reads paths (ffmpeg); unlinked at the end."""
    SCRATCH.mkdir(mode=0o700, exist_ok=True)
    p = SCRATCH / f"{uuid.uuid4().hex}_{os.path.basename(name)}"
    try:
        yield p
    finally:
        p.unlink(missing_ok=True)


@contextlib.contextmanager
def plain_copy(path, asker):
    """`path` itself for a plain file, else its plaintext in scratch."""
    if not snap_vault.sealed(path):
        yield path
        return
    with scratch(path) as p:
        p.write_bytes(plain(path, asker))
        yield str(p)


def sweep():
    """Scratch folders of servers that are gone (a crash mid-step)."""
    for d in SCRATCH.parent.glob("snap-vault-*"):
        pid = d.name.rsplit("-", 1)[-1]
        if pid.isdigit() and int(pid) != os.getpid() and not os.path.exists(f"/proc/{pid}"):
            shutil.rmtree(d, ignore_errors=True)
            logging.warning("Snap vault: removed scratch left by a stopped server (%s)", d)


# ---- saver twins ----------------------------------------------------------------------------------------------------
class MAISaveImageVault(nodes.SaveImage):
    DESCRIPTION = "Saves the images encrypted with their recipe inside (Snap's vault, for private takes where privacy is on)."

    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        marks = run_marks()
        full, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix + self.prefix_append, self.output_dir, images[0].shape[1], images[0].shape[0])
        results = []
        for n, image in enumerate(images):
            img = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))
            meta = None
            if not args.disable_metadata and marks.get("metadata") is not False:
                meta = PngInfo()
                if prompt is not None:
                    meta.add_text("prompt", json.dumps(prompt))
                for k, v in (extra_pnginfo or {}).items():
                    meta.add_text(k, json.dumps(v))
            file = f"{filename.replace('%batch_num%', str(n))}_{counter:05}_.png"
            buf = io.BytesIO()
            img.save(buf, "PNG", pnginfo=meta, compress_level=self.compress_level)
            seal_out(os.path.join(full, file), buf, marks)
            results.append({"filename": file, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}, "result": (images,)}


class MAIPreviewImageVault(MAISaveImageVault):
    __init__ = nodes.PreviewImage.__init__
    INPUT_TYPES = nodes.PreviewImage.INPUT_TYPES
    DESCRIPTION = "Previews the images, kept encrypted in temp/ (Snap's vault, for private takes where privacy is on)."


class Sealing:
    """The video a vault twin saves: save_to renders into memory, then writes a container at the path."""

    def __init__(self, video, marks):
        self.video, self.marks = video, marks

    def get_dimensions(self):
        return self.video.get_dimensions()

    def save_to(self, path, **kw):
        buf = io.BytesIO()
        self.video.save_to(buf, **kw)
        seal_out(path, buf, self.marks)


def untagged(video):
    """A stream copy keeps the source file's tags (its recipe): remux without them, in scratch (SNAP-R38, SNAP-R98)."""
    src = video.get_stream_source()
    ext = os.path.splitext(src)[1] if isinstance(src, str) else ".mp4"
    with scratch(f"in{ext}") as a, scratch(f"out{ext}") as b:
        if isinstance(src, str):
            a = src
        else:
            video.save_to(str(a))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(a), "-map", "0", "-map_metadata", "-1", "-c", "copy", str(b)], check=True, timeout=600)
        return InputImpl.VideoFromFile(io.BytesIO(b.read_bytes()))


class MAISaveVideoVault(SaveVideo):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id, schema.display_name = "MAISaveVideoVault", "Save Video (kept encrypted)"
        schema.description = "Saves the video encrypted with its recipe inside (Snap's vault, for private takes where privacy is on)."
        return schema

    @classmethod
    def execute(cls, video, **kwargs):
        marks = run_marks()
        if marks.get("metadata") is False:
            cls.hidden.prompt = cls.hidden.extra_pnginfo = None  # cls is this run's own clone
            if isinstance(video, InputImpl.VideoFromFile):
                video = untagged(video)
        out = super().execute(video=Sealing(video, marks), **kwargs)
        out.args = (video,)
        return out


class MAIVideoOutVault(MAIVideoOut):
    DESCRIPTION = "MAI Video Out kept encrypted, its meta.json and hold map too (Snap's vault, for private takes where privacy is on); no draft preview."

    def save(self, images, fps, filename_prefix, codec="h264", crf=18, audio=None, hold_map="", notes="", write_meta=True,
             draft_preview=False, latent=None, draft_vae_name="taeh3", prompt=None, extra_pnginfo=None):
        marks, t0 = run_marks(), time.time()
        if marks.get("metadata") is False:
            prompt, extra_pnginfo, write_meta = None, None, False
        w, h = int(images.shape[2]), int(images.shape[1])
        full, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory(), w, h)
        file = f"{filename}_{counter:05}_.mp4"
        metadata = {**(extra_pnginfo or {}), **({"prompt": prompt} if prompt is not None else {})}
        video = InputImpl.VideoFromComponents(Types.VideoComponents(images=images, audio=audio, frame_rate=Fraction(fps)))
        Sealing(video, marks).save_to(os.path.join(full, file), format=Types.VideoContainer("mp4"), codec=Types.VideoCodec(codec), metadata=metadata or None, crf=crf)
        base, sidecars, meta = os.path.join(full, f"{filename}_{counter:05}"), {}, {}
        if hold_map.strip():
            seal_out(base + ".holdmap.json", json.dumps(json.loads(hold_map)).encode(), marks)
            sidecars["holdmap"] = os.path.basename(base + ".holdmap.json")
        if write_meta:
            meta = {"file": file, "frames": int(images.shape[0]), "width": w, "height": h, "fps": fps, "codec": codec, "crf": crf, "audio": audio is not None,
                    "notes": notes, "encode_s": round(time.time() - t0, 2), "sidecars": sidecars, "written": time.strftime("%Y-%m-%dT%H:%M:%S")}
            seal_out(base + ".meta.json", json.dumps(meta, indent=1).encode(), marks)
        return {"ui": {"images": [{"filename": file, "subfolder": subfolder, "type": "output"}], "animated": (True,)}, "result": (os.path.join(full, file), json.dumps(meta))}


# ---- loader twins ---------------------------------------------------------------------------------------------------
def opener():
    return run_marks().get("vault")


# core confines loader paths to their folders, so a twin opens the container in memory, never through a scratch path
class MAILoadImageVault(nodes.LoadImage):
    def load_image(self, image):
        path = folder_paths.get_annotated_filepath(image)
        if not snap_vault.sealed(path):
            return super().load_image(image)
        c = InputImpl.VideoFromFile(io.BytesIO(plain(path, opener()))).get_components()
        dtype, device = comfy.model_management.intermediate_dtype(), comfy.model_management.intermediate_device()
        mask = 1.0 - c.alpha[..., -1] if c.alpha is not None else torch.zeros((c.images.shape[0], 64, 64))
        return c.images.to(device=device, dtype=dtype), mask.to(device=device, dtype=dtype)


class MAILoadImageMaskVault(nodes.LoadImageMask, MAILoadImageVault):  # its super().load_image is the twin's
    pass


class MAILoadVideoVault(LoadVideo):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id, schema.display_name = "MAILoadVideoVault", "Load Video (kept encrypted)"
        return schema

    @classmethod
    def execute(cls, file):
        path = folder_paths.get_annotated_filepath(file)
        source = InputImpl.VideoFromFile(io.BytesIO(plain(path, opener())) if snap_vault.sealed(path) else path)
        return cio.NodeOutput(source, ui=preview_input_video(file, source))


class MAILoadAudioVault(LoadAudio):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id, schema.display_name = "MAILoadAudioVault", "Load Audio (kept encrypted)"
        return schema

    @classmethod
    def execute(cls, audio):
        path = folder_paths.get_annotated_filepath(audio)
        waveform, sample_rate = load_audio(io.BytesIO(plain(path, opener())) if snap_vault.sealed(path) else path)
        return cio.NodeOutput({"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate})


SAVERS = {"SaveImage": "MAISaveImageVault", "PreviewImage": "MAIPreviewImageVault", "SaveVideo": "MAISaveVideoVault", "MAIVideoOut": "MAIVideoOutVault"}
LOADERS = {"LoadImage": "MAILoadImageVault", "LoadImageMask": "MAILoadImageMaskVault", "LoadVideo": "MAILoadVideoVault", "LoadAudio": "MAILoadAudioVault"}


def containers(value):
    """The containers a string input names: an input/output/temp file (annotated as core does) or a model-folder file."""
    if not isinstance(value, str) or not value or "\n" in value or len(value) > 1024:
        return []
    try:
        found = [folder_paths.get_annotated_filepath(value)]
    except ValueError:  # core refuses a path outside its folders; an absolute one is checked as it is below
        found = []
    if os.path.isabs(value):
        found.append(value)
    for f in folder_paths.folder_names_and_paths:
        try:
            p = folder_paths.get_full_path(f, value)
        except (ValueError, OSError):  # Windows: text with a drive-like start is not a file name
            p = None
        if p:
            found.append(p)
    return sorted({p for p in found if os.path.isfile(p) and snap_vault.sealed(p)})


def seal_prompt(json_data, found, saver):
    """metadata_gate's vault step: {} with the vault off; else swaps savers and loaders of a private prompt for the
    vault twins (a prompt that reads a container is private) and refuses what can't run sealed; `saver(class_type)` says
    whether another node writes a file with the recipe (snap_bridge.writes_metadata). Returns the owner, the
    nodes swapped (node id -> the class it stood in for) and notes for nodes the vault can't cover."""
    if not on():
        return {}
    prompt = json_data["prompt"]
    owner, keys, cuts = asking.get(), admins(), {}
    title = lambda nid: (prompt[nid].get("_meta") or {}).get("title") or prompt[nid].get("class_type")
    reads = {nid: [p for v in (n.get("inputs") or {}).values() for p in containers(v)] for nid, n in prompt.items()}
    reads = {nid: ps for nid, ps in reads.items() if ps}
    if reads:
        found["private"].append(f"node {', '.join(sorted(reads))} reads a take kept encrypted")
    if not found["private"]:
        return {}
    swapped, notes, refused = {}, [], {}
    for nid, paths in reads.items():
        for p in paths:
            try:
                snap_vault.key_for(user_dir(), owner, snap_vault.Container(p).header["owner"], keys)
            except snap_vault.Locked:
                refused[nid] = f"Node {nid} ({title(nid)}) reads a take kept encrypted while the vault is locked: unlock it (sign in) and run again."
        if prompt[nid].get("class_type") not in LOADERS:
            notes.append(f"node {nid} ({title(nid)}) names a take kept encrypted, and only Load Image, Load Image Mask, Load Video and Load Audio open one: it will fail to read it")
    for nid, node in prompt.items():
        kind = node.get("class_type")
        if kind in SAVERS and (owner is None or snap_vault.public(user_dir(), owner) is None):
            refused[nid] = (f"Node {nid} ({title(nid)}) saves a private take, which this install keeps encrypted, and "
                            + ("the prompt names no ComfyUI user (send the comfy-user header)." if owner is None else "this account has no vault key yet: sign in again (snap-gate makes it at sign-in) or set it up from Snap's lock sheet."))
        elif kind in SAVERS or (kind in LOADERS and nid in reads):
            swapped[nid], node["class_type"] = kind, (SAVERS | LOADERS)[kind]
        elif kind not in LOADERS and kind != "MAIRatingRefused" and saver(kind):
            notes.append(f"node {nid} ({title(nid)}) saves this private take in plain: Snap keeps Save Image, Preview Image, Save Video and MAI Video Out encrypted")
    if refused:
        logging.warning("Snap vault: refused %s's private prompt (nodes %s)", owner, ", ".join(refused))
        json_data["prompt"] = {nid: {"class_type": "MAIRatingRefused", "inputs": {"why": why}, "_meta": prompt[nid].get("_meta", {})} for nid, why in refused.items()}
    if notes:
        logging.warning("Snap vault: %s", "; ".join(notes))
    return {"owner": owner, "swapped": swapped, "notes": notes}


# ---- the middleware: /view, take records, uploads, who queued a prompt ------------------------------------------------
STUB = ("id", "kind", "prompt_id", "created", "finished", "seconds", "group", "workflow", "number", "status", "media", "private", "nsfw",
        "rating", "rating_set", "parent", "made_from", "verdict", "prior", "metadata", "cached_from", "sound", "updated", "world", "story", "hash", "seed_hash")  # `story`: a Book cut's beat pin, listed like `world` (SNAP-R68)


def record(path, asker):
    """A sealed take record as `asker` may see it: the record (kept_encrypted), or its listing stub while locked."""
    try:
        return {**json.loads(plain(path, asker)), "kept_encrypted": True}
    except snap_vault.Locked:
        return {**(snap_vault.Container(path).header.get("stub") or {}), "notes": [], "prompt": None, "graph": None, "kept_encrypted": True, "locked": True}


def tile():
    """The picture a locked <img> gets instead of a broken image."""
    img = Image.new("RGB", (320, 180), (26, 27, 31))
    d = ImageDraw.Draw(img)
    d.rectangle((140, 60, 180, 100), outline=(154, 156, 166), width=3)
    d.arc((146, 38, 174, 74), 180, 360, fill=(154, 156, 166), width=3)
    d.text((160, 132), "kept encrypted (locked)", fill=(236, 236, 241), anchor="mm", font=ImageFont.load_default(size=20))
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def view_path(request):
    """The file core's /view would serve, resolved as core does, or None."""
    q = request.rel_url.query
    name, root = folder_paths.annotated_filepath(q.get("filename", ""))
    if not name or name.startswith("blake3:") or name[0] == "/" or ".." in name:
        return None
    root = root or folder_paths.get_directory_by_type(q.get("type", "output"))
    if root is None:
        return None
    if "subfolder" in q:
        sub = os.path.join(root, q["subfolder"])
        if os.path.commonpath((os.path.abspath(sub), root)) != root:
            return None
        root = sub
    path = os.path.join(root, os.path.basename(name))
    return path if os.path.isfile(path) else None


async def view(request, handler):
    path = view_path(request)
    if path is None or not snap_vault.sealed(path):
        return await handler(request)
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    try:
        c, key = await asyncio.to_thread(snap_vault.open_file, user_dir(), path, requester(request), admins())
    except snap_vault.Locked as e:
        if request.headers.get("Sec-Fetch-Dest") == "image":
            return web.Response(body=tile(), content_type="image/png", headers=headers)
        return web.json_response({"error": str(e), "locked": True, "kept_encrypted": True}, status=423, headers=headers)
    size, rng = c.size, request.http_range
    start, stop = rng.start, rng.stop
    if start is not None and start < 0:
        start, stop = max(0, size + start), size
    start, stop = start or 0, size if stop is None else min(stop, size)
    if start >= stop and size:
        return web.Response(status=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    ranged = rng.start is not None or rng.stop is not None
    name = c.header["name"]
    resp = web.StreamResponse(status=206 if ranged else 200, headers={
        **headers, "Accept-Ranges": "bytes", "Content-Type": mimetypes.guess_type(name)[0] or "application/octet-stream",
        "Content-Disposition": f'filename="{name}"', "Content-Length": str(stop - start), **({"Content-Range": f"bytes {start}-{stop - 1}/{size}"} if ranged else {})})
    await resp.prepare(request)
    if stop > start:
        for i, chunk in c.chunks(key, start // c.chunk, (stop - 1) // c.chunk):
            lo = max(start - i * c.chunk, 0)
            await resp.write(chunk[lo:stop - i * c.chunk])
    await resp.write_eof()
    return resp


def take_path(request):
    """A take record's file (user/<id>/snap/takes/*.json) a /userdata request names, or None."""
    file = request.match_info.get("file")
    if not file or "dest" in request.match_info:
        return None
    try:
        path = PromptServer.instance.user_manager.get_request_user_filepath(request, file, create_dir=False)
        root = PromptServer.instance.user_manager.get_request_user_filepath(request, "snap/takes", create_dir=False)
    except KeyError:
        return None
    return path if path and root and path.endswith(".json") and os.path.dirname(path) == root else None


async def take_record(request, handler, path):
    user = requester(request)
    if request.method == "GET":
        if not os.path.isfile(path) or not snap_vault.sealed(path):
            return await handler(request)
        return web.json_response(await asyncio.to_thread(record, path, user), headers={"Cache-Control": "no-store"})
    body = await request.read()
    try:
        rec = json.loads(body)
    except ValueError:
        return await handler(request)
    if not isinstance(rec, dict):
        return await handler(request)
    takes = os.path.dirname(path)
    parents = [p for p in [(rec.get("parent") or {}).get("take"), *(rec.get("made_from") or [])] if isinstance(p, str)]
    if not (rec.get("private") or (os.path.isfile(path) and snap_vault.sealed(path)) or any(snap_vault.sealed(os.path.join(takes, f"{p}.json")) for p in parents)):
        return await handler(request)
    if rec.get("locked") and rec.get("kept_encrypted"):
        return web.json_response({"error": "kept encrypted (locked): unlock the vault (sign in) to change this take", "locked": True}, status=423)
    if request.query.get("overwrite", "true") == "false" and os.path.exists(path):
        return web.Response(status=409, text="File already exists")
    rec.pop("kept_encrypted", None)
    try:
        await asyncio.to_thread(seal_out, path, json.dumps(rec).encode(), {"vault": user}, {k: rec[k] for k in STUB if k in rec})
    except RuntimeError as e:
        return web.json_response({"error": str(e)}, status=423)
    user_root = PromptServer.instance.user_manager.get_request_user_filepath(request, None)
    rel = os.path.relpath(path, user_root).replace(os.sep, "/")
    if request.query.get("full_info", "false").lower() == "true":
        st = os.stat(path)
        return web.json_response({"path": rel, "size": st.st_size, "modified": int(st.st_mtime * 1000), "created": int(st.st_ctime * 1000)})
    return web.json_response(rel)


async def upload(request, handler):
    form = await request.post()
    if form.get("snap_vault") != "1":
        return await handler(request)
    image, kind = form.get("image"), form.get("type") or "input"
    root = folder_paths.get_directory_by_type(kind)
    if not isinstance(image, web.FileField) or root is None:
        return web.json_response({"error": "Upload one file as `image`."}, status=400)
    sub = str(form.get("subfolder") or "")
    folder = os.path.abspath(os.path.join(root, os.path.normpath(sub)))
    name = os.path.basename(image.filename or "")
    if not name or os.path.commonpath((root, folder)) != root:
        return web.Response(status=400)
    os.makedirs(folder, exist_ok=True)
    try:
        await asyncio.to_thread(seal_out, os.path.join(folder, name), image.file.read(), {"vault": requester(request)})
    except RuntimeError as e:
        return web.json_response({"error": str(e)}, status=423)
    return web.json_response({"name": name, "subfolder": sub, "type": kind})


@web.middleware
async def middleware(request, handler):
    p = request.path[4:] if request.path.startswith("/api/") else request.path
    if p not in ("/view", "/prompt", "/upload/image") and not p.startswith("/userdata/"):
        return await handler(request)
    if not on():
        return await handler(request)
    if p == "/view" and request.method == "GET":
        return await view(request, handler)
    if p == "/prompt" and request.method == "POST":
        token = asking.set(requester(request))
        try:
            return await handler(request)
        finally:
            asking.reset(token)
    if p == "/upload/image" and request.method == "POST":
        return await upload(request, handler)
    path = take_path(request) if request.method in ("GET", "POST") else None
    return await take_record(request, handler, path) if path else await handler(request)


# ---- keys per account -----------------------------------------------------------------------------------------------
def status_of(user):
    if not on():
        return {"vault": "off"}
    entry = snap_vault.load_keys(user_dir())["accounts"].get(user)
    state = "none" if entry is None else "unlocked" if user in snap_vault.unlocked else "locked"
    return {"vault": state, "account": user, "escrow": [s["to"] for s in (entry or {}).get("escrow", []) if s["to"] != "recovery"],
            "recovery": any(s["to"] == "recovery" for s in (entry or {}).get("escrow", [])), "view": "decrypted" if middleware in PromptServer.instance.app.middlewares else "unwrapped",
            "limits": "Protects private takes at rest from other accounts and from anyone reading the disk. It does not protect against someone with this machine's account or root while the vault is unlocked, swap, or GPU memory."}


async def body_of(request):
    try:
        b = await request.json()
    except ValueError:
        b = None
    return b if isinstance(b, dict) else {}


def vault_route(fn):
    async def run(request):
        if not on():
            return web.json_response({"vault": "off"})
        user = requester(request)
        if user is None:
            return web.json_response({"error": "send your ComfyUI user as the comfy-user header"}, status=403)
        return await fn(request, user, await body_of(request) if request.method == "POST" else {})
    return run


@routes.get("/mainodes/snap/vault/status")
@vault_route
async def status(request, user, body):
    return web.json_response(status_of(user))


@routes.post("/mainodes/snap/vault/setup")
@vault_route
async def setup(request, user, body):
    if not body.get("passphrase"):
        return web.json_response({"error": "a passphrase is needed (behind snap-gate, the sign-in password)"}, status=400)
    try:
        words = await asyncio.to_thread(snap_vault.setup, user_dir(), user, body["passphrase"], admins(), bool(body.get("recovery")))
    except FileExistsError:
        return web.json_response({**status_of(user), "error": "this account already has a vault key; unlock it"}, status=409)
    return web.json_response({**status_of(user), **({"recovery_key": words, "said": RECOVERY_SAID} if words else {})})


@routes.post("/mainodes/snap/vault/unlock")
@vault_route
async def unlock(request, user, body):
    n, until = fails.get(user, (0, 0))
    if until > time.time():
        wait = int(until - time.time()) + 1
        return web.json_response({"error": f"too many wrong passphrases: try again in {wait} s", "retry_after": wait}, status=429, headers={"Retry-After": str(wait)})
    try:
        await asyncio.to_thread(snap_vault.unlock, user_dir(), user, str(body.get("passphrase", "")), admins())
    except KeyError:
        return web.json_response({**status_of(user), "error": "this account has no vault key yet: set one up"}, status=404)
    except snap_vault.WrongPassphrase:
        n += 1
        fails[user] = (n, time.time() + min(WAIT_CAP, WAIT_FIRST * 2 ** (n - FREE_TRIES)) if n >= FREE_TRIES else 0)
        await asyncio.sleep(0.5)
        return web.json_response({**status_of(user), "error": "locked: that passphrase doesn't open this vault (if the password changed, an admin can reset it with rewrap)"}, status=401)
    fails.pop(user, None)
    return web.json_response(status_of(user))


@routes.post("/mainodes/snap/vault/lock")
@vault_route
async def lock(request, user, body):
    snap_vault.unlocked.pop(user, None)
    return web.json_response(status_of(user))


@routes.post("/mainodes/snap/vault/rewrap")
@vault_route
async def rewrap(request, user, body):
    """An unlocked admin resets an account's passphrase through escrow."""
    who, new = body.get("account"), body.get("new_passphrase")
    if user not in admins() or user not in snap_vault.unlocked:
        return web.json_response({"error": "only an unlocked admin resets another account's vault passphrase"}, status=403)
    if not isinstance(who, str) or not new:
        return web.json_response({"error": "give account (its ComfyUI user id) and new_passphrase"}, status=400)
    try:
        priv = snap_vault.escrowed(user_dir(), who, snap_vault.unlocked[user], user)
    except snap_vault.Locked as e:
        return web.json_response({"error": str(e)}, status=404)
    await asyncio.to_thread(snap_vault.reset, user_dir(), who, priv, new, admins())
    return web.json_response({"account": who, "reset": True})


@routes.post("/mainodes/snap/vault/recovery_key")
@vault_route
async def recovery_key(request, user, body):
    if user not in snap_vault.unlocked:
        return web.json_response({**status_of(user), "error": "unlock the vault first"}, status=423)
    words = await asyncio.to_thread(snap_vault.add_recovery, user_dir(), user, snap_vault.unlocked[user])
    return web.json_response({**status_of(user), "recovery_key": words, "said": RECOVERY_SAID})


@routes.post("/mainodes/snap/vault/recover")
@vault_route
async def recover(request, user, body):
    try:
        priv = snap_vault.escrowed(user_dir(), user, snap_vault.from_words(str(body.get("recovery_key", ""))), "recovery")
    except (snap_vault.Locked, ValueError) as e:
        return web.json_response({"error": f"that recovery key doesn't open this vault ({e})"}, status=401)
    if not body.get("new_passphrase"):
        return web.json_response({"error": "give new_passphrase"}, status=400)
    await asyncio.to_thread(snap_vault.reset, user_dir(), user, priv, body["new_passphrase"], admins())
    snap_vault.unlocked[user] = priv
    return web.json_response(status_of(user))


try:
    PromptServer.instance.app.middlewares.append(middleware)
except RuntimeError as e:  # the app froze before the pack loaded: containers would be served as they are (status says "unwrapped")
    logging.error("Snap vault: the /view middleware wasn't accepted (%s); encrypted takes can't be shown", e)
if on():
    sweep()
    if args.enable_assets:
        logging.warning("Snap vault: the assets scanner is on; its thumbnails of private takes would be plain. Start without --enable-assets.")

NODE_CLASS_MAPPINGS = {"MAISaveImageVault": MAISaveImageVault, "MAIPreviewImageVault": MAIPreviewImageVault, "MAISaveVideoVault": MAISaveVideoVault, "MAIVideoOutVault": MAIVideoOutVault,
                       "MAILoadImageVault": MAILoadImageVault, "MAILoadImageMaskVault": MAILoadImageMaskVault, "MAILoadVideoVault": MAILoadVideoVault, "MAILoadAudioVault": MAILoadAudioVault}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISaveImageVault": "Save Image (kept encrypted)", "MAIPreviewImageVault": "Preview Image (kept encrypted)", "MAIVideoOutVault": "MAI Video Out (kept encrypted)",
                              "MAILoadImageVault": "Load Image (kept encrypted)", "MAILoadImageMaskVault": "Load Image Mask (kept encrypted)"}
