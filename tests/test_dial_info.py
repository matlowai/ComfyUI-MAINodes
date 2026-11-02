#!/usr/bin/env python3
"""Dial info v2: v1 records read as v2, unknown (null) strengths, round trip keeps the vector, bad input rejected (CPU)."""
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

HERE = Path(__file__).resolve().parent
COMFY = os.environ.get("COMFYUI_ROOT") or str(HERE.parents[2])
sys.path.insert(0, COMFY)
import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True  # before model_management picks a device
import folder_paths  # noqa: E402
import torch  # noqa: E402
from safetensors import safe_open  # noqa: E402
from safetensors.torch import save_file  # noqa: E402

pkg_dir = HERE.parent / "dials"
spec = importlib.util.spec_from_file_location("mai_dials", pkg_dir / "__init__.py", submodule_search_locations=[str(pkg_dir)])
sys.modules["mai_dials"] = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sys.modules["mai_dials"])
core = importlib.import_module("mai_dials.core")
presets = importlib.import_module("mai_dials.presets")
nodes = importlib.import_module("mai_dials.nodes")

V1 = {"description": "Lizard to squirrel. Measured on Pika H3 Flex, 1 seed.", "negative": "lizard", "positive": "squirrel",
      "useful": 3.0, "overcook": 5.0}


def rejects(fn, *args):
    try:
        fn(*args)
    except ValueError:
        return
    raise AssertionError(f"{fn.__name__} accepted {args}")


