# LayerCraft collage scout — 2026-11-08

## READ FIRST

Read-only source inspection complete; no page driven, GPU job queued, service restarted, download, install or production change. The intended experiment is a textured bird's-eye picture of the real set with real overhead actor cutouts, followed by an image edit with clean identity/set references. The schematic dot-map trial was not the person's proposal. Latest coordinator steering reopens Qwen2.1 for a few more guided collage tests; it is not excluded.

The practical route is available in pieces: native SAM3 segmentation, image transforms and masked image compositing; Snap ph3_view edits an explicit collage as Picture 1 with clean references; dev qwen21_view is the comparison with native <imageN> syntax. A first-class Snap collage assembly/export tool was not found in the inspected live tool table. Do not silently bypass Snap by queueing a side graph: report that missing orchestration boundary. The coordinator owns any build/runtime decision.

## What LayerCraft actually contributes

Sources inspected through the GitHub plugin at main commit afe0441bc53d1d1da518e57125e12852e6042e53; paper read through primary arXiv HTML. There are two distinct implementations in the current repository.

- Original OIN example: a background region is blanked, a separate subject image is provided, and a dual-conditioned FLUX generator integrates the object in that region. It is not simply alpha-pasting the subject followed by a universal harmonizer. The notebook delegates to subject_driven_inpainting.py; its example is 512x512 and uses two OIN LoRAs.
- Newer pipe/layercraft: architect.py produces environment-only background plus ordered named objects with bbox, description, relations and reference requirement. Coordinator validates a region, inserts one object, validates it, then proceeds. image_models.py wraps local FLUX2 Klein background generation, FLUX Fill text insertion and GPT image reference insertion/polish. This is not a reason to install those models or use paid APIs.
- The transferable idea is explicit placement, separate clean object references, insertion order and validation after integration. The existing pipeline's final whole-image polish is an instruction requesting layout preservation; that instruction alone is not a guarantee.

Paper-derived summary (under 200 words): methodology sections 3.2–3.3 describe planning object order/orientation relative to the background and integrating a reference object into a designated masked region. This supports preserving visual intermediate assets and spatial constraints. It does not establish H3 or Qwen collage-preservation performance.

