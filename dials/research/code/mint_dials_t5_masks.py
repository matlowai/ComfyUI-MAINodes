#!/usr/bin/env python3
"""Mint Dials research T5 arms: does leaving vision rows unshifted keep a dial's strength in image-to-video?

Base graph = MAINodes' Simple example (as mint_dials_arms.py). Changes per arm:
  - the Dial Rack (40) is emptied; the DialsLabApplyMasked research node (code/dialslab_masked_node) (900) sits between it and the stage-1 guider
    (172:112), applying one dial with mask "all" or "text_only";
  - i2v arms: a LoadImage (901) of the seed-42 control's first frame feeds MiniMaxH3ImageToVideo's first_frame (172:110);
  - seed and output prefix per arm (video/dials_t5/<arm>).
Arms: t2v parity (all) to compare bit-for-bit with the Dial Rack render; i2v control / all / text_only for two dials,
seeds 42 and 43.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("DIALS_WORKFLOWS", os.path.join(os.getcwd(), "workflows"))  # where API graphs are written
os.makedirs(OUT, exist_ok=True)
SRC = os.path.join(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")), "examples/dials/dials_simple_pika_derope_api.json")
FRAME = "dialslab_firstframe_train.png"


def mint(arm, seed, i2v, dial=None, strength=0.0, mask="all"):
    g = json.load(open(SRC))
    g["3"]["inputs"]["model"] = "minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
    g["8"]["inputs"]["clip_name"] = "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    g["9"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_video_vae_fp16.safetensors"
    g["17"]["inputs"]["vae_name"] = "minimax_h3/minimax_h3_audio_vae_fp32.safetensors"
    g["40"]["inputs"]["rack"] = json.dumps([])
    g["900"] = {"class_type": "DialsLabApplyMasked", "inputs": {
        "model": ["40", 0], "dial": f"dials/{dial or 'h3_evil_sinister'}.safetensors", "strength": float(strength), "mask": mask}}
    g["172:112"]["inputs"]["model"] = ["900", 0]
    if i2v:
        g["901"] = {"class_type": "LoadImage", "inputs": {"image": FRAME}}
        g["172:110"]["inputs"]["first_frame"] = ["901", 0]
    g["172:111"]["inputs"]["noise_seed"] = seed
    assert g["172:175"]["inputs"]["choice"] == "off" and g["172:187"]["inputs"]["choice"] == "off"
    g["172:139"]["inputs"]["filename_prefix"] = f"video/dials_t5/{arm}"
    path = os.path.join(OUT, f"dials_t5_{arm}_v001.api.json")
    with open(path, "x") as f:
        json.dump(g, f, indent=1)
    print("minted", path)


if __name__ == "__main__":
    mint("parity_t2v_sin_all_s42", 42, False, "h3_evil_sinister", 1.0, "all")
    for s in (42, 43):
        mint(f"i2v_ctl_s{s}", s, True)
        for tag, dial, st in (("sin", "h3_evil_sinister", 1.0), ("mosh", "h3_x_datamosh", 2.25)):
            mint(f"i2v_{tag}_allrows_s{s}", s, True, dial, st, "all")
            mint(f"i2v_{tag}_textonly_s{s}", s, True, dial, st, "text_only")


def mint_loose(arm, seed, guide, dial=None, strength=0.0):
    """T5c: image-to-video with the first frame held loosely via H3 Cond Strength (guide noise-aug strength)."""
    mint(arm, seed, True, dial, strength, "all")
    path = os.path.join(OUT, f"dials_t5_{arm}_v001.api.json")
    g = json.load(open(path))
    g["902"] = {"class_type": "H3CondStrength", "inputs": {"model": ["900", 0], "guide_strength": float(guide),
                                                         "reference_strength": -1.0}}
    g["172:112"]["inputs"]["model"] = ["902", 0]
    with open(path, "w") as f:
        json.dump(g, f, indent=1)


def mint_ref(arm, seed, dial=None, strength=0.0):
    """T5d: the same picture as a Ref2V reference (Render Preset conditioning = Ref2V) instead of a first frame."""
    mint(arm, seed, False, dial, strength, "all")
    path = os.path.join(OUT, f"dials_t5_{arm}_v001.api.json")
    g = json.load(open(path))
    g["3"]["inputs"]["conditioning"] = "Ref2V (reference pictures)"
    g["901"] = {"class_type": "LoadImage", "inputs": {"image": FRAME}}
    g["191"]["inputs"] = {"ref_images.ref_image_0": ["901", 0]}
    for k in ("172:173", "172:174"):
        g[k]["inputs"]["prompt"] = g[k]["inputs"]["prompt"].replace(
            "integrated_multimodal_description: [Shot 1]", "integrated_multimodal_description: [Shot 1] The scene of <Picture 1>.", 1)
    with open(path, "w") as f:
        json.dump(g, f, indent=1)
