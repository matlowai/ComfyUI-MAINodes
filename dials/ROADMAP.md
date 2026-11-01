# Dials roadmap

Dials are training-free steering vectors for MiniMax H3 made from prompt (or picture/video) contrasts. Work happens on
the MAINodes branch `dials-rack` (local, not pushed; ComfyUI-Dials stays stable). Lessons learned: `dials/LESSONS.md`.
Designs: `dials/docs/INTERACTION_ATLAS.md` (atlas), the 4D Control Field blueprint (automation order). Evidence for the
2026-10-31 items lives in the H3 motion study (`codex/` A-D reports, `renders/eval25-30`) and the LLM dial study.

## Done (alpha on `dials-rack`)
- **Dial Rack** (the multi-dial loader the community asked for, "spaghetti mode chaining dial apply"): rows with on/off,
  strength, solo, hold; wired dials become rows; presets; step envelopes. One row, four rows and all-off match the
  single-dial chain pixel for pixel (B1).
- **Map:** two rows on a 2D square, the dot is your prompt; saved pairings as chips; only the map resizes; Shift for fine
  moves; Sweep 3×3; ellipses, auto range and axis labels from each dial's info.
- **Make Dial:** pairs, hold pairs (`!`, `![group]`), word weights (`(words:w)`), pair weights (`A ||| B :: w`), prompt
  sets (`+w prompt` / `-w prompt`); Make Dial from Pictures and from Videos (alpha); Combine Dials.
- **Dial info in the dial file** (description, − / + labels, useful, overcook), set in every Make Dial node and edited
  with ⚙ in the rack (metadata only; presets hash the vector). 37 dials seeded from the 2026-10-31 Pika renders.
- **Example workflows:** Pika H3 Flex + de-rope with pass 1's audio preserved, for the rack, the picture dial and the
  prompt set (`examples/dials/*_pika_derope*`), all rendered end to end.

## Release blockers (before pushing to matlowai)
- [ ] Dylan's hands-on pass in the real UI (restart ComfyUI to load the info routes).
- [x] Rebuild the three de-rope examples so their Make Dial nodes carry info (re-runs otherwise save default info).
- [x] Row order (B6): reversing four rows changed a render (MAD 38/255) although post rows add commutatively; isolate
      pre vs post rows and bf16 rounding; consider summing post rows once in float32.
- [ ] Review the Codex-written parts once more for pack style (presets, hold rows, envelopes, video dial).
- [ ] Dial pack 2: ship the dials that passed 3 seeds (draft notes: study `codex/A5_pack2_notes.md`), with their info.

## Workstream 1: interaction atlas (design `dials/docs/INTERACTION_ATLAS.md`)
Rule: same-space vector math is exact; semantic labels are hypotheses; "overcooked" needs render evidence. No new
Qwen or DiT passes during sampling; the user's strengths are never changed silently.
- [x] **Info v2 (first, it changes the file format):** separate negative and positive useful/overcook (the lizard dial
      only works on one side); unknown as a real state (null, drawn as a grey dashed ring, never green); evidence kind
      (creator-set / one seed / multi-scene) and pipeline (base H3 / Pika); optional failure notes. Old files and v1
      info keep loading.
- [x] **Interaction matrix:** for the active post rows, each pair's signed share of the combined shift
      (`s_i·s_j·v_i·v_j` over `|Σ s_i v_i|²`), reinforcing vs cancelling, and "who pushes" per row; in the rack report
      and as a small matrix next to the map.
- [x] **Combine Dials provenance:** exact recipe in the file (weights, orthogonalize, parent vector hashes, result
      hash); fix orthogonalize against a zero vector.
- [x] **Probe bank:** 12-16 bipolar probes built with Make Dial at the post-refiner seam (motion, camera, light, colour,
      time of day, weather, texture/material, style, expression, mood, crowd/scene, voice), held-out subjects, matched
      lengths; versioned; probes whose held-out agreement is weak are dropped or renamed.
- [x] **Per-dial profiles:** direct probe coefficients `s·(v·p)/(p·p)` and a ridge joint fit with the unexplained share
      shown; cached by vector hash + bank version.
- [x] **Influence wheel:** fixed sectors, one coloured layer per dial, signed in/out around a zero ring, hover = per-dial
      contributions; grey until a sector has calibration evidence.
- [ ] **Wheel vs renders:** check that a dial's top probe axes show up in its renders (e.g. "toward night" looks darker); fold it into the next batch that renders anyway. Until then the wheel stays grey.
- [ ] **Drop a point on the frontier and move it (Dylan):** probes are dials, so a manual offset in one direction is a
      probe row with a strength; drag a wheel sector to add/remove that probe, or ask for rack strengths that best
      reach a target shape (least squares over the active rows, shown as a suggestion).
