"""The ComfyUI node surface of the timeline surface, plus the recorder pair.

Two doors onto one compiler. H3TimelineAnalyze/H3TimelineRender drive the
whole plan-to-graph path in one step; H3DrawnPlan/H3PlanSettings/
H3PlanEstimate hand a plan's compiled answers out as typed outputs, so a
graph author can wire the same numbers into stock H3 nodes and get the same
execution. Whichever door you use, the answers come from timeline/h3.

Two-phase execution, no mid-graph pause (spec): ANALYZE is cheap and writes
plan.json; COMPILE+RENDER is phase 2. The auto checkbox is phase 2's entry:
auto = accept the proposal verbatim and compile immediately (the zero-click
mode), off = the plan is written and you open an editor.

These nodes are THIN CLIENTS. Every rule lives in timeline/ (semantics) and
timeline/h3/ (the model's reality); this file only moves strings around and
draws a preview.
"""
import json
import os

import torch

from . import price, recorder, schema
from .h3 import compile as h3compile
from .h3 import propose
from .h3.compile import H3Backend
# through gridlaw's loader, not `from ..motion import ANY`: the same import
# then works whether the pack is loaded as a ComfyUI package or as a plain
# directory on sys.path (which is how the suites load it).
from .h3.gridlaw import motion as _motion

ANY = _motion.ANY

