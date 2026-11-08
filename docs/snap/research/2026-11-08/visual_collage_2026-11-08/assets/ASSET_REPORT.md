> **Geometry correction, 2026-11-08:** the generated overhead has a square footprint; the original scene is rectangular. The coordinator accepted that drift and a later prompt explicitly reinforced “square terrace.” Prior camera outputs also used the original rectangular camera plate and strong placement words; they do not establish the aerial’s contribution or consistent same-set geometry. Image-finishing observations remain, but aerial-only transfer is untested. Read `visual_collage_2026-11-08/AERIAL_GEOMETRY_CORRECTION.md` (from study root); corrected rectangular aerial work comes first.

# Visual collage assets — 2026-11-08

READ FIRST: Finished; page 0ae9c375e5714cee90593e6245ed064b released by codex-visual-collage. All six asset still runs finished. No production Cast, location, board or active choice changed. Work landed only in new scene scene-mw84huh4towi / shot shot-mw84i9rtd774. No installs, downloads, raw diffusion graphs, server changes, deletes or commits.

## Deliverables

- `overhead_raw_collage.png`: actual textured overhead scene plus actual character cutouts facing inward just outside opposite outer circle edges. No symbolic dots or arrows.
- `empty_overhead.png`: final 1792-square P-H3 overhead, one brass orrery centered north/top and one stairhouse centered south/bottom. This is a generated visual interpretation, not measured reconstruction.
- `liora_overhead_rgba.png`, `corvin_overhead_rgba.png`: genuine overhead Cast-derived figures. Deterministic magenta color mattes, NOT SAM. Liora faces top in the source; Corvin faces bottom. Both rotate clockwise 90 degrees for opposing left/right collage placement.
- `liora_front_rgba.png`, `corvin_front_rgba.png`: separate original upright Cast-reference cutouts; never represented as overhead.
- `target_camera_front_collage.png`: S native plate with original full-body figures placed beyond opposite ring edges. Both currently face the viewer. Harmonization must turn their bodies/eyelines inward. This is deliberately a rough position/scale guide, not a completed board.
- `overhead_placement.json`, `target_camera_placement.json`: exact source, crop, placement, scale, anchor and rotation information.
- `cutout_provenance.json`: original file paths, SHA256, crop boxes, matte method.
- `generation_provenance.json`: exact take ids, seeds, models and actual execution wall-clock from saved Comfy history. Full requests/responses/history are saved alongside; `generated_asset_01.png` through `06.png` preserve all generated pixels.
- `prepare_collage.py`: reproducible deterministic mask/composite preparation; run with existing Comfy venv Python at nice19, no model execution.

## Results and limits

| asset/run | seed | wall s | result |
|---|---:|---:|---|
| P-H3 background1, take-e8dcc67b | 84101 | 31.860 | True overhead texture/ring; two stairhouses, three orreries, wrong topology. Preserved as failed source. |
| Fizgig Liora, take-b12f5697 | 84111 | 35.590 | Crown, shoulders, boot tops, one wand; true overhead. Docket crit-1a1bc456f7f-a10a written clean after whole/context review. |
| Fizgig Corvin, take-249a2604 | 84121 | 33.197 | Steep overhead with slightly visible brow/nose, one right-held wand; faces bottom despite requested top. Rotation metadata corrects facing in collage. |
| P-H3 background2, take-535658a1 | 84102 | 19.407 | Duplicate removal worked; retained incorrect same-end landmark placement. |
| Fizgig background3, take-7cfb3308 | 84103 | 58.597 | Correct opposite ends but oblique camera and invented outer gardens/doubled side walls. Not used. |
| P-H3 background4, take-e0d5270a | 84104 | 24.558 | Focused repositioning from background2 puts one landmark at each opposite end; used for final empty overhead. |

