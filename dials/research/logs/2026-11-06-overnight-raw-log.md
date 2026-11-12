# Dials overnight 2026-11-06 (findings log; morning report at the end)

Objective (Dylan, 2026-11-06): "lets get the latest matlowai/mainnodes and poke at dials a bit" → "Run a few renders,
Build dial-making skill, Make new dials"; overnight: "you have enough on the roadmap around dials to look at and research
through", "feel free to pull things down as needed", weird experiments welcome ("psychedelic or two different animals for
a continuum or really abstract concepts ... especially when going between hugely different styles"). No pushes/posts.

Stack: ComfyUI 0.43.0 core 25e43163d; ComfyUI-MAINodes main c3f2315 (v1.2.2 + PR #11). Pika H3 Flex 6-step lcm,
int8 convrot FL2VA, nvfp4 text encoder. Scene: MAINodes' shipped Simple example prompt (woman in a red coat, empty train
platform at dusk, train pulling in; 1280x704x141, 24 fps), seed 42, FL2V with no first frame (= text-to-video),
de-rope OFF. One-row Dial Rack per arm. Every arm minted (`workflows/dials_evil1106_*`, `workflows/dials_x1106_*`) and
launched through `queue_scene.py`. Contact sheets: frames at 0.5 / 2.917 / 5.333 s.

**Read every verdict below as: 1 seed (42), 1 scene, stills unless "playback" is written.** The subject is seen from
behind in the control, so face-led dials have little face to work on.

## A. Villainy pack sweep (GPU0 :8188): control + 8 dials x {+1, +2}

