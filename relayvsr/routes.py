"""/mainodes/relayvsr/check: what a RelayVSR run would fail on before it starts (Snap's Upscale brick asks it)."""
from pathlib import Path

from aiohttp import web
from server import PromptServer

from .bridge import Settings, find_root, resolve_wan
from .nodes import present_quants, quality_spec, vram_knobs


@PromptServer.instance.routes.post("/mainodes/relayvsr/check")
async def check(request):
    s = await request.json()  # a RelayVSR Settings node's widget values
    problems, root = [], None
    try:
        root = find_root(s.get("lightx2v_root", "auto"))
    except FileNotFoundError:
        problems.append("LightX2V not found")
    try:
        mode, ids = s.get("execution_mode", "single GPU"), s.get("gpu_ids", "0")
        tier = s.get("vram", "auto (pick by GPU memory)")
        present = present_quants(s.get("lightx2v_root", "auto"), s.get("model_dir", "auto"), s["variant"]) if tier.startswith("auto") else ()
        knobs = vram_knobs(tier, mode, ids, present)
        profile = quality_spec(None, "stock (the model as shipped)", 0, 1, "bicubic", knobs)
        settings = Settings(variant=s["variant"], model_dir=s.get("model_dir", "auto"), mode=mode, gpu_ids=ids, loop_experiment=profile)
        resolve_wan(root or Path("."), settings)
    except (FileNotFoundError, RuntimeError, KeyError, ValueError):
        problems.append("weights not found")
    return web.json_response({"ready": not problems, "problems": problems, "lightx2v": str(root) if root else None,
                              "help": "lightx2v_root (or RELAYVSR_LIGHTX2V_ROOT when ComfyUI starts) names the LightX2V checkout; "
                                      "the variant's checkpoints go in models/relayvsr/ (or model_dir)"})