DEFAULT_PLAN_DIR = os.environ.get("H3_TIMELINE_PLAN_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "output", "timeline"))
DEFAULT_GRAPH_DIR = os.environ.get("H3_TIMELINE_GRAPH_DIR", DEFAULT_PLAN_DIR)


def _strip(plan, compiled=None, height=160, width=None):
    """Preview strip: the drawn density envelope over the clip, with the
    compiled hold map underneath so the quantization is visible (spec: the
    UI draws the quantization honestly)."""
    frames = int(plan["clip"]["frames"])
    w = int(width or max(256, min(1024, frames * 4)))
    lanes = schema.density_lanes(plan)
    env = lanes[0]["envelope"] if lanes else [[0, 1.0]]
    ceiling = float(lanes[0].get("ceiling", 4.0)) if lanes else 4.0
    img = torch.zeros(height, w, 3)
    img[:, :, 2] = 0.06
    for gy in range(1, int(ceiling) + 1):          # density gridlines
        y = height - 1 - int((gy - 1) / max(ceiling - 1, 1e-9) * (height - 1))
        img[max(0, min(height - 1, y)), :, :] = 0.18
    for x in range(w):
        f = int(x / float(w) * frames)
        r = schema.sample_envelope(env, f)
        y = height - 1 - int((r - 1.0) / max(ceiling - 1.0, 1e-9) * (height - 1))
        y = max(0, min(height - 1, y))
        img[y:, x, 0] = 0.85                       # filled area, red
        img[y:, x, 1] = 0.35
        img[y, x, :] = torch.tensor([1.0, 0.85, 0.2])
    if compiled:
        art = compiled.get("artifact", compiled)
        w0 = art["window"]["start"]
        wl = art["window"]["len"]
        holds = art["hold_map"]["holds"]
        hmax = float(max(holds))
        band = max(6, height // 8)
        for x in range(w):
            f = int(x / float(w) * frames)
            if w0 <= f < w0 + wl:
                h = holds[f - w0]
                v = 0.25 + 0.75 * (h / hmax)
                img[height - band:, x, 0] = v
                img[height - band:, x, 1] = v * 0.6
                img[height - band:, x, 2] = 0.1
        for edge in (w0, w0 + wl - 1):             # window boundaries
            x = min(w - 1, int(edge / float(frames) * w))
            img[:, x, :] = torch.tensor([0.2, 0.9, 1.0])
    return img[None]


def _read_plan(plan_path, plan_json=""):
    """Text -> a migrated plan document, with errors a user can act on.

    A malformed plan is the normal accident here (a half-copied paste, a
    truncated file), so it reports WHERE it broke and stops, rather than
    letting a json exception surface as a stack trace.
    """
    text, src = (plan_json or "").strip(), "the pasted plan"
    if not text:
        p = (plan_path or "").strip()
        if not p:
            raise ValueError("H3 Drawn Plan: give a plan_path or paste a plan "
                             "into plan_json")
        if not os.path.isfile(p):
            raise ValueError(f"H3 Drawn Plan: no plan file at {p}")
        with open(p, encoding="utf-8-sig") as fh:
            text = fh.read()
        src = p
    try:
        plan = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"H3 Drawn Plan: {src} is not valid JSON "
                         f"(line {e.lineno}, column {e.colno}): {e.msg}")
    if not isinstance(plan, dict):
        raise ValueError(f"H3 Drawn Plan: {src} is valid JSON but not a plan "
                         f"document (it is a {type(plan).__name__})")
    return schema.migrate(plan)


class H3TimelineAnalyze:
    """Phase 1: oracle -> plan.json (+ auto-compile)."""

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-14. The timeline surface's front "
        "half. Wire an oracle's profile output (H3 Jerk Oracle and/or H3 "
        "Indecision Oracle) and this writes a PLAN DOCUMENT: a per-clip JSON "
        "that says, in dilation ratios over time, how the shot should be "
        "retimed. The plan is the source of truth; a graph is only ever "
        "compiled FROM it.\n\n"
        "Both oracles wired is the validated combination: jerk catches fast "
        "PROPS, indecision catches detail the model is still arguing with "
        "itself about, and they disagree in both directions, so the proposal "
        "takes the max of the two rank-normalized profiles.\n\n"
        "auto=True is the zero-click mode: the proposal is compiled straight "
        "into a minted graph and the report prices it. auto=False stops at "
        "the plan, for editing in the widget or the web editor.\n\n"
        "The density ceiling is yours to raise. 4x is the measured sweet spot, "
        "not a wall: if you want 8x across the whole clip and are cool "
        "spending the time, raise it and read the price meter.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip_path": ("STRING", {"default": "",
                          "tooltip": "the source clip this plan is about (its file name is what the compiled graph's LoadVideo will use)"}),
            "frames": ("INT", {"default": 124, "min": 39, "max": 3600,
                       "tooltip": "world length of the clip, on the 17k+5 grid; wire H3 Video Fit's length"}),
            "plan_path": ("STRING", {"default": "",
                          "tooltip": "where to write plan.json; empty = output/timeline/<clip>.plan.json"}),
            "auto": ("BOOLEAN", {"default": True,
                     "tooltip": "True: accept the proposal and compile it immediately (zero click). False: write the plan and stop"}),
        }, "optional": {
            "jerk_profile": ("STRING", {"forceInput": True,
                             "tooltip": "H3 Jerk Oracle's profile output"}),
            "indecision_profile": ("STRING", {"forceInput": True,
                                    "tooltip": "H3 Indecision Oracle's profile output"}),
            "ceiling": ("FLOAT", {"default": 4.0, "min": 1.0, "max": 16.0, "step": 0.5,
                        "tooltip": "the lane's top end in generated frames per world frame; the output is NOT slower or longer, it is generated denser. The price meter is what makes a high ceiling safe"}),
            "threshold": ("FLOAT", {"default": 0.75, "min": 0.0, "max": 0.99, "step": 0.01,
                          "tooltip": "rank-scale saliency below which the clip stays at real time (the oracle's q, on a scale both signals share)"}),
            "prompt": ("STRING", {"default": "", "multiline": True}),
            "width": ("INT", {"default": 1152, "min": 64, "max": 4096, "step": 32}),
            "height": ("INT", {"default": 640, "min": 64, "max": 4096, "step": 32}),
            "regen_strength": ("FLOAT", {"default": 0.45, "min": 0.0, "max": 1.0, "step": 0.01,
                               "tooltip": "how much of the denoise schedule the regeneration gets (H3's inject)"}),
            "steps": ("INT", {"default": 25, "min": 1, "max": 100}),
            "seed": ("INT", {"default": 20260817, "min": 0, "max": 0xffffffffffffffff}),
            "output_prefix": ("STRING", {"default": "video/timeline"}),
            "graph_path": ("STRING", {"default": "",
                           "tooltip": "where auto-compile mints the .api.json; empty = workflows/<plan name>.api.json"}),
        }}

    RETURN_TYPES = ("STRING", "IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("plan_path", "preview", "graph_path", "report")
    FUNCTION = "analyze"
    CATEGORY = "latent/minimax/timeline"

    def analyze(self, clip_path, frames, plan_path, auto,
                jerk_profile=None, indecision_profile=None, ceiling=4.0,
                threshold=0.75, prompt="", width=1152, height=640,
                regen_strength=0.45, steps=25, seed=20260817,
                output_prefix="video/timeline", graph_path=""):
        plan = schema.new_plan(
            clip_path, frames=frames, fps=24.0, width=width, height=height,
            proposed_by="H3TimelineAnalyze",
            settings={"prompt": prompt, "regen_strength": float(regen_strength),
                      "steps": int(steps), "seed": int(seed),
                      "output_prefix": output_prefix})
        lane = propose.propose_density_lane(
            frames, jerk=jerk_profile, indecision=indecision_profile,
            ceiling=float(ceiling), threshold=float(threshold))
        plan["lanes"].append(lane)
        schema.note_edit(plan, "H3TimelineAnalyze",
                         f"proposed temporal lane from {lane['proposer']}")
        schema.validate_or_raise(plan)

        base = os.path.splitext(os.path.basename(clip_path or "clip"))[0]
        plan_path = plan_path or os.path.join(DEFAULT_PLAN_DIR,
                                              f"{base}.plan.json")
        peak = max(r for _f, r in lane["envelope"])
        ch = propose.challenge_ceiling(peak)
        lines = [f"plan {plan['id'][:8]} rev {plan['revision']}: "
                 f"{len(lane['envelope'])} control points, peak {peak:.2f}x, "
                 f"ceiling {ceiling:g}, proposer {lane['proposer']}"]
        if ch:
            plan.setdefault("provenance", {}).setdefault(
                "flags", []).append(ch)
            lines.append(f"RECIPE CHALLENGE (flagged, not overridden): "
                         f"{ch['why']}")

        compiled, out_graph = None, ""
        if auto:
            out_graph = graph_path or os.path.join(
                DEFAULT_GRAPH_DIR, f"{base}_timeline.api.json")
            res = H3Backend().compile(plan, {"graph_path": out_graph})
            compiled = res.compiled
            lines.append(res.report)
        schema.save(plan, plan_path)
        lines.insert(1, f"plan written: {plan_path}")
        if out_graph:
            lines.insert(2, f"graph minted: {out_graph}")
        return (plan_path, _strip(plan, compiled), out_graph, "\n".join(lines))


class H3TimelineRender:
    """Phase 2: plan.json -> a minted graph, priced.

    SHIPPED IN v0: this node COMPILES and MINTS; it does not execute the
    compiled graph in-process. Execution stays with the launcher
    (queue_scene.py), which is the project's only sanctioned way to start a
    render and carries the collision and node_error guards. Wiring the
    compiled section into a live sampler inside one graph is T2 work.
    """

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-14. Phase 2 of the timeline "
        "surface: read a plan.json (yours, the oracle's, or one somebody "
        "posted), compile it to a legal H3 graph, and price it.\n\n"
        "v0 emits the minted graph PATH and the exact launch line rather "
        "than executing it in place: launching belongs to queue_scene.py, "
        "which guards output-prefix collisions and refuses partial graphs.\n\n"
        "If the plan was edited after it was last compiled, this recompiles "
        "it — the compiled block is a cache keyed to the plan's revision, "
        "never a second source of truth.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "plan_path": ("STRING", {"default": "", "forceInput": False}),
        }, "optional": {
            "graph_path": ("STRING", {"default": "",
                           "tooltip": "empty = workflows/<plan name>.api.json"}),
            "port": ("INT", {"default": 8189, "min": 8188, "max": 8199,
                     "tooltip": "instance the launch line targets, and whose /system_stats the VRAM fit line reads"}),
            "recorder_path": ("STRING", {"default": recorder.DEFAULT_PATH,
                              "tooltip": "flight-recorder jsonl; layer (b) of the price meter calibrates from YOUR runs only"}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("graph_path", "launch_command", "report")
    FUNCTION = "render"
    CATEGORY = "latent/minimax/timeline"

    def render(self, plan_path, graph_path="", port=8189,
               recorder_path=recorder.DEFAULT_PATH):
        plan = schema.load(plan_path)
        base = os.path.splitext(os.path.basename(plan_path))[0]
        base = base.replace(".plan", "")
        graph_path = graph_path or os.path.join(DEFAULT_GRAPH_DIR,
                                                f"{base}_timeline.api.json")
        stale = schema.compiled_is_stale(plan, H3Backend.backend_id)
        res = H3Backend().compile(plan, {"graph_path": graph_path,
                                         "port": int(port),
                                         "recorder_path": recorder_path})
        schema.save(plan, plan_path)
        launcher = os.environ.get("H3_TIMELINE_QUEUE_CMD", "")
        cmd = (f"{launcher} {graph_path} --tag timeline --port {int(port)}" if launcher
               else f"(set H3_TIMELINE_QUEUE_CMD to a launcher; graph at {graph_path})")
        report = "\n".join([
            f"plan {plan.get('id', '?')[:8]} rev {plan.get('revision', 0)} "
            f"({'recompiled after an edit' if stale else 'cache was current'})",
            res.report,
            f"minted: {graph_path}",
            "launch with:  " + cmd,
        ])
        return (graph_path, cmd, report)


def _compile_for_nodes(plan_path, plan_json="", ignore_uncompiled_lanes=False):
    """Read a plan and compile it. -> (plan, CompileResult, skipped lanes).

    THE ONE DOOR the plan-loading nodes go through, so H3 Drawn Plan, H3
    Plan Settings and H3 Plan Estimate cannot drift into three opinions
    about the same document. Everything they return afterwards is a field
    of the compiler's answer, never a recomputation of it.
    """
    plan = _read_plan(plan_path, plan_json)
    backend = H3Backend()
    skipped = []
    if ignore_uncompiled_lanes:
        # which lane types compile is the BACKEND's answer, asked for
        # rather than assumed, so this stays true as lanes land
        runs = set(backend.capabilities()["lanes_compiled"])
        for lane in plan.get("lanes", []):
            if schema.lane_type(lane) not in runs and lane.get("enabled", True):
                lane["enabled"] = False
                skipped.append(str(lane.get("type")))
    problems = backend.validate(plan)
    if problems:
        raise ValueError("this plan cannot be compiled: " + "; ".join(problems))
    return plan, backend.compile(plan), skipped


def _plan_inputs(extra=None):
    """The three loader nodes take the same document the same way."""
    opt = {"plan_json": ("STRING", {"default": "", "multiline": True,
                         "tooltip": "the plan document itself, pasted; wins over plan_path"}),
           "ignore_uncompiled_lanes": ("BOOLEAN", {"default": False,
                         "tooltip": "a plan may carry lanes this backend cannot compile yet (pins, regions). OFF: refuse, so nothing is silently dropped. ON: compile the density lane anyway and name every lane that was skipped"})}
    opt.update(extra or {})
    return {"required": {
        "plan_path": ("STRING", {"default": "",
                      "tooltip": "path to a plan.json written by the editor, the oracle node or the CLI"}),
    }, "optional": opt}


def _tail_lines(res, skipped, include_warnings=True):
    """Skipped lanes and the compiler's warnings, for nodes that do not
    already print the compile report (which carries the warnings itself)."""
    lines = []
    if skipped:
        lines.append("SKIPPED (ignore_uncompiled_lanes is ON): %s. Those lanes "
                     "are still in the plan; this pass did not run them"
                     % ", ".join(sorted(set(skipped))))
    if include_warnings:
        for w in res.warnings:
            lines.append("WARNING: " + w)
    return lines


class H3DrawnPlan:
    """A drawn plan document in, the motion nodes' hold-map ranges out.

    THIN LOADER. It parses the plan, hands it to the H3 backend, and reads
    the ranges off the compiled artifact. It contains no grid law: which
    frames are held, how long the window is and where it starts are the
    compiler's answers, and if this node ever needs to know about 17s or
    token indices to do its job, the answer has been forked.
    """

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-15. Load a plan document (the "
        "timeline surface's JSON: what the shot should do, in seconds and "
        "densities) and get back the hold-map ranges H3 Manual Hold Map "
        "takes, already on the world clock.\n\n"
        "Draw the envelope in the web editor, export the plan, point this "
        "node at the file: the drawing arrives in the graph without anybody "
        "retyping frame numbers.\n\n"
        "The ranges come from the COMPILER, not from this node. It is the "
        "same compilation H3 Timeline Render would mint, so the map is "
        "already shaped: feed the ranges to H3 Manual Hold Map with ramp "
        "OFF and bridge 0 to reproduce it exactly. Leaving ramp on re-shapes "
        "the shoulders a second time.\n\n"
        "plan_json wins over plan_path when both are filled, so a plan "
        "pasted from a chat works without a file.\n\n"
        "TWO DOORS, ONE ANSWER: hold_map is the compiler's map verbatim, "
        "for wiring straight into H3 Temporal Insert. ranges is the same "
        "map in H3 Manual Hold Map's language, for when you want to read "
        "or edit it by hand (that route re-shapes through the node's own "
        "token snapping, so wire ranges with ramp OFF and bridge 0). "
        "splice_map drives H3 Segment Splice at feather 0 to put the "
        "recovered window back into the untouched clip.")

    @classmethod
    def INPUT_TYPES(cls):
        return _plan_inputs()

    RETURN_TYPES = ("STRING", "INT", "INT", "INT", "INT", "STRING",
                    "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("ranges", "length", "fps", "window_start", "window_len",
                    "report",
                    "hold_map", "dilated_frames", "guide_frame", "splice_map")
    FUNCTION = "load"
    CATEGORY = "latent/minimax/timeline"

    def load(self, plan_path, plan_json="", ignore_uncompiled_lanes=False):
        try:
            plan, res, skipped = _compile_for_nodes(
                plan_path, plan_json, ignore_uncompiled_lanes)
        except ValueError as e:
            raise ValueError("H3 Drawn Plan: %s" % e)
        art = res.compiled["artifact"]
        holds = art["hold_map"]["holds"]
        w0 = int(art["window"]["start"])
        wlen = int(art["window"]["len"])
        frames = int(plan["clip"]["frames"])
        fps = int(round(float(plan["clip"].get("fps") or 24)))
        ranges = h3compile.ranges_from_holds(holds, w0, fps)
        shown = ranges or "(none: the drawn envelope is flat at 1.0)"
        # Both strings are the COMPILER's, passed through: the hold map as
        # H3 Temporal Insert eats it, and the window's place in the clip as
        # H3 Segment Splice eats it.
        hold_map = json.dumps(art["hold_map"])
        splice_map = json.dumps({"start": w0, "end": w0 + wlen - 1,
                                 "world_len": frames,
                                 "handle_in": 0, "handle_out": 0})
        lines = [f"plan {plan.get('id', '?')[:8]} rev {plan.get('revision', 0)}"
                 f" -> {len([1 for h in holds if h > 1])} held world frames in "
                 f"{len(ranges.split(',')) if ranges else 0} ranges",
                 f"ranges (world clock, {fps} fps): {shown}",
                 "wire hold_map into H3 Temporal Insert for the exact map; "
                 "the ranges route needs ramp OFF and bridge 0",
                 res.report] + _tail_lines(res, skipped,
                                           include_warnings=False)
        return (ranges, frames, fps, w0, wlen, "\n".join(lines),
                hold_map, int(art["dilated_frames"]),
                int(art["guide_dilated_idx"]), splice_map)


class H3PlanSettings:
    """The plan's execution knobs, as typed outputs.

    THIN LOADER, like its sibling: every value here is read out of the plan
    document or the compiler's answer. No default is invented, no number is
    adjusted, and nothing about the model's grid is known here.
    """

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-15. The other half of H3 Drawn "
        "Plan: the settings a graph needs wired, straight off the plan "
        "document.\n\n"
        "inject and steps drive H3 Inject Schedule, seed drives Random "
        "Noise, width/height/prompt drive the conditioning node, "
        "output_prefix drives Save Video. Wire these instead of retyping "
        "them and the graph cannot drift from the plan it came from.\n\n"
        "expand_to_end reports what the plan ASKED for. The compiler has "
        "already applied it to the map, so H3 Temporal Insert must be left "
        "at False: wiring this output into that toggle would apply it "
        "twice.")

    @classmethod
    def INPUT_TYPES(cls):
        return _plan_inputs()

    RETURN_TYPES = ("FLOAT", "INT", "INT", "STRING", "INT", "INT", "STRING",
                    "BOOLEAN", "STRING")
    RETURN_NAMES = ("inject", "steps", "seed", "prompt", "width", "height",
                    "output_prefix", "expand_to_end", "report")
    FUNCTION = "load"
    CATEGORY = "latent/minimax/timeline"

    def load(self, plan_path, plan_json="", ignore_uncompiled_lanes=False):
        try:
            plan, res, skipped = _compile_for_nodes(
                plan_path, plan_json, ignore_uncompiled_lanes)
        except ValueError as e:
            raise ValueError("H3 Plan Settings: %s" % e)
        clip = plan["clip"]
        ov = dict(h3compile.DEFAULT_OVERRIDES)
        ov.update(schema.backend_settings(plan, H3Backend.backend_id))
        inject = float(schema.setting(plan, "regen_strength"))
        steps = int(schema.setting(plan, "steps"))
        seed = int(schema.setting(plan, "seed"))
        width = int(clip.get("width") or ov["width"])
        height = int(clip.get("height") or ov["height"])
        expand = bool(schema.setting(plan, "hold_expansion_to_clip_end"))
        lines = [f"plan {plan.get('id', '?')[:8]} rev {plan.get('revision', 0)}: "
                 f"inject {inject:g} over {steps} steps, seed {seed}, "
                 f"{width}x{height}",
                 f"delivery: {schema.setting(plan, 'output_prefix')} "
                 f"(sync policy {schema.setting(plan, 'sync_policy')})",
                 "expand_to_end is the plan's INTENT and is already baked "
                 "into the hold map; leave H3 Temporal Insert at False",
                 ] + _tail_lines(res, skipped)
        return (inject, steps, seed, schema.setting(plan, "prompt", "") or "",
                width, height, schema.setting(plan, "output_prefix"),
                expand, "\n".join(lines))


class H3PlanEstimate:
    """What the plan costs, before anything runs.

    The price meter's three layers, surfaced in the graph. Layer (b)
    ABSTAINS rather than quoting another machine's minutes: seconds comes
    back as -1 when there is no calibration for this box, and the report
    says why. Reading -1 as a number is the caller's mistake to avoid; the
    node will not invent one.
    """

    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-08-15. Price a plan without running "
        "it: how many times a plain render of this clip it costs, how many "
        "work units it generates, and whether it fits your VRAM.\n\n"
        "(a) equivalent clip time is exact from the plan and needs no "
        "calibration. (b) seconds is REAL MINUTES from your own flight "
        "recorder, and comes back as -1 when you have no runs on record for "
        "this box: an uncalibrated guess from GPU specs is worse than no "
        "answer. (c) vram_band is a bracketing verdict from your recorded "
        "runs, not a peak-bytes prediction.\n\n"
        "recorder_path and port are the same two sources the timeline "
        "surface uses; leave them alone unless your setup moved.")

    @classmethod
    def INPUT_TYPES(cls):
        return _plan_inputs({
            "port": ("INT", {"default": 8188, "min": 8188, "max": 8199,
                     "tooltip": "instance whose /system_stats the VRAM reading comes from"}),
            "recorder_path": ("STRING", {"default": recorder.DEFAULT_PATH,
                              "tooltip": "flight-recorder jsonl; layer (b) calibrates from YOUR runs only"}),
        })

    RETURN_TYPES = ("FLOAT", "FLOAT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("equivalent_clip_time", "seconds", "work_units",
                    "vram_band", "report")
    FUNCTION = "load"
    CATEGORY = "latent/minimax/timeline"

    def load(self, plan_path, plan_json="", ignore_uncompiled_lanes=False,
             port=8188, recorder_path=recorder.DEFAULT_PATH):
        try:
            plan, res, skipped = _compile_for_nodes(
                plan_path, plan_json, ignore_uncompiled_lanes)
        except ValueError as e:
            raise ValueError("H3 Plan Estimate: %s" % e)
        ctx = {"port": int(port)}
        if recorder_path and os.path.isfile(recorder_path):
            ctx["recorder_path"] = recorder_path
        est = H3Backend().estimate(plan, ctx)
        secs = -1.0 if est.seconds is None else float(est.seconds)
        lines = est.lines + _tail_lines(res, skipped)
        if est.seconds is None:
            lines.append("seconds = -1: layer (b) abstained, and this node "
                         "will not turn an abstention into a number")
        return (float(est.multiplier), secs,
                int(est.geometry.work_units_plan), str(est.fit),
                "\n".join(lines))


