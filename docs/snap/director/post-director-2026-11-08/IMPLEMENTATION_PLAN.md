# Post-Director implementation plan

Planning stays on `snap-research-2026-11-08`. The next implementation branch should cover one coherent behavior after the tiny test and paired baseline are reviewed. The user's next priority is paired work with the human directing choices. This plan folds both complete addenda, Astra's source audit and the current dogfood findings into that priority.

[Full capability matrix and acceptance detail](ASTRA_REVIEW.md) · [paired testing pickup](PAIRED_TEST_PICKUP.md) · [actual dogfood evidence](../dogfood-2026-11-08/FOLLOWUP_2026-11-08.md).

## Already implemented and evidenced

Three Director planners, seven tools, native scoped preferences, packing/reference helpers, native Book/world records and proposals are present. Dogfooding added still-speech/phase-lint fixes, check-result routing and concise notices, and keyboard focus for the candidate fallback. Real browser checks, selected boards, visual animatic reviews and actual human render approval are recorded. Five catalogue presets remain drafts. The full generated short is a separate current execution task, not an implementation claim here.

## Recommended work order

Each row is an independently reviewable change. Existing code owners, record stores, tools and approval paths remain authoritative. Do not bundle the table into one rewrite.

| Priority / unit | Concrete scope and owner | Acceptance / finish condition |
|---|---|---|
| **0. Paired baseline** | Test the existing UI and native assist controls on a separate instance, with a real human making creative choices. No new implementation needed to start. | Complete the pickup checklist; preserve human decisions, actual tool actions, latency and failures. Separate blocked capability from confusing presentation. |
| **1. Ordinary Director controls** | `web/snap/director/dialog.mjs`: Book by readable name; common coverage/duration fields; advanced JSON retained. Addresses observed F-DD70. | Keyboard selection among duplicate names resolves the intended ID. Preview parameters/scope match visible controls. Existing advanced keys survive. Preview creates no job/graph/world write. |
| **2. Room keyboard and decision flow** | `web/snap/room.js`: stable question identity, keep focused text while pointer is elsewhere, intentional next focus, Escape/close and opener restoration. The completed view.js fallback fix does not qualify Room. | Actual keyboard test with mixed decisions, async arrival, stale question, missing opener and repeated open/close; one available screen-reader/browser smoke with limits stated. No accidental duplicate action. |
| **3. Attribution before learning** | Reproduce Room candidate/verdict paths and automatic QA metadata at their existing UI/persistence owners. Separate human direction, execution actor and machine evaluation. | Real person, managed-agent input, chat-authorized relay and automatic QA remain distinguishable. No rewritten historical labels. Source-level Room hardcoded-person finding is reproduced before patching. QA by=person is never treated as proof of human listening/judgment. |
| **4. Selected-board provenance** | Book owner (`booktools.js`, `book.js`): adapted edits selected as boards need honest selection-time state provenance. Creation history remains immutable. Addresses F-DD151. | Native make_board and adapted-edit selections both participate in relevant story/style stale checks. A changed used field flags the selected board; unrelated fields do not. Restore tests and exact historical graph hashes pass. Public contract changes, if needed, are explicit. |
| **5. Accurate active-recipe diagnostics** | Book apply/readiness presentation: distinguish an Upscale brick being configured from enabled. Current F-DD154 reports it will enlarge output while it is off; actual C1 files remain1280x704. | Off/on/missing-method cases describe what will execute. Compare actual graph and output size; do not silently switch a model or enable a method. No inference/model-layer changes. |
| **6. Creative-intake skill pilot** | One canonical `snap-creative-intake` skill, portable entrypoint and small evaluation lane over existing conversation/native tools. | Separate observed/inferred facts; screenshot is not source motion/audio. Named project and existing permission are not asked again. Project corrections and thoughts-only requests route correctly. Baseline and untouched held-out cases cover at least the supplied24 categories. Record actual agent actions, not parser-only green results. |
| **7. Non-drag set-plan editing** | `planview.js`: labeled numeric/keyboard/click controls over existing shape/camera arrays. | Create/edit/save/reopen two shapes and three cameras without dragging. Same native data and raster. Coordinates remain normalized; no invented metric calibration. |
| **8. Renderer parity and read-only preflight** | Extend existing classic/Vue switch checks; same-target backend schema discovery at existing tool/compiler boundary. | Displayed widget values, serialized graph and compiled API inputs agree, including dynamic/audio/reference/Dial controls. Preflight says pass/fail/unverified, leaves graph/queue/world unchanged, and does not execute unknown validation hooks or load models. External Comfy MCP is optional diagnostics, not a replacement production executor. |
| **9. Lossless plan context** | Existing Director response owner; investigate a shared, losslessly reconstructable representation for repeated instructions/operations. F-DD153 measured114600B with77 instruction rows/16 unique. | Preserve every scope, origin, method binding, off mark and complete instruction text. No caps, omitted metadata or hidden truncation. If public response shape changes, version/document it and update every real caller/test together. No new persistent cache/database. |
| **10. Reviewed technique improvement** | Inactive candidate artifacts and existing skill/version mechanisms, after intake evidence and trustworthy attribution. | Baseline/candidate hashes, full diff, separate held-out evaluation, scoped canary, reviewed activation and exact rollback. Active read_skill unchanged before promotion. User-directed manual save behavior remains intact. Acceptance rate alone is not intent correctness. |
| **11. Optional local speech** | Small input/output adapter over the proven text and native-action flow, after accessible review and attribution. | Editable transcript, explicit microphone start/stop, cancellation/timeout/denial, no duplicate action from echo/repeated transcript, no remote fallback or QA-model wakeup per utterance. Measure cold/warm latency. Generated-dialogue Voice QA remains a separate capability. |

