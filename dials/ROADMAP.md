# Dials roadmap

Order follows the 4D Control Field blueprint (`MATLOWAI_Dials_4D_Control_Field_Research_and_Implementation_Blueprint.md`,
2026-10-30): ship the simple rack, then denoising envelopes, and earn spatial and clip-time control with H3 renders.
Evidence for the 2026-10-31 items is in the study `studies/2026-10-28-h3-motion/codex/` (B*, C*, D*, A* reports) and
`studies/2026-10-31-llm-dials/E3_E6_NOTES.md`.

## Now: first MAINodes release (everything on `dials-rack`, as alpha)
- [x] **Multi-dial loader = Dial Rack.** Asked for in the community on 2026-10-31 ("gonna need a multi dial loader
      soon, i'm getting spaghetti mode chaining dial apply"). Rows with on/off, strength, solo; wired dials become rows.
- [x] Same-seed H3 render parity (B1): one row, four rows and all-off match the single-dial chain pixel for pixel.
- [x] Example workflows: one dial, four dials, Pika + rack (B3, rendered).
- [x] Rack presets: versioned JSON with dial names, SHA-256 hashes, strengths, on/solo; missing-file and hash warnings.
- [x] Make Dial hold pairs (`!`), named hold groups (`![loudness]`), word weights (`(words:w)`); hold rows in the rack.
- [x] Step envelopes (constant, early, late, bell, manual) compiled onto the sampler's sigmas; a constant envelope
      reproduces the plain hook exactly (D2, D3).
- [x] Make Dial from pictures and from video pairs (C1, C4): alpha, limits documented below.
- [ ] Review pass on the Codex-written parts (presets, hold rows, envelopes, video dial, rack JS) for pack style.
- [ ] Row order: reversing four rows changed a render (MAD 38/255, B1) although post rows add commutatively; isolate
      pre vs post rows and dtype rounding (B6), and decide whether to sum post rows once in float32.
- [ ] Dylan's hands-on pass on the rack UI in the real front end (only driven headless so far).
- [ ] Dial pack 2 notes (draft in the study's `codex/A5_pack2_notes.md`); ship the dials that passed 3 seeds.

## Next
- **Dials from more than two prompts, with weights (Dylan).** Today a dial is the mean of A->B differences; word weights
  tilt a phrase, holds remove a quality, Combine Dials mixes two. Next: a per-pair weight (`A ||| B :: 2`) and a
  "prompt set" mode: several prompts, each with a signed weight (`+1 rain at night`, `+0.5 neon`, `-1 bright daylight`),
  whose weighted mean, relative to a neutral prompt, is the dial. Test against the same mixture built as separate dials
  in the rack (should match when the weights are the same).
- **Picture-contrast dials, proper test.** C3: the lizard picture dial is 0.59x the size of the text dial and only 0.49
  aligned with it, and was tested at the same slider numbers, so it was under-driven. Re-test at matched norm
  (-4 to -6), add more varied pictures per side, and try picture + text pairs together.
- **Video-contrast dials.** C4 built the video-pair route from 2 generated pairs; no timelapse at +2, and the pairs
  differ in framing and light (confounds). The timelapse prompt control does work on Pika, so: (1) a text timelapse v3
  using that control's wording (shadows sweep, clouds race, people blur, light changes), (2) video pairs from real
  matched footage (same camera, time-compressed vs real-time), 6+ pairs.
- **Envelopes, what they are for.** On Pika 6-step, prompt-side dials act only in the first steps: late at +2 and +8 =
  base (eval29). An early kick (+6) is a reproducible creative scrambler (day/night: cloaked figure in a dark tunnel).
  Next: the same test on base H3 20-step, where a late "style pass" might exist.
- **Dial on a time window (Dylan).** A dial can't vary over clip time at the prompt (every frame reads the same prompt;
  envelopes are over denoising steps). What works with existing nodes: render the clip, then a V2V pass with the dial on
  and H3 V2V Init's time-varying mask regenerating only frames t0..t1 (the rest frozen to the clip, audio from pass 1).
  On/off per latent token (about 3-4 frames), edges can pop unless aligned to the 17-frame grid. Needs a small
  "Dial Time Window" node (seconds -> token-aligned MASK) and a Pika workflow (pass 1 -> windowed dial pass -> de-rope).
- **Dial strength over clip time (Dylan), research.** Per-frame strength needs a different seam: (1) attention: let
  video tokens at frame t attend to "prompt + w(t) x dial" (compute the text part at a few strength levels and merge;
  text is short, so it's cheap), which reuses today's dial vectors; or (2) video-token injection per frame (Concept Lab
  route), which needs video-space dial directions and proof they mean the same thing.
- **A/V per row:** a "video only" toggle on a rack row (ComfyUI-Dials `experimental/split-and-dial-to-lora`: sinister
  picture, intelligible speech).
- **Semantic XY pad:** two signed dials on a plane, then four-corner presets. Endpoints must equal the single dials.

## Later
- **Nudge a prompt and drag it (Dylan).** Show the user's own prompt as a point among the dial directions (2D view of
  the rack's dials, PCA or the two chosen axes), let them drag the point carefully, and render what that position
  means, with live readouts: how much of each dial, size of the shift, distance from tested territory, and a
  render-sweep button. Extends the vector-space explorer idea and the XY pad.
- **Dials for LLMs / VLMs (Dylan), started 2026-10-31 on Gemma 4 31B.** Harness in `studies/2026-10-31-llm-dials`.
  Style dials work at the middle layer; deslop findings: cliche <-> specific pairs read as the model's own reply work
  at layer 29 +2; vocabulary steers; the "here are three options" menu format and sentence-shape habits (not just X,
  em-dash codas, triplets) don't move. Next: pool only the first reply tokens for format habits, 24+ varied
  cliche/specific pairs, blind preference reads, and the picture-pair dial applied while a VLM captions an image.
- **Where to steer (Dylan).** The seam matters: as the model's own writing the slop contrast is cleaner than as the
  user's message; agreement peaks around layers 10-20; format decisions live in the first tokens. Next: per-head
  analysis at the best layer, then steer only those heads.
- **Voice-contrast dials.** Audio never enters H3's text encoder, so voice pairs need the DiT's audio-token seam
  (Concept Lab style capture/inject).
- **Research bridge (blueprint P4+):** prompt-space dial to video-token direction via Concept Lab; only then clip-time
  curves, painted regions and the motion-oracle sidechain with De-Rope.
- **Ideas from DiffSynth-Studio** worth adapting as lab workbench tools once the rack UX is settled.
