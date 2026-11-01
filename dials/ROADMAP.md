# Dials roadmap

Dials are training-free steering vectors for MiniMax H3 made from prompt (or picture/video) contrasts. Work happens on
the MAINodes branch `dials-rack` (pushed for testers; ComfyUI-Dials stays stable). Lessons learned: `dials/LESSONS.md`.
Designs: `dials/docs/INTERACTION_ATLAS.md` (atlas), `dials/docs/TIME_AND_AUDIO.md` (time curves, audio-reactive, audio protection). Evidence for the
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
- **Example workflows:** Pika H3 Flex + de-rope with pass 1's audio preserved, for the rack, the picture dial (folders),
  two pictures, picture groups and the prompt set (`examples/dials/*_pika_derope*`), all run end to end through the UI.
- **Interaction atlas v1:** info v2 (per-side strengths, unknown, evidence, pipeline), interaction matrix and "who
  pushes", Combine provenance, probe bank `h3-probes-v1` (14 axes), per-dial profiles, influence wheel.
- **Make Dial from Pictures:** picture groups of any size on their own sockets, and a framing choice (picture prompt,
  content, look, bare, all averaged).

## Release blockers (before pushing to matlowai)
- [ ] Dylan's hands-on pass in the real UI (restart ComfyUI to load the info routes).
- [x] Rebuild the three de-rope examples so their Make Dial nodes carry info (re-runs otherwise save default info).
- [x] Row order (B6): reversing four rows changed a render (MAD 38/255) although post rows add commutatively; isolate
      pre vs post rows and bf16 rounding; consider summing post rows once in float32.
- [ ] Review the Codex-written parts once more for pack style (presets, hold rows, envelopes, video dial).
- [ ] Dial pack 2: ship the dials that passed 3 seeds (draft notes: study `codex/A5_pack2_notes.md`), with their info.
- [ ] Small UI: a minimum rack node size (a tiny node hides the map); wheel labels clip at the edges; check the full rack
      (map, matrix, wheel) in the Vue ("Nodes 2.0") node mode.

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
- [x] **Dial editor (Dylan; render check pending):** open a dial and see it in the vector space: its probe profile as bars, and a 2D view of
      the dial library (two probe axes, or the library's top principal components) with the dial as a point. Drag bars
      to add or remove probe components (`v' = v + Σ Δβ_k·p_k`; dragging an axis to 0 removes that flavour), or drag
      the point; live readouts (size, cosine to the original and to neighbours). Export as a new dial file with
      provenance (parent hash and the edits) and info. Exact vector math; whether the edit shows in renders needs
      evidence. Shares the probe math with "drop a point on the frontier".
- [ ] **Time × concept heatmap** (once automation exists): video time across, probes down, colour = summed steering.
- Research, only after the above: seed-matched calibration sweeps to earn warnings; automated contrast search;
  prompt-aware pre-refiner response; a shared H3 post-refiner SAE if probes miss real structure; denoiser interaction
  residuals `f(A+B)-f(A)-f(B)+f(0)`, later for LoRAs.

## Workstream 1b: where in the model
- [x] **Per-block strengths:** a 50-cell strip per rack row (delta injection before each block; all-ones = today's dial,
      bit-identical). Finding (2 seeds): blocks 0-24 carry the whole effect, look and motion together; 25-49 only
      perturbs. No range separates look from motion (study `codex/blocks/BLOCKS.md`).
- [ ] Finer early ranges (0-8, 8-16, 16-24) and base H3 20-step, before calling it closed.

## Workstream 2: dials over time and audio-reactive dials (design `dials/docs/TIME_AND_AUDIO.md`)
Two clocks: denoising steps (when during sampling) and clip time (when in the finished clip). Clip-time control must
live inside the generation; a V2V pass is too slow to be the main route.
- [x] **Strength over denoising steps** = step envelopes (D2). Finding (eval29, Pika 6-step): prompt-side dials act only
      in the first steps; late envelopes at +2 and +8 change nothing; an early kick (+6) scrambles the scene in a
      dial-specific way. Next: test base H3 20-step, where a late "style pass" might exist.
- [x] **Route 1 built (2026-11-01, `timecurve.py`, README "Time curves"):** identity exact on GPU (M = 0 / 1 pixel-identical);
      no seams, but the dial leaks across the clip through the shared latent (M = 0 half gets ~20 %, M = 1 half 80–90 %,
      seed 42; weak on seed 43) and changes ramp over 1.4–2 s; k = 1-6 alike, so use k = 1-2 (1.12x / 1.24x).
      Not beat-accurate on music. Next: route 2 for sharper timing. Original plan:
- [ ] **Route 1, two-branch blend in the early steps (build first):** run the first k steps without and with the dial
      and blend predictions per latent frame, `v = v0 + M(t)·(v_dial − v0)`, with separate video and audio curves; dial
      off after step k. About 1.33x on Pika (k = 2). Checks: M = 0 is bit-identical to no dial, M = 1 equals today's dial.
      Measure seams / flicker, timing lag, overhead.
- [ ] **One curve type** (keyframes, interpolation, normalized time) for step envelopes and clip time, with an audio
      source option; per-row curve editor over the clip timeline with the waveform.
- [ ] **Audio-reactive from the user's music (main case):** the track goes into H3 as reference audio and the same file
      drives M(t): loudness, onsets, beat grid, low / mid / high bands; gain, offset, threshold, attack / release.
- [x] **Hold map -> dial envelope link (Dylan):** the rack's optional `hold_map` input (Time Smear's `hold_map_used`)
      evaluates clip-time curves in real time in stage 2's stretched clip; held copies of a frame get its value. Drift
      without it on charge2: the ramp landed 0.32-0.47 s early (exact, from the map). The rack that takes the map can only
      feed stage 2 (Time Smear runs after stage 1), so stage 2 gets a copy of the rack. Step envelopes and block profiles
      have no clip-time axis and need no link.
