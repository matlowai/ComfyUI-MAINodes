> **Geometry correction, 2026-11-08:** the generated overhead has a square footprint; the original scene is rectangular. The coordinator accepted that drift and a later prompt explicitly reinforced “square terrace.” Prior camera outputs also used the original rectangular camera plate and strong placement words; they do not establish the aerial’s contribution or consistent same-set geometry. Image-finishing observations remain, but aerial-only transfer is untested. Read `visual_collage_2026-11-08/AERIAL_GEOMETRY_CORRECTION.md` (from study root); corrected rectangular aerial work comes first.

# Visual overhead collage experiment — 2026-11-08

## READ FIRST

The requested reference is a textured overhead view of the actual set, with real overhead character cutouts placed
on it, followed by regeneration using clean original references to unify lighting, proportions and spatial cues. The collage
is a general spatial reference; the desired starting frame may use an eye-level or side camera.
The prior 15 stills used symbolic dots/arrows and did not test this pipeline. Qwen2.1 remains eligible for a few
better-guided comparisons alongside H3. No visual-collage feasibility or reliability result is available yet.

This file owns the experiment criteria and task DAG, not production state or runtime orchestration. Existing
production canon/autonomy policy applies; this experiment adds no approval step. The coordinator owns main study
HANDOFF/DECISIONS and live Agent-library notes. Asset/research workers own their artifacts and reports.

## Task DAG

| Task | Depends on | Status | Deliverable |
|---|---|---|---|
| C1 Correct guidance and criteria | clarification + source scout | complete | Canonical location/new-view/model-choice skills and SNAP-R268 |
| C2 Prepare textured overhead set and genuine overhead actors | existing clean references | complete; source limitations recorded | Inspected set plate; actor RGB/alpha layers with camera elevation and prop ownership |
| C3 Compose and inspect actual collage | C2 | complete; A/B/C/D support checks passed | Raw composite plus source/layer/placement manifest; no symbolic replacement |
| C4 Generate requested starting frames with H3 and guided Qwen2.1 | C3 | pending | Matched size/reference roles; a few seeds; prompts, timings, all candidates |
| C5 Judge first-frame results | C4 | native whole-frame review complete; formal packet notes in regeneration | Layout and appearance checks below; failures preserved |
| C6 Try checked frame for video | C5 | conditional, untested | Separate downstream test under selected method contract |

## Input contract

- Textured overhead plate retains the actual set's materials, floor pattern and fixed landmarks. Schematic plan,
  positions, facing and camera marks remain separate metadata/review aids.
- Actors are genuinely viewed from above in the intended pose/costume with the correct props; rotating a front
  portrait in 2D does not meet this requirement. Cutouts have silhouette alpha, not pasted rectangular backgrounds.
- The placement manifest records the coordinate frame, source version, actor center/footprint, relative scale,
  heading, transform and overlap order. RGB and mask receive identical transforms. Preserve raw layers and collage.
- Inspect the raw collage before rendering. Wrong elevation, count, position or scale in that collage is an input
  defect; it cannot establish a model failure to preserve the intended layout.
- H3 gets collage Picture 1 and clean original set/actor references separately. Qwen gets collage image1 with the
  same roles and native image syntax. Originals determine appearance; collage determines layout; model reconciles
  lighting, shadows, edges and spatial/proportion cues. Test two distinct arms: (a) collage assembled in the target
  camera for same-camera harmonization; (b) overhead visual collage plus clean target-camera plates/references for
  an eye-level/side-camera starting frame. Assets include overhead and target-camera source cutouts. Polishing the
  overhead alone does not establish new-camera control. Guidance is an experimental instruction, not an enforcement
  guarantee. Compare size, reference order/roles and seeds; record each model's different native recipe.

## Criteria fixed before candidates

| Check | Pass criterion | Outcome |
|---|---|---|
| Input validity | Actual overhead assets, silhouette cutouts and inspected placement manifest | pending |
| Count and ownership | Exactly intended people and props; each item remains with its owner | pending |
| Layout | Actor centers, footprints, spacing, scale, facing and overlap retain collage intent in the requested projection; compare world landmarks for a new camera, not overhead pixel coordinates | pending |
| Set | Same floor circle/landmarks/materials; no invented layout or unintended damage | pending |
| Appearance | Clean original references retain costume, identity and prop design | pending |
| Integration | Cohesive light/color, plausible contact shadows and clean edges without halos/boxes | pending |
| Camera | Requested output camera retained; distinguish overhead polish from a new-camera starting frame | pending |
| Failure accounting | Every seed/candidate and timing retained, including failures | pending |

