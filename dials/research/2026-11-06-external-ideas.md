# 2026-11-06: ideas from outside, checked against what we measured

Two inputs arrived the same day: a literature-and-code review commissioned for this project (control vectors,
Heretic, DeTangle, recent steering and DiT papers), and an open conversation in the Banodoco Discord with
[fredbliss](https://github.com/fblissjr) and JohnDopamine, who work on the same idea from the LLM side and the
creative side. This page is our own summary; the review itself stays private, but every source it relied on is public
and listed below.

## How the review was checked

All 41 sources were verified on 2026-11-06: 24 arXiv papers (title and date via the arXiv API, abstract spot-checks for
the claims that matter here), 12 code files (each grepped for the feature credited to it) and 5 web pages. Its H3 facts
match the code: the dial vector is 5376-wide (`token_refiner` output), the text encoder 5120, video patches (1, 2, 2) on a
24-channel latent with 16× spatial and 4× temporal compression, i.e. a 32 px token pitch. Its synthetic math checks
reproduce exactly. Nothing fabricated; three claims are only partly confirmed at abstract level (noted below).

## What it agrees with (and we had already measured)

- Pair agreement can look good for the wrong reasons; equal *vector size* and equal *observed effect* are separate
  comparisons. Our numbers: agreement 0.745-0.845 for working and failed dials alike; a size-matched placebo shows
  what any push does.
- A hold is exact geometry, not exact behaviour (our face dial's loudness hold: +4.8 → +1.7 dB, laughter remained).
- Output interactions matter more than input cosine. We have one large positive example (oil −3 + datamosh → painting at
  cos 0.30, placebo-controlled).

## Ideas worth testing here

| idea | source | why for Dials | status |
|---|---|---|---|
| **Pool only the differing span** of a pair, not the whole prompt | fbliss `differing_span` ([control_vectors.py](https://github.com/fblissjr/ComfyUI-h3-explorations/blob/main/control_vectors.py), [guide](https://github.com/fblissjr/ComfyUI-h3-explorations/blob/main/docs/wiki/control_vectors.md)); fredbliss: "diff_span seems to work best on these effect ones", "whole mean avg token pooling doesn't work super well" | Make Dial means over every token. Test at matched push, so a bigger vector can't masquerade as a better one | planned (PLAN T1-T3) |
| **Exclude attention-sink tokens** from the pooled mean | fredbliss running [jacobian-lens](https://github.com/anthropics/jacobian-lens) on an H3 prompt bank: "found a sink token exclusion that might help a ton" | H3 prompts have no chat template, so a sink would be ordinary prompt text (likely the first token). A per-token audit tells whether a few tokens dominate the mean | planned (PLAN T1) |
| **Leave reference-vision rows alone** | fbliss `mask_vision=True` (vision rows bitwise unchanged) | Our hook shifts every row, vision rows included. Community report: dials feel stronger in text-to-video than with references. Direct test | planned |
| **Output-interaction atlas**: f(a+b) − f(a) − f(b) + f(0) | review (its E06) | Find more "painting"-type combinations; check whether input cosine predicts anything | planned (first loop experiment) |
| **Compensator ("functional hold")**: fit a small blend of candidate directions that keeps the target effect and cancels measured side effects | review, after Heretic's preservation fitting ([ARA](https://github.com/p-e-w/heretic/blob/master/src/heretic/modifiers/ara.py)) and DeTangle's objective ([mechanisms](https://github.com/matlowai/DeTangle/blob/main/docs/mechanisms.md)) | Concrete target: an expressive-face dial that doesn't raise voice loudness, vs today's linear hold | after a face-visible preservation panel |
| **Audio-only pushes** | JohnDopamine: pushing the audio alone "raises the volume but the model tries to match what the audio is doing"; fredbliss: frozen audio guides video | A dial on the audio stream only (the inverse of today's `audio: protect`) | idea |
| Covariance-deconfounded directions | [CCS, arXiv 2610.14025](https://arxiv.org/abs/2610.14025) | Remove confound variation (e.g. evil cold leaking colour temperature) beyond our 3-dim nuisance debias | later |

## Not now

Encoder-tail self-labelling (model self-report; our probe bank + render check covers it), context mixtures and affine
dials (more machinery before the additive dial fails at matched effect; [one-vector-or-many, arXiv 2610.40055](https://arxiv.org/abs/2610.40055)
is counterevidence for mixtures), cross-model bridges, and the spatial-capacity / high-resolution track (a different
problem; [Open-H3-Regenerate-2K](https://nvlabs.github.io/Sana/Open-H3-Regenerate-2K/) would be its baseline, but its
published FastVideo port feeds silence, writes no audio and needs ~150 GB).

## Sources

Code: [fbliss control vectors](https://github.com/fblissjr/ComfyUI-h3-explorations/blob/main/docs/wiki/control_vectors.md) ·
[Heretic](https://github.com/p-e-w/heretic) · [DeTangle](https://github.com/matlowai/DeTangle) ·
[jacobian-lens](https://github.com/anthropics/jacobian-lens) ·
[diffusers H3 transformer](https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/transformers/transformer_minimax_h3.py).

Steering papers (arXiv): [2610.14025](https://arxiv.org/abs/2610.14025) CCS · [2605.06342](https://arxiv.org/abs/2605.06342) SKOP ·
[2605.05220](https://arxiv.org/abs/2605.05220) MidSteer · [2512.03661](https://arxiv.org/abs/2512.03661) DSAS ·
[2603.02237](https://arxiv.org/abs/2603.02237) CHaRS · [2610.40055](https://arxiv.org/abs/2610.40055) clustered OT
(partial: the "collapses to the mean" reading isn't stated in the abstract) · [2605.04980](https://arxiv.org/abs/2605.04980) conceptors ·
[2603.00425](https://arxiv.org/abs/2603.00425) weight↔activation · [2609.32530](https://arxiv.org/abs/2609.32530) Activation Flow ·
[2604.06377](https://arxiv.org/abs/2604.06377) Master Key / UNLOCK · [2410.02355](https://arxiv.org/abs/2410.02355) AlphaEdit ·
[2606.26783](https://arxiv.org/abs/2606.26783) its reproduction · [2610.06383](https://arxiv.org/abs/2610.06383) steering by influence ·
[2410.23054](https://arxiv.org/abs/2410.23054) transporting activations.

DiT papers (arXiv): [2603.23491](https://arxiv.org/abs/2603.23491) Foveated Diffusion (partial: "naive mixed resolution fails"
not in the abstract) · [2610.05816](https://arxiv.org/abs/2610.05816) Level-of-Token · [2610.17227](https://arxiv.org/abs/2610.17227) AReA ·
[2611.01696](https://arxiv.org/abs/2611.01696) · [2611.04416](https://arxiv.org/abs/2611.04416) FLASH ·
[2608.09133](https://arxiv.org/abs/2608.09133) PGSR · [2605.05206](https://arxiv.org/abs/2605.05206) outlier tokens ·
[2603.06351](https://arxiv.org/abs/2603.06351) DC-DiT · [2608.29281](https://arxiv.org/abs/2608.29281) ·
[2609.32882](https://arxiv.org/abs/2609.32882).
