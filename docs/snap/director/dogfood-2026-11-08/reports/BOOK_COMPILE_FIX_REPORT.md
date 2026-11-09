# Book compile owner fix

READ FIRST — context checkpoint, 2026-11-08: Compiler fix is reviewed, locally committed and validated against the actual saved Book on8291. Root committed `1c976ee` (Book compiler,91-line focused test and two-line `run_all.sh` registration), independently reran the focused test with PASS, then committed the separate four-file UI fix as `476d4f2`. No push. Studio loaded app code `a4dc2a790517` and native C1/C2 compiles confirm both fixes; raw accepted Book/story/style files stayed byte-identical. Receipts: `evidence/compile_c1_fixed.json`, `evidence/compile_c2_fixed.json`, `evidence/final_reload_verification.json`. Compiler ownership is complete; follow the current `HANDOFF.md` for production. Four provisional opening-board candidates now exist, none selected; no completed-film, animatic, production-video or export claim. Main8193 was untouched.

## Findings and reproduction

- **F-DD120 — spoken lines leak into still prompts.** Full accepted `evidence/compile_c2_accepted.json` contains `For me?` twice in `board.prompt`: the accepted b2 prose and the generated dialogue/voice tail. Both paths belong to `web/snap/book.js`; video dialogue and accepted story text must stay intact.
- **F-DD121 — opening/action lint uses the end ledger.** Full accepted `evidence/compile_c1_accepted.json` contains four advisory contradictions for a valid ordered set-down: b1 action and explicit opening versus b1's final empty hand and counter holder. `opens` truthfully has no prior ledger state; inventing one would hide missing information. C1 currently remains an opening board. This is advisory compile lint, not a hard execution block.
- **2026-11-08, baseline check:** Added a server-free VM harness that executes the actual Book compiler and board package with controlled in-memory records, following the existing native module test pattern. `node tests/snap/test_book_prompt_phases.js` reproduces the same four false C1 warnings before source edits. No server, records, models, proposals, queue, or source canon were mutated.

## Proposed owner change (root approved before source edit)

Only `web/snap/book.js` and `tests/snap/test_book_prompt_phases.js` are owned here. Keep generic `craft.js` unchanged. A still excludes generated speech/voice instructions and removes exact accepted line text only in speech contexts, preserving visible action and explicit written text. State lint checks explicit opening and own-beat transitions against the relevant prior field; static/end statements and unchanged fields keep contradiction checks. Preserve unknown initial state, public signatures, provenance, accepted source bytes and native authority.

## Verification

- **F-DD122 — focused owner regression, after change:** `node tests/snap/test_book_prompt_phases.js` passes against the actual `compile` and `boardPackage` implementations with in-memory stores and the real generic craft functions. It performs no graph/store/network/queue writes.

| case | before | after, local actual-module harness |
|---|---|---|
| C1 accepted action + explicit opening | Four false state warnings, matching archived native output | No action/opening-vs-end warnings |
| C1 initial ledger | Unknown, not set before b1 | Unknown preserved, no invented bowl holder/hand value |
| C1 opening | Bowl held left, ladle right; opening role | Same role and visible opening retained; no final empty hand/counter sentence |
| C2 still/board/key | Script words twice plus generated voice directive | Script words absent; look/smile/nod/bowl/ladle/camera retained |
| C2 video | Exact accepted spoken line and voice placeholder | Same exact line, source prose and speaker retained |
| Static/end/whole-cut held bowl | Contradicts empty-hand ledger | Still warns |
| Later held bowl / raised bowl on unchanged counter ledger | Genuine state contradiction | Still warns |
| Known wrong opening hand | Must disagree with known prior | Still warns against prior ladle state |
| Spatial “before Kuroe” | Not a temporal marker | Still checks final state for a static holding assertion |
| Explicit sign reads/says the same utterance | Visible written text | Written occurrence preserved, spoken occurrence removed |
| Canon/provenance | Accepted source and why quotes | Byte-identical input story and expected provenance after compile |

Exact source files: `web/snap/book.js`, `tests/snap/test_book_prompt_phases.js`. Removed the unused still-dialogue tail. No `craft.js`, other agents' source files, public compile/apply signature, model, core, canon, proposal, or runtime mutation.

Root subsequently owned the two-line registration at `tests/snap/run_all.sh:550`, including the standalone CPU test in the existing gate. Source/test/registration are committed together in `1c976ee`; this worker made no commit or runtime change. The UI four-file commit `476d4f2` is separate and outside this worker's ownership. Both commits remain local.

Committed source SHA256:

| file | SHA256 |
|---|---|
| `web/snap/book.js` | `3aba83babd14143cc882070c579c3ccfd2f8529aa4cd6d349d1850516c928bca` |
| `tests/snap/test_book_prompt_phases.js` | `5fce35457198d81efb1e00de4c64c3c79d48186bd290f80cd68f67f734e6b6d9` |

Commands run from the source checkout (all exit0 after patch):

```
node tests/snap/test_book_prompt_phases.js
node --input-type=module --check < web/snap/book.js
node --check tests/snap/test_book_prompt_phases.js
git diff --check
```

## Final native8291 validation

- **F-DD123 — actual saved-Book compile validation passed.** Studio performed the lab-only reload to app code `a4dc2a790517`; both returned pages say `code_current:true`. This worker read the complete final C1/C2 output receipts after root independently validated them.
- `evidence/compile_c1_fixed.json`: role remains `opening`; bowl-in-left/ladle-in-right wording remains; `opens.after:null` and both initial fields remain truthfully “not set before this beat.” All four false action/opening-versus-end warnings are gone. The genuine remaining side-reference advice is preserved. State provenance and `from` hashes equal the archived accepted compile.
- `evidence/compile_c2_fixed.json`: `still_prompt` and `board.prompt` exclude `For me?` and the generated voice directive, keeping the look, smile, nod, bowl, ladle and camera. Video still says exactly `Baron Kuroe says "For me?" in the voice of {voice:cast:cast-mw5ig1ny8ylr}.` The accepted b2 prose, speaker and source hashes remain. The expected missing-C1-active-take continuation advice remains.
- `evidence/final_reload_verification.json` says `passed:true` and records identical before/after SHA256s for all raw canon files; `evidence/canon_files_before_final_reload.json` is the prior snapshot. No approval author metadata was rewritten.

| raw accepted record | bytes | identical before/after SHA256 |
|---|---:|---|
| Story5 `story/story-mw8ji71a9bly.json` | 6551 | `d0921c662d09de558e3bee0967538681d1eb756dc8fd58010e7996b660504425` |
| Style2 `look/look-mw8jlqlq767f.json` | 1496 | `c3753c603566d6cd2628ccb9ff348d48c2e0eb41b23292bd004afbded2574048` |
| Book6 `book/book-mw8ji71lvzcx.json` | 4515 | `40b4083ff81863e80c8bfe53b86b29f5c34f7333f09fc50d13e7217454af7fbd` |

Limits: phase and speech recognition remain deliberately narrow textual lint/projection, not a natural-language parser. Only exact accepted line words in speech contexts are removed from still prose; explicit written-text cues are kept. No generic craft semantics were changed. The focused CPU test is registered in the existing gate, but this patch has not been qualified by a new complete-gate run. Root review and actual8291 compile verification are complete; render quality, audio listening, selected-board approval, animatic, production-video and final-export verification remain production work. This report does not claim a completed film.
