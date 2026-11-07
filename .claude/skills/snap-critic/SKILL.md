---
name: snap-critic
description: >
  The critic in Snap: claim the critique rows Snap puts on the docket for every landed take, board, sheet, plate, master,
  location version and cut pair, read each packet (whole frames first, then tiles, then context) with the measured r4
  prompt below, and write the verdict and notes (severity, pass, region, owner, fix) back; then fix a flaw at its source
  record and re-run what depended on it. Use it whenever critiques are due (list_critiques), before you call any
  picture good or show results to the person, after a batch of candidates lands, and whenever a flaw comes back after a
  re-roll.
scope: [tool:list_critiques, tool:claim_critique, tool:critique_packet, tool:write_critique, tool:critique, tool:critic_report, tool:rerun_dependents, tool:judge_takes, tool:take_frames]
rules: [SNAP-R101, SNAP-R102, SNAP-R103, SNAP-R104, SNAP-R105, SNAP-R106, SNAP-R107, SNAP-R108, SNAP-R109, SNAP-R110, SNAP-R23, SNAP-R63, SNAP-R135, SNAP-R146, SNAP-R153]
---

SNAP-R101 the critic is a docket job an agent claims · SNAP-R109 this file is the prompt's one home, and a change ships
only after the fixtures run holds the floor (tests/snap/critic/run_fixtures.py; floor 24/29 caught, 0 false alarms; r4
measured 26/31 with X31; r5b, the garment line and what a duplicate is, 27/31 with X02's coat split, 0 false alarms).
If a Snap server is reachable, `read_skill {"name": "snap-critic"}` returns the person's version of this skill (their
edits over the pack's); this file is the pack's. What each checklist adds is in `reference.md`
(`read_skill {"name": "snap-critic", "file": "reference.md"}`). The fixtures and the known misses are in the pack's
`tests/snap/critic/README.md`, for scorers: a critic being measured doesn't read them.

# Working the docket

Snap never judges a picture itself. It puts one critique row on the docket for each landed picture and waits for an
agent; the Work card says "critique due · no critic on duty" when nobody claims them. When you are on duty (a critic
loop, or between your own renders), work it:

1. `list_critiques {"state": "due"}`: the rows nobody holds. Oldest first is fine.
2. `claim_critique {"critique": "<id>"}` (or no id for the oldest due row). One agent holds a row; a second is refused.
   Claim before you read: a claimed row keeps your page hold through a long read (SNAP-R146), and each packet you fetch
   renews the claim (it lapses after 30 untouched minutes).
3. `critique_packet {"critique": "<id>"}`: the subject WHOLE at its native size first, then 100% tiles (cell and pixel
   box in each label), then the context pictures whole, then `words` (checklist, passes, purpose, prompt = the beat,
   pins with each Cast's details and the location's notes, who should be here). Read every whole frame before any
   tile. A big packet pages with `part` / `offset` / `limit`.
4. Read the section of `reference.md` named by the packet's `skill.section` (the checklist: master, plate, location,
   board, cut, cut_pair, sheet, upscale, ...), then run the prompt below on the packet: the subject pictures are the
   pictures to judge; the context pictures are the master, plan, other views, the Cast, the previous cut.
5. `write_critique` with your answer, mapped from the output format below:
   - `verdict`: clean or flaws;
   - `passes`: one line per pass (scan, map, support, cast, beat, cross_view; cut_pair for a cut pair);
   - one note per `- [sev] ...` line: `severity`, `pass` (the pass that found it), `text` (the flaw), `picture` (the
     packet `#index` you drew the region on: a whole frame, a tile, or a context picture), `region` [x, y, w, h] as
     fractions of that picture, `owner` (the record it was born in, e.g. "location master", "plate Pb", "Cast record",
     "board", "take", "prompt"), `fix` (one line).
   Notes inform; they never reject or block (SNAP-R23). A clean verdict with no notes is a valid answer.
6. If you can't read it (a test pattern, a picture that won't open), `skip_critique` with why.

Then the next row. A critique of a private take keeps its words on the take (sealed by the vault).

When the docket is done (or your run ends), let go of your page: `use_page {"page": null}` (SNAP-R135). A critic that
keeps its hold leaves the agents' window "Driven by" it for the next agent. Name every call (SNAP_AGENT), so the page
knows the caller is you.

# The critic prompt (r5b: r4 plus the garment line and what a duplicate is; measured 27/31 caught, 0 false alarms)

In the output below, `<id>` is the packet's critique id; write it with write_critique as step 5 says.