Judge layout before polish: a pretty result with moved people fails placement. If two or three seeds of the same
recipe fail, change references, guidance or integration method instead of extending that reroll. A next method is
region integration in overlap order followed by masked P-H3 seam cleanup; unchanged pixels outside paste-back are
protected, while content inside requires inspection. Missing Snap orchestration is a scoped capability gap, not a
license for an untracked side graph.

A small successful trial can support feasibility for its specific assets; it does not prove usual reliability,
exact world geometry or reconstruction. A first-frame edit needs no video-reference experiment first. Direct
collage/map video References can cause top-down targets or mark leakage and remain a separate test. After a picked
take, distinguish intended, observed and accepted state: preserve accepted changes under existing policy, fix
unwanted movement/damage instead of teaching it to the next collage.

## Sources

- `LAYERCRAFT_COLLAGE_SCOUT_2026-11-08.md`: primary-source interpretation and local segmentation/compositing paths.
- `MAP_CONTINUITY_EXPERIMENT_2026-11-08.md`: the earlier symbolic trial; its negative results have narrower scope.
- Canonical pack `.claude/skills/snap-location/SKILL.md`, `snap-new-view/SKILL.md`, `snap-model-choice/SKILL.md`;
  `docs/snap/SNAP_RULES.md` SNAP-R268 and R75.

## Progress

- 2026-11-08: Read pickup, canonical skills/rules, source scout and prior trial. Corrected the artifact contract and
  experiment scope; no runtime actions, generation, install, production change or critic-prompt change.
- 2026-11-08: Updated canonical skills and R268; retained R75 model-selection contract, intended/accepted-state
  policy and existing autonomy. Validation pending. Asset/model outcomes remain pending worker evidence.
- 2026-11-08: Validation passed: repository `git diff --check`; YAML frontmatter parsed for all three changed
  skills; every declared rule resolves to a canonical definition; exactly one R268 definition and next ID unchanged;
  no absolute machine paths in changed skills. Reviewed the changed guidance; no runtime/model outcome claimed.

- 2026-11-08: Clarified both experiment arms: same-camera target-view collage harmonization and overhead general
  reference plus target-camera sources for an eye-level/side-camera starting frame. Output-camera criteria now
  evaluate the requested view; overhead polish alone cannot count as solving a new camera.

## Recovery and expanded input experiments

The desktop/app crash did not interrupt model generation: all six assets were complete and no regeneration had been queued. Their hashes/history and deterministic composites were recovered; see `visual_collage_2026-11-08/variants/recovery_verification.json`. Current A sharp, B actor RGB blur12, C inward alpha feather3.5 and D local boundary blur6 use identical placement/clean references; floor pixels outside each named mask stay unchanged. Target-camera proxies are front-facing and must be turned by the model; overhead actor layers are genuinely viewed from above.

Default reference-only H3/Qwen controls remain distinct from true init-to-collage. A local optional New view denoise path now VAE-encodes Picture1 at the native target canvas and preserves H3 audio; tests cover default equivalence and replay, but native runtime/quality still need the resumed runner. See PARTIAL_DENOISE_SCOUT and img2img/REPORT. No main code deployment or production acceptance is implied.

## Recovered runtime findings

All twelve requested post-recovery stills completed without another model/server failure. The coordinator inspected every whole native output. Raw target-camera collage + clean references produced useful inward-facing H3 and Qwen frames with broad placement retained. H3 heavy actor-RGB blur alone kept front-facing proxies at the tested seed; alpha feather and local boundary softening produced inward-facing results but no clear whole-frame gain over sharp input.

The literal general-reference arm supplied the EMPTY clean S plate, clean actor references and the ACTUAL textured overhead collage: H3 produced inward-facing pairs outside opposite ring sides at both seeds 881101/881102. This is the user's clarified route; it was not tested by the earlier schematic plan trials. It supports small-case feasibility, not usual reliability or exact 3D reconstruction.

True encoded-collage init ran at .7 and .95 for both model paths. Both .7 results retained too much blurred proxy appearance. Stronger .95 restored sharp actors; Qwen turned both inward, H3 left the woman front-facing. H3's .7 tail has only two updates, so do not confuse strength numbers or generalize from that case. All executed histories, exact prompts/inputs, reconstructed schedule traces, failures and timings are in regeneration/. No video or production take has been accepted.

Review page: `visual_collage_2026-11-08/regeneration/recovery_index.html`. Concise poster: `visual_collage_2026-11-08/COLLAGE_OVERVIEW.jpg`. Partial init is local development code with focused and real native checks; full regression gating and main production deployment remain separate.

Complete local review page: `visual_collage_2026-11-08/LEARNINGS.html` — opened at the user's request, includes every input/candidate and the scoped lessons; screenshots and link/filter checks retained beside it.
