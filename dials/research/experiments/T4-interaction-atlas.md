# T4: which dial pairs interact, and does input cosine predict it? (2026-11-06)

**Question.** Two dials in one rack add their pushes before the DiT. Does the result behave like the sum of the two
single-dial results, and does the cosine between the two pushes (what the rack's overlap readout shows) predict how
they combine?

**Setup.** Six pairs chosen to span the signed cosine of the applied pushes (−0.52 to +0.72). For each pair and seed:
dial a alone, dial b alone, a + b (two rack rows), and the control. Pika H3 Flex 6-step, text-to-video, train-platform
scene, seeds 42 and 43, all on one GPU with its own controls. 31 new renders (pair 1 reused earlier arms). Interaction
residual per metric: m(a+b) − m(a) − m(b) + m(0), on colour temperature, brightness, contrast, motion and sharpness;
plus the mean pixel distance of each arm from the control.

**What the renders show** (middle frames, both seeds; grid sheets in the private study log):

| pair | signed cos | a alone | b alone | a + b (both seeds agree) |
|---|---|---|---|---|
| p1 oil_pixel −3 + datamosh +2.25 | −0.30 | photoreal period drama | crisp subject, glitch background | **an actual oil painting** (emergent) |
| p2 sinister +1 + memory +3 | +0.08 | cold, dim | hazy, faded | a blend: dark, hazy, silhouetted |
| p3 vhs +1.5 + film_artifact +3 | +0.72 | older train, softer | desaturated, older | **the scene is gone; the film medium itself**: a scratched, dusty film-leader frame (s42), an orange film burn (s43) |
| p4 psychedelic +1.5 + claymation +2 | +0.26 | warmer, mild | claymation toy world | **a new style**: a glowing, blacklight-lit claymation toy world |
| p5 evil cold +1.5 + warm–cold grade −1 | −0.52 | cold, overcast | warm, sunset kept | **cancels**: close to the warm control |
| p6 order_entropy +3 + motion −2 | −0.35 | debris, running | sitting still on a bench | motion cancels the running; some decay stays (a worn train, standing still) |

Mean pixel distance from the control (0-255), seed 42 / 43:

| pair | a | b | a + b |
|---|---|---|---|
| p1 | 71 / 69 | 74 / 76 | 73 / 69 (but 81-89 from each part) |
| p2 | 33 / 34 | 74 / 43 | 63 / 56 |
| p3 | 35 / 43 | 61 / 73 | **91 / 91** |
| p4 | 45 / 60 | 59 / 63 | 63 / 69 |
| p5 | 59 / 36 | 33 / 37 | 32 / 36 |
| p6 | 75 / 64 | 83 / 70 | 60 / 70 |

The per-metric interaction residuals were large and inconsistent between seeds (|residual| often above the sum of the
single effects), because a dial restages the scene. Whole-frame metrics don't add even when the pictures do. The sheets
are the evidence here.

**What it shows.**
- The **sign** of the pushes' cosine predicts reinforce vs cancel in 5 of 6 pairs (p5 and p6 cancel; p2, p3, p4
  reinforce). The exception, p1 (−0.30), produces something new instead of cancelling.
- The cosine does **not** predict *emergence*: three pairs (p1, p3, p4) produced results neither dial gives alone, at
  cosines −0.30, +0.72 and +0.26.
- Two aligned dials can cross into a medium neither reaches alone. Film-artifact alone never produced grain or scratches;
  with VHS (+0.72) it went straight to film stock, without the scene.

**What it changes.**
- Gate: cosine predicts direction but not emergence, so the rack's overlap readout needs a caveat (reinforce/cancel only).
- New node T4b: scan vhs + film_artifact at lower strengths for a window that keeps the scene *with* film texture (as
  datamosh has at +2.25).
- Lab candidates: psychedelic + claymation (glowing toy world), and the film combination once a scene-keeping window is
  found.
