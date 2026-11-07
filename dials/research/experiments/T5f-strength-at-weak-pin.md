# T5f: more strength at the weak first-frame pin (2026-11-06)

**Question.** T5e: holding the first frame loosely (guide strength 0.3) lets about a quarter of sinister +1's darkening
through. T5b: at the default pin, more strength adds nothing to the look. Does more strength help once the pin is loose?

**Setup.** Image-to-video, the T5 picture as first frame, H3 Cond Strength guide 0.3, sinister +2 and +3 against T5e's
guide-0.3 control and +1 arm. **One seed (42)**, Pika H3 Flex 6-step. 2 new renders. Metrics as in T5e.

**Results** (seed 42; vs the guide-0.3 control):

| sinister | distance | Δdark | Δcold | frame-0 drift |
|---|---|---|---|---|
| +1 | 14.9 | +4.3 | +2.2 | 10.7 |
| +2 | 23.3 | +8.4 | +4.0 | 10.1 |
| +3 | 29.0 | +8.1 | +7.2 | 10.7 |
| text-to-video +1 (reference) | 32.7 | +18.0 | +17.8 | – |

Contact sheet: +2 and +3 have deeper shadows and a dimmer platform than +1, but the sky stays a warm dusk; the cold,
overcast blue of text-to-video never appears. The opening frame is unchanged at every strength.

**What it shows.** Unlike the default pin (T5b), at a loose pin strength does reach the look: darkening doubles from +1
to +2 (to about half the text-to-video value) and then stops; the cold shift keeps growing to +3 (+7, about 40%).
Frame-0 fidelity is set by the guide strength alone, not by the dial strength. One seed: a hint, not a finding.

**What it changes.** Practical recipe for a look dial on a given first frame: guide ~0.3 and dial +2 gives roughly half
the text-to-video look with the opening still close to the picture. The full look (sky colour, overcast) still needs the
dial when the first frame is made. A second seed is worth it only if this recipe goes into the README.
