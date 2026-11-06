# 2026-11-06: one night of Dials experiments

What we tried, what came back, and what it changed. Clips with sound: **[Dials Lab](https://matlowai.github.io/ComfyUI-Dials/lab.html)**.
Dial files and their prompt pairs: [H3-Dials `dials/experimental/`](https://huggingface.co/MATLOWAI/H3-Dials/tree/main/dials/experimental).

**Setup.** MAINodes main (v1.2.2 + PR #11), ComfyUI 0.43. Pika H3 Flex 6-step (lcm, int8 FL2VA, nvfp4 text encoder),
text-to-video, 1280×704, 141 frames, de-rope off. One Dial Rack row per render. The scene is the Simple example's
prompt (a woman in a red coat on a train platform at dusk, seen from behind). Every arm has its own control: same
seed, same GPU. Seed 42 unless noted; "2 seeds" = 42 and 43. Verdicts come from contact sheets (frames at 0.5 / 2.9 /
5.3 s) unless "playback" is written. One prompt per finding, so read these as starting points.

## 1. The villainy pack on Pika (+1, +2)

| dial | +1 | +2 | loudness Δ (+1 / +2) |
|---|---|---|---|
| sinister | same shot, sunset gone, cold blue | restaged: wide, desolate, figure in profile | +5.4 / +4.9 dB |
| creepy | turns to profile, staring | dark sterile station, face in shadow | −3.5 / −9.7 dB (spectral centroid halves) |
| cold | walks toward camera, overcast blue | brisk "corporate" walk, heels and briefcase | +3.9 / +1.2 dB |
| unhinged | hair whipping, energy up | horror: sprints at the camera screaming | +7.6 / +6.7 dB |
| seductive | keeps the warm sunset | glass-roofed hall, glamour walk | +2.0 / −2.7 dB |
| corrupted | gloomier, layout kept | foggy grim station | +0.9 / −6.4 dB |
| dread | tight over-the-shoulder, cold | close profile glancing back | +3.6 / +1.7 dB |
| impish | keeps the warm dusk, turns to camera | confident walk toward camera | +4.4 / −5.0 dB |

The pack is a light→dark range: only seductive and impish keep the warm light (their cosine with `cold` is lowest,
0.39 / 0.23; sinister·cold is 0.69). Loudness is whole-track ebur128 against the control's −24.5 LUFS.

## 2. Is it the templates? A size-matched placebo

Most evil dials turned the subject toward the camera. Two controls:

- **Camera-free templates.** Sinister's slot text in templates without "camera"/"viewer" words
  (`h3_x_sinister_noview`) has cosine 0.968 with the released dial and renders the same. Templates are not the cause.
- **Placebo at matched push.** The same templates with a meaningless slot (grey vs blue scarf, |vec| 10), scaled ×4 and
  ×8 to match sinister's push at +1 / +2, kept her facing away, but **changed the background** (train livery, station).

So any push of dial size reshuffles the background; what the placebo doesn't do is the dial. A size-matched placebo
is now part of how we judge a dial.

## 3. Dialogue: does speech survive?

Office scene, two scripted lines, seed 2101, 209 frames, Whisper large-v3-turbo word error against the script.

| arm | WER |
|---|---|
| control | 0.00 |
| sinister +1, +2, +2 with audio: protect | 0.00, 0.00, 0.00 |
| seductive +2, creepy +2 | 0.00, 0.00 |
| unhinged +2 | 0.00 (shouted); 0.05 with a free-text prompt |

On base H3, sinister +2 crushed the same lines (0.84). The H3 `<d>` dialogue format is not the reason: the original
free-text prompt also gives 0.00 on Pika. The remaining difference is the pipeline (Pika's distilled 6-step vs base H3
with its own steps/CFG); not separated. One seed, one scene.

## 4. Experimental dials

Seven creative contrasts in four kinds (opposites, plain vs featured, continuum, abstract), swept at −3 / −1.5 / +1.5 / +3
with transition scans and a seed-43 replication of the headline arms. Highlights:

- **oil painting ↔ pixel art** (2 seeds): −3 photoreal period drama (a rider on a horse indoors on both seeds) → −1.5
  classical light → +1.5 side-scroller staging → +2 isometric diorama → +2.5/+3 a pixel-art game level (seed 43 drew a
  HUD).
- **datamosh** (plain vs featured, 2 seeds): +2.25 keeps the subject crisp while the background breaks into a glitch
  mosaic; +2.5 glitch portraits; +3 glitch only. The −3 side is "anti-glitch": a clean, wholesome vintage scene.
- **owl ↔ octopus:** on a person it only restages the background (like the placebo). On an owl: +1.5 a barn owl, +2
  still an owl, +2.5/+3 an octopus on the same fence post (2 seeds at +3), +4.5 an octopus on a reef. Identity switches;
  no hybrid.
- **memory ↔ present:** a gentle look dial (vivid present vs misty, faded memory), 2 seeds at +3.
- **order ↔ entropy:** tidy and calm vs debris and running; motion leaks in on the + side, as its cosine with storm
  and unhinged (~0.58) predicted.
- **Style words arrive as an era, setting or format first.** Silent film → 1920s clothes and carriages; VHS → a 4:3 frame
  and older trains; oil painting → period drama. Describing the artifact instead ("grain, dust, scratches",
  `h3_x_film_artifact`) gave a cool desaturated grade with no grain at full resolution: mean saturation 5.0 vs 3.0 for
  the era wording (control 5.8).

## 5. Two dials together

oil_pixel −3 + datamosh +1.5 or +2.25 turned the photoreal period drama into an **actual oil painting** with visible
brushwork (2 seeds). Neither row alone does it. A meaningless placebo at datamosh's push (|push| ≈ 126) gives no
painting; the probe bank's "photoreal ↔ stylized" direction at the same push gives a half-painted mural. Pushing two
dials too far collapses the scene instead (oil +2.5 + memory +3 → a black frame with a few pixel glyphs). This is a large
*useful* output interaction at input cosine 0.30.

## 6. Do probe profiles predict renders? ("wheel vs renders")

For 48 arms, the predicted push on an axis (strength × the dial's ridge-fit coefficient on that h3-probes-v1 axis) was
compared with a pixel metric of the render minus its control.

| axis | pixel metric | arms agreeing in sign | dials agreeing (majority) |
|---|---|---|---|
| colour temperature | −(R−B) | 30/35 (p < 0.0001) | 10/11 (p 0.006) |
| time of day | −luma | 23/31 (p 0.005) | 8/9 (p 0.02) |
| motion | mean abs Δluma | 22/30 (p 0.008) | 10/12 (p 0.02) |
| light contrast | luma std | 12/21 (chance) | 4/7 |
| texture | mean abs Laplacian | 8/24 (inverted) | 2/7 |

One-sided binomial vs 50 %, 1 seed. Three axes predict direction; contrast doesn't (the metric is confounded by overall
darkness); texture is inverted (hypothesis, untested: the "rough/worn" side darkens and fogs, lowering a sharpness
metric).

## 7. What changed in how we make dials

- **Pair agreement is a floor, not a verdict.** Shipped dials scored 0.76-0.85; rejected ones 0.745-0.84.
- Judge against a **size-matched placebo**, not only the dial-off control.
- A creature or object **continuum needs its subject in the scene**.
- **Medium words → era first**; the medium itself needs ≥ +3 and usually costs the scene.
- **Rows interact.** The rack's input-cosine readout does not predict the painting interaction (cos 0.30).
