#!/usr/bin/env python3
"""A dial saved again under the same name re-runs the Dial Rack.

  python tests/test_dial_rack_fingerprint.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

The rack loads dial files by name, so ComfyUI's execution cache would serve the old patched model when Make Dial, the dial
editor or ⚙ info rewrites a file. Checks:
  1. the rack's fingerprint changes when a dial file it names is overwritten (and stays put when nothing changed);
  2. the rack built after the overwrite applies the new vector (load_dial keeps no in-process copy);
  3. rows without a file (wired dials, missing files) and a broken rack string still fingerprint without raising.
"""
import json
import os
import tempfile

import torch

from test_dial_rack import H, Fake, comfy, core, dial, folder_paths, nodes, run


def main():
    scratch = tempfile.TemporaryDirectory(prefix="rack_fingerprint_")
    folder_paths.add_model_folder_path("loras", scratch.name, is_default=True)
    rack = json.dumps([{"on": True, "dial": "dials/fp_test.safetensors", "strength": 1.0}, {"on": True, "input": "dial_0", "strength": 0.5},
                       {"on": True, "dial": "dials/not_there.safetensors", "strength": 1.0}])
    path = core.save_dial(dial("post", 3, "fp_test"), "fp_test")
    first = nodes.DialRack.fingerprint_inputs(rack=rack)
    assert nodes.DialRack.fingerprint_inputs(rack=rack) == first, "fingerprint changed with nothing changed"
    base = comfy.model_patcher.ModelPatcher(Fake(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    one = json.dumps([{"on": True, "dial": "dials/fp_test.safetensors", "strength": 1.0}])
    x = torch.randn(2, H)
    before = run(nodes.DialRack.execute(model=base, rack=one).result[0], x)

    core.save_dial(dial("post", 4, "fp_test"), "fp_test")  # Make Dial again, same name
    st = os.stat(path)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))  # coarse file systems: make the rewrite visible
    assert nodes.DialRack.fingerprint_inputs(rack=rack) != first, "overwriting a dial file did not change the fingerprint"
    after = run(nodes.DialRack.execute(model=base, rack=one).result[0], x)
    assert not torch.equal(before, after), "the rack still applied the old vector"
    assert torch.equal(after, run(nodes.DialRack.execute(model=base, rack=one).result[0], x))
    assert nodes.DialRack.fingerprint_inputs(rack="not json") is None
    print("dial rack fingerprint: all checks passed")
    scratch.cleanup()


if __name__ == "__main__":
    main()
