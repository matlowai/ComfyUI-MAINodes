# M2: word dials on MOSS-Image, read straight off the encoder's output head (2026-11-07)

**Question.** On H3 a plain logit lens gave no usable word direction (J2), because H3 reads its text encoder at layer 50
of 64 and the file has no output head. **MOSS reads the last layer of its Qwen3.5-9B encoder after the final norm, and the
file keeps the output head (`lm_head`)**, so there the logit lens *is* the exact lens: a word's direction is simply its
`lm_head` row. Do word dials made that way work on MOSS?

**Setup.** Same method as J2/J3 (`dials_word_dial.py --te-file`): each word's `lm_head` row (int8 ConvRot rows dequantized
with comfy_kitchen's own routine), averaged over the list, pushed through MOSS's `text_embedder` on 8 base prompts, debiased,
scaled to the size of `moss_day_night_hook`; also a centered version (minus the mean of the 13 lists). Made on MOSS SFT
DeBand. Renders: the lighthouse prompt, **one seed (7)**, 1024², 25 steps, cfg 3.

**Offline check (raw, no centering needed)**, cosine with the existing MOSS pair dials:

| list | best match |
|---|---|
| night, moonlight, dark, stars | day/night pair dial +0.21 (rank 1) |
| storm, rain, thunder, clouds | calm/storm pair dial +0.20 (rank 1) |
| cold, blue, steel, icy | warm/cold grade pair dial +0.30 (rank 1) |
| neon, cyberpunk, hologram, electric | ukiyo-e/cyberpunk +0.14 (the cyberpunk side) |
| lava, molten, magma, volcanic | solid/melting +0.10 (the melting side) |
| table, number, between, also (placebo) | nothing above 0.07 |

Misses: "warm, golden, amber, sunset" did not land on the warm side of the grade dial; "ukiyo, woodblock, edo, print" landed
on calm/chaos.

**Renders.**
- At **+4** (where MOSS pair dials work) nothing shows for night, storm, neon, lava or underwater: small reframings like
  the placebo's.
- **Night at +8:** a moon, a deeper dusk, a glowing wet path. **At +12:** a full moonlit night with a lantern-lit cottage,
  starting to break into framed inset panels.
- **Neon at +8 / +12:** no glow; fences, wire and a pier appear. My guess is that "electric" was read literally.

**What it shows.** On MOSS, word dials come straight off the output head with no Jacobian and no centering, and they point
at the right pair dials (rank 1 for night, storm, cold). They need about twice a pair dial's strength, and each word acts
literally, so the list must not contain words with an unwanted literal reading. One seed: a hint.

## Round 2: purely visual word lists (+8, seed 7)

| list | what the image shows |
|---|---|
| snow, snowy, frost, icicles | **snow on the rail and path**, the keeper trudging in boots |
| rain, raindrops, wet, puddles | **a wet path, and the keeper now holds an umbrella** |
| moon, moonlight, starry, midnight | a bluer dusk, moonlight glinting on the water, a wet reflective boardwalk |
| golden, sunset, amber, glow | warmer light (mild) |
| fog, mist, haze, overcast | flatter, hazier, greyer (mild) |
| neon, glowing, magenta, cyan | no neon; a deeper blue-magenta sea |
| table, number, between, also (placebo) | restaging only |

Visual-only lists work much better: weather words (snow, rain) come through clearly at +8; light words (moonlit,
golden, fog) partly; colour words for a light source (neon) do not. Offline, related lists agree with each other as
expected (moonlit vs night +0.73, golden vs warm +0.82, fog vs foggy +0.73), and the placebo matches only itself.

**Check: a second seed and a held-out scene** (lighthouse seed 8; an old man reading on a park bench, seed 7; +8, each
with its own control): **snow holds on both** (snow on the rocks and path; snow in the park, and he gains a wintry scarf);
**rain holds on the lighthouse** (umbrella, wet path) and is subtler in the park (damper, greener, a pond, no falling rain);
the bland placebo only restages (a sunny sky, a jumper). So snow is a finding (2 seeds, 2 scenes); rain a strong hint.

**Next.** compare with centered J-lens dials on H3 (where centering
was needed).

## Transfer to KroMoss (2026-11-08)

The same DeBand-made word dials on **KroMoss with its 8-step DMD2 LoRA, CFG 1** (euler, simple), seed 7, the lighthouse and
the park-bench scenes, one render per arm. Pair dials act about twice as strong at CFG 1 (M1, LESSONS), so +4 was tried
first as the equivalent of DeBand's +8.

| arm | lighthouse | park bench |
|---|---|---|
| snow +4 | no snow; restaging only | no snow; restaging only |
| rain +4 | a faint rainbow; no rain | restaging only |
| placebo +4 | restaging only | restaging only |
| **snow +8** | **a snow-covered headland under a pink winter sky** (and a small signature appears in the corner) | **snowfall, the man in a fur-hooded parka** (the bench and park are replaced by a snowy street) |
| **rain +8** | **a wet path, a hooded long raincoat, overcast** | a misty, grey-green park, wet path, the man now standing |

- **The "twice as strong at CFG 1" rule does not hold for these word dials**: they need +8 on KroMoss just as on DeBand.
  At +8 KroMoss reacts harder (it restages the whole scene for snow on the park bench), so the working window is narrow.
- Snow and rain transfer from DeBand to KroMoss at +8. One seed per scene: a hint.

**Light words on KroMoss at +8** (the round-2 lists that were only partial on DeBand; seed 7, same setup, one render each):

| list | lighthouse | park bench |
|---|---|---|
| moon, moonlight, starry, midnight | **a deep blue dusk, the lamp lit and glowing**, a purple sky | darker, dusk light (moderate) |
| golden, sunset, amber, glow | **an orange sunset**, warm light everywhere | **warm, backlit golden light**; a different man (long hair) |
| fog, mist, haze, overcast | **grey, overcast, flat and misty** | overcast, desaturated (no visible fog) |

On KroMoss the light words come through more clearly than on DeBand (where golden and fog were mild), most strongly on the
lighthouse. The park-bench man changes identity under golden (as with the M1 dials at ±4 on DeBand). One seed per scene.