Total measured execution wall time: 203.209 s on live GPU1 RTX5090; excludes queue wait, bridge overhead, inspection, matting and notes. First run pays model load. The sixth run had already queued before the coordinator's later suggestion to stop at five and use deterministic landmark patches. It finished usefully; no further stills were generated. Background changes were progressively different tasks/methods, not seed rerolls of the same failing recipe.

The final overhead retains a square terrace whereas original side views imply a longer rectangle, and parapet/pedestal vertical faces are slightly visible. Ring center and radius are hand measured visual coordinates, not survey data. Final actor scale is chosen visually; the source references do not establish metres. Corvin is slightly less vertical than Liora. Magenta matting may leave a thin coloured fringe, and target-camera grey matting can retain original ground shadows. Lighting/contact shadows/eyelines are not harmonized. These are explicit targets for subsequent model edits, blur/feather and partial-denoise trials.

All six images were visually inspected whole. Only Liora received a formal Snap docket verdict during this asset pass; remaining rows are due and no production approval is claimed. No final harmonization was run by this worker.

## Crash recovery and controlled input variants

Recovered from persisted files on 2026-11-08. All six saved histories report completed execution success; each seed
matches its saved request, all execution durations above match history timestamps, and all six preserved generated
PNGs match their original output files byte-for-byte. All four cutout-source SHA256 values still match provenance.
No completed asset was regenerated. Recovery verification is saved in `../variants/recovery_verification.json`.

CPU preparation at nice19 created independent variants in `../variants/`; `manifest.json` records operations,
source hashes, native and output placement coordinates, anchors and source paths. `prepare_variants.py` reproduces
the variants without any model call. Each reconstructed native composite matches the saved raw composite
pixel-for-pixel before resizing. Target camera uses 2016×1152, exactly 1.5× its verified native 1344×768 aspect;
the overhead stays at its verified 1792×1792. All dimensions are multiples of 32. Full-canvas layer scaling preserves
the same transforms and anchors, including half-pixel output coordinates, without independently rounding actors.

| suffix, for both `target_camera_` and `overhead_` | independent operation |
|---|---|
| `A_sharp.png` | Original transformed RGB and silhouette alpha, no extra filter. |
| `B_actor_rgb_blur12.png` | Alpha-normalized Gaussian sigma 12 on actor RGB only; exact original alpha retained. |
| `C_alpha_feather3p5.png` | Inward-only alpha feather, min(original alpha, Gaussian radius 3.5 alpha); RGB unchanged. |
| `D_local_boundary_blur6.png` | Blur A at radius 6 only within the silhouette seam ring, 6px dilation minus 6px erosion feathered 3.5px. Independent of B/C; locally touches floor edges. |

Radii are output pixels. The first outward-feather inspection exposed hidden grey backdrop colours from the
original front cutouts; final C feathers inward to avoid revealing those colours. B intentionally removes facial
and costume detail while preserving the sharp silhouette, making separate clean actor references essential.
D visibly softens character edges and nearby floor only; it invents no contact shadow. These are input
preparations for experiments, with no inference that any variant harmonizes better.

Per-actor sharp RGBA layers and alpha masks, a union actor alpha, a locally expanded/feathered actor support mask,
and a boundary-only mask are saved at each canvas size. White mask means actor/edit support. A/B/C leave pixels
outside actor support unchanged; D leaves pixels outside its named boundary mask unchanged. Automated support
checks passed for every variant. Clean identity/set references were not blurred or modified, and the floor was
never globally blurred. Visual recovery checks inspected raw target/overhead collages, both genuine overhead
actor sources, and target B/C/D at full canvas.

The target-camera input deliberately supplies front-facing proxy actors. An inward body turn and opposing
eyelines must be inferred during generation; results that fail that turn cannot be described as pure placement
failures without accounting for this input limitation. The overhead's square terrace remains a rough visual proxy
for the original rectangular set. No diffusion, partial-denoise, Qwen comparison, production-canon edit or new
formal critique was performed during CPU recovery.
