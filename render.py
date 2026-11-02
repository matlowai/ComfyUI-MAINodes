"""Simple front door: Render Preset (model, LoRA, flow shifts, FL2V/Ref2V, sampler, stage-1 sigmas, cfg, saved as named
presets) and H3 De-rope Sigmas (the de-rope pass's schedule from a continuous inject on the active preset's schedule)."""
import asyncio
import json
import math
import re

import torch

import comfy.samplers
import folder_paths
import nodes
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3SigmaShift

from .dials.presets import preset_dir

FORMAT = "MAIRenderPreset"
VERSION = 1
CONDITIONING = ["FL2V (first frame)", "Ref2V (reference pictures)"]  # the Branch labels inside the Simple blueprint
SCHEDULES = ["manual", *comfy.samplers.SCHEDULER_NAMES]
PIKA = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
FIELDS = {"model": str, "lora": str, "lora_strength": float, "conditioning": str, "sampler": str, "schedule": str,
          "sigmas": str, "steps": int, "derope_steps": int, "shift_video": float, "shift_audio": float, "cfg": float}
PIKA_PRESET = dict(model="minimax_h3_fl2va_pruned_int8_convrot.safetensors", lora="pika_h3_flex_fl2va_v1_bf16.safetensors",
                   lora_strength=1.0, conditioning=CONDITIONING[0], sampler="lcm", schedule="manual", sigmas=PIKA, steps=6,
                   derope_steps=0, shift_video=12.0, shift_audio=3.0, cfg=1.0)
# names with spaces cannot collide with saved presets, whose names are letters, digits, '_' and '-'
BUILTIN = {
    "Pika H3 Flex": PIKA_PRESET,
    "Pika + reference pictures": dict(PIKA_PRESET, conditioning=CONDITIONING[1]),
    # the DMAD authors' settings (github.com/Yzmblog/DMAD, comfyui/): lcm + simple (lcm re-noises as the students were trained),
    # 4 steps for the 4-step student, video shift 12 / audio shift 2, cfg 1, LoRA 1.0
    "DMAD speed LoRA": dict(PIKA_PRESET, lora="minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", sampler="lcm",
                            schedule="simple", sigmas="", steps=4, shift_audio=2.0),
}


def resample(points, steps):
    """steps + 1 values along the piecewise-linear curve through points (evenly spaced in step index)."""
    n = len(points) - 1
    out = []
    for k in range(steps + 1):
        x = k * n / steps
        i = min(int(x), n - 1)
        out.append(points[i] + (points[i + 1] - points[i]) * (x - i))
    return out


def stage_sigmas(model_sampling, schedule, sigmas, steps):
    """Stage 1: a manual list (Pika's knots; another step count resamples it) or a scheduler on the model's own shift."""
    if schedule != "manual":
        return comfy.samplers.calculate_sigmas(model_sampling, schedule, steps).cpu()
    knots = [float(x) for x in re.findall(r"[-+]?(?:\d*\.*\d+)", sigmas)]  # parsed as ManualSigmas parses
    if len(knots) < 2:
        raise ValueError("manual schedule: give at least two sigmas, e.g. Pika's '" + PIKA + "'")
    return torch.FloatTensor(knots if steps == len(knots) - 1 else resample(knots, steps))


def derope_sigmas(model_sampling, sigmas, inject, steps=0):
    """Start at the sigma where a fraction inject of the denoise is left, then the stage-1 sigmas below it;
    steps > 0 resamples that tail to steps steps."""
    start = model_sampling.percent_to_sigma(1.0 - inject)
    points = [start] + [float(s) for s in sigmas if s < start]
    return torch.FloatTensor(points if not steps or steps == len(points) - 1 else resample(points, steps))


def render_dir():
    return preset_dir() / "render"


