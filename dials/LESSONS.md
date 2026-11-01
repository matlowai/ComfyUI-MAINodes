# Dials: lessons learned

What the 2026-10-30 to 11-01 sessions taught, so nobody has to relearn it. Numbers are from Pika H3 Flex (6 steps), mostly
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

## Strength over denoising
- **On Pika, the prompt only matters in the first steps.** Late envelopes at +2 and even +8 changed nothing; constant
  beat every other shape for motion per unit of gain.
- **Beware "equal total gain" normalization.** It forced the early envelope to a 12x peak on step 1, which scrambled the
  scene; that was a 12x dial, not "earliness". Compare envelopes at equal peak as well.
- **An early kick (+6) is a creative tool,** reproducible per seed and dial-specific, not a controlled edit.

## Time and space
- A prompt-side dial cannot vary over clip time: every frame reads the same prompt. Clip-time control needs a time
  mask in a V2V pass (on/off per latent token), two-branch prediction blending, or a video-token / attention seam.
- **Blending predictions per frame does not keep a dial in its frames.** With route 1 (plain and dialled predictions
  blended per latent frame) the undialled frames still pick up about a fifth of the dial, because both branches read
  the same partly dialled latent; changes ramp over 1.5-2 s and miss 0.33 s beats. Blending on more steps changes
  nothing on Pika (k = 1-6 alike). Fine for sections and slow swells; beat-accurate needs another seam.
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
