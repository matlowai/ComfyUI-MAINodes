# Bird's-eye continuity scout — 2026-11-08

Status: read-only scout complete; no images or videos generated. This is a proposed small experiment, not evidence that H3 obeys maps reliably. Existing tools and files were inspected; no browser or page was driven.

## Recommendation

Try the overhead map as a planning/edit input first: **one fixed map → explicit character marks and facing → edit the map after an accepted event → derive a clean camera-matched board → video from that board and Cast pictures.** The map is an inexpensive shared spatial record while the six-view/map-arrow LoRA is in development. It cannot yet be called calibrated 3D or 4D reconstruction.

Keep a direct annotated-map-to-H3-video test separate. Existing measurements show pictures in video References can become destinations or freezes, even when described as Subjects. An overhead diagram or red arrow might appear in the footage. The still edit is a useful first test without making that an untested production default.

## What already exists

The seq02 location is `location:location-mw795ja4giox@3` (head 3 in the local record inspected). It already has a drawn bird's-eye plan:

- `snap/location/location-mw795ja4giox/plan-3f86de219f2e.png`; drawing-only render crop: `plan-3f86de219f2e-render.png` in the same folder.
- Coordinates are fractions from the plan's top left. Terrace rectangle: centre `(0.5, 0.5)`, spans `(0.4, 0.8)`. Engraved circle: centre `(0.5, 0.5)`, spans `(0.26, 0.18)`. Orrery: `(0.5, 0.15)`; stair house: `(0.5, 0.86)`.
- Existing notes: terrace long axis north–south, **Liora south of the engraved circle, Corvin north of it**. North has the orrery; south has the stair house. Sun afterglow is west, mountains around, violet overhead.
- Camera marks: W side-on `(0.66, 0.5)`, heading 270°, eye 1 m, lens 28 mm; S stair door `(0.5, 0.8)`, heading 0°, eye 1.6 m, lens 24 mm; N orrery `(0.5, 0.2)`, heading 180°, eye 1.6 m, lens 24 mm. Plate poses preserve some earlier camera coordinates, so do not silently treat typed marks as a calibrated reconstruction.
- Scale anchors are stair-house door 2.2 m and balustrade rail 1 m. These establish vertical checks, not a proven metric horizontal reconstruction of the generated terrace.

No new record kind or renderer is needed for the first trial. Existing versioned location plan, map, notes and plate provenance can carry the evidence. G18's planned observed layer and reference ledger would remove hand work later; they are not prerequisites for this experiment.

## Existing live tool path

Inspected the saved live G17a MCP tool schemas and live pack code. Before execution, the coordinator must still read live `info`, tools, page ownership and target `instructions`; dev skills describe G17b but live is G17a.

| Job | Tool and viable arguments | Boundary |
|---|---|---|
| Inspect the set | `get_record` for the pinned location; `nearby` for source pictures | Read current versions rather than trusting this report indefinitely. |
| Draw a plan | `draw_set_plan {location, shapes, cameras, preview: true}`; later save if wanted | Shapes support rect/ellipse/line/poly/label; black-on-white, no colour field. Camera wedges stay on the record/UI rather than baked into the renderable plan. |
| Create an annotated map | `edit_from_context {method: "ph3_view", purpose: "edit", pictures: [{file: <plan file>, label: "fixed overhead layout"}], prompt, seeds: [<seed>], width: 1536, height: 1024, land: {scene, shot}}` | P-H3 can be asked to add red arrows. Inspect the candidate; colour/arrow meaning is not guaranteed. Keep original plan and annotated derivative distinct. |
| Add terrain damage or item changes | Same `edit_from_context` call, Picture 1 = accepted map state; Picture 2 = an accepted event frame if useful | Explicitly preserve boundaries, engraved circle, landmarks and unchanged actor marks. Never commit an incidental generation error as world truth. |
| Generate the requested camera view | `edit_from_context {method: "ph3_view", purpose: "character", pictures: [<clean camera plate>, <map if this arm>, <Liora Cast>, <Corvin Cast>], prompt, seeds, width: 2112, height: 1184, land: {scene, shot}}` | `purpose` is real metadata, `method` overrides the normal Fizgig choice for this controlled first test. The map is not Picture 1 when a clean plate can anchor the camera. |
| Save a map candidate | `save_location {location, map: {take: <still>}, note, propose: true}` on the experimental clone, or keep it solely as a candidate | `location.map` is intentionally for people/critics and is not injected by `apply_location`. Do not change that production policy for this test. |
| Save clean board | `set_board {scene, shot, take, role: "opening", approved: <after review>}` | Do not replace production boards or active takes. Test scene only. |
| Video | Existing **Pika + reference pictures** preset; clean board as opening reference plus Cast pictures | Exact live preset: Ref2VA pruned int8 checkpoint + Pika H3 Flex Ref2VA adapter, six steps, lcm/manual, cfg 1, shifts 12/3. Verify the compiled recipe; do not use the FL2VA adapter. |