| dial | +1 | +2 |
|---|---|---|
| sinister | same shot and layout; sunset gone, cold blue sky, dimmer platform (a clean mood/grade shift) | restaged: wide, desolate overcast platform, woman small and still in profile, train moved right (past its info's overcook 1.5) |
| creepy | she turns to profile and stares, face now visible; cold grey light, platform lights on | darker, sterile fenced station, face in shadow, staring profile |
| cold | restaged: she walks toward camera, neutral face, overcast blue | wide; brisk walk in heels with a briefcase: the "icy corporate" read |
| unhinged | blue dusk, hair whipping, train speeding past: more energy | **horror**: she sprints at the camera screaming, white-painted ghoul face, dark station. No blood/weapon in the sampled frames. Not for public demos without review |
| seductive | keeps the warm sunset; she walks toward camera | grand glass-roofed hall, symmetrical glamour walk |
| corrupted | layout close to control; gloomy green train, dimmed dusk | foggy grim station, dark silhouette; decay as atmosphere, no visible rot |
| dread | tight over-the-shoulder, cold blue, train lights approaching | close profile glancing back over her shoulder: foreboding |
| impish | keeps the warm dusk; turns to camera | walks toward camera with a confident look; sunset kept |

Audio (whole-track, ebur128 integrated loudness; spectral centroid mean). Control −24.5 LUFS / 2677 Hz.

| dial | +1 LUFS (Δ) | +2 LUFS (Δ) | centroid +1 / +2 Hz |
|---|---|---|---|
| sinister | −19.1 (+5.4) | −19.6 (+4.9) | 2692 / 2957 |
| creepy | −28.0 (−3.5) | −34.2 (−9.7) | 2621 / **1452** |
| cold | −20.6 (+3.9) | −23.3 (+1.2) | 3019 / 3425 |
| unhinged | **−16.9 (+7.6)** | −17.8 (+6.7) | 2819 / 3120 |
| seductive | −22.5 (+2.0) | −27.2 (−2.7) | 2904 / 2518 |
| corrupted | −23.6 (+0.9) | −30.9 (−6.4) | 2610 / 3745 |
| dread | −20.9 (+3.6) | −22.8 (+1.7) | 3251 / 2197 |
| impish | −20.1 (+4.4) | −29.5 (−5.0) | 2894 / 3105 |

Levels only; nobody has listened yet (Dylan: playback owed). No dialogue in this scene, so no WER.

Cross-dial patterns (1 seed):
1. Warmth survives only at the light end (seductive, impish); the rest kill the sunset. Matches cosines: impish·cold 0.23,
   seductive·cold 0.39 vs sinister·cold 0.69.
2. Most dials turn her to face the camera (control: walking away; sinister +1 and corrupted +1 keep her back).
   **Template-leak test (done, 1 seed):**
   - `h3_x_sinister_noview` (released sinister slot text, camera-free templates; cos 0.968, |v| 39.9): +1 is the same
     shot as sinister +1 (back to camera, cold blue), +2 restages to a wide profile like sinister +2. → templates are
     not the cause.
   - `h3_x_template_placebo` (grey vs blue scarf in the same templates; cos 0.002 to sinister; |v| 10) at ×4 / ×8
     (|push| 40 / 80 = sinister at +1 / +2): she stays seen **from behind** in both. → the turn toward camera is
     carried by the trait (expression/presence content), not by push size.
   - But the placebo **does restage the background** (green-livery train, different station, warmth partly gone at ×8).
     → background restaging under a dial is partly "any push of this size", not the dial's meaning. The same green
     train shows up in many arms (corrupted, dread +2, impish +2, memory): an attractor the scene falls into when
     perturbed. A size-matched placebo is the control that separates "this dial" from "any push".

## B. Experimental dials (h3_x_*, GPU1 :8189, own control): −3 / −1.5 / +1.5 / +3

Made 2026-11-06 with Make Dial (base FL2VA int8, nvfp4 TE, hook, debias on). Pairs:
`pairs/new1106/`. Make reports and file checks:

| dial | kind | agreement | debias | \|v\| | nearest library dials (cos) |
|---|---|---|---|---|---|
| datamosh | plain vs featured | 0.857 | 12 % | 56.2 | psychedelic +0.55, spacewarp +0.52 |
| vhs | opposites (look) | 0.871 | 2 % | 51.3 | world_worn_v2 +0.55, world_worn +0.53 |
| silentfilm_cyberpunk | style continuum | 0.892 | 1 % | 57.8 | psychedelic +0.29 (novel) |
| oil_pixel | style continuum | 0.902 | 2 % | 61.3 | claymation +0.19 (most novel) |
| owl_octopus | creature continuum | 0.898 | 2 % | 32.4 | psychedelic +0.31 |
| order_entropy | abstract | 0.818 | 3 % | 42.1 | weather_storm +0.59, evil_corrupted +0.57 |
| memory_present | abstract | 0.820 | 6 % | 41.2 | evil_corrupted +0.41, world_worn_v2 +0.40 |

Plain-vs-featured had the largest debias share (12 % vs 1-6 %): the added clause's length shows up as "more wording",
as the mechanism predicts.

| dial | −3 | −1.5 | +1.5 | +3 |
|---|---|---|---|---|
| oil_pixel | **period drama**: platform → 18th-c palace hall, red ball gown, a man in a tailcoat on a horse indoors ("Renaissance oil painting" read as an era, photoreal) | grand old glass-roofed station, golden backlight, faces camera | **side-scroller staging**: flat side-on shot, she walks in profile past a train (still photoreal) | **isometric pixel-art game level**: she's a tiny red sprite, the train a row of colourful pixel carriages |
| datamosh | **"anti-glitch" = wholesome vintage**: spotless sunny country station, hanging flower baskets, 1950s red jacket and skirt, on the phone | vintage country station, warm sunset kept | colder, more motion blur; no glitching yet | **scene gone**: pure horizontal glitch blocks in the coat's red and the train's white/navy |
| memory_present | **vivid present**: crisp saturated daylight, vivid red coat, faces camera | (not sheeted) | soft hazy dusk, pensive profile | **faded memory**: misty, washed-out light, scene kept, gazing off. A clean look dial; the abstract arrived as haze + fade + wistfulness |
| order_entropy | **order**: bright tidy white station, calm smiling woman in a neat blazer | (not sheeted) | dimmer, some blur, walks away | **chaos**: debris on the platform, dust/fog, she runs. The abstract arrived as disaster + motion, as its storm/unhinged cosines (+0.57-0.59) predicted: motion leaks in |
| silentfilm_cyberpunk | **1920s-30s**: tweed coat, lace collar, cloche hat, steam-era carriages, muted near-monochrome (photoreal, not a b&w film look) | 1940s hat and coat, vintage carriages | sleek white bullet train, modern platform with tactile paving | **night city + concept car; character swapped** for a young woman with a pink ponytail/jacket. Photoreal, not cel-shaded. ⚠ apparent age younger: review before any public use |
| owl_octopus | no creature; green/yellow train, over-the-shoulder | no creature | no creature; red/white modern train | no creature; white modern train, glass-roofed hall. **Only background restaging, like the placebo**: a creature continuum has nothing to act on in a scene without an animal (and |v| 32 is the smallest) |
| vhs | **clean digital**: crisp bright modern tram, she faces camera | crisp modern train | older grimy commuter train, softer/darker | **4:3 pillarbox (black side bars)**, old subway train, softer image: "VHS" arrived as old-TV aspect + era. No tracking lines/static visible in stills (playback owed) |

**Pattern across the style dials (1 seed):** style/medium words mostly arrive as an **era, setting or format**, not as the
medium's surface: silent film → 1920s people and carriages; oil painting → period drama; VHS → 4:3 and older trains;
cyberpunk → photoreal night city. Only at +3 did two cross into the medium itself: pixel art (a full pixel-art level) and
datamosh (pure glitch blocks). Expect medium artifacts to need ≥+3 and to cost the scene.

**Transition scan (GPU1, same control, 1 seed):**

| arm | what it shows |
|---|---|
| datamosh +2 | dark side-on profile walk; no glitch yet |
| **datamosh +2.25** | **the sweet spot**: she stays crisp and photoreal walking in profile while the train behind her breaks into a blocky glitch mosaic (subject intact, background moshed) |
| datamosh +2.5 | glitch-art close-up portraits with RGB channel washes (red / purple / cyan) and train-window blocks sliced across; a different face (identity lost) |
| datamosh +2.75 | pure glitch blocks, like +3 |
| oil_pixel +2 | isometric 3D diorama at night: tiny red figure on the platform, train alongside |
| oil_pixel +2.5 | isometric pixel-ish level on a bridge, red sprite, boxy train carriages |

Datamosh's usable "scene + glitch" window is narrow, ~2.25-2.5 (a quarter of a strength unit) on this seed. The oil ↔
pixel path in full: period drama (−3) → classical light (−1.5) → side-scroller staging (+1.5) → isometric diorama (+2) →
pixel-art level (+2.5 / +3). Both progressions are the best explainer material of the night.

**Follow-ups on GPU1 (1 seed):**

- **"Describe the artifact" test** (`h3_x_film_artifact`: clean colour ↔ "black-and-white footage, heavy grain, dust and
  scratches, flickering exposure", no era/place/costume words; agreement 0.864, |v| 47.9, cos −0.35 with
  silentfilm_cyberpunk, i.e. it leans the silent-film way). +1.5: older commuter train at warm dusk (era again). +3:
  cool desaturated teal grade, fog, vintage carriages, longer 1940s coat; **no grain or scratches even in full-res
  crops**. Mean saturation: control 5.8, film_artifact +3 5.0, silentfilm −3 **3.0**. → Describing the artifact did
  not beat the era wording; film surface texture doesn't come through this seam on this seed. (Corrected the skill,
  which had recommended describing the artifact without evidence.)
