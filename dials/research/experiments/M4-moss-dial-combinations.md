# M4: do two MOSS dials combine? (2026-11-08)

**Question.** When a picture-pair dial (M1) and a word dial (M2) are applied together, does the picture get both effects,
or does one cancel or distort the other?

**Setup.** KroMoss + its 8-step DMD2 LoRA, 8 steps, CFG 1, euler / simple, the lighthouse prompt, **seed 7**, 1024², one
render per arm. The single-dial renders come from M1 (KroMoss section) and M2 (KroMoss section); their controls are
pixel-identical, so only the combined render is new. Three pairs, each a style-type dial at ±2 with a weather word dial at
+8 (the strengths at which each works alone on KroMoss).

| pair | dial a alone | dial b alone | a + b |
|---|---|---|---|
| ukiyo-e −2 + snow +8 | a painted illustration, a red-capped lighthouse | a snow-covered headland, pink winter sky | **both**: a flat, painted snow-covered islet; the snow arm's layout |
| film +2 + snow +8 | warm, golden | as above | **film only, snow lost**: a pink faded print with oversized white buildings and dark, snowless rocks |
| detail +2 + rain +8 | ornate houses, greenery | a wet path, a hooded raincoat | **both**: a castle-like mansion, a wet path, the keeper in a hooded raincoat |

**Interaction residual** (mean absolute value of f(a+b) − f(a) − f(b) + f(0), per pixel, 0-255, at 128²): 45.8, 48.7 and
42.4, against single-dial changes of 31-61. In pixel space it is as large as the effects themselves on all three, including
the two that combine well by eye, because each dial on its own already restages the composition. So at this strength the
pixel residual does not separate good from bad combinations; it needs a feature-space measure (or a fixed composition).

**What it shows.** Two of three pairs combine (style + weather, ornament + weather). The failure is instructive: "film 70s"
plus "snow" lost the snow and made the buildings white instead, so a colour or grade dial can absorb a weather word that is
mostly a colour change (snow ≈ white). One seed, one scene: hints. Next: the same three pairs on a second seed; a
feature-space residual (for example image-embedding distances) instead of pixels.