- [ ] **Route 2, blend inside attention (research):** two text copies (without / with the dial); video and audio tokens
      at time t mix their attention to them by M(t). Nearly free and per token at every step; needs a per-query
      attention bias or a second attention call per block.
- [ ] **Reacting to H3's own generated audio:** two passes with the same seed first; reading the forming audio during
      sampling is research (nice to have).
- [ ] **Animated spatial masks:** the same blend with keyframed / tracked masks; temporal consistency at mask edges is
      the main risk.
- [ ] Fallback only: **Dial Time Window** by V2V (H3 V2V Init's time mask regenerates frames t0..t1) for editing a clip
      that already exists.

## Workstream 2b: dials that leave audio alone (exploration)
Some dials break speech or Foley (expressive face +4.8 dB; evil dials change voices). Score each option on dials known
to hurt audio: loudness change, Whisper word error rate against the undialled clip, spectral distance, and the video
effect size. Single-seed results say so.
- [x] **E1:** route 1 with the audio curve at 0 (audio predictions from the undialled branch). 2 seeds: face +1 voice gain
      +2.6 -> +0.8 dB mean, voice energy +1 +5.0 -> +2.2 dB; video 0.7-0.8 of the dial's; k = 2 as good as k = 6; partial
      (audio still reads dialled video). Row option "audio: protect" shipped.
- [ ] **E2:** route 2 with audio tokens reading the undialled text copy.
- [ ] **E3:** per-block strengths: leave the dial out of the blocks where audio queries attend most to text.
- [ ] **E4:** compare with the A/V split in ComfyUI-Dials' `experimental/split-and-dial-to-lora`; the winner becomes a
      per-row "audio: follow / protect" toggle (replaces the "video only" item in workstream 3).

## Workstream 3: dial library
- [ ] Pack 2 release (see blockers). Rejected so far: handheld v1, shaky v2, storm v1, time feel v1/v2, zero gravity,
      the squirrel side.
- [ ] **Picture dials, proper test:** the lizard photo dial is 0.6x the text dial's size and 0.49 aligned; at −4 it gave
      a lizard-pawed hybrid. Framing (study `codex/framing/FRAMING.md`, 1 seed): content framing and all-averaged reach a
      lizard at −4, the default doesn't; decide the default, confirm on a second seed and scene; then more varied
      pictures, picture + text together.
- [ ] **Video dials:** two generated pairs gave no timelapse; the timelapse prompt itself works on Pika, so try a text
      timelapse v3 with that wording and real matched footage (6+ pairs).
- [ ] **Prompt sets:** night-rain set (agreement 0.97) gives evening/night but not visible rain at +1; weight rain up or
      split it into its own row.
- A/V per row ("video only" toggle) moved to workstream 2b.

## Workstream 5: other models
- [ ] **MOSS-Image and Krea 2 (in progress, branch `claude/models`):** the same nodes detect the model and pick its text
      seam (MOSS `text_embedder`, Krea 2 `txtmlp`); dial files record their model family and refuse another model with a
      clear message. Text dials, rack, Combine and envelopes first; picture dials stay H3-only.
- [ ] Per-family probe banks for the wheel; Krea 2 picture dials if its vision encoder allows.

## Workstream 4: dials for LLMs / VLMs (study `2026-10-31-llm-dials`, Gemma 4 31B)
- Style dials (formal, terse, mood, poetic captions) work at the middle layer (29 of 60); late layers collapse.
- Deslop: cliché ↔ specific pairs read as the model's own reply work at layer 29 +2; vocabulary steers; the
  "here are three options" menu format and sentence-shape habits don't move (decided in the first reply tokens).
- Next: pool only the first reply tokens for format habits; 24+ varied cliché/specific pairs; blind preference reads;
  per-head analysis at the best layer; the picture-pair dial applied while the VLM captions an image.

## Later / research
- **Dial Doctor (back burner, Dylan 2026-11-01):** help people make better dials. Tiers: (0) a pair linter in Make Dial
  from the LESSONS rules (actions on one side, objects on one side, time words in non-time dials, every A side sharing
  one "pleasant sunny" pole, length mismatch, subjects that clash with the pairs); (1) a Dial Check workflow: Make Dial
  -> sweep contact sheet -> core Generate Text with a VLM and a knowledge pack (`DIAL_DOCTOR.md`: how dials work, the
  failure catalogue with render signatures and fixes, per-model strength ranges) -> verdict, leaks, useful/overcook,
  v2 pairs, one refinement round unrolled in the graph; (2) an agentic loop (driver script + Claude Code skill).
  Small VLMs (Qwen3.5-9B and Qwen3-VL-4B on disk both have vision weights) should answer only narrow per-image
  questions while code does the diagnosis; gate the design on a critic benchmark over our labelled sheets (framing,
  MOSS v1, Krea grade, blocks), ~50 questions, Qwen3-VL-4B vs Qwen3.5-9B vs Gemma 4 31B.
- **Voice-contrast dials:** audio never enters H3's text encoder; needs the DiT's audio-token seam.
- **Research bridge (blueprint P4+):** prompt-space dial -> video-token direction via Concept Lab; then clip-time
  curves, painted regions and the motion-oracle sidechain with De-Rope.
- **Ideas from DiffSynth-Studio** as lab tools once the rack UX settles.
