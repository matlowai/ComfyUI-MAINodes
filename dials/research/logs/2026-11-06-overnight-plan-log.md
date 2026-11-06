# Overnight plan 2026-11-06 (Dylan asleep; no pushes/posts/uploads; local commits + downloads OK)

Objective (Dylan's words): "lets get the latest matlowai/mainnodes and poke at dials a bit" -> "Run a few renders, Build dial-making skill, Make new dials"; then "you have enough on the roadmap around dials to look at and research through".

## Items
1. [DONE] Evil-pack sweep on main c3f2315: Simple Pika+de-rope example (train platform, seed 42, de-rope OFF), control + 8 dials x {+1,+2} = 17 renders. Log scratchpad/evil_sweep.log, outputs comfyui/output/video/dials_evil1106/. Contact sheets -> verdict per dial. Caveat: subject seen from behind.
2. [revised x2] Skill h3-dial-maker (SKILL.md + SUBMISSION.md) on local branch dial-maker-draft of h3-agent-skills. Revised with provenance + mechanism section (core.py) + 'four kinds of contrast' (Dylan: opposites / plain vs featured / continuum / abstract weird experiments).
3. [DONE first pass] Measure sweep vs probes ("wheel vs renders", ROADMAP WS1): per-render luma / R-B / motion vs control, compare with each dial's top probe axes (probe bank now local).
4. [DONE + extended] 7 experimental dials h3_x_* MADE on :8189 (pairs pairs/new1106/; agreement 0.82-0.90; datamosh debias 12%). Cosine check done (max 0.61, no remakes; oil_pixel/silentfilm_cyberpunk most novel). Sweep 29 renders (control + 7 x {-3,-1.5,+1.5,+3}) on GPU1 :8189, log scratchpad/x_sweep.log, out video/dials_x1106/. >1 GPU-hour: authorized overnight by Dylan's 'you have enough on the roadmap... research through' + 'weird experiments'.
6. [DONE] Morning report (durable, in repo) + list of things waiting for Dylan (pushes: MAINodes none pending; h3-agent-skills branch; ModelCatalog commits local).

## Status log
- 05:33 sweep launched (16 left), provenance saved to (notes on the other machine)/VILLAINY_PROVENANCE_SUMMARY.md, 30-min loop f1675c60 set
- 05:41 7 h3_x dials made; x sweep launched on :8189; evil sweep on :8188 at 5/16
- 06:12 evil sweep DONE 16/16 (sheets looked at, table + audio LUFS in docs/DIALS_OVERNIGHT); template-leak control (noview +1/+2, placebo x4/x8) rendering on :8188; x sweep 18/29 on :8189
- 06:14 check-in: no messages; placebo 1/4 (:8188), x sweep 19/29 (:8189), scan queued after it; sheeted memory_present + order_entropy (memory = clean haze/fade look; entropy +3 = debris + running, motion leak as cosines predicted)
- 06:21 template-leak control DONE: templates not the cause (noview ~ sinister); placebo at matched size keeps her back to camera but restages background -> added 'size-matched placebo' step to skill; GPU0 now idle
- 06:22 GPU0: dialogue WER test (control, sinister +1/+2, sinister +2 audio-protect, unhinged/seductive/creepy +2; seed 2101, 209 f) then seed-43 replication of 8 x-dial arms + control; log gpu0_queue.log. WER scorer code/dial_dialogue_wer.py (whisper-large-v3-turbo local)
- 06:31 x sweep DONE 29/29, all sheets looked at; pattern: style words -> era/setting/format; only pixel/datamosh cross at +3; owl_octopus = placebo-like on a human scene; silentfilm +3 identity swap with younger apparent age flagged for review. Skill updated. Scan queued on :8189 now; GPU0 dialogue+s43 running
- 06:32 wheel-vs-renders DONE: colour_temp 10/11 dials p=.006, time_of_day 8/9 p=.02, motion 10/12 p=.02; contrast chance; texture inverted. Raw json + sheets copied into ModelCatalog docs/measurements
- 06:41 scan DONE: datamosh sweet spot +2.25 (subject crisp, background moshed), window 2.25-2.5; oil_pixel +2 isometric diorama, +2.5 pixel level. GPU1 idle.
- 06:42 GPU1: made h3_x_film_artifact (describe-the-artifact test; cos -0.35 with silentfilm_cyberpunk, agreement 0.864); queued film_artifact +1.5/+3 (x control) + owl scene (control, owl_octopus -3/+1.5/+3/+4.5); log gpu1_queue2.log
- 06:43 GPU0 dialogue: sinister_p2 REFUSED by queue_scene prefix guard (my naming: 'sinister_p2' is a prefix of 'sinister_p2_protect'); re-minted as sinister_two, queued after the s43 batch. Lesson: arm names must not be prefixes of each other.
- 06:43 dialogue WER partial: control/seductive2/creepy2/sinister2-protect all 0.00; sinister +2 unprotected + sinister +1 + unhinged +2 pending
- 06:44 check-in: no messages; sinister +1 dialogue WER 0.00 (-27.0 LUFS); unhinged +2 rendering (GPU0); film_artifact +1.5 rendering (GPU1)
- 06:55 GPU1 follow-ups DONE: film_artifact did NOT give grain/scratches (skill corrected); owl scene: barn owl at +1.5, octopus on the fence post at +3, reef at +4.5. GPU1 idle.
- 06:59 owl hybrid hunt: +2 barn owl, +2.5 octopus: identity is a switch, no hybrid (1 seed). GPU1 idle.
- 07:00 dialogue: unhinged +2 WER 0.00 (shouted), sheet looked at; protect keeps video effect. Waiting: sinister_two (unprotected +2) after s43 batch.
- 07:00 GPU1: seed-43 checks of the sweet spots (datamosh +2.25/+2.5, owl->octopus +3, own GPU1 s43 controls); log gpu1_queue4.log
- 07:08 seed-43 replication DONE: all 8 headline arms replicate (oil -3 indoor horse again; oil +3 pixel level with HUD; mosh +3 glitch portrait = threshold shifts by seed). sinister_two now running on GPU0.
- 07:09 GPU1 s43: datamosh +2.25 sweet spot replicates, +2.5 portrait, owl->octopus +3 replicates. GPU1 idle. Waiting sinister_two on GPU0.
- 07:12 sinister +2 unprotected WER 0.00 too (protect no effect on Pika here). Confound pipeline vs <d>-tag prompt format -> running free-text prompt arms on GPU0 (gpu0_freetext.log)
- 07:13 COMBOS: oil-3 + mosh2.25 = actual oil painting (neither alone does it!); oil+2.5 + memory+3 = collapse to pixel title card. Controls queued on GPU1 (mosh 1.5, seed 43, size-matched placebo); log gpu1_queue6.log
- 07:14 check-in: no messages; GPU0 free-text dialogue control rendering; GPU1 s43 oil+mosh combo rendering. Drafting morning report.
- 07:21 painting combo CONTROLS: mosh 1.5 still painting; seed 43 replicates; size placebo = no painting; style probe = partial mural. Medium comes from datamosh direction. GPU1 idle.
- 07:22 free-text prompt: sinister +2 WER 0.00 on Pika too -> prompt format not the cause; pipeline (Pika vs base) is the remaining hypothesis. unhinged2 rendering.
- 07:25 free-text unhinged +2 WER 0.05. All queued renders done; both GPUs idle. Writing morning report.
- 07:26 morning report written: docs/DIALS_MORNING_REPORT_2026-11-06.md (ModelCatalog c256da7); skill 001a40a. All plan items done; GPUs idle.
- 07:44 check-in: no messages, queues empty, all plan items done; idle until Dylan is back
- 08:14 check-in: no messages, idle
- 08:44 check-in: no messages, idle
- 09:14 check-in: no messages, idle
- 09:44 check-in: no messages, idle
- 10:14 check-in: no messages, idle
- 10:44 check-in: no messages, idle
- 11:14 check-in: no messages, idle
- 11:44 Dylan back; review page served at http://127.0.0.1:8765/dials_review_2026-11-06.html (pid 2693024); overnight loop f1675c60 cancelled
