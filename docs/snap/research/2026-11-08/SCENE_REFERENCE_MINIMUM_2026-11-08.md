# Scene reference minimum — 2026-11-08

## READ FIRST

The latest instruction requires at least one textured top/bird's-eye and one genuine side/elevation of a known
scene; prefer two distinct informative sides. The top establishes layout and footprint; sides establish height,
proportions, architecture and occlusion. This supersedes prescriptive aerial-only-first guidance from the earlier
visual-collage experiment and geometry correction. The explicitly requested aerial-only experiment is historical
experiment scope, not the standing preparation minimum. This note makes no new claim about its rendered results.

Binding instruction: “we need the side view...for the geometry...make that mandatory at least top and at least one
side view...preferably2”.

The coordinator owns live Agent-library instructions, current experiment results and shared production notes.
This change owns canonical preparation guidance only. Existing authorized scene work covers obtaining missing
views; otherwise agents report the coverage gap without claiming a complete packet. No extra approval flow,
node/server rejection, model parameter or API change follows from this rule.

## Changes

- Added SNAP-R271 and advanced the next free ID to R272. R268 now points to this minimum instead of prescribing
  an aerial-only arm as the first new-camera step.
- Updated canonical `snap-location`, `snap-new-view`, `snap-set-design` and `snap-model-choice` skills.
- Each source picture carries its camera, role and source version. Crops of a single view do not add viewpoints.
  Conflicting geometry is resolved against authoritative originals rather than blended.
- Side geometry references may use a different camera from the requested output. Their geometry role is distinct
  from a target-camera plate's composition role. Any actual cited side frame rules out an aerial-only claim.
- Aerial + actors only remains available as an explicitly selected ablation. Matched no-aerial attribution controls
  remain useful; normal scene preparation retains side geometry references.

## Verification and progress

- 2026-11-08: Read PROJECTS, pickup, pack AGENTS, core/location/new-view/set-design/model-choice skills, current
  R268–R270, VISUAL_COLLAGE_PLAN and visual_collage_2026-11-08/AERIAL_GEOMETRY_CORRECTION. Preserved existing WIP.
- 2026-11-08: Applied the guidance change to five canonical files. Did not change core, runtime, models, live
  instructions, the measured critic prompt or production canon. No renders, downloads, commits, pushes or deletes.
- 2026-11-08: Four changed skill YAML frontmatters parse; all declared rule IDs resolve; exactly one R271
  definition exists; next ID is R272. Reviewed the scoped diff against the task baseline. Repository
  `git diff --check` passes. Changed guidance has no machine-specific absolute paths.

Sources: `VISUAL_COLLAGE_PLAN_2026-11-08.md`; `visual_collage_2026-11-08/AERIAL_GEOMETRY_CORRECTION.md`;
canonical `.claude/skills/` and `docs/snap/SNAP_RULES.md`.
