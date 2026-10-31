# Dials roadmap

Order follows the 4D Control Field blueprint (`MATLOWAI_Dials_4D_Control_Field_Research_and_Implementation_Blueprint.md`,
2026-10-30): ship the simple rack, then denoising envelopes, and earn spatial and clip-time control with H3 renders.

## Now
- [x] Dial Rack, Make Dial, Combine Dials ported; rack = chain bit for bit (CPU test).
- [ ] Same-seed H3 render: one rack vs the single-dial chain; all-off vs base.
- [ ] Human pass on the rack UI (old and new front end).
- [ ] Example workflows: one dial, four dials, Pika + rack.
- [ ] Dial pack 2 (17 candidates in the study's `dials/pack2/`: camera, light and mood, face and voice, weather and
      world, plus creature swap, scale, time feel, claymation, zero gravity, dream, crowd, underwater). Ship only what
      passes at +0.5 / +1 on held-out prompts, with notes on side effects.

## Next
- **A/V per row:** a "video only" toggle on a rack row (the A/V split prototype on ComfyUI-Dials'
  `experimental/split-and-dial-to-lora` branch: sinister picture, intelligible speech). Costs a second pass only for
  early steps.
- **Step envelopes:** strength over denoising progress, compiled onto the sampler's actual sigmas (constant, early,
  late, bell, manual). Reuse the per-step model wrapper from the A/V split. Gate: a flat envelope reproduces today's
  hook; base H3 and Pika's 6-step schedule tested separately; the UI shows the values actually sampled.
- **Semantic XY pad:** two signed dials on a plane first, then four-corner presets. Endpoints must equal the single
  dials.

## Later
- **Vector-space explorer (Dylan):** show dials as points in a 2D view of their directions and let people drag a point
  carefully to make a new mixture, with live readouts (how much of each dial, size of the shift, distance from
  tested territory) and a render-sweep button. Builds on the rack's overlap report and the XY pad.
- **Research bridge (blueprint P4+):** prompt-space dial to video-token direction via Concept Lab capture and
  injection; only then clip-time curves, painted regions and the motion-oracle sidechain with De-Rope.
- **Ideas from DiffSynth-Studio** worth adapting as lab workbench tools once the rack UX is settled.
