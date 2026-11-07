# A2: held-out pack candidates

**DONE — 1 seed (42), 9 candidates, 16 distinct renders, 9 muted grids, 22 comparison cells.** Visual transfer calls: **6 yes / 2 partial / 1 no**. These are candidate observations; Dylan decides what ships. Reserved ↔ Lively is skipped as requested (already covered by eval27).

Every comparison uses the shipped Pika flex workflow, motion +0.5, seed 42, 1280×704, 141 frames at 24 fps (5.875 s), LCM and the same 6-step sigma schedule. “Base” means candidate strength 0 with motion +0.5 retained. The same new harbor baseline is shared by 6 outdoor dials, the florist baseline by 2 people dials, and the animal scene has its own baseline. Candidate pairs differ only in dial file/strength and save path.

The visual calls below are my inspection of frames 12, 70 and 128 (0.500, 2.917 and 5.333 s), with whole-clip measurements over all 141 frames. They do not establish motion cadence, uninterrupted temporal consistency, dialogue fidelity or audio quality. The muted grids are supplied for Dylan’s playback. Luminance/darkening alone does not establish night, and palette changes alone do not establish surreal geometry.

| Dial / prompt / strengths | Effect on held-out prompt | Side effects | Evidence |
|---|---|---|---|
| `grade_warm_cold` / `harbor` / -1, +1 | **yes** — Both signs shift the palette as intended: mean R-B is 11.49 at -1, 4.46 at base, -1.33 at +1 (RGB255 units). The warmer -1 and cooler +1 appearances are visible across the 3 sampled frames. | At -1 the woman walks away from the camera in all 3 samples, instead of approaching as in base; boats, kiosk and buildings are rearranged. +1 changes face/clothing details and boat/kiosk placement. | -1 · base · +1 · muted grid · 3-frame sheet |
| `day_night` / `harbor` / +1, +2 | **no** — No clear night at +1 or +2: 0/6 sampled variant frames show a night sky or night-time pools of artificial light. +1 mean luminance is 124.54 versus base 123.30; +2 darkens to 97.90 but remains gray daylight (R-B -18.64 versus base 4.46). | At +2 foreground adults wear hats/scarves and approach much closer; the main woman and nearby boats/kiosk are restaged in all 3 samples. +1 also changes kiosk/boat placement. | base · +1 · +2 · muted grid · 3-frame sheet |
| `style_claymation` / `harbor` / +2 | **yes** — +2 produces molded toy/clay-like people, boats and buildings in 3/3 sampled frames, versus live-action base. Stop-motion timing is not established by stills. | The harbor is rebuilt as a toy set: the kiosk becomes a small doghouse-like prop, the woman has short red hair, and the framing/action changes to a side view in all 3 samples. | base · +2 · muted grid · 3-frame sheet |
| `weather_rain_v2` / `harbor` / +2 | **partial** — +2 creates wet reflective paving and overcast weather in 3/3 samples. Falling rain/heavy downpour is not clearly resolved in those frames or the full-resolution frame 70; the wet-weather look transfers, while rain intensity remains unconfirmed. | The camera follows the woman from behind instead of watching her approach in all 3 samples. Her coat becomes bulkier; nearby adults, boats and buildings change, and smoke appears across the harbor. | base · +2 · muted grid · 3-frame sheet |
| `dream_surreal` / `harbor` / +2 | **yes** — +2 creates airborne sailboats, an impossibly curved promenade/railings and a fantasy red kiosk in 3/3 samples. The original base has grounded realistic harbor geometry in 3/3 samples. | The realistic woman becomes a stylized green figure; the quay, city skyline, kiosk and action are substantially replaced in all 3 samples. This is a strong scene transformation, not a small geometric adjustment. | base · +2 · muted grid · 3-frame sheet |
| `underwater` / `florist` / +2 | **yes** — +2 clearly submerges the florist scene in 3/3 samples: an overhead water surface, bubbles and floating hair surround the flower counter. Base is a dry flower shop in 3/3 samples. | The shop becomes an aquarium-like setting, the woman changes to blonde hair, and both adults gain goggles; clothing, gloves, flower arrangement and blocking change. At frame 12 the woman is descending through the water rather than arranging flowers at the counter. | base · +2 · muted grid · 3-frame sheet |
| `crowd_density` / `harbor` / -2, +2 | **partial** — +2 visibly adds several passing groups, clearest at frames 12 and 70. -2 is sparse at frames 70 and 128 but is not deserted: frame 12 contains the main woman plus 3 nearby pedestrians, and the woman remains in all 3 samples. Positive density transfer is clearer than the negative side. | -2 turns the main woman away from the camera and moves the kiosk/boats. +2 replaces the cast, changes the kiosk into a stall, adds rows of waterfront houses, and loses the original main woman by the last sample. | -2 · base · +2 · muted grid · 3-frame sheet |
| `cam_framing` / `florist` / -2, +2 | **yes** — Both signs transfer relative framing in 3/3 samples: -2 crops tightly to hands/upper bodies, while +2 shows nearly full bodies, the long counter and much more of the room. -2 is not consistently an extreme face close-up (frame 12 crops the faces out). | -2 replaces pot shelves with bottles/glassware and changes the male coworker and flowers. +2 rebuilds the shop around a central table, changes the man to dark clothes and separates the people; these are new compositions, not crops of an unchanged scene. | -2 · base · +2 · muted grid · 3-frame sheet |
| `creature_lizard_squirrel` / `stonewall` / -3 | **yes** — -3 replaces the furred, cat-like baseline animal with a low-slung lizard with splayed legs and a long thin tail in 3/3 samples. Only the lizard direction was requested/tested; this supplies no evidence for the squirrel direction. | The mossy stone wall becomes a smooth concrete wall, the red apple becomes green fruit, the orchard foliage changes, and the view becomes a high angle. The animal recedes along the wall instead of the base animal approaching the apple. | -3 · base · muted grid · 3-frame sheet |