- [ ] **Time × concept heatmap** (once automation exists): video time across, probes down, colour = summed steering.
- Research, only after the above: seed-matched calibration sweeps to earn warnings; automated contrast search;
  prompt-aware pre-refiner response; a shared H3 post-refiner SAE if probes miss real structure; denoiser interaction
  residuals `f(A+B)-f(A)-f(B)+f(0)`, later for LoRAs.

## Workstream 2: dial automation (DAW-style)
Two different clocks: denoising steps (when during sampling) and video time (when in the finished clip).
- [x] **Strength over denoising steps** = step envelopes (D2). Finding (eval29, Pika 6-step): prompt-side dials act only
      in the first steps; late envelopes at +2 and +8 change nothing; an early kick (+6) scrambles the scene in a
      dial-specific way. Next: test base H3 20-step, where a late "style pass" might exist.
- [ ] **Dial envelope format:** one reusable curve type (keyframes, interpolation, normalized time) usable for steps and
      for video time, with an optional audio-envelope input.
- [ ] **Dial on a time window (works with existing nodes):** render the clip, then a V2V pass with the dial on and H3
      V2V Init's time-varying mask regenerating only frames t0..t1 (rest frozen, audio from pass 1). On/off per latent
      token (about 3-4 frames); align edges to the 17-frame grid. Needs a small "Dial Time Window" node and a Pika
      workflow (pass 1 -> windowed dial pass -> de-rope).
- [ ] **Temporal steering prototype (baseline first):** two denoiser evaluations per step on the same latent, without
      and with the dial, blended by a keyframed mask: `v_out = v0 + M(t,x,y)·(v_dial - v0)`. About 2x sampling cost; no
      new dial math. Measure time leakage, flicker, effect on audio, and overhead.
- [ ] **Faster per-frame route (after the baseline):** attention blend (video tokens at frame t attend to
      "prompt + w(t)·dial", text computed at a few strength levels and merged) or per-frame video-token injection
      (Concept Lab route; needs validated video-space directions).
- [ ] **Audio-reactive envelopes:** RMS loudness, onsets and transients from an existing audio file turned into strength
      keyframes (camera shake on drum hits, mood rising with a crescendo). For H3's own audio: two passes (generate,
      analyse, re-render with the envelope); a live reaction during sampling is research.
- [ ] **Animated spatial masks:** extend the proven temporal method with keyframed / tracked masks; temporal consistency
      at mask edges is the main risk.

## Workstream 3: dial library
- [ ] Pack 2 release (see blockers). Rejected so far: handheld v1, shaky v2, storm v1, time feel v1/v2, zero gravity,
      the squirrel side.
- [ ] **Picture dials, proper test:** the lizard photo dial is 0.6x the text dial's size and 0.49 aligned; at −4 it gave
      a lizard-pawed hybrid. Test at matched size (−4 to −6), more varied pictures, picture + text together.
- [ ] **Video dials:** two generated pairs gave no timelapse; the timelapse prompt itself works on Pika, so try a text
      timelapse v3 with that wording and real matched footage (6+ pairs).
- [ ] **Prompt sets:** night-rain set (agreement 0.97) gives evening/night but not visible rain at +1; weight rain up or
      split it into its own row.
- [ ] **A/V per row:** a "video only" toggle (sinister picture, intelligible speech), from ComfyUI-Dials'
      `experimental/split-and-dial-to-lora`.

## Workstream 4: dials for LLMs / VLMs (study `2026-10-31-llm-dials`, Gemma 4 31B)
- Style dials (formal, terse, mood, poetic captions) work at the middle layer (29 of 60); late layers collapse.
- Deslop: cliché ↔ specific pairs read as the model's own reply work at layer 29 +2; vocabulary steers; the
  "here are three options" menu format and sentence-shape habits don't move (decided in the first reply tokens).
- Next: pool only the first reply tokens for format habits; 24+ varied cliché/specific pairs; blind preference reads;
  per-head analysis at the best layer; the picture-pair dial applied while the VLM captions an image.

## Later / research
- **Voice-contrast dials:** audio never enters H3's text encoder; needs the DiT's audio-token seam.
- **Research bridge (blueprint P4+):** prompt-space dial -> video-token direction via Concept Lab; then clip-time
  curves, painted regions and the motion-oracle sidechain with De-Rope.
- **Ideas from DiffSynth-Studio** as lab tools once the rack UX settles.
