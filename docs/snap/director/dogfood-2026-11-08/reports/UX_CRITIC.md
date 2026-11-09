# Director dogfood — independent UX and picture review

READ FIRST: 2026-11-08 21:15 EST checkpoint. Story5/style2 are approved by the person; do not reuse historical pending-canon wording below. Twelve takes have formal reviews: eight preparation takes plus four current board candidates. Both C1 candidates are CLEAN; C2 native board has one HIGH facing failure; C2 region correction has one MEDIUM visibly confirmed seam. **All four current board candidates remain unpicked.** No animatic/video/export or person board-look approval. Reviewer claims are finished and page release succeeded at 02:09:08Z; final native receipt confirms zero claims and no driver. Source checkpoint code is `a4dc2a790517` (complete info/hashes under `critic_artifacts/boards_review/`). Final UI is the C2 native Take1 viewer in A small kindness / Shot2, reached by the actually clicked new concise copy-check toast. Old Work7/8, applied-parent8 and unpicked fallback/lifecycle routes remain untested after the fix. No further navigation, tests or jobs after the context-checkpoint request. Resume from `critic_artifacts/HANDOFF.md` and studio HANDOFF; main :8193 untouched.

## Evidence checklist

| Milestone | Evidence required | Status |
|---|---|---|
| Director entry and current context | Actual dialog screenshot, selected Book/scope/defaults, names versus raw IDs/JSON | Observed; F-DD70 |
| Story and style review | Native proposal route, readable diff and next action, persisted waiting state | Historical waiting rows observed; person subsequently approved story5/style2; reviewer accepted nothing |
| Native job lifecycle | Started/progress/ready/failed on subject and Work, arrival route to result | New concise title and actual check-toast Open→C2 board validated; old Work/parent/fallback routes pending; sampling start unobserved |
| Boards | Opening versus key role, selected board versus active video, actual whole pictures | Four C1/C2 candidates reviewed; all unpicked; C2 repair remains |
| Critic handoff | Explicit studio release, own binding, claim → packet → verdict → release | Twelve rows complete; released |
| Replanning | Actual accepted/current IDs, dependency and stale-cut visibility | Pending |
| Animatic | Person's look required before video; cut-pair action phase/prop/camera checks | Pending |
| Cut/export | Native playback/export/provenance, actual selected trim boundary, sound listening coverage | Pending |

## Review constraints

- Findings F-DD70–F-DD99 belong to this report. Each finding records fact/advisory/unresolved, reproduction, evidence, owner and smallest useful fix.
- Actual docket review uses the unchanged serving critic skill: every whole frame first, native tiles, context, counts and sound packet. No invented horizon, scale calibration or hidden geometry.
- Top plus genuine side reference coverage must be evidenced; prefer two sides. Crops are not additional views.
- ASR, waveform and metadata are not listening. Audio perceptual review is unperformed unless audio is actually available and heard.
- Prior blind critic result (26/31 caught + one false alarm) is a separate existing qualification failure, not a new Director regression.

## Observations and findings

### F-DD70 — ordinary Director choices require record IDs and JSON

**Fact, medium UX friction.** In the actual Dialogue Director preview for **On the House**, the production field displays only `book:book-mw8ji71lvzcx`, and the requested minimal coverage/eight-second target is entered as `{"coverage":"minimal","target_seconds":8}` in the primary form. There is no readable Book name in that selected-context field. A person must obtain an internal identity and know parameter keys before making these ordinary choices. The preview itself correctly says no execution started and warns that waiting canon must be settled first.

- Reproduce: open Production strategies on the native lab, choose Dialogue Director, target the existing Book and request minimal coverage/eight seconds, then Preview plan.
- Evidence: `critic_artifacts/director_preview_observed.png` (independent screenshot) and matching complete DOM JSON; studio's native preview is independently observed, not inferred from code. Source confirmation identifies `web/snap/director/dialog.mjs:54–57` as the owning form.
- Smallest response: select the Book by its current name from native records, showing the resolved identity secondarily; expose the common coverage and target duration choices as normal fields, retaining raw JSON in Advanced. No extra authority or execution system is needed.
- Advisory implementation choice, not a claim that the current agent tool contract fails. No source changed by this reviewer.

### Director preview and proposal observations

