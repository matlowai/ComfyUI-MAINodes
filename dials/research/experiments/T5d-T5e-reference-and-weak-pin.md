# T5d / T5e: a reference instead of a first frame, and a weak first-frame pin (2026-11-06)

**Questions.** T5-T5c: a first frame pins a look dial in image-to-video (sinister's darkening vanishes). **T5d:** does a
Ref2V *reference* picture pin less? **T5e (suggested by Dylan):** hold the first frame only weakly ("pinned frames not
fully pinned, a conditioning factor below 1") and see how far the dial's look comes back.

**Setup.** The same picture (first frame of the text-to-video control). T5d: Render Preset conditioning *Ref2V*, the picture
on H3 References, prompt prefixed "The scene of <Picture 1>." T5e: image-to-video with H3 Cond Strength guide strength
0.3 and 0.1 (the first frame's condition rows blended with noise: `aug · rows + (1 − aug) · noise`; default 0.999), each
with its own no-dial control. Sinister +1, seeds 42 and 43, Pika H3 Flex 6-step. 11 new renders; 0.999/0.8/0.5 from T5/T5c.
"Frame-0 drift" = mean pixel difference between the first rendered frame and the given picture (320 px).

**Results** (sinister vs its own control; both seeds, mean):

| first-frame handling | distance | Δdark | Δcold | frame-0 drift |
|---|---|---|---|---|
| first frame, default pin 0.999 | 8.8 | −0.2 | +0.2 | 4.0 |
| guide 0.8 | 11.3 | +0.3 | 0.0 | 5.2 |
| guide 0.5 | 10.6 | +1.4 | +0.5 | 7.0 |
| **guide 0.3** | 13.7 | **+4.4** | +2.2 | 11-12 |
| guide 0.1 | 15.2 | +4.8 | +2.5 | 30-31 |
| **Ref2V reference** | 11.9 | −0.5 | +0.1 | 4.0 |
| text-to-video (reference point) | 32.7 | +18.0 | +17.8 | – |

Contact sheets: at 0.3 and 0.1 the sinister arm is a little darker and moodier than its control but still the same warm
dusk; nothing like the cold-blue sinister of text-to-video. The Ref2V arms show no visible change. The Ref2V control does
reproduce the picture's composition, so the reference is in use.

**What it shows.**
- Loosening the pin trades fidelity for effect, smoothly: darkening rises 0 → +1.4 → +4.4 as the guide strength drops
  0.999 → 0.5 → 0.3, while frame 0 drifts 4 → 7 → 12. Below 0.3 the drift grows (31 at 0.1) without more effect.
- Even at the best trade-off (0.3) the dial gets about a quarter of its text-to-video darkening, a visible but subtle shift.
- A Ref2V reference pins the look as strongly as a first frame (on this scene, with this prompt).

**What it changes.** Weak conditioning is a real but small lever: guide strength ~0.3 is worth trying when a look dial
must act on a given first frame and some drift in the opening is acceptable. The stronger advice stands: apply look dials
when *making* the first frame. T5e (b) (a soft pin in the latent with a fractional denoise mask) remains open; this result
suggests it would face the same trade-off, so it is lower priority.
