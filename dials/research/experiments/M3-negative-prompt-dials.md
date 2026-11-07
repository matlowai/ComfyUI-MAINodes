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

**What it shows.** A negative-prompt dial pushes in the right direction but only part of the way: it fades a watermark
the real negative removes. A dial is one fixed shift of the text conditioning; a negative prompt steers at every step
through a second branch. A picture-pair dial does the job (above). Next: a second seed and other prompts; more varied stamp pairs (the
dress pattern may come from the crops' content). One seed: a hint.
