# J2 design: word dials without a Jacobian (our own reimplementation, 2026-11-06)

Dylan 2026-11-06: reimplement our own way; our own words and combos, not the collaborator's.

## Recipe (logit-lens word direction → H3 dial)
1. Word direction at H3's encoder output (layer 50): v_w = g ⊙ u_w, with u_w the upstream output-head row for the word's
   first token (also try: mean over all its tokens and over a few spellings/case), g the upstream final RMSNorm weight.
   (logit = u_w · (g ⊙ h / rms(h)), so g ⊙ u_w is the h-space direction that raises the word.)
   Word list → mean of unit v_w.
2. Scale: α so that α|v| equals the median per-token norm of the pair-dial encoder difference for a comparable concept
   (excluding token 0, the 15k sink).
3. Through H3: dial = mean over tokens and over ~8 base prompts of [refiner(proj(h + α v)) − refiner(proj(h))], where the
   push is added to every token except token 0. This keeps the nonlinearity of condition_proj + refiner in the dial,
   matching how Make Dial pools post-refiner rows. Then the usual 3-direction debias.
4. Checks before rendering: cosine with a pair dial for the same idea; norm vs that dial; top-words readout of the result
   (sanity: the dial should read back as its own words).
5. Render: 1 seed, train scene, matched push vs the pair dial and a size-matched placebo.

J3 swaps step 1 for J-lens vectors J_50ᵀ(g ⊙ u_w) after fitting J_50 on the upstream tail.

## Our word lists (first batch)
Look: bioluminescent (bioluminescent, glowing, phosphorescent, jellyfish) · rust (rust, corrosion, decay, patina) ·
stained glass (stained, glass, cathedral, mosaic) · honey (honey, amber, syrup, golden)
Medium / weird: origami (origami, folded, paper, crease) · static (static, signal, broadcast, interference)
Audio words (new: does a word dial move the soundtrack?): hush (whisper, hush, silence, quiet) vs thunder (thunder, roar, crash, boom)
Motion: vertigo (vertigo, dizzy, spinning, tilt) vs stillness (still, frozen, motionless, calm)

## Combos to try once singles work (1 seed each)
bioluminescent + rust · origami + underwater · honey + static · stained glass + thunder (picture + sound) ·
hush on a dialogue scene (does speech get quieter?) · a word dial + a pair dial (sinister + bioluminescent).
