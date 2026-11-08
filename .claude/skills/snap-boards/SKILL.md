---
name: snap-boards
description: >
  Plan a short or scene in Snap the way a studio does: design lane first, then one board per cut, an animatic and
  cut-pair checks, and only then video cuts rendered from approved boards, with the H3 prompt craft for style and
  sound. Use it whenever you make a short, a scene with several cuts, a trailer, or any multi-shot video in Snap, or
  when cuts don't connect (wrong positions, jumps in light, weak climax).
scope: [tool:run, tool:compile_shot, tool:make_board, tool:set_board, tool:animatic]
rules: [SNAP-R36, SNAP-R67, SNAP-R131, SNAP-R132, SNAP-R185, SNAP-R189, SNAP-R190, SNAP-R191, SNAP-R197, SNAP-R200, SNAP-R267, SNAP-R268]
---

If a Snap server is reachable, `read_skill {"name": "snap-boards"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# Boards and animatic before video

Order of work: design lane → boards → animatic → approval → video. Blocking, framing, transitions, scale and intensity
are solved on boards, where a fix costs seconds. Agents left alone make cuts as islands: faces held, but transitions,
framing and blocking didn't. In a Book (`snap-book`) each cut holds its board: `make_board` makes candidates from the
cut's context, `set_board` picks and approves one, `animatic` plays them in telling order, and `apply_unit` opens the
cut's video on its approved board (SNAP-R131). Outside a Book, boards are takes in each cut's shot.

## 1. Design lane

Character sheets (`snap-turnaround`), locations and plates (`snap-location`), voices (`snap-voice`). H3 Ref2V copies a
flat 2D sheet's style faithfully (2/2), so the look is decided here, not in the video prompt. Make original
characters, names, designs and settings; homage stays at genre level (no copied scenes, shots, designs or logos).

## 2. Boards

One board per cut, made with New view on the cut's plate (`snap-new-view`) and landed in the cut's shot:
- camera and lens; who stands where, facing which way (carried from the previous cut's end);
- scale drawn, not worded: tiny people beside the big thing, low angle, wide lens;
- the planned transition to the next cut: match on action, eyeline, screen direction, the 180° line;
- the beat's intensity, by the genre's playbook (a climax stands and delivers; horror holds).

Keep positions relative to fixed landmarks, not just to the frame (SNAP-R268): a floor circle does not move under the
actors when the camera changes. Use the location's plan and stable marks for each actor's position and facing; the
provisional overhead-map workflow is in `snap-location`. Carry only accepted damage and prop placements into the
next board. A render's accidental crack is a proposed state change, not automatically a new fact.

An insert or close-up cites a frame of its master shot (SNAP-R236; the operator: "take a frame of the blocking as a
reference"): `set_unit {master: {cut: "C8", at_s: 1.92, crop: [0.5, 0, 0.5, 1]}}` makes that frame of C8's active
take the board's nearest prior view and a continuity picture in the video's References, so light, palm, robe and
background match (seq02's sweat-drop insert from frame 46 of the clash scored 0.55-0.58 against 0.51 without).

Re-boarding from a fixed board (G10, short05 C2):
- Pick a board candidate with `set_board`, never `apply_candidate`: in a cut's shot a still is a board, and the cut's
  active take stays its video (SNAP-R185).
- The context board's props come back whatever the compile says (the ladle returned from the context, 2/2). The board
  prompt now says each thing the state takes away is absent even where a picture shows it (SNAP-R189), but the
  cheapest sure fix is a context that already agrees: edit it at the source first, every field it differs on.
- To change one detail of a board (the eyewear), edit a crop and paste it back (`edit_from_context {paste_back: true}`,
  SNAP-R190): a whole-board edit with the Cast's front picture turned a face that looked away from camera (2/2).
- Prefer the region edit for any face-area change (F-U02): whole-picture edits turned a face that looked away 4/4 over
  two tries, with or without the Cast's front picture. Crop only what changes (a whole-head crop turned the head 2/2; an
  eye crop kept it 2/2), and past where a thin thing crossing the crop ends (the monocle's chain broke at an eye crop's
  bottom edge). Read each candidate's seam note; on "seam breaks", edit again with its `crop_to_try` or a crop set where
  the thing ends (SNAP-R191), and read the note again: a redraw can make the thing longer. On C2 key s9221 the eye crop
  broke 2/2, crop_to_try still broke 2/2 (the new chain hung lower), and a crop down to the lapel held 2/2 with the head
  kept in all six.
- **The face-area recipe** (short05 C2's monocle on a head turned away, four tries, 12 candidates; dogfood F-W11). All
  four parts were needed: dropping 2 or 3 turned the face, dropping 4 drew the lens face-on.
  1. a region edit (`paste_back: true`), so nothing outside the box can move;
  2. a crop that takes in the back of the head and runs past the thing to where it ends (the lapel for a chain): a
     narrow crop that starts at the ear shows the model only cheek and jaw, and it draws a face there;
  3. the head's direction named in the prompt ("his head stays turned away from camera, back three-quarter");
  4. the item's angle from this camera named ("the lens seen nearly edge-on from behind: a narrow gold ellipse").
  The seed still decides the angle (1/2 with all four): make 2-3 and read each.
- `crop_to_try` now reaches one and a half crops past a side that breaks (G12): on s9221 half again broke 2/2 and the
  crop that held ran to the lapel, about 1.5 crops further. `nearby {ref}` on a board says what it is and where it came
  from (a still, or a frame of a video take) before you edit or reuse it (SNAP-R197).
- **When seeds keep failing, change the approach, not the seed** (SNAP-R200). Two or three failed seeds of one recipe
  stop it: step up to the wording, then the references or crop, then the method, then the source record (a flaw in the
  Cast picture is fixed there), then a missing Snap capability; try a few different approaches side by side before
  asking. Only a taste choice between working results goes to the person.
- A flaw born in the Cast picture itself is fixed there, not in every board: a region edit of the Cast picture, then
  `use_take {as: "cast", replace: n, propose: true}` (SNAP-R196), then rerun_dependents. When words don't move the
  flaw, give a settei of the item alone as Picture 2 (F-Y02), or remove the whole item and add it back from that settei
  (F-Y03); when the picture also needs a bigger redraw, redraw first and region-edit last (F-Y06): `snap-new-view`.

## 3. Animatic and checks

Time the boards in order (`animatic {book}`: each board held for its cut's seconds; a kept take replaces its board). Run the cut-pair checks on boards (`snap-critic`): the previous cut's last
frame against this cut's first (position, facing, eyeline, light, props). Stop for the person's look before video.

Also check the action's phase across the join (SNAP-R267): an aimed wand must not reset upright and repeat its
thrust unless the beat asks for another attack. Track each hand and its prop, accepted terrain damage and moved
items, including on a return to an earlier camera. After video, compare the adjoining shots at the same playback
size for exposure, palette and line/detail changes; account for camera direction, exposure, tighter framing and
motivated flashes before calling a difference drift.
Finish with an open whole-sequence look for anything that does not belong, not only the named checks. State which
parts were sampled and which were watched or heard; measurements alone do not certify sound or continuous motion.

## 4. Video cuts from boards

Each cut renders from its board as reference or first frame. FL2V or Ref2V: `snap-model-choice`. Video takes stay at
the setup's steps (6 on the Pika turbo). Prompt sections: AGENT_START §4.2.

**Style**
- Palette words get painted onto props: "teal and magenta neon glow" in the style line cycled an unlit lantern
  through both colours. Keep them out of shots where a light stays off.
- Say off states literally ("the lantern head stays completely dark the whole time": fixed 2/2 on the same seed), and
  describe a design by its silhouette ("shaped like a white lighthouse tower").

**Pictures in References** (SNAP-R242, R243, R244)
- Count each story prop and person on the board against the beat before approving it: a second bowl on an approved
  board was in every take made from it, whatever the prompt said (0/3 recovered); the critic writes it high.
- A board is the frame a cut opens on; a key drawing guides the boards and goes into a video's References only on a
  cut that ends on a held pose (on an action cut the take freezes on it by 2 s). The location master stays out of a
  cut that has its camera plate (takes cut to its framing). Never cite a picture as a look-alike ("like <Picture 4>").

**Sound** (SNAP-R36, R248, R249)
- Lead `overall_soundscape:` with the discrete sounds the action makes; ambience last (the compile lints a soft,
  ambient or tonal first clause). Burst and impact beats bring booms: get_take's `sound.onset` says a sub-bass hit.
- Tonal words become drones: "a ship's horn sounding twice" came out as one held 4 s tone, "neon signs buzzing" a
  steady ~450 Hz hum. Use percussive events (thumps, clicks, crunching snow) unless the tone is the point. A Long
  extend stayed clean for 34 s once the tonal words left; with them a tone grew from ~9 s on.
- Loudness can't hear a drone: confirm with a spectrum (`ffmpeg -lavfi showspectrumpic`) before re-rolling.
- H3 renders short quoted lines cleanly; name the speaker's voice and cite their `<Audio n>` (`snap-voice`).
- Ripple (relight, Change something) re-renders the sound; Remake keeps it. Lay the take's own sound back after a
  relight.
