"""Dials nodes (V3): Dial Rack, Make Dial, Combine Dials. Node ids are MAIDial*, so this pack can be installed next to
ComfyUI-Dials (whose ids are Dials*); both use the DIAL socket type and models/loras/dials/, so they interoperate."""
import json
import os

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
import node_helpers
from comfy_api.latest import io, ui

from . import blocks, core, editor, envelopes, presets, timecurve

presets.install_routes()
editor.install_routes()

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


def row_dial(r, dials):
    """-> (label, dial) of a rack row: a wired input or a dial file."""
    if "input" in r:
        dial = (dials or {}).get(r["input"])
        if dial is None:
            raise ValueError(f"rack row uses input {r['input']}, which is not connected")
        return f"{r['input']}: {dial['meta'].get('name', '?')}", dial
    dial = core.load_dial(r["dial"])
    return dial["meta"]["name"], dial


class DialRack(io.ComfyNode):
    """Pre rows use the single-dial chain; constant post rows become one shift summed in float64, so row order cannot
    change the output. Holds project that summed shift; envelopes shift cached text at each denoising call. A row with
    block strengths moves every post row of the rack to per-block injection (blocks.py). Rows with a time curve vary over
    clip time on top of the other rows (timecurve.py). Wired dials appear as rack rows too."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialRack",
            display_name="Dial Rack (alpha)",
            category="MAINodes/Dials",
            description="Stack steering dials on a MiniMax H3, MOSS-Image or Krea 2 model: strength, on/off, solo, and H to hold a post-refiner direction.",
            inputs=[
                io.Model.Input("model"),
                io.String.Input("rack", default="[]", tooltip="Rack rows as JSON; edited through the rack UI."),
                io.Autogrow.Input("dials", optional=True, template=io.Autogrow.TemplatePrefix(
                    input=Dial.Input("dial", tooltip="A dial from Make Dial or Combine Dials; set its strength in the rack."),
                    prefix="dial_", min=0, max=8)),
                io.Audio.Input("curve_audio", optional=True,
                               tooltip="Music for audio-driven time curves: give H3 the same track as reference audio. "
                                       "Its waveform shows under the rows' time curves after a run."),
                io.String.Input("hold_map", optional=True, force_input=True,
                                tooltip="De-rope: hold_map_used from H3 Time Smear. Time curves then follow real clip time in the "
                                        "stretched second pass; a clip with the real length samples as without it."),
            ],
            outputs=[io.Model.Output()],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, model, rack, dials=None, curve_audio=None, hold_map=None) -> io.NodeOutput:
        rows = json.loads(rack or "[]")
        if not isinstance(rows, list):
            raise ValueError("rack must be a JSON list of rows")
        active = [r for r in rows if r.get("on", True) and (r.get("hold") or float(r.get("strength", 0)) != 0)]
        if any(r.get("solo") for r in active):
            active = [r for r in active if r.get("solo")]
        if any(r.get("time") for r in active):
            return cls.timed(model, active, dials, curve_audio, hold_map)
        applied, holds = [], []
        for r in active:
            label, dial = row_dial(r, dials)
            if r.get("hold") and dial["mode"] != "post":
                raise ValueError(f"{label}: pre-refiner rows cannot be hold rows; choose a post-refiner dial")
            (holds if r.get("hold") else applied).append((label, dial, float(r.get("strength", 0))))
        if applied:
            path = core.text_path(model)  # clear errors for an unsupported model or another family's dial before patching
            for _, dial, _ in applied + holds:
                core.check_family(dial, path)
        report = core.rack_report(applied)
        if holds:
            combined, hold_report = core.rack_hold_shift(applied, holds)
            report += "\n" + hold_report
        if not applied:
            return io.NodeOutput(model, ui=ui.PreviewText(report))
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

    @classmethod
    def timed(cls, model, active, dials, curve_audio, hold_map):
        """Rows with a time curve blend over clip time (timecurve.py) on top of the model the other rows make."""
        timed = [r for r in active if r.get("time")]
        if any(r.get("hold") for r in active):
            raise ValueError("hold rows and time curves cannot share a rack; turn the hold rows off")
        if any(r.get("envelope") is not None or r.get("blocks") is not None for r in timed):
            raise ValueError("a time-curve row cannot also take a step envelope or block strengths")
        rest = [r for r in active if not r.get("time")]
        out = cls.execute(model, json.dumps(rest), dials)
        rows = [(*row_dial(r, dials), float(r["strength"])) for r in timed]
        path = core.text_path(model)
        for _, dial, _ in rows:
            core.check_family(dial, path)
        m = out.result[0].clone()
        report = (out.ui.as_dict()["text"][0] + "\n" if rest else "") + core.rack_report(rows)
        text, data = timecurve.apply_rack(m, rows, [r["time"] for r in timed], curve_audio, hold_map, cls.hidden.unique_id, report)
        return io.NodeOutput(m, ui={"text": [report + "\n" + text], "timecurve": [data]} if data else ui.PreviewText(report + "\n" + text))


class DialHoldMap(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialHoldMap",
            display_name="Dial Hold Map (alpha)",
            category="MAINodes/Dials",
            description="De-rope with one rack: give the Dial Rack's model H3 Time Smear's hold map for stage 2, so the rack's time curves "
                        "follow real clip time in the stretched pass. Rows without a time curve are unchanged.",
            inputs=[
                io.Model.Input("model", tooltip="The Dial Rack's model, the same one pass 1 samples with."),
                io.String.Input("hold_map", force_input=True, tooltip="hold_map_used from H3 Time Smear."),
            ],
            outputs=[io.Model.Output()],
        )

    @classmethod
    def execute(cls, model, hold_map) -> io.NodeOutput:
        return io.NodeOutput(timecurve.attach_holds(model, hold_map))


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


PICTURE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def picture_folders():
    root = folder_paths.get_input_directory()
    return sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)) and not d.startswith(".")) if os.path.isdir(root) else []


def load_picture_folder(name):
    """Every picture in input/<name> (sorted by file name), each at its own size; the folder must stay inside input/."""
    root = os.path.realpath(folder_paths.get_input_directory())
    path = os.path.realpath(os.path.join(root, name))
    if os.path.commonpath([root, path]) != root or path == root or not os.path.isdir(path):
        raise ValueError(f"picture folder {name!r} is not a folder inside ComfyUI's input folder")
    pictures = []
    for f in sorted(os.listdir(path)):
        if f.lower().endswith(PICTURE_EXTENSIONS) and os.path.isfile(os.path.join(path, f)):
            img = ImageOps.exif_transpose(node_helpers.pillow(Image.open, os.path.join(path, f))).convert("RGB")
            pictures.append(torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0)[None])
    if not pictures:
        raise ValueError(f"picture folder {name!r} has no pictures ({', '.join(PICTURE_EXTENSIONS)})")
    return pictures


class MakeDialFromPictures(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIDialMakeFromPictures",
            display_name="Make Dial from Pictures (alpha)",
            category="MAINodes/Dials",
            description="Turn the difference between two groups of pictures into a dial: negative strength moves toward group A, "
                        "positive toward group B. Match the pictures so only one thing changes. Open the node's help for a guide.",
            inputs=[
                io.Clip.Input("clip"),
                io.Model.Input("model"),
                io.Image.Input("pictures_a", optional=True,
                               tooltip="Group A as an image batch (same size); negative dial strength moves toward this side."),
                io.Image.Input("pictures_b", optional=True,
                               tooltip="Group B as an image batch; equal counts pair by index for the agreement report."),
                io.String.Input("prompt", display_name="picture prompt", default="A video in the style and content of <Picture 1>.", advanced=True,
                                tooltip="Your own sentence each picture is read through, used when framing is 'picture prompt'; <Picture 1> stands "
                                        "for the picture. Naming the kind of subject helps, e.g. 'A video of the animal in <Picture 1>.'"),
                io.String.Input("name", default="my_picture_dial", tooltip="Saved as models/loras/dials/<name>.safetensors (empty = don't save)."),
                io.Boolean.Input("debias", default=True, advanced=True,
                                 tooltip="Project out the same generic wording directions used by Make Dial."),
                io.Int.Input("nuisance_dims", default=3, min=1, max=12, advanced=True),
                *info_inputs(),  # last, so workflows saved before these fields load unchanged
                io.Combo.Input("framing", options=["picture prompt", *core.PICTURE_FRAMINGS, "all averaged"], default="content",
                               optional=True, tooltip="How the pictures are read. content: what is in them (subjects, objects; the default). "
                               "look: colours and light. bare: no hint. all averaged: all of them. picture prompt: your own "
                               "sentence (advanced; the original wording). Open the node's help for which to pick."),
                io.Autogrow.Input("group_a", optional=True, template=io.Autogrow.TemplatePrefix(
                    io.Image.Input("a", tooltip="Another group A picture, any size; adds to pictures_a."), prefix="a", min=0, max=50)),
                io.Autogrow.Input("group_b", optional=True, template=io.Autogrow.TemplatePrefix(
                    io.Image.Input("b", tooltip="Another group B picture, any size; adds to pictures_b."), prefix="b", min=0, max=50)),
                io.Combo.Input("folder_a", options=["none", *picture_folders()], default="none", optional=True,
                               tooltip="A folder inside ComfyUI's input folder: all its pictures join group A (sorted by file name, each at its own size)."),
                io.Combo.Input("folder_b", options=["none", *picture_folders()], default="none", optional=True,
                               tooltip="A folder inside ComfyUI's input folder: all its pictures join group B. Name matched pairs alike so they pair by index."),
            ],
            outputs=[Dial.Output(display_name="dial")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip, model, pictures_a=None, pictures_b=None, prompt="", name="", debias=True, nuisance_dims=3,
                framing="content", group_a=None, group_b=None, folder_a="none", folder_b="none", **info) -> io.NodeOutput:
        info = info_from(**info)
        if name:
            core.check_dial_name(name)
        a = [p for p in [pictures_a, *(group_a or {}).values()] if p is not None]
        b = [p for p in [pictures_b, *(group_b or {}).values()] if p is not None]
        if folder_a != "none":
            a += load_picture_folder(folder_a)
        if folder_b != "none":
            b += load_picture_folder(folder_b)
        if not a or not b:
            raise ValueError("Make Dial from Pictures needs pictures on both sides: connect pictures_a / group_a or pick folder_a, "
                             "and the same for B")
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
        if core.dial_family(a) != core.dial_family(b):
            raise ValueError(f"dial a was made for {core.dial_family(a)}, dial b for {core.dial_family(b)}")
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
                "meta": {"name": name or label, "model_family": core.dial_family(a), "parents": [a["meta"].get("name"), b["meta"].get("name")]}}
        dial["meta"]["composition"] = {"kind": "combine", "weight_a": weight_a, "weight_b": weight_b, "orthogonalize_a_against_b": orthogonalize,
                                       "a": core.dial_parent(a), "b": core.dial_parent(b), "result_sha256": core.vector_sha256(dial)}
        report = f"cos(a, b) = {cos:.3f}; {core.dial_label(dial)}{note}"
        if name:
            report += f"\nsaved {core.save_dial(dial, name, info)}"
        return io.NodeOutput(dial, ui=ui.PreviewText(report))


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _cls in (DialRack, DialHoldMap, MakeDial, MakeDialFromPictures, MakeDialFromVideos, CombineDials):
    _schema = _cls.GET_SCHEMA()
    NODE_CLASS_MAPPINGS[_schema.node_id] = _cls
    NODE_DISPLAY_NAME_MAPPINGS[_schema.node_id] = _schema.display_name
