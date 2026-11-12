#!/usr/bin/env python3
"""Mint the 2026-11-06 template-leak control arms (same base graph and changes as mint_dials_evil_sweep.py).

  noview_p1 / noview_p2  : h3_x_sinister_noview at +1 / +2 (sinister slot text, camera-free templates; cos 0.968 to released sinister)
  placebo_p4 / placebo_p8: h3_x_template_placebo at +4 / +8 (grey vs blue scarf; |vec| 10 -> 40 / 80, matching sinister |42| at +1 / +2)
Control is dials_evil1106_control (GPU0, same instance).
"""
import importlib.util, os
spec = importlib.util.spec_from_file_location("m", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mint_dials_evil_sweep.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
import json
ARMS = [("noview_p1", "h3_x_sinister_noview", 1.0), ("noview_p2", "h3_x_sinister_noview", 2.0),
        ("placebo_p4", "h3_x_template_placebo", 4.0), ("placebo_p8", "h3_x_template_placebo", 8.0)]
for name, dial, s in ARMS:
    g = json.load(open(m.SRC))
    g["3"]["inputs"]["model"] = "minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
    g["8"]["inputs"]["clip_name"] = "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    g["9"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_video_vae_fp16.safetensors"
    g["17"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_audio_vae_fp32.safetensors"
    g["40"]["inputs"]["rack"] = json.dumps([{"on": True, "dial": f"dials/{dial}.safetensors", "strength": s, "solo": False}])
    g["172:139"]["inputs"]["filename_prefix"] = f"video/dials_evil1106/{name}"
    p = os.path.join(m.OUT, f"dials_evil1106_{name}_v001.api.json")
    open(p, "x").write(json.dumps(g, indent=1))
    print("minted", p)
