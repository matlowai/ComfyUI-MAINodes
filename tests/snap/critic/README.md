# The critic's fixtures

SNAP-R108 every miss the person catches is one press from a fixture · SNAP-R109 the critic skill is the prompt's one
home, and a prompt change ships only when the fixtures run holds the floor.

`fixtures.json` is the manifest: 32 pictures the operator judged by eye (22 with flaws, 31 expected flaws counted, plus
X30; 9 clean), each with what it is, its context words and pictures, the expected flaws (with the keys the auto-scorer
matches), the allowed minor flaws, the must-not-flag readings and the operator's words. `floor` is the last accepted
round (r3: 24/29 caught, 0 false alarms, run by Opus 5.5).

The pictures (69 MB of renders) are not in the repo. They live in a local fixtures folder with this layout:

    <root>/blind/X01.png … X30.png
    <root>/blind/ctx/<context pictures>
    <root>/fixtures.local.json, <root>/pictures/   (the person's own, from "Add as fixture"; optional)

Name it with `--root` or `SNAP_CRITIC_FIXTURES`. A new install starts with the manifest only and grows its own fixtures
from its first catches (Snap's "Add as fixture" writes into the server's fixtures folder: `SNAP_CRITIC_FIXTURES`, else
the person's `snap/critic_fixtures/`).

## A run

    python3 run_fixtures.py load --port 8188 --root $SNAP_CRITIC_FIXTURES         # every fixture on the docket, blind
    # a critic agent with the snap-critic skill works the docket with Snap's tools until nothing is due
    python3 run_fixtures.py score --port 8188 --run <the run name load printed>   # caught / false alarms vs the floor

`score` prints each expected flaw with the note that matched it, and every medium or high note on a clean picture
beside that picture's allowed minors; rows marked `?` need a person's look, settled with `--confirm <file>`
(`{"X03#1": "caught", "X12#cn2": "ok"}`). Re-check your own scoring before writing a rule: three fixtures changed
polarity once checked by eye. `packets` writes the same blind packets to disk for a critic with no Snap server.

## Runs

- `runs/2026-11-06-r4/`: the pack skill (r3 verbatim + the checklists in reference.md) run by an Opus 5.5 critic agent
  through Snap's own tools on a docket of the 30 fixtures (claim, packet, write; 16 min, ~30 s a picture): 25/29
  caught, 0 false alarms on 9 clean, X30 caught; misses X13 (unheld Cast-front sword), X14 wire and kite, X21 LEFT
  float. `results.jsonl` (every note), `confirm.json` (the hand-settled rows, scored the way the r3 rounds scored them:
  the giants on X19/X29 and the beat items on X04/X27 are real, as scores_r3 found), `score.json`.

- `runs/2026-11-06-r4-colour/`: the r4 colour delta (a Cast colour line per person read in every frame, effects
  included; Cast colour drift medium; low colour shifts only for props and background) on all 32 fixtures, blind packets
  on disk (`packets`), one Opus 5.5 critic: 26/30 caught (X31 caught; misses X13, X14 wire and kite, X21 LEFT float),
  0 false alarms once X02 turned out not clean (the operator, after G4: its LEFT-view hilt note is an allowed minor, and
  the coat split no r3 or r4 run named is its expected flaw; re-scored on the 31: 26/31, X02 missed). The colour lines
  fired on no clean picture. X32's second monocle is real (both critics, checked by eye).
  `runs/2026-11-06-x02-check/`: X02 alone, blind, two runs each of r3 and r4 in the same packets harness: all four flag
  sheet landmarks (r3: a high LEFT-view hilt; a high RIGHT-view scabbard gap plus a medium hilt. r4: a high hilt; a
  medium scabbard gap) and none names the coat split; the earlier run through Snap's own packets wrote X02 clean.
  The r3 text on X31/X32 alone (`runs/2026-11-06-r3-x31x32/`): X31 missed (the dark hair read as a reaction gag, the
  suit at low), X32 the same real monocle note.

- `runs/2026-11-06-r5-garment/`: r5 = r4 plus the garment line in the cross-view pass (slits, splits, hems and openings
  agree across views; look through one view's gaps at the far side another shows; a disagreement is medium, SNAP-R153),
  all 32, blind packets on disk, one Opus 5.5 critic (18 min): 27/31 caught, **X02's coat split caught** (medium, "BACK
  shows a centre-back split from mid-thigh to hem, but FRONT, looking between the legs at the inside of the same back
  panel, shows it continuous"), and the same split written on X21 (v2, the same coat) unasked; misses X13, X14 wire
  and kite, X21 LEFT float. 1 false alarm on 9 clean: X27, a doorway villager in Liesl's dress read as "a duplicate
  Liesl" (medium). Settled by eye: X15's reddish-brown iris against the Cast's pale grey and X32's monocle on the wrong
  eye after the turn are real (ok); X09's tile step is its allowed minor. The scan pass now says a duplicate is the same
  person twice, not two people in the same dress (after this run).

## The fixtures

- X01 master v1: the palisade only across the front; the village is not enclosed.
- X02 turnaround v3: the coat's centre-back split shows in BACK but not through the gap between her legs in FRONT
  (medium; the operator, 2026-11-06). The LEFT view's hilt (a pommel nub behind the head) is an allowed minor; profile
  scabbards near-vertical are correct.
- X03 board: an inner palisade, a duplicate person, a second gatehouse.
- X04 board: clean (the blade through the coat is the beat).
- X05 plate (rooftop): a double parapet.
- X06 walk frame: the character far too big for the set (eyes far above the horizon).
- X07 turnaround v1: a sword floating with nothing holding it; views disagree on the scabbard.
- X08 board: the beat contradicted (she takes the pouch).
- X09 4K upscale frame: clean.
- X10 six views of one location: three different gates.
- X11 board: an inner palisade, an extra knight, the beat contradicted.
- X12 board: clean.
- X13 Cast front picture: the greatsword held by nothing.
- X14 video frame: bodies sunk into the roof; lantern wires from nowhere; the kite crossing the wire (low).
- X15 board: clean.
- X16 board: an inner palisade; a second gatehouse and a watch tower.
- X17 4K upscale frame: ghost copies of the subject in the backdrop tiles.
- X18 walk frame: far too big for the houses.
- X19 board: clean.
- X20 still: an inner palisade.
- X21 turnaround v2: the LEFT-view scabbard floats; profiles disagree.
- X22 video frame: a double wall behind the seat.
- X23 board: the beat contradicted.
- X24 board: clean.
- X25 board: an inner palisade.
- X26 walk frame: too big for the set.
- X27 board: clean (small fires are allowed minors).
- X28 board: an inner palisade.
- X29 walk frame: clean.
- X30 master v2: a house outside the ring (not counted).
- X31 clip sheet (short05 C3 burst): Cast colour drift, grey hair goes dark and the suit olive (medium).
- X32 clip sheet (short05 C4): the clean colour twin (hair stays grey); a real second monocle in the last two frames.

## Known misses (r3)

- X21: no round caught the LEFT-view scabbard floating off her back; r3 also lost the RIGHT-view tip in front of the
  shins. The skill's sheet checklist now asks for a per-view landmark table (added after r3).
- X14: a lantern wire with no anchor, excused by the coincidence rule. The cut checklist now says the coincidence rule
  never excuses a wire (added after r3).
- X25, X16 (and X03 in r2): a palisade run inside the village read as a gap or a second opening.
- X14: the kite crossing the lantern wire, never caught (low).
