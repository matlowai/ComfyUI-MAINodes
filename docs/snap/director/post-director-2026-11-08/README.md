# Post-Director addenda intake

Start with the [consolidated implementation plan](IMPLEMENTATION_PLAN.md) and [paired testing pickup](PAIRED_TEST_PICKUP.md). These include the latest human-led testing priority and dogfood findings.

Both user-supplied addenda were read in full by Astra: **1,357 lines / 132,339 bytes**. The [complete source review](ASTRA_REVIEW.md) maps 23 proposed capabilities to existing code, identifies conflicts and supplies acceptance gates. The [source manifest](sources.json) records original and copy hashes; both complete Markdown inputs are in `sources/` (hard line breaks use backslashes to pass the repository whitespace check).

The user requested this analysis while the tiny dogfood test runs, with implementation to follow the test. This checkpoint adds planning material. The separate dogfood source fixes are already implemented; the proposed intake, learning, accessibility and speech features below are not claimed implemented by this document.

## Proposed order after the test

| Slice | Scope and owner | Evidence before calling it done |
|---|---|---|
| Close the tiny test | Existing Book/boards/cuts/export | Actual outputs, joins, sound and explicit review limits; preserve failed attempts |
| Creative intake pilot | One canonical skill, portable entrypoint and separate baseline/held-out cases | Real agent behavior across ambiguous requests, named projects, existing approval and corrections; no wrong-project writes |
| Director ordinary controls | Existing strategy dialog: Book names, coverage, duration, advanced JSON | Keyboard/native browser input produces the exact expected preview and scope |
| Room accessibility | Existing Room focus, input preservation, close/restore and decision labels | Real keyboard/asynchronous-arrival tests; a supported screen-reader smoke with coverage stated |
| Actor attribution | Existing Room/candidate/take boundary, after reproduction | Human direction and agent execution remain distinguishable in real stored records |
| Set-plan controls | Numeric and keyboard editing over existing shape/camera arrays | Create/edit/save/reopen without dragging; same native data and raster, no invented metric scale |
| Renderer parity and preflight | Extend existing classic/Vue checks and same-target schema inspection | Displayed values, serialized graph and API prompt agree; checks say pass/fail/unverified without loading models |
| Reviewed technique improvement | Inactive candidate diffs, separate held-out evaluation, scoped canary and rollback | Active skills stay unchanged until reviewed promotion; honest actor labels; negative results retained |
| Optional local speech | Small input/output adapter over established native text actions | Measured local latency/cancellation, explicit microphone lifecycle and no QA-resource wakeup for every utterance |

These are small independent changes with dependencies, not one combined implementation. Finish the current test and use its demonstrated friction to choose the next slice. The first intake behavior can be piloted through existing conversation and skills. Current immediate user-directed note/skill editing remains its own contract; an optimizer draft lane would be new behavior.

## Findings to carry forward

- Current Voice QA analyzes generated takes and reference voices; interactive microphone STT/TTS is separate work.
- Candidate/take verdict buttons in Room have source-level attribution inconsistencies. They need disposable native reproduction before using picks as human learning labels. This does not invalidate the already explicit Story5/style2 chat approval.
- Collaboration style changes interaction preferences within existing authority. Existing permission and canon decisions persist across modalities and context resets.
- The new candidate-panel Escape fix belongs to `view.js`; it does not qualify the broader Room accessibility slice.
- Existing blind critic and instruction-pin qualifications remain open under their owners. The resumed test also confirmed selected adapted boards lack story pins used by staleness checks; a future Book-owned adoption-state record must remain distinct from creation history.

See the [active dogfood follow-up](../dogfood-2026-11-08/FOLLOWUP_2026-11-08.md) for current production and verification status.
