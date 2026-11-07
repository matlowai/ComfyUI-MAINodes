---
name: snap-model-choice
description: >
  Which model or method to pick for each job in Snap (new views, targeted edits, turnarounds and sheets, making a
  reference bigger, 4K, video cuts, longer takes, Change something), with the measured reason for each. Use it whenever
  you choose a `method`, setup or slot in Snap, compare models for a job, or the person asks "which model should do
  this". These are pack defaults; the person's own model-per-job notes override them.
scope: [tool:edit_from_context, tool:make_character_sheet, tool:upscale_take, tool:apply_setup, tool:edit_take]
rules: [SNAP-R51, SNAP-R64, SNAP-R75, SNAP-R77, SNAP-R82, SNAP-R85, SNAP-R86, SNAP-R88, SNAP-R149, SNAP-R150]
---

If a Snap server is reachable, `read_skill {"name": "snap-model-choice"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# Which model for which job

These are the pack's defaults (SNAP-R86 and the rules cited). In the instruction stack (`snap-core`) each row is a
note of kind `model_choice` the person can change ("use Fizgig for sets in this workflow"); their note wins. Say which
row you used and why when you pick.

| job | pick | instead of | why (measured) |
|---|---|---|---|
| a set, a wide shot, a targeted edit ("change only X") | `edit_from_context` `ph3_view` (P-H3-Image) | | moves the camera from words: 6/6 into the square with the master's own gate; ~7 s a still, 8 steps (SNAP-R75, R86) |
| character shots, two-shots, finished board frames | `edit_from_context` `fizgig_still` | | closest two-shots; reads every picture as a reference, so it draws back views (6/6); soft under 2-3 MP (SNAP-R86) |
| a new view of a known place | an H3 still model | MOSS Image Edit | MOSS copied Picture 1 or redesigned the set and the people (SNAP-R75) |
| a board still above 4 MP | SeedVR2 after the still | H3 latent refine | ~5 s; the latent refine is softer and 7x slower |
| a turnaround | one continuous H3 orbit: an orbit LoRA such as [ORB360](https://huggingface.co/MATLOWAI/MiniMax-H3-ORB360-CardSpin) on Ref2VA | per-view stills | one video keeps carried objects consistent; passed every per-view check (`snap-turnaround`) |
| a turnaround without an orbit LoRA | `make_character_sheet` `contact_sheet` | | Picture 1 padded square orbits front to back 9/9, ~39 s a sheet (SNAP-R77) |
| an 8-panel reference sheet with close-ups | `h3_ref_sheet`, given views or crops | | kept a carried scabbard on the back in profile 5/6 |
| a sheet that must keep carried props | not `krea2_quadview` (drops props), not `moss_charref` (off-model) | | `krea2_dynamic` only for pitch sheets (garbled labels) |
| making a reference bigger (Cast picture, turnaround, plate, settei) | `upscale_take` `stage2`, denoise 0.3 | RelayVSR | redraws the face the VAE smeared: ArcFace vs the Cast front 0.91 / 0.86 / 0.89, vs 0.79 / 0.68 / 0.80 sharpen-only (SNAP-R85) |
| 4K | `upscale_take` `tessera` after `stage2` | Tessera on the raw take | carries the redrawn face up; flat backdrop tiles skipped at 8 (SNAP-R82) |
| every video cut | a Pika setup at its 6 steps (`Pika H3 Flex`, `Pika + reference pictures`) | the "no turbo (20 steps)" presets, more steps | the quality standard (the operator, 2026-11-06); 20 and 30 steps drifted off the plate and the Cast (SNAP-R149) |
| a cut whose first frame is the point (a wide, a light igniting in place) | FL2V from the key still | | copies the still exactly, but invents the set as the camera moves |
| acting in a known set | Ref2V with the plate and Cast pictures | | holds the plate's set, draws the character from the sheets; ignores a First frame left over from FL2V |
| a longer take | Standard up to ~40 s, Long beyond; Strong only as a pick | | Standard grows a mosaic past ~40 s; Long's re-anchor holds 2 minutes, face and sound (SNAP-R64) |
| Change something on a video take | MOSS Image Edit paints the frames, then Ripple or Remake | | the in-place video edit route (SNAP-R51); Ripple re-renders the sound, Remake keeps it |
| a voice reference | Ref2V at 12+ steps, low resolution | the setup's 6 turbo steps | audio needs the steps; the picture is thrown away (SNAP-R88, `snap-voice`) |

The no-turbo presets are opt-in only (Turbo off puts them on): never pick them to "improve" a take or offer them as the
better choice. Judge video candidates with their sound on (SNAP-R150): a take with a corny sting or clash burst loses
to a quieter one whatever the frames say.

When you compare models for a job, run them at the same size, quote time as "first seed / each more seed" (the first
pays the prompt and reference encoding), and judge on design holds and detail: the same words give the same
composition on both H3 still models.
