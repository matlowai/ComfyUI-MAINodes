"""The plan document: SEMANTIC INTENT ONLY.

PLAN VERSION 0 IS EXPERIMENTAL. It will change shape without a migration
path until it is declared stable; anything persisted against it should be
regarded as a fixture, not as an archive. tests/fixtures/ holds
representative plans + artifacts precisely so a future v1 can be shown to
migrate them.

A plan says what the shot should look like. It never says how a particular
video model gets there. No hold maps, no 17n+5, no token indices, no guide
frame numbers live in the semantic fields — those are backend output and
live in the separate `compiled` cache, which is a CACHE and is never read
back as intent (architecture amendment, 2026-08-14 night).

Stdlib only, on purpose: this module must import with no torch, no numpy,
no comfy, no UI. Both frontends (the ComfyUI widget and the web DAW) and
the compiler read the same file through it.

    plan = new_plan("/path/clip.mp4", frames=124, fps=24, width=1152, height=640)
    plan["lanes"].append(generation_density_lane([[0, 1.0], [70, 2.5], [123, 2.5]]))
    validate_or_raise(plan)

Schema v0
---------
{
  "plan_version": 0,
  "id": "uuid",             # stable identity across edits
  "revision": 3,            # bumped by every semantic edit
  "clip":   {"path", "frames", "fps", "width", "height"},
  "lanes":  [ {"id", "type", "enabled", "proposer", ...} ],
  "settings": {"intent": {...}, "constraints": {...},
               "execution_preferences": {...}, "delivery": {...}},
  "provenance": {"proposed_by", "edited", "created", "history": [...]},
  "compiled": {"<backend_id>": {"fingerprint", "artifact", "receipt", ...}}
}

THE UNIT (review round 3, item 1). The density lane's y-axis is TEMPORAL
GENERATION DENSITY: how many generated frames to spend per world frame.
It is NOT playback speed. The recovery step puts the clip back on the
world clock, so a 2x density clip is the same length and the same speed as
its source — it was simply generated with twice the frames underneath, so
fast motion has somewhere to live. Two sibling fields are RESERVED BY NAME
and deliberately not implemented:
  - presentation_map: editorial retime. THIS one makes the output longer or
    slower (ramps, slow-mo as a look).
  - action_rate: how fast the depicted action is, semantically ("he walks
    slower"), which is a content instruction, not a sampling instruction.
Keeping the three apart is the whole reason the lane is named for density.

Identity (review round 3, items 2-4): every semantic object carries an id;
the semantic half of the document hashes to a semantic_hash that excludes
the compiled cache, timestamps and paths; and a compiled section is keyed
by a FINGERPRINT over that hash plus the backend/spec/recipe/compiler
versions, split into a byte-stable ARTIFACT and a machine-specific
RECEIPT.

Lane types in v0: "generation_density" is the only one the H3 backend
compiles. The others are accepted, validated and round-tripped so a UI can
draw them and T2+ can compile them; the compiler refuses them by name
rather than ignoring them silently.
"""
import copy
import hashlib
import json
import os
import time
import uuid

PLAN_VERSION = 0
PLAN_VERSION_STATUS = "EXPERIMENTAL"

# "temporal" was this lane's name for about two hours on 2026-08-14 and is
# accepted as a legacy alias so plans written in that window still load.
LANE_TYPE_ALIASES = {"temporal": "generation_density"}

LANE_TYPES = ("generation_density", "regional_refine", "pin", "refs",
              "continuation")

# RESERVED, NOT IMPLEMENTED: see the module docstring. Named here so nobody
# quietly overloads the density lane with either meaning.
RESERVED_LANE_TYPES = ("presentation_map", "action_rate")

# TrackedRegion source kinds (amendment 2, item 4). The DEFINITION of a
# region (how it was found) is separate from its TRAJECTORY (where it is
# over time) so the tracker is replaceable without touching the plan's
# meaning; the conditioning block applies to the trajectory.
REGION_SOURCE_KINDS = ("box", "mask", "query", "manual")

