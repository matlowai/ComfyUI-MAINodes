# Aerial geometry and evidence correction — 2026-11-08

## READ FIRST

The original terrace references show a rectangle; the earlier generated overhead shows a square. The generated
aerial is therefore a conflicting input, not a validated map of the same place. Correct the aerial from the original
set references first, then test aerial + clean actor references only, with no target-camera plate. General placement
is the goal; this does not require metric reconstruction or invented exact dimensions. Corrected asset generation
and runtime tests are separate work; this note records no new model result or production acceptance.

## What went wrong

The defect was explicit in `assets/ASSET_REPORT.md`, but later feasibility wording did not carry its consequence.
`assets/background4_request.json` asked to “Preserve the direct vertical overhead camera, square terrace, perfectly
round central circle”. That prompt reinforced the generated square instead of recovering the source rectangle.
The landmark repositioning result could look convincing while preserving the wrong footprint.

Original references govern the floor footprint, proportions and landmark relationships. A generated aerial does
not acquire authority from visual polish. Canvas aspect and floor footprint are different: a rectangle can sit on a
square canvas. Stretching the square image is not a geometry repair; it deforms the circular ring and other features.
Reconstruct the rectangular terrace from the original sources while keeping the ring circular and checking the
landmarks against those sources. No exact metres are established by this correction.

## What the prior outputs establish

`regeneration/RECOVERY_REPORT.md` records attractive inward-facing P-H3 frames at seeds 881101 and 881102 with broad
ring-relative placement. Their inputs included the existing empty clean S camera plate, clean actor references,
the conflicting square overhead collage, and strong words assigning placement and facing. No matched no-aerial
control was run. The plate and words can explain those frames; the aerial's contribution was not isolated.

Keep the positive observation that H3 and Qwen finished target-camera collages into useful frames, including the
reported differences among sharp, blur, feather and partial-init recipes. The two overhead-reference outputs are
good-looking plate-conditioned frames with a conflicting overhead input and untested aerial contribution. They do
not validate same-world overhead continuity, aerial-only new-camera generation, or usual placement reliability.
The earlier schematic dot/arrow trial still tests a different input and does not settle the textured-aerial route.

## Next comparison

1. Check the corrected aerial against original references for rectangular footprint, proportions, circular ring,
   landmark relationships, actor count, placement, scale, facing and props. Preserve originals and provenance.
2. Generate the requested camera from the corrected aerial collage plus clean actor references only. Supply no
   target-camera plate in this arm. Record exact inputs, words, model, seeds, timings and every result.
3. When attributing benefit to the aerial, compare a matched no-aerial control, holding camera/placement words,
   actor references, size, model recipe and seeds fixed. Keep any plate-conditioned comparison as a separate arm.
4. Judge source-set continuity and general placement before visual finish. No video or production-canon claim
   follows automatically from an attractive still.

Existing production canon/autonomy policy applies; this correction adds no approval gate.

## Documentation change and validation

Canonical `snap-location`, `snap-new-view`, `snap-model-choice` and SNAP-R268 now state source geometry authority,
canvas/footprint separation, the square-aerial confound, the no-camera-plate arm and matched attribution control.
Shared historical reports retain their original observations; this note supersedes their overhead-feasibility
interpretation. No runtime, GPU, code/API, commit, push or delete was performed for this documentation correction.

Validation passed: all three skill YAML frontmatters parsed, their declared rule IDs resolve, R268 has one
definition, and repository `git diff --check` passed. No absolute machine paths were added to canonical guidance.