class H3RecordStart:
    """Flight recorder, front half: reset the torch peak counters."""

    DESCRIPTION = ("Alpha. Drop this in front of the expensive node and H3 "
                   "Record Stop after it. Together they append ONE local "
                   "JSON line per render (work units, resolution, model tag, "
                   "s/step, torch peak bytes) that the timeline's price meter "
                   "calibrates from. Local file, nothing phones home.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"anything": (ANY, {}),
                             "key": ("STRING", {"default": "default"})},
                "optional": {"log_path": ("STRING", {"default": "",
                             "tooltip": "ComfyUI's log file, if you have one. "
                             "Its size is noted NOW so the streamed flag can "
                             "only be read from lines this run wrote"})}}

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("anything",)
    FUNCTION = "go"
    CATEGORY = "latent/minimax/timeline"

    def go(self, anything, key="default", log_path=""):
        recorder.start(key, log_path=log_path or None)
        return (anything,)


class H3RecordStop:
    """Flight recorder, back half: read the peaks and append the line."""

    DESCRIPTION = H3RecordStart.DESCRIPTION

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "anything": (ANY, {}),
            "key": ("STRING", {"default": "default"}),
            "work_units": ("INT", {"default": 0, "min": 0, "max": 100000,
                           "tooltip": "latent tokens this run generated (the compiled plan reports it)"}),
            "steps": ("INT", {"default": 25, "min": 1, "max": 1000}),
        }, "optional": {
            "pixels": ("INT", {"default": 0, "min": 0, "max": 1 << 30}),
            "frames": ("INT", {"default": 0, "min": 0, "max": 10000}),
            "model": ("STRING", {"default": "minimax-h3-int8-convrot"}),
            "path": ("STRING", {"default": recorder.DEFAULT_PATH}),
            "log_path": ("STRING", {"default": "",
                         "tooltip": "ComfyUI's log file, if you have one: the streamed flag is READ from its partial-load lines, never guessed"}),
        }}

    RETURN_TYPES = (ANY, "STRING")
    RETURN_NAMES = ("anything", "record")
    FUNCTION = "go"
    CATEGORY = "latent/minimax/timeline"

    def go(self, anything, key="default", work_units=0, steps=25, pixels=0,
           frames=0, model="minimax-h3-int8-convrot",
           path=recorder.DEFAULT_PATH, log_path=""):
        rec = recorder.stop(key, work_units=work_units, steps=steps,
                            pixels=pixels, frames=frames, model=model,
                            path=path, log_path=log_path or None)
        return (anything, json.dumps(rec))


NODE_CLASS_MAPPINGS = {
    "H3TimelineAnalyze": H3TimelineAnalyze,
    "H3TimelineRender": H3TimelineRender,
    "H3DrawnPlan": H3DrawnPlan,
    "H3PlanSettings": H3PlanSettings,
    "H3PlanEstimate": H3PlanEstimate,
    "H3RecordStart": H3RecordStart,
    "H3RecordStop": H3RecordStop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3TimelineAnalyze": "H3 Timeline Analyze (alpha)",
    "H3TimelineRender": "H3 Timeline Render (alpha)",
    "H3DrawnPlan": "H3 Drawn Plan (alpha)",
    "H3PlanSettings": "H3 Plan Settings (alpha)",
    "H3PlanEstimate": "H3 Plan Estimate (alpha)",
    "H3RecordStart": "H3 Flight Recorder Start (alpha)",
    "H3RecordStop": "H3 Flight Recorder Stop (alpha)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "price"]
