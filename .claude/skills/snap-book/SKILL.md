---
name: snap-book
description: >
  Run a production in Snap's Book: a story as beats with state changes, a production style, settei per state, cuts
  compiled at their beat, boards and an animatic before video, then the Cut as one mp4 and an OTIO file. Use it
  whenever you set up or work on a short, an episode or any multi-cut piece in a Book, write or extract beats (the
  writers' room, the script supervisor), check continuity of who holds or wears what, plan cuts, make boards, play an
  animatic or assemble the edit.
scope: [tool:create_book, tool:add_beat, tool:add_change, tool:add_cut, tool:compile_unit, tool:apply_unit, tool:make_board, tool:animatic, tool:export_cut, tool:draw_set_plan]
rules: [SNAP-R67, SNAP-R68, SNAP-R69, SNAP-R130, SNAP-R131, SNAP-R132, SNAP-R133, SNAP-R16, SNAP-R11]
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
   proposal; tell the person what it is for in one line and wait. Don't batch many unrelated edits into one
   `save_story`: the person accepts beat by beat.
4. **The script supervisor's pass.** For each beat, read its text and propose the state changes it implies, one
   `add_change` each, with `why` quoting the words. What to extract:
   - who holds, takes, drops or hands over what (`carried.right_hand` / `left_hand` on each person; `holder` on the
     prop): "Kon hands Ferro the letter" is three changes (Kon's hand → none, Ferro's hand → the letter, the letter's
     holder → Ferro);
   - what someone puts on or takes off (`wardrobe`, `carried.worn`), hair, injuries, dirt;
   - where each person stands and faces (`position`, `facing`): blocking is state, carried from cut to cut;
   - mood when the beat turns on it; `knows` and `wants` for the prose packet (they never reach a picture).
   Use the entity ids from `get_book` (cast:<id>, prop:<name>); a prop gets a name in the story's `props`. Never invent
   a change the text doesn't support; ask instead. A take that shows something the story didn't say (a torn sleeve
   the person likes) becomes canon only through `keep_as_canon`.
5. **Settei per state.** For each state the changes create that a picture must show (a new outfit), make its pictures
   (`snap-turnaround`, New view from the base sheet) and `save_cast_state` with `covers` matching the change's value.
   Until then the compile marks it "words only": pictures win over words, so fill the gaps before video.
6. **Cuts** (`add_cut`): beats, Cast, props, location and the plate whose framing is the camera, seconds, sound,
   the transition to the next cut. Read `compile_unit` for each: who holds what, which picture backs each field,
   what is words only, the reference budget.
7. **Boards → animatic.** `make_board` per cut (`snap-boards` for the craft), pick with `set_board` and approve; play
   `animatic {book}` and run the cut-pair checks on the boards (`snap-critic`). Fixes cost seconds here.
8. **Video.** `apply_unit` then `run` per approved cut. `story_stale {book}` after any story or style edit tells which
   takes moved, by field and beat.
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
