# Dials: lessons learned

What the 2026-10-30 to 11-01 sessions taught (updated at the end of 2026-11-01), so nobody has to relearn it. Numbers are from Pika H3 Flex (6 steps), mostly
one seed; treat them as starting points.

## Writing pairs
- **Pairs are learned literally.** Name only the quality you want and keep everything else word-for-word identical.
  A "handheld camera" dial whose B side said "follows the action" made people jog; a storm dial with "wind whipping,
  debris flying" made people move instead of adding weather. Describe the image ("rock-steady frame" vs "shaky frame"),
  not the action.
- **Content dials need more strength than look dials.** Grade, mood and expression work at ±1; weather, style
  (claymation), creature swaps, underwater and crowds need ±2-3; +1 often only shifts the palette. That is why each
  dial carries its own useful/overcook strengths.
- **Some things don't come from text at this seam:** camera shake, zero gravity, a squirrel replacing a cat, and
  "timelapse" as a label (an explicit timelapse prompt does work, so the wording was the problem).
- **Watch for leaks into other qualities.** The expressive-face dial also made voices 4.8 dB louder (it shares cos 0.45
  with loudness). A `!` hold pair removed most of it (+1.7 dB), but a hold is linear: in a scene without dialogue the
  same dial still added laughter.
- **Equal slider numbers are not equal pushes.** Dials differ in size (a picture dial came out 0.6x its text twin), so
  compare dials at matched size, and use the map's combined-push readout.
- **Prompt sets are clean:** weighted `+`/`-` lines gave pair agreement 0.97; one `+1` and one `-1` line equal a pair.

- **Don't give every dial the same pleasant pole.** MOSS's day/night, grade and weather dials all had a "sunny, calm,
  pleasant" A side, so all three negatives pulled toward the same close-up tourist portrait. Give each A side its own
  neutral opposite. (v2 pairs not yet built.)
- **Keep time-of-day words out of a grade dial** ("sunset" vs "moonlight" put a sun in the frame), and keep actions out
  of weather ("pouring", "raging" made the person lunge).
- **A prompt that fights the test dial hides it:** a yellow raincoat made "calm, dry" look like a failed dial.
- **Asking for UI in the prompt gets UI:** "floating interface overlays, HP bar, skill window" produced a HUD menu in the
  video; removing the line removed it. "A clean cinematic frame" is enough.
- **A strong look dial replaces the character.** Psychedelic at +2.5 turned a dancer into a chrome fox and a rave outfit
  (and an exposed one); a detailed outfit in the prompt made her recognisable again when it switched off, but didn't hold
  her through the "on". Use a lower strength or a hold pair on the outfit, and keep public demos clearly SFW.

## Picture dials
- **H3 reads the picture first:** each picture is encoded as `<Picture 1>: [image] <prompt>`, so every prompt word
  sees it. The prompt is a lens on what gets read out of the picture (content, look, both); the same text on both sides
  keeps the wording itself out of the dial.
- **One matched pair already works,** just noisier: a single lizard/squirrel pair pointed 0.875 the same way as the
  12-pair dial and came out larger (|28.4| vs |23.4|); three pairs gave pair agreement 0.91.
- **The framing decides what the dial learns.** On 12 lizard/squirrel pairs, "a video of the subject in <Picture 1>"
  beat the default "style and content" wording on every measure (pair agreement 0.94 vs 0.89, split-half 0.96 vs 0.93,
  cosine with the text dial 0.56 vs 0.49) and reached a lizard at −4 where the default gave a mammal hybrid (1 seed).
  Naming the kind of subject ("the animal") was stronger still; averaging all framings also crossed. Size alone isn't
  it: the averaged dial was smaller than the default and still crossed.
- **Picture dials are weaker than text dials:** around −4 for what a text dial does at −2.
- **Batching resizes:** core Batch Images scales every picture to the first one's size; give mixed sizes their own
  sockets instead.

## Combining dials
- **Sum post rows once, in float64.** Adding four dials one after another in bf16 gave a different render for each
  of the 24 orders (MAD 15-24/255, 1 seed); one float64 sum makes the order irrelevant (MAD 0).
- **Most dials push the same way** (mean cosine +0.15 over 28 seeded dials). The clearest cancellations: evil cold ×
  lively (−0.34), miniature × claymation (−0.23). Storm + handheld + motion push 37% harder together than alone.