`ph3_view` is P-H3-Image int8 with its matching encoder/VAE, eight steps on the pack's manual grid, up to nine context pictures. It is already installed as a method; no download is proposed. Fizgig is the alternate if the first method cannot maintain Cast appearance, but changing methods is a separate comparison, not another seed of the same failed recipe.

The important pre-existing rule: **the clean plan is renderable; the annotated camera map is not normally rendered.** `library.js` documents this split because marks leak. An experiment may explicitly supply the annotated file to `edit_from_context`; it must not quietly make all future `apply_location` calls inject annotations.

## Small paired test

Use a new experimental scene and location clone. Leave seq02's production Book, active takes, plan and exported cut untouched. Choose one map layout and preserve it in every arm; do not allow a successful arm to redefine where the circle was.

**Preparation (two new stills, one seed each):**

1. `M0`: add two labelled actor marks and facing arrows to the existing plan. Proposed initial marks for the test, not measured seq02 coordinates: Liora `(0.5, 0.65)`, facing north; Corvin `(0.5, 0.35)`, facing south. Both lie outside the plan ellipse. Keep the ring fixed and unlit, orrery north and stair house south. One red arrow per named character; separate current position from any future path. If the plan's aspect makes the circle appear elliptical, retain that same coordinate convention rather than redrawing the topology between arms.
2. `M1`: edit M0 after the intended impact: one branching crack cluster at an agreed point on the circle's north side. Preserve both actor marks unless an explicit displacement happened. Use an accepted damaged frame as evidence; check that the crack site is represented on the same map. Later final placements are a new state `M2`, not an overwritten M0.

**Primary still comparison: four candidates total (two arms × two camera views × one matched seed):**

| Arm | Inputs | Asked views |
|---|---|---|
| A — no map | Existing clean camera plate + the two Cast refs, with identical explicit placement/damage words | W side-on and S toward the orrery, both after the impact |
| B — updated map | Same plate and Cast refs + M1, with one sentence explaining its symbolic role | The same W and S views, matched seeds and settings |

Both arms get the **same** state words: one engraved circle, positions relative to it, facing, damage location, dusk light and camera. The only intended variable is the presence of M1 and its explanatory reference sentence. Use the same source plate per camera in A and B; number pictures explicitly because adding the map shifts tags. The no-map arm is not a vague prompt or a lower-resolution baseline.

Start with one seed per cell. If the result is close or inconsistent, one second **matched** seed per cell is enough (eight stills total maximum). A map that was drawn incorrectly is a preparation failure: correct the map/method before re-running, rather than counting it as a model result. After two failed seeds of a valid recipe, change approach.

**Only after the map-assisted boards pass:** render one three-second locked-camera clip from each selected W board, same Pika preset/seed, using its clean opening board + Cast pictures and the same modest action. Two short videos total. This asks whether the map's improvement survives video conditioning; it does not test six-view synchronization. Keep dials off for this isolation test, or exactly identical if the chosen look requires one.

**Optional direct-map arm, separate question:** one short clip from the *same* clean board as its no-map control, plus annotated M1 in References. This isolates whether a map helps video itself. Watch for a cut into the diagram, an overhead camera jump, printed labels/red arrows, duplicated people and freezes. Run a second matched seed only if the first gives useful evidence. Do not claim that the safe board-mediated arm proves this direct-reference arm works.

## Prompt skeletons

These are templates for the coordinator to bind to the actual picture slots, read scope instructions and inspect before GPU work. They are not claimed successful prompts.

