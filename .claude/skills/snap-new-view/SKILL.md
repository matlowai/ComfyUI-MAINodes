---
name: snap-new-view
description: >
  Make a new still from context pictures in Snap (`edit_from_context`, "New view from these pictures"): a board, a
  plate, a two-shot, a callout, or a targeted edit such as changing only the eyes or a prop. Use it whenever you make
  a still of a known place or character, edit one detail of a still, or a New view candidate came back wrong (copied
  the master, turned the head, lost the set).
scope: [tool:edit_from_context]
rules: [SNAP-R72, SNAP-R76, SNAP-R79, SNAP-R86, SNAP-R190, SNAP-R200, SNAP-R202, SNAP-R203, SNAP-R204]
---

If a Snap server is reachable, `read_skill {"name": "snap-new-view"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# New views and targeted edits

Tool shape and every argument: `docs/snap/AGENT_START.md` ("A new view of a place"). Which model: `snap-model-choice`
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

When the words don't take after two or three seeds, change the approach (SNAP-R200). Four that worked on Kuroe's
monocle, where a gold bar across the nose came back from every wording (dogfood F-Y01..F-Y06, G13):

- **Mask the thing out** (F-Y09, SNAP-R204). For a removal (a stray bar, a ghost line, a prop that shouldn't be
  there), add `mask: "<the thing>:1"` to the region edit: SAM finds it in the crop and only it changes. Kuroe's nose
  bar came off 2/2 this way on his original front, with his eyes and lens untouched (a faint 1 px trace showed at 6x).
  Say in the prompt what is there instead ("bare skin, nothing across it").
- **Show the item, don't describe it** (F-Y02). To change how a thing is built, give a settei of the item alone as
  Picture 2: make it from a crop of the record's own picture ("drawn alone … only one lens, no bridge, no face"), then
  region-edit (`paste_back`, SNAP-R190) with it. Words over the bar: 0/4; the same region edit with the settei: 2/2.
- **Remove the whole item, then add the right one** (F-Y03). "Remove only the bar" failed; "he wears no eyewear at
  all" gave a bare face 2/2, then adding the monocle from its settei 2/2. An edit whose Picture 1 still shows the flaw
  tends to keep it: the settei edit on a redraw that had the bar back kept the bar 2/2 (G13, s9961/s9962).
- **Redraw first, region-edit last** (F-Y06). A redraw draws the model's prior again. Stage 2 of a region edit redraws
  the whole still at the new size (SNAP-R202), and that can bring the flaw back: Kuroe's fix B got its bar back at
  denoise 0.30 and 0.20, fix C stayed clean at both. After any redraw of a fixed picture, look at the fixed part at
  100 %; if the flaw is back, fix the redraw (the remove-then-add pair above), not the other way round.
- Then compare the eyes with the Cast: a redraw darkened Kuroe's grey irises. `keep_eye_colour` runs on any take
  (SNAP-R203) but moves only the hue, so it leaves a grey iris as it is (the picture comes back unchanged).
- A seam note that says **"the box shows"** means the pasted box is lighter or darker than the picture around it
  (SNAP-R205): redo it with `mask`, or with the crop's edges on the thing rather than open background.

## Reading the notes

Each candidate carries identity notes per Cast and a copy note per context picture (SNAP-R76, R79, R111, R112). The
identity note reads the character score (DINOv3 on a head crop): "probably not <name>" below 0.45, and it holds on
profiles and bowed heads, where ArcFace (shown beside it) drops near 0. The copy note reads the soft score: at 0.82 or
more it says "copied Picture n", "· same framing" when the view itself was re-rendered, "· same composition" when the
picture was drawn again from another viewpoint (the turned aerials of the master, 0.84). Look at the candidates beside
the master yourself as well. Notes inform, never block.