def check_preset(p):
    if not isinstance(p, dict) or set(p) != set(FIELDS):
        raise ValueError("a render preset has exactly these fields: " + ", ".join(FIELDS))
    for k, t in FIELDS.items():
        v = p[k]
        if isinstance(v, bool) or not isinstance(v, (int, float) if t is float else t) or (t is float and not math.isfinite(v)):
            raise ValueError(f"render preset {k} must be a {t.__name__}")
    if p["conditioning"] not in CONDITIONING or p["schedule"] not in SCHEDULES:
        raise ValueError(f"render preset conditioning must be one of {CONDITIONING}, schedule one of {SCHEDULES}")
    if p["steps"] < 1 or p["derope_steps"] < 0 or min(p["shift_video"], p["shift_audio"]) <= 0 or p["cfg"] < 0:
        raise ValueError("render preset steps must be at least 1, derope_steps and cfg at least 0, shifts above 0")
    return p


def preset_path(name):
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", name):
        raise ValueError("preset name: letters, digits, '_' and '-' only (max 80)")
    return render_dir() / f"{name}.json"


def list_presets():
    saved = sorted(p.stem for p in render_dir().glob("*.json") if re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", p.stem))
    return [*BUILTIN, *saved]


def load_preset(name):
    if name in BUILTIN:
        return dict(BUILTIN[name])
    with preset_path(name).open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or data.get("format") != FORMAT or data.get("version") != VERSION:
        raise ValueError(f"unsupported render preset format (expected {FORMAT} v{VERSION})")
    return check_preset(data.get("preset"))


def save_preset(name, preset):
    path = preset_path(name)
    payload = json.dumps(dict(format=FORMAT, version=VERSION, preset=check_preset(preset)), indent=2, allow_nan=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as f:
        f.write(payload)
    return preset


def install_routes():
    from aiohttp import web
    from server import PromptServer

    srv = getattr(PromptServer, "instance", None)
    if srv is None or getattr(srv, "_mai_render_preset_routes", False):
        return

    async def respond(fn, *args):
        try:
            return web.json_response(await asyncio.to_thread(fn, *args))
        except FileExistsError:
            return web.json_response({"error": "Preset already exists. Choose a new name."}, status=409)
        except FileNotFoundError:
            return web.json_response({"error": "Preset not found."}, status=404)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)

    @srv.routes.get("/mainodes/render/presets")
    async def listing(request):
        return await respond(list_presets)

    @srv.routes.get("/mainodes/render/presets/{name}")
    async def load(request):
        return await respond(load_preset, request.match_info["name"])

    @srv.routes.post("/mainodes/render/presets/{name}")
    async def save(request):
        try:
            preset = await request.json()
        except ValueError:
            return web.json_response({"error": "Expected the preset fields as JSON."}, status=400)
        return await respond(save_preset, request.match_info["name"], preset)

    srv._mai_render_preset_routes = True


install_routes()


class RenderPreset(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIRenderPreset",
            display_name="Render Preset (alpha)",
            category="MAINodes/Dials",
            description="Everything a render recipe needs in one node, switched together by named presets (Pika H3 Flex, Pika + "
                        "reference pictures, DMAD speed LoRA, or your own, saved in models/loras/dials/presets/render/): model, LoRA, "
                        "flow shifts, FL2V or Ref2V, sampler, the stage-1 schedule and steps, de-rope steps and cfg. Stage 2 (de-rope) "
                        "uses the same sampler and a tail of the same schedule.",
            inputs=[
                io.Combo.Input("model", options=folder_paths.get_filename_list("diffusion_models"), tooltip="MiniMax H3 diffusion model"),
                io.Combo.Input("lora", options=["none", *folder_paths.get_filename_list("loras")], tooltip="speed or style LoRA (model only)"),
                io.Float.Input("lora_strength", default=1.0, min=-10.0, max=10.0, step=0.05),
                io.Combo.Input("conditioning", options=CONDITIONING,
                               tooltip="FL2V: prompt + optional first frame. Ref2V: prompt naming <Picture 1> / <Picture 2> + reference pictures."),
                io.Combo.Input("sampler", options=comfy.samplers.SAMPLER_NAMES, default="lcm"),
                io.Combo.Input("schedule", options=SCHEDULES,
                               tooltip="manual: the sigmas below (Pika's 6 knots); or a scheduler on the model's own shift."),
                io.String.Input("sigmas", default=PIKA, tooltip="manual schedule only. With steps other than the list's, the list is resampled (untested)."),
                io.Int.Input("steps", default=6, min=1, max=200, tooltip="stage 1 (the normal render) steps"),
                io.Int.Input("derope_steps", default=0, min=0, max=200,
                             tooltip="stage 2 (de-rope) steps. 0 = auto: the stage-1 steps below the de-rope amount (Pika at 0.48: 4)."),
                io.Float.Input("shift_video", default=12.0, min=0.01, max=100.0, step=0.01, tooltip="video flow shift (H3: 12), as core's ModelSamplingMiniMaxH3"),
                io.Float.Input("shift_audio", default=3.0, min=0.01, max=100.0, step=0.01, tooltip="audio flow shift (H3: 3; T8's DMAD recipe: 2)"),
                io.Float.Input("cfg", default=1.0, min=0.0, max=30.0, step=0.1,
                               tooltip="1 for distilled LoRAs (Pika, DMAD). Above 1 the blueprint guides against a zeroed copy of the prompt (untested)."),
            ],
            outputs=[io.Model.Output(), io.Sampler.Output(), io.Sigmas.Output(display_name="sigmas"),
                     io.Int.Output(display_name="derope_steps"), io.String.Output(display_name="conditioning"), io.Float.Output(display_name="cfg")],
        )

    @classmethod
    def execute(cls, model, lora, lora_strength, conditioning, sampler, schedule, sigmas, steps, derope_steps, shift_video, shift_audio,
                cfg) -> io.NodeOutput:
        m = nodes.UNETLoader().load_unet(model, "default")[0]
        if lora != "none":
            m = nodes.LoraLoaderModelOnly().load_lora_model_only(m, lora, lora_strength)[0]
        m = MiniMaxH3SigmaShift.execute(model=m, shift_video=shift_video, shift_audio=shift_audio).result[0]
        stage1 = stage_sigmas(m.get_model_object("model_sampling"), schedule, sigmas, steps)
        return io.NodeOutput(m, comfy.samplers.sampler_object(sampler), stage1, derope_steps, conditioning, cfg)


class DeropeSigmas(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3DeropeSigmas",
            display_name="H3 De-rope Sigmas (alpha)",
            category="MAINodes/Dials",
            description="The de-rope pass's schedule: start where a fraction inject of the denoise is left (continuous, on the "
                        "model's shift; Pika at 0.48 starts at 0.9172), then the stage-1 sigmas below it.",
            inputs=[
                io.Model.Input("model"),
                io.Sigmas.Input("sigmas", tooltip="stage 1's sigmas"),
                io.Float.Input("inject", default=0.48, min=0.05, max=1.0, step=0.01,
                               tooltip="de-rope amount: how much of the denoise stage 2 re-runs. 0.48 stays faithful to pass 1, 0.7 is looser."),
                io.Int.Input("steps", default=0, min=0, max=200, tooltip="0 = the stage-1 steps below the start; otherwise that tail resampled"),
            ],
            outputs=[io.Sigmas.Output()],
        )

    @classmethod
    def execute(cls, model, sigmas, inject, steps) -> io.NodeOutput:
        return io.NodeOutput(derope_sigmas(model.get_model_object("model_sampling"), sigmas, inject, steps))


NODE_CLASS_MAPPINGS = {"MAIRenderPreset": RenderPreset, "H3DeropeSigmas": DeropeSigmas}
NODE_DISPLAY_NAME_MAPPINGS = {"MAIRenderPreset": "Render Preset (alpha)", "H3DeropeSigmas": "H3 De-rope Sigmas (alpha)"}