- **Owl ↔ octopus on an owl scene** (`pairs/new1106/owl_scene_prompt.txt`, own control): −3 a
  different, stiffer owl; control a tawny owl; **+1.5 a barn owl** (first step = a sibling species, no hybrid); **+3 an
  octopus sitting on the same fence post in the same meadow**; **+4.5 an octopus on a coral reef underwater** (the
  setting follows the creature). The continuum crosses at ~+3 once its subject is in the scene. Hybrid hunt: +2 still a
  barn owl (darker, wider-eyed), +2.5 already a full octopus perched on the fence rail. **No in-between creature: on
  this seed identity switches between +2 and +2.5**, while the style continua (oil ↔ pixel) changed gradually.

## D. Dialogue / speech test (GPU0, Pika, seed 2101, 209 frames)

Prompt: `pairs/new1106/dialogue_office_prompt.txt` (the two scripted lines of the original sinister
WER test, H3 `(S1) says: <d>[English] ...</d>` format, office, both faces visible). Scorer:
`code/dial_dialogue_wer.py` (whisper-large-v3-turbo local, greedy, English; WER vs the two lines).
Original result for comparison (base H3, not Pika; the other machine provenance): base 0.00, seductive +2 0.00, unhinged +2 0.42,
sinister +2 0.84.

