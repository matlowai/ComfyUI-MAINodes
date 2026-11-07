---
name: snap-book
description: >
  Run a production in Snap's Book: a story as beats with state changes, a production style, settei per state, cuts
  compiled at their beat, boards and an animatic before video, then the Cut as one mp4 and an OTIO file. Use it
  whenever you set up or work on a short, an episode or any multi-cut piece in a Book, write or extract beats (the
  writers' room, the script supervisor), check continuity of who holds or wears what, plan cuts, make boards, play an
  animatic or assemble the edit.
scope: [tool:create_book, tool:add_beat, tool:add_change, tool:add_group, tool:set_colour_frame, tool:design_state, tool:add_cut, tool:compile_unit, tool:apply_unit, tool:make_board, tool:animatic, tool:export_cut, tool:draw_set_plan]
rules: [SNAP-R67, SNAP-R68, SNAP-R69, SNAP-R130, SNAP-R131, SNAP-R132, SNAP-R133, SNAP-R165, SNAP-R166, SNAP-R168, SNAP-R169, SNAP-R170, SNAP-R171, SNAP-R172, SNAP-R70, SNAP-R173, SNAP-R175, SNAP-R176, SNAP-R177, SNAP-R178, SNAP-R16, SNAP-R11]
---

If a Snap server is reachable, `read_skill {"name": "snap-book"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# A production in the Book

The Book is one record per production on two clocks: records version on the production clock (`cast:kon@5`), beats
are moments on the story clock. Every cut compiles from the state at its beat; nothing a render shows becomes state
until the person accepts it. Tool calls: `docs/snap/AGENT_START.md` ("The Book"). Order of work, as a studio runs it
(DECISIONS: storyboarding first):

1. **Book and bible.** `create_book` with the Cast and locations. A location needs its topology first
   (`snap-location`): `draw_set_plan` (shapes and labels; camera marks on the record), then the master and plates.
   Voices (`snap-voice`): a reference line per speaking character; cuts cite it with no voice words.
2. **Production style** (`save_style`): one 2-3 sentence paragraph in the catalogue's register (medium, line,
   shading, texture, finish), a palette, one reference still. It goes first in every prompt. Under monochrome or
   limited, colour words in a Cast line beat the style: say so to the person (the compile lists them) rather than
   editing their Cast.
3. **Beats** (the writers' room). Propose the beats with `add_beat`: one thing happens, is learned, or a relationship
   moves. Give each its intent and intensity (the director pass: how hard it hits, by the genre's playbook). Plants and
   payoffs (`plants [{what, window}]`, `pays_off`) make the Beat sheet flag an unpaid setup. Every story edit is a
   proposal; tell the person what it is for in one line. You don't have to wait: the next edit may name a beat that is
   only proposed (its answer's `needs` says which proposal it builds on; the person's Accept takes them in order).
   Don't batch many unrelated edits into one
   `save_story`: the person accepts beat by beat. A script the person already has goes in whole with
   `import_fountain` (Fountain; `export_fountain` gives Pages back as text).
4. **The script supervisor's pass.** For each beat, read its text and propose the state changes it implies, one
   `add_change` each, with `why` quoting the words. What to extract:
   - who holds, takes, drops or hands over what (`carried.right_hand` / `left_hand` on each person; `holder` on the
     prop): "Kon hands Ferro the letter" is three changes (Kon's hand → none, Ferro's hand → the letter, the letter's
     holder → Ferro);
   - what someone puts on or takes off (`wardrobe`, `carried.worn`), hair, injuries, dirt;
   - where each person stands and faces (`position`, `facing`): blocking is state, carried from cut to cut;
   - mood when the beat turns on it; `knows` and `wants` for the prose packet (they never reach a picture).
   Use the entity ids from `get_book` (cast:<id>, prop:<name>); give a new prop its name with the change (`name`).
   A prop's `holder` and the person carrying it must agree (the lint and the Beat sheet's flags say where not).
   Group the beats into scenes (`add_group`, with the place), and before a big edit read its `dry_run`. Never invent
   a change the text doesn't support; ask instead. A take that shows something the story didn't say (a torn sleeve
   the person likes) becomes canon only through `keep_as_canon`.
5. **Settei per state.** For each state the changes create that a picture must show (a new outfit), make its pictures:
   `design_state {book, cast, state, view}` (a New view from the Cast's own pictures with the style and the state's
   words; the Settei lens's Design it does the same), then `save_cast_state` with the picked take and `covers` matching
   the change's value. Until then the compile marks it "words only": pictures win over words, so fill the gaps before
   video. A wardrobe state folds the items it names out of the Cast line ("green apron" under "no apron", SNAP-R178):
   read the answer's `left_out` and `lint`; a clause it keeps that still disagrees (another garment of the same kind) is
   lint, and the fix is the person's (the Cast line or the state's words), not yours to drop.
6. **Cuts** (`add_cut`): beats, Cast, props, location and the plate whose framing is the camera, seconds, sound,
   the transition to the next cut. Read `compile_unit` for each: who holds what, which picture backs each field,
   what is words only, the reference budget, and `board` (the prompt and pictures `make_board` will send). A lint
   "waiting in proposal pN" means that beat isn't canon yet: the cut compiles from its blocking and camera only.
   Read each Cast's `cast_line`: a clause the state overrides ("a steel ladle in her right hand" once her hand is
   empty, "green apron" once she wears no apron) is left out and named (SNAP-R165, R178); a lint line "the blocking says … while …" is a real contradiction: fix the
   blocking or propose the change, don't render past it. A cut whose own beats move something has `opens` (SNAP-R168):
   the board draws that opening state, the key drawing the end.
7. **Boards → animatic.** `make_board` per cut (`snap-boards` for the craft), pick with `set_board` and approve. The
   board is the frame the cut opens on (calm, before the peak); a beat's peak is a key drawing (`make_board {role:
   "key"}`, `set_board {role: "key"}`), cited as what the cut builds to. A cut that shares another's camera takes
   that cut's board as context (`context: [{cut}]`); re-boarding a cut that has an approved board starts from that
   board, so the blocking holds (SNAP-R170). Boards pin the story, so `story_stale` names a board made before the
   story moved (SNAP-R169). Play
   `animatic {book}` and run the cut-pair checks on the boards (`snap-critic`). Fixes cost seconds here.
   Once a scene's boards are in, propose its colour frame (`set_colour_frame`: the board whose colour and light the
   scene keeps; the colour script strip on the Beat sheet).
8. **Video.** `apply_unit` then `run` per approved cut. `story_stale {book}` after any story or style edit tells which
   takes moved, by field and beat. To try a cut at a story moment without touching the Cut, copy its shot
   (`add_shot {scene, from: {scene, shot}}`: the copy carries no story pin) and `apply_unit {scene, shot, land: {scene,
   shot: <the copy>}}`: the takes there pin the cut they came from (SNAP-R166). Before proposing a story edit, read its
   `reversal_cost.said`: it names the cuts whose compile moves, not only the takes it newly flags (SNAP-R172).
9. **The Cut.** Make the best take of each cut active, trim and level them (`set_unit {trim}`), `export_cut {book}`:
   one mp4 as a take of the Book, plus OTIO for an editing program.

## The dial

The person sets it per stage (`set_autonomy` from you is a proposal). assist: your GPU work and picks wait;
collaborate: as "Let agents run"; automatic: they go ahead, recorded as yours, and the person can overrule any pick.
Story, style and the dial are proposals at every position. With GPU time idle and a stage at collaborate or
automatic, do that stage's next useful work (the empty settei cell, the cut with no board).

## Traps

- Compile folds by story order, the Cut by telling order: a flashback beat is told late but compiles early.
- Hash-based stale names only the fields a cut used: a reworded intent flags nothing; a changed value flags the cuts
  at or after its beat.
- A board made as a 64 px placeholder on a CPU server is a pipeline check, not a picture to judge.
- The animatic and the Cut are ffmpeg in a prompt, not GPU: they run even while the GPU queue is busy, but they wait
  their turn in the same queue.
