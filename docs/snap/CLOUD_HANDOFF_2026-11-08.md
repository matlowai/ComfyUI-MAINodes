# Cloud pickup — 2026-11-08

**Dogfood closed:** [full7.5s test Cut/OTIO and closeout](director/dogfood-2026-11-08/CLOSEOUT_2026-11-08.md). The native workflow completed; C2 failed dialogue/performance and remains explicitly flawed. No further local renders are planned.

For the other-machine trial, start with the [paired testing pickup](director/post-director-2026-11-08/PAIRED_TEST_PICKUP.md) and [consolidated implementation plan](director/post-director-2026-11-08/IMPLEMENTATION_PLAN.md). The current lab continues its approved short separately; no new implementation branch has been created.

> **CURRENT WIP PICKUP:** Stay on `snap-research-2026-11-08`. [Dogfood follow-up](director/dogfood-2026-11-08/FOLLOWUP_2026-11-08.md) records actual native Work/result checks and the verified candidate-panel Escape fix (`28260fa`), following compiler/UI fixes `1c976ee`/`476d4f2` and context notes `634f479`. Both selected opening boards and the native 7.5-second animatic passed visual review; the user answered “Approve and render”, authorizing the separate video phase. The tiny short is still in progress; no final generated film or production landing is claimed. [Post-Director intake](director/post-director-2026-11-08/README.md) contains both complete supplied addenda, Astra’s source review and proposed next slices. The earlier context snapshots retain their historical status wording.

> **EARLIER PUBLISHED VERIFICATION:** Work on `snap-research-2026-11-08`, the desired WIP branch. Begin with the [complete verification matrix](research/2026-11-08/verification/FINAL_VERIFICATION_2026-11-08.md), [Native Director integration](director/INTEGRATION_2026-11-08.md), and [session evidence](research/2026-11-08/README.md). This is a reviewed WIP, with explicit unresolved findings. Live remains G17a `8542b92`; no production landing is claimed.

The following source qualification describes the pre-dogfood published checkpoint. Later Book/UI patches have focused and bounded native checks, with no new full-gate claim.

The original published research checkpoint is `eb8cc3a`. Director application code landed in `2830523`; native Voice QA fixes are `e95b1a7` and `a7dd97b`. Final affected-lane verification used `032876c`. Subsequent checkpoint additions contain reports, screenshots, device-neutral identity-test wording and a test-history preservation guard; application and canonical skill bytes remain those qualified at `032876c`.

## What changed

- Three native production planners: Script to Film, Dialogue Director and Transform Footage. Seven tools, versioned private strategies, native scoped preferences, duration packing and reference-role proposals. Five other presets remain explicit drafts. The graph, Book, Work card, proposals and critic keep their existing ownership; there is no new executor.
- Method-specific instruction resolution and matching for the already-declared Book scope. The dialog is reachable in Snap's Library, uses the selected Book, and preserves explicit global scope. Inspect old productions' actual stacks before rendering: previously unmatched Book notes can now apply.
- Native Voice QA discovers installed GGUF models from the AudioCPP loader's declared combo, leaving the shared experimental inventory unchanged. Successful clean silence reports `ok`; legacy no-QA and uncertain/leaked speech retain their distinct results.
- Portable Codex entrypoints remain under `.agents/skills/`; canonical guidance is `.claude/skills/`. Set-design metadata now declares its scope. Rules R269/R271 govern architecture grounding and scene-reference preparation; R272/R273 cover Director/native instruction behavior.

## Verified and unresolved

Director CPU **79/79**, Voice QA regression **9/9**, native Qwen and encoded-init checks pass. Actual GPU word/export **7/7**, Voice QA **8/8**, critic mechanics **11/11**, identity **7/7**, and native set-reference checks **10/10** passed on the exact sources listed in the matrix. Actual native UI/preview purity, Book/shot isolation, proposal behavior and all seven tool dispatches were checked on a disposable project. [UI captures](director/COORDINATOR_ACCEPTANCE_2026-11-08.md) and [complete native evidence/hash inventory](research/2026-11-08/verification/native_evidence_copies.json) are included.

The original broad run reported 215 numeric lines, no skips, and real-model guards passed. It was **not wholly green**. Corrected census/metadata/citation cases and quiet UI reruns pass; the report retains all original failures. Two expensive CPU vision cases were interrupted and separately qualified on GPU. Browser timing modes are explicit. Shell exit zero is not an all-suite pass.

Remaining findings:

- Fresh visual critic: **26/31 caught, one false alarm**, below the declared **27/31, zero false alarms** floor. Complete frozen notes, raw/confirmed scores and independent diagnosis are preserved. Reconcile the real duplicated-monocle severity conflict and prospectively qualify the critic; do not alter frozen results or repeat until green.
- Saved-workflow instruction pins remain **9/10**; the same historical predicate still fails. New-view helper takes also lack a complete saved instruction stack. Captured resolved instructions do not substitute for pinned provenance.
- The planner has not been qualified as a complete newly generated film or propagated footage transformation, and no final-export listening approval is claimed. Strategies and reference-role metadata do not establish correct geometry or output quality.

## Scene evidence

The original terrace is rectangular. Earlier square-overhead and camera-plate-conditioned successes were confounded. R271 requires a textured top plus at least one genuine side, preferably two; retain the chosen raw candidate2 and negative camera/blocking results. Top/side trials still failed outside-ring staging. See [current research conclusions](research/2026-11-08/README.md).

The user also flagged the old mocked lighthouse example. [Point Reyes research](research/2026-11-08/lighthouse/README.md) now has measured plans, genuine sides, distinct clockwork/lantern interiors and exact dated sources. This does not adopt a real building as fictional canon or repair the old demo automatically. Textured overhead and wider upper-lantern reverse coverage remain incomplete. Several derived angles can share an incorrect master premise.

## Local checks

```sh
node --test tests/snap/director/*.test.mjs
node tests/snap/test_voice_qa_discovery.js
node tests/snap/test_qwen21_graph.js
node tests/snap/test_view_init.js
git diff --check
```

For broader checks, read `tests/snap/README.md` and the full matrix first. Use isolated test instances; never run placeholder-model fixtures against production. Recheck the serving pack, tool schemas, scoped instructions, page ownership and queues before runtime work. Preserve native canon/proposal boundaries. Keep original media, machine configuration and weights local; the public evidence labels unshipped originals and structural path sanitization explicitly.