- `director_preview_observed.png`: the preview explicitly reports **CANON_PENDING**, does not treat proposed beats as accepted, and labels generation/critique/export as work needing review. `voices — skipped` refers specifically to the currently empty accepted story; it is not evidence of lost voice casting.
- Native Work contains three waiting proposal rows, with individual Accept/Reject and an Open Book route in the Director dialog. No acceptance by this reviewer.
- First-style behavior is owned by studio finding F-DD01; this report does not duplicate its ID or claim an unobserved first-style call.

### F-DD71 — automatic check notification exposes the full generation prompt

**Fact, low UX noise; inherited native job path, not established as a Director regression.** While the person is reading the Book's three waiting proposals, the automatic copy check announces itself with the candidate number, model/method title and the complete edit prompt. Its large notification covers the Book header. The supplied human question exists (`nearby`: “Does the clean shutter keep the stall exactly the same?”) but does not organize this check announcement.

- Reproduce: native New view targeted cleanup with two candidates and the supplied human question; leave the Book Beat sheet open as each automatic copy check queues.
- Evidence: `critic_artifacts/cleanup_started.png` and complete DOM JSON, plus native decision `cand-mw8jnq9y-gyx6` and check job `6ead1239-299e-4747-a6a1-a3947be24bdc` observed running. The top button still says **Rendering 100%** while this copy check runs; this is a secondary status observation, not a proven wrong terminal state.
- Owner: native check job titles and arrival/queue notification rendering. Smallest response: show a short outcome-oriented check label and source question, with the full prompt available in details; preserve complete API/agent data. Keep the existing Work action, which is present.
- Lifecycle coverage: actual checking/in-flight state and landed take cards observed; the GPU sampling start happened before this capture, so no claim that sampling progress was independently watched.

### F-DD72 — completed copy checks have no Work result action

**Fact, medium UX gap; inherited native path.** Root requested an actual completed copy-check Open test. With explicit studio release, the reviewer bound its own identity, visibly closed the Book, and clicked Work. Every finished automatic copy-check row exposed **Park only**, with no Open action. The earlier arrival toast had expired, so its Open was not clicked; no new job or synthetic notification was created. This establishes the missing persistent Work action, not the behavior of the transient toast target.

- Reproduce: finish a New view candidate pair and its automatic checks, allow toast to expire, open Work. Latest checks of decision `cand-mw8k4ecm-2oc9` show done but no result action.
- Evidence: `critic_artifacts/work_before_open.png` and full DOM JSON; actual pointer clicks at 01:09:35Z closed Book and opened Work. No source-only conclusion.
- Owner/smallest response: native Work navigation should resolve a check's `about.decision` + `about.candidate` to its actual candidate/result and expose the same direct action after the toast expires. Preserve existing job identities and complete data.
- **Observed fallback:** at 01:10:32Z the reviewer actually clicked the adjacent parent decision's Open (“Is there now a clear working aisle behind the serving counter?”, done / c2 applied). It opened **Take 6**, the old Qwen source with a medium floor-strip flaw; candidates Take 7/8 and the applied `c2 → Take 8` link are farther down its sidebar. Thus the results are reachable, but the first large image is the flawed source rather than the applied correction. `parent_decision_opened.png` / JSON and native `read_ui` establish the exact target. Consider focusing the applied candidate when opening a completed decision, while retaining its source in context.
- Final view at handoff: Take 6 viewer, Unsaved Workflow scratch, no scene; page released. No proposal acceptance, pick, graph edit or new job in this probe. Studio and fixer informed before reload.

### Initial native state (observed, not a finding)

- `critic_artifacts/initial.png` and `director_entry.png`: onboarding covers the viewport. Read-only DOM already contains the new Book and its first waiting beat proposal underneath. This is a fresh isolated profile; the studio has been told to dismiss onboarding when ready. Do not call a hidden DOM toast a visible defect.
- Native `get_book` confirms `book:book-mw8ji71lvzcx@1`, **On the House**, empty accepted story, two waiting stacked beat proposals `p1`/`p2`, no selected cuts or accepted Cast/location list yet. Proposal status is waiting, not canon.
- Native read-only `instructions` and `read_skill` calls work while `director-studio` retains the page; all six relevant serving skills exactly match the full canonical versions read, with no person overrides. Full returned skill packets retained in `critic_artifacts/`.
- Observational CDP script attaches only to the existing :8291 target and issues screenshot plus DOM reads; no viewport resize, navigation, clicks or new page.

## Formal cleanup review — complete, page released

