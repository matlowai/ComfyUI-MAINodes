# Native Director dogfood — narrow UX fixes

READ FIRST — final context checkpoint, 2026-11-08: Four-file patch reviewed and committed locally as `476d4f2`, after Book compiler commit `1c976ee`. Both remain unpushed. Studio loaded app `a4dc2a790517`; raw approved canon remained unchanged. Local actual-function checks pass: title3/3, routing/renderer/lifecycle20/20, syntax4/4 and whitespace. The new real reference-check notification uses the human question; its actual toast Open reached the correct C2 board/owning Shot2 Take1. Post-fix persistent Work c1→Take7/c2→Take8, applied parent→Take8, and unpicked fallback/close/pointer lifecycle remain **not exercised natively**. CPU passes are separate evidence. See UX_CRITIC final coverage and critic_artifacts/HANDOFF.md. All four board reviews are done/unpicked, zero claims/page holds, both render queues empty; C2 requires confirmed medium seam repair. No animatic/video/export exists. Main unchanged. Exact diff retained in uxfix_source.diff. Historical investigation entries below describe their then-current state, including earlier pending review/reload/commit statements; this header supersedes them.

## Evidence and source ownership

### F-DD100 — technical follow-up to F-DD71

Observed defect, inherited candidate-copy-check path. Independent `critic_artifacts/cleanup_started.png` visibly shows an automatic check notification covering the Book header with the complete edit prompt, method, picture label and candidate ID. The matching complete DOM text is retained in `critic_artifacts/cleanup_started.json`. Native submission and provider results are retained in `logs/cleanup_submit.json` and `logs/cleanup_candidates.json` for decision `cand-mw8jnq9y-gyx6`.

The persisted native decision contains the whole separate question, “Does the clean shutter keep the stall exactly the same?”, plus the full `title`, `options.prompt`, ordered context, model, seeds, output paths and scores. Its record is `base/user/default/snap/candidates/cand-mw8jnq9y-gyx6.json`. `contextCopies()` in `web/snap/edits.js` currently inserts `d.title` into the queued check job title; the existing arrival handler in `web/snap/view.js` displays that title unchanged. This establishes the producer as the smallest owner; no notification framework change is needed.

Applied behavior: the title is `Checking reference matches` followed by ` · ` and the entire `d.question` when one exists. It contains no prompt, model name or raw candidate ID. With no question it remains `Checking reference matches`. `about.decision`, `about.candidate`, attribution, graph, score processing, decision/take records and full provenance are unchanged. The module header names the governing existing R4/R65/R179 IDs; no new rule or character cap.

The existing Open route and full details are outside this patch. The reviewer tested the parent aisle-decision's Open, which opened its source take and sidebar candidates/applied result. Actual automatic-check Work rows expose only Park; the earlier arrival toast had expired, so no automatic-check toast Open was clicked. The patch preserves that contract exactly and does not claim a tested automatic-check Open action. Post-reload notification behavior will be observed on the next authorized board jobs.

### F-DD101 — technical follow-up to F-DD01

Studio reproduced the first-style attachment directly on the native lab: `set_book_style` attaches a style without a proposal when the Book has no style. The current help says every agent call waits as canon. The implementation already checks `b.body.style`; `save_style` already documents the exception.

Applied behavior: corrected only the `set_book_style` description in `web/snap/booktools.js`: the first style sets directly when the Book has no style; changing an existing style is canon and waits as an agent proposal. The condition concerns absence of a style, not absence of beats, cuts or other Book content. No approval policy, function, schema or persistence changes.

## Validation and limits

