# Paired workspace follow-up — 2026-11-09

The paired human/agent trial produced reusable workflow fixes. The character/sprite examples were test cases; they are not a prerequisite for the UI or a reason to discard the changes.

## Included

- A movable/resizable, translucent Conversation/Decisions/Results workspace with recorded dependency navigation, multiline messages and saved replies.
- Draft revision/project guards: typing during a pending send or decision survives; decision reasons retain the submitted text; failed-save retries reuse their note.
- Recipe-scoped dial trial cards: unchanged recipes retain trial edits; changed recipes refresh unedited cards or visibly block stale edited cards until settings are reloaded. Another project's cached controls are never silently applied.
- Constant steering as the generic starting point, preservation of existing time curves and an explicitly selected punch preset. Selected duration is honored by flat comparisons too.
- Native same-seed preview jobs, actual rack curves, model-family/hook compatibility, increment seed mode, execution-tagged live sampling frames and protection against automatic oversized saved-video decoding.
- Scoped brick/tool instructions and a steering skill using the existing instruction library.
- Quant-aware RelayVSR readiness and a documented `SNAP_CHROME_SOFTWARE=1` managed-browser fallback. Browser acceleration remains the default; the fallback is opt-in.

These changes preserve native graph, recipe, queue, Work, take and instruction owners. They add no model downloads, training path or second agent inbox.

## Validation

- Six actual-handler draft tests and six real-module dial-card tests pass, including delayed saves, new typing, project switches, stale control refusal, unchanged edit preservation, curve/interpolation retention and duration-aware sweeps.
- Four focused seed/live-preview/playback cases and three CPU RelayVSR readiness cases pass.
- All 79 dependency-free Director regression cases pass. The existing source-based native dial-preview harness passes fixed seeds, timing, restoration, partial queue failure and invalid input checks.
- Real managed-browser checks pass preserving the current recipe, note records and draft: current curve preservation, same-recipe edits, stale trial refusal, explicit reload, explicit punch selection, conversation tabs and draft recovery after reopening. No render or message was submitted by those UI checks. Readable screenshots were reviewed; an SVG visibility issue discovered there was corrected.
- Shell syntax and Git whitespace checks pass. The paused workflow was saved before browser recovery; the machine's managed window needed the opt-in software fallback during validation.

The full dedicated-server Snap gate was not run: this checkout has no configured gate environment/private fixtures. These targeted results do not qualify every integration, keyboard/accessibility path, model family or production deployment. Dedicated fixture tests must not run against a person's production server.

## Remaining work

1. Run the full dedicated integration gate before merging or production landing; include concurrency and cross-workflow navigation, accessibility and classic/Vue renderer parity.
2. Add an actual Send-to-agent wake-up/attachment mechanism; saved inbox messages still wait for an agent to read them.
3. Exercise prior-run drop/recipe rehydration with real saved workflows; it was intentionally deferred during current-run UX work.
4. Offer native stage-1 and stage-2 output preservation, and a genuine cache-only recovery guard. Selecting stage 1 may otherwise resample after cache eviction.
5. Reproduce and address copied-shot fallback behavior with an unsaved source, without hiding missing recipe state.
6. Continue the existing [post-Director plan](director/post-director-2026-11-08/IMPLEMENTATION_PLAN.md): readable Director controls, Room keyboard/attribution, selected-board provenance and accurate disabled-Upscale diagnostics. Agent activation/learning and speech remain separately scoped later work.

The [Director closeout](director/dogfood-2026-11-08/CLOSEOUT_2026-11-08.md) is now complete as a native workflow test, with the C2 dialogue/performance failure explicitly retained. Its critic/instruction-pin limits and this paired trial's results are separate evidence, not interchangeable approvals.