def main():
    with tempfile.TemporaryDirectory(prefix="I1_info_") as scratch:
        root = Path(scratch)
        folder_paths.add_model_folder_path("loras", str(root), is_default=True)
        (root / "dials").mkdir()

        # v1 file -> v2 read: both sides get the one pair; "1 seed" in the description means one-seed evidence
        old = root / "dials" / "old.safetensors"
        save_file({"diffusion_model.token_refiner.dials_shift": torch.randn(8)}, str(old), metadata={"dial_info": json.dumps(V1)})
        info = core.dial_info("dials/old.safetensors")
        assert info == {"version": 2, "description": V1["description"], "negative": "lizard", "positive": "squirrel",
                        "pipeline": "", "notes": "", "neg": {"useful": 3.0, "overcook": 5.0},
                        "pos": {"useful": 3.0, "overcook": 5.0}, "evidence": "one-seed"}, info
        assert core.check_dial_info(dict(V1, description="creator-set"))["evidence"] == "creator"
        assert core.check_dial_info({})["pos"] == {"useful": 1.0, "overcook": 1.5}, "a partial v1 record keeps v1's defaults"

        # no info and v2 nulls: unknown stays unknown
        plain = root / "dials" / "plain.safetensors"
        save_file({"diffusion_model.token_refiner.dials_shift": torch.ones(8)}, str(plain))
        unknown = {"useful": None, "overcook": None}
        assert core.dial_info("dials/plain.safetensors") == {"version": 2, "description": "", "negative": "", "positive": "",
                                                            "pipeline": "", "notes": "", "neg": unknown, "pos": unknown, "evidence": None}
        half = core.check_dial_info({"version": 2, "neg": {"useful": 2}, "pos": {"useful": None, "overcook": 0.5}})
        assert half["neg"] == {"useful": 2.0, "overcook": None} and half["pos"] == {"useful": None, "overcook": 0.5}

        # round trip: v2 written over v1 reads back exactly, the vector bytes and the preset hash are unchanged
        before = presets.dial_sha256("dials/old.safetensors")
        with safe_open(str(old), "pt") as f:
            vec = f.get_tensor("diffusion_model.token_refiner.dials_shift")
        edited = dict(info, pos=unknown, evidence="multi-scene", pipeline="Pika H3 Flex 6-step", notes="squirrel side never lands")
        assert core.save_dial_info("dials/old.safetensors", edited) == edited
        assert core.dial_info("dials/old.safetensors") == edited
        assert presets.dial_sha256("dials/old.safetensors") == before
        with safe_open(str(old), "pt") as f:
            assert torch.equal(f.get_tensor("diffusion_model.token_refiner.dials_shift"), vec)
            assert json.loads(f.metadata()["dial_info"])["pos"] == unknown

        v2 = {"version": 2}
        for bad in ([], {"version": 3}, {"version": "2"}, dict(v2, pos={"useful": 0}), dict(v2, neg={"overcook": 21}),
                    dict(v2, pos={"useful": True}), dict(v2, neg={"useful": float("nan")}), dict(v2, neg={"useful": "1"}),
                    dict(v2, pos={"useful": 3, "overcook": 2}), dict(v2, neg=[1, 2]), dict(v2, pos=None),
                    dict(v2, evidence="two-seed"), dict(v2, evidence=""), dict(v2, pipeline="x" * 61), dict(v2, notes="x" * 501),
                    dict(v2, negative=5), dict(V1, useful=0), dict(V1, useful=3, overcook=2), dict(V1, description="x" * 2001)):
            rejects(core.check_dial_info, bad)
        rejects(core.save_dial_info, "dials/old.safetensors", dict(v2, evidence="two-seed"))
        assert core.dial_info("dials/old.safetensors") == edited, "a rejected write must leave the file alone"

        # info is written into dial files only: not into a LoRA, nor a dial-shaped file outside dials/
        lora = {"diffusion_model.a.lora_up.weight": torch.ones(2, 2), "diffusion_model.a.lora_down.weight": torch.ones(2, 2)}
        save_file(lora, str(root / "style.safetensors"))
        save_file(lora, str(root / "dials" / "two_keys.safetensors"))
        save_file({"diffusion_model.token_refiner.dials_shift": torch.ones(8)}, str(root / "loose.safetensors"))
        for name in ("style.safetensors", "dials/two_keys.safetensors", "loose.safetensors"):
            before = (root / name).read_bytes()
            rejects(core.save_dial_info, name, edited)
            assert (root / name).read_bytes() == before, f"{name} was rewritten"

    # Make Dial nodes: the v1 info inputs keep their positions and the v2 ones follow them; inputs added later come after
    # (widget values load by position)
    info_ids = ["description", "negative_label", "positive_label", "useful", "overcook",
                "negative_useful", "negative_overcook", "evidence", "pipeline"]
    later = {"MAIDialMakeFromPictures": ["framing", "group_a", "group_b"]}
    for node_id in ("MAIDialMake", "MAIDialMakeFromPictures", "MAIDialMakeFromVideos", "MAIDialCombine"):
        ids = [i.id for i in nodes.NODE_CLASS_MAPPINGS[node_id].GET_SCHEMA().inputs]
        assert ids[len(ids) - len(info_ids) - len(later.get(node_id, [])):] == info_ids + later.get(node_id, []), (node_id, ids)
    same = nodes.info_from(useful=2, overcook=3)
    assert same["neg"] == same["pos"] == {"useful": 2.0, "overcook": 3.0} and same["evidence"] == "creator"
    assert nodes.info_from() == core.check_dial_info({"useful": 1.0, "overcook": 1.5}), "a workflow saved before v2 saves what v1 did"
    split = nodes.info_from(useful=1, overcook=2, negative_useful=3, negative_overcook=5, evidence="unknown", pipeline="Pika H3 Flex 6-step")
    assert split["neg"] == {"useful": 3.0, "overcook": 5.0} and split["pos"] == {"useful": 1.0, "overcook": 2.0}
    assert split["evidence"] is None and split["pipeline"] == "Pika H3 Flex 6-step"
    rejects(nodes.info_from, "", "", "", 1.0, 1.5, 3.0)  # negative useful above the inherited overcook
    lizard = nodes.info_from(useful=0, overcook=0, negative_useful=4, negative_overcook=6)
    assert lizard["pos"] == {"useful": None, "overcook": None} and lizard["neg"] == {"useful": 4.0, "overcook": 6.0}, lizard
    print("dial info: all checks passed (v1 -> v2, unknown sides, round trip keeps the vector, bad input rejected, node inputs)")


if __name__ == "__main__":
    main()
