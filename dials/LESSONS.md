# Dials: lessons learned

What the 2026-10-30/31 sessions taught, so nobody has to relearn it. Numbers are from Pika H3 Flex (6 steps), mostly
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

## Strength over denoising
- **On Pika, the prompt only matters in the first steps.** Late envelopes at +2 and even +8 changed nothing; constant
  beat every other shape for motion per unit of gain.
- **Beware "equal total gain" normalization.** It forced the early envelope to a 12x peak on step 1, which scrambled the
  scene; that was a 12x dial, not "earliness". Compare envelopes at equal peak as well.
- **An early kick (+6) is a creative tool,** reproducible per seed and dial-specific, not a controlled edit.

## Time and space
- A prompt-side dial cannot vary over clip time: every frame reads the same prompt. Clip-time control needs a time
  mask in a V2V pass (on/off per latent token), two-branch prediction blending, or a video-token / attention seam.

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
