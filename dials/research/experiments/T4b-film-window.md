# T4b: is there a scene-keeping film-texture window for vhs + film_artifact? (2026-11-06)

**Question.** In T4, vhs +1.5 + film_artifact +3 (aligned, cosine +0.72) replaced the scene with actual film stock
(a scratched film leader, a film burn). Datamosh has a window (+2.25) where the subject survives the effect. Does this
pair have one: film texture *and* the scene?

**Setup.** Both dials in one rack at reduced strengths with the same 1:2 ratio: 0.75+1.5, 1+2, 1.25+2.5 (and T4's 1.5+3).
Train-platform scene, seeds 42 and 43, Pika H3 Flex 6-step, own controls. 6 new renders.

**Results** (distance = mean pixel difference from the control; Δdark = −luma; Δmotion = mean frame-to-frame change):

| strengths | seed 42: distance / Δdark / Δmotion | seed 43 | what the frames show (both seeds) |
|---|---|---|---|
| 0.75 + 1.5 | 63 / +7 / −0.9 | 50 / +12 / −2.9 | older steel train, slightly darker: era |
| 1 + 2 | 58 / +29 / +4.7 | 69 / +16 / +6.3 | vintage carriages, 1940s look: still era |
| 1.25 + 2.5 | 67 / +32 / **+23** | 66 / +46 / **+18** | dark, heavy vignette, soft focus, halation and light leaks; a red-hooded figure against a glowing, blurred train window. Subject kept, platform mostly gone |
| 1.5 + 3 (T4) | 91 / −48 / +11 | 91 / −43 / +11 | the film medium itself (leader frame, film burn); scene gone |

Full-resolution crops of 1.25 + 2.5: a cinematic *film photograph* look (vignette, halation, knit texture on the hood),
but no scratches or dust. The jump in frame-to-frame change (+18 to +23) may be film-like flicker or simply more
motion; that needs playback.

**What it shows.** There is no step where the scene survives *and* film damage (scratches, dust, burns) appears: damage
arrives only together with the loss of the scene, between 1.25+2.5 and 1.5+3. Just before that, 1.25+2.5 gives a
moody "shot on film" look that keeps the subject, a usable creative setting.

**What it changes.** Film *damage* stays out of reach with dials while keeping a scene (consistent with T3/T4 and the
overnight finding that medium surfaces arrive only at the extreme). Lab candidate: vhs +1.25 + film_artifact +2.5 as a
"shot on film" mood. Playback check for flicker is owed.
