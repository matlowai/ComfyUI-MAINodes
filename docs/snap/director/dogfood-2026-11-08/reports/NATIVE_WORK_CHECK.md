# Native Work check — READ FIRST

Status: COMPLETE, 2026-11-08 21:38 EST. Actual Work routing passed. F-DD130 was reproduced, corrected by root, and passed the focused native retest. Page released; final lab queue empty. Dedicated lab8291 only; existing visible CDP43471/page b2cbcc78828c416c854eba377cd94c21. Identity director-work-check. First-pass source code a4dc2a790517 (application476d4f2); final focus-fix code fa82fc1568a0. Desired WIP was HEAD634f479 at start; root owns the new source commit. Main8193 untouched. No new jobs, picks, approvals, settings or canon edits authorized for this bounded UI qualification.

Own files: this report and native_work_check/. Finding range F-DD130–149. Source edits belong to root. Existing completed jobs are used; opened marks and historical records must not be rewritten for evidence.

## Verification plan

- Old persistent Work copy check c1 736b7344-676c-4a68-a298-16de4d935b3f must open Take7/take-6e3962c0.
- Old persistent Work copy check c2 bbdec3a1-e5cd-4ccb-8660-70429a07d277 must open Take8/take-3e9f5038.
- Applied parent cand-mw8k4ecm-2oc9 must open Take8 if still available natively; otherwise use an existing applied decision and state substitution.
- Unpicked C1 decision cand-mw8lt6tk-uxux must open candidate fallback, close via X and Escape, and remain usable after pointer release outside. No Apply/pick.
- Capture screenshots, complete DOM and public native state; distinguish observable browser behavior from internal listener cleanup, which has CPU harness coverage only.

## Dated activity

- 2026-11-08: Read project/pickup/current handoffs, UX findings and patch report, canonical core/Director skills and relevant full ownership/Work/rules sections. Confirmed existing lab code a4dc2a790517 and empty raw queue. Existing visible browser target is present; no browser/page launched or reloaded.

- 2026-11-08 21:31–21:32 EST: Actual native Work Open for historical c1 check opened Take7/seed11087, and c2 check opened Take8/seed11088. Both screenshots inspected; full DOM and public read_ui retained. Aisle parent remains closed with its historical 01:10:32Z opened timestamp; no marks rewritten.

- 2026-11-08 21:33 EST: Applied-parent substitution passed. The already-opened aisle parent remains closed; native cleanup parent cand-mw8jnq9y-gyx6 was still landed and applied c2. Its real Work Open showed clean Take2/seed11082 (take-92f8f7d1-e8ee-4f08-8260-924b40040715), not its original source. Public list_candidates supplies exact identity and applied status.
- 2026-11-08 21:33–21:35 EST: Same unpicked C1 Work parent opened the native candidate fallback with both candidates, no picks. Actual mouse press inside body, move outside and release left panel open; normal X closed it and public read_ui showed no sheet. Reopening and immediately pressing Escape left the panel open with activeElement BODY: F-DD130. Closed through X and released page; final queue empty, driver null. Root notified immediately and owns correction.

## Actual first-pass results

| Case | Browser result | Evidence |
|---|---|---|
| Historical c1 check Work Open | PASS: Take7, seed11087, the expected paving-floor candidate | c1_open_click.json, c1_opened.png/.json, c1_opened_ui.json |
| Historical c2 check Work Open | PASS: Take8, seed11088, the expected wood-floor candidate | c2_open_click.json, c2_opened.png/.json, c2_opened_ui.json |
| Applied parent Work Open | PASS with explicit substitution: cleanup parent cand-mw8jnq9y-gyx6 opens applied Take2/seed11082 | parent_cleanup_candidates.json, parent_open_click.json, parent_opened.png/.json, parent_opened_ui.json |
| Original aisle applied parent | UNAVAILABLE in native Work: already closed before this run at original 01:10:32.275Z; no opened marks rewritten | initial_activity.json |
| Unpicked C1 parent fallback | PASS: both c1/seed11101 and c2/seed11102 shown as not picked | fallback_open_click.json, fallback_opened.png/.json, fallback_opened_ui.json |
| Outside pointer release + X | Observable PASS: native mouse press inside body, drag/release outside; panel remains, then actual X closes; no sheet in native read_ui | outside_release.json, fallback_after_release.png/.json, fallback_x_click.json, fallback_after_x.png/.json, fallback_after_x_ui.json |
| Fresh unpicked fallback Escape | FAIL F-DD130: panel stays open, focus BODY | fallback_reopen_click.json, fallback_escape.json, fallback_after_escape.png/.json, fallback_after_escape_ui.json, escape_state.json |
| Final close/release/idle | PASS: actual X closes, fallback/work/take DOM counts0; driver null, queue empty | fallback_final_x_click.json, final_dom_state.json, release.json, final_pages.json, final_queue.json |