# What to do when a length is not audio-exact (review round 3, item 6).
# Only exact_trim is implemented; the rest are named so the decision is a
# CHOICE in the plan rather than a hard refusal buried in a backend.
SYNC_POLICIES = ("exact_trim",        # implemented: cut to the exact length
                 "pad",               # TODO(T2)
                 "resample",          # TODO(T2)
                 "conform_at_end")    # TODO(T2)

# Semantic settings, in four named groups (review round 3, item 5). The
# split is the point: seed and steps are EXECUTION, never intent, and a UI
# that shows "intent" to an artist and "execution_preferences" to an
# operator is reading the same file.
SETTING_GROUPS = ("intent", "constraints", "execution_preferences", "delivery")

SETTINGS_DEFAULTS = {
    "intent": {
        # 0..1 — how much of the denoise schedule the regeneration gets. A
        # statement about how much of the source survives, so: intent.
        "regen_strength": 0.45,
        "prompt": "",
        # intent: an expansion must not drop back to real time before the
        # clip ends. How that is achieved is the backend's problem.
        "hold_expansion_to_clip_end": True,
    },
    "constraints": {
        # budget, in SECONDS of generated material per pass. The compiler
        # may pick geometry to fit it (spec: recommendation = compilation
        # policy). 0 = no cap, one pass.
        "max_regen_seconds": 0.0,
        # seconds of untouched context kept either side of a regenerated span
        "context_seconds": 0.5,
    },
    "execution_preferences": {
        "seed": 0,
        "steps": 25,
        # the always-reachable advanced drawer, keyed by backend id
        "backend": {},
    },
    "delivery": {
        "output_prefix": "video/timeline",
        "sync_policy": "exact_trim",
    },
}

SETTING_GROUP_OF = {k: g for g, d in SETTINGS_DEFAULTS.items() for k in d}


class PlanError(ValueError):
    """A plan that cannot be trusted as intent."""


def new_id():
    return uuid.uuid4().hex


# ---------------------------------------------------------------- building

def _blank_settings():
    return {g: dict(d) for g, d in SETTINGS_DEFAULTS.items()}


def new_plan(path, frames, fps=24.0, width=None, height=None,
             proposed_by="human", settings=None):
    plan = {
        "plan_version": PLAN_VERSION,
        "id": new_id(),
        "revision": 0,
        "clip": {"path": str(path), "frames": int(frames), "fps": float(fps),
                 "width": None if width is None else int(width),
                 "height": None if height is None else int(height)},
        "lanes": [],
        "settings": _blank_settings(),
        "provenance": {"proposed_by": str(proposed_by), "edited": False,
                       "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
                       "history": []},
        "compiled": {},
    }
    for k, v in (settings or {}).items():
        set_setting(plan, k, v)
    return plan


def generation_density_lane(envelope, ceiling=4.0, proposer="human",
                            enabled=True, lane_id=None):
    """The generation-density lane.

    y-axis = TEMPORAL GENERATION DENSITY in generated frames per world
    frame (operator ruling 2026-08-14 night, named per review round 3):
    1.0 = one generated frame per world frame, 2.5 = two and a half. The
    result is NOT slower or longer — recovery returns the world clock — it
    is the same shot generated with more frames underneath the motion.

    Fractional values are legal here; hitting a drawn average with integer
    per-frame holds is the compiler's job, not the plan's.

    ceiling: the lane's user-settable top end (default view range 1-4x,
    resizable to 8x or beyond — the price meter is what makes that safe).
    """
    return {"id": lane_id or new_id(), "type": "generation_density",
            "enabled": bool(enabled), "proposer": str(proposer),
            "ceiling": float(ceiling),
            "envelope": [[int(f), float(r)] for f, r in envelope]}


# Legacy alias: same object, old name. Kept for one release.
temporal_lane = generation_density_lane


def pin_lane(frame, image=None, authority=1.0, enabled=True, lane_id=None):
    return {"id": lane_id or new_id(), "type": "pin", "enabled": bool(enabled),
            "frame": int(frame), "image": image, "authority": float(authority)}


