"""CPU checks for Dial Hold Map (dials/nodes.py, timecurve.attach_holds): one rack serves both de-rope stages.

  1. Hold Map on the rack's model samples bit-identically to the rack with the same hold_map input, on the real-length
     clip (stage 1) and the stretched clip (stage 2);
  2. the rack's own model is left as it was, so stage 1 sampling the same rack output is unchanged;
  3. a model without time-curve rows (constant rows, or no rack at all) comes back as the same object;
  4. schema: model and a hold_map socket (Time Smear's STRING output), one MODEL out.
"""
import json
import logging

import torch

from test_dial_rack import H, comfy, dial, nodes
from test_dial_timecurve import Fake, same, sample
from test_dial_holdmap import HOLDS, REAL, STEP, STRETCHED, rack


def check_attach(dtype):
    torch.manual_seed(7)
    base = comfy.model_patcher.ModelPatcher(Fake(dtype), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    text = torch.randn(1, 5, H + 3).to(dtype)
    ins = {"dial_0": dial("post", 21, "night"), "dial_1": dial("post", 22, "rain")}
    rows = [{"input": "dial_0", "strength": 1.5, "time": STEP}, {"input": "dial_1", "strength": 0.5}]
    held = json.dumps({"holds": HOLDS, "world_len": 22})
    stage1 = rack(base, rows, ins)
    stage2 = nodes.DialHoldMap.execute(model=stage1, hold_map=held).result[0]
    for shapes in (REAL, STRETCHED):
        latents = [torch.randn(shapes[0]).to(dtype), torch.randn(shapes[1]).to(dtype)]
        want, calls = sample(rack(base, rows, ins, held), text, latents, shapes=shapes)
        got, got_calls = sample(stage2, text, latents, shapes=shapes)
        same([t for step in got for t in step], [t for step in want for t in step])
        assert got_calls == calls
        before, _ = sample(rack(base, rows, ins), text, latents, shapes=shapes)
        after, _ = sample(stage1, text, latents, shapes=shapes)
        same([t for step in after for t in step], [t for step in before for t in step])

    const = rack(base, [{"input": "dial_1", "strength": 0.5}], ins)
    assert nodes.DialHoldMap.execute(model=const, hold_map=held).result[0] is const
    assert nodes.DialHoldMap.execute(model=base, hold_map=held).result[0] is base


def check_schema():
    schema = nodes.DialHoldMap.GET_SCHEMA()
    assert [i.id for i in schema.inputs] == ["model", "hold_map"]
    assert schema.inputs[1].force_input and schema.inputs[1].get_io_type() == "STRING"
    assert [o.get_io_type() for o in schema.outputs] == ["MODEL"]


def main():
    for dtype in (torch.float32, torch.bfloat16):
        check_attach(dtype)
    check_schema()
    print("dial hold map node: same as the rack's hold_map input on both stages, stage 1 untouched, pass-through and schema passed")


if __name__ == "__main__":
    logging.disable(logging.INFO)
    main()
