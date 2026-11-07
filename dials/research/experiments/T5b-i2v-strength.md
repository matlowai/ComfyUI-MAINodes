# T5b: can more strength bring a look dial back in image-to-video? (2026-11-06)

**Question.** T5 found sinister +1 about 4× weaker in image-to-video, with no darkening at all. Does raising the strength
recover it, and if so, by how much?

**Setup.** Image-to-video (first frame = the text-to-video control's first frame), sinister at +1, +2, +3, +4, seeds 42 and
43, Pika H3 Flex 6-step, against the image-to-video control. 6 new renders (the +1 arms are T5's).

**Results.**

| strength | distance s42 / s43 | Δdark s42 / s43 | Δcold s42 / s43 |
|---|---|---|---|
| +1 | 8.8 / 8.8 | −0.4 / +0.1 | +0.1 / +0.2 |
| +2 | 17.6 / 14.9 | −0.9 / +0.5 | +0.4 / +0.4 |
| +3 | 21.1 / 21.3 | −0.5 / +0.1 | +1.5 / +0.7 |
| +4 | 24.1 / 26.5 | +0.4 / −0.7 | +3.0 / +2.2 |
| text-to-video +1 (reference) | 32.7 | +18.0 | +17.8 |

Contact sheets: at every strength the platform keeps its warm dusk; what changes is the train (its position, a front
car appearing). No darkening, no cold blue.

**What it shows.** Strength raises the total change roughly linearly, but none of it goes into the dial's lighting
effect: even +4 in image-to-video changes less overall than +1 in text-to-video, with zero darkening. A first frame pins
the look; more push just moves what the frame doesn't fix (here, the train).

**What it changes.** "Use 2-4× strength in image-to-video" is **not** a fix for look dials (it may still be for motion,
as LESSONS reports −6 for a freeze with a reference). New node **T5c**: loosen the first frame instead, with the H3 Cond
Strength node (lower guide strength = noisier first-frame conditioning) and measure whether the dial's lighting returns
while the opening still matches the picture.
