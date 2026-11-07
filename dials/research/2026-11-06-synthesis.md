# Synthesis: what our other H3 research says about Dials (2026-11-06)

We have months of H3 notes outside Dials: motion and timing studies, reference and first-frame conditioning, AdaLN,
adapters, activation taps, sliders, a concept-injection lab. This page reads them for anything that changes how a dial
should be made, applied, measured, or read with a lens (the [J track](2026-11-06-jlens-ideas.md)). Each item says whether
it was **measured** (in our notes, on H3), **source-confirmed** (read in model code), or **proposed**. Numbers are from
the original notes, mostly one seed and one scene; they are leads, not results.

## 1. How H3 actually sees a dial

- **H3 has no cross-attention** (source-confirmed). The DiT runs one joint self-attention over a packed sequence: text
  context rows, condition/reference rows, audio rows, video rows. A dial changes the text rows at the input; from there
  the text rows are themselves updated at every block, and everything reads them through ordinary attention.
- **Text never enters AdaLN** (measured from the weights). The modulation tables take only the timestep, per modality
  (text, audio, video). Qwen vision rows inside the text span get the *video* modulation, and any visual condition adds
  a timestep row that re-indexes the modulation. A dial acts only through attention to the text rows.
- **Which blocks matter** (measured). The same-size perturbation of one block's attention output moves the result 2.9-6×
  depending on the block: blocks 0-19 are most sensitive, 44-49 least, stable across noise levels. This matches the
  ROADMAP's finding that a dial does its work in blocks 0-24.
- **The two H3 families' AdaLN tensors point in opposite directions** (measured: cosine −0.74 to −0.83 per block). T6
  found the *refiner* output the same across families (cosine ~0.99), so a dial file is the same; whether it *acts* the
  same on both families is untested. T6's "no family check needed" is now a hypothesis.
- **Some turbo LoRAs patch the token refiner** (measured from the files). Dials are defined after the refiner, so a dial
  made without such a LoRA may differ from the one that applies with it. Untested.

## 2. Why a first frame pins the look (and what T5-T5f did not try)

- **A first frame enters twice** (source-confirmed): as Qwen vision rows in the text span, and as VAE latent condition
  rows in the DiT sequence. H3 Cond Strength (T5c-T5f) loosens only the latent path, by mixing noise into those rows and
  raising their timestep. **The Qwen-side copy was never loosened.** A reference picture (Ref2V) is spliced into the
  Qwen sequence too, so it rewrites every text token's encoding.
- **The first frame works as an appearance look-up, not a clock** (measured): shifting the guide one latent step off its
  time cost ≤ 4.5% in a one-step error, and deleting 63% of guide rows cost 0.7-3.5%. Small, robust, hard to override by
  pushing harder; consistent with T5b.
- **Timing of the pin** (proposed): early denoising steps set layout and motion, late steps set appearance; a reference's
  look is reported to return late in sampling. Dials act early. Both point at scheduling the pin.
- **Prompt-level reference strength** (proposed): H3's prompt guide has reference roles such as a weak reference and an
  attribute transfer; T5d used "The scene of <Picture 1>." only.
- **Fractional masks** (source-confirmed): H3's own path accepts fractional per-token masks, but a generic ComfyUI step
  rounds them to 0/1, so a latent soft pin (T5e b) silently becomes a hard one unless it bypasses that step. Init-latent
  loosening was measured elsewhere: 0.40 keeps the frame nearly verbatim, 0.60 re-authors it.

## 3. Tools we already have

- **Block taps** (measured: bit-exact no-op): per block × step × segment captures of the packed state.
- **Per-step x0 taps** with video and audio, a trajectory bank that saves every step and can branch from any step, and
  rel-dB scorers for the tapped x0. Trap: tapped audio x0 runs 4× hot and must be divided by 4 before decoding.
- **An attention measuring node** that adds a per-key log-weight bias per block (measured effect +0.4 to +1.9 dB). The
  fused attention kernels do not return weights, so attention mass is computed by hand on sampled queries.
- **A concept-injection lab** for adding deltas to the DiT's own state per segment and block (measured: a full-state delta
  at block 20 moved an arm on the beat; a uniform delta only biased the scene; the dose acts like a threshold).

So J6 (attention), J7 (impulse pictures) and the R-ideas need little new code.

## 4. Lessons that apply to how we measure

- **Noise floors** (measured): renders with the same seed in one process can land on different trajectories, and the two
  cards produce different pictures. Distance is a diagnostic, never a verdict: keep a size-matched placebo, and add a
  repeat control when a distance decides something.
- **Soft debias** (measured in the lab): a hard projection of the top 32 nuisance directions covered only 45% of the
  nuisance energy; a soft wall (shrink each direction by λ/(λ+ε)) worked better. Our 3-direction debias has never been
  checked for coverage.
- **Response space beats weight space** (measured in the lab: two deltas with cosine 0.07 had response cosine 1.0). The
  T4 interaction predictor might work on x0 impulses where it failed on the vectors.
- **A real-contrast gate** (measured): a pair works only if its difference is larger than the difference between two
  neutral prompts; agreement between pairs did not separate good dials from rejected ones.
- **The soundtrack is a free metric** (proposed): audio onset density as a second motion readout, loudness for leaks.

## 5. Audio

- Audio never reaches Qwen (an `<Audio n>` tag is only a label); audio references are DiT rows. A dial cannot shift them.
- Audio is about 1% of the sequence and very sensitive to small changes (measured). Changing only the video moved the
  audio x0 by up to 11.6 dB. This fits the loudness leaks of look dials.
- Routes to audio dials: the dial's own per-modality time curve (`protect` already sets the audio weight to 0; the reverse
  is a small change), deltas on the audio segment of the DiT state, an audio-only repaint pass, and pairs that differ only
  in the prompt's soundscape field. Wordless sounds respond to direction more than speech does (our listening notes).

## 6. Contradictions found and fixed

| our earlier claim | what the other notes say | now |
|---|---|---|
| J6/R7: "cross-attention mass" | H3 is single-stream | fixed in the plan and ideas page |
| T6: no family check needed | AdaLN tensors are opposite across families | T6b added |
| T5c-T5f: looser conditioning fails | only the latent path was loosened | T5h, T5i added |
| X1: needs an audio/video split | the time curve already splits per modality | X1 unparked |
| R1: read dials back through the refiner | pre-refiner builds of eight evil dials were 98% one shared vector | read the *difference* from the shared component |

## 7. What it adds to the plan

New and revised nodes are in [PLAN.md](PLAN.md): T5g (scheduled pin), T5h (first frame hidden from Qwen), T5i (weak
reference role), T6b (family and refiner-LoRA check), J6 rebuilt on the block tap, J9 (how a dial propagates through the
blocks), J10 (block ranges), A1 (soundscape-field audio dials vs word dials), M-soft (soft debias), G1 (real-contrast gate).
All exploratory renders: one seed, few arms.

Sources: our internal research notes (H3 conditioning, motion timing, AdaLN, adapters, concept lab, block sensitivity),
the ComfyUI MiniMax model code, and H3's prompt-writing guide. Surveyed with three read-only agents and checked by hand
where the claim decides a node.
