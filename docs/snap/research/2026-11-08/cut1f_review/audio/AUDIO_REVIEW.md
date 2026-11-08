# Fresh audio measurements and ASR review — 2026-11-08

Source: `seq02_nine_ring_cut1f_preview_chamber.mp4` (source left unchanged).

This is a whole-clip technical review using ffprobe, decoded PCM measurements, ffmpeg silence detection, and two already-installed offline ASR models on CPU. I did **not** listen to playback. No audible quality, intended dialogue, voice identity, unwanted vocalization, music continuity, or mouth-sync verdict is asserted. No prior findings or user-issue notes were read. No downloads, installs, GPU use, or service changes.

## Evidence and priorities

| Time in final clip | Finding | Confidence / interpretation |
|---|---|---|
| 47.307–47.958333 s | The audio stream ends 0.651333 s before video. Video: 1151 frames at 24 fps, duration 47.958333 s; AAC: stereo 48 kHz, duration 47.307 s. Both streams start at 0.000000. Decoding produces 47.296 s PCM (AAC trim/frame handling differs by 11 ms). | High: a real uncovered picture tail, not a delayed audio start. Treat as an edit issue if the intended ending requires sound through the last frame. It is not enough evidence alone to call a musical phrase cut short. |
| 47.16–47.296 s | A transient peaks near the end: 47.17–47.18 s window RMS −17.71 dBFS, peak −10.31 dBFS. Levels then fall, but rise again at 47.28–47.29 s (RMS −36.61, peak −26.12). Last decoded samples are small but nonzero. | High measurement; there is no demonstrated long, settled silence before track EOF. Sound-on review needed to judge whether this is an intentional effect tail, abrupt ending, or musical cutoff. |
| 30.00–31.04 s | Both models decode “Come on!” Small: 30.00–31.04; large-v3: 30.00–30.84. | Moderate evidence of a voice event and approximate timing; not proof the event is unwanted or that the words are correct. |
| 35.64–39.16 s | Both decode “Pass.” but disagree materially on alignment: large-v3 35.64–37.04; small word span 38.46–39.16 (segment metadata starts at 39.00). | Word hypothesis agrees; timing unreliable. Review the entire interval with sound rather than treating either alignment as ground truth. |
| 41.22–42.10 s | Both decode “Yes!” Large-v3: 41.22–41.98; small word span 41.40–42.10 (segment starts 42.00). | Moderate evidence of another voice event. Neither model establishes whether it is scripted dialogue, a background vocal, or an artifact. |
| 0.100–0.140 s | Opening transient against a very quiet bed: 0.10–0.11 s RMS −25.71 / peak −11.47 dBFS versus 0.09–0.10 s RMS −54.06 / peak −49.25. | High measurement; a useful playback checkpoint for a pop or intended impact. Do not call it unwanted from its waveform. |
| 5.872; 8.275–8.280; 13.309 s | Largest adjacent-sample differences cluster here; highest is 0.604 full-scale/sample at 8.279542 s. | These can be ordinary sharp effects. No standalone click/discontinuity verdict. |
| 0–47.296 s | No ffmpeg `silencedetect=noise=-60dB:d=0.08` events. Decoded peak −1.066 dBFS, whole-track stereo RMS −27.693 dBFS, zero PCM samples at absolute amplitude ≥0.999. | No measured ≥80 ms near-silence or sample clipping within the decoded stream. This does not prove music is present throughout, or exclude distortion baked into an earlier source. |

## ASR limits

Both passes used `WhisperModel(..., device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)`, beam size 5, word timestamps, no VAD, and `condition_on_previous_text=False`, with GPU visibility empty and Hugging Face offline flags. Small completed in 2.22 s; large-v3 in 63.64 s. Auto language was uncertain: small English probability 0.203; large-v3 Norwegian Nynorsk probability 0.326 despite its English output. Music/effects can cause misses and false recognition. Their agreement supports the three candidate phrases; their silence elsewhere does **not** rule out breaths, cries, exertion sounds, laughs, or other nonverbal vocals. No third pass was run.

## Practical reflection

The strongest objective issue is the final ~0.65 s of picture without an audio stream. The ending should be checked first in actual playback and against the intended end frame. Voice-event checkpoints at ~30 s, the broad 35.6–39.2 s interval, and ~41.2–42.1 s deserve human verification for timing and intent. I cannot approve music coverage, musical resolution, nonverbal vocal cleanup, or lip synchronization from these measurements.

## Saved evidence

- `probe.json`: full stream/container probe.
- `measurements.json`: all nonoverlapping 100 ms mono RMS/peak windows, stereo summary, and thirty largest adjacent-sample deltas.
- `whisper_small_cpu.json`, `whisper_large_v3_cpu.json`: full ASR results, confidences, segment and word times.
- `full_mix.wav`: unmodified decoded stereo mix.
- Playback excerpts: `opening_0_2.wav`, `speech_candidate_29_32.wav`, `speech_candidate_38_40.wav`, `speech_candidate_41_43.wav`, `ending_45_47_296.wav`. Excerpts are conveniences; use full mix for the ambiguous 35.64–39.16 span.

The source has not been changed. All derived files are new and confined to this review audio directory.
