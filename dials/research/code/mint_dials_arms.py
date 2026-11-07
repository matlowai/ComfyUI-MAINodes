#!/usr/bin/env python3
"""Mint dial arms on MAINodes' shipped Simple example (the same base graph and changes as mint_dials_evil_sweep.py).

usage: mint_dials_arms.py [--prompt-file F] [--length N] [--seed S] <scene_prefix> <out_subdir> <arm>=<spec> ...
  <spec> = <dial file stem>:<strength>[+<dial>:<strength>...] ; a row may end in ~protect (constant clip-time curve,
  audio from the undialled branch), e.g. sinister_protect=h3_evil_sinister:2~protect ; "none" = empty rack (control)
  e.g. mint_dials_arms.py dials_x1106 dials_x1106 datamosh_p2=h3_x_datamosh:2 combo=h3_x_vhs:1.5+h3_evil_dread:1
Each arm becomes workflows/<scene_prefix>_<arm>_v001.api.json, saving to video/<out_subdir>/<arm>. Several dials in one
arm become several rack rows (in the order given). Text-to-video, seed 42, de-rope off, as the sweeps.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("DIALS_WORKFLOWS", os.path.join(os.getcwd(), "workflows"))  # where API graphs are written
os.makedirs(OUT, exist_ok=True)
SRC = os.path.join(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")), "examples/dials/dials_simple_pika_derope_api.json")


OPT = {"prompt": None, "length": None, "seed": None}


def mint(prefix, subdir, arm, spec):
    g = json.load(open(SRC))
    if OPT["prompt"] is not None:
        for k in ("172:110", "172:129", "172:173", "172:174"):
            g[k]["inputs"]["prompt"] = OPT["prompt"]
    if OPT["length"] is not None:
        for k in ("172:110", "172:150", "172:173"):
            g[k]["inputs"]["length"] = OPT["length"]
        g["172:122"]["inputs"]["length"] = OPT["length"]
    if OPT["seed"] is not None:
        g["172:111"]["inputs"]["noise_seed"] = OPT["seed"]
    g["3"]["inputs"]["model"] = "minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
    g["8"]["inputs"]["clip_name"] = "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    g["9"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_video_vae_fp16.safetensors"
    g["17"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_audio_vae_fp32.safetensors"
    rows = []
    for part in ([] if spec == "none" else spec.split("+")):
        part, _, flag = part.partition("~")
        dial, s = part.rsplit(":", 1)
        row = {"on": True, "dial": f"dials/{dial}.safetensors", "strength": float(s), "solo": False}
        if flag == "protect":
            row["time"] = {"type": "keys", "points": [[0, 1], [1, 1]], "unit": "normalized", "interp": "linear",
                           "steps": 2, "audio": "protect"}
        rows.append(row)
    g["40"]["inputs"]["rack"] = json.dumps(rows)
    assert g["172:175"]["inputs"]["choice"] == "off" and g["172:187"]["inputs"]["choice"] == "off"
    g["172:139"]["inputs"]["filename_prefix"] = f"video/{subdir}/{arm}"
    path = os.path.join(OUT, f"{prefix}_{arm}_v001.api.json")
    with open(path, "x") as f:
        json.dump(g, f, indent=1)
    print("minted", path, rows)


if __name__ == "__main__":
    args = sys.argv[1:]
    while args and args[0].startswith("--"):
        flag, val = args[0], args[1]
        args = args[2:]
        if flag == "--prompt-file":
            OPT["prompt"] = open(val).read().strip()
        elif flag == "--length":
            OPT["length"] = int(val)
        elif flag == "--seed":
            OPT["seed"] = int(val)
    prefix, subdir = args[0], args[1]
    for a in args[2:]:
        arm, spec = a.split("=", 1)
        mint(prefix, subdir, arm, spec)