def tracked_region(source, trajectory=None, conditioning=None, region_id=None):
    """A TrackedRegion (amendment 2, item 4). SHAPE IS FROZEN IN v0;
    NO COMPILER SUPPORT YET (TODO T4).

    source:     {"kind": one of REGION_SOURCE_KINDS, ...kind-specific...}
                box   -> {"box": [x, y, w, h]} normalized 0..1
                mask  -> {"mask": path}
                query -> {"query": "face of the woman in blue"}  (SAM3 etc)
                manual-> {"note": "..."}
    trajectory: [{"frame": int, "x","y","w","h": 0..1 floats,
                  "mask": path or null}, ...] — REPLACEABLE: whoever
                tracked it is recorded in source, not baked into the path.
    conditioning: how the trajectory is turned into guidance. Lane
                invariant 1 (FaceRefine study): float-precision boxes,
                sub-pixel warps, and SIZE SMOOTHED HARDER THAN POSITION
                (their measured jerk 0.58 -> 0.06), hence the asymmetric
                defaults. Lane invariant 2: two radii, never one.
    """
    cond = {"position_smoothing": 0.30, "scale_smoothing": 0.60,
            "feather": 0.02, "context_radius": 0.25, "paste_radius": 0.10}
    cond.update(conditioning or {})
    return {"id": region_id or new_id(), "source": dict(source),
            "trajectory": list(trajectory or []), "conditioning": cond}


def _validate_region(where, region):
    p = []
    if not isinstance(region, dict):
        return [f"{where}: region is not an object"]
    if not region.get("id"):
        p.append(f"{where}: region has no id")
    src = region.get("source")
    if not isinstance(src, dict):
        p.append(f"{where}: region.source missing")
    elif src.get("kind") not in REGION_SOURCE_KINDS:
        p.append(f"{where}: region.source.kind {src.get('kind')!r} unknown "
                 f"(known: {', '.join(REGION_SOURCE_KINDS)})")
    traj = region.get("trajectory", [])
    if not isinstance(traj, list):
        p.append(f"{where}: region.trajectory is not a list")
        traj = []
    last = None
    for i, k in enumerate(traj):
        if not isinstance(k, dict) or "frame" not in k:
            p.append(f"{where}: trajectory[{i}] needs a frame")
            continue
        if last is not None and int(k["frame"]) < last:
            p.append(f"{where}: trajectory[{i}] frame goes backwards")
        last = int(k["frame"])
        for a in ("x", "y", "w", "h"):
            if a in k and not (-1.0 <= float(k[a]) <= 2.0):
                p.append(f"{where}: trajectory[{i}].{a}={k[a]} is not a "
                         "normalized 0..1 coordinate")
    c = region.get("conditioning", {})
    if not isinstance(c, dict):
        p.append(f"{where}: region.conditioning is not an object")
    elif float(c.get("paste_radius", 0)) > float(c.get("context_radius", 1)):
        p.append(f"{where}: paste_radius > context_radius — the model would "
                 "composite back more than it saw (lane invariant 2)")
    return p


def sample_envelope(envelope, frame):
    """Piecewise-linear read of an envelope at one frame; flat outside the
    control points. Pure arithmetic so both UIs and the compiler agree."""
    if not envelope:
        return 1.0
    if frame <= envelope[0][0]:
        return float(envelope[0][1])
    if frame >= envelope[-1][0]:
        return float(envelope[-1][1])
    for (f0, r0), (f1, r1) in zip(envelope, envelope[1:]):
        if f0 <= frame <= f1:
            if f1 == f0:
                return float(r1)
            w = (frame - f0) / float(f1 - f0)
            return float(r0) + w * (float(r1) - float(r0))
    return float(envelope[-1][1])


def envelope_per_frame(envelope, frames):
    return [sample_envelope(envelope, f) for f in range(int(frames))]


def lane_type(lane):
    t = lane.get("type")
    return LANE_TYPE_ALIASES.get(t, t)


def density_lanes(plan):
    return [l for l in plan.get("lanes", [])
            if lane_type(l) == "generation_density" and l.get("enabled", True)]


# Legacy alias for one release.
temporal_lanes = density_lanes


# --------------------------------------------------------------- settings

def setting(plan, key, default=None):
    """Read a semantic setting by name, whatever group it lives in. Also
    accepts a pre-grouping flat settings block, so old plans still load."""
    s = plan.get("settings", {}) or {}
    g = SETTING_GROUP_OF.get(key)
    if g and isinstance(s.get(g), dict) and key in s[g]:
        return s[g][key]
    if key in s and not isinstance(s.get(key), dict):        # legacy flat
        return s[key]
    if g:
        return SETTINGS_DEFAULTS[g].get(key, default)
    return default


