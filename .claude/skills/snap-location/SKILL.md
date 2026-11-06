---
name: snap-location
description: >
  Build a location in Snap that stays the same place in every shot: set plan, master establishing picture, a
  people-free H3 walkthrough, plates pulled from its frames with their camera pose, then boards placed on plates. Use
  it whenever a short, scene or shot needs a place (a village, a room, a street), when views of one place disagree
  (a gate that changes between cuts), or before making plates or boards of a set.
scope: [tool:save_location, tool:add_plate, tool:apply_location, tool:use_take, tool:draw_set_plan]
rules: [SNAP-R21, SNAP-R22, SNAP-R71, SNAP-R84, SNAP-R115, SNAP-R133, SNAP-R136]
---

If a Snap server is reachable, `read_skill {"name": "snap-location"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# A location from a walkthrough

A location is one topology (SNAP-R71, R84). Build it once, then make every view of it from that context; a text-only
render of a known place gives a new place each time (three cuts of one village gate came back as three different
gates). Tool calls are in `docs/snap/AGENT_START.md` ("A new view of a place").

## Steps

1. **Set plan:** an overhead map. Draw it in Snap (`draw_set_plan {location, shapes, cameras}`, or "Draw the plan" on
   the Location sheet, SNAP-R133): boxes, rounds, lines for roads and walls, labels; camera marks stay on the record and
   the sheet draws them as wedges, never into the plan picture (marks in the picture leak into renders that cite it).
2. **Master:** one establishing picture that shows how the parts connect (road → wall → gate → square). Run the
   critic's logic check on it now (`snap-critic`): does the wall enclose what it should, does the road reach the gate.
   A flaw here reaches every plate.
3. **Walkthrough: start it from an eye-level first frame.** The walk's camera height is set by its first frame, never
   by words ("1.6 m, never rises, never flies": 0/2; one craned over the wall, one stayed at the master's aerial pose).
   Make an eye-level still first (New view, the horizon at a standing person's eyes), check the horizon against the
   door, then `use_take {take, as: first_frame}` and `apply_location` (master + plan): under Ref2V Snap puts the First
   frame in as `<Picture 1>`, the opening frame, ahead of the master and the map (SNAP-R115), and the hint says so.
   A walk that starts from a plate instead: `apply_location {plates: [P], camera: P}` puts that plate first as
   `<Picture 1>` (the camera), the master and the map after it (F-D06).
   Run one people-free H3 Ref2V video: "camera carried at head height, dollies forward …". With the still first it
   held ~2-2.5 m 2/2 and kept the set; the same still as a pure FL2V first frame (no references) kept the height but
   invented the set (half-timbered houses, no wall).
4. **Plates:** frames of the walkthrough, each kept with its camera pose in the location record. Save them as one
   version: `add_plate {location, plates: [...], version_note}` (a version per plate makes a critic row set per plate,
   stale at once, SNAP-R136). Check each answer's `size` / `sha256` / `from` against the frame you meant: a note that
   quotes the wrong take saves the wrong picture. Keep the camera map (wedges for every walk) as `map`, not as the plan.
   Cite a frame with `use_take {take, as: reference, at}` or `{take, frame}` instead of exporting a file.
5. **Boards:** plate + people with New view (`snap-new-view`); land each cut's board in its shot.
6. **Cuts** cite their plate, the master and the Cast (`snap-boards`).

## Traps

- **Forward dollies work; turns don't.** "Turn around" / "turn right" swung the camera back to the master's aerial
  pose in 4 of 4 attempts. Make each plate with a forward dolly toward it.
- **Never cite the next place.** A reference picture of the next place on the path made H3 hard-cut to it mid-take in
  3 of 8 takes. Carry the next place by the next cut's board.
- **Wides need a foreground anchor.** "Wide, from inside the square" with the master as Picture 1 came back as the
  master's high aerial 6/6; close two-shots land at eye height every time. Give a wide something at head height in
  the foreground, or use a walkthrough plate.
- **Plate prompts describe the place only.** A plate prompt that names a character draws it: add "no figures". Say
  what is not there ("dry desert, no grass, no trees, no water"): a close-view plate grew grass and a lake 2/2.
- **Keep establishing plates people-free**, or put the people in the plate: "tiny figures" on an empty plate pop in
  mid-shot.
- **Seats and anchors belong in the plate.** Put the bench and the lantern pole in the plate, then stage "sit on the
  bench, legs and feet visible". People staged on a ledge that isn't drawn sank into the roof or got a second ledge.
- **A pose's eye height is a number you typed.** `eye_gaps` compares typed numbers, not the picture: read the horizon
  against a door before trusting either, and fix the one that's wrong (a plate typed 2 m sat at eye height).
- **Doors and windows are said from the camera** (SNAP-R22), and each camera gets 2-3 plate candidates; one orbit
  render per camera is unreliable (SNAP-R21).

## Heavier tools, only when needed

A blockout depth render per camera driving an H3 ControlNet for exact cameras; splats for a hero location that
recurs. Neither is in Snap yet.
