# Set-design review — Examination Terrace, 2026-11-08

> READ FIRST: instruction-only skill work in snap-scout; no live page, world record, active choice, timeline or render changed. Review uses saved location `location:location-mw795ja4giox@3` and whole native W/S/N plates plus selected native cut1f snapshots. This is a partial set-design demonstration, not continuous playback, a full docket critique, or a critic fixture result. Research is a separate worker's deliverable.

## Progress

- Read PROJECTS, CODEX_PICKUP, canonical snap-core/location/critic and critic reference; reviewed location @3 provenance, camera poses, plan and scale anchors. R269 confirmed free after R268.
- Viewed native whole W/S/N source plates and cut1f snapshots at 0, 12.5, 16.7, 21.5, 33.5, 39, 43 and 47.3 seconds before writing findings. No crops substituted for whole-frame review.
- Completed the narrow set-design skill and example review; measured critic r6 and its reference remain unchanged.
- Validation: skill-creator `quick_validate.py` reports `Skill is valid!`; worktree `git diff --check` passes. Confirmed no diff/status change under snap-critic. No runtime or GPU tests apply to this instruction-only change; independent source review remains with the coordinator.

## Sources inspected

Location snapshot: `map_continuity_2026-11-08/trial/location_before.response.json` in this study. It records @3, head 3 at capture; this review does not independently establish today's live head.

Whole native plate sources under this study's `gpubase/input/snap/`:

| View | Source | Provenance in @3 |
|---|---|---|
| W, looking west | `take-6af5bc8e-e50e-41bb-a9d7-74e5f3040faf_f0.png` | People/effects removed from picked clash board; east-side camera looking west, eye height typed 1 m |
| S, looking north | `take-1af2ec3b-44eb-4e01-a9b4-951b6dd40900_f0.png` | Master redrawn in picked look; also the S camera/place plate, eye height typed 1.6 m |
| N, looking south | `take-48c67ef1-8870-47cd-8f42-41453279e6bc_f0.png` | Reverse new view from S/W; eye height typed 1.6 m |

Source identity check (SHA256, W/S/N respectively):

```text
W 2240x1216 644421080c77f0438048b371a4c758bc824d78165f9fc40e8468d348e7a914fe
S 1344x768  9017515d8c9b9dae1dcbec62c512474c99590c4b3cc13604abe237be8916e631
N 2240x1216 1035994eb247359ae027a67db87b7b0821bb73c7a3eeb6dce05fea2c6ab0a12a
```

Cut1f examples: sibling study `2026-11-05-anime-dogfood/seq02/review_2026-11-08/native_{00.00,12.50,16.70,21.50,33.50,39.00,43.00,47.30}.png`, each viewed whole at original size. The review folder's REVIEW.md identifies the source as `seq02_nine_ring_cut1f_preview_chamber.mp4`, 1280×704, 24 fps, 47.958333 s. Prior findings were read only after the first native-image pass; they are context, not replacement evidence.

## Demonstration review

The terrace works as a spare, readable exam arena. The S plate connects the central floor bands to the orrery at the north end; the N reverse connects the same kind of floor to the south stair-house door and steps. Both give clear long-axis ground for approach and retreat, with an open central action zone and strips beside the circle. The W view is a useful low side-on stage: its rail and distant mountains separate the duel silhouettes from the background, as the native 21.50 and 33.50 examples demonstrate. Pale masonry, turned balusters, inset square posts, flagstones and the brass instrument belong to one restrained design language. Nothing in the inspected views establishes a doubled wall, floating fixture or unusable central route.

Compass: the record defines north at the orrery and south at the stair house. W is a camera on the EAST side looking WEST; its left is south and its right north. S looks north, so west is screen-left. N looks south, so west is screen-right. The named W/S/N sides refer to view direction, not three camera positions bearing those names. A reversed screen side by itself is therefore expected. The off-frame stair house in S, off-frame orrery in N and both absent from W do not establish missing architecture.