## Reading dials with probes
- **Probe profiles explain about half of a dial:** unexplained share 0.69 on average, against 0.97 for a placebo bank
  and 0.53 for a reworded probe (the ceiling). Read the top three axes; the single top axis flipped between two
  wordings of the bank for 7 of 28 dials.
- **Light, expression and mood are mostly one "intensity" direction** (a quarter of the bank's energy), so a dial can
  look like it pushes all three.
- **Pair wording leaks into profiles:** an evil dial whose pairs said "coldly" and "icy" loads on colour temperature.

## Where in the model
- **H3 does a dial's work in its first half.** Injecting only in blocks 0-24 gives the full effect (motion 1.08x,
  colour 1.10x of all blocks); only 25-49 (or the 26-37 range from the LoRA study) changes the clip by about 0.4x
  without moving the dial's quality: a perturbation, not an edit (2 seeds). No block range separated look from motion.
- **Today's post hook shifts every row of the text span,** vision-pad rows included, not only text-tagged rows.

## Editing dials
- **Remove a probe axis with the joint fit.** Taking colour temperature out of evil cold left every other axis within
  0.01 under the joint fit; the direct fit also took 0.14 off night and 0.10 off mood, because those probes overlap.

## Demo scenes, anchoring and prompting (2026-11-01 evening; single seed 42 unless noted)
- **A reference image keeps the character and room steady.** H3's reference-to-video (one frame of the character as `ref_image_0`)
  kept the same fighter in the same dojo through a hit-pause freeze; pinning the first and last frame (image-to-video) kept
  the scene too but made the freeze softer. Scene drift from frame 0: 36 unanchored, 34 first+last frame, 26 reference image.
- **Freeze depth with the reference image** (motion at the punch's impact, control 8.6): net -2 gives 3.1, net -4 gives 2.9,
  net -6 gives 1.2. Anchoring makes the dial less able to override the motion, and the response is not smooth (-4 is no deeper
  than -2); use about -6 for a clear hit-pause.
- **Describing the transition in the prompt changes how it looks.** "The world begins to melt, slowly and smoothly, into flowing
  rainbow light, building gently ... drifting back ... never sudden" turned hard cuts into visible in-between frames (colour
  ribbons creeping over the scene) and added a swirling aurora background. The dial schedule still sets *when*.
- **Strength ladder on an anime kitsune with a reference frame** (psychedelic dial on/off schedule; colour swing between on and
  off windows): +1.0 +3, +1.5 +5, +1.8 +15, +2.0 +27, +2.2 +25, +2.5 +30, +3.0 +32, +4.0 +37. Below +1.5 she stays herself and the
  world gets rainbow bursts; +1.8 is the threshold; from +2.0 she becomes a masked, rainbow-haired striped-suit figure every time;
  +3 and +4 go further (spiky crown, dark nebula, +4 stiff and symmetrical) without breaking, and the "off" windows come back clean.
  So the useful choices are +1.5 (her, trippy) or +2.0 (full transformation), not the values between.
- **Active dancing needs choreography in the prompt.** "Dancing and casting spells" gave a gentle sway (mean frame change 8.4);
  spins, leaps, high kicks, crouches and sweeping wand arcs on the drum hits nearly doubled it (15.7), at the same motion dial.
- **Outfits: describe what is worn, not what isn't.** "Closed down to the ankles" was ignored (high-slit robe, stockings, garters);
  "high-necked long-sleeved coat falling to the knees, dark fitted trousers tucked into tall boots, brown gloves" gave a covered
  look. A long staff clipped through the character; a short wand did not and made nicer glowing sigil trails. Check public
  clips frame by frame: even covered outfits can turn skin-tight when a look dial transforms the character.
- **Human-faced kitsune (ears and tail) and anime style both work in H3** ("2D anime, cel-shaded, cinematic, soft volumetric
  light" plus a clear character sheet); several seeds gave the same face.
- **Ops:** a wait loop using `pgrep -f <script name>` matches its own command line and never exits: wait on the job PIDs
  (`cmd & P=$!; wait $P`). A script that re-runs another script's top half can overwrite its own variables (a "which variant"
  setting was reset, so two renders silently repeated the control): set arguments after the exec.

## Strength over denoising
- **On Pika, the prompt only matters in the first steps.** Late envelopes at +2 and even +8 changed nothing; constant
  beat every other shape for motion per unit of gain.
- **Beware "equal total gain" normalization.** It forced the early envelope to a 12x peak on step 1, which scrambled the
  scene; that was a 12x dial, not "earliness". Compare envelopes at equal peak as well.
