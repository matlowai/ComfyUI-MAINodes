# On the House — Director dogfood checkpoint

**Latest:** [follow-up verification and current work](FOLLOWUP_2026-11-08.md). The original context snapshot below predates these follow-up checks and the candidate-panel focus fix; its publication/pending statements describe that capture.

This production is unfinished. Its approved brief survives the context reset; no second story approval is needed. Use the latest WIP `snap-research-2026-11-08`. The published baseline is `c641cf2`; two later local commits are `1c976ee` (Book compiler) and `476d4f2` (check notifications and result navigation). This checkpoint does not publish or deploy them. Main remains `8542b92`.

## Approved brief and authority

The user answered **“Approve and apply in Book”** to the concrete eight-second brief. Studio applied p1–p5 through the visible native Book controls. Acceptance metadata truthfully names the agent that carried out the chat decision; it is not rewritten as person approval. Current canon is Story5/style2.

- C1: Mio lowers one white soup bowl with two blue rim stripes from her LEFT hand onto the counter, then withdraws that hand. Her ladle stays RIGHT.
- C2: Kuroe looks from the bowl toward Mio and says **“For me?”**; Mio smiles/nods. Bowl stays on the counter.
- Fine ink, restrained cel shading, painted wood/cloth, warm stall light against cool dusk, small gestures and calm front camera. Only Kuroe speaks. No music or added post sound effects.

Both cuts are 90 frames / 3.75 seconds under the native H3 length grid, for 7.5 seconds total. C1 inherits two candidates; C2 has a saved shot-scoped preference for one. C2 opens on the selected C1 out-frame. No camera change is needed.

## Exact records and current result

| Record | Identity |
|---|---|
| Book | `book:book-mw8ji71lvzcx` |
| Story | `story:story-mw8ji71a9bly@5` |
| Style | `look:look-mw8jlqlq767f@2` |
| Scene | `scene-mw8khsydsspo` |
| C1 | `shot-mw8khsyq37mx` |
| C2 | `shot-mw8kic4gqbh2` |
| Prepared location | `location:location-mw8kb2x2kc1p@1` |
| Mio / Kuroe | `cast:cast-mw5ig1ktoq32@2` / local `cast:cast-mw5ig1ny8ylr@7` |

Eight reference-preparation stills were reviewed: two clean, six with recorded flaws. The selected clean front and derived wooden-floor top preserve the visible counts. The top is an inferred workspace design, not calibrated geometry. Earlier master/reverse pictures disagree in look and are not treated as a coherent second side. The original f89 pose supplies the opening hand/prop/facing evidence; the clean front supplies set appearance. Top stays out of video conditioning.

Four provisional opening-board candidates exist; **none is picked or set as a board**:

| Candidate | Native decision / take | Final review |
|---|---|---|
| C1 c1 | `cand-mw8lt6tk-uxux` / `take-3930e8d1-06e5-4b2b-9d5e-a419d6a51062` | CLEAN |
| C1 c2 | same / `take-679dd7cc-e75c-4017-bee7-df2cf31569dd` | CLEAN; provisional C2 edit input only |
| C2 native board | `cand-mw8luu2b-wxsd` / `take-3a19aa9a-c2f7-48dd-8a23-937aec206e7b` | HIGH: Kuroe incorrectly faces camera |
| C2 region correction | `cand-mw8m2mcu-w5ge` / `take-b4ca10dd-f34b-4e4b-b4c5-a49c536cfdfd` | MEDIUM: visible top/right paste seam through Mio’s upper apron/right-hand/sleeve; bowl/facing correct |

All four formal reviews are complete. No animatic, production video, final MP4/OTIO or Astrid push exists. No final listening approval is claimed.

## Fixes and remaining gaps

`1c976ee` keeps exact dialogue/voice directives out of still prompts while retaining visible action, explicit written text, accepted canon and video speech. Book lint uses the relevant opening/transition state rather than comparing everything to the beat’s final ledger; genuine contradictions still warn and unknown initial state stays unknown. The permanent actual-module regression is registered in `tests/snap/run_all.sh`.