| ID / kind | Viewed evidence and observation | Consequence, owner and smallest useful response |
|---|---|---|
| SD-01 — fact; high confidence in record/view disagreement | Location @3 notes say afterglow low in the west; the clean S plate, labelled and posed looking north toward its orrery, contains a distinct sun disk almost straight ahead, just left of the pedestal. Its direction cannot be reconciled with due-west light simply by the S/N screen reversal. N's bright sky at screen-right is compatible with west. Broad sunset glow elsewhere is not evidence of a second sun. | Set source issue to resolve before multiplying views: the S master/plate versus the compass/light notes and camera marks disagree. Do not silently choose which is canon. If the north/south plan and west-light intent hold, adjust the S master sky's disk placement; if the picture's orientation is intended instead, reconcile the record and affected views. This is not a claim that the entire grade or all shadows are impossible. |
| SD-02 — fact; high confidence | Cut1f native 21.50 shows branching dark fractures crossing the floor bands beneath the vertical barrier. Native 33.50 shows a near-matching W view with recognizable balustrade posts, same ring area and intact floor under the fading effect; 47.30 also returns to an intact circle. The return W angle exposes the damaged area, so camera occlusion alone cannot explain its disappearance. | The observed terrain state resets. Earliest evidenced owner is the take that introduced damage, or a still/reference it used if provenance establishes that upstream source; the clean @3 plates contain no such damage. Decide under the existing story policy whether damage is intended/accepted: carry it into later boards/takes and the state map if yes, or remove it from the attack material if no. Copying fractures into canon automatically would be wrong. |
| SD-03 — advisory; medium confidence | The clean W plate's repeated rail/post pattern has fewer directional cues than either axial view. The circle occupies the lower frame and is partly cropped. In 21.50 and 33.50, people and effects obscure much of the floor, though Liora-left/Corvin-right agrees with a west-facing camera and the stated south/north blocking. | Before another side-wide, specify feet and facing relative to the circle centre/bands and the shared overhead frame. Owner is blocking/board planning, not a proven broken clean plate. Existing evidence does not warrant moving the whole circle or flagging an actor relocation. |
| SD-04 — advisory; medium confidence | The orrery and stair-house doorway give distinctive north/south singles (39.00 and 12.50). The ringed orrery sits close to Corvin's silhouette in 39.00; the central layout offers little asymmetry apart from those end markers. | Keep the end landmark legible without tangencies through a face or wand when framing new boards. Slight lateral camera/blocking adjustments may help; no prop or architecture addition is needed to make the current duel readable. Owner is camera/board composition. |
| SD-05 — unresolved matching question | Native 16.70 and 39.00 read cooler/darker than the clean sunset W and the action wides. Their cameras, crop and effect exposure differ, and neither shows the entire set. | Compare adjacent shots at playback scale before treating the tonal difference as a time-of-day or lighting-geometry fault. Owner is take/export matching if verified, not automatically the location. These stills do not establish a continuous playback defect or justify regeneration. |

The stair door and steps offer one visible entrance at the south end. A route around the circle is visible in S/N; clearance in metres is not measured here. The record's 2.2 m door and 1 m balustrade anchors are present, but the door is elevated on steps and perspective differs across images. No measured camera-height or human-scale failure is asserted from these impressions. The typed 1/1.6 m eye heights remain metadata, not independently certified dimensions.

The duel's long axis provides an action line, with W establishing Liora on the south/left and Corvin north/right. S/N are axial coverage; tight singles need their actual facing and eyelines checked against adjacent footage. The selected frames do not establish an unintended 180-degree crossing. Native 43.00 places Corvin nearer the S camera and Liora behind him; enough intervening movement is uninspected that this is not called a teleport or a reversed north/south set.

## Limits and next decisions

This is a survey of all three distinct clean views present in the saved @3 record, not a complete spatial reconstruction. The east-facing reverse, tower exterior, stair-house interior and actual access path below the door are unseen. The plan's shapes and camera metadata were read, but the plan rendering was not independently inspected as an image. No new image, map or model output was made. Eight selected native video frames were inspected; motion, all cut pairs and sound were not reviewed in this pass.

The concrete production decisions are whether floor damage belongs to the accepted duel state and whether the declared compass/west light or the S master sun placement should govern a correction. Other notes are optional staging advice. No decision, candidate or world version has been adopted.

## Skill change and validation

Created `.claude/skills/snap-set-design/SKILL.md`; added a routing pointer in `.claude/skills/snap-core/SKILL.md`; appended SNAP-R269 in `docs/snap/SNAP_RULES.md` with next free ID R270. The skill has only `name` and `description` frontmatter and no engine/API/node/dependency changes. It routes actual docket work to snap-critic and keeps aesthetic advice distinct from factual flaws. The canonical measured critic r6 and reference were not edited; no claim is made about their fixture floor.
