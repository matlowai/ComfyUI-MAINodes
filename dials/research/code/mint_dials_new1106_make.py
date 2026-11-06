#!/usr/bin/env python3
"""Mint one API graph that makes the seven 2026-11-06 experimental dials (h3_x_*) with MAINodes Make Dial.

Base H3 FL2VA int8 convrot (no Pika LoRA) + the nvfp4 text encoder, hook (post_refiner), debias on, 3 nuisance dims
(Make Dial defaults). Pair files: pairs/new1106/. Output: models/loras/dials/h3_x_<name>.safetensors.
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PAIRS = os.path.join(HERE, "..", "pairs", "new1106")
DIALS = [  # name, pair file, subjects file, description, - label, + label
    ("datamosh", "datamosh.txt", "subjects_adults.txt", "Experimental plain-vs-featured: adds datamosh / compression glitching.", "plain", "datamosh"),
    ("vhs", "vhs.txt", "subjects_adults.txt", "Experimental look: clean modern digital vs worn analog VHS tape.", "clean digital", "VHS"),
    ("silentfilm_cyberpunk", "silentfilm_cyberpunk.txt", "subjects_adults.txt", "Experimental style continuum: 1920s silent film to neon cyberpunk anime.", "silent film", "cyberpunk anime"),
    ("oil_pixel", "oil_pixel.txt", "subjects_adults.txt", "Experimental style continuum: Renaissance oil painting to 8-bit pixel art.", "oil painting", "pixel art"),
    ("owl_octopus", "owl_octopus.txt", "settings.txt", "Experimental creature continuum: owl to octopus.", "owl", "octopus"),
    ("order_entropy", "order_entropy.txt", "subjects_adults.txt", "Experimental abstract: order and symmetry vs entropy and decay.", "order", "entropy"),
    ("memory_present", "memory_present.txt", "subjects_adults.txt", "Experimental abstract: the vivid present vs a half-remembered memory.", "present", "memory"),
]
g = {
    "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
    "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default"}},
}
for i, (name, pf, sf, desc, neg, pos) in enumerate(DIALS, start=10):
    g[str(i)] = {"class_type": "MAIDialMake", "inputs": {
        "clip": ["2", 0], "model": ["1", 0],
        "pairs": open(os.path.join(PAIRS, pf)).read(), "subjects": open(os.path.join(PAIRS, sf)).read(),
        "name": f"h3_x_{name}", "inject": "post_refiner (hook)", "debias": True, "nuisance_dims": 3,
        "description": desc, "negative_label": neg, "positive_label": pos,
        "useful": 0.0, "overcook": 0.0, "negative_useful": 0.0, "negative_overcook": 0.0,
        "evidence": "unknown", "pipeline": "Pika H3 Flex 6-step (to be measured)"}}
out = os.path.join(ROOT, "workflows/dials_new1106_make_v001.api.json")
with open(out, "x") as f:
    json.dump(g, f, indent=1)
print("minted", out)
