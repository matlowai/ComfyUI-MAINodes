# Overhead map continuity trial — 2026-11-08

READ FIRST: this is an exploratory trial through existing Snap tools, not a trained six-view model or a reconstruction system.

User goal: a poor man's world-state reference until the map/arrows → six-camera-view LoRA is ready. Preserve the terrace's dark engraved circle and fixed landmarks relative to named character marks; edit an overhead map after accepted terrain damage, item placement or movement, then use that state to stage later views.

Hypothesis: H3 image editing can translate a marked overhead map and existing appearance references into camera views that preserve these relations with few rerolls. Untested at start. Any success from a few images establishes feasibility only, not usual reliability, exact geometry or 4D splats.

## Trial boundaries

- Use a separate Snap scene/shot and local candidates. Preserve the duel's records, active takes and current preview.
- Reuse installed H3 image paths and existing original-character/location references. No downloads, paid API or public actions.
- Existing location.plan/map remain unchanged; experimental annotations go in separately named test artifacts.
- Pair seed(s), method, dimensions, camera prompt and visual references. A control omits the map; the guided arm includes it. No more two seeds per comparison cell.
- Ask the editor to produce a clean camera view, never arrows/labels in the scene. Check arrow/text leakage and accidental overhead camera targets.
- Verify the map itself preserves the original circle and terrace landmarks before downstream use. Do not silently canonicalize an inaccurate model-produced map.
- After an observed take, distinguish intended state, model observation and accepted state. Reject unwanted damage/movement instead of updating the map to preserve a model mistake.
- Before video, use a checked clean board plus relevant Cast references. A direct annotated-map video reference would be a separate unproven arm, not an automatic default.

## Checks fixed before viewing candidates

1. One unchanged engraved ground circle; armillary north and stair house south remain on the same terrace.
2. Correct count, identity, position and facing of both named people relative to the circle and each other.
3. For an aftermath state: terrain fracture region and any moved object persist in the right world region when the camera changes.
4. Camera matches the requested side/height; no accidental overhead framing or copying of an unrelated reference.
5. No drawn arrows, camera wedges or labels leak into the clean shot.
6. Record wall time, seeds, all candidates including failures, and whether a changed approach was needed. Do not count reroll selection as evidence of reliability.

## Status

Design scout and test calls in progress. All tool responses and generated artifacts live in `map_continuity_2026-11-08/`. Results will be appended here after visual checks.

## Results — 2026-11-08

Eight P-H3-Image stills completed through Snap; no video. The separate Fizgig H3 still model and Qwen 2.1 editing were not tested in this run. Full report: `map_continuity_2026-11-08/trial/TRIAL_REPORT.md`; side-by-side page `map_continuity_2026-11-08/trial/index.html`.

- H3 annotation attempts lost labels and/or duplicated actor dots, so map annotation switched to existing deterministic draw_set_plan on an experimental copy.
- H3 added the requested north-circle damage to that map first try, preserving the circle/landmarks/actor marks.
- One paired camera view improved actor centreline/facing and damage placement with the map; the other failed camera/feet placement in both arms. The map is promising as explicit state but not yet a reliable exact spatial controller.
- A final-placement map edit moved the actor/facing but overshot onto the west boundary and dropped one label: partial only.
- One seed per camera cell; 8 total stills incl preparation; graph execution wall sum145.893 s, first graph start to last end441.907 s. Original production location head/body unchanged and no production take replaced. Page released.

## Follow-up: both H3 paths and exact Qwen2.1

The user explicitly requested the other H3 image model before Qwen2.1, plus both set-design review and research. Fizgig completed four matched stills: coarse north-camera alignment and damage transfer improve with the map, but exact feet/ring/camera placement still fails. Full report: `map_continuity_2026-11-08/fizgig/REPORT.md`.

Native Qwen2.1 is now an explicit development `qwen21_view` method, following the official original edit workflow through existing Snap context/queue/candidate paths. Three real isolated Snap runs succeeded; zero exact-continuity passes: map movement duplicated markers/broke boundary; side view kept camera better but changed armillary scale/position and put feet on ring bands; north view put Corvin inside the circle and cracks centrally. See `map_continuity_2026-11-08/qwen21/REPORT.md`. Its first-reference canvas and model-native recipe differ from Fizgig; do not treat this as a sampler-isolated benchmark or a direct map-benefit ablation for Qwen. No new video or production take was made.

Fifteen stills total: eight P-H3 including preparation, four Fizgig, three Qwen. The coordinator independently viewed the map and all camera results, read the code diff, reran the focused Qwen graph test, checked syntax/JSON/YAML, and compared served lab edits/tools JS bytes to development sources. Full U101/UI/regression gate and production landing remain undone; the real-model lab must not run placeholder-model tests. The lab page/window/server were stopped after capture; main stays pinned G17a.

Open `map_continuity_2026-11-08/MODEL_COMPARISON.html` for guided candidates from all three models, clickable native images, map edits and no-map controls. `MODEL_COMPARISON.jpg` is the overview. Opened locally at the user's request.

The useful next experiment is a target-camera guide with projected floor geometry and actor foot anchors before generative finishing; this is a research recommendation, not an implemented or verified controller. Existing symbolic maps are useful review/state aids, but the tested recipes do not yet support the few-reroll exact-continuity hypothesis.
