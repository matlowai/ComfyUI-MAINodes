# T1: which tokens carry a dial's direction? (2026-11-06)

**Question.** Make Dial averages every token of each prompt after H3's token refiner. Do a few tokens (an attention
sink, the first token) dominate that average? The trigger: fredbliss's jacobian-lens work on H3 found a first token with
norm ~15k at the text encoder and saw large gains from excluding it in encoder space.

**Setup.** The stored pairs of five shipped dials (sinister, datamosh, oil_pixel, memory_present, motion; 24 pairs each)
were re-encoded exactly as Make Dial does: Qwen3-VL text encoder (nvfp4) → `condition_proj` → 2-block `token_refiner`
(int8 FL2VA weights), float32 token means. Per pair, each token's signed share of the raw pair-mean difference was
computed (shares sum to 1). Offline, no renders. H3 prompts are raw text (no chat template), so the first token is
ordinary prompt text.

**Results.**

| dial | first-token norm / median (encoder) | after refiner | first token's share | top-3 tokens' share per pair | differing span's share | span / prompt tokens (A) |
|---|---|---|---|---|---|---|
| sinister | 15,555 / 304 | 157 / 163 | 0.06 % | 18 % | 53 % | 5.3 / 19.4 |
| datamosh | 15,555 / 306 | 157 / 162 | 0.28 % | 18 % | n/a | 0 / 11.0 |
| oil_pixel | 15,555 / 305 | 157 / 163 | 0.05 % | 11 % | 78 % | 13.3 / 25.7 |
| memory_present | 15,555 / 306 | 157 / 163 | 0.01 % | 18 % | 80 % | 8.3 / 20.7 |
| motion | 15,555 / 318 | 157 / 162 | 0.16 % | 18 % | 84 % | 8.3 / 12.1 |

Pooling variants (raw, before debias; cosine to today's whole-prompt mean, and vector size relative to it):

| dial | first token excluded | differing span only |
|---|---|---|
| sinister | 0.9999, 1.05× | **0.941**, 1.88× |
| datamosh | 0.9935, 1.06× | undefined (A is a prefix of B) |
| oil_pixel | 1.0000, 1.04× | 0.982, 1.54× |
| memory_present | 0.9997, 1.04× | **0.965**, 1.75× |
| motion | 0.9998, 1.08× | 0.996, 1.20× |

**What it shows.**

- The encoder's first token is an outlier (about 51× the median norm; fredbliss measured 15,309). This replicates.
- **After the refiner it is an ordinary token** (norm ~157, like the rest) and carries under 0.3 % of every dial's direction.
  Excluding it changes nothing (cosine ≥ 0.993). Sink exclusion matters for encoder-space vectors and Jacobian estimates,
  not for post-refiner dials.
- The direction is spread out: the top three tokens carry ~18 % per pair.
- The differing span carries 53-84 % of the direction; the shared words carry the rest through the bidirectional refiner
  (each shared word is read differently next to a different trait). Span-only vectors point 0.94-0.996 the same way and are
  1.2-1.9× larger, so any "span pooling is stronger" impression at equal strength is partly size.
- Plain-vs-featured pairs (datamosh: A is B minus a clause) have no A-side span; span pooling is undefined for them.

**What it changes.** Gate passed for "not dominated by a few tokens": sink-excluded pooling is dropped. Span variants go
to T3 only where they differ from today's (cosine < 0.97): sinister and memory_present, rendered at matched push.

Script: `dials_token_audit.py` (re-encodes stored pairs; writes the variant dials). Seeds: none (offline).