Decision `cand-mw8jnq9y-gyx6`; original supplied as `input/snap/director_sources/take-c285ecf3-902e-4c30-b387-97ee04feeec0_f0.png`. Both stills inspected whole at native resolution before both native tiles, all four generated difference zooms, and the original context. Serving unchanged critic and its edit checklist used. `nearby` confirms scratch New view candidates, not selected production boards. No picks, approval or canon writes.

| Candidate | Native critique | Result |
|---|---|---|
| c1, seed 11081, `take-c2565f5b-cf25-4dd3-9c6f-022a94e5419a` | `crit-1a1bdc8c338-a881` | FLAWS, one low: additionally removes red circular detail below pot, beyond requested green/purple/yellow patch cleanup. Function of that detail is uncertain; no knob claim. |
| c2, seed 11082, `take-92f8f7d1-e8ee-4f08-8260-924b40040715` | `crit-1a1bdc8eb4f-eb1e` | CLEAN: requested patches removed, red detail retained; no physical/design inconsistency established. |

Both retain zero people, one red lantern, one stockpot, three visible cropped stool tops, the roof/counter layout and the camera composition. No scale anchor or calibrated horizon exists in these edit packets; no metric inference. C2 is the closer match to the requested edit scope by eye, independently of copy scores. Still images have no listening requirement; film/audio review remains pending.

Full native rows and the 16 packet images are retained under `critic_artifacts/cleanup_review/`. Explicit studio release preceded binding; claim/write sequence recorded under `director-ux-critic`; `use_page {page:null}` succeeded at 19:53 EST. Studio notified before resuming.

## First derived-top pair — failed, page released

Decision `cand-mw8jskn0-sqfr`, source clean side `take-92f8f7d1`. Both subjects read whole before two native tiles and source context, with `nearby` provenance. Both are settei attempts rather than measured geometry.

| Candidate | Native critique | Result |
|---|---|---|
| c1 seed 11083, `take-edc9b726-e5b6-48c7-a7a2-34e5f0f93719` | `crit-1a1bdcc25b9-737e` | FLAWS, one high: tiled roof remains; elevated front view instead of roofless straight-down layout. |
| c2 seed 11084, `take-06ab938d-17fc-4161-b660-ca2dc381dc74` | `crit-1a1bdcc4270-12ec` | FLAWS, one high: roof remains; nearly frontal elevation instead of requested top. |

Both preserve zero people, three stools, one lantern, one pot and coarse left/right order. Neither fills the missing top coverage. No hidden-depth or metric claim. Studio independently saw this failure and will change method after the two failed seeds; no candidate selected by reviewer. Eight packet images plus native verdict rows retained in `critic_artifacts/ph3_top_review/`. Page release confirmed at 19:55:58 EST and studio notified.

## Qwen derived-top pair — top achieved, standing-strip gap

Decision `cand-mw8jwk7v-3t2w`, source clean side `take-92f8f7d1`. Same whole → two native tiles → source context order, unchanged settei checklist and `nearby` provenance.

| Candidate | Native critique | Result |
|---|---|---|
| c1 seed 11085, `take-631ed902-fcbe-48c2-844b-98c5b6344e8f` | `crit-1a1bdcf30e9-7650` | FLAWS, one medium: interior reads as closely packed wood surfaces and thin dark slot; requested clear cook standing strip is not exposed. |
| c2 seed 11086, `take-4cc20d99-7bec-4d6c-bd2a-8f1fb4d612f4` | `crit-1a1bdcf7dc7-aba4` | FLAWS, one medium: broad countertop fills visible interior toward shutter, leaving a thin floor slit. |

Both achieve a roofless overhead, with zero people, three stools, lantern left, pot right and shutter rear. The medium notes concern the usability of the requested staging reference, not style preference or a measured impossibility. The original side hides floor depth; exact footprint/clearance remain unresolved. Studio independently identified the same functional gap and plans an edit of the actual top canvas to clarify floor versus counter, with inferred depth labeled. No reviewer selection or canon change. Eight packet images and complete native verdict rows retained in `critic_artifacts/qwen_top_review/`. Page released at 20:02:22 EST; studio resumed.

Nearby observation, **not a confirmed provenance defect**: the source tile says `take 2 (view/qwen21_view)` because the parentheses describe the child operation (`nearby.js:260`), while take 2 itself was made by P-H3. The wording can be read ambiguously, but no incorrect source-model metadata claim is made.

