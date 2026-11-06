---
name: snap-critic
description: >
  The critic pass in Snap: judge takes, masters, sheets, plates and boards at full resolution for set logic, contact,
  attachments, intersections, cross-view and cut-to-cut continuity, then fix a flaw at its source record and re-run
  what depended on it. Use it before you call any take, picture, board or upscale good, before showing results to the
  person, after a batch of candidates lands, and whenever a flaw keeps coming back after a re-roll.
scope: [tool:judge_takes, tool:take_frames, tool:check_identity]
rules: [SNAP-R23, SNAP-R63, SNAP-R76, SNAP-R89, SNAP-R90, SNAP-R91]
---

If a Snap server is reachable, `read_skill {"name": "snap-critic"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# The critic pass, and fixing at the source

Until the critic job ships (SNAP-R89, planned U93), run this by hand on every landed take and every master, sheet,
plate and board. Every visible flaw in the first shorts was caught by the person, not by agents: three different
gates, a palisade that didn't enclose the village, a floating sword, a double wall, ghost figures in an upscale. The
causes: pictures judged one at a time, crops before frames, consistency checked but not logic.

## The checklist

1. **Whole frame at full resolution first**, crops second (`take_frames`; a tiled upscale tile by tile). A take
   called clean from 420 px thumbnails had bodies sunk into a roof and wires to nowhere.
2. **Logic, not only consistency:** does the wall enclose what it should, do roads reach gates, does each structure
   make sense from every view.
3. **Contact:** bodies meet what they rest on. **Attachments:** every wire, string, strap and sheath is held at both
   ends, per view on a sheet. **Intersections:** nothing clips.
4. **Cross-view:** every view of a location side by side and against its master (the same gate, the same wall, the
   same side of the road). Boards judged one by one passed with three different gates.
5. **Cut pairs:** the previous cut's last frame beside this cut's first: position, facing, eyeline, light, props
   (goggles on/off and a noon-to-sunset jump are invisible within one take).
6. **The right Cast only, in its state.** State the baseline before reading a face score: the identity notes' character
   score (SNAP-R111) reads the same character 0.55-0.94 and others 0.07-0.52 on our anime fixtures, below 0.45 it says
   "probably a different person"; ArcFace, shown beside it, reads a bowed profile at 0.06 and the same person relit at
   0.34-0.60. Neither decides: the head crops do (SNAP-R23, R76).
7. **Sound:** a drone needs a spectral look, not loudness.

Write each finding as a note with a severity, as a mask on the region when marks support it (SNAP-R91), and say which
record it traces to. Notes inform; they never reject (SNAP-R23).

## Fix at the source, then re-run dependents (SNAP-R90)

A re-roll keeps a flaw that lives upstream: a new seed brought the double wall back because it was in the plate; a
new plate fixed it. So:

1. Trace the flaw to its record: a location's plan, master or plate; a Cast version; the look.
2. Fix that record (a new version; propose it when it's canon).
3. Find what pinned the old version (takes, stills, boards, plates; `get_record` lists the takes that pinned a
   version) and re-run them upstream first: plates → boards → cuts, with `rerun` swaps to the new version
   (SNAP-R63). New takes land as candidates beside the old; no pick is lost.

## Measuring

- Measure long-clip drift with a looping prompt (a 3-prompt cycle that returns to its start), so same-phase segments
  compare like for like.
- Quote time as "first seed / each more seed", from `/history` (execution_start → execution_success).

## Growing the critic

Every flaw the person catches that this pass missed becomes a new checklist item and a fixture; the critic is measured
by what it catches on fixtures and by its false alarms on clean pictures.
