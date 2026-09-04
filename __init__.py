"""ComfyUI-MAINodes — MatlowAI's MiniMax-H3 node collection.

Two families in one pack:
- Contact-Sheet diffusion (five coordinated views from one reference) —
  V3-API nodes, unchanged from ComfyUI-H3-ContactSheet.
- Motion Lab (v2v time-smear de-roping pipeline: jerk oracle, time smear,
  inject schedule, exact recovery, oracle heatmap) — V1 nodes, defaults
  set to measured-best values.

Registration note: ComfyUI's loader treats NODE_CLASS_MAPPINGS and
comfy_entrypoint as either-or (nodes.py: `elif hasattr(module,
"comfy_entrypoint")`), and its V3 path registers node classes into the
same mappings dict keyed by schema.node_id — so we merge the V3 classes
in here ourselves instead of exporting an entrypoint.

The original ComfyUI-H3-ContactSheet repo remains for existing installs;
this is the consolidated home going forward.
"""
from .contact_sheet import H3ContactSheet, H3ContactSheetDecode
from .motion import TIMESMEAR_CLASS_MAPPINGS, TIMESMEAR_DISPLAY_MAPPINGS

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = dict(TIMESMEAR_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS = dict(TIMESMEAR_DISPLAY_MAPPINGS)

# Rolling-window drivers (alpha, 2026-08-12). Three implementations of the
# same idea, deliberately shipped side by side while they are compared on
# real renders: the requeue pair lives in motion.py, the other two in their
# own modules. They share the seam policy and the window planner's rules but
# not its code. Expect at most one of them to survive.
#
# timeline (alpha, 2026-08-14) is loaded the same guarded way: it is the
# plan-document surface, and a broken plan schema must not cost anyone the
# de-roping nodes. vram_lab (alpha, 2026-08-18) is the exact low-VRAM block
# executor; same rule.
for _mod in ("window_loop", "window_expand", "timeline.nodes",
             "concept_lab.nodes", "vram_lab", "derope_any", "video_out", "video_compare",
             "h3_capabilities", "h3_extend", "h3_repair", "h3_drift", "h3_color_carry",
             "h3_measure", "h3_mask_conv", "h3_core_compat"):
    try:
        _m = __import__(f"{__name__}.{_mod}", fromlist=["*"])
    except Exception as _e:                       # an alpha module must never
        print(f"[MAINodes] {_mod} not loaded: "   # take the whole pack down
              f"{type(_e).__name__}: {_e}")
        continue
    NODE_CLASS_MAPPINGS.update(getattr(_m, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(_m, "NODE_DISPLAY_NAME_MAPPINGS", {}))

for _cls in (H3ContactSheet, H3ContactSheetDecode):
    _schema = _cls.GET_SCHEMA()
    NODE_CLASS_MAPPINGS[_schema.node_id] = _cls
    if _schema.display_name is not None:
        NODE_DISPLAY_NAME_MAPPINGS[_schema.node_id] = _schema.display_name