- Source head at investigation: clean `c641cf2` on `snap-research-2026-11-08`.
- Read the actual screenshot, matching DOM text, native provider results and persisted decision; this is not a source-only wishlist.
- Both changed files pass module syntax checks (`node --input-type=module --check < web/snap/edits.js` and the same for `web/snap/booktools.js`). `git diff --check` passes; the inspected exact diff contains only the two user-facing strings and one rule-header line (2 files, 3 insertions, 2 deletions).
- Baseline reproduction passed through the real `view.finish → contextCopies` functions from the unchanged module using `check_copy_title.mjs` and the actual cleanup decision. For the supplied 55-character question, absent question and 28,800-character question, all three queued the same 580-character title containing the generation prompt. The complete decision, graph references, attribution and returned scores were unchanged. This check uses only synthetic module dependencies and makes no network or native writes.
- Fixed pass: all three actual-function cases pass. The supplied question produces an 84-character title; no question produces the 26-character status; the whole 28,800-character question produces 28,829 characters, with no cap. Every case also asserts unchanged decision/context/prompt, graph references, attribution, `about` identity fields, scores and copy/framing notes.
- Existing `test_u101_fc.js` covers copy-score behavior, but launches headless Chrome and writes fixture records; it will not be run against the active dogfood lab under the explicit no-headless/no-page-interference scope. No full gate is planned for two user-facing strings.
- Real post-reload notification and Work/Open validation remains with studio/reviewer and requires a subsequent native job. Existing persisted job titles will not be rewritten.
- Adjacent face-check titles also interpolate `d.title`; that is a source observation, not an independently reproduced finding or part of this patch. Report it if an actual board job exposes the same issue.

## Applied diff

```diff
diff --git a/web/snap/edits.js b/web/snap/edits.js
--- a/web/snap/edits.js
+++ b/web/snap/edits.js
@@
 // SNAP-R23 candidates · SNAP-R51 change something, recast, pins · SNAP-R71 a new view from context, in the asker's words ·
+// SNAP-R4 check titles use the person's question · SNAP-R65 checks stay visible · SNAP-R179 candidate questions ·
 // SNAP-R72 what Picture 1 is, per model · SNAP-R75 the view slot's models are data (P-H3-Image, H3 still, explicit Qwen 2.1) ·
@@
-    const h = await K.screen(g, { title: `Copy check: did ${c.id} of ${d.title} copy one of its pictures?`, about: { decision: d.id, candidate: c.id }, by: d.by === "agent" ? "agent" : "person" });
+    const h = await K.screen(g, { title: `Checking reference matches${d.question ? ` · ${d.question}` : ""}`, about: { decision: d.id, candidate: c.id }, by: d.by === "agent" ? "agent" : "person" });
diff --git a/web/snap/booktools.js b/web/snap/booktools.js
--- a/web/snap/booktools.js
+++ b/web/snap/booktools.js
@@
-    description: "Point a Book at another production style (look:<id>): canon, so from an agent it waits as a proposal.",
+    description: "Point a Book at a production style (look:<id>): when the Book has no style, its first style is set directly; changing an existing style is canon and from an agent waits as a proposal.",
```

## Activity

- 2026-11-08: Hydrated project/pickup, source agent rules, core skill, the requested design rules and current dogfood evidence. Confirmed the smallest two owners and received root ownership approval. Studio explicitly requested waiting for the current batch/checks/claims; no source edits yet.
- 2026-11-08: Prepared and ran the isolated actual-function baseline check (3/3 reproduced); retained the script locally for the fixed pass. No GPU, browser or service work.
- 2026-11-08: Root confirmed studio's empty queue/checks and saved Book/recipe; reviewer finished the Open probe and explicitly released the page. Applied the two owned source files only, then passed module syntax 2/2, `git diff --check`, exact diff inspection and fixed producer checks 3/3. Root and studio notified. No commit or reload by this worker.

## F-DD102 — follow-up investigation of observed F-DD72

Root requested a second narrow fix after actual native clicks established the gap. `work_before_open.png` visibly shows completed copy checks with Park only, while the parent decision has Open. The reviewer clicked that decision's Open: `parent_decision_opened.png` and its complete DOM/native read establish source Take 6, although the applied candidate is c2 / Take 8. No automatic toast Open was tested.

Source cause: `web/snap/workview.js`'s Open predicate accepts `r.decision` but omits `r.about.decision`; check rows carry the latter. `web/snap/view.js`'s `openJob()` only resolves `r.result.take` or `r.about.take`, so the parent decision goes to its source. Native decision `cand-mw8k4ecm-2oc9` already retains explicit c1 / Take 7, c2 / Take 8 and `applied.undo.take` / Take 8. No missing persistence field or new API is needed.

Root approved and assigned `view.js` and `workview.js`; studio reconfirmed saved/idle/released with no jobs or claims. The applied route uses `about.decision` only for check jobs. An explicit check opens its own candidate take even if another candidate was picked; a parent uses the existing public `edits.result()` resolver for its applied take, then its selected candidate take. An unpicked decision or painted candidate with no take opens the existing `candidatesEl` component in native sheet classes, focusing the explicit candidate. Missing decision/candidate reports a clear unavailable result instead of opening the source. Ordinary take/propagation, plate, blind-pair, proposal and Astrid routes, account guard, full records and native actions remain. Work adds check `about.decision` to its Open predicate. Candidate choices update only when content changes and after pointer release (R7).