## Prompts and provenance

All three scenes were composed with `test_pika_pack.pika()`. Exact scene text had 0 prior matches in the scanned study text before queueing; this is a local held-out check, not a claim about external training data. See preflight for search scope and manifest for full prompts including soundscapes, graph paths, and SHA-256 of the template and every loaded dial. Human subjects are explicitly adults.

**harbor:** On a harbor promenade, an adult woman in a green jacket strolls beside a metal railing while two other adults walk past a red kiosk. Moored sailboats and brick warehouses stand across the water. The camera follows at a gentle distance.

**florist:** Inside a flower shop, an adult woman in a blue apron arranges yellow flowers in a glass vase on a wooden counter. She looks toward her adult male coworker and says, "These flowers are ready for the table." He nods beside a shelf of empty pots.

**stonewall:** A small animal climbs along a low mossy stone wall in an orchard, pauses beside a fallen apple and looks around. Ivy trails down the wall and apple trees stand in the background.

## Numeric checks

Y and R−B are whole-frame means in RGB255 units (not a perceptually calibrated exposure measure). Source BT.709 metadata is honored by PyAV; Y uses OpenCV grayscale weights on decoded RGB. Changes in scene content can affect these metrics. Full luminance/contrast, optical-flow and audio proxy measurements, per-frame series and hashes are retained in metrics. The audio proxy is whole-track energy, not isolated speech.

