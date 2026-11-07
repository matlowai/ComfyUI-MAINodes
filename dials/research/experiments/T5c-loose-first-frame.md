# T5c: does loosening the first frame let a look dial act in image-to-video? (2026-11-06)

**Question.** T5/T5b: a first frame pins a look dial (sinister's darkening is zero in image-to-video, even at +4). The
H3 Cond Strength node can hold the first frame more loosely (its guide rows are blended with noise:
`aug · rows + (1 − aug) · noise`, default aug 0.999). Does a looser first frame let the dial's lighting through?

**Setup.** Image-to-video as in T5, guide strength 0.8 and 0.5, each with its own no-dial control and with sinister +1;
seeds 42 and 43. 8 renders. "Frame 0 vs picture" = mean pixel difference between the first rendered frame and the given
first frame (320 px).

**Results.**

| guide strength | sinister vs its control: distance s42 / s43 | Δdark s42 / s43 | frame 0 vs picture |
|---|---|---|---|
| 0.999 (default) | 8.8 / 8.8 | −0.4 / +0.1 | 4.0 |
| 0.8 | 12.5 / 10.1 | +0.1 / +0.4 | 5.2 |
| 0.5 | 12.0 / 9.2 | +1.5 / +1.3 | 7.1 |
| text-to-video +1 (reference) | 32.7 | +18.0 | n/a |

**What it shows.** Loosening the first frame down to 0.5 barely helps: darkening goes from 0 to about +1.4 (text-to-video:
+18), while the opening still matches the picture closely. The pin isn't the cleanliness of the conditioning rows alone;
the clip follows the first frame's lighting.

**What it changes.** Neither masking (T5), strength (T5b) nor a looser first frame (T5c) lets a look dial override a first
frame. Practical advice: **apply look dials when making the first frame** (a text-to-video pass or an image model with the
look), or use a reference picture instead of a first frame (untested here; LESSONS found references anchor less: scene drift
26 vs 34). Next candidate: T5d, the same dial with the picture as a Ref2V reference.
