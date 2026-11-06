---
name: snap-reference-upscale
description: >
  Make a take or still bigger in Snap so it works as a reference: a stage 2 redraw (`upscale_take` `stage2`, light
  denoise with the take's own recipe), then Tessera for 4K. Use it whenever a Cast picture, turnaround, plate, settei
  or board is too small or its face looks smeared, before a picture becomes a reference, or when the person asks for
  2K or 4K.
scope: [tool:upscale_take]
rules: [SNAP-R16, SNAP-R81, SNAP-R82, SNAP-R85]
---

If a Snap server is reachable, `read_skill {"name": "snap-reference-upscale"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# A reference redraw upscale

Calls and every option: `docs/AGENT_START.md` ("Making a take bigger"; SNAP-R81, R82).

## Why redraw

H3 renders at about 0.85 MP and its VAE smears small faces. A sharpen-only upscaler (RelayVSR) keeps the smeared face;
a reference has to be redrawn (SNAP-R85). `stage2` runs the take's own recipe again from its frames, upscaled and
VAE-encoded, from `denoise`:

| version | ArcFace vs the Cast front (three near-front frames) |
|---|---|
| the 832 px take | 0.73 / 0.73 / 0.79 |
| RelayVSR 2x | 0.79 / 0.68 / 0.80 |
| stage 2, d0.25 | 0.88 / 0.67 / 0.88 |
| **stage 2, d0.30** | **0.91 / 0.86 / 0.89** |
| stage 2, d0.35 | 0.88 / 0.83 / 0.87 |
| Tessera 4K after stage 2 | 0.89 / 0.80 / 0.88 |

The front was also the take's Picture 1, so a redraw toward it is expected: read the crops beside the numbers.

## Steps

1. `upscale_take {"take": ..., "method": "stage2", "factor": 2, "denoise": 0.3}`. A 2K pass at cfg 5 fills a 32 GB card
   and takes ~2.5 min a step (15-19 min for a 5 s orbit); the plan says how long (SNAP-R16).
2. Look at the result at 100 % (`take_frames`): whole frames first, then the face against the Cast picture, the carried
   props and hair against the original, the backdrop for anything new.
3. For 4K, `tessera` after stage 2: it anchors on stage 2's newest frame 0 and carries the redrawn face up. Point
   `TESSERA_SCRATCH` at a big disk (~10 GB at 4K x 124 frames).
4. Use the frames you keep as Cast pictures or plates (a new Cast version).

## Traps

- **Judge the whole frame before the face.** A 4K face crop looked great while near-empty backdrop tiles had grown
  ghost copies of the character; `flat_skip` 8 (not Tessera's own 4) stopped it. Check every tile of a tiled upscale.
- On a fast orbit Tessera releases no guide (its motion adaptation sets release to 0); that's expected.
- RelayVSR inside a new render is still right for a final that only needs sharpening.