def set_setting(plan, key, value):
    g = SETTING_GROUP_OF.get(key)
    s = plan.setdefault("settings", _blank_settings())
    if g is None:
        s[key] = value                    # unknown key: kept, not silently lost
        return plan
    s.setdefault(g, {})[key] = value
    return plan


def backend_settings(plan, backend_id):
    """The always-reachable advanced drawer for one backend. Semantic code
    must never read this; only that backend may."""
    return dict((setting(plan, "backend", {}) or {}).get(backend_id, {}))


# -------------------------------------------------------------- validation

def validate(plan):
    """-> list of human-readable problems ([] means the plan is usable)."""
    p = []
    if not isinstance(plan, dict):
        return ["plan is not a JSON object"]
    v = plan.get("plan_version")
    if v is None:
        p.append("no plan_version")
    elif int(v) > PLAN_VERSION:
        p.append(f"plan_version {v} is newer than this build ({PLAN_VERSION})")
    if not plan.get("id"):
        p.append("no plan id (stable identity is required for derivation links)")
    if int(plan.get("revision", -1)) < 0:
        p.append("revision must be >= 0")

    clip = plan.get("clip")
    if not isinstance(clip, dict):
        p.append("no clip block")
        clip, frames = {}, 0
    else:
        frames = int(clip.get("frames") or 0)
        if frames <= 0:
            p.append("clip.frames must be > 0")
        if float(clip.get("fps") or 0) <= 0:
            p.append("clip.fps must be > 0")
        for k in ("width", "height"):
            if clip.get(k) is not None and int(clip[k]) <= 0:
                p.append(f"clip.{k} must be > 0 or null")

    lanes = plan.get("lanes")
    if not isinstance(lanes, list):
        p.append("lanes is not a list")
        lanes = []
    seen = set()
    for i, lane in enumerate(lanes):
        p += _validate_lane(i, lane, frames)
        lid = isinstance(lane, dict) and lane.get("id")
        if lid:
            if lid in seen:
                p.append(f"lane {i}: duplicate lane id {lid}")
            seen.add(lid)

    s = plan.get("settings")
    if not isinstance(s, dict):
        p.append("settings is not an object")
    else:
        for g in SETTING_GROUPS:
            if g in s and not isinstance(s[g], dict):
                p.append(f"settings.{g} must be an object")
        r = setting(plan, "regen_strength")
        if not (0.0 <= float(r) <= 1.0):
            p.append(f"settings.intent.regen_strength {r} outside 0..1")
        if int(setting(plan, "steps") or 1) < 1:
            p.append("settings.execution_preferences.steps must be >= 1")
        if float(setting(plan, "max_regen_seconds") or 0) < 0:
            p.append("settings.constraints.max_regen_seconds must be >= 0")
        if not isinstance(setting(plan, "backend", {}), dict):
            p.append("settings.execution_preferences.backend must be an "
                     "object keyed by backend id")
        sp = setting(plan, "sync_policy")
        if sp not in SYNC_POLICIES:
            p.append(f"settings.delivery.sync_policy {sp!r} unknown "
                     f"(known: {', '.join(SYNC_POLICIES)})")

    c = plan.get("compiled", {})
    if not isinstance(c, dict):
        p.append("compiled must be an object keyed by backend id")
    # The one structural rule that keeps the seam honest: no backend-shaped
    # artifact may appear in the semantic half of the document.
    for stray in ("hold_map", "compiled_hold_map", "holds", "frame_idx",
                  "dilated_frames", "token_count"):
        for i, lane in enumerate(lanes if isinstance(lanes, list) else []):
            if isinstance(lane, dict) and stray in lane:
                p.append(f"lane {i} carries backend artifact '{stray}' — "
                         f"compiled output belongs in plan['compiled']")
        if isinstance(s, dict) and stray in s:
            p.append(f"settings carries backend artifact '{stray}'")
    return p