## F-DD130 — fresh unpicked candidate panel does not receive Escape

Observed native bug, low interaction friction. On current loaded code a4dc2a790517, Work Open for unpicked C1 decision cand-mw8lt6tk-uxux creates the native Candidates panel but leaves document.activeElement on BODY. Without clicking inside it, actual CDP keyboard Escape keydown/up does not close it. Candidate fallback count remains1 and native read_ui still names the question sheet. X then closes normally.

Reproduction: Work → “Does Mio begin with the bowl in her left hand?” → Open → immediately Escape. No candidate selection or data modification is involved. Exact action at02:34:27.757Z; resulting state at02:34:29.616Z. Screenshot inspected as a product. The root source owner was informed immediately.

Smallest source owner: web/snap/view.js openJob fallback. It appends a tabindex=-1 sheet but focuses only when an explicit candidate c exists. An unpicked parent has no c. Focus the appended sheet first, preserving existing candidate focus when applicable. No code edited by this reviewer.

## Coverage limits

- This is actual existing visible Chrome/native UI input and public native state, separate from the CPU harness.
- The outside-release case establishes visible behavior and close usability. No new arrival changed candidate data while the pointer was down; dynamic redraw deferral/reset is not empirically qualified here.
- Internal store unsubscribe, observer disconnection, listener removal, queued-redraw cancellation and forced DOM/root disconnection were not directly inspected or artificially triggered. Their existing20-case source harness remains separate evidence.
- No Apply/Reject/Keep, pick, proposal acceptance, canon change, settings change, new render/check job, browser launch/reload, main navigation or service action occurred in the first pass. UI opened marks changed naturally from the actual Open clicks. Historical titles and closed marks were preserved.
- Production remains unfinished; this report gives no board/art approval, animatic/video/export or perceptual audio qualification.

## Pending focused retest

Root is correcting F-DD130. Await explicit source-ready/reload signal; then bind same page, verify new loaded code, use same unpicked C1 parent and test fresh Escape plus X. Preserve all first-pass failure evidence. No GPU work required.

## Focused correction retest — complete

Root applied one focus line in view.js, then authorized the existing lab page reload. At02:37:12Z this reviewer bound the same page and issued Page.reload(ignoreCache:true) to that existing target only. The reload returned the normal ComfyUI Graph because the current URL had no ?snap query; a real click on its visible Snap control reopened Snap. No page/tab launched, no server restarted and no recipe/content edit performed. New serving code **fa82fc1568a0**, public page **code_current:true**. Source view.js SHA256 is recorded in retest_source_hash.json.

| Retest | Actual result | Evidence |
|---|---|---|
| Same unpicked C1 Work Open | PASS: activeElement is DIV .snap-sheet.snap-setup-sheet.snap-work-candidates, aria-label Candidates | retest_fallback_open_click.json, retest_focused_state.json, retest_fallback_focused.png/.json |
| Fresh Escape before any inside click | PASS at02:38:29.959Z: panel removed, fallbackCount0 and Snap root focused | retest_fresh_escape.json, retest_after_escape.png/.json, retest_after_escape_state.json |
| Reopen, pointer down inside → release outside → X | Observable PASS: all fallback/Work/take DOM counts0, Snap root focused | retest_x_open_click.json, retest_outside_release.json, retest_x_close_click.json, retest_final_dom_state.json |
| Release and idle | PASS at02:38:32Z: driven_by null, code_current true, both lab queues empty | retest_release.json, retest_final_pages.json, retest_final_queue.json |

The screenshot after Escape was inspected and shows the ordinary Snap view without a candidate sheet. The public retest_after_escape_ui.json call completed asynchronously after Work had been reopened for the X case, so it truthfully reports Work and is **not** cited as proof of the just-closed state. Full receipt is retained. The immediate DOM state and screenshot provide the actual Escape proof. First-pass failure screenshots/DOM/actions remain preserved; no failed evidence deleted or rewritten.

F-DD130 is resolved on loaded code fa82fc1568a0. Internal listener/store cleanup and dynamic-arrival redraw remain harness-only coverage; no broader qualification inferred from this bounded interaction run. Root/studio informed that the page was free immediately after release; production may continue. No commit or push by this reviewer.