Units1/2/6/7/8 are largely independent. Unit3 precedes learned human-label use and voice writes; unit4 precedes reliable board reuse after canon changes. Unit10 depends on real unit6 evidence. Speech follows text semantics and accessible review. The first implementation choice should be informed by the paired baseline, with unit1 or2 the smallest visible product changes.

## Speech fidelity finding from the current run

The single C2 rendered the requested “For me?” but automatic QA also found late unscripted speech ending in “bowl”, with uncertain speaker assignment. This is an explicitly flawed test result, not a clean brief pass. Possible reference-word leakage needs a hash-traced reference transcript and human listening before assigning cause. A near-threshold speaker score alone does not establish the wrong identity.

Before adding an interactive voice front door, include this case in the native voice/reference evaluation: exact script versus actual words/times, reference-WAV identity, observed lip movement, machine versus human judgment and explicit uncertainty. Preserve the full original. A trim that hides late words cannot prove the first speaker is correct. Implement only a demonstrated native gap after that diagnosis; keep model limitations visible rather than rerolling until a metric passes.

## Shared boundaries

- Human interaction style is separate from autonomy. Avoid repeated confirmation of already authorized work; preserve native canon and decision boundaries.
- Use existing Book, Room, Work, scene, Cast, instruction and version records. No second chat, queue, permission engine or global optimizer is required for these slices.
- Local-only behavior stays local. No new outbound request path in core ComfyUI; speech-provider locality must be evidenced, not inferred from its name.
- Keep changes at the narrow owner. No UI/session identity bookkeeping in model inference. Preserve native nodes, graph round-trip and saved workflow compatibility.
- Keep full original evidence and negative results. A current targeted pass does not erase the earlier below-floor critic result or instruction-pin failures.

## Verification and delivery per unit

1. Freeze the concrete paired failure and its original receipt/screenshot before editing.
2. Implement the smallest owner change; add a meaningful regression where needed, then perform the relevant real UI/tool test.
3. Record source revision, model/effort where relevant, exact test inputs, side effects and unperformed coverage. A screen-reader check, listening, GPU result and CPU/schema test are separate evidence.
4. Review the diff and screenshots as a product. Run affected checks; run the required broader gate before production landing. Keep existing critic26/31+1FA and saved-workflow9/10 findings open until prospectively resolved.
5. Commit one behavior with concise validation and update the current handoff. Push the chosen review branch under the user's publication direction. Do not automatically start another branch from this planning document.

## Decisions still needed at the relevant slice

Choose the first concrete paired friction to fix, the available assistive-technology target, and whether speech inside Snap adds value beyond the existing conversation client. Inventory local speech providers before selecting one. These decisions do not block testing the current branch or a skill-only intake pilot. The user's preference to try lower reasoning during future dogfooding should be measured separately from product autonomy; record latency and missed issues rather than assuming equivalent quality.