- **An early kick (+6) is a creative tool,** reproducible per seed and dial-specific, not a controlled edit.

## Time curves (clip-time strength inside one generation)
- **Colour and style dials switch fast; lighting dials ramp slowly.** A psychedelic dial followed an on/off curve at
  r = 0.93 and switched within 0.1-0.2 s; a day/night dial ramped over about 1.5 s with about 20% leaking into the "off"
  half. Neither follows individual drum hits (a beat is 0.33 s).
- **Levels between 0 and 1 are exact; levels outside extrapolate.** The blend is `v0 + M(v_dial - v0)` on predictions, so
  M = -2 is not a true strength of -2 and froze nothing (motion 4.7 at the impact vs 1.0 for the stacked rows). Build a
  curve that needs other strengths from stacked rows of the same dial, each with a 0-1 curve: a +0.5 constant, a +0.5 pulse
  into the wind-up and a -2.5 pulse at the impact gave net 0.5 -> 1 -> -2 -> 0.5. (A true-strength blend between
  predictions computed at the needed strengths is on the roadmap.)
- **A motion dial at -2 for a second is a hit-pause:** mean frame change at a punch's impact fell from 8.8 (control) to 1.1
  at -2 and 0.08 at -4, with a lurch (a motion spike) at each end of the freeze.
- **In a de-rope run, the second stage is a longer clip.** Time Smear stretches the clip (124 to 277 frames on the charge
  scene), so a curve defined as a fraction of the clip landed 0.3-0.5 s early in real time. The rack's `hold_map` input fixes
  this, but Time Smear runs after stage 1, so stage 2 needs its own copy of the rack (same rows) with `hold_map_used` wired
  in; one rack can't feed both (dependency cycle). A single-rack "attach hold map to MODEL" node is on the roadmap.
- **Audio protect works but isn't perfect:** speech errors 0.29 to 0.00 in 3 of 4 cases, loudness +1.8 to +0.1 dB;
  voice energy on one seed stayed bad. The video keeps 67-80% of the dial's effect.
- **A lazy If/Else Switch skips the de-rope stage:** off 75 s (identical to pass 1), on 330 s (identical to the de-roped
  clip), so one checkbox can replace a second workflow.
- **Scene stability:** even a plain control clip can cut between a foreground view and a wide view; a freeze adds a lurch
  at both ends. Anchoring with a first/last frame or a reference image is being tested (results in the study folder
  `codex/punch_ref/` when done).

## Time and space
- A prompt-side dial cannot vary over clip time: every frame reads the same prompt. Clip-time control needs a time
  mask in a V2V pass (on/off per latent token), two-branch prediction blending, or a video-token / attention seam.
- **Blending predictions per frame does not keep a dial in its frames.** With route 1 (plain and dialled predictions
  blended per latent frame) the undialled frames still pick up about a fifth of the dial, because both branches read
  the same partly dialled latent; changes ramp over 1.5-2 s and miss 0.33 s beats. Blending on more steps changes
  nothing on Pika (k = 1-6 alike). Fine for sections and slow swells; beat-accurate needs another seam.
- **De-rope moves clip-time curves unless they go through the hold map.** Stage 2 renders the held, longer clip; a curve
  over that clip landed 0.32-0.47 s early in real time on charge2 (124 -> 277 frames, the opening 0.75 s held 4x; exact,
  from the map). With the rack's `hold_map` link, stage 2's dial effect moved later by 0.42 s (psychedelic) and 0.19 s
  (space warp) in a lag fit of the per-frame effect (stage-2 row on vs off), 1 seed. The rendered effect itself trails M
  and is mixed with content changes, so renders confirm the direction and size, not a 1/6 s alignment.
- **A rack can't take a hold map from its own render:** Time Smear runs after stage 1, so wiring it into the stage-1
  rack is a cycle. The stage-2 rack is a copy with the same rows.
- **Keeping the soundtrack on the undialled branch removes most, not all, of a dial's audio change** (voice energy
  +5.0 -> +2.2 dB over 2 seeds): the audio tokens still attend to the dialled video.

## LLM dials (Gemma 4 31B)
- **Read the outputs, not only the proxies.** A regex said "zero slop words" at +2 while the text still opened with
  "a sanctuary of warmth".
- **Capture the model writing, not reading.** Pairs fed as the model's own reply gave cleaner directions (agreement
  0.75-0.84 vs 0.72-0.77, far less generic-wording contamination) than pairs fed as the user's message.
