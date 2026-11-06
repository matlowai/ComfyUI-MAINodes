# J1-J3: dials from a list of words, with no prompt pairs (2026-11-06)

**Question.** Can a dial be made from a few words instead of ~10 prompt pairs, using the Jacobian lens
([ideas page](../2026-11-06-jlens-ideas.md))? Our own reimplementation and our own words.

## J1: is H3's text encoder the upstream model? (measured)

H3's encoder file holds Qwen3-VL-32B layers 0-49 with no final norm and no output head. We downloaded the upstream
Qwen3-VL-32B-Instruct tail (layers 48-63, final norm, output head; ~17 GB) and compared the 13 tensors both files hold
(all of layer 49 and part of 48): **13/13 bit-identical**. So H3's encoder output is upstream's layer-50 residual, and
the upstream tail can decode it. (Residual risk: earlier layers were not compared.)

## Two ways to turn words into a direction

- **J2, logit lens:** the word's output-head row times the final-norm weights (the direction in layer-50 space that
  raises that word's logit), no Jacobian.
- **J3, Jacobian lens:** per word token, the gradient of its logit, summed over target positions and averaged over source
  positions (first token excluded) and 56 H3-style prompts, back through upstream layers 50-63. This is the paper's
  estimator for one token, without fitting the whole Jacobian.

For both: a list's direction = mean of its unit word directions (each word in three spellings). The dial = mean over 8
base prompts of the change in the post-refiner token mean when that direction is added to every encoder token except the
first (push = 0.5 × the prompt's median token norm), then Make Dial's 3-direction debias, then scaled to the size of
`h3_evil_sinister` so strength 1 is a comparable push. Lists (four words each): underwater, thunder, hush, vertigo, still,
bioluminescent, rust, stained glass, honey, origami, static, and a **bland** placebo list (table, number, between, also).

## Offline: do word dials point where pair dials do?

Reference: two unrelated pair dials in our library have median |cos| 0.11 (90th percentile 0.36).

- **J2 (logit lens):** no. Underwater's best match among 97 library dials is +0.09; the matching pair dial is not in its
  top 5. Subtracting the bland dial does not help (all |cos| ≤ 0.12 with the matching pair dial).
- **J3 raw:** the 12 dials are 0.78-0.85 similar to the bland one: a shared "any word" component dominates.
- **J3 centered** (each minus the mean of all 12): they point at the right concepts.

| word dial (J3 centered) | nearest library dials (cos, rank of 97) |
|---|---|
| thunder | voice energy +0.32, **storm +0.31 (2nd)** |
| underwater | owl→octopus +0.32, **underwater +0.31 (2nd)** |
| vertigo | three motion dials +0.26; shaky camera +0.20 |
| hush | **loudness −0.25** (the right sign: quieter) |
| still | motion −0.11 (right sign); cold +0.17 |
| static | oil-pixel, datamosh; vhs 8th |
| rust | worn world 5th |

## Renders (train-platform scene, seed 42, strength +2, Pika H3 Flex 6-step, controls on the same card)

**J2 (logit lens):** underwater, bioluminescent and the bland list all restage the scene the same generic way (the woman
turns toward the camera, a different train); no water, no glow. **J2 rejected:** what moves is the push, not the words.

**J3 centered:**

| dial | picture | pixel distance | loudness vs control (−24.5 LUFS) | energy < 150 Hz |
|---|---|---|---|---|
| bland placebo | restaged platform, nothing new | 45 | −9.3 dB | 6% (control 23%) |
| **underwater** | **the platform becomes a harbourside: open water, moored boats, the train ploughing through water with a bow splash** | 86 | −6.2 dB | 16% |
| **thunder** | windswept hair, low dramatic sun | 74 | **+11.8 dB** | **45%** |
| hush | calm, plain platform | 64 | −15.9 dB | 12% |
| vertigo | another station under a glass roof; motion +1.6 | 39 | +0.2 dB | 18% |

- The **placebo matters**: at +2 any centered word push makes the soundtrack ~9 dB quieter. Against it, **thunder is
  ~21 dB louder with twice the low end** (rumble, peaks at −2.5 dBFS), hush only ~7 dB quieter, underwater no different.
- **Underwater acts on content** (water appears) far beyond the placebo's restaging.
- Vertigo moved the picture less than the placebo did.

**What it shows (one seed: hints).** The plain logit lens gives no usable direction at H3's encoder layer. The
Jacobian-lens version, once the component shared by all words is removed, makes working dials from four words: a
picture dial (underwater) and a sound dial (thunder) on the first try, and a quieting one (hush) at the edge of the
placebo. No prompt pairs were written for any of them.

**What it changes.** J3 passes its gate for underwater and thunder (rank 2 of 97 among library dials, clear render
effects beyond a size-matched placebo). Next: centering against a large neutral vocabulary instead of these 12 lists
(so a new list does not change the others), more words and combos (running), a second seed for underwater and thunder,
and J4 (reading our shipped dials as words) with the same lens.

## J8, first round of our own words and combos (seed 42, +2 singles, +1.5 each in combos, same control)

| dial | what the frames show | loudness vs control |
|---|---|---|
| stained glass | the platform becomes a grand station hall under a vaulted glass roof: the words arrive as architecture ("glass", "cathedral"), not as coloured glass | −14.4 dB |
| origami | the scene moves to a Japanese station (signage, people): the dial carries the culture the word evokes, not folded paper | −10.4 dB |
| static | a colder, overcast blue hour; no TV static | −6.1 dB |
| bioluminescent | restaging only, no glow | −0.9 dB |
| underwater + thunder | no water; a windswept woman, steam blowing off the train, a stormy mood | **+6.2 dB** |
| bioluminescent + rust | restaging only | +0.8 dB |
| stained glass + hush | the glass hall again | −14.5 dB (same as stained glass alone) |

Placebo for comparison: restaging, −9.3 dB. So: **thunder survives a combo** (louder against a placebo that quiets),
**underwater does not at 1.5**; words with a strong *place* association (stained glass, origami, underwater) change the
setting rather than the surface; words for a *look* (bioluminescent, rust, static) mostly do not come through. One seed.
