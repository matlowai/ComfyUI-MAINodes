---
name: snap-voice
description: >
  Cast and keep a character's voice in Snap: a casting description, a talking take as the anchor, a clean 3-6 s
  voice reference made at 12 or more steps, saved on the Cast and cited as <Audio n> in every cut where the character
  speaks, then measured. Use it whenever a character speaks, a short has dialogue, voices sound alike or change
  between cuts, or you make voice settei.
scope: [tool:add_audio_ref, tool:save_cast]
rules: [SNAP-R73, SNAP-R74, SNAP-R88]
---

If a Snap server is reachable, `read_skill {"name": "snap-voice"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# Voice settei

Audio upload, `add_audio_ref`, `save_cast` voice and citing `<Audio n>`: `docs/AGENT_START.md` ("Voices and audio
references"; SNAP-R73, R74).

## Why a reference

Text alone doesn't cast a voice. H3 ignores pitch, age and sex words: "a boy whose voice has not broken, voiced by an
actress" came out at 97-138 Hz, "clearly a woman's voice" at 112-145 Hz, and the two read as one speaker (WavLM
0.78-0.94). The same words do stay stable for one character (0.94-0.99), so the reference is what carries timbre.

## Steps

1. **Casting description:** a voice actor's brief (register, pitch, timbre, energy, cadence, archetype) under the
   production's house delivery.
2. **Casting rounds:** talking takes with the character's picture (Ref2V), at low resolution. At 256x160 a round costs
   about 3 s at the turbo's 6 steps, so spend them.
3. **The reference:** render the keeper at **12 steps or more** at low resolution (SNAP-R88). Until Snap has a voice
   route, set the steps on the setup by hand. Cut a clean 3-6 s line that ends on silence.
4. **Save it on the Cast** (`save_cast` `voice {file, casting}`); `apply_cast` puts it in References and answers its
   `<Audio n>`. Cite it in every cut where the character speaks ("her voice is the voice of <Audio 1>: the same
   speaker and timbre, not repeating its words").
5. **Measure** before calling a voice cast, and again across cuts: Whisper text against the line, F0 median and range
   (pyin), and speaker similarity against the reference. Watch pairs of characters that score close (0.86 between two
   characters was a confusion risk).

H3 reads audio references only with a reference setup (Ref2V).
