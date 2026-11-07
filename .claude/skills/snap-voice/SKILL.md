---
name: snap-voice
description: >
  Cast and keep a character's voice in Snap: a casting description, a talking take as the anchor, a clean 3-6 s
  voice reference made at 12 or more steps, saved on the Cast and cited as <Audio n> in every cut where the character
  speaks, then measured. Use it whenever a character speaks, a short has dialogue, voices sound alike or change
  between cuts, or you make voice settei.
scope: [tool:add_audio_ref, tool:save_cast, tool:check_voice]
rules: [SNAP-R73, SNAP-R74, SNAP-R88, SNAP-R114, SNAP-R150, SNAP-R151]
---

If a Snap server is reachable, `read_skill {"name": "snap-voice"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# Voice settei

Audio upload, `add_audio_ref`, `save_cast` voice and citing `<Audio n>`: `docs/snap/AGENT_START.md` ("Voices and audio
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
5. **Measure** before calling a voice cast, and again across cuts. Every take that cites a Cast voice gets the voice
   note by itself once it lands (SNAP-R114; `get_take`'s `voice`, `check_voice` runs it again): WavLM-SV against the
   cited reference and every other Cast's voice, the margin to the closest other, and F0 against the reference.
   `ok` = own at least 0.90, ahead of every other Cast by 0.05, F0 within 3 semitones; `check` says why; `no voice`
   when nothing is voiced. Two similar voices overlap (short03's two young women 0.81-0.95, same speaker 0.89-1.00),
   so `check` means listen, not "wrong person". Casting words add nothing once the reference is cited (scout: cuts
   with and without them matched within 0.01 and 2 Hz): cite the reference alone. Whisper text against the line is
   still yours to run.

H3 reads audio references only with a reference setup (Ref2V).

**Only where the Cast speaks** (SNAP-R237): a voice reference in a cut where nobody speaks makes H3 say its words
(F-SQ11, F-SQ12). Snap keeps it out: `apply_unit` gives a voice only to the cut's speakers, `apply_cast` on a plain
shot only when the prompt gives the Cast a line (`voice: true` overrides), and a retake or re-run with today's world
drops a voice from a cut with no line, saying so. Every speaking Cast needs a voice reference: the compile lints one
that has none.

## Sound in a cut

- **Listen before you pick** (SNAP-R150): judge talking takes and every video candidate with the sound on, and say in
  the recommendation what the audio does. Ask for subtle, diegetic sound (footsteps, wind, cloth, a bowl set down);
  stings, "tada" hits, clash bursts and game-style effects are a finding and sink the take.
- **Music is a reference input** (SNAP-R151): the production supplies the music as an `<Audio n>` reference and holds
  it across cuts; never ask a take's prompt for a score. Sound effects are made after picture lock, on a low-resolution
  copy of the locked cut at 12 or more steps, then put on the full-resolution picture (the audio pass in post).
