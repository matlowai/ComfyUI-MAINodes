---
name: snap-dials
description: Create, evaluate and apply steering dials in Snap, including project-specific strength-over-time envelopes and controlled previews. Use for the Dial Rack, prompt-pair directions, calibration or timed steering; not the Book autonomy dial.
scope: [brick:rack, tool:make_dial, tool:list_dials, tool:add_dial, tool:set_dial, tool:preview_dial, tool:set_cut_dials]
rules: [SNAP-R2, SNAP-R16, SNAP-R19, SNAP-R93, SNAP-R94, SNAP-R230, SNAP-R231, SNAP-R232, SNAP-R239]
---

# Steering dials in Snap

Read `snap-core`, the current recipe and resolved `brick:rack` instructions. This is a Snap skill served by `read_skill`; the person's Agent-library version overrides the pack. Discover the live tool schemas before using examples or newly added tools.

## What a dial means

A prompt-pair dial is a learned inference-time direction, not a physical animation control. Negative strength moves toward prompt A, positive toward B; zero leaves that row inactive. Match action, subject, style and wording across each pair, changing the intended quality. Subject expansion can reduce content entanglement. Pair agreement and vector size describe construction, not rendered quality. Keep the endpoint meanings separate: anticipation versus crisp release is different from mechanical motion versus anticipation-and-release together.

Scale depends on family, pipeline and references. Read `list_dials` evidence, useful and overcook strengths, and whether the current pipeline was measured. Values such as -2/+2 probe extremes; they are not universally good defaults. Higher strength may restage or deform the subject. Preserve unsuccessful results and change the approach after repeated failures, not just the seed.

## Two clocks

`time` is strength over **clip time**: `seconds` from the first frame or `normalized` 0..1 across the clip. Effective steering is row strength multiplied by each key's level; signed levels can cross from A to B. A temporal curve is steering guidance, not a guarantee that the model will place a kick exactly on a key.

`envelope` is strength over **denoising progress**. Late denoising is not late in the video. Do not use a denoising envelope to promise a late action. Time curves require a supported post-refiner H3 dial; pre-refiner files and other model families have different capabilities. Read the live rack schema and [Dials documentation](../../../dials/README.md) for holds, block strengths and step envelopes.

## Pair with the person on the actual project

Use the current project brief and references before making test clips; a starter prompt is not project context. Name a dial briefly in the UI, show its two ends once, and present an action such as “Try with this project.” Keep filenames and repeated prompt descriptions out of choices. Use Snap's proposal-card style, existing instruction library, native queue and attributable human decisions.

A short same-seed flat comparison can establish whether a new direction does anything. Offer editable strengths and show actual video, with sound, before recommending a useful range. One-second clips may be too short to judge anticipation, follow-through or a full kick. Separate what was observed from what is proposed.

For creative timing, propose a visible curve suited to the action. Example for a punchy animation trial: build toward the anticipation end, cross sharply into release, then taper to neutral; compare a baseline with the same prompt, references, seed and duration. Change amplitude and timing separately once the direction works. Do not turn this example into a mandatory curve for every project.

`add_dial` and `set_dial` own rack rows; `set_cut_dials` owns a Book cut's planned rows. Keep envelopes on their owning record and read back what will execute. `preview_dial`, when this server exposes it, uses native queued jobs; report the queued strengths, duration and curve, preserve the person's other settings, and follow Work to the actual results. Newly created dial files do not become active just because they exist.

Creative choices and execution permissions remain the person's. Preserve concrete batch authorization; do not ask again just because work crossed a tool boundary. A successful file save is “dial created,” not “video generated.” A message saved to Snap is “waiting for agent” until an actual agent reply; it does not prove a Codex session was awakened.

For an approval sent through the conversation, use its saved context.trial snapshot (dial, amplitude, frame count and full time curve). Do not substitute controls the person changed after sending. If a legacy message lacks that snapshot, say so and read back the proposed parameters before execution. Label a time-varying job as an envelope trial; a peak such as +2 alone misleadingly suggests constant steering.

For an accepted project trial, apply the chosen frame count and timed dial row to the live recipe before queuing, so the bricks reflect what the person is testing. A temporary isolated strength probe may restore its original recipe; do not use that restoration behavior to leave project bricks showing an old duration or empty rack. Prior-run rehydration is a separate workflow, not a prerequisite for a current trial.


## Fast animation: blur, smear and edge clarity

A blur direction can soften the whole image, alter motion speed, or produce stretched anatomy rather than useful motion rendering. Treat bounded directional blur / intentional animation smear and edge cleanliness as potentially separate controls. Evaluate complete fast actions plus frames around acceleration, peak and recovery: static contours should stay legible, deliberate smears should resolve, and unwanted tethers, duplicated limbs or persistent streaks should decrease. Freezing/slowing the subject, increasing generic motion energy, or sharpening an already distorted shape does not establish success.

Use matched subject/action/style wording and seeds. Establish the effect of one constant direction before combining it with positive-motion steering or a clip-time curve. Keep de-rope and upscaling fixed within a comparison, inspect raw generated output before judging processed output, and retain enough provenance to separate those effects. A trained adapter may ultimately be needed; that is an empirical follow-on decision, not a prerequisite for a small training-free probe. Project-specific test plans and authorization remain with the person; this guidance does not authorize generation or training.

## Trial cards and current recipes

A new trial defaults to constant steering unless the current rack already has a curve; existing points/interpolation are preserved. The punch preset is an explicit action-specific choice, not the meaning of every dial. Cards belong to their project and recipe settings. Unchanged recipes retain trial edits; changed recipes reload unedited cards or preserve edits visibly as stale until the person reloads current settings. Never apply another project's cached controls. Flat sweeps use the selected clip length and restore the project rack; a chosen project trial leaves its selected constant or timed row visible.

## Loaded recipes and render-stage outputs

After opening or copying a shot, verify the actual prompt, references/first frame, seed, dimensions, rack and processing state before queuing; a request to copy is not proof the intended recipe loaded. Compare actual executed inputs when auditing a result.

For raw versus de-rope comparisons, inspect saved outputs first. Stage 1 may have been computed only as an intermediate while the final saver wrote stage 2. History and a configured CreateVideo node do not establish a retained stage-1 file. Reuse a saved raw clip when available; cache-only recovery must refuse resampling on a miss. If stage 1 must be generated again, disclose that and preserve the user's concrete authorization. Record the de-rope branch and distinguish automatic second-pass steps from disabled de-rope. Preserve and label raw and final files independently when the native workflow supports it; the save-both-stages capability is still pending.
