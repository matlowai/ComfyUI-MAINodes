---
name: snap-new-view
description: >
  Make a new still from context pictures in Snap (`edit_from_context`, "New view from these pictures"): a board, a
  plate, a two-shot, a callout, or a targeted edit such as changing only the eyes or a prop. Use it whenever you make
  a still of a known place or character, edit one detail of a still, or a New view candidate came back wrong (copied
  the master, turned the head, lost the set).
scope: [tool:edit_from_context]
rules: [SNAP-R72, SNAP-R76, SNAP-R79, SNAP-R86]
---

If a Snap server is reachable, `read_skill {"name": "snap-new-view"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# New views and targeted edits

Tool shape and every argument: `docs/AGENT_START.md` ("A new view of a place"). Which model: `snap-model-choice`
(P-H3 for sets, wides and edits; Fizgig for characters; SNAP-R86).

## Making a view

- **Order the pictures on purpose.** What Picture 1 is depends on the model (`picture_one`); for both H3 still models
  the words set the camera, so the location's master can go first (SNAP-R72).
- **Size, not tricks.** Make a board frame at 2-4 MP; Fizgig is soft under 2-3 MP, and P-H3 at 2.5 MP costs no more
  than at 1 MP (6.8 s vs ~8 s). Always pass `width` and `height` to `ph3_view`: with 0 it makes Picture 1's own size,
  so a crop as Picture 1 gives a small odd-shaped still.
- **Write the board, not the mood.** Say what is behind each person (or a wide grows a second door), write an eyeline
  as a frame direction ("face turned to the LOWER LEFT, empty space on the left"), and say "indoors, <what is behind
  them>" for a close-up (or it drifts outdoors). One word fix each, first try.
- **Callouts come from a crop.** "A close-up of her boots" with the whole picture gave a full figure 24/24; the
  picture cropped to the boots (`{cast, crop}`) gave the callout 29/30.
- **The same words give the same composition** on both H3 still models; compare them on detail, design holds and
  speed, not framing.
- Land each cut's board in that cut's shot (`land`; the answer's `land_hint` says when it would land elsewhere).

## A targeted edit

Use `ph3_view` with the still (or a crop of the part) as Picture 1. Name only the change, describe its shape, say
what it is not, and say what holds:

> Change only her eyes: gold irises, each with a single thin black vertical slit pupil like a cat's, no round pupil.
> Her head stays in profile. Everything else stays.

That drew true slits 3/3; "slit pupils" alone gave round ones, and without the line on what holds 5 of 6 candidates
turned the head to show the eyes. A Fizgig "edit" is a re-render (mean change 23-25 outside the target, vs 3-8 for
P-H3); P-H3's floor for "regenerated, nothing changed" is SSIM 0.94-0.96.

## Reading the notes

Each candidate carries identity notes per Cast and a copy note per context picture (SNAP-R76, R79, R111, R112). The
identity note reads the character score (DINOv3 on a head crop): "probably not <name>" below 0.45, and it holds on
profiles and bowed heads, where ArcFace (shown beside it) drops near 0. The copy note reads the soft score: at 0.82 or
more it says "copied Picture n", "· same framing" when the view itself was re-rendered, "· same composition" when the
picture was drawn again from another viewpoint (the turned aerials of the master, 0.84). Look at the candidates beside
the master yourself as well. Notes inform, never block.