Exact source links:
- [README](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/README.md)
- [Layout planner](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/pipe/layercraft/architect.py)
- [Canvas registry and visual bbox overlay](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/pipe/layercraft/canvas.py)
- [Coordinator insertion and polish](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/pipe/layercraft/coordinator.py#L435)
- [Model wrappers: masks, protected compositing, insertion and polish](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/pipe/layercraft/image_models.py#L146)
- [Original OIN inference](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/subject_driven_inpainting.py#L47)
- [Original notebook](https://github.com/PeterYYZhang/LayerCraft/blob/afe0441bc53d1d1da518e57125e12852e6042e53/OIN-infer/example.ipynb)
- [Paper methodology](https://arxiv.org/html/2504.00010v2#S3)

## Minimal concrete experiment

1. Start from a genuine textured overhead view of the actual set, preserving its doors, furniture, walls and lighting. It is a visual plate, not a coordinate diagram or a symbolic floorplan.
2. Obtain an actual overhead view of each actor matching the camera elevation; keep the correct costume, carried prop and pose visible. Segment each actor into an RGB layer and silhouette mask. A front-view cutout rotated flat on the page is still a front view; 2D rotation only sets screen heading once the overhead view is correct.
3. Set actor footprint/relative size, center position, facing and overlap order explicitly. Resize the actor RGB and mask identically and paste with its silhouette. Keep the textured ground visible between actors and avoid pasted rectangular backgrounds. Keep the collage, each layer and placement data as inspectable artifacts.
4. Use the collage as first image in an edit; provide the clean original actor identities and actual set references separately, with roles explicitly named. Ask for one coherent finished image retaining camera, footprints, general spacing, facing, relative scale and prop ownership while reconciling edges, contact shadows, color and lighting. This is an experiment, not a claim the models enforce those constraints.
5. Compare ph3_view and explicitly selected qwen21_view on the same collage/references and output size. H3 uses <Picture 1>, <Picture 2>; Qwen uses <image1>, <image2>. Judge count, actor centers, footprints, facing, relative scale, props, landmark geometry and contact shadows against the actual collage. A pretty output with moved actors fails placement.
6. If whole-picture regeneration moves the set or actors, try per-actor region integration in overlap order, then local seam cleanup. Snap already supports cropped masked P-H3 paste-back. That guarantees untouched pixels outside the composited mask; it does not guarantee correct content inside it. Do not assume the segmentation model can identify pasted-edge or shadow regions by a vague text name.

No production activation or recommendation until real candidates are inspected.

## Verified local building blocks

| Job | Existing path | Contract / limit |
|---|---|---|
| Segment actor | ComfyUI comfy_extras/nodes_sam3.py:88, SAM3_Detect | Text conditioning, boxes or point prompts; masks output 0, boxes output 1; individual_masks separates detections. |
| Load installed SAM | CheckpointLoaderSimple with sam3.1_multiplex_fp16.safetensors + CLIPTextEncode | Checkpoint exists on disk (1,745,546,848 bytes); no inference quality test made here. |
| Find people in Snap | live web/snap/tools.js:1636 and checks.js:208 | find_people returns numbered boxes and an annotated image; it does NOT expose cutout layers or masks as reusable input artifacts. |
| Scale/crop/rotate | ImageScale, ImageCropV2; comfy_extras/nodes_images.py:940 ImageRotate | Native rotate is 90/180/270 only. Apply the same transform to mask via MaskToImage then ImageToMask; arbitrary heading needs an existing capable transform or a narrow owner-level addition. |
| Paste actor | comfy_extras/nodes_mask.py:80 ImageCompositeMasked | destination, source, x, y, resize_source, mask. Source must already have desired size; resize_source=true scales to destination size, not a target actor box. Mask white means paste source. |
| Soft edges | GrowMask, FeatherMask, ImageBlur, MaskComposite | Existing Snap region edits use these; inspect edges to avoid halos. |
| H3 harmonization candidate | live snap_cards/methods.json:532 ph3_view; web/snap/tools.js:1504 edit_from_context | First image is edited, other images reference it; up to 9 context pictures. Explicit width/height avoids inheriting odd crop dimensions. |
| Local protected correction | live web/snap/edits.js:435 pasteBack | crop edit at ~1 MP, scale back, feather or SAM-derived mask, ImageCompositeMasked, seam report; ph3_view-only. |
| Qwen comparison | dev snap_cards/methods.json:596 qwen21_view | Native separate image sockets; image1 determines canvas; dimensions round to multiples of 32; 25 steps CFG1 Euler/simple. Not present in the inspected live method source. |

The source-level graph for a cutout is CheckpointLoaderSimple → CLIPTextEncode + SAM3_Detect(actor image) → mask; RGB and mask receive matching crop/scale/orientation → ImageCompositeMasked(actual overhead set, actor RGB, x, y, false, actor mask). This is a viable native node path, not a statement that Snap currently exposes the full operation as one agent tool.

Sources on disk:
- comfyui-core/comfy_extras/nodes_sam3.py
- comfyui-core/comfy_extras/nodes_mask.py
- comfyui-core/comfy_extras/nodes_images.py
- live-pack/web/snap/tools.js
- live-pack/web/snap/checks.js
- live-pack/web/snap/edits.js
- live-pack/snap_cards/methods.json
- pack/snap_cards/methods.json

## Results and limits

| Check | Result |
|---|---|
| GitHub read-only access | Worked; exact revision pinned above |
| Original OIN vs current pipe | Separate paths confirmed |
| Local segment and composite nodes | Source and installed SAM checkpoint confirmed |
| Snap mask/cutout export | find_people exposes boxes only; no full collage-assembly tool found |
| H3 placement preservation | Not tested |
| Qwen placement preservation | Not tested in this scout; latest user allows guided comparisons |
| Arbitrary-angle native actor transform | Not verified; core ImageRotate only right angles |
| Mutations | New local research report/artifact snapshots only |

No commits. No GPU results. Open operational question for coordinator: use/build the narrow Snap collage assembly path so a generated composite remains visible with provenance, rather than executing an untracked side graph.