def _validate_lane(i, lane, frames):
    p = []
    if not isinstance(lane, dict):
        return [f"lane {i} is not an object"]
    if not lane.get("id"):
        p.append(f"lane {i}: no id (every semantic object carries one)")
    t = lane_type(lane)
    if t in RESERVED_LANE_TYPES:
        return p + [f"lane {i}: type {t!r} is RESERVED and not implemented "
                    "(see the module docstring: density vs presentation vs "
                    "action rate)"]
    if t not in LANE_TYPES:
        return p + [f"lane {i}: unknown type {lane.get('type')!r} "
                    f"(known: {', '.join(LANE_TYPES)})"]
    if t == "regional_refine":
        return p + _validate_region(f"lane {i} (regional_refine)",
                                    lane.get("region", {}))
    if t == "pin":
        if not (0 <= int(lane.get("frame", -1)) < max(frames, 1)):
            p.append(f"lane {i} (pin): frame {lane.get('frame')} outside the clip")
        a = float(lane.get("authority", 1.0))
        if not (0.0 <= a <= 1.0):
            p.append(f"lane {i} (pin): authority {a} outside 0..1")
        return p
    if t != "generation_density":
        return p                       # v0 validates shape only for the rest
    env = lane.get("envelope")
    if not isinstance(env, list) or not env:
        return p + [f"lane {i} (generation_density): envelope is empty"]
    ceiling = float(lane.get("ceiling", 4.0))
    if ceiling < 1.0:
        p.append(f"lane {i}: ceiling {ceiling} < 1.0")
    last = None
    for j, pt in enumerate(env):
        if not (isinstance(pt, (list, tuple)) and len(pt) == 2):
            p.append(f"lane {i} point {j}: want [frame, density]")
            continue
        f, r = int(pt[0]), float(pt[1])
        if last is not None and f < last:
            p.append(f"lane {i} point {j}: frame {f} goes backwards (after {last})")
        last = f
        if f < 0 or (frames and f > frames - 1):
            p.append(f"lane {i} point {j}: frame {f} outside 0..{frames - 1}")
        if r < 1.0:
            p.append(f"lane {i} point {j}: density {r} < 1.0 (1.0 is one "
                     "generated frame per world frame; the density lane "
                     "cannot generate less than the source)")
        if r > ceiling + 1e-9:
            p.append(f"lane {i} point {j}: density {r} above the lane ceiling "
                     f"{ceiling} — raise the ceiling if you meant it")
    return p


def validate_or_raise(plan):
    p = validate(plan)
    if p:
        raise PlanError("; ".join(p))
    return plan


# --------------------------------------------------------- semantic hash

# Keys stripped before hashing: machine-specific or time-specific, so two
# copies of the same intent on two boxes hash the same.
_HASH_STRIP_KEYS = ("path", "mask", "image", "output_prefix", "created",
                    "compiled_at", "at")


def _canonical(obj):
    if isinstance(obj, dict):
        return {k: _canonical(v) for k, v in sorted(obj.items())
                if k not in _HASH_STRIP_KEYS and not k.endswith("_path")}
    if isinstance(obj, (list, tuple)):
        return [_canonical(v) for v in obj]
    if isinstance(obj, float) and obj == int(obj):
        return int(obj)                      # 2 and 2.0 are the same intent
    return obj


def semantic_view(plan):
    """The semantic half of the document, canonicalized: no compiled cache,
    no provenance/history, no timestamps, no paths."""
    clip = dict(plan.get("clip") or {})
    return _canonical({
        "plan_version": plan.get("plan_version"),
        "id": plan.get("id"),
        "clip": {k: clip.get(k) for k in ("frames", "fps", "width", "height")},
        "lanes": plan.get("lanes") or [],
        "settings": plan.get("settings") or {},
    })


def semantic_hash(plan):
    """Content identity of the intent. A hand-edited JSON changes this even
    when the editor forgot to bump the revision (review round 3, item 2)."""
    blob = json.dumps(semantic_view(plan), sort_keys=True,
                      separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


def fingerprint(sem_hash, backend_id, versions):
    """The cache key for a compiled artifact: the intent plus everything
    that turns intent into an execution."""
    v = versions or {}
    parts = [sem_hash, str(backend_id)] + [
        f"{k}={v[k]}" for k in sorted(v)]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


# ------------------------------------------------------------------ io/cache

def save(plan, path):
    path = os.path.abspath(path)
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, indent=1, sort_keys=False)
    return path


