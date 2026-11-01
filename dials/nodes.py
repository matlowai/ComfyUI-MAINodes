"""Dials nodes (V3): Dial Rack, Make Dial, Combine Dials. Node ids are MAIDial*, so this pack can be installed next to
ComfyUI-Dials (whose ids are Dials*); both use the DIAL socket type and models/loras/dials/, so they interoperate."""
import json

import torch
from comfy_api.latest import io, ui

from . import blocks, core, envelopes, presets

presets.install_routes()

Dial = io.Custom("DIAL")


def info_inputs():
    """Dial info saved into the dial file: the rack shows it and its map draws the useful and overcook ellipses."""
    return [
        io.String.Input("description", default="", optional=True,
                        tooltip="What the dial does, for whoever loads it; shown as the dial's tooltip in the Dial Rack."),
        io.String.Input("negative_label", default="", optional=True, tooltip="What negative strength gives, e.g. 'stoic'; labels the map axis."),
        io.String.Input("positive_label", default="", optional=True, tooltip="What positive strength gives, e.g. 'lively'; labels the map axis."),
        io.Float.Input("useful", default=1.0, min=0.0, max=20.0, step=0.05, optional=True,
                       tooltip="Strength where the effect is clearly there (the map's inner ellipse); 0 = unknown."),
        io.Float.Input("overcook", default=1.5, min=0.0, max=20.0, step=0.05, optional=True,
                       tooltip="Strength where side effects take over (the map's outer ellipse); 0 = unknown."),
        io.Float.Input("negative_useful", default=0.0, min=0.0, max=20.0, step=0.05, optional=True,
                       tooltip="Useful strength on the negative side when it differs from the positive side (0 = same as useful)."),
        io.Float.Input("negative_overcook", default=0.0, min=0.0, max=20.0, step=0.05, optional=True,
                       tooltip="Overcook strength on the negative side when it differs (0 = same as overcook)."),
        io.Combo.Input("evidence", options=["unknown", *core.INFO_EVIDENCE], default="creator", optional=True,
                       tooltip="Where the strengths come from: your own setting, one seed, several seeds or several scenes."),
        io.String.Input("pipeline", default="", optional=True, tooltip="What the strengths were measured on, e.g. 'Pika H3 Flex 6-step'."),
    ]


def info_from(description="", negative_label="", positive_label="", useful=1.0, overcook=1.5, negative_useful=0.0,
              negative_overcook=0.0, evidence="creator", pipeline=""):
    return core.check_dial_info({"version": 2, "description": description, "negative": negative_label, "positive": positive_label,
                                 "neg": {"useful": negative_useful or useful or None, "overcook": negative_overcook or overcook or None},
                                 "pos": {"useful": useful or None, "overcook": overcook or None},
                                 "evidence": None if evidence == "unknown" else evidence, "pipeline": pipeline})




