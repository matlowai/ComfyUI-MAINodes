# Rectangular aerial correction lab

READ FIRST: Three stills completed; no more runs queued. All generation through Snap in NEW scene scene-mw872icq9prx / shot shot-mw872otnpgmf. No production record, canon, active choice, code, server, install or model change. Native requests/responses/history/output pixels retained. Parent must independently inspect before downstream. No cameraPlate included in any future downstream test by this worker; downstream not started.

## Deliverables

`candidate1.png`: PH3 from ORIGINAL S/N/W only. Fail: oblique camera, added garden/exterior stair layout, reversed south entrance.

`candidate2.png`: Fizgig from ORIGINAL S/N/W only. Better overhead, parallel sides, one north armillary and one inward south stairhouse, but terrace too elongated (~3.5:1 by visible image edges) and central ring slightly stretched north-south.

`rectangle_authored_unharmonized.png` and `rectangle_authored_canvas.png`: authored layered geometry by REMOVING two empty paving bands from candidate2. No whole image stretch. Three RGBA geometry layers, precise crops and positions in geometry_placement.json; reproduce with compose_rectangle.py. About 2:1 is an ARTIST ESTIMATE for the long rectangle, not a recovery of exact dimensions.

`candidate3.png`: final PH3 from authored canvas plus original S/N/W appearance references. Keeps authored rectangle but does not remove the obvious background joins or correct ring roundness. Not a successful seam cleanup. Initial three-still cap reached; no further model runs.

`empty_aerial_authored.png`: final CPU-authored reference for review. Floor band only locally corrected 10% north-south to circularize the generated ring; parallel terrace perimeter and landmark sizes/positions preserved. Decorative backdrop replaced using a continuous trees-only crop. Exact source boxes, transforms and limitations in rectification_manifest.json; ring_floor_corrected_layer.png and backdrop_mask.png preserved; reproduce with rectify_floor.py. This is an authored layered textured reference, not an exact reconstruction or unmodified native generated result.

## Whole image review against originals

Original location@3 notes explicitly require long north-south rectangle, north brass armillary, south stairhouse and ROUND central engraving. W shows materials/ring/rail but excludes both ends. S/N show opposite landmarks, broad ring and side walkways. Their perspective does not yield a trustworthy exact aspect ratio or dimensions; the original schematic plan does not turn its arbitrary ellipse dimensions into measured geometry. No previous square aerial was used as conditioning or geometry authority in this lab.

Final authored image: one empty long rectangle, one armillary top/north, one stairhouse bottom/south with inward steps, round central ring, left/west light. Ring diameter approximately 400 pixels vs clear floor width approximately470 (~.85); the S/N source views suggest a somewhat smaller ring relative to usable floor, possibly .65-.75, but this remains uncertain without a supported camera reconstruction. Side walkways are narrow. Circle size / source scale consistency is the main unresolved concern; do not describe the result as exact. Slight rail/pedestal vertical faces remain, so call it near-orthographic, not an exact ortho survey. Minor floor strip joins remain. Decorative backdrop stretching is outside the terrace and does not establish set geometry.

No actor collage prepared: correct empty reference review is first. Existing genuine overhead actor cutouts can be placed Liora SOUTH facing NORTH and Corvin NORTH facing SOUTH after parent review, recalculated from this new circle/rectangle. Previous left/right placement must not be reused.

## Verification limits

Every native candidate and final authored image viewed whole, alongside original W/S/N. Formal Snap docket verdicts are still DUE; candidate1 row was briefly claimed/read whole and tiles metadata, then released without writing because full packet review was incomplete. Do not equate this report with formal critic approval. Parent independent visual review remains necessary.

## Execution timings

GPU1 RTX5090; saved history execution intervals (excluding bridge/inspection/CPU work):

| run | take | seed | seconds |
|---|---|---:|---:|
| 1 | take-d4988751-1bf5-4ff6-9739-b3ad45f25b19 | 886101 | 25.061 |
| 2 | take-6e9e6a15-86aa-493f-8bd0-dbd78df1f28b | 886102 | 83.967 |
| 3 | take-4d21ef39-71c4-42a4-9e67-d19992198365 | 886103 | 30.770 |

No commits, pushes, downloads, installs, deletions or restarts.

## Additional single CPU variant requested by coordinator

`empty_aerial_ring70.png` is the empty reference with the actual textured ring reduced uniformly, now about320px visible diameter /470px clear floor width (~.68, the requested approximate .70 artist estimate). Ring centre590,650. Rectangle and landmark scale are preserved exactly; image difference is limited to the central floor. Adjacent unmarked paving pixels fill the vacated annulus, locally feathered3px. No further model render.

`aerial_ring70_duel_raw.png` places genuine overhead Liora south at590,855 facing north and Corvin north at590,450.5 facing south, each silhouette about60px wide, outside opposite ring edges. No 2D rotation needed because original overhead sources already face the desired directions. Both were inspected whole; two people, one wand each. Actor scale is a hand-chosen visual estimate. Contact shadows/lighting/matte fringes are unharmonized. The paving fill has repeat/tonal seams and a small left-edge crescent/side-shadow discontinuity; do not describe it as seamless. It is a raw authored layout reference.

Exact geometry/alpha/source hashes and actor transforms: `ring70_duel_placement.json`; reproduce with `compose_ring70_duel.py`. Preserved layers: `ring70_textured_ring_layer.png`, `ring70_paving_layer.png`, `ring70_vacated_annulus_mask.png`, `liora_ring70_layer.png`, `corvin_ring70_layer.png`. Earlier authored/native files remain. Root independently reviews before the aerial-plus-character-only new-camera test. No camera plate belongs in that test.

## User selection after review

The user preferred native `candidate2.png` for the next test. It is the selected aerial, rather than the authored2:1 or ring70 variants. The2:1 target and ring-width adjustments were artist estimates, not established measurements. Candidate2's elongation is a limitation to track, not a reason to reject the executable user choice. Next input set is native aerial + two clean character references only; no camera plate.
