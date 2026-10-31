"""Dials nodes (V3): Dial Rack, Make Dial, Combine Dials. Node ids are MAIDial*, so this pack can be installed next to
ComfyUI-Dials (whose ids are Dials*); both use the DIAL socket type and models/loras/dials/, so they interoperate."""
import json

import torch
from comfy_api.latest import io, ui

from . import core, presets

presets.install_routes()

Dial = io.Custom("DIAL")


class DialRack(io.ComfyNode):
    """Any number of dials on one model, each row with on/off, strength and solo (edited in the node's rack UI).
    Rows are applied in order with the same patches a chain of single Apply Dial nodes would make, so a rack is
    bit-for-bit identical to that chain. Dials wired into the `dial_N` inputs (e.g. straight from Make Dial) appear as
    rows too."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialRack",
            display_name="Dial Rack (alpha)",
            category="MAINodes/Dials",
            description="Stack any number of steering dials on a MiniMax H3 model: one row per dial with strength, on/off and solo.",
            inputs=[
                io.Model.Input("model"),
                io.String.Input("rack", default="[]", tooltip="Rack rows as JSON; edited through the rack UI."),
                io.Autogrow.Input("dials", optional=True, template=io.Autogrow.TemplatePrefix(
                    input=Dial.Input("dial", tooltip="A dial from Make Dial or Combine Dials; set its strength in the rack."),
                    prefix="dial_", min=0, max=8)),
            ],
            outputs=[io.Model.Output()],
        )

    @classmethod
    def execute(cls, model, rack, dials=None) -> io.NodeOutput:
        rows = json.loads(rack or "[]")
        if not isinstance(rows, list):
            raise ValueError("rack must be a JSON list of rows")
        active = [r for r in rows if r.get("on", True) and float(r.get("strength", 0)) != 0]
        if any(r.get("solo") for r in active):
            active = [r for r in active if r.get("solo")]
        applied = []
        for r in active:
            if "input" in r:
                dial = (dials or {}).get(r["input"])
                if dial is None:
                    raise ValueError(f"rack row uses input {r['input']}, which is not connected")
                label = f"{r['input']}: {dial['meta'].get('name', '?')}"
            else:
                dial = core.load_dial(r["dial"])
                label = dial["meta"]["name"]
            applied.append((label, dial, float(r["strength"])))
        if not applied:
            return io.NodeOutput(model, ui=ui.PreviewText(core.rack_report([])))
        core.text_modules(model)  # clear error for a non-H3 model before patching
        m = model.clone()
        for _, dial, strength in applied:
            core.apply_dial(m, dial, strength)
        return io.NodeOutput(m, ui=ui.PreviewText(core.rack_report(applied)))


class MakeDial(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialMake",
            display_name="Make Dial (alpha)",
            category="MAINodes/Dials",
            description="Turn prompt pairs (A ||| B per line) into a steering dial: negative strength moves toward A, positive toward B.",
            inputs=[
                io.Clip.Input("clip"),
                io.Model.Input("model"),
                io.String.Input("pairs", multiline=True,
                                default="{subject} stands perfectly still, posing for a photograph. ||| {subject} runs quickly across the scene, moving energetically.",
                                tooltip="One pair per line: 'A ||| B', identical except for the quality to steer. {subject} expands over the subjects list. # starts a comment. "
                                        "'! A ||| B' is a hold pair: the dial is kept from moving that quality. '(words:2)' counts those words twice."),
                io.String.Input("subjects", multiline=True, default="A young woman\nAn old man\nA golden dog\nA horse",
                                tooltip="Optional: one subject per line, substituted for {subject}. Varied subjects cancel out, leaving only the A→B difference."),
                io.String.Input("name", default="my_dial", tooltip="Saved as models/loras/dials/<name>.safetensors (empty = don't save)."),
                io.Combo.Input("inject", options=["post_refiner (hook)", "pre_refiner (LoRA file)"], default="post_refiner (hook)", advanced=True,
                               tooltip="post_refiner: where the DiT reads the prompt, most faithful (use with Dial Rack). "
                                       "pre_refiner: a bias diff the stock LoRA loader can apply; keep it at strength <= 1."),
                io.Boolean.Input("debias", default=True, advanced=True,
                                 tooltip="Project out the generic 'more wording' directions that every prompt-pair difference shares."),
                io.Int.Input("nuisance_dims", default=3, min=1, max=12, advanced=True, tooltip="How many nuisance directions to remove."),
            ],
            outputs=[Dial.Output(display_name="dial")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip, model, pairs, subjects, name, inject, debias, nuisance_dims) -> io.NodeOutput:
        mode = "post" if inject.startswith("post") else "pre"
        dial, report = core.make_dial(clip, model, pairs, subjects, name or "unsaved", mode, debias=debias, nuisance_dims=nuisance_dims)
        if name:
            report += f"\nsaved {core.save_dial(dial, name)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


class CombineDials(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialCombine",
            display_name="Combine Dials (alpha)",
            category="MAINodes/Dials",
            description="weight_a * a + weight_b * b as one new dial. With orthogonalize on, b's direction is first removed from a "
                        "(e.g. a mood dial minus a harm-probe direction). Plain mixing is easier in the Dial Rack.",
            inputs=[
                Dial.Input("a"),
                Dial.Input("b"),
                io.Float.Input("weight_a", default=1.0, min=-20.0, max=20.0, step=0.05),
                io.Float.Input("weight_b", default=0.0, min=-20.0, max=20.0, step=0.05),
                io.Boolean.Input("orthogonalize", default=False, tooltip="Remove b's direction from a before mixing."),
                io.String.Input("name", default="", tooltip="Save as models/loras/dials/<name>.safetensors (empty = don't save)."),
            ],
            outputs=[Dial.Output(display_name="dial")],
        )

    @classmethod
    def execute(cls, a, b, weight_a, weight_b, orthogonalize, name) -> io.NodeOutput:
        if (a["target"], a["mode"]) != (b["target"], b["mode"]):
            raise ValueError(f"dials use different injection points: {a['mode']} {a['target']} vs {b['mode']} {b['target']}")
        va, vb = a["vec"].float(), b["vec"].float()
        cos = float(torch.nn.functional.cosine_similarity(va, vb, dim=0))
        if orthogonalize:
            va = va - (va @ vb) / (vb @ vb) * vb
        label = f"{a['meta'].get('name', 'a')}*{weight_a:g}{'-proj' if orthogonalize else ''}+{b['meta'].get('name', 'b')}*{weight_b:g}"
        dial = {"vec": weight_a * va + weight_b * vb, "target": a["target"], "mode": a["mode"],
                "meta": {"name": name or label, "parents": [a["meta"].get("name"), b["meta"].get("name")]}}
        report = f"cos(a, b) = {cos:.3f}; {core.dial_label(dial)}"
        if name:
            report += f"\nsaved {core.save_dial(dial, name)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _cls in (DialRack, MakeDial, CombineDials):
    _schema = _cls.GET_SCHEMA()
    NODE_CLASS_MAPPINGS[_schema.node_id] = _cls
    NODE_DISPLAY_NAME_MAPPINGS[_schema.node_id] = _schema.display_name
