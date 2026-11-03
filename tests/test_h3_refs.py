#!/usr/bin/env python3
"""H3 References and H3 Reference to Video (refs) (h3_refs.py).

  python tests/test_h3_refs.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files. Checks:
  1. H3 References packs the four reference groups as given (missing groups as empty dicts, socket order kept);
  2. the refs node calls core MiniMaxH3ReferenceToVideo.execute with exactly the arguments a direct call with the same
     sockets gets, with and without refs;
  3. the schemas track core: the bundle's groups are core's own inputs (same limits), and the refs node has core's other
     inputs and outputs unchanged plus one optional refs input.
"""
import importlib
import os
import sys
import types
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
COMFY = os.environ.get("COMFYUI_ROOT") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, COMFY)

import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo  # noqa: E402

pkg = types.ModuleType("mai_pack")
pkg.__path__ = [ROOT]
sys.modules["mai_pack"] = pkg
h3_refs = importlib.import_module("mai_pack.h3_refs")


def check_pack():
    images = {"ref_image_0": "pic A", "ref_image_1": "pic B"}
    out = h3_refs.H3References.execute(ref_images=images, ref_audios={"ref_audio_0": "voice"}).result[0]
    assert out == {"ref_images": images, "ref_videos": {}, "ref_video_audios": {}, "ref_audios": {"ref_audio_0": "voice"}}, out
    assert list(out["ref_images"]) == ["ref_image_0", "ref_image_1"]
    assert h3_refs.H3References.execute().result[0] == {g: {} for g in h3_refs.GROUPS}


def check_same_call():
    calls = []

    def record(*args, **kwargs):
        calls.append((args, kwargs))
        return "result"

    refs = {"ref_images": {"ref_image_0": "pic"}, "ref_videos": {"ref_video_0": "clip"},
            "ref_video_audios": {"ref_video_audio_0": "sound"}, "ref_audios": {}}
    with patch.object(MiniMaxH3ReferenceToVideo, "execute", record):
        got = h3_refs.H3ReferenceToVideoRefs.execute("CLIP", "a prompt", 1280, 704, 141, ref_image_size="max", vae="VAE",
                                                     audio_vae="AVAE", refs=refs)
        MiniMaxH3ReferenceToVideo.execute("CLIP", "a prompt", 1280, 704, 141, ref_image_size="max", vae="VAE",
                                          audio_vae="AVAE", **refs)
        h3_refs.H3ReferenceToVideoRefs.execute("CLIP", "text only", 640, 352, 73)
        MiniMaxH3ReferenceToVideo.execute("CLIP", "text only", 640, 352, 73, ref_image_size="match", vae=None, audio_vae=None)
    assert got == "result"
    assert calls[0] == calls[1], calls[:2]
    assert calls[2] == calls[3], calls[2:]


def check_schemas():
    core = MiniMaxH3ReferenceToVideo.define_schema()
    bundle = h3_refs.H3References.define_schema()
    refs_node = h3_refs.H3ReferenceToVideoRefs.define_schema()
    core_inputs = {i.id: i for i in core.inputs}
    assert [i.id for i in bundle.inputs] == list(h3_refs.GROUPS)
    for i in bundle.inputs:  # same socket type, prefix and min/max as the core group
        assert i.as_dict() == core_inputs[i.id].as_dict(), (i.id, i.as_dict(), core_inputs[i.id].as_dict())
    others = [i.id for i in core.inputs if i.id not in h3_refs.GROUPS]
    assert [i.id for i in refs_node.inputs] == others + ["refs"], [i.id for i in refs_node.inputs]
    assert [type(o) for o in refs_node.outputs] == [type(o) for o in core.outputs]


if __name__ == "__main__":
    for name, check in [("pack", check_pack), ("same call", check_same_call), ("schemas", check_schemas)]:
        check()
        print("ok", name)
    print("PASS")