`476d4f2` gives reference checks the complete creator question, corrects first-style tool help, adds persistent check-result Open, routes checks to their own candidate and parent decisions to their applied result, and cleans up fallback candidate-panel listeners/previews/pointer state. Local checks passed: three title cases, twenty routing/renderer/lifecycle cases, module syntax and whitespace. The native lab also confirmed corrected C1/C2 compiles with raw Book/story/style bytes unchanged. Actual native navigation coverage and remaining probes are itemized in the review report; harness passes do not imply every click path was observed. No full gate rerun is claimed for these patches.

Open issues: ordinary Director fields still expose record IDs and JSON; version-qualified Cast IDs in Book units do not fold bare story-state entities; adapted `edit_from_context` takes lack native `make_board` story pins. The native C2 board carries Story5/from hashes, while C1 edits and C2 region history do not. Inspect normal `set_board` unit hashes and keep this provenance distinction; never rewrite history to invent creation-time pins. Existing saved-workflow/helper instruction-pin failures and below-floor blind critic qualification remain in the earlier verification matrix.

Kuroe7 preserves the original reference WAV and clears authoritative `voice.words`. The historical “One more bowl.” phrase is expected/unverified in a version note, not a hash-traced transcript or listening result. Main Kuroe5 remains unchanged.

## Resume without repeating work

1. Read the current local production HANDOFF, this checkpoint, reports and raw receipts. Recheck serving revision, page ownership, scoped instructions, accepted canon and empty queue. The local runtime is the dedicated GPU0 lab on port8291, visible Chrome CDP43471; main8193/GPU1 is separate. Machine configuration, raw media and local session logs are not included in this portable snapshot.
2. Repair the actual C2 region seam at its source using a crop past the crossing items, then formal critique. Change crop/method rather than fishing for more seeds. Preserve failed outputs.
3. Choose valid C1/C2 opening boards with native `set_board`, explicit opening role. Inspect returned unit state hashes and take provenance. No video active take exists yet.
4. Replan and make the native animatic; do cut-pair review and obtain the person’s look at boards/animatic before video. The earlier story approval is already settled.
5. After that look, apply the real Pika reference setup at six steps, inspect actual reference order/voice routing, render C1 candidates, review/select, replan/resume without duplicate work, then C2 from the selected C1 trim-out. Only C2 gets Kuroe’s voice reference. Test trim staleness.
6. Export native MP4/OTIO and inspect the actual export with explicit visual/listening coverage. No Astrid push is authorized here.

Raw native histories, complete prompts, metadata, failed candidates, screenshots and approval receipts remain in the local `director_dogfood_2026-11-08` study. Copied reports identify unshipped local evidence by relative name; those names are not claims that the media or runtime state exist in a cloud checkout. Snapshot manifest records source and sanitized-copy hashes.

## Retained notes

- [Exact production handoff](reports/HANDOFF.md), [approved brief](reports/STORY_REVIEW.md), [dated progress](reports/PROGRESS.md).
- [Lessons](reports/LESSONS.md), [production findings](reports/FINDINGS.md), [original asset scout with current corrections](reports/ASSET_SCOUT.md).
- [Independent picture and UX review](reports/UX_CRITIC.md), [UX fixes and validation limits](reports/UX_FIX_REPORT.md), [Book compiler fix and native receipts](reports/BOOK_COMPILE_FIX_REPORT.md).
- [Terra raw-session audit](reports/CONTEXT_AUDIT_TERRA.md): approval and task chronology verified against readable root records and relevant child commentary. Encrypted agent-message bodies and non-exhaustive tool-output review limit completeness; no decryption or claim of perfect recovery.
- [Runtime checkpoint](evidence/context_checkpoint_runtime.json), [twenty local route/lifecycle cases](evidence/uxfix_work_routes_result.json), [source/copy hash manifest](snapshot_manifest.json).

The completed raw-session audit also preserves open F-DD70/F-DD02, the unconfirmed adjacent face-check title observation, the five draft ZIP presets and missing automatic production/durable progress, spatial reconciliation, temporal masks and frame-exact footage-edit capability. The source import inventory is not completion of those future features.
