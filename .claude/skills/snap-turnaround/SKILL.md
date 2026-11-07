---
name: snap-turnaround
description: >
  Make a character's turnaround and reference pictures in Snap that keep carried props, hair and costume consistent in
  every view: one continuous H3 orbit (an orbit LoRA such as ORB360), frames pulled at 90/180/270, then a Cast
  version. Use it whenever you design a character, make a Cast record or character sheet, need a back or side view,
  or a sheet lost or moved a prop (a floating sword, a scabbard on the wrong side).
scope: [tool:make_character_sheet, tool:save_cast]
rules: [SNAP-R59, SNAP-R60, SNAP-R89]
---

If a Snap server is reachable, `read_skill {"name": "snap-turnaround"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# A turnaround from an orbit

Sheet methods and their calls: `docs/snap/AGENT_START.md` ("Character sheets"); ranking in `snap-model-choice`. Cast
records: AGENT_START §5 (SNAP-R59, R60).

## Steps

1. **A clean front picture** as the Cast's first picture: a single figure, front view. A three-view sheet as the first
   picture made a recast paint three people.
2. **Check what holds every carried object** on that picture: strap, sheath, belt or hand. A sword that floats on the
   sheet floats in every board (SNAP-R89).
3. **A back reference.** From a front picture alone both H3 still models mirrored a carried sword to the wrong
   shoulder in every back view (6/6), and P-H3 gave no back view at all (0/3). Make or draw a back view first, or name
   the side in words ("the hilt over her left shoulder, seen from behind on the left").
4. **One orbit.** An H3 orbit LoRA such as [ORB360](https://huggingface.co/MATLOWAI/MiniMax-H3-ORB360-CardSpin) on a
   Ref2VA setup: the front as Picture 1, the back as the 180° keyframe, the LoRA's trained caption, 20 steps
   euler/simple (cfg 5 worked; the LoRA doesn't document one), the turbo off. About 5.8 min at 832x1024, 124 frames.
   One continuous video keeps carried objects consistent by construction; per-view stills guessed each side.
   The trained caption and the keyframe wording come with the LoRA: `describe_lora` lists the text files beside it
   (`beside`, e.g. prompts/*.txt), whole. Write the prompt in that caption's shape; the back picture is cited as a keyframe
   the way the caption does (`<Picture 2> ([Shot 1] keyframe at <seconds> seconds)`). `add_lora {role: "motion"}` puts an
   orbit LoRA on Style LoRAs, and `apply_cast` puts a Cast's words under a bare section header, so the caption keeps its
   shape (dogfood F-D08, F-D13).
5. **Pull frames** at 90 / 180 / 270 (clockwise seen from above, 90° is the subject's right side) and check each view:
   the prop's side and length, the hair's side, the straps.
6. **Make them references:** redraw with `stage2` (`snap-reference-upscale`), then save a Cast version with the views.
   A view that also needs a region fix (a prop drawn wrong) gets the redraw first and the fix last (F-Y06): a redraw
   after the fix can draw the flaw back (`snap-new-view`).
   Re-run what used the old version (`snap-critic`, fix at the source).

Without an orbit LoRA: `make_character_sheet` `contact_sheet` (Picture 1 padded square: front to back 9/9). A portrait
picture into the five-view LoRA rolled the camera in the picture plane in 4 of 6 sheets; measure the reference's shape
before calling a method weak.

## Traps

- **A prop holds in profile only when a side reference shows it**: the five-reference sheet fed profile crops kept a
  scabbard on the back 5/6; a one-sheet Fizgig stood it on the floor 6/6.
- **"Seen from above" never comes out** of a one-sheet turnaround (0/6); it becomes a second back view.
- **Sheets stay neutral; acting goes in the video.** A sheet model refused goggles over the eyes 4/4; the video model
  did it on the first take. A state's picture decides the expression: eyes closed on the sheet made "she opens her
  eyes" fail 2/2.
- For an expression sheet ask for "a row of five face close-ups, cropped at the shoulders"; a 3x2 grid request came
  back as a row of small full figures.
- A new look needs a new picture, not only new words: H3 copies a reference closely.
- **Recast** (`edit_take` recast) with a single-figure Cast picture and a short `who` naming the person to replace
  ("the girl in the long navy coat at the railing"): the old Cast's long details line as `who` added the new person
  beside the old one (2/2); the short `who` replaced her (2/2).
