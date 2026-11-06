# The Jacobian lens and Dials: ideas, constraints, plan (2026-11-06)

**Status: proposed.** Nothing on this page has been run yet. It collects ways to use the Jacobian lens ("jlens") to
*make* dials, to *read* dials and model activations, and variations on the lens itself. The PLAN's **J track** picks
the first experiments from it.

## Why now

We are working on this together with [fredbliss](https://github.com/fblissjr). He reported keyword dials that work on the same H3 prompt and scene: instead of ~10 prompt pairs, a short word
list (a medieval list, a blizzard list) turned into a direction with a Jacobian lens and
added by a hook at render time. If that holds up, making a dial drops from writing careful pairs to listing a few words.
He had earlier reported running the lens on an H3 prompt bank (it found the 15k-norm first token that T1 checked).

## What the lens is (source-confirmed)

[jacobian-lens](https://github.com/anthropics/jacobian-lens), companion code for
[Verbalizable Representations Form a Global Workspace in Language Models](https://transformer-circuits.pub/2026/workspace/index.html).
It fits J_l = E[∂h_final / ∂h_l], averaged over a text corpus (the paper uses 1000 sequences of 128 tokens; ~100 is
usable), and reads a layer-l vector h as words via unembed(J_l h). The rows of W_U J_l are the **J-lens vectors**: one
direction in layer-l space per vocabulary token. The paper reads activations by projecting onto them or by a sparse
non-negative decomposition (k ≤ 25), and notes that readouts are noisy in roughly the first third of the layers. The
repository fits and applies the lens; it has no steering or keyword-to-vector code.

## The constraint that shapes everything (measured from the weights)

H3's text encoder is **Qwen3-VL-32B cut after layer 50 of 64**: the file holds layers 0-49 and the token embedding table,
with **no final norm and no output head**. Its metadata says the output is the unnormalized hidden state after layer 50.
Upstream Qwen3-VL-32B-Instruct has 64 layers and an untied output head (`tie_word_embeddings: false`).

So a standard lens cannot be fitted or read on H3's copy alone. The ways around it, best first:

- **A. Borrow the upstream tail.** If H3's layers 0-49 are identical to upstream's (to check by hashing tensors), H3's
  output *is* upstream's layer-50 residual. Fit J_50 = E[∂h_64 / ∂h_50]: run layers 0-49 without gradients (even our
  quantized copy works), then layers 50-63 + final norm + output head in bf16 with gradients. Only 14 layers need a
  backward pass: easy on one GPU. Download: the tail shards (11-14 of 14, ~17 GB: layers 48-63, so layers 48-49 also allow the hash check), not the whole model. Keyword
  directions J_50ᵀu_w then live exactly where H3's condition_proj reads.
- **B. Stand-in decoders, no Jacobian.** (i) Upstream final norm + output head applied directly to layer 50 (a logit
  lens; layer 50 is ~78% deep, where the paper finds logit and J-lens readouts converge). (ii) The embedding table H3
  keeps, as a rough "embedding lens". Both need per-token RMS normalisation (or the first token dropped), because the
  unnormalized output carries the 15k-norm first token.
- **C. Lenses into H3's own outputs**, which never needed words: the refiner's Jacobian (5120 → 5376, exact and small),
  and the DiT's response in latent, pixel or audio space.

## Making dials

| id | idea | why | cost | cheapest first test |
|---|---|---|---|---|
| M1 | **Keyword dial (paper recipe):** v = Σ_w J_50ᵀu_w, through condition_proj + refiner | no pairs; one word list, one dial | fit J_50 (route A) | cosine vs the pair dial for the same concept, then 2 renders at matched push + placebo |
| M2 | **Logit-lens keyword dial:** output-head rows for the words, mapped into layer-50 space, through the refiner | no Jacobian at all; may be the whole trick at layer 50 | route B, offline | same as M1; if it matches, skip fitting J |
| M3 | **Two-pole word dial:** J-lens(blizzard words) − J-lens(heat words) | a contrast without writing pairs | as M1 | cosine with the existing probe-bank axes |
| M4 | **Lens-cleaned pair dial:** read today's dial, remove the components that read as nuisance words (the base prompt's nouns), map back | a hold made of words instead of 3 blind SVD directions | as M1 + 2 renders | does it keep the effect with less layout drift? |
| M5 | **Emergence into one dial:** read an emergent combo (vhs + film_artifact = film stock), harvest its new top words, make a word dial | turns an accident into a recipe | offline + 2 renders | does the word dial reproduce the combo alone? |
| M6 | **Away-from dial:** push away from a word set (e.g. away from "sunset, golden" since H3 defaults to dusk) | remove a default rather than add a concept | as M1 | 2 renders |
| M7 | **Words no prompt would use:** emoji, other scripts, onomatopoeia ("crunch"), abstract words ("vertigo", "nostalgia") | weird-results hunt; concepts that resist pairs | as M1 | 1 render each |
| M8 | **Many-language average:** the same word in several languages, averaged | spelling-specific nuisance averages out | as M1 | cosine between per-language dials |
| M9 | **Prompt-conditional keyword dial:** J fitted around this scene's prompt instead of the corpus average | sharper, scene-specific (the paper warns single-prompt Jacobians mix disposition with context) | per scene | corpus vs prompt J, 2 renders |
| M10 | **Dial from a target metric** (speculative): gradient of a pixel/latent statistic (darker, grainier) with respect to the context rows, averaged over steps and scenes | a dial defined by the effect you want, not words | DiT backward, low resolution only | cosine with sinister vs placebo |

## Reading dials and activations

| id | idea | why | cost |
|---|---|---|---|
| R1 | **Verbalize the shipped dials:** map each dial back to layer-50 space (refiner pseudo-inverse or a fitted linear map), read top words | a leak checklist: does sinister also say "cold, night"? Compare with the measured wheel leaks | offline |
| R2 | **Read combos:** words of a + b vs a and b alone; look for new top words | first candidate predictor of emergence (cosine did not predict it in T4) | offline, T4's 6 pairs |
| R3 | **Read the refiner:** words per token before vs after the refiner | does the refiner mix concepts in a way word dials must anticipate? | offline |
| R4 | **Read the sink token:** what the 15k-norm first token says, and whether its J rows are degenerate | settles fredbliss's sink exclusion in lens terms | offline |
| R5 | **Slice view of an H3 prompt:** which rows carry the concept, which the scene; shift only concept rows | a row-masked dial chosen by readout | offline + 2 renders |
| R6 | **What the first frame says:** read the vision rows (image-to-video) through the text lens | choose dials the picture does not contradict; explains the pin | offline |
| R7 | **The first-frame pin as attention:** per block and step, how much attention the video rows pay to three groups of keys (text rows, the Qwen vision rows inside the text span, and the DiT's latent first-frame rows), with and without a first frame. H3 has no cross-attention: it is one joint self-attention over the packed sequence | if text rows stop being listened to, the fix is attention-side (rescale text-row keys), not a bigger dial: nothing in T5-T5f tried that | forward hooks, 2 renders |
| R8 | **DiT impulse pictures:** one denoising step at low resolution, dial on vs off at small strength; decode the x0 difference | a picture of what a dial does before anyone renders; the DiT's own "lens" | 1 forward per dial |
| R9 | **Audio impulse:** the same into the audio latent | does a dial touch loudness or speech before rendering? | 1 forward per dial |
| R10 | **Timestep readout:** R8 at several steps | is a look dial heard only early (matches the step-envelope finding)? | few forwards |
| R11 | **Words from DiT activations** (speculative): a linear map from the text rows' activations inside the DiT blocks back to context space, then the word lens | the only way to get words out of the DiT; expect early blocks only | activation capture + offline |

## Variations on the lens

- **Corpus:** fit on H3-style video prompts (no chat template) instead of web text: the distribution the encoder sees.
- **Positions:** average only over content tokens (first token excluded) or over the differing span (T1: 53-84% of a dial).
- **Depth:** also fit at layers 35-45 and run H3's own remaining layers forward: the paper's useful band is mid-depth.
- **Attention-frozen J** (a paper robustness variant): isolates what the MLPs dispose toward from in-context rerouting.
- **Whitened J:** whiten with the activation covariance so word dials avoid dominant nuisance directions (ties to T7).
- **Refiner and DiT targets:** the J of the refiner output, of the DiT x0, of the audio latent: lenses in H3's own spaces.

## Questions to compare notes on with fredbliss

1. Full upstream Qwen3-VL-32B (64 layers, output head) or H3's 50-layer copy with a substitute decoder? Did you check that
   layers 0-49 match upstream?
2. Which layer, and where does the vector go in: encoder hidden states (then H3's remaining layers), the layer-50 output,
   after condition_proj, or after the refiner?
3. How do words become a vector: J-lens vectors (J_lᵀu), output-head rows, mean-centred against what? Summed or averaged;
   norm and strength relative to a pair dial?
4. Fit corpus (web text or H3 prompts, how many), and was the first token normalised or dropped?
5. All rows or text rows only? Does it survive a first frame?
6. What does "it works" rest on: scene, seed, a placebo of equal size?
7. Could you share the fitted lens?

## Credits

Brainstorm merged from two independent lists written for this page (one by Claude Opus, one by Claude Fable), checked
against the jlens README, the paper and H3's weight files. Bringing the Jacobian lens to H3 is fredbliss's work; our versions are an independent reimplementation so we can compare notes.
