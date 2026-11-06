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
| T5d | Does a Ref2V reference pin a look dial less than a first frame? | the same picture as a Ref2V reference, sinister +1 vs control, 2 seeds | ~4 renders + graph work | If darkening returns with a reference, recommend references over first frames for look dials | T5c | **done**: [a reference pins as hard as a first frame](experiments/T5d-T5e-reference-and-weak-pin.md) |
| T5e | Weak first-frame conditioning: how far can the pin be loosened? (Dylan's suggestion) | (a) guide noise-aug strength 0.3 and 0.1 with own controls, 2 seeds: where does darkening return, and when does frame 0 stop matching the picture? (b) a soft pin in the latent instead of condition rows: the picture in frame 0 of the latent with a fractional denoise mask | (a) 8 renders; (b) a small init-latent graph | A strength where the dial's look returns while frame 0 still matches → a recipe | T5c | (a) **done**: [0.3 gives ~¼ of the look with mild drift](experiments/T5d-T5e-reference-and-weak-pin.md); (b) open, lower priority |
| T5f | At a loose pin (guide 0.3), does more strength reach the look? | sinister +2, +3 at guide 0.3, 1 seed | 2 renders | A strength that adds darkening without moving frame 0 | T5e | **done**: [+2 doubles darkening to ~half of text-to-video, sky stays warm](experiments/T5f-strength-at-weak-pin.md) |
| T6 | Is a dial made on one H3 family valid on another? | Make the same dial on FL2VA and Ref2VA weights; compare cosine and size | offline | If cos < 0.9, dials need a family/recipe tag check (and that may explain weaker image-to-video) | – | **done**: [cos ≈ 0.99, same size](experiments/T6-family-fl2va-ref2va.md); no family check needed |
| T7 | Can covariance whitening act as an automatic hold? | v_white = (XᵀX + εI)⁻¹v using A-side token activations (DeTangle / CCS idea) on dials with known leaks (evil cold → colour temperature; expressive face → loudness) | offline + ~16 renders | Leak reduced at matched target effect vs today's hold | T1 | blocked |
| T8 | Compensator ("functional hold") | Fit a small blend of probe directions from measured render responses to keep the target and cancel a side effect | ~60-100 renders | ≤ +1 dB loudness at the plain face dial's effect (today's hold: +1.7 dB) | T7, face panel | blocked |
| P1 | Face-visible preservation panel | 4 scenes with visible faces + dialogue; ArcFace identity (weights on disk), WER, loudness | setup | needed for identity claims | – | ready |
| X1 | Audio-only pushes | A dial on the audio stream only (inverse of `audio: protect`) | needs an A/V split | – | – | parked |
| X2 | Lexical readout of a dial (jacobian-lens) | What words a vector boosts | – | – | – | **moved to the J track (J4)** |


### J track: the Jacobian lens (proposed 2026-11-06)

Ideas, constraints and sources: [2026-11-06-jlens-ideas.md](2026-11-06-jlens-ideas.md). The blocker: H3's text encoder is
Qwen3-VL-32B cut after layer 50 of 64 (no final norm, no output head), so a lens needs the upstream tail. One seed and few
arms per test until something is worth confirming.

| id | question | method | cost | gate | depends on | status |
|---|---|---|---|---|---|---|
| J0 | How did the collaborator do it? | the 7 questions on the ideas page | – | answers decide J2 vs J3 order | Dylan posts | awaiting Dylan |
| J1 | Are H3's 50 encoder layers upstream Qwen3-VL-32B's? | download upstream shards 11-14 (~17 GB: layers 48-63, final norm, output head); hash layers 48-49, which both files hold | download + offline | identical → route A; different → route B/C only | – | ready |
| J2 | Does a logit-lens keyword dial work (no Jacobian)? | output-head rows for a word list → layer-50 space → condition_proj + refiner; medieval and blizzard vs pair dials made from matching pairs | offline + 4 renders (1 seed) | cosine to the pair dial ≥ 0.5 and a visible effect at matched push vs placebo | J1 | blocked |
| J3 | True J-lens keyword dials | fit J_50 on the upstream tail (layers 50-63 in bf16, ~100 H3-style prompts), v = Σ J_50ᵀu_w | ~1 GPU-hour fit + 4 renders | beats J2 at matched push, or J2 already enough | J1 | blocked |
| J4 | What do our dials say? (verbalize) | map 10 shipped dials back to layer-50 space, read top words with J2's or J3's decoder; compare with measured wheel leaks | offline | words predict ≥ half of the measured leaks | J2 or J3 | blocked |
| J5 | Do combos say new words? | read the 6 T4 pairs: a+b vs a, b | offline | new words rank the 3 emergent pairs above the 3 others | J4 | blocked |
| J6 | Is the first-frame pin an attention effect? | forward hooks: DiT cross-attention mass on text vs vision rows, per block/step, t2v vs i2v | 2 renders with hooks | text-row mass drops in i2v → test text-row key rescaling | – | ready |
| J7 | DiT impulse pictures | one low-resolution step, dial on vs off, decode the x0 difference (video and audio) | ~5 forwards | the pictures predict the rendered look of 3 known dials | – | ready |
| J8 | Weird word dials | emoji, onomatopoeia, abstract words, away-from dials (M6, M7 on the ideas page) | 1 render each | anything surprising goes to the Lab | J2 or J3 | blocked |

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
- **2026-11-06** T5d/T5e(a) done: a Ref2V reference pins the look as hard as a first frame. Weak first-frame conditioning
  trades fidelity for effect: guide 0.3 → darkening +4.4 (text-to-video +18), frame-0 drift 12 (default 4); subtle on the
  sheets. Recommendation: apply look dials when making the first frame; ~0.3 as a fallback.
- **2026-11-06** T5f done (1 seed): at guide 0.3, sinister +2 doubles darkening to +8.4 (text-to-video +18) with frame 0
  unchanged; +3 adds cold, not dark; the sky stays warm. Added the **J track** (Jacobian lens) after a collaborator's keyword-dial
  report; checked that H3's encoder lacks the layers a lens decodes through, so J1 (upstream tail check) comes first.
  X2 folded into J4. Per Dylan: fewer variants, one seed for exploratory renders.
