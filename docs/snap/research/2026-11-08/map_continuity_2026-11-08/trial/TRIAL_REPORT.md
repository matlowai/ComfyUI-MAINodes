# Overhead-map continuity trial — 2026-11-08

## Result

**P-H3-Image is feasible as a state-editing aid; not yet reliable as a full camera/placement controller in this recipe.** P-H3-Image added terrain damage to a valid annotated overhead plan on its first attempt while preserving the circle, landmarks, positions and facing arrows. Adding that updated plan to a camera-view edit improved north–south actor alignment and crack placement in one paired view. Both side-view candidates still missed the camera and put the people on the oversized ground ring, so this does not establish that overhead maps solve continuity without rerolls.

All eight stills were generated through Snap `edit_from_context`, using `ph3_view` (P-H3-Image int8, eight steps) on the existing :8193 server. No videos, model downloads, production take/board replacements, source-location edits, service restarts or publishing.

## Artifacts

- Side-by-side review page (local evidence: `index.html`): controls left and map-guided right, followed by all preparation images including failures.
- Valid drawn M0 (local evidence: `images/map_draw.png`): one fixed circle, orrery north, stair house south; Liora south facing north, Corvin north facing south.
- H3 damage map M1 (local evidence: `images/map_damage.png`): the same plan with cracks in the north half of the circle.
- Hypothetical placement map M2 (local evidence: `images/map_final_placement.png`): attempts to move Liora west and face east.
- Every request, whole response, actual ComfyUI history and extracted execution time is saved alongside this report.

## Controlled comparison

Two camera requests, one seed each. A/B prompts, dimensions, method and all three appearance pictures are identical within a pair. The guided arm adds only the updated overhead map as Picture 4. All four views are 1920×1088. The controls get the same explicit position, facing and terrain-damage words, rather than a weaker prompt.

| View/seed | No map | Updated map | Reading |
|---|---|---|---|
| W side-on / 880101 | `take-8d87f8d6` — a terrace-end composition, ring under both actors, crack near Corvin. | `take-734cfc2a` — same camera failure and ring under both; crack shape nearer the map's branching form. | **No complete improvement.** Neither follows the requested side-on camera or keeps feet clearly outside the circle. |
| S from stair house toward orrery / 880102 | `take-e61a9040` — Liora nearer camera, Corvin off to the right and facing diagonally; crack off-centre beside him. | `take-43bc34dd` — both people on the terrace's north–south centreline, facing each other; crack carried into the circle's north region. Corvin's feet remain at/on the north rim, not clearly beyond it. | **Useful partial improvement.** Mark alignment and facing are better; exact circle/feet placement is not solved. |

No arrows, dots, labels or map camera jumps appeared in the four clean shot candidates. Exactly one Liora and one Corvin, recognisable costume/appearance and one wand each are present in all four. Cast reference pictures were clean grey-background full-body settei, not location-bearing references.

The W failure was checked against the **actual compiled graph**, not only call arguments. Both W histories load `snap/take-6af5bc8e-e50e-41bb-a9d7-74e5f3040faf_f0.png` as Picture 1, the correct side-on terrace plate; both S histories load `snap/take-1af2ec3b-44eb-4e01-a9b4-951b6dd40900_f0.png`. The PH3ImageConditioning prompt matches the request. Thus this was not a silently ignored plate field. My prompt still names the armillary and stair house even when they should be offscreen in W; that is a plausible camera/framing confound, consistent with the existing “anything named gets drawn” warning, but not causally tested here.

## Preparation and state-update results

