# Dials over time, driven by audio, and leaving audio alone

Design note for workstream 2 of `dials/ROADMAP.md` (2026-11-01). Goal: a dial whose strength follows a curve over
the clip, applied inside one generation (no V2V pass), with the main curve source being the music the user already
gives H3; and a way to keep a dial off H3's generated audio.

## Facts this rests on
- H3 is a single-stream DiT: text, video and audio tokens share one sequence, and every video and audio token reads
  the same prompt through attention. A prompt-side dial therefore cannot vary over clip time by itself.
- On Pika H3 Flex (6 steps) prompt dials act only in the first steps; late envelopes at +2 and +8 changed nothing
  (study eval29). Whatever varies the dial over time only has to run during those steps.
- One latent frame covers about 4 video frames (about 1/6 s at 24 fps): the finest timing any in-generation route gets.
- H3 takes reference audio (`ref_audios` on the H3 conditioning node): music given there already drives the video.

## Route 1, build first: two-branch blend in the early steps
At each of the first k sampling steps, run the model on the same latent without and with the dial (one batch of two)
and blend the predictions per latent frame:

    v = v0 + M(t) · (v_dial − v0)

with separate curves for the two modalities, `M_video(t)` and `M_audio(t)`. After step k, continue on the blended
latent with the dial off (on Pika the later steps don't respond to it anyway).
- Cost about (steps + k) / steps: 1.33x on Pika with k = 2. No new dial math; it extends the step-envelope wrapper.
- Checks: `M = 0` everywhere is bit-identical to no dial; `M = 1` in all steps equals today's constant dial.
- `M_audio = 0` means the audio prediction comes from the undialled branch: the first "leave audio alone" option.
- Risks to measure: seams or flicker where M changes fast, how late the effect lands after a step in M, and audio
  still reading dialled video tokens through attention.
- Works for any model the rack supports; on image models M becomes a spatial mask.

## De-rope: curves through the hold map (built)
H3 Time Smear holds the jerky frames, so stage 2 renders a longer clip than real time, and Exact Recover drops the held
frames afterwards. Without a link, a curve is evaluated over that longer clip, so it lands early or late in real time by
the hold stretch in front of it. On the charge2 clip (124 frames, Jerk Oracle map stretched to 277, the first 0.75 s held
4x) a ramp from 0.8 s to 4.3 s landed 0.35 s, 0.47 s and 0.32 s early at its start, midpoint and top (exact, from the map).

The rack's optional `hold_map` input takes Time Smear's `hold_map_used`. A sampler whose clip has the map's stretched
length evaluates every curve in real time: stretched pixel frame s shows real frame r(s) (held copies all show the same
frame, so they get its value) and a video latent frame takes the mean of M(r(s) / 24 s) over its pixel frames (1, 4, 4,
4, 4 grouping); an audio frame's start is mapped piecewise linearly through the holds (Audio Smear stretches the sound
continuously). A clip with the map's real length samples as without it; any other length is an error. No map, an
empty string or an all-1 map is bit-identical to today. Renders (1 seed, stage 2's row on vs off on the same pass 1): the link moved
stage 2's dial effect 0.42 s (psychedelic) and 0.19 s (space warp) later, the direction and size the map predicts.

Time Smear runs after stage 1, so the rack that takes its map can only feed stage 2: put a copy of the rack (same rows)
on stage 2 and wire `hold_map_used` into it. Step envelopes and block strengths have no clip-time axis, so they need no
link (a step envelope already runs 0..1 over each sampler stage's own steps).

## Route 2, research: blend inside attention
Keep two copies of the text, without and with the dial. Video and audio tokens at time t mix their attention to the
two copies by `M(t)` (a per-query bias of log(1−M) and log(M) on the copies' keys, or two attention calls blended by
M); the copies don't attend to each other. Nearly free (text is small) and active at every step and token.
- Check: identical copies give identical output for any M.
- Cost and risk: needs a per-query attention bias or a second attention call per block through H3's attention path;
  fast kernels may not take masks.

## Fallback: time window by V2V
Render, then a V2V pass with the dial on and H3 V2V Init's time mask regenerating frames t0..t1 only. Expensive (a
second generation); keep it for editing a clip that already exists.

## Audio-reactive curves
- **Main case: the user's music.** The track goes into H3 as reference audio and the same file drives `M(t)`. Features
  per latent frame: loudness (RMS), onset strength, beat grid, low / mid / high band energy. Shaping: gain, offset,
  threshold, attack / release smoothing, invert. Fast hits are smeared to latent-frame timing (fine for a beat, coarse
  for a hi-hat).
- **H3 generating its own audio:** two passes with the same seed (generate, analyse, regenerate with the curve). Reading
  the forming audio mid-sampling is research; nice to have, not the main case.
- UI: a per-row time curve (keyframes, or an audio input plus feature and shaping), drawn over the clip timeline with
  the waveform; one curve type shared with step envelopes.

## Dials that leave audio alone (exploration)
Some dials break speech or Foley (the expressive-face dial added 4.8 dB of loudness; evil dials can change voices).
Experiments, each scored on dials known to hurt audio, against no dial and the plain dial:
- **E1, route 1 with `M_audio = 0`:** how much of the audio change disappears, and does the video effect stay?
- **E2, route 2 with audio tokens reading the undialled copy.**
- **E3, block profile:** find the blocks where audio queries put the most attention on text and leave the dial out of
  them (per-block strengths, workstream 1b).
- **E4, compare with the A/V split** of ComfyUI-Dials' `experimental/split-and-dial-to-lora`.

Metrics: loudness change (dB), speech intelligibility (Whisper word error rate against the undialled clip), a spectral
distance, and the video effect size (motion score or the dial's own probe axis). Single-seed results say so.
