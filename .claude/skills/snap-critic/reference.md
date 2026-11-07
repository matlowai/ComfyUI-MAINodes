# snap-critic reference: what each checklist adds

SNAP-R104 what is read follows the picture's purpose and place · SNAP-R109 the measured prompt lives in SKILL.md; this
file adds what only one checklist needs. The packet names its checklist (`skill.section`); read that section and run
the prompt's passes it lists. The table of passes and context per checklist is pack data (`snap_cards/critic.json`).

## master

A location's master establishing picture: the root of every view of the place. Its flaws spread to every plate, board
and cut that cites it, so read it strictly.
- Map pass first, from the corners (reading rule "Corners before names"), then the enclosure: follow every wall run to
  both ends; a palisade on one side only, a house outside the ring, a doubled or inner wall is high.
- Compare with the plan in the context (gate side, the rows of houses, the well, the road): the compass from the plan.
- Count gates and towers against the plan.

## plate

A location plate: one camera on the set, cited by name by boards and cuts.
- Cross-view against the master and the other plates of the same version: the same gate, the same palisade, the same
  roofs, the same side of the road, the well where the master has it.
- Support: seats and ledges people will sit on later (a twin parapet is high: the C17 double wall was in its plate).
- Scale from the horizon: a plate at eye height puts every standing adult's eyes on the horizon; a wall that is low
  against that mark is the plate's flaw.
- Eye height in metres (SNAP-R155): the horizon's height over the ground in scale anchors (`scale` in the words), read
  on the measuring copy, against the pose's typed `eye_height`. Say which: "measured against the record's scale (house
  door 2.0 m)" or "no scale on record". A gap of more than 0.3 m is a note owned by "camera marks" (the typed pose),
  or by the plate when the plate was meant to be at that height.

## location

Every view of one location version side by side (master, plan, plates): a cross-view critique, not a picture one.
- Write one line per feature in the cross_view pass: gate, towers, palisade runs, well, house rows, road, as a table of
  feature x view (same / differs / missing).
- Then the plan against the master's compass (the gate side, the rows), and enclosure on the master.
- Own each difference to the view that disagrees with the master; when the master disagrees with the plan, the plan or
  the master owns it (say which, and why).
- Scale across views (SNAP-R155): the same anchor (a door, the palisade) in every view in the record's metres, and each
  plate's eye height measured against `scale` as the plate section says; one note per plate, owned by that plate (or by
  "camera marks" when the typed numbers are what's wrong), never one note for all of them owned by the master.

## plan

A set plan (top view, camera marks). Check it against the master: the gate side, the rows, the road. An enclosure that
the plan draws on one side only is the plan's flaw (owner: plan), and the master will copy it.

## settei

A design reference of a place or prop: support (what holds it, what it stands on) and cross-view against the record's
other pictures.

## sheet

A Cast picture, character sheet or turnaround. Carried items need a visible holder in EVERY view.
- Make a table for each carried item (a sword, a scabbard, a bag): per view, its top and bottom landmark on the body
  (shoulder, hip, hem, knee) and what holds it; compare every view with FRONT. A landmark that moves between views, or a
  strip of background between the item and the back, is a flaw (high on a reference sheet). (Added after r3 for a
  miss no round caught; measured from the r4 fixtures run on.)
- Garments (r5): a second table for the costume's construction: per view, each slit, split, vent, hem, opening and
  closure (where it starts and ends on the body), and what each view sees of the far side through its gaps (between the
  legs, under the arms). A split that BACK shows and FRONT, looking through the legs at the same coat, doesn't, is a
  medium flaw (X02). A difference that the angle hides (the far side covered by a leg or the coat's front) is not.
- Reading rule "Projection": a diagonal scabbard reads near-vertical in profile; that alone is not a flaw.
- Cast pass: the sheet against the Cast's details line in `words.pins`.

## walk

A people-free walkthrough of a location (a video that pins the place and no Cast; its frames become plates; F-K06).
- The set holds from the first frame to the last against the master and the plan: the same gate, walls and rows, no
  wall growing or shrinking as the camera moves, no hard cut to another place.
- The camera stays at the height its first frame set: read the horizon against a scale anchor in the first and the
  last frame (plate section: "measured against the record's scale" or "no scale on record").
- No people, no figures popping in. No beat or Cast pass: nobody is meant to be here.

## board

A board or still in a shot (people in the place). Every pass.
- Scale by the horizon (reading rule), then the set against the master and the plates the shot cites (`plates_cited`).
- Beat: the prompt's verbs and negations, literally ("she does not take it").
- Who should be here: `words.who_should_be_here`; anyone else is an extra person.
- When the previous cut's last frame is in the context, the cut-pair checks too (below).

## cut

A video take in a shot: 5 spread frames whole, the first and last also tiled.
- Scan each frame: duplicates, people popping in or out between frames, ghost figures.
- Cast colour (r4): each person's colour line from the Cast (hair, eyes, skin, main outfit, accent), read again in every
  sampled frame, the frames inside a burst or glow included; a colour that leaves the Cast and stays off is a medium
  Cast colour drift, while a tint the light explains is not a flag (short05 C3: grey hair went dark in the burst).
- Contact: bodies meet the surfaces they rest on (no one sinks into a roof); attachments: every wire, string and rope
  has an anchor at BOTH ends (the coincidence rule never excuses a wire;
  added after r3, measured from the r4 fixtures run on).
- Cross-view against the board it was made from and the plates it cites; cut pair against the previous cut's last frame.
- Sound is not this pass's job (Snap's quiet-sound note and the voice checks cover it); mention `words.sound` only when
  it bears on the beat.

## cut_pair

The last frame of one cut and the first frame of the next. Only the cut-pair checks, as one line each: position,
facing, eyeline, screen direction (the 180-degree line), light (time of day), props and costume (goggles on and off).
Owner: the later cut's board or prompt.

## upscale

An upscaled take against its source frame (in the context). Scan for ghost figures and faces painted into flat
backdrop tiles, and tile seams; cross-view: everything in the upscale exists in the source. Owner: the take (its
upscale settings: skip flat tiles).

## edit

A targeted edit against the picture it edits: only the asked change differs; anything else that moved is a flaw.

## still

A still with no known purpose: run every pass the picture has material for.
