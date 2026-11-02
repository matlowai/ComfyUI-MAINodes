# H3 De-rope Sigmas

The de-rope pass's sigma schedule, made from stage 1's.

- **inject** (the Simple blueprint's *de-rope amount*): how much of the denoise stage 2 re-runs. The schedule starts at
  the sigma where that fraction is left, on the model's own shift: `percent_to_sigma(1 − inject)`; on H3 (shift 12) that
  is `12·t / (1 + 11·t)` with `t = inject`, so 0.48 gives 0.9172 and 0.50 gives 0.9231. It is continuous: 0.48 and 0.50
  are different schedules.
- Then come stage 1's sigmas below that start: Pika's six knots at 0.48 give `0.9172, 0.8, 0.5714, 0.3333, 0` (4 steps);
  DMAD's `simple` 4 steps give `0.9172, 0.8, 0` (2 steps).
- **steps**: 0 keeps that tail; another number resamples it to that many steps (evenly in step index).

0.48 stays faithful to pass 1's choreography; 0.7 lets the model drift further. H3 Inject Schedule (Motion Lab) instead
cuts whole steps from a scheduler's schedule, so there 0.48 and 0.50 give the same sigmas.