def load(path, migrate_in_place=True):
    with open(path, encoding="utf-8-sig") as fh:
        plan = json.load(fh)
    return migrate(plan) if migrate_in_place else plan


def migrate(plan):
    """Bring an older v0 document up to the current v0 shape, in memory.

    v0 IS EXPERIMENTAL and moved twice on 2026-08-14: the density lane was
    briefly called "temporal", settings were flat before they were grouped,
    and semantic objects did not carry ids. All three are mechanical, so a
    plan written that morning still opens. It does NOT bump the revision:
    migration is not an edit to the artist's intent.

    Note that filling in a missing id CHANGES the semantic hash, which is
    correct — an object that had no identity is not the same document as one
    that has it — so a migrated plan recompiles rather than trusting a cache
    keyed to the old shape.
    """
    if not isinstance(plan, dict):
        return plan
    plan.setdefault("id", new_id())
    plan.setdefault("revision", 0)
    for lane in plan.get("lanes") or []:
        if not isinstance(lane, dict):
            continue
        lane.setdefault("id", new_id())
        t = lane.get("type")
        if t in LANE_TYPE_ALIASES:
            lane["type"] = LANE_TYPE_ALIASES[t]
        region = lane.get("region")
        if isinstance(region, dict):
            region.setdefault("id", new_id())
    s = plan.get("settings")
    if isinstance(s, dict) and not any(g in s for g in SETTING_GROUPS):
        flat, plan["settings"] = dict(s), _blank_settings()
        for k, v in flat.items():
            set_setting(plan, k, v)
    return plan


def put_compiled(plan, backend_id, artifact, receipt=None, versions=None):
    """Store one backend's compiled output, SPLIT IN TWO (review round 3,
    item 4):

      artifact — DETERMINISTIC. Hold maps, window geometry, token counts.
                 Byte-identical for identical inputs: no timestamps, no
                 machine paths, nothing that varies run to run. This is the
                 thing worth caching, diffing and sharing.
      receipt  — the run's circumstances: when, on what, with what warnings,
                 where the graph was written, what it was priced at.

    Both are a CACHE. A plan whose `compiled` block is deleted is the same
    plan, and re-compiling must reproduce the artifact exactly.
    """
    versions = dict(versions or {})
    sem = semantic_hash(plan)
    section = {
        "fingerprint": fingerprint(sem, backend_id, versions),
        "backend": str(backend_id),
        "versions": versions,
        "semantic_hash": sem,
        "derived_from": {"plan_id": plan.get("id"),
                         "revision": int(plan.get("revision", 0)),
                         "semantic_hash": sem},
        "artifact": copy.deepcopy(artifact),
        "receipt": dict(receipt or {}),
    }
    section["receipt"].setdefault("compiled_at",
                                  time.strftime("%Y-%m-%dT%H:%M:%S"))
    plan.setdefault("compiled", {})[str(backend_id)] = section
    return plan


def get_compiled(plan, backend_id):
    return (plan.get("compiled") or {}).get(str(backend_id))


def compiled_is_stale(plan, backend_id):
    """True when the compiled cache no longer describes this plan.

    Checks the revision AND the semantic hash: a hand-edited JSON that
    forgot to bump the revision must still invalidate."""
    c = get_compiled(plan, backend_id)
    if not c:
        return True
    d = c.get("derived_from") or {}
    if d.get("plan_id") != plan.get("id"):
        return True
    if int(d.get("revision", -1)) != int(plan.get("revision", 0)):
        return True
    return d.get("semantic_hash") != semantic_hash(plan)


def note_edit(plan, who, what):
    """A SEMANTIC edit: bumps the revision (so every compiled section can be
    told apart from the one before it) and appends to the history. Both
    oracle proposals and human edits are retained — spec: every reviewed
    plan is labelled training data for the gaze-policy thread."""
    plan["revision"] = int(plan.get("revision", 0)) + 1
    prov = plan.setdefault("provenance", {})
    prov["edited"] = True
    prov.setdefault("history", []).append(
        {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "who": str(who),
         "what": str(what), "revision": plan["revision"]})
    return plan
