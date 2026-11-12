# jlens ideas (my list, written before reading Fable's)

## Making dials
1. Keyword dial (the collaborator's): words → unembedding rows → back through J_lᵀ (or pseudo-inverse) → hook vector. Compare with pair dials at matched push.
2. Keyword-minus-keyword: "blizzard" − "summer heat" in lens space; a two-pole dial without prompt pairs.
3. Lens-cleaned pair dial: take today's pair dial, read it with the lens, zero the vocabulary components that are nuisance (e.g. "the", scene nouns from the base prompt), map back. A hold made of words.
4. Dial from a single odd word list for weird concepts that resist paired prompts (synesthesia, "vertigo", "nostalgia", onomatopoeia "crunch").
5. Non-English / emoji / token-fragment dials: lens directions for tokens that never appear in prompts (🔥, kanji, code tokens). Weird-results hunt.
6. Negative-lens dial: push *away* from a word set to remove a default (e.g. away from "golden hour" since H3 loves dusk).
7. Prompt-conditional keyword dial: Jacobian at THIS prompt instead of corpus average, so the push is tailored to the scene.

## Reading
8. Read our 154 dials: top words per dial; catch dials whose words show leaks (sinister → "cold, blue"?). Check against wheel metrics.
9. Read interaction pairs: lens(a+b) vs lens(a)+lens(b); does emergence show up as new words (vhs+film_artifact → "film, reel")?
10. Read the post-refiner context rows per token position: what the refiner adds (lens before vs after refiner), and the 15k-norm first token.
11. Read vision rows (image-to-video first-frame rows) through the text lens: what does the model "say" the picture is? Explains the pin.
12. Layer sweep: at which encoder layer does a concept become verbalizable; pick the hook layer from that.

## Activations (beyond dials)
13. DiT has no vocabulary: a "visual lens" = Jacobian from a block's residual to the final velocity (or to the VAE-decoded frame), decoded as an image/flow. Expensive; a tiny version on 1 block, few frames.
14. Cross-attention readout: which context rows a DiT block attends to, weighted by lens words. Cheap (no backward).
15. Audio lens: Jacobian to the audio-VAE latent; words that drive loudness (ties to the face-dial loudness leak).

## Practical
- Need bf16 encoder for backward (~64 GB) or reuse a fitted lens. Fitting 100 prompts × 128 tokens on 32B.
- Ask the collaborator: layer, word→vector recipe, hook site, strength scale, whether the Jacobian is corpus-average or per-prompt, fit corpus.

## Blocking fact (checked 2026-11-06 from the safetensors header)
H3's text encoder (qwen3vl_32b_minimax_h3_bf16) = Qwen3-VL-32B truncated to 50 layers (0-49), no final norm, no lm_head;
metadata: output = "unnormalized_hidden_after_layer_50". Only embed_tokens [151936, 5120] is present. A standard jlens
(J to final layer, unembed) needs the full upstream Qwen3-VL-32B (64 layers + lm_head). Options:
 a. download upstream Qwen3-VL-32B (~66 GB bf16), confirm layers 0-49 are byte-identical to H3's (hash per tensor), fit the lens there;
 b. decode with embed_tokens as a stand-in unembedding (crude);
 c. a non-verbal "H3 lens": J from layer l to H3's actual output (layer 50 / post-refiner), read by nearest prompts rather than words.
Ask the collaborator which one he used.