- **Averaging over a whole passage hides local decisions.** The "here are three options" menu format and habits like
  "not just X, it's Y" didn't steer; they are decided in a few tokens. Pool the opening reply tokens for those.
- **A "human prose" pole made of famous novels pulls toward memorized text** (it nearly reproduced *The Old Man and the
  Sea*). Use modern prose and specific-vs-cliché contrasts instead.
- **Check determinism first:** a dial harness needs strength 0 to equal the unhooked output exactly; an AWQ MoE model
  failed that, Gemma QAT passed.

## Other model families (MOSS-Image, Krea 2)
- **CFG halves a hook dial.** The hook shifts the negative branch too. On MOSS (cfg 3), shifting only the positive
  branch moved the target quality about twice as far, so MOSS text dials need about ±4 where H3 Pika needs ±1.
- **An unnormalized seam is fragile.** H3's refiner ends in an RMSNorm. Krea's `txtmlp` output does not: its token
  norms range 37–685, and a dial at strength 1 is a quarter of a typical token. Krea dials flip non-monotonically
  (+1 blown out while +0.5 and +1.5 are normal) and collapse into graphics at ±8. Shifting `txtfusion`'s output
  instead, before `txtmlp`'s RMSNorm, is the next seam to try.
- **The first render after a model swap can differ by one pixel level.** That came from ComfyUI, not the dial. Compare
  parity runs warm.

## Engineering
- **ComfyUI saves widget values by position.** Add new inputs at the end of a node, or every saved workflow loads with
  values in the wrong widgets.
- **Change a dial file's metadata without touching the vector** (rewrite and replace atomically) and key presets on the
  vector hash, so editing info never invalidates presets.
- **H3's tokenizer ignores `(word:2)` prompt weights** (they reach the model as literal text); word weights only mean
  something inside Make Dial.
- **De-rope keeps the dialogue** when V2V Init seeds the audio ("follow the original performance") and Audio Recover is
  set to "keep the original performance": the de-roped clip's audio matched pass 1 exactly.
- **Tests clean up after themselves** (`TemporaryDirectory`), and paths from users go through `folder_paths` resolvers.
- **UI that edits a hidden JSON widget** keeps workflows and the API in sync; size DOM widgets to fill the node and grow
  the node only when content changes, so users can shrink it.
- **Don't size a DOM widget before it is laid out.** Measured during `onConfigure` its height reads 0, and a "grow to
  fit" rule then grew the node on every workflow load.
- **Re-saving a workflow in a newer UI can resize nodes;** check example workflows for overlapping nodes before shipping.
- **The classic canvas draws multiline text without a label** and shows advanced inputs; the Vue ("Nodes 2.0") mode
  labels both and folds advanced inputs away. One-line fields with a `display_name` read well in both.
- **Core Load Image lists only files directly in `input/`,** not subfolders.
- **Scrub example workflows for absolute paths;** some node packs store a second copy in `widgets_values_named`.
- **`flock` hands its lock to child processes:** start a long-lived server with `flock -o`, or it holds the lock.
- **Test examples through the UI's Run button,** not only the API: it catches widget, layout and frontend problems.
- **ComfyUI's workflow undo grabs Ctrl+Z** before a custom widget sees it: route editor keys through a hidden read-only
  input. Background re-renders also drop keyboard focus, so restore it.
- **Presets must be copied, not shared,** or a drag edits the built-in constant.
- **A time-curve row is a blend of two model calls,** so levels are limited to 0-1 for exactness; the editor now reaches
  negative levels and shows effective strength (level x row strength) because rows multiply.
- **Dials in a subgraph:** ComfyUI loads subgraph blueprints shipped at `<custom_node>/subgraphs/*.json`; a lazy If/Else
  Switch plus a boolean is the clean way to make de-rope optional.
- **Working with several Claude agents:** brief them like peers (goal, files, rules, how to verify); give each its own
  git worktree and have it fast-forward MAIN under `flock`; give a strong model (Opus) the items that need careful reading
  of several systems; the auto-mode safety check blocks an agent from a GPU its brief told it never to touch, so tell it
  which servers are its own. Two GPU lanes (study servers on :8288 and :8289) roughly halve wall-clock for render batches.
- **Review before pushing:** run the full test suite, scan the diff for private paths and names, and look at the
  screenshots yourself; several agents' own checks missed layout and wording problems.
- **Private material stays local:** Dylan's music tracks drive local tests only; public pages use clips whose soundtrack
  comes from the prompt.