| Clip | Strength | Mean Y | Mean R−B | Execution s |
|---|---:|---:|---:|---:|
| A2_base_harbor_s42 | +0 | 123.30 | 4.46 | 75.05 |
| A2_grade_warm_cold_m1_harbor_s42 | -1 | 124.92 | 11.49 | 63.99 |
| A2_grade_warm_cold_p1_harbor_s42 | +1 | 123.01 | -1.33 | 64.20 |
| A2_day_night_p1_harbor_s42 | +1 | 124.54 | -0.60 | 64.02 |
| A2_day_night_p2_harbor_s42 | +2 | 97.90 | -18.64 | 63.96 |
| A2_style_claymation_p2_harbor_s42 | +2 | 133.58 | 14.66 | 64.35 |
| A2_weather_rain_v2_p2_harbor_s42 | +2 | 121.13 | -10.48 | 64.34 |
| A2_dream_surreal_p2_harbor_s42 | +2 | 131.47 | -1.47 | 64.50 |
| A2_base_florist_s42 | +0 | 100.62 | 28.57 | 69.71 |
| A2_underwater_p2_florist_s42 | +2 | 93.53 | -42.31 | 64.31 |
| A2_crowd_density_m2_harbor_s42 | -2 | 127.53 | -2.68 | 69.44 |
| A2_crowd_density_p2_harbor_s42 | +2 | 119.29 | 13.87 | 64.39 |
| A2_cam_framing_m2_florist_s42 | -2 | 104.38 | 33.55 | 69.80 |
| A2_cam_framing_p2_florist_s42 | +2 | 98.37 | 36.66 | 63.77 |
| A2_base_stonewall_s42 | +0 | 90.16 | 35.88 | 69.85 |
| A2_creature_lizard_squirrel_m3_stonewall_s42 | -3 | 91.90 | 41.36 | 74.38 |

Total recorded execution time for the 16 clips: **1070.04 s** (excludes queue waits). Queue/progress/retry events record the complete run. No more than 15 A2 jobs were active/pending at once. Server outputs were copied, not moved or removed.

## Next-node handoff and Dylan review

A3 has not been run. Candidates with a visible transfer to repeat at seeds 43 and 44, keeping these exact prompts and strengths (partial calls remain explicitly partial):
- `grade_warm_cold` (yes): -1, +1.
- `style_claymation` (yes): +2.
- `weather_rain_v2` (partial): +2.
- `dream_surreal` (yes): +2.
- `underwater` (yes): +2.
- `crowd_density` (partial): -2, +2.
- `cam_framing` (yes): -2, +2.
- `creature_lizard_squirrel` (yes): -3.

Specific review calls:
- `grade_warm_cold`: Whether the palette shift is useful despite walking-direction, identity and layout changes.
- `day_night`: Confirm the daylight-versus-dusk/night call; do not treat darkening alone as a successful night transfer.
- `style_claymation`: Confirm motion cadence in the muted grid and accept or reject the changed identity, kiosk and staging.
- `weather_rain_v2`: Playback: confirm falling rain and whether gait speeds up; stills establish wet weather only. Frame 70 is also saved in A2/A2_weather_rain_v2_frame70.png.
- `dream_surreal`: Whether this degree of scene/identity replacement is desirable, and whether the impossible geometry stays coherent during playback.
- `underwater`: Accept or reject the goggles, character changes and aquarium replacement; verify flower-arranging action and dialogue separately during playback.
- `crowd_density`: Judge density over the full clip and whether losing the original woman is acceptable; the -2 empty-scene target is incomplete.
- `cam_framing`: Whether consistent framing direction outweighs the changed shop/cast, and whether face exclusion at -2 is acceptable.
- `creature_lizard_squirrel`: Confirm lizard appearance through the full clip and accept or reject the changed wall, fruit, camera angle and action.

## Verification and reproduction

Verification result checks all 16 executed graphs against their saved inputs, matching baseline graphs, unchanged dial/template hashes, successful histories, complete audio/video decoding, 141 frames per clip, all 9 muted grids, all 22 correctly ordered grid cells (source-to-tile pixel comparison at frame 70), sheet dimensions, metric finiteness and report links. Visual review records preserve the qualitative calls.

Resume/rebuild checks using the existing local Python (completed outputs are retained):

```bash
(local file on the other machine) codex/A2_run.py
(local file on the other machine) codex/A2_analyze.py
(local file on the other machine) codex/A2_report.py
(local file on the other machine) codex/A2_verify.py
```

Timing markers are appended to `logs/timings.log`. Work is limited to A2 and the pack status. No model downloads, MAINodes edits, repository commits, server restarts or uploads were performed.