1. **H3 annotation attempt 1, seed 880100:** preserved broad diagram shapes, but removed landmark labels/N, made very long arrows ending at the dots, and garbled the legend. Not accepted as M0.
2. **H3 annotation attempt 2, seed 880099:** shorter prompt improved arrows but drew two position dots per actor and again removed landmark labels. Not accepted. Stopped rerolls and changed the annotation method.
3. **Deterministic M0:** existing `draw_set_plan` on a new experimental location copy made 17 shapes, one mark/arrow per actor and clear labels. Aspect 0.7 preserves the original source's round circle in pixel space. No H3 render needed. This is a diagram, not a recovered metric reconstruction of the generated terrace.
4. **H3 terrain update M1, seed 880098:** edited M0 using the picked clash's frame 96 as impact evidence. Added one branching crack cluster at the requested north-circle site and preserved all actor marks, facing arrows, circle and named landmark shapes. **First-try success for this diagram edit.** The chosen north-site mapping is an intended experimental state, not a solved projection of every crack pixel in the video.
5. **H3 final-placement update M2, seed 880097:** moved Liora to the west, changed her arrow/label to face east, removed the old south mark, and preserved Corvin, the central circle, damage and end landmarks. **Partial:** her mark lands on the west boundary rather than just west of the circle with a small gap, and the west-balustrade label disappears. It is not an accepted production state or a faithful exact-coordinate update. No downstream shot was rendered from M2.

The test therefore supports “P-H3-Image can update useful diagram state” more strongly than “this P-H3-Image recipe precisely obeys or preserves every map coordinate.” It does not test the separate Fizgig H3 still model or Qwen 2.1 editing. The user named those alternatives after this eight-image trial; no additional model was run by this worker.

## Cost and provenance

Hardware/server: existing local :8193, reported RTX 5090; this is the pinned G17a live path. Initial source location `location:location-mw795ja4giox@3` stayed at head 3, and its body is unchanged. Experimental copy is `location:location-mw831x93rnbu@2`; scene `scene-mw82xsovplnp`, shot `shot-mw82y0ucnkgt`. All candidates landed there. None was applied as a production take or promoted to canon.

| Image | Seed | Take (short) | Graph execution wall |
|---|---:|---|---:|
| H3 annotation 1 | 880100 | 6679d9f2 | 14.432 s |
| H3 annotation 2 | 880099 | b474b736 | 13.775 s |
| Damage M1 | 880098 | a997689e | 18.713 s |
| W control | 880101 | 8d87f8d6 | 21.893 s |
| W guided | 880101 | 734cfc2a | 29.944 s |
| S control | 880102 | e61a9040 | 12.638 s |
| S guided | 880102 | 43bc34dd | 18.606 s |
| Placement M2 | 880097 | d1b6711a | 15.892 s |

Total graph execution wall sum **145.893 s** (includes backend execution/load in each graph, not a GPU-kernel-only timer). First graph start to last graph end **441.907 s**; inspection, tool calls and queue gaps account for the rest. No camera seed rerolls. The two failed map-annotation recipes are included in the eight-image budget and not hidden as discarded prep.

## Set-design reading

The camera failure affects the whole set, not only the circle. Both W images turn the requested side-on balustrade view into an end-of-terrace composition and introduce a central armillary with a different all-brass stand rather than preserving the source set's stone-pedestal design. The guided S image more closely retains the long terrace, repeated pale balusters, north armillary on stone pedestal, mountains and dusk appearance, but actor scale/feet distance from the circle are still not exact. Later comparisons should score the full camera/layout/architecture/scale/lighting across views, alongside individual props and damage.

## Next useful test

Keep deterministic actor marks and circle coordinates. Use H3 to apply a small terrain/state change and compare unchanged anchors. For a new clean shot, anchor the exact camera plate first and remove all offscreen landmark nouns from the W prompt; test the same minimal camera-only prompt in both map/no-map arms. Use explicit feet just outside the circle in the board, then inspect before video. Do not append an annotated map to ordinary H3 video References by default.

A few stills cannot establish six-view synchronisation, temporal continuity, few-reroll reliability, exact camera geometry or a usable 4D splat. The future six-view LoRA remains a separate, stronger model of that contract.

## Live instructions verified

Resolved edit instructions include `instruction:note-mw82wwsj88wh@1` (global sequence continuity) and `instruction:note-mw82wye2gon8@1` (provisional map workflow). Export instructions include global plus `instruction:note-mw82x01gy76y@1` (assembled export review and honest listening limits). Whole resolved responses are saved. No skill-override or permission changes were made by this trial.