## Floor-strip correction — reviewed, page released

Decision `cand-mw8k4ecm-2oc9`, top canvas `take-4cc20d99` plus clean side `take-92f8f7d1`. Whole → native tiles and generated difference zooms → both source contexts; unchanged edit checklist; native provenance read. Fifteen packet images and complete verdict rows retained in `critic_artifacts/aisle_review/`.

| Candidate | Native critique | Result |
|---|---|---|
| c1 seed 11087, `take-6e3962c0-2df9-456c-ab8b-72225ed3ab2d` | `crit-1a1bdd4a8ca-a98d` | FLAWS, one low: exposed floor is paving slabs rather than requested dark wooden planks. Standing-strip separation now works. |
| c2 seed 11088, `take-3e9f5038-ebed-4382-906c-7da233f7f543` | `crit-1a1bdd4d73d-0124` | CLEAN for targeted edit: dark plank strip clearly distinct from slim counter, with zero people, three stools, one lantern, one pot and original exterior arrangement retained. |

The clean verdict qualifies the explicitly inferred workspace design against its request and sources; it does not establish the exact original hidden floor, measured clearance or complete rear access. No reviewer selection, canon acceptance or production approval. Page released at 20:07 EST and studio notified. No story-dependent board/video/export has yet been reviewed.

## Source set review — bounded observations

Read full exact-version record snapshot in `asset_current_records_and_hashes.json`; independently viewed every @9 location image (master, schematic plan, P1 street, P2 counter, P3 reverse, P1b) whole, plus Mio @2 front, Kuroe @5 front/back and source frame f89. Current P1b has useful clear counter staging with lantern left/pot right and three stools, but the old roof/noren master and reverse cannot establish the newer open-canopy look from every side. The schematic plan is not a textured top. This supports scout F-DD50/F-DD51; no duplicate finding ID is assigned. @9 has no scale anchors and labels poses as estimated, so dimensions and working clearance behind the crop remain unresolved. Source f89 visibly has two people, one double-blue-rim bowl in Mio left hand, and one ladle in her right. Kuroe faces the cook from the foreground middle stool; facial detail is partly hidden by the rear three-quarter angle.

## Additional lifecycle evidence

`critic_artifacts/cleanup_reviewed.png` / JSON records imported Cast names resolving in the Book, completed cleanup takes with native critic chips, newly landed top attempts and their automatic copy-check **done / Open** arrival. The top-level control has returned to Run with zero active jobs. The old cleanup candidate reads stale with an explicit native reason **another candidate (c2) was picked**; its critique remains retained, not overwritten. That transient arrival Open was not clicked; the later manual Work/decision-navigation probe is recorded under F-DD72. Reload survival remains untested here.

## Activity

- 2026-11-08 initial preparation: Read project/pickup/current handoff and canonical core, Director, Book, boards, critic, set-design and agent entrypoint guidance. Confirmed live lab skill route answers. Prepared read-only milestone audit before any page binding.
- 2026-11-08 19:51–20:07: Four explicit studio handoffs, eight formal native critiques, complete packet archives, four page releases.
- 2026-11-08 20:09–20:10: Root-requested actual Work/decision navigation probe; F-DD72 recorded; page released before source fix/reload.

## Approved-story board review checkpoint — 21:09 EST

Book `book:book-mw8ji71lvzcx`, story `story:story-mw8ji71a9bly@5`, style2; scene `scene-mw8khsydsspo`. C1 shot `shot-mw8khsyq37mx`; C2 shot `shot-mw8kic4gqbh2`. All are still candidates, frame0 only. The packet explicitly labels C1 cleanup and C2 region edit as edits; reviewer additionally checked board opening phase and prop counts. C1/region `nearby.beat.pinned:false`; native C2 board `pinned:true`. World/source provenance remains in full packets; do not equate scene membership with a story pin.

