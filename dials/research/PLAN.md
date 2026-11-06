# Dials research plan (living)

This page is the single source of truth for the running research: the goal, the experiment queue with its gates, and
a log of every revision. It is updated after each experiment, from what the outputs showed.

## Goal

Make Dials more **predictable and more useful** without giving up what makes them good (tiny files, no training, no
extra model calls at render time):

1. **Cleaner directions:** more of the intended change per unit of collateral change (identity, layout, speech).
2. **Known interactions:** know which dials combine well, which fight, and why, including useful surprises.
3. **Works with references:** dials that keep their strength in image-to-video and reference-to-video, not only
   text-to-video.
4. **Audio-aware:** dials that can leave speech alone, or act on the soundtrack on purpose.
5. **A library worth sharing:** interesting dials with their pairs, evidence and honest strengths.

Success is measured against the current Make Dial (whole-prompt mean, 3-dim debias, all rows shifted) at **matched
push** (strength × vector size) and against a **size-matched placebo**, on held-out scenes and at least 2 seeds before
anything is called a result.

## Ground rules

- Every render: Pika H3 Flex 6-step unless an experiment says otherwise, its own control (same seed, same GPU),
  launched from a saved workflow. Contact sheets are looked at before any verdict; temporal claims need playback.
- Numbers carry seeds, scenes and metric names. One seed is a hint, two seeds a finding, held-out scenes a result.
- Simple first: a new method has to beat the plain dial at matched push before it earns more machinery.
- Rendering stays free: extraction, fitting and analysis are offline; nothing adds model calls to a normal render.

## Queue

Status: **ready** (can start), **blocked** (waits on another node), **running**, **done**, **parked** (idea, no slot).

