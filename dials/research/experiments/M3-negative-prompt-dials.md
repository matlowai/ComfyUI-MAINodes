# M3: a negative prompt rebuilt as dials, at CFG 1 (2026-11-07)

**Question** (Dylan: "dials for worst quality, bad anatomy, watermark and jpeg artifact, then add the negative direction to
a cfg 1"). At CFG 1 there is no negative branch, so a negative prompt does nothing. Can dials made from the usual negative
terms, applied at minus strength, do the negative prompt's job for free (no second model pass)?

**Setup.** Five dials made with Make Dial on **KroMoss** (post-refiner hook, debias on): "worst quality", "bad anatomy",
"watermark", "jpeg artifact", and all four together. Pairs are deliberately one-sided: a scene, an illustration or a
detailed image ||| the same plus the defect words, over six scenes. Rendering as KroMoss is designed for few steps:
**its 8-step DMD2 LoRA, 8 steps, CFG 1, euler / simple**. Reference: the same with **CFG 1.5, 12 steps** and the real negative
prompt ("worst quality, bad anatomy, watermark, jpeg artifact"). One seed (7).

## On a clean render (a lighthouse scene, 1024²)

- The real negative at CFG 1.5 stays close to the control: the same scene, slightly cleaner.
- The dials do something else. The combined dial at −2 / −4 / −8 makes the picture progressively **tidier and plainer**:
  calmer cliffs, a neat cottage, at −8 a tidy red-capped lighthouse. The four single dials at −4 do milder versions of the
  same. At **+4** the combined dial is not visibly "worse quality"; it is more dramatic (a rainbow, a waterfall, a fiery sky).
- Reading: on a clean image these pairs teach "plain and tidy vs dramatic and busy" more than quality. The usual lesson
  applies: a pair teaches its words literally, and "worst quality" has little visible meaning in a clean render.

## On a real artifact (a beach scene at 4096², with a high-resolution LoRA)

This render has a genuine defect: at CFG 1 the model draws a faint logo-style watermark, a signature and a date in the
bottom-right corner. Same seed and setup, comparing the corner:

| | the corner watermark |
|---|---|
| no dial | clearly visible |
| watermark dial −2 / −4 | noticeably fainter |
| watermark dial −8 | fainter still, but readable |
| all four −4 | faint, present |
| **real negative, CFG 1.5** | **gone** (a tiny scribble remains) |

**Side effect:** at −2 to −8 the watermark dial also changes the figure (a deeper neckline, a curvier build, a slightly
different face); the combined dial at −4 gives a slimmer, more stylized figure. These dials carry body and style along with
whatever they remove: do not use them blind.

**Late steps only** (the Dial Rack's `late` envelope, which ramps in over the second half of sampling): the watermark dial
at −8 and even −16, and the combined dial at −8, leave the corner **exactly as with no dial**, and the figure unchanged
too. In this 8-step setup the corner signature and the body side effect are both decided in the early steps.

**Early steps only** (`early` envelope): −8 matches −8 on all steps (the same partial fade and figure change); −16
fades the logo further but turns her into a different person (a sun hat, another dress). With word dials there is no
setting that removes the watermark without changing the picture.

## A picture-pair dial (Dylan's idea): the same image with and without a watermark

16 pairs made without any editing model: 512×512 corner crops of plain MOSS renders, and the same crop with a stamped
made-up signature or studio name plus a date (random fonts, colours, opacity; some faint). The pixels differ only by the
stamp. Crops, not whole images, because MOSS's text encoder sees a picture at about 384×384, where a corner watermark on a
full frame would vanish. Encoded with a "Picture 1" marker under three framings, through MOSS's `text_embedder`, B − A
averaged (pair agreement 0.67), debiased, scaled to the word dial's size. Read back through the encoder's output head, the
direction's top tokens toward the stamped side include "signed" (twice).

Same 4096² render, seed 7, at CFG 1:

| | the corner | the rest |
|---|---|---|
| picture dial −2 | logo still there, a short signature | same pose; a printed pattern on the dress |
| picture dial −4 | logo faint, a thin signature | same pose |
| **picture dial −8** | **logo gone**, a small signature left | **same pose and figure**; a star print on the dress, darker hair |

At −8 the picture dial does what the CFG 1.5 negative did to the logo, at CFG 1 and with no extra pass, and keeps the
composition far better than the word dial. A small signature remains, as it does with the real negative. One seed.

**Twelve more seeds** (1024², KroMoss DMD2, CFG 1, 8 steps, no high-resolution LoRA; seeds 101-112): the prompt draws a
watermark on **8 of 12** controls (seven logo-style marks, one "@handle"). With the picture dial at −8: **6 of 8 fully
removed**, one reduced, one survives (smaller); the 3 clean controls stay clean, and **one clean control gains a tiny new
mark** (a false positive). Side effect: the white dress turns light blue, aqua or mint in most seeds (pose, composition and
face stay close).

**v2: 32 more varied pairs** (more crop content, stamp colours including blue), the same 12 seeds at −8: **the same
removal** (6 of 8 gone, seed 109 reduced to a small signature, seed 106's logo survives smaller; seed 110 again gains a tiny
mark). Blue drift slightly lower by eye (7 of 12 dresses visibly blue/aqua/mint vs 8 of 12). So the blue does not come from
the stamp colours.

**v2 + a colour hold** (the Dial Rack's `hold` row: the summed shift is projected off the warm↔cold grade dial, so the rack
cannot move along that direction): **no help.** The dresses stay just as blue, if anything a little bluer (mean blue − red
over the figure rose on 9 of 12 seeds); removal got slightly worse (seed 112 keeps a small signature that v2 alone removed;
106 and 110 as before). My guess (untested): the drift is an object colour ("a blue dress"), not a lighting grade, so a grade
dial is the wrong thing to hold. Next candidate: hold a dial made from "a white dress ||| a light blue dress" pairs.

**v2 + a dress-colour hold** (a new dial, white dress ↔ light blue dress, 3 templates × 6 dressed subjects, made on KroMoss):
**also no help.** The same seeds turn blue, aqua or mint; removal is the same as v2 alone (6 of 8, 109 reduced, 106 survives,
110's tiny mark). **Why both holds did nothing:** the watermark dial is almost exactly orthogonal to both hold dials (cosine
−0.003 with the dress dial, +0.018 with the grade dial), so projecting them out removes almost none of the shift. A hold
only helps when the dial being held overlaps the dial doing the work. The blue therefore does not come from a dress-colour
component inside the watermark dial; my guess (untested) is that it comes from how the model responds to the shift as a
whole. Next: push back with the dress dial itself (toward white) instead of holding it.

**v2 −8 + the dress dial at −4 (an active push toward white):** **the blue is gone.** All 12 dresses are white or cream
again; mean blue − red over the figure returns to control levels (−21…+12 vs the controls' −45…+29; v2 alone reached +106).
Pose and composition stay as with v2 alone; a few faces shift a little. Watermarks: **5 of 8 fully removed**, 2 reduced to a
tiny mark (seed 102's "@handle" becomes a small number; 109 a small signature), 106's logo survives but fainter; seed 110's
false-positive mark persists. So slightly less removal than v2 alone (6 of 8) for a clean dress colour. **Caveat:** the dial
pushes toward white, not back to the original colour: seed 104's control dress is yellow and comes out cream. One render per
seed, 12 seeds, one prompt.

**What it changes.** A hold only helps when the held dial overlaps the working dial (check the cosine first); a side effect
that is orthogonal to the working dial has to be pushed back actively, and the push needs a known target colour.

**What it shows.** A negative-prompt dial pushes in the right direction but only part of the way: it fades a watermark
the real negative removes. A dial is one fixed shift of the text conditioning; a negative prompt steers at every step
through a second branch. A picture-pair dial does the job (above). Next: a second seed and other prompts; more varied stamp pairs (the
dress pattern may come from the crops' content). One seed: a hint.

## Held-out prompts (the watermark picture dial v2 at −8, nothing else)

Three new prompts, seeds 201-206, KroMoss DMD2, CFG 1, 8 steps, 1024², one render per seed and arm:

| prompt | control | v2 −8 |
|---|---|---|
| a stock photo of a businessman shaking hands | no watermark on any seed | not run (nothing to remove) |
| an anime fan-art girl hugging a black cat | **3 of 6 marked**: an "@name" signature, an "@handle" plus a large faint name across the middle, a small red seal | **all 3 removed**; the 3 clean seeds stay clean |
| a mountain lake at sunrise, "award-winning nature photography" | **6 of 6 become award posters**: black caption bands, titles, badges, dates | **all 6 are plain landscapes**: no text, no badge, the same lake, mountains and sunrise |

Side effects on the fan art: outfits change on 4 of 6 (two hoodies become sleeveless tops, one a striped T-shirt), and two
backgrounds turn light blue or aqua: the same blue lean as on the beach. The landscapes keep their scene.

**What it changes.** The dial generalizes beyond the prompt family it was tested on, and to a kind of text it was not made
from (whole caption layouts, not corner stamps): it reads as "no overlaid text or branding". The blue lean travels with it;
the dress push from above is the known fix when the subject has a dress to push. Held-out: 2 prompts × 6 seeds.

**Cross-model: the landscape prompt on MOSS SFT DeBand** at its own settings (ER-SDE 25 steps, CFG 3, the real negative
prompt), seeds 201-206: **the controls are already clean**: plain landscapes, no caption bands or badges on any seed. So the
award-poster text is a KroMoss-at-CFG-1 failure (or the negative prompt's work); there is nothing for the dial to remove
here. The dial at −8 is harmless on DeBand: the same scene on every seed, small changes to clouds and mist. A removal test
on DeBand needs a prompt that still draws a watermark through its negative prompt.
