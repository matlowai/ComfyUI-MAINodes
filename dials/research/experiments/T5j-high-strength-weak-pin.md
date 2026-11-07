# T5j: high strength at weak first-frame pins (2026-11-06)

**Question** (Dylan: "we should go higher strength still and .2 .1"). T5f tried sinister +2/+3 at guide 0.3. What do
+4 and +6 do, and what happens at guide 0.2 and 0.1?

**Setup.** Image-to-video, the T5 picture as first frame, H3 Cond Strength guide 0.3 / 0.2 / 0.1, sinister +2, +4, +6
(and the earlier +1 at 0.3 and 0.1), each against its own guide's control. **One seed (42)**, Pika H3 Flex 6-step, all on
the same card. 10 new renders. Metrics as in T5e (vs the same guide's control; frame-0 drift vs the picture).

A check first: the +2 at guide 0.3 re-rendered on the control's card gives **exactly** T5f's numbers from the other card,
so T5f's cross-card comparison holds.

**Results** (seed 42):

| guide | strength | distance | Δdark | Δcold | frame-0 drift (control) | what the clip does later |
|---|---|---|---|---|---|---|
| 0.3 | +1 | 14.9 | +4.3 | +2.2 | 10.7 (12.3) | same dusk, slightly darker |
| 0.3 | +2 | 23.3 | +8.4 | +4.0 | 10.1 | darker platform |
| 0.3 | +4 | 34.3 | +7.6 | +8.7 | 11.3 | a different (yellow-nosed) train, cooler |
| 0.3 | +6 | 40.0 | +2.0 | +5.1 | 13.8 | the camera pushes in close behind her |
| 0.2 | +2 | 22.8 | +7.3 | +4.1 | 18.4 (21.1) | darker |
| 0.2 | +4 | 35.3 | +8.6 | +9.0 | 17.4 | cooler, different train |
| 0.2 | +6 | 46.1 | −4.0 | +6.9 | 23.3 | **a spiky, dragon-like creature head pushes in at the edge** |
| 0.1 | +1 | 15.3 | +5.1 | +2.4 | 30.6 (31.4) | slightly darker |
| 0.1 | +2 | 23.1 | +8.6 | +5.0 | 27.2 | darker |
| 0.1 | +4 | 33.1 | **+12.0** | +10.0 | 25.1 | darker, cooler |
| 0.1 | +6 | 59.2 | +2.8 | **+19.4** | 26.4 | **the woman becomes a skull-faced figure in a leather jacket under a cold overcast sky** |
| text-to-video | +1 | 32.7 | +18.0 | +17.8 | – | cold blue dusk |

**What it shows.**
- **Frame 0 is set by the guide alone.** Drift is ~11 / ~20 / ~28 at guide 0.3 / 0.2 / 0.1 at every strength; the dial
  does not loosen the opening further.
- **Darkening saturates near +8 to +12** (guide 0.1, +4 is the most: two thirds of text-to-video), then *falls* at +6.
  The cold shift keeps growing: at guide 0.1, +6 it matches text-to-video +1 (+19 vs +18).
- **Past +4, sinister changes what is in the scene instead of the light.** At the loosest pins, +6 brings villainous
  content (a creature, a skull figure): the dial's meaning, not its lighting, wins once the picture's hold is weak enough.
  The darkness metric misses this (Δdark can even go negative); the frames do not.

**What it changes.** For a *look* on a given first frame: guide 0.1 with sinister +4 is the strongest look that keeps
the opening (two thirds of the text-to-video darkening); 0.2 and 0.3 keep the opening closer and give about half. At +6 the dial turns into content, which may be the more
interesting creative use: the clip starts exactly on the picture and *becomes* something sinister. One seed: a hint.
Next: a second seed for guide 0.1 at +4 and +6, and the same grid with a content dial (underwater) to see whether content
dials pass a weak pin more easily than look dials.
