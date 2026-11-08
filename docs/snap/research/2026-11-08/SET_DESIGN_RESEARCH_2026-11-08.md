# Set design and spatial continuity research — 2026-11-08

> READ FIRST — Research complete; no model download, install, GPU run, browser control or production change. Recommendation: keep Snap's versioned overhead plan as the authority, **project the ground plane deterministically before asking an image model to finish the shot**. Use a coarse 3D blockout when height and occlusion matter. Exact Qwen Image 2.1 is the next relevant editing trial, not evidence that it will honor world coordinates. Six generated views remain a dataset hypothesis, not a reconstructed 4D scene. Raw research is in `set_design_2026-11-08/research/`.

## Ranked options

| Rank | Method and inputs | What is actually controlled | Cost / fit / limit |
|---|---|---|---|
| **1 — smallest useful addition** | Existing overhead map + accepted clean camera plate + at least four well-spread corresponding floor points; OpenCV planar homography; actor **foot** points and persistent crack/decal layer in plan coordinates | Floor circle, terrace footprint, crack site and foot anchors project into the chosen plate together. Same source state can produce both W and S guides. | No new dependency: `cv2` and Pillow are present in the ComfyUI venv. CPU work; small prototype. A plane warp cannot determine body height, rail occlusion or unseen architecture. Poor/contradictory correspondences give poor geometry. |
| **2 — strongest geometry control** | Coarse Blender set: terrace plane, ring texture/decal, stair-house box, rail volumes, orrery proxy, actor stand-ins; explicit cameras | World positions, height, facing proxies, camera location/orientation/lens, landmark occlusion, and persistent damage; render every view from one scene | No need for a detailed character rig or photoreal assets. More initial authoring than rank 1. `blender` is not on PATH in this checkout; availability elsewhere not checked. No installation made. H3/image generation can still change the resulting guide. |
| **3 — best installed model to test next** | Exact Qwen Image 2.1, using a clean projected/blockout shot, Cast refs and tightly marked local edits | Official support for up to ten refs and edits directed by circles, painted annotation or separate masks; useful for turning a geometry-correct guide into a finished board | Already installed per coordinator; Snap method integration is a separate task. Local GPU inference; no measured timing or memory claim here. Editing capability does not establish metric camera control or preservation of unedited pixels. |
| **4 — optional angle proposal tool** | fal's Qwen-Image-Edit-2511 Multiple-Angles LoRA + its **2511** base and one image | Discrete view vocabulary: eight azimuths, four elevations, three distance categories | Useful to propose new empty-set plates, each checked against the plan. Separate model/adapter stack; not a Qwen 2.1 adapter. No evidence here of arbitrary x/y camera translation, focal calibration, or exact multi-actor blocking. Not the first expenditure. |
| **5 — reconstruction aid, later** | MoGe from an accepted image; or overlapping calibrated images into COLMAP / later 4DGS | Estimated geometry/intrinsics or multi-view reconstruction, depending on tool | Can scaffold a blockout, but does not resolve contradictory generated landmarks. New environments/weights and verification required; none installed. Prefer authoring the terrace's few known primitives before reconstructing a hallucinated whole set. |