class DialRack(io.ComfyNode):
    """Pre rows use the single-dial chain; constant post rows become one shift summed in float64, so row order cannot
    change the output. Holds project that summed shift; envelopes shift cached text at each denoising call. A row with
    block strengths moves every post row of the rack to per-block injection (blocks.py). Wired dials appear as rack rows too."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialRack",
            display_name="Dial Rack (alpha)",
            category="MAINodes/Dials",
            description="Stack steering dials on a MiniMax H3 model: strength, on/off, solo, and H to hold a post-refiner direction.",
            inputs=[
                io.Model.Input("model"),
                io.String.Input("rack", default="[]", tooltip="Rack rows as JSON; edited through the rack UI."),
                io.Autogrow.Input("dials", optional=True, template=io.Autogrow.TemplatePrefix(
                    input=Dial.Input("dial", tooltip="A dial from Make Dial or Combine Dials; set its strength in the rack."),
                    prefix="dial_", min=0, max=8)),
            ],
            outputs=[io.Model.Output()],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, model, rack, dials=None) -> io.NodeOutput:
        rows = json.loads(rack or "[]")
        if not isinstance(rows, list):
            raise ValueError("rack must be a JSON list of rows")
        active = [r for r in rows if r.get("on", True) and (r.get("hold") or float(r.get("strength", 0)) != 0)]
        if any(r.get("solo") for r in active):
            active = [r for r in active if r.get("solo")]
        applied, holds = [], []
        for r in active:
            if "input" in r:
                dial = (dials or {}).get(r["input"])
                if dial is None:
                    raise ValueError(f"rack row uses input {r['input']}, which is not connected")
                label = f"{r['input']}: {dial['meta'].get('name', '?')}"
            else:
                dial = core.load_dial(r["dial"])
                label = dial["meta"]["name"]
            if r.get("hold") and dial["mode"] != "post":
                raise ValueError(f"{label}: pre-refiner rows cannot be hold rows; choose a post-refiner dial")
            (holds if r.get("hold") else applied).append((label, dial, float(r.get("strength", 0))))
        report = core.rack_report(applied)
        if holds:
            combined, hold_report = core.rack_hold_shift(applied, holds)
            report += "\n" + hold_report
        if not applied:
            return io.NodeOutput(model, ui=ui.PreviewText(report))
        core.text_modules(model)  # clear error for a non-H3 model before patching
        m = model.clone()
        specs = [r.get("envelope") for r in active]
        if holds and any(spec is not None for spec in specs):
            raise ValueError("hold rows and step envelopes cannot share a rack; use constant rows without an envelope")
        profiles = [r.get("blocks") for r in active if not r.get("hold")]
        if any(p is not None for p in profiles):
            report += "\n" + blocks.apply_rack(m, applied, [r.get("envelope") for r in active if not r.get("hold")], profiles,
                                               holds, cls.hidden.unique_id, report)
            return io.NodeOutput(m, ui=ui.PreviewText(report))
        if holds:
            applied = [row for row in applied if row[1]["mode"] == "pre"] + (
                [("post shift after holds", combined, 1.0)] if any(d["mode"] == "post" for _, d, _ in applied) else [])
            specs = [None] * len(applied)
        elif sum(d["mode"] == "post" for _, d, _ in applied) > 1 and all(spec is None for spec in specs):
            applied = [row for row in applied if row[1]["mode"] == "pre"] + [("summed post shift", core.rack_post_shift(applied), 1.0)]
            specs = [None] * len(applied)
        scheduled = envelopes.apply_rack(m, applied, specs, cls.hidden.unique_id, report)
        if scheduled:
            report += "\nenvelopes: sampled strengths appear here when sampling starts"
        return io.NodeOutput(m, ui=ui.PreviewText(report))


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
                                        "'! A ||| B' holds one quality; use '![name] A ||| B' for separate hold groups. '(words:2)' counts those words twice. "
                                        "'A ||| B :: 2' weights a pair. Lines '+1 prompt' / '-0.5 prompt' form a prompt set: weighted + prompts minus weighted - prompts."),
                io.String.Input("subjects", multiline=True, default="A young woman\nAn old man\nA golden dog\nA horse",
                                tooltip="Optional: one subject per line, substituted for {subject}. Varied subjects cancel out, leaving only the A→B difference."),
                io.String.Input("name", default="my_dial", tooltip="Saved as models/loras/dials/<name>.safetensors (empty = don't save)."),
                io.Combo.Input("inject", options=["post_refiner (hook)", "pre_refiner (LoRA file)"], default="post_refiner (hook)", advanced=True,
                               tooltip="post_refiner: where the DiT reads the prompt, most faithful (use with Dial Rack). "
                                       "pre_refiner: a bias diff the stock LoRA loader can apply; keep it at strength <= 1."),
                io.Boolean.Input("debias", default=True, advanced=True,
                                 tooltip="Project out the generic 'more wording' directions that every prompt-pair difference shares."),
                io.Int.Input("nuisance_dims", default=3, min=1, max=12, advanced=True, tooltip="How many nuisance directions to remove."),
                *info_inputs(),  # last, so workflows saved before these fields load unchanged
            ],
            outputs=[Dial.Output(display_name="dial")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip, model, pairs, subjects, name, inject, debias, nuisance_dims, **info) -> io.NodeOutput:
        info = info_from(**info)
        if name:
            core.check_dial_name(name)
        mode = "post" if inject.startswith("post") else "pre"
        dial, report = core.make_dial(clip, model, pairs, subjects, name or "unsaved", mode, debias=debias, nuisance_dims=nuisance_dims)
        if name:
            report += f"\nsaved {core.save_dial(dial, name, info)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


class MakeDialFromPictures(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialMakeFromPictures",
            display_name="Make Dial from Pictures (alpha)",
            category="MAINodes/Dials",
            description="Make a post-refiner dial from picture batches: negative strength moves toward A, positive toward B. "
                        "Use the same prompt for both sides and match framing, light and background by picture index.",
            inputs=[
                io.Clip.Input("clip"),
                io.Model.Input("model"),
                io.Image.Input("pictures_a", optional=True,
                               tooltip="Group A as an image batch (same size); negative dial strength moves toward this side."),
                io.Image.Input("pictures_b", optional=True,
                               tooltip="Group B as an image batch; equal counts pair by index for the agreement report."),
                io.String.Input("prompt", display_name="picture prompt", default="A video in the style and content of <Picture 1>.", advanced=True,
                                tooltip="Text every picture is encoded with; <Picture 1> stands for the picture. Both sides use it, so only the "
                                        "pictures differ. The default works; change it to frame the pictures, e.g. 'A close-up photo of <Picture 1>'."),
                io.String.Input("name", default="my_picture_dial", tooltip="Saved as models/loras/dials/<name>.safetensors (empty = don't save)."),
                io.Boolean.Input("debias", default=True, advanced=True,
                                 tooltip="Project out the same generic wording directions used by Make Dial."),
                io.Int.Input("nuisance_dims", default=3, min=1, max=12, advanced=True),
                *info_inputs(),  # last, so workflows saved before these fields load unchanged
                io.Combo.Input("framing", options=["picture prompt", *core.PICTURE_FRAMINGS, "all averaged"], default="picture prompt",
                               optional=True, tooltip="How the pictures are read: your picture prompt, a fixed framing (content: "
                               "what is in the picture; look: colours and light; bare: no hint), or all of them averaged per picture."),
                io.Autogrow.Input("group_a", optional=True, template=io.Autogrow.TemplatePrefix(
                    io.Image.Input("a", tooltip="Another group A picture, any size; adds to pictures_a."), prefix="a", min=0, max=50)),
                io.Autogrow.Input("group_b", optional=True, template=io.Autogrow.TemplatePrefix(
                    io.Image.Input("b", tooltip="Another group B picture, any size; adds to pictures_b."), prefix="b", min=0, max=50)),
            ],
            outputs=[Dial.Output(display_name="dial")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip, model, pictures_a=None, pictures_b=None, prompt="", name="", debias=True, nuisance_dims=3,
                framing="picture prompt", group_a=None, group_b=None, **info) -> io.NodeOutput:
        info = info_from(**info)
        if name:
            core.check_dial_name(name)
        a = [p for p in [pictures_a, *(group_a or {}).values()] if p is not None]
        b = [p for p in [pictures_b, *(group_b or {}).values()] if p is not None]
        if not a or not b:
            raise ValueError("Make Dial from Pictures needs pictures on both sides: connect pictures_a / group_a and pictures_b / group_b")
        framings = core.PICTURE_FRAMINGS
        prompts = [prompt] if framing == "picture prompt" else [prompt, *framings.values()] if framing == "all averaged" else [framings[framing]]
        dial, report = core.make_picture_dial(clip, model, a, b, prompts, name or "unsaved",
                                              debias=debias, nuisance_dims=nuisance_dims)
        if name:
            report += f"\nsaved {core.save_dial(dial, name, info)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


class MakeDialFromVideos(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialMakeFromVideos",
            display_name="Make Dial from Videos (alpha)",
            category="MAINodes/Dials",
            description="Make a post-refiner dial from matched clips: negative strength moves toward A, positive toward B. "
                        "Each clip is sampled at 2 fps with timestamps; audio is excluded.",
            inputs=[
                io.Clip.Input("clip"),
                io.Model.Input("model"),
                io.Autogrow.Input("videos_a", template=io.Autogrow.TemplatePrefix(
                    input=io.Video.Input("video_a"), prefix="video_a_", min=1, max=12)),
                io.Autogrow.Input("videos_b", template=io.Autogrow.TemplatePrefix(
                    input=io.Video.Input("video_b"), prefix="video_b_", min=1, max=12)),
                io.String.Input("prompt", display_name="clip prompt", default="A video in the style and content of <Video 1>.", advanced=True,
                                tooltip="Text every clip is encoded with; <Video 1> stands for the clip. Both sides use it, so only the clips "
                                        "differ. The default works; change it to frame the clips."),
                io.String.Input("name", default="my_video_dial", tooltip="Saved as models/loras/dials/<name>.safetensors (empty = don't save)."),
                io.Boolean.Input("debias", default=True, advanced=True),
                io.Int.Input("nuisance_dims", default=3, min=1, max=12, advanced=True),
                *info_inputs(),  # last, so workflows saved before these fields load unchanged
            ],
            outputs=[Dial.Output(display_name="dial")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip, model, videos_a, videos_b, prompt, name, debias, nuisance_dims, **info) -> io.NodeOutput:
        info = info_from(**info)
        if name:
            core.check_dial_name(name)

        def components(videos):
            return [(c.images, c.frame_rate) for c in (videos[k].get_components() for k in sorted(videos, key=lambda x: int(x.rsplit("_", 1)[1])))]
        dial, report = core.make_video_dial(clip, model, components(videos_a), components(videos_b), prompt,
                                            name or "unsaved", debias=debias, nuisance_dims=nuisance_dims)
        if name:
            report += f"\nsaved {core.save_dial(dial, name, info)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


def parent(dial):
    """A Combine input as recorded in the recipe: name, vector hash, and its own recipe when it was combined too."""
    out = {"name": dial["meta"].get("name"), "vector_sha256": core.vector_sha256(dial)}
    recipe = dial["meta"].get("composition")
    if recipe:
        out["composition"] = json.loads(recipe) if isinstance(recipe, str) else recipe
    return out


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
                *info_inputs(),  # last, so workflows saved before these fields load unchanged
            ],
            outputs=[Dial.Output(display_name="dial")],
        )

    @classmethod
    def execute(cls, a, b, weight_a, weight_b, orthogonalize, name, **info) -> io.NodeOutput:
        info = info_from(**info)
        if (a["target"], a["mode"]) != (b["target"], b["mode"]):
            raise ValueError(f"dials use different injection points: {a['mode']} {a['target']} vs {b['mode']} {b['target']}")
        va, vb = a["vec"].float(), b["vec"].float()
        cos = float(torch.nn.functional.cosine_similarity(va, vb, dim=0))
        note = ""
        if orthogonalize and float(vb @ vb) > 0:
            va = va - (va @ vb) / (vb @ vb) * vb
        elif orthogonalize:
            note = "\nb is a zero vector: orthogonalize left a unchanged"
        label = f"{a['meta'].get('name', 'a')}*{weight_a:g}{'-proj' if orthogonalize else ''}+{b['meta'].get('name', 'b')}*{weight_b:g}"
        dial = {"vec": weight_a * va + weight_b * vb, "target": a["target"], "mode": a["mode"],
                "meta": {"name": name or label, "parents": [a["meta"].get("name"), b["meta"].get("name")]}}
        dial["meta"]["composition"] = {"kind": "combine", "weight_a": weight_a, "weight_b": weight_b, "orthogonalize_a_against_b": orthogonalize,
                                       "a": parent(a), "b": parent(b), "result_sha256": core.vector_sha256(dial)}
        report = f"cos(a, b) = {cos:.3f}; {core.dial_label(dial)}{note}"
        if name:
            report += f"\nsaved {core.save_dial(dial, name, info)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _cls in (DialRack, MakeDial, MakeDialFromPictures, MakeDialFromVideos, CombineDials):
    _schema = _cls.GET_SCHEMA()
    NODE_CLASS_MAPPINGS[_schema.node_id] = _cls
    NODE_DISPLAY_NAME_MAPPINGS[_schema.node_id] = _schema.display_name
