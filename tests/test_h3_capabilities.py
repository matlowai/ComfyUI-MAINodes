#!/usr/bin/env python3
"""H3 capability probe + collision report. Run from the ComfyUI root:

    python custom_nodes/ComfyUI-MAINodes/tests/test_h3_capabilities.py

No GPU, no weights. Checks that the probe reads the installed core (every
key resolves to a bool or a named state, never raises), that a fake
ModelPatcher with a foreign double-block replacement produces exactly one
collision warning naming the foreign owner, and that a clean model
produces none.
"""
import os, sys, types
sys.path.insert(0, os.getcwd())
import comfy.options
comfy.options.enable_args_parsing()
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
from importlib import import_module
caps_mod = import_module("ComfyUI-MAINodes.h3_capabilities")

caps = caps_mod.probe_core()
for k in ("per_token_masks", "clip_guide", "audio_guide", "keyframe_plus_refs",
          "tokenizer_special_tokens", "visual_cond_noise_aug", "audio_cond_noise_aug",
          "tae_h3_decoder", "length_rounds_up", "arbitrary_keyframe_position"):
    assert k in caps, k
    assert caps[k] != "unknown", (k, "source unreadable")
print("probe:", {k: v for k, v in caps.items() if k not in ("comfy_root",)})

# a fake patcher with a foreign replacement on one block
class Fake:
    def __init__(self, foreign):
        self.model_options = {"transformer_options": {"patches_replace": {"dit": {}}}}
        self.object_patches = {}
        if foreign:
            def f(*a, **k):
                return a[0]
            f.__code__ = f.__code__.replace(co_filename="/x/custom_nodes/SomeOtherPack/nodes.py")
            self.model_options["transformer_options"]["patches_replace"]["dit"][("double_block", 3)] = f

rep = caps_mod.block_patch_report(Fake(True))
warns = caps_mod.collision_warnings(rep)
assert len(warns) == 1 and "SomeOtherPack" in warns[0], warns
clean = caps_mod.collision_warnings(caps_mod.block_patch_report(Fake(False)))
assert [w for w in clean if "double_block" in w] == [], clean
text = caps_mod.format_report(caps, rep)
assert "WARNINGS" in text and "SomeOtherPack" in text
print(text)
print("PASS")