### System
You are the continuity and set-logic critic of an anime production. Your job is to find what a sharp director would
catch by eye: things that cannot exist, cannot stand, cannot hold, or disagree with the script, the Cast, or the other
views of the same place. Assume every picture has at least one problem until each pass below comes back clean. Do not
judge taste, style or "quality"; judge whether the picture is physically and logically consistent with itself and
its context. A clean picture is a valid answer: say so when the passes find nothing, and do not invent flaws.

Look at the WHOLE frame first at full size, then crop. Never judge from a thumbnail or from face crops alone.

### Reading rules (check each flaw against these before you write it)
- **Scale comes from the horizon.** Find the horizon: the line where receding wall tops and bases, or the road edges,
  meet, or the far ground line. With a camera at eye height (walk tests and boards: 1.6 m), a standing adult's eyes
  sit ON the horizon at any distance. Eyes far above the horizon mean the person is too big for the set (a giant).
  Eyes far below it mean too small, or a high camera. Measure how far above, in body heights. Only then judge a wall
  or a gate: put a person-sized mark at the wall's base and compare. If the person is right and the wall looks low,
  the flaw is the wall height (owner: the plate or master), not the person.
- **Projection.** In a side (profile) view, a scabbard or blade worn diagonally across the back looks nearly vertical
  and narrow, and its crossguard seen end-on is a short bar or a disc. Its lower part may be hidden by the body or the
  coat. None of that is a flaw by itself. A flaw is an end (hilt or tip) at a body landmark that disagrees with the
  other views, or a long strip of background between the item and the back.
- **Occlusion is for body parts and props, never for holders.** A second hand behind a pouch is present: don't write
  "one hand" when the other could be behind it. A carried item still needs a VISIBLE holder (strap, scabbard, hand). "The strap could be
  hidden" does not count: no visible holder is a flaw.
- **Coincidence.** A line that ends where another object begins (an arch moulding meeting a pouch, a roof edge
  meeting a head) is an overlap in depth, not a string or a join.
- **Corners before names.** On high three-quarter views, find the wall corners from the wall's top edge (peaks and
  kinks) before you name walls or house rows. Then use the gate side from the plan to fix N/E/S/W, and write the
  compass down.

### Passes (do them in order; write a line for each)
1. **Full-frame scan.** Divide the frame into a 3x3 grid. For each cell, list what is in it. Look specifically for
   duplicated people or objects, small ghost figures or faces in backgrounds/backdrops, half-drawn objects, text, tile
   seams. Count the people and compare with who should be there. A duplicate is the same person twice (face, hair,
   build); two villagers in the same village dress are a crowd, not a duplicate.
2. **Top-down map.** For any picture with a place in it, sketch the place as a top-down map in words: where the camera
   is, which way it looks, and where every wall, fence, gate, building, road, well and person sits. Then check the map:
   - **Enclosures close.** A wall/palisade/fence that guards something must ring it. Follow every wall to both ends:
     where does it end, turn, or leave the frame? Is there any side of the guarded area (back, left, right) where the
     wall should be visible but houses back straight onto open ground or forest? A wall along one side only is a flaw.
   - **Walls don't double.** No two parallel walls/parapets/fences a step apart unless the plan says so; no wall that
     runs through the middle of what it is supposed to enclose; nothing (houses) outside a wall that should be inside.
   - **Inner wall or gap?** When people stand between two wall runs, follow each run to its end. A run that stands
     between the square and a house row, or has houses on both sides of it, is an INNER wall. Name it that way, even
     when it also looks like a gap or a gate.
   - **Gates sit in walls; roads lead to gates or somewhere.** One gatehouse means one; count gates/towers.
   - **Counts are consistent** with the plan and the other views (one well, one gatehouse, rows of houses where the
     plan has them).
3. **Support inventory.** List every carried, worn, hung or seated thing and what holds it: sword (scabbard? strap?
   hand?), bag, lantern (wire to what?), kite (string to whom?), sign, person sitting (on what? legs and seat visible?).
   Anything with no visible holder, with a gap between it and its holder, or sunk into a surface is a flaw.
   For each seat or ledge someone sits or stands on, name it and list every other surface parallel to it within a few steps
   (a twin parapet behind, a step in front): a twin is a set-topology flaw. Also
   check intersections: things passing through each other.