| arm | WER | LUFS | transcript |
|---|---|---|---|
| control | 0.00 | −25.5 | exact |
| seductive +2 | 0.00 | −30.0 | exact |
| creepy +2 | 0.00 | −29.5 | exact |
| sinister +2, audio: protect | 0.00 | −26.6 | exact |
| sinister +2 (unprotected, arm `sinister_two`; first attempt refused by the launcher's prefix guard, my naming) | **0.00** | −25.4 | exact; picture near-identical to the protected arm |
| sinister +1 | 0.00 | −27.0 | exact |
| unhinged +2 | 0.00 | −23.2 | exact words, transcribed with "!" (shouted) |

Pictures (sheet `dialogue.jpg`): control warm afternoon office, he leans over her desk; sinister +1 cooler, he looms
more; **sinister +2 + protect keeps the sinister picture** (cool grey, looming, she looks up warily) with perfect
words; **unhinged +2 dark night office, she screams** (wild hair, wide mouth) yet both lines are intact; seductive +2
warm lamp-lit intimate office; creepy +2 dark blue monitor-lit office, her face in shadow, him looming behind. So far no
dial damaged speech on Pika in this scene (base H3 had unhinged 0.42, sinister 0.84). **Unprotected sinister +2 is also
0.00**, so audio: protect made no measurable difference here. Confound: this test changed both the pipeline (Pika
6-step vs base H3) and the prompt format (H3 `<d>[English] …</d>` tags vs the original free-text "says clearly: '…'").
**Prompt-format control (free-text "says clearly: '…'" prompt, as in the original test; Pika, seed 2101, 209 f):**
control WER 0.00 (−28.9 LUFS), **sinister +2 WER 0.00** (−24.9 LUFS), unhinged +2 WER 0.05 (−23.1 LUFS; "happened" → "hacked"; on screen he snarls and slams the desk, she slumps then screams). → The `<d>` tag format is
not why speech survives. Remaining difference vs the original 0.84: the pipeline (Pika 6-step distilled LoRA vs base H3,
which also differed in steps/CFG/quantization). Hypothesis, not separated: Pika's pipeline keeps scripted speech under
evil dials that crushed it on base H3. One seed, one scene.

**Seed 43 replication (GPU0, own seed-43 control; sheets `s43_a.jpg`, `s43_b.jpg`): all eight headline arms replicate.**

| arm | seed 42 | seed 43 |
|---|---|---|
| oil_pixel −3 | palace hall, red gown, rider on a horse indoors | palace hall, red period gown, **rider on a horse indoors again** (a stable motif of this direction) |
| oil_pixel +3 | isometric pixel-art level, red sprite | pixel-art game level **with a HUD** (score, hearts, timer), red sprite + pixel vehicle |
| datamosh −3 | wholesome vintage country station, flower baskets | the same read: vintage station, flower baskets, 1940s car |
| datamosh +3 | pure glitch blocks | glitch-sliced portrait in red/blue (= seed 42's +2.5 look): **glitch replicates, threshold shifts by seed** |
| memory_present +3 | misty faded wash, pensive profile | hazy golden mist, pensive profile |
| order_entropy +3 | debris, dust, she runs | debris, smoke, she runs past the train |
| silentfilm −3 | 1920s-30s clothes, steam-era carriages | 1920s couple, vintage spoked-wheel railcar, cloche hat |
| silentfilm +3 | night city, concept car, identity swap | futuristic glass hall, concept supercar, the same pink-jacket identity swap (⚠ review) |

These are now **2-seed** findings (one prompt). GPU1 seed-43 checks (own control, sheet `s43_sweet.jpg`): **datamosh +2.25 replicates the
sweet spot** (crisp woman in red walking in profile against a glitch mosaic, near-identical composition), **+2.5 the
glitch portrait**, and **owl → octopus +3 the octopus on the fence post**. So the datamosh window ~2.25-2.5 holds on 2
seeds on GPU1 (GPU0 seed 43 reached the portrait stage already at +3; thresholds are seed- and GPU-sensitive at the
edges).

**Combinations (rack with two rows, GPU1, seed 42; sheet `combos.jpg` shows each part alone beside the combo):**

- **oil_pixel −3 + datamosh +2.25 → an actual oil painting**: two baroque women in billowing red and silver gowns before
  a painted city with domes and a river, visible painterly texture. Neither part does this alone (oil −3 = photoreal
  period drama; datamosh +2.25 = photoreal subject against glitch blocks). Hypothesis (untested): datamosh pulls the
  image off "photographed footage", which lets oil's *medium* half through. **Controls (sheets `combo_controls.jpg`, `combo_style.jpg`):**
  - datamosh +1.5 instead of +2.25: **still an oil painting**, now hung in a gilded frame against a marble wall, again with
    a rider on a horse;
  - same combo on **seed 43** (GPU1 s43): **painting replicates** (billowing red gown, woman in white and blue, domed city);
  - oil −3 + the meaningless template placebo at datamosh's push (×12.7, |push| ≈ 126): **no painting**, a photoreal
    palace room with chandelier and piano → the medium comes from datamosh's direction, not from push size;
  - oil −3 + the bank's style probe (photoreal ↔ stylized; cos +0.075 with datamosh) at the same push (×2.86): **partial**:
    a painterly, mural-like scene, figures and riders on white horses half painted onto a flat plaster wall.
  → "Away from photoreal" helps the painted medium appear; the generic stylized direction gets partway, datamosh's
  direction all the way (2 seeds for datamosh, 1 for the style probe). Also: oil −3 put a rider on a horse in 5 of 6
  renders: H3 ties "Renaissance oil painting" to the equestrian-portrait tradition.
- **oil_pixel +2.5 + memory_present +3 → collapse**: a near-black frame with a few pixel-font glyphs, like a game title /
  loading card. The summed push broke the scene into "game UI".

## C. ROADMAP "wheel vs renders": do probe profiles predict renders? (first answer)

Method: `code/dials_wheel_vs_renders.py`. For each arm, predicted push on an axis = strength × the dial's
ridge joint-fit coefficient on that h3-probes-v1 axis (λ 0.1); measured = pixel metric(arm) − metric(control, same GPU).
Metrics at 320 px, every 2nd frame: colour_temp −(R−B); time_of_day −luma; light_contrast luma std; motion mean
|Δluma|; texture mean |Laplacian|. Arms: 16 evil + 2 noview + 2 placebo (GPU0 control), 28 experimental (GPU1 control).
1 seed (42), one prompt. "Confident" = |predicted push| ≥ 0.15 probe units. Raw: `docs/measurements/DIALS_WHEEL_{EVIL,X}_2026-11-06.json`
; contact sheets in `docs/measurements/dials_overnight_2026-11-06_sheets/`.

| axis | sign agrees, arms | p (one-sided binomial) | per-dial majority | p | Spearman evil / x |
|---|---|---|---|---|---|
| colour_temp | **30/35** | <0.0001 | **10/11** | 0.006 | +0.44 / +0.85 |
| time_of_day | **23/31** | 0.005 | **8/9** | 0.020 | +0.58 / +0.42 |
| motion | **22/30** | 0.008 | **10/12** | 0.019 | +0.74 / +0.45 |
| light_contrast | 12/21 | 0.33 | 4/7 | 0.50 | −0.25 / +0.10 |
| texture | 8/24 (inverted) | 0.97 | 2/7 | 0.94 | −0.53 / −0.49 |

Reading: colour temperature, brightness (time of day) and motion probe coefficients predict the direction of the
render change, even counting each dial once. Light contrast doesn't (my luma-std metric is confounded by overall
darkness). Texture is **inverted**: hypothesis (untested): the probe's "rough/worn" side makes scenes darker, softer and
foggier, which lowers a Laplacian sharpness metric; a material-roughness metric would be needed.
→ For Dylan: the rack's influence wheel could stop greying out colour_temp, time_of_day and motion (evidence: this
table, 1 seed); keep the other sectors grey. Not changed in code.
