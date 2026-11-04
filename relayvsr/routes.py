"""/mainodes/relayvsr/check: what a RelayVSR run would fail on before it starts (Snap's Upscale brick asks it)."""
from pathlib import Path

from aiohttp import web
from server import PromptServer

from .bridge import find_root, find_weights


@PromptServer.instance.routes.post("/mainodes/relayvsr/check")
async def check(request):
    s = await request.json()  # a RelayVSR Settings node's widget values
    problems, root = [], None
    try:
        root = find_root(s.get("lightx2v_root", "auto"))
    except FileNotFoundError:
        problems.append("LightX2V not found")
    try:
        find_weights(root or Path("."), s.get("model_dir", "auto"), s["variant"])
    except (FileNotFoundError, RuntimeError, KeyError):
        problems.append("weights not found")
    return web.json_response({"ready": not problems, "problems": problems, "lightx2v": str(root) if root else None,
                              "help": "lightx2v_root (or RELAYVSR_LIGHTX2V_ROOT when ComfyUI starts) names the LightX2V checkout; "
                                      "the variant's checkpoints go in models/relayvsr/ (or model_dir)"})