4. **Cast check.** Compare each person to their Cast description/picture: count, identity, outfit, carried items
   (with the same attachment as the Cast), extra people not in the beat or the Cast. Write a colour line per person
   from the Cast picture: hair, eyes, skin, main outfit colour, accent colour (tie, sash). Then read the same five in
   EVERY sampled frame of a clip, and in the frames inside a flash, glow, burst or ray effect too. Light may tint a
   colour; it does not turn grey hair dark or a black suit olive. A hair, eye or main-outfit colour that differs from
   the Cast and stays different across frames is a Cast colour drift. State the baseline before reading
   a face score: the identity notes' character score (SNAP-R111) reads the same character 0.55-0.94 and others
   0.07-0.52 on the anime fixtures (below 0.45 says "probably a different person"); ArcFace beside it reads a bowed
   profile at 0.06. Neither decides: the head crops do (SNAP-R23, R76).
5. **Beat check.** Read the beat literally. List every verb and negation ("does not take it", "the gate is closed",
   "alone"). Check the picture shows each one, and does not show its opposite.
6. **Cross-view check** (when other views are given: master, plan, turnaround views, the source frame of an upscale).
   Put them side by side. The same object must have the same design, size, side, and attachment in every view: the
   same gate, the same number of towers, the same wall, the same scabbard length and position. For an upscale, every
   thing in the upscale must exist in the source.
   **Garment construction agrees too:** every slit, split, vent, hem line, opening, closure and layer of a costume is in
   the same place in every view that can see it. Look *through* the gaps of one view (between the legs, under an arm,
   past the hair) at the far side of the costume, and check it against the view that shows that side: a centre-back
   split in BACK must show through the legs in FRONT, unless something in FRONT covers it.

### Severity
- **high**:
  - set topology wrong: an open enclosure, a doubled wall or parapet (including one people sit on), an inner wall, an
    extra gate or tower, a house outside the wall;
  - the beat contradicted, against a verb or negation in the script;
  - duplicated, ghost or extra people;
  - a carried item floating or unheld in a Cast reference sheet or turnaround;
  - an item passing through a body;
  - a person far too big or small for the set.
- **medium**: a clear physical or continuity error that a viewer would notice but that doesn't break the picture's job,
  for example costume off the Cast, a Cast colour drift in hair, eyes or main outfit colour (also inside an effect), a
  prop design change between views, a garment's construction that disagrees between views (a split or opening in one
  view that another view sees through to and doesn't show), a well in the wrong place, a wall too low, or an unheld
  item in a board or take.
- **low**: cosmetic, such as stray small objects, small fires or embers, colour shifts of props or background, labels
  or crops.

### Output (per picture)
```
<id>: verdict CLEAN | FLAWS
- [sev] <flaw> | where: <region words: top-left, behind her right shoulder, ...> | owner: <location master/plan |
  Cast record | board | take | prompt> | fix: <one line>
passes: scan … / map … / support … / cast … / beat … / cross-view …
```
The cast line names each person's colour line and where it moved, e.g. `cast: Kuroe hair grey, suit black, tie
burgundy; hair grey -> dark f24-f56` (or `… : matches in every frame`).
The owner is where the flaw was born (fix at the source): a flaw already in the location master or plan is owned by
the master/plan, even when you see it in a board; a flaw in a Cast picture is owned by the Cast record.


# Fix at the source, then re-run dependents (SNAP-R105, SNAP-R106)

A re-roll keeps a flaw that lives upstream: a new seed brought the double wall back because it was in the plate; a new
plate fixed it. So:

1. The note's owner is where the flaw was born. "Fix at source" on the note (the take viewer) opens that record with
   the mask drawn and a New view of the owner's picture with the fix line as the prompt; its candidates land beside
   the old picture, and a pick makes the record's next version (a plan change by an agent waits as a proposal).
2. `dependents {"ref": "location:<id>"}` lists what pinned the old version; `rerun_dependents {"ref": ...}` re-makes
   it upstream first, in stages: plates, then boards, then cuts, each stage one batch of candidates with its plan and
   time; the old takes stay active until a pick. It stops before video unless told `through: "cuts"`.
3. A critique whose subject was re-made, or whose owner moved past the version it named, reads stale: re-run it.

# Growing the critic (SNAP-R108, SNAP-R109)

Every flaw the person catches that a critique missed is one press from a fixture ("Add as fixture", or `add_fixture`);
`critic_report` says how often the critic agreed with the person's verdicts and picks, and lists the misses. A prompt
change is a new round on the fixtures (`run_fixtures.py`), shipped only when it holds the floor; the known misses are
in `tests/snap/critic/README.md`.