Rank 1 is an engineering proposal derived from planar projective geometry, not a Snap feature that was implemented or tested today. OpenCV documents the homography between a plane and its image and supplies perspective correction / pose examples. Keep actor feet on that plane; projecting an entire upright person with the same warp would flatten them. Use separately rendered stand-ins for height and occlusion. [OpenCV homography tutorial](https://docs.opencv.org/4.13.0/d9/dab/tutorial_homography.html).

Blender's camera directly defines framing; perspective focal length and orthographic scale are distinct controls. Proposed use: one overhead orthographic export for audit, then perspective W/S camera renders of the **same** blockout, with no regeneration between them. Output the simple color guide first; depth/edge/pose conditioning requires a compatible measured generation path, and must not be assumed merely because a guide exists. [Blender camera manual](https://docs.blender.org/UATEST/manual/en/dev/render/cameras.html).

Qwen 2.1's official repository documents multi-reference editing and annotation/mask guidance. It also describes native RGBA generation/editing, which could help produce reusable actor/prop layers for composition. These are generation controls, not a guarantee that the set remains physically consistent. Test exact installed 2.1 before introducing another image base. [Qwen Image 2.1 official repository](https://github.com/QwenLM/Qwen-Image-2.1).

The fal adapter specifies its 2511 base, `<sks>` trigger, and azimuth/elevation/distance prompt order; it provides a ComfyUI workflow and safetensors weights. Its training uses 3,000+ Gaussian-splat renders. That is evidence for a useful angle-editing prior, not proof that six outputs depict one geometrically identical event. [Author's model card](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA).

## Exact Qwen Image 2.1 edit integration reference

Primary minimal reference: [Comfy-Org's **original 2.1 Image Edit** workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json), also linked by the [Comfy-Org model card](https://huggingface.co/Comfy-Org/Qwen-Image-2.1). Downloaded only that workflow JSON into `research/qwen21_edit_workflow.json`; no model artifacts.

Its graph uses:

| Part | Exact template setting / connection |
|---|---|
| Model | `UNETLoader`: `qwen_image_2.1_int8_convrot.safetensors`, weight dtype `default` |
| Encoder | `CLIPLoader`: `qwen3vl_8b_int8_convrot.safetensors`, type `qwen_image`, device `default` |
| VAE | `qwen_image_2.1_vae_bf16.safetensors`; supplied both to encoding and decoding |
| Conditioning | `TextEncodeQwenImage21`: target and references on separate `images.image_1`, `images.image_2`, ... sockets; positive, negative **and returned latent** go to sampler |
| Cache | model → `QwenImage21Cache(device="auto", dtype="default")` → sampler |
| Sampler | `KSampler`: **25 steps, CFG 1, euler, simple, denoise 1**; no explicit sampling-shift patch |
| Canvas | wrapper `resolution=0`, custom size off: use encoder's latent, following first image; preserve dimensions except rounding to multiples of 32 |
| Prompt | first image is edit target; others references; template uses `<image1>`, `<image2>`, ...; prompt refinement defaults off |

The original Qwen pipeline example uses 40 steps; the Comfy template deliberately starts at 25. These are distinct documented starting points. The eight-step schedule belongs to Turbo, a separate checkpoint. Do not borrow 2511's conditioning or sampling assumptions.

Checkout-specific verification at core HEAD `70bcb4e9fc70f19b7cdb340966351ed6479f2188` (working-tree files read, not modified):

- `comfy_extras/nodes_qwen.py:111`: core encoder default `resolution=1024`; positive values resize toward `resolution²` area at preserved aspect, multiples of 32. Zero retains each reference's own size rounded to 32. First reference determines output latent. Changing output size independently can shift an edit, per node tooltip.
- This encoder has 16 named Autogrow slots, sorts by numeric suffix and consumes **one image per socket** (`image[:1]`), not a multi-image batch stuffed into one input. It conditions both text/vision and VAE reference latents when VAE is supplied. Official documentation/template advertises ten; the larger current schema is not a reason to reject additional executable refs or silently truncate them.
- `comfy/supported_models.py:2157`: model-native sampling settings are `multiplier=1.0`, `shift=0.69` (comment identifies scheduler mu at 1024²). The official edit graph adds no overriding `ModelSamplingFlux` node. Leave native policy intact for the first integration.
- `QwenImage21Cache` default storage is lossless `default`; `auto` uses available VRAM/RAM. Optional cache-device/quantization controls are not needed for the first correctness trial.

This is enough to build a narrow Snap adapter using the installed native nodes. It does not establish that the resulting model will obey the map; use the same held-out terrace cases as the P-H3/Fizgig comparison.

## Camera matching and panorama limits

If preserving an accepted plate's camera is difficult, **fSpy** is a focused, free camera-matching option. It estimates approximate camera parameters from user-selected vanishing lines; its official Blender importer transfers the camera. It assumes mutually perpendicular directions and a perspective pinhole image; orthographic views, stitched panoramas and altered perspective are unsuitable. An anime plate with inconsistent architectural vanishing points may have no single camera solution. Treat a fit as a hypothesis and inspect projected landmark residuals. For this terrace, an artist-approved blockout camera may be more honest than claiming to recover an exact camera from a generated plate. [fSpy](https://fspy.io/), [fSpy assumptions and limitations](https://fspy.io/basics/).

A single panorama can be useful as a distant mountain/sky and lighting reference around a fixed viewpoint. It does not supply the missing terrace parallax for a translating camera or the reverse side of an occluded actor. Reserve panorama-based work for background continuity; keep the circle, damage, feet and near architecture in the explicit layout. This is a geometric inference, not a tested Snap panorama workflow.

## How this fits the current map trial

Keep the current P-H3/Fizgig paired tests intact. Their question is whether a map helps a generative editor. The next different-method arm should instead give that editor the **already projected target composition**, so it need not infer the camera and blocking from a symbolic overhead image.

Proposed small follow-up after the current trial:

1. Pin M1: original terrace topology plus only accepted crack changes; actor foot positions and facing recorded separately. Do not move the circle to accommodate a render.
2. For each W/S plate, mark fixed floor correspondences against the map. Use floor points across the image, not four points concentrated on the circle. If the plate cannot fit the plan, label it inconsistent and fix the plate or adopt a reviewed blockout; do not quietly rewrite canon.
3. Project the ring, cracks and actor foot anchors into each plate. Preserve a labelled **review guide** and a separate clean **generation guide**; no labels/arrows in video conditioning.
4. Generate one finished board per view using the same state and Cast refs. Existing P-H3/Fizgig is the zero-download arm; exact Qwen 2.1 is the next model arm once integrated. Inspect whether geometry survives the finish.
5. Before video, compare the board with the projected guide: ring centre/boundary, feet on correct sides, facing, crack site, visible landmark order and occlusion. Inspect openings and later video frames against those same expectations.

The projector's output can also serve the critic even if the generator ignores it. A reliable expectation image is valuable without pretending it constrains the model. No production tool, record migration or renderer change is implied by this report.

## Set-design review and continuity review are separate jobs

The set-design reviewer should receive the story action, style references, overhead plan, scale anchors and camera coverage sheet. It should assess whether the place supports the action: traversable paths, actor working space, entrances/exits, readable silhouettes, foreground/middle/background separation, lighting motivated by the set, and useful wide/reverse/insert coverage. A beautiful establishing view can still be a poor stage for a two-person confrontation.

The continuity reviewer instead receives pinned state, projected expectations, camera/side, accepted boards and observed event frames. It checks topology, scale, foot placement/facing, landmark order/occlusion and persistent damage. It must label an unseen feature **unobservable**, rather than claim it vanished. Neither reviewer should bless a translated circle because the new composition is attractive, or commit incidental generated cracks as canon.

For a usable design packet, request: one overhead plan; scale and height notes; three to six empty-set coverage views derived from the same layout; clear action paths; an inventory of fixed landmarks and movable objects; and a separate list of approved state changes with source take/frame. These are recommended review deliverables, not claims that image generation can supply calibrated geometry.

## Reconstruction: useful constraints, not a shortcut

MoGe's current official implementation estimates point/depth maps and camera intrinsics from a single image; newer variants also provide normals and metric estimates. These are predictions. Independent estimates from incompatible generated views need registration and validation; a single image cannot observe hidden surfaces. Its current sample uses `.pt` checkpoints, so do not run the sample under this checkout's safetensors-only rule; first verify a compliant local artifact/path if this option is pursued. [MoGe official repository](https://github.com/microsoft/MoGe).

COLMAP expects overlapping images of the same scene, recovers cameras and sparse structure, then dense geometry. Its capture guidance asks for texture, similar illumination, substantial overlap, objects visible in at least three images, and actual viewpoint translation. Six compass-facing images with little shared content are therefore not automatically a good reconstruction input. A panorama's rotations are not a substitute for translational parallax. [COLMAP tutorial](https://colmap.github.io/tutorial.html).

The official 4DGS custom multi-view path organizes time-indexed frames under each camera and requires pose/point-cloud preparation. For the future six-tile LoRA, verify common event time, contact/trajectories, persistent terrain, overlapping geometry and calibrated/solvable cameras before training a reconstruction. Hold out a seventh view and a later time interval; report reprojection and contact failures alongside novel-view renders. Six plausible images alone establish neither static 3D geometry nor dynamic 4D consistency. [4D Gaussian Splatting official repository](https://github.com/hustvl/4DGaussians).

## Community evidence, search log and negative results

Applied the local **read-only** Hivemind skill before/alongside web research. No contributions, posts, refresh calls or adult-channel searches. Full raw responses are saved locally. Distillations lookup returned HTTP 404 (`public.distillations` absent); scoped pinned-canon lookup returned `[]`. Paged `message_feed` in batches of 25 to exhaustion: H3 layout query 222 rows; Qwen layout query 25 rows. H3 search terms: overhead, Blender, camera control, floor plan; Qwen: multiple angle, floor plan, camera control, Blender. The relevant literal-term subset contains 151 H3 rows and was read in explicit pages; unrelated broad-match rows were retained but not used as evidence. Channel scope: H3 chatter/resources and qwen-image.

Useful leads, **anecdotal reports rather than measured guarantees**:

- **scf, 2026-08-09:** floor plan plus trajectory arrows into H3 failed. This is directly relevant prior negative evidence for the direct-map-to-video arm. [Original message](https://discord.com/channels/1076117621407223829/1532625331960152124/1536022941740040345).
- **T2, 2026-10-08:** mixed success using Blender blockouts as reference video. **Chromadera, 2026-10-31:** asks how to stop H3 copying the blockout. These counterbalance optimistic blockout-control claims. [T2](https://discord.com/channels/1076117621407223829/1532625331960152124/1557620256032292865), [Chromadera](https://discord.com/channels/1076117621407223829/1532625331960152124/1566007511604133929).
- **QuintForms, 2026-11-06:** recommends camera-track mockups for specific motion; separately reports manual fusion/cleanup issues with panorama-derived meshes. These are leads to inspect, not proof that fusion is impossible or that all text camera prompts fail. [Camera mockups](https://discord.com/channels/1076117621407223829/1532625331960152124/1568332230441435238), [Panorama fusion](https://discord.com/channels/1076117621407223829/1532625331960152124/1568085822442442763).

External verification used official Blender, OpenCV, fSpy, Qwen/fal author docs and Microsoft/COLMAP/4DGS repos. Search results about HunyuanVideo were excluded: MiniMax H3 is a different model. Broad tool discovery was deliberately narrowed to methods addressing the observed circle/terrain drift. No numeric speed/VRAM/cost or reconstruction-quality claims were adopted from community messages. Blender documentation fetches intermittently returned tool HTTP 402; the camera page was available via search. Raw OpenCV download returned HTTP 403, while the browser tool retrieved the official tutorial. These access failures are preserved in `source_manifest.json` / this log.

## Progress and lessons

- 2026-11-08: Read standing project rules, full local Hivemind skill, continuity scout and relevant world-state sections 4.1–4.3, 4.7–4.8. Read community results, checked primary sources, verified existing cv2/Pillow and absent Blender-on-PATH. Wrote this research report. No model timing measured because no inference ran.
- Lesson: symbolic overhead inputs and geometric camera projection are different capabilities. An editor that successfully paints a crack onto the map may still fail to place that crack in a second camera view.
- Lesson: do not promote community mockup enthusiasm into a guarantee; relevant failure reports exist for both map arrows and Blender-reference transfer.
- Tool-output lesson: initial combined reads exceeded the wrapper output budget; affected sections were re-read in explicit complete pages. Future runs should set an outer output budget and keep pages smaller.

Open question for the coordinator's next experiment: can rank 1's floor projection match the accepted W/S plates within an agreed visible landmark tolerance? If not, the smallest honest next step is a reviewed coarse blockout, not more seeds of symbolic-map prompting.