**Map annotation edit:**

> Edit Picture 1 as the same overhead plan. Keep the terrace boundary, the engraved circle, the north orrery and south stair house exactly in place. Add a small mark labelled Liora south of the circle with a red arrow facing north, and a small mark labelled Corvin north of the circle with a red arrow facing south. The marks show their positions and facing on this plan.

**Map event edit:**

> Edit Picture 1 to record the impact shown in Picture 2: add the branching cracks at the marked north-side impact site beside the engraved circle. Keep the existing terrace layout, circle, landmarks and both actor marks at the same coordinates. This is the same overhead plan after the impact.

**Map-to-board:**

> Show the same terrace from the camera of Picture 1, with Liora from [her Cast picture] south of the engraved circle facing Corvin from [his Cast picture] north of it. [Map picture] is an overhead instruction diagram: its named marks and red arrows specify their ground positions and facing, while its cracks specify the damaged floor. Render the people and terrain from this camera, with the single engraved circle and the damage in those same places, under the same dusk light. The final image is a clean anime shot, with the map annotations absent.

Do not describe a future ending frame as a picture the video must reach. A red arrow is a facing indicator unless the text explicitly says it is a route. Positions should be relative to fixed landmarks in world space, not only screen-left/screen-right.

## Pass conditions written before rendering

For each candidate, score these independently, with evidence frames/crops and no knowledge of arm label during the final comparison where practical:

1. Exactly one Liora and one Corvin; no extra person or duplicated story prop.
2. Liora remains on the south side of the engraved circle; Corvin north; facing each other. A camera reversal may swap screen sides and is not itself a failure.
3. Exactly one engraved circle; same world centre, radius/proportions and relation to orrery, stair house and terrace boundary in W and S. The circle must not translate with a person. Use the existing registered plan as the authority, and compare projected relationships, not raw pixel coordinates across different cameras.
4. Crack cluster stays at the specified ground site and survives all later sampled frames/angles; it is not erased, relocated with the shield, or changed into another circle.
5. Camera matches the requested W or S view; no return to the overhead plan or another context image. Red arrows, labels and map graphics do not appear in the clean board/video.
6. Cast design and hand-held items hold, without treating an intentionally changed pose as a flaw.
7. Dusk light and image detail remain comparable between arms. No “continuity success” credited for a blurry or diagram-like result that hides the landmarks.
8. For videos: inspect opening, every half second and final frame. Check the unchanged opening pose does not repeat an action already completed in the preceding cut. Sound requires listening; measurements alone are not an audio approval.

Report each item as pass/fail/uncertain, number of seeds, wall-clock, GPU/server and take IDs. One-seed results are preliminary; success in two still viewpoints does not establish six-view or 4D consistency. No embedding threshold substitutes for the landmark/position check.

## What this can teach now, and what stays later

The initial result can establish whether one explicit updated plan reduces drift of circle, people and damage across two H3 still views, and whether clean boards transfer that consistency to short video. It can also falsify the direct-map-to-video idea cheaply if annotations leak or the camera snaps overhead.

The future LoRA still needs a separate test of six views representing the same event/time, known camera poses, synchronized contacts/motion and a held-out seventh view for reconstruction. Keep entity trajectories, camera tracks, terrain and event changes separate, matching the existing renderer-independent motion-plan design. Do not call six individually plausible pictures a usable 4D splat.

Keep the plan's baseline topology separate from event snapshots. Accepting a take does not automatically commit its floor damage or final actor positions as truth. Propose only intended, inspected observations; preserve previous versions, the source take/frame and why each state changed. That is the practical bridge from this trial to G18, without building G18 first.

## Sources read and scope

Read CODEX_PICKUP, all current DECISIONS, all BOX1_MAP_LORA_BRIEF and DESIGN_WORLD_STATE pages, canonical snap-location and snap-new-view skills, and PROMPT_CRAFT_RULES section 0. Inspected saved live MCP schemas, live `library.js` map/plan distinction, `methods.json` P-H3 configuration, `render.py` exact video preset, and the entire local seq02 location record. Initial oversized tool output was re-read in explicit complete pages. No external research, model claims from memory, runtime changes or existing-file edits.
