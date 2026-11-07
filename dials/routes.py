"""The /mainodes/dials server routes: rack presets, dial geometry, interactions, info, probe profiles and the dial editor."""
import asyncio
import json

from aiohttp import web
from server import PromptServer

from . import analysis, core, editor, presets


def error(message, status=400):
    return web.json_response({"error": message}, status=status)


async def respond(fn, *args, taken=None, missing=None):
    """fn(*args) in a thread, as JSON. A ValueError answers 400 with its reason, a missing file 400 with its reason (or 404
    with `missing`), an existing file 409 with `taken` (only functions that create files raise it)."""
    try:
        return web.json_response(await asyncio.to_thread(fn, *args))
    except FileExistsError:
        return error(taken, 409)
    except FileNotFoundError as e:
        return error(missing, 404) if missing else error(str(e))
    except ValueError as e:
        return error(str(e))


PRESET_TAKEN = "Preset already exists. Choose a new name."
PRESET_MISSING = "Preset not found."


def install():
    routes = PromptServer.instance.routes

    @routes.get("/mainodes/dials/presets")
    async def preset_listing(request):
        return web.json_response(await asyncio.to_thread(presets.list_presets))

    @routes.get("/mainodes/dials/presets/{name}")
    async def preset_load(request):
        return await respond(presets.load_preset, request.match_info["name"], missing=PRESET_MISSING)

    @routes.post("/mainodes/dials/presets/{name}")
    async def preset_save(request):
        try:
            rows = await request.json()
        except ValueError:
            return error("Expected rack rows as JSON.")
        return await respond(presets.save_preset, request.match_info["name"], rows, taken=PRESET_TAKEN, missing=PRESET_MISSING)

    @routes.post("/mainodes/dials/geometry")
    async def geometry(request):  # norms and cosines for the rack's pad readouts
        try:
            names = (await request.json())["dials"]
        except (ValueError, KeyError, TypeError):
            return error("Expected {\"dials\": [dial file names]}.")
        return await respond(core.dial_geometry, names)

    @routes.post("/mainodes/dials/interactions")
    async def interactions(request):  # dots once per set of files; the rack redoes the bookkeeping as sliders move
        try:
            return await respond(core.dial_interactions, (await request.json())["rows"])
        except (KeyError, TypeError):
            return error("Expected {\"rows\": [{\"dial\": <dial file>, \"strength\": <number>}]}.")
        except ValueError as e:
            return error(str(e))

    @routes.get("/mainodes/dials/catalog")
    async def catalog(request):  # every dial with its family and info in one call (Snap's dial picker)
        return web.json_response(await asyncio.to_thread(core.dial_catalog))

    @routes.get("/mainodes/dials/info")
    async def info(request):  # description, side labels, useful and overcook strengths for one dial file
        return await respond(core.dial_info, request.query.get("dial", ""))

    @routes.get("/mainodes/dials/file")
    async def dial_file(request):  # where a dial file is, its tensors' hash and info (info edits keep the hash)
        return await respond(core.dial_file, request.query.get("dial", ""))

    @routes.post("/mainodes/dials/info")
    async def save_info(request):
        try:
            body = await request.json()
            return await respond(core.save_dial_info, body["dial"], body["info"])
        except (KeyError, TypeError):
            return error("Expected {\"dial\": <dial file>, \"info\": {...}}.")
        except ValueError as e:
            return error(str(e))

    @routes.get("/mainodes/dials/profile")
    async def profile(request):  # probe-bank coefficients of one post-refiner dial file (direct and ridge joint fit)
        return await respond(analysis.dial_profile, request.query.get("dial", ""))

    @routes.get("/mainodes/dials/editor")
    async def editor_state(request):  # probe profile, library and Gram numbers for one post-refiner dial file
        return await respond(editor.editor_state, request.query.get("dial", ""))

    @routes.post("/mainodes/dials/editor/export")
    async def editor_export(request):
        try:
            body = await request.json()
            return await respond(editor.export_edit, body["dial"], body["edits"], body["name"], body.get("info"),
                                 taken="A dial with that name already exists. Choose a new name.")
        except (KeyError, TypeError, json.JSONDecodeError):
            return error("Expected {\"dial\": <dial file>, \"edits\": [...], \"name\": <new name>, \"info\": {...}}.")
