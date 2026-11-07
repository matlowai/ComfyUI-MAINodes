# T6: is a dial made on FL2VA valid on Ref2VA? (2026-11-06)

**Question.** Dials are made on the FL2VA (first/last-frame) H3 weights and also used with Ref2VA (reference-to-video).
The two checkpoints have different `token_refiner` weights. If a dial's direction changed much between them, dials would
need a family check, and it could explain reports that dials feel weaker with references.

**Setup.** The stored pairs of four shipped dials re-encoded with the same text encoder through Ref2VA's `condition_proj`
and `token_refiner` (int8 pruned weights), raw whole-prompt mean (no debias), compared with the shipped FL2VA-made files.
Offline, no renders.

**Results.**

| dial | Ref2VA-made vs shipped: cosine | FL2VA raw vs shipped (debias effect only) | size Ref2VA / FL2VA raw |
|---|---|---|---|
| motion (no debias) | **0.990** | 1.000 | 64.2 / 65.0 |
| oil_pixel | 0.984 | 0.991 | 61.0 / 61.9 |
| sinister | 0.977 | 0.986 | 41.9 / 42.8 |
| datamosh | 0.928 | 0.938 | 59.9 / 60.0 |

For motion the shipped file *is* the FL2VA raw mean, so 0.990 is the direct cross-family cosine. For the others, the
Ref2VA version sits within 0.01 of where the FL2VA raw mean sits relative to the (debiased) shipped file.

**What it shows.** The two families' refiners turn the same pairs into essentially the same direction at the same size
(cosine ≈ 0.99). Family mismatch does not explain weaker dials with references.

**What it changes.** Gate (cos < 0.9 → needs a family check) not met; no family tag needed for FL2VA ↔ Ref2VA. The lead for
"weaker with references" moves to the reference rows themselves: today's hook also shifts the vision rows, and a reference
anchors the scene (LESSONS: with a reference image the motion dial needed about −6 where text-to-video needed −2).
T5 (leave vision rows unshifted) becomes the next test for that question.
