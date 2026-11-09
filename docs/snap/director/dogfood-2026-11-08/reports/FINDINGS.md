# Findings

## F-DD01 — first-style authority exception obscured by tool description

set_book_style tool description says canon always waits as proposal. On fresh Book with no style, save_style made look:look-mw8jlqlq767f, then set_book_style returned Book@2 directly, no proposed row. AGENT_START documents the first-style exception for save_style, but set_book_style schema wording does not. Production operator expected pending approval. Reproduced on c641cf2 native8291. Owner: web/snap/booktools.js set_book_style / book style contract. Final style re-proposed through save_style after initial attachment; first style remains documented, not silently treated as accepted.

## F-DD02 — version-qualified Cast IDs are accepted but do not fold bare story state

Production initially supplied cast:id@n in Book/cut lists to pin original asset versions. compile_unit reads pictures and details, but outputs why identity cast:id@n@n. Source book.js:333 stateAt compares change.entity exactly; compile line564 passes unit.cast ref unchanged, so normal bare cast:id story changes would not match a version-qualified cut Cast. No accepted story was rendered. Corrected this caller to documented bare cast:id contract; current heads remain Mio2/Kuroe7 and native takes pin actual versions. This is an input-contract trap rather than a tested film-state corruption. Potential owner: Book unit boundary normalization or explicit documentation/validation; no source patch made here.

## F-DD03 — dialogue leaks into native still-board prompt

After approved story5, compile_unit C2 board.prompt contains the exact line For me? from b2 prose and also a generated Baron Kuroe says For me? in voice placeholder sentence. Structured line remains correct in b2.lines and C2 speakers correctly includes only Kuroe. No board generated past this known lettering risk. Evidence compile_c2_accepted.json. Owner web/snap/book.js still()/boardPackage speech sentence inclusion, plus redundant dialogue in authored b2 prose. Reported to coordinator before generation.

## F-DD04 — action opening falsely conflicts with its own approved end-state ledger

Approved C1 compile includes correct opens.still_prompt (opening bowl in Mio left, no end-state fields) but lint flags set-down action/opening blocking against b1 end states left hand empty / bowl on counter. Evidence compile_c1_accepted.json; no render queued past lint without coordinator disposition. Owner Book phase-aware contradiction lint.

## Current checkpoint status,2026-11-08

- F-DD01 tool-help mismatch fixed in root-owned source and observed after lab-only reload. Initial first-style direct apply was documented native behavior, not an approval-policy bypass. Final story/style p1–p5 were later explicitly approved by user and accepted via visible controls.
- F-DD03 dialogue leakage and F-DD04 phase-lint false alarms fixed by the Book owner; actual native compiles verified on code a4dc2a790517. Raw Book/story/style files byte-identical across that reload. C2 executed make_board prompt has no quoted line/voice placeholder; video description retains exact line.

## F-DD05 — adapted board edits lack the make_board story pin

Actual C1 edit_from_context opening candidates3930e8d1/679dd7cc retain world pins location1/Mio2/Kuroe7 and purpose edit/ph3_view; get_take has no story field and executed workflow.extra.snap has only world. Native C2 make_board3a19aa9a has full story5/b2/roleboard/from hashes. Adapted C2 region b4ca10dd likewise has world only, no story. All raw histories saved under evidence/history_<fullUUID>.json. No set_board has yet run; inspect its resulting unit story/from pin later, without rewriting historical takes. This difference is explicitly retained rather than claiming wrapper equivalence or blocking the bounded dogfood solely for metadata. Existing helper instruction-pin findings remain separate.
