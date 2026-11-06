#!/usr/bin/env python3
"""Mint the 2026-11-06 villainy-pack sweep from MAINodes' shipped Simple example.

Source graph: ComfyUI-MAINodes examples/dials/dials_simple_pika_derope_api.json
(main c3f2315). Per arm the ONLY changes are:
  - loader names resolved to this box's subfolder layout (minimax_h3/...)
  - the Dial Rack (node 40) holds one row: the arm's dial at the arm's strength
    (control = the sinister row switched off, i.e. a rack with nothing active)
  - SaveVideo prefix video/dials_evil1106/<arm>
Everything else is the shipped example: Pika H3 Flex 6-step lcm, FL2V with no
first frame, seed 42, 1280x704x141, de-rope OFF (pass 1 only), RelayVSR off.

usage: mint_dials_evil_sweep.py [--dry-run]
"""
import json
import os
import sys

MAIN = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))  # the MAINodes repo this file lives in
SRC = os.path.join(MAIN, "examples/dials/dials_simple_pika_derope_api.json")
OUT = os.environ.get("DIALS_WORKFLOWS", os.path.join(os.getcwd(), "workflows"))  # where API graphs are written
os.makedirs(OUT, exist_ok=True)
DIALS = ["sinister", "creepy", "cold", "unhinged", "seductive", "corrupted", "dread", "impish"]
STRENGTHS = [1, 2]


def arms():
    yield "control", "sinister", 0.0, False
    for d in DIALS:
        for s in STRENGTHS:
            yield f"{d}_p{s}", d, float(s), True


def mint(name, dial, strength, on, dry):
    g = json.load(open(SRC))
    g["3"]["inputs"]["model"] = "minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
    g["8"]["inputs"]["clip_name"] = "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    g["9"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_video_vae_fp16.safetensors"
    g["17"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_audio_vae_fp32.safetensors"
    rows = [{"on": on, "dial": f"dials/h3_evil_{dial}.safetensors", "strength": strength, "solo": False}]
    g["40"]["inputs"]["rack"] = json.dumps(rows)
    assert g["172:175"]["inputs"]["choice"] == "off", "de-rope must stay off for this sweep"
    assert g["172:187"]["inputs"]["choice"] == "off", "upscale must stay off"
    g["172:139"]["inputs"]["filename_prefix"] = f"video/dials_evil1106/{name}"
    path = os.path.join(OUT, f"dials_evil1106_{name}_v001.api.json")
    if dry:
        print("would write", path, rows)
        return
    with open(path, "x") as f:
        json.dump(g, f, indent=1)
    print("minted", path)


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    for a in arms():
        mint(*a, dry)
