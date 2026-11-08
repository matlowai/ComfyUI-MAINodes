# Planning instruction update — 2026-11-08

Scope: canonical development skills for boards, the Book and locations, plus their stable design rules. No live skill
override, critic prompt, server, active take, render or publish action is part of this edit.

## Work log

- Read the workspace and pack AGENTS files, complete target skills, CODEX_PICKUP, decisions and cut1f review, and
  relevant existing rules. Existing rules already cover versioned canon, plans, camera marks, opening frames,
  reference targets and measured critic fixtures; the missing pieces are explicit sequence-level checks.
- Planned narrow additions: SNAP-R267 for state/action/look/export review; SNAP-R268 for an untested overhead-map
  workflow. IDs 254–266 remain reserved for the existing G18/G19 work.

## Verification and remaining work

Completed canonical development edits:

- `snap-boards`: fixed-landmark blocking, accepted damage, action-phase joins, hands/props, grade/detail and an open whole-sequence reflection with honest review limits.
- `snap-book`: state reconciliation includes terrain/item changes; final assembled export gets duration and sound-on splice/ending checks.
- `snap-location`: a provisional versioned overhead map with named actor marks, facing arrows/camera, clean and annotated copies, edit-only accepted changes, and a small paired trial. Direct video-reference maps remain experimental because marks and framing can leak.
- `SNAP_RULES.md`: added SNAP-R267/R268; G18/G19 ID reservations unchanged; next free unreserved ID269.

Checks: `git diff --check` passed; YAML parses for all three skills; all declared rule IDs resolve; new IDs are unique. Four canonical files changed (64 inserted lines, three rule-list lines replaced). No code/runtime/critic prompt changes or gate run needed for this documentation edit.

Not claimed: these development files are not yet the live G17a skill files; no live Agent library overrides were written by this worker. The coordinator owns the live instruction update and map experiment. The map workflow is not measured evidence of successful H3 control.

Suggested future critic delta, not applied under SNAP-R109: add persistent terrain damage and landmark/actor relations to cut-pair fixtures; add action-phase reset to join fixtures; compare grades/detail at equal playback scale without treating a motivated flash or perspective as drift. Keep measurements distinct from listening. Validate the changed critic against its existing floor and clean controls before shipping it.

Completed 2026-11-08T12:00:04-05:00. No commits, pushes, deletes, restarts or renders.

Final review clarification: explicitly named `edit_from_context` for initial overhead-map creation and later updates; grade/detail comparison now accounts for camera direction and exposure and labels the historical review as perceived mismatch. Whitespace/YAML/rule-reference checks passed again. No critic or runtime changes.

Autonomy clarification: map updates follow the production's existing canon/autonomy policy, keeping proposals where required and adding no map-specific approval step. Intended/accepted state may be maintained as work proceeds; generator errors remain findings. Whitespace/YAML/rule-reference checks passed.
