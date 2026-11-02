#!/usr/bin/env python3
"""Render Preset and H3 De-rope Sigmas (render.py), and Make Dial from Pictures' folder inputs.

  python tests/test_render_preset.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files. Checks:
  1. the Pika preset's manual schedule at 6 steps is exactly what ManualSigmas makes of the same text;
     a scheduler preset is exactly BasicScheduler's sigmas;
  2. de-rope sigmas start at the continuous inject on H3's shift 12 (0.48 -> 0.9171975, 0.50 -> 0.9230769) followed by the
     stage-1 sigmas below; DMAD (simple, 4 steps) at 0.48 gets 2 steps; an explicit step count resamples the tail;
  3. render presets: built-ins first, save / load round trip under models/loras/dials/presets/render/, no overwrite,
     bad names and bad fields refused;
  4. picture folders: pictures load at their own sizes in file-name order; folders outside input/ are refused.
"""
import importlib
import json
import os
import sys
import tempfile
import types
from unittest.mock import patch

import numpy as np
import torch
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
COMFY = os.environ.get("COMFYUI_ROOT") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, COMFY)

import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True
import comfy.model_sampling  # noqa: E402
import comfy.samplers  # noqa: E402
import folder_paths  # noqa: E402
from comfy_extras.nodes_custom_sampler import ManualSigmas  # noqa: E402
import server  # noqa: E402
from aiohttp import web  # noqa: E402

server.PromptServer.instance = types.SimpleNamespace(routes=web.RouteTableDef())

pkg = types.ModuleType("mai_pack")
pkg.__path__ = [ROOT]
sys.modules["mai_pack"] = pkg
render = importlib.import_module("mai_pack.render")
dial_nodes = importlib.import_module("mai_pack.dials.nodes")


class H3Sampling(comfy.model_sampling.ModelSamplingAV, comfy.model_sampling.CONST):
    pass


MS = H3Sampling(types.SimpleNamespace(sampling_settings={"shift": 12.0, "audio_shift": 3.0}))


def check_stage1():
    want = ManualSigmas.execute(render.PIKA).result[0]
    got = render.stage_sigmas(MS, "manual", render.PIKA, 6)
    assert torch.equal(got, want), (got, want)
    assert torch.equal(render.stage_sigmas(MS, "simple", "", 4), comfy.samplers.calculate_sigmas(MS, "simple", 4).cpu())
    assert len(render.stage_sigmas(MS, "manual", render.PIKA, 12)) == 13


def check_derope():
    pika = render.stage_sigmas(MS, "manual", render.PIKA, 6)
    s = render.derope_sigmas(MS, pika, 0.48)
    assert torch.equal(s, torch.FloatTensor([12 * 0.48 / (1 + 11 * 0.48), 0.8, 0.571429, 0.333333, 0.0])), s
    assert abs(float(s[0]) - 0.9171975) < 1e-6
    s50 = render.derope_sigmas(MS, pika, 0.50)
    assert abs(float(s50[0]) - 0.9230769) < 1e-6 and len(s50) == 5 and float(s50[1]) == float(torch.tensor(0.8)), s50
    dmad = render.derope_sigmas(MS, render.stage_sigmas(MS, "simple", "", 4), 0.48)
    assert len(dmad) == 3 and float(dmad[-1]) == 0.0, dmad  # 4 steps: 0.917, 0.8, 0
    dmad6 = render.derope_sigmas(MS, render.stage_sigmas(MS, "simple", "", 6), 0.48)
    assert len(dmad6) == 4 and abs(float(dmad6[2]) - 0.7059) < 1e-3, dmad6  # 6 steps: 0.917, 0.857, 0.706, 0
    six = render.derope_sigmas(MS, pika, 0.48, steps=6)
    assert len(six) == 7 and float(six[0]) == float(s[0]) and float(six[-1]) == 0.0
    assert all(a > b for a, b in zip(six, six[1:]))
    assert render.resample([1.0, 0.5, 0.0], 2) == [1.0, 0.5, 0.0]


def check_presets():
    with tempfile.TemporaryDirectory(prefix="render_presets_") as scratch, \
            patch.dict(folder_paths.folder_names_and_paths, {"loras": ([scratch], {".safetensors"})}):
        names = render.list_presets()
        assert names[:3] == ["Pika H3 Flex", "Pika + reference pictures", "DMAD speed LoRA"], names
        dmad = render.load_preset("DMAD speed LoRA")
        assert (dmad["steps"], dmad["lora_strength"], dmad["sampler"], dmad["shift_audio"], dmad["cfg"]) == (6, 0.8, "lcm", 2.0, 1.0)
        assert {k: render.load_preset("Pika H3 Flex")[k] for k in ("sampler", "schedule", "shift_video", "shift_audio")} == \
            {"sampler": "lcm", "schedule": "manual", "shift_video": 12.0, "shift_audio": 3.0}
        mine = dict(render.load_preset("Pika H3 Flex"), steps=8)
        render.save_preset("my_pika8", mine)
        assert os.path.isfile(os.path.join(scratch, "dials", "presets", "render", "my_pika8.json"))
        assert render.load_preset("my_pika8") == mine and render.list_presets()[-1] == "my_pika8"
        try:
            render.save_preset("my_pika8", mine)
            raise AssertionError("overwrote a preset")
        except FileExistsError:
            pass
        for bad in ("../x", "a b", ""):
            try:
                render.save_preset(bad, mine)
                raise AssertionError(f"accepted preset name {bad!r}")
            except ValueError:
                pass
        for broken in (dict(mine, steps=0), dict(mine, conditioning="T2V"), {k: v for k, v in mine.items() if k != "sigmas"},
                       dict(mine, lora_strength=True), dict(mine, extra=1), dict(mine, shift_audio=0.0)):
            try:
                render.check_preset(broken)
                raise AssertionError(f"accepted {broken}")
            except ValueError:
                pass
        assert importlib.import_module("mai_pack.dials.presets").list_presets() == []  # the rack's list stays rack presets


def check_folders():
    with tempfile.TemporaryDirectory(prefix="render_inputs_") as scratch:
        os.makedirs(os.path.join(scratch, "lizards"))
        Image.fromarray(np.zeros((20, 30, 3), np.uint8)).save(os.path.join(scratch, "lizards", "b.png"))
        Image.fromarray(np.full((40, 10, 3), 255, np.uint8)).save(os.path.join(scratch, "lizards", "a.jpg"))
        open(os.path.join(scratch, "lizards", "notes.txt"), "w").close()
        with patch.object(folder_paths, "get_input_directory", lambda: scratch):
            assert dial_nodes.picture_folders() == ["lizards"]
            pics = dial_nodes.load_picture_folder("lizards")
            assert [tuple(p.shape) for p in pics] == [(1, 40, 10, 3), (1, 20, 30, 3)], [p.shape for p in pics]
            for bad in ("..", "../etc", "/etc", "missing", ""):
                try:
                    dial_nodes.load_picture_folder(bad)
                    raise AssertionError(f"accepted folder {bad!r}")
                except ValueError:
                    pass
        schema = dial_nodes.MakeDialFromPictures.GET_SCHEMA()
        assert [i.id for i in schema.inputs][-2:] == ["folder_a", "folder_b"]


if __name__ == "__main__":
    check_stage1()
    check_derope()
    check_presets()
    check_folders()
    print(json.dumps({"render_preset": "ok"}))