| Cut/candidate | Take and output under lab `base/output/snap_views/` | Native critique | Verdict / source owner |
|---|---|---|---|
| C1 c1 seed11101 | `take-3930e8d1-06e5-4b2b-9d5e-a419d6a51062`; `f4295406_00001_.png` | `crit-1a1be00423c-f1b7` | CLEAN; bowl1 in Mio LEFT, ladle1 RIGHT, two people, Kuroe rear-facing, counter bare. |
| C1 c2 seed11102 | `take-679dd7cc-e75c-4017-bee7-df2cf31569dd`; `f4295406_00002_.png` | `crit-1a1be00b9f8-553d` | CLEAN; same correct opening phase/counts and protected facing. |
| C2 native c1 seed11103 | `take-3a19aa9a-c2f7-48dd-8a23-937aec206e7b`; `95b54bac_00001_.png` | `crit-1a1be028907-b024` | FLAWS, HIGH beat; Kuroe turns face/chest toward camera against rear-three-quarter staging. Region `[0.26,0.12,0.38,0.88]`, picture0, owner **this take**. Bowl1 counter/left empty/right ladle and no lettering otherwise hold. |
| C2 region c1 seed11104 | `take-b4ca10dd-f34b-4e4b-b4c5-a49c536cfdfd`; `95b54bac_00002_.png` | `crit-1a1be06a642-c9e7` | FLAWS, MEDIUM cross_view; visible horizontal paste seam through upper apron/right-hand area and sleeve mismatch at right crop edge. Region `[0.585,0.405,0.215,0.1]`, picture0, owner **this take/edit**. |

Decisions: C1 `cand-mw8lt6tk-uxux`; native C2 `cand-mw8luu2b-wxsd`; C2 region `cand-mw8m2mcu-w5ge`. No reviewer pick, approved board, active video or person board-look approval. C1 c2 is only a provisional source for the region correction, not an accepted board.

**C2 seam actually inspected:** whole frame before both native tiles and crop-edge zoom; original model crop `[1203,591,819,535]` and its whole C1 source compared. The top pasted boundary visibly doubles/misaligns apron/hand/sleeve lines and creates a horizontal tonal edge; the right boundary steps the sleeve. The measured top/right flags and top strip `delta:-17.4` corroborate that visible observation, not the reverse. Body/head/facing outside the crop are preserved. Bowl1 rests on counter, Mio left hand is empty and separated, right hand still holds one ladle; it was redrawn inside the crop despite the request to preserve it. The flaw was born in this region edit, not the clean C1 source or Cast.

No actual selected C1 video trim-out exists, so the packet's `opens_on` instruction cannot yet be validated as frame equality. Do not claim a passed cut-pair/video continuity check from these boards. Still-image scope has no sound; film listening remains unperformed.

**Next review work on resume:** repair C2 crop/mask boundaries beyond crossing contours while keeping heads/Kuroe protected, then review the resulting actual seam and opening state. Resolve/pick boards using native authority, inspect animatic/cut pairs, and obtain the person's board look before video. C2 video must eventually open on selected C1 trim-out. No more renders were initiated by this reviewer or requested as part of this checkpoint.

## Post-fix UX validation — exact coverage

- **Validated on a real new job:** `board_arrival_postfix.png` + full DOM shows “Checking reference matches · Is the bowl on the counter before Kuroe asks?: done” with Open. This is the short human question, not the generation prompt. F-DD71's new-title path is visually improved; historical job titles remain historical.
- **Actually clicked at 01:54:00.211Z:** the above arrival Open. `board_check_toast_opened.png` records navigation in progress; `board_check_toast_settled.png` and native read_ui identify A small kindness / Shot2 / Take1 seed11103, the actual C2 board `take-3a19aa9a`. It moved from scratch to the owning shot and opened that candidate, not an unrelated source. The shot's default recipe tab was initialized by native navigation; no run or settings change was made by the reviewer. Studio was notified.
- **Pending, not assumed:** old persistent Work check c1→Take7 and c2→Take8, applied parent→Take8 after fix, unpicked decision fallback and close/pointer lifecycle. They were not exercised before the user requested checkpoint. Earlier pre-fix parent Open→source Take6 remains historical evidence under F-DD72. Root/fixer CPU results are separate claims, not native click passes by this reviewer.
- Final viewer remained the native C2 Take1. All current claims completed; `use_page {page:null}` release receipt key `snapcall-a8632aed70bebd02` succeeded. No human metadata spoof, canon acceptance, board pick, reload, new tab command or GPU job was performed by this reviewer.

Checkpoint verification is definitive: `critic_artifacts/boards_review/list_critiques_checkpoint.json` returns zero claimed rows, twelve done, and `page.driven_by:null`; the saved `read_ui_checkpoint.json` also reports no driver. Four complete current packets/receipts and 44 packet images are retained in that folder. Resume instructions and full exact-state map: `critic_artifacts/HANDOFF.md`.