| id | question | method | cost | gate (what decides the next step) | depends on | status |
|---|---|---|---|---|---|---|
| T1 | Do a few tokens dominate Make Dial's whole-prompt mean? | Per-token audit on 5 shipped dials: encoder (5120) and post-refiner (5376) norms per token, each token's share of the pair difference, the first token's share | offline, minutes | If ≤ 3 tokens carry > 30 % of the difference energy, test sink-excluded pooling (T2). Report shares either way | – | **done**: [first token carries < 0.3 % after the refiner](experiments/T1-token-audit.md); sink exclusion dropped |
| T2 | Do other poolings give a better direction? | Build variants of 3 dials (sinister, datamosh, oil_pixel): whole mean (today), first token excluded, differing span only | offline | Variants that are near-identical to today's (cos > 0.97) are dropped before rendering | T1 | **done**: span variants kept for sinister (0.94) and memory (0.965); others dropped; undefined for plain-vs-featured |
| T3 | Is a better-looking variant actually better, or just bigger? | Render sinister and memory span variants at matched push vs the shipped dials, 2 seeds + the office scene | 7 renders | Keep a variant only if it moves the target more (wheel metrics + sheets) at equal push with no more collateral | T2 | **done**: [no clear gain at matched push](experiments/T3-span-pooling-matched-push.md); not adopted as default |
| T4 | Which dial pairs interact, and does input cosine predict it? | Factorial: a, b, a+b, control for 6 pairs × 2 seeds; interaction = f(a+b) − f(a) − f(b) + f(0) on pixel metrics + sheets | ~38 renders | If cosine doesn't predict interaction, the rack's overlap readout needs a caveat; promising combos go to the Lab | – | **done**: [sign predicts reinforce/cancel 5/6; emergence unpredicted](experiments/T4-interaction-atlas.md) |
| T4b | Is there a scene-keeping film-texture window? | vhs + film_artifact at reduced strengths (e.g. 0.75+1.5, 1+2, 1.25+2.5), 2 seeds, find where film texture appears before the scene goes | ~12 renders | A window where grain/scratches/burns show and the platform is still recognizable → Lab + skill note | T4 | **done**: [no scene-keeping damage window; 1.25+2.5 = moody 'shot on film' look](experiments/T4b-film-window.md) |
| T5 | Do vision-row and dialogue-row masks help? | Experimental apply option: leave vision rows (tag 0) and/or `<d>…</d>` rows unshifted. Ref2V scene and the dialogue scene, 2 dials × 2 seeds | test node + ~16 renders | Vision mask: does the dial keep its strength with a reference without breaking it? Dialogue mask: speech kept at the plain dial's picture effect? | – | **done** (vision half): [dials ~4× weaker in image-to-video; mask doesn't restore it](experiments/T5-vision-row-mask-i2v.md); dialogue half deprioritized |
| T5b | How much strength does a look dial need in image-to-video? | sinister at +2, +3, +4 in image-to-video, 2 seeds, vs its +1 text-to-video effect | 6 renders | Report the strength that matches text-to-video +1 (distance and darkening); a rule of thumb for users | T5 | **done**: [more strength doesn't bring the look back](experiments/T5b-i2v-strength.md) (+4: no darkening) |
| T5c | Does loosening the first frame let a look dial act in image-to-video? | H3 Cond Strength guide strength 0.8 and 0.5 (noisier first-frame conditioning), with and without sinister +1, 2 seeds | 8 renders | Darkening returns while the first frames still match the picture → a practical recipe | T5b | **done**: [barely (+1.4 darkening at 0.5)](experiments/T5c-loose-first-frame.md); advice: apply look dials when making the first frame |
| T5d | Does a Ref2V reference pin a look dial less than a first frame? | the same picture as a Ref2V reference, sinister +1 vs control, 2 seeds | ~4 renders + graph work | If darkening returns with a reference, recommend references over first frames for look dials | T5c | running (control checked: the reference is used) |
| T5e | Weak first-frame conditioning: how far can the pin be loosened? (Dylan's suggestion) | (a) guide noise-aug strength 0.3 and 0.1 with own controls, 2 seeds: where does darkening return, and when does frame 0 stop matching the picture? (b) a soft pin in the latent instead of condition rows: the picture in frame 0 of the latent with a fractional denoise mask | (a) 8 renders; (b) a small init-latent graph | A strength where the dial's look returns while frame 0 still matches → a recipe | T5c | (a) running; (b) design |
| T6 | Is a dial made on one H3 family valid on another? | Make the same dial on FL2VA and Ref2VA weights; compare cosine and size | offline | If cos < 0.9, dials need a family/recipe tag check (and that may explain weaker image-to-video) | – | **done**: [cos ≈ 0.99, same size](experiments/T6-family-fl2va-ref2va.md); no family check needed |
| T7 | Can covariance whitening act as an automatic hold? | v_white = (XᵀX + εI)⁻¹v using A-side token activations (DeTangle / CCS idea) on dials with known leaks (evil cold → colour temperature; expressive face → loudness) | offline + ~16 renders | Leak reduced at matched target effect vs today's hold | T1 | blocked |
| T8 | Compensator ("functional hold") | Fit a small blend of probe directions from measured render responses to keep the target and cancel a side effect | ~60-100 renders | ≤ +1 dB loudness at the plain face dial's effect (today's hold: +1.7 dB) | T7, face panel | blocked |
| P1 | Face-visible preservation panel | 4 scenes with visible faces + dialogue; ArcFace identity (weights on disk), WER, loudness | setup | needed for identity claims | – | ready |
| X1 | Audio-only pushes | A dial on the audio stream only (inverse of `audio: protect`) | needs an A/V split | – | – | parked |
| X2 | Lexical readout of a dial (jacobian-lens) | What words a vector boosts | – | fredbliss is exploring this; borrow when it lands | – | parked |

Budget without the operator: up to ~6 GPU-hours a day across the two cards. Anything that needs a new public node, a
release, or more budget waits for a decision.

## Revision log

- **2026-11-06** Plan created from the overnight findings, the external-ideas review, and the public Discord thread
  (span pooling and masks from fredbliss's control vectors; a 15k-norm first token reported in his jacobian-lens
  work; audio-only pushes). T1 and T4 start first.
- **2026-11-06** T1 done: the encoder's first token is a 51× outlier (replicates the jacobian-lens report) but after the
  refiner it is ordinary and carries < 0.3 % of each dial; sink exclusion dropped. Span pooling differs modestly
  (cos 0.94-0.996, 1.2-1.9× larger); T3 narrowed to sinister and memory at matched push. T4 running.
- **2026-11-06** T3 done: at matched push, span-pooled sinister and memory look and measure close to the shipped dials
  (span-sinister darkens +1.4 to +4.5 more in 3/3 contexts; everything else mixed). The "span is stronger" impression is
  mostly vector size. Not adopted; kept as a possible option for multi-clause pairs.
- **2026-11-06** T6 done: Ref2VA's refiner turns the same pairs into the same direction (motion cos 0.990, same size); family
  mismatch doesn't explain weaker dials with references. T5 (vision-row mask) is now the main test for that question.
- **2026-11-06** T5 started with the vision-row half: a private test node applies a dial to text rows only. Its all-rows
  mode renders bit-identical to the Dial Rack (parity check). Image-to-video arms (first frame from the control) for
  sinister +1 and datamosh +2.25, all rows vs text only, 2 seeds. The dialogue-row half follows.
- **2026-11-06** T4 done: the sign of the pushes' cosine predicts reinforce vs cancel in 5/6 pairs; it does not predict
  emergence (oil+datamosh → painting; vhs+film_artifact → film stock without the scene; psychedelic+claymation → a
  glowing toy world). Added T4b (find a scene-keeping film window). Rack overlap readout needs a caveat.
- **2026-11-06** T5 done (vision half): image-to-video makes sinister ~4× weaker (distance 8.8 vs 32.7; no darkening);
  text-only rows don't restore it, so the first-frame anchor itself is the cause (with T6 ruling out the family). Added T5b
  (strength needed in image-to-video). Dialogue-row mask deprioritized: Pika already kept speech under every evil dial.
- **2026-11-06** T4b done: no setting keeps the scene *and* shows film damage; 1.25+2.5 gives a moody 'shot on film'
  look. T5b done: in image-to-video, sinister +4 still doesn't darken (first frame pins the look). Added T5c: loosen the
  first frame with H3 Cond Strength instead of pushing harder.
- **2026-11-06** T5c done: loosening the first frame (guide strength 0.5) brings sinister's darkening only to about +1.4
  (text-to-video +18). Masking, strength and looser conditioning all fail to override a first frame; advice is to apply
  look dials when making the first frame. Added T5d (reference instead of first frame).
- **2026-11-06** Dylan suggested weak first-frame conditioning (pinned frames not fully pinned, factor below 1). T5c
  tested the condition-row version at 0.8/0.5; T5e takes it to 0.3/0.1 and adds a latent soft-pin variant. T5d running.