Verified the complete real aisle decision and Take 6/7/8 records: `applied.undo.take` is the new Take 8, not the source Take 6. `retake.takeCandidate.apply()` returns the new result as `take` and keeps old active state separately as `was`; `edits.propagate()` also currently returns `take`. No unused `prompt_id` compatibility branch was added, and the UI reuses `edits.result()` instead of interpreting undo fields itself.

`check_work_routes.mjs` executes the actual private `openJob()` and actual public result resolver, builds row shapes with the actual `activity.fromDecision/fromPrompt` functions, uses full persisted Takes 6/7/8, and consumes the complete native check job rows in `uxfix_work_jobs_before.json` (16 total jobs, two relevant checks). Baseline reproduced parent → source and two unresolved checks (3/3). Fixed pass: 14/14, covering both explicit checks, applied parent, candidate choices/focus, R7 redraw timing, propagated result, missing records without source fallback, normal run/propagation precedence, owning-shot navigation, blind/proposal/plate routes, actual Work Open rendering/callback and another-account exclusion. Full result: `uxfix_work_routes_result.json`. Both route files pass ES-module syntax; `git diff --check` passes. No network/native writes inside the harness. Its first renderer run lacked the stub API export; that harness-only setup error was corrected before the passing run.

Native verification is pending on the already-completed jobs: c1 check `736b7344-676c-4a68-a298-16de4d935b3f` → Take 7; c2 `bbdec3a1-e5cd-4ccb-8660-70429a07d277` → Take 8; applied parent decision → Take 8. No new GPU job is required or authorized solely for verification. New title appearance still waits for a next authorized board job; stored historical titles are retained unchanged.

The reviewer's earlier parent Open may already have moved that parent to closed Work state (`activity.opened`), so it may be absent after reload. Do not rewrite opened marks/history for verification. An existing other landed applied parent can exercise the same native route if needed; identify its actual result and report the coverage precisely. The complete actual aisle fixture already proves its parent → Take 8 locally.

- 2026-11-08: Final local handoff: all four owned source files, complete diff artifact, title producer checks 3/3, routing/actual Work renderer checks 14/14, module syntax 4/4 and whitespace check pass. Studio owns second lab reload after root signal; reviewer owns already-completed job clicks. Final review/commit pending. No GPU, browser, settings or native content writes by this worker.

## F-DD103 — candidate-panel lifecycle correction from root review

Root's source review caught a real issue in the new fallback panel: its anonymous store callback survived closure, retaining the panel/decision/DOM, and a pointer released outside the body could leave refresh permanently held. The correction stays in `view.js`.

The panel now keeps the existing Set returned by `C.onChange()` and deletes its named draw callback at cleanup. Cleanup also removes its window capture handlers for pointer release/cancel, cancels a queued redraw, disconnects the temporary native DOM observer and clears candidate preview state. X/Escape clean up immediately. The observer covers removal by other existing UI paths and root disconnection. A release/cancel anywhere resets the pressed flag; redraw stays deferred until after the click event, preserving Apply. No producer API, compatibility branch, third-party dependency or UI framework was added.

Extended `check_work_routes.mjs` to model the actual returned Set, window listeners, DOM disconnection and observer callback. Fixed pass is now 20/20, retaining all previous routing/renderer cases and adding outside release/cancel, Apply click before redraw, close/Escape unsubscribe, sheet/root disconnect cleanup, preview clearing and queued-redraw cancellation. `uxfix_work_routes_result.json` and the complete `uxfix_source.diff` are updated. Final source scope is still four files (36 insertions, 8 deletions); the lifecycle correction itself touched only `view.js`. Module syntax and `git diff --check` pass.

Studio's user-authorized Book-acceptance hold arrived just after the source edit; no reload or page action occurred. Further source edits/reload were held while p1–p5 were applied. Studio subsequently confirmed their persistence and no queued boards/jobs. Root final review precedes commit; studio will coordinate the final lab-only reload. A reviewer open/close of one existing unpicked decision is the remaining native lifecycle check if available; no GPU job is needed.
