# Cut1f review — 2026-11-08

Source: `../cut/seq02_nine_ring_cut1f_preview_chamber.mp4` (47.958333 seconds, 1280×704, 24 fps).
Scope: review only. No source clip, Snap take, board, active choice or timeline changed.

The coordinator inspected all 96 half-second whole-frame samples across the clip, then native timestamp extracts for candidate errors. A fresh reviewer received only the exported media/sheets and a generic whole-clip visual question, without prior issue notes. A separate reviewer measured the audio and ran two existing offline CPU ASR models. Neither reviewer nor the coordinator could directly audition sound. This is sampled visual scrutiny, not continuous real-time viewing or an audio listening verdict.

## Findings, in recommended fix order

| Priority | Time | Finding | Evidence and smallest useful response |
|---|---|---|---|
| 1 | 20–24 s versus 31–36 s | **Terrace damage resets during the continuing clash.** Branching black cracks appear at the barrier's base and spread across the floor, then the same floor is intact in the returning wide, even while the attack continues. | Native `native_21.50.png` and `native_23.75.png` versus `native_31.90.png` and `native_35.90.png`. High confidence. Decide whether the attack damages the floor; either carry damage into later material or remove it from the earlier shot. Fix the earliest source that creates the mismatch. Fresh reviewer caught this independently. |
| 2 | 12.50 → 12.75 → 13.20 s | **Liora repeats her wand action across the cut.** She is already aiming horizontally, then the side-wide resets her wand upright and she thrusts it forward again. | Native extracts at those exact timestamps. High confidence in the pose reset; whether a repeat is deliberate is a staging decision. A match-on-action trim or an opening board that preserves the aim would connect the cuts better. Fresh reviewer caught this independently. |
| 3 | 16.3–19.3 s and 24–27 s, versus surrounding wides | **Close-up grading reads much darker/cooler than the orange-sunset wides.** Coin-hand and sweat-drop close-ups feel like a later time of evening. | `native_16.30.png`, `native_19.35.png`, `native_23.75.png`, `native_26.00.png`. Medium confidence as a perceptual mismatch, not proof that sky geometry is impossible: camera direction/framing and effect exposure can explain part of the difference. Check shot matching before regenerating. |
| 4 | 12.7–16.3 s, 19.3–24 s, 31–36 s | **Wide shots are noticeably softer than the singles.** Faces, line work and balusters lose definition when cutting to the action wide. | Native extracts at 13.20, 21.50 and 31.90 compared with 16.30 and 36.50. Medium confidence; distant faces naturally contain less detail, but the line/background softness is broader. Judge at playback scale and inspect source-versus-export before choosing an upscale/redraw. Fresh reviewer also flagged this. |
| 5 | 47.307–47.958 s | **The encoded audio ends about 0.65 seconds before the image.** | ffprobe: audio start 0.000, audio end 47.307, video end 47.958333. Confirmed stream property, not an audible-click judgment. Check the final fade/assembly; intentionally fading into silence can be fine, but music resolution cannot be certified without listening. |

## Checks that did not establish a flaw

- C5's latest take visibly starts with the wand raised, lowers it, and leaves the coin palm raised. I did not identify a new hand-switch failure in these samples.
- The sweat drop and grin read as deliberate anime acting. They are not listed as defects.
- Potential smoke detachment and final character relocation were rechecked independently against native frames. Neither is established: smoke can drift as the hand moves, and Corvin can pass Liora between views. Avoid regenerating on those speculative grounds.
- No high-confidence extra person, gross extra limb, or character identity swap found in the samples. Short-lived glitches remain possible between samples.

## Audio limits

`audio/AUDIO_REVIEW.md` contains the complete measurement method and ASR caveats. The models tentatively recognize “Come on!”, “Pass.” and “Yes!” but disagree on the timing of “Pass.” These results do not establish lip sync or the absence of groans/other nonverbal sounds. Opening transient at 0.100 s is a listening-check candidate only. No interior dead-air interval of at least 80 ms below −60 dBFS, and no decoded PCM clipping, was measured; neither proves that the music bed is continuous or the mix is artistically right.

## Evidence and blind review limits

The 16 overview sheets and native whole frames are in this folder. `frames/` uses ffmpeg's fps filter: sheet times are nominal half-second sample positions, and source selection can differ by roughly a quarter second. Findings above were rechecked against explicit-seek native extracts where given; treat ranges as approximate elsewhere.

The sealed fresh visual review is `blind/VISUAL_REVIEW.md`. The later targeted smoke/position check is separate in `blind/FOLLOWUP.md`; do not call that followup blind. This is one fresh review, not a validated critic benchmark or proof that a new generic prompt holds the fixture floor.
