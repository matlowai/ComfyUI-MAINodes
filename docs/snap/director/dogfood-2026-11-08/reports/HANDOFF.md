# READ FIRST — On the House, context checkpoint

Final receipt 2026-11-08 21:15 EST. This is the current runtime handoff; earlier captures are in HANDOFF_HISTORY_2026-11-08_2103.md. The user requested “my context is realllly full can we make sure our notes are written down please”. This is a checkpoint, not cancellation. Hold NEW renders until pickup; keep the server and visible preview open, delete nothing.

**Canon IS APPROVED and applied.** User said exactly **“Approve and apply in Book”**, relayed by root and observed at20:30:25EST. Production clicked the five normal visible Book Accept controls, p1–p5. Native accepted_by/answered_by truthfully says agent/director-studio, agents’ window, page b2cbcc; it has not been rewritten as person. Evidence: evidence/chat_canon_approval.json, evidence/proposals_accepted_native.json. No approval beyond this actual story/style/literal ledger brief is assumed.

**Not a completed film:** four provisional opening-board candidates exist, none picked or set as a board. **No animatic, production video, Cut MP4, OTIO or Astrid push exists.** Person-look at the selected boards/actual animatic remains before video. No new creative canon decision or self look approval.

## Runtime and source

- Dedicated server http://127.0.0.1:8291, GPU0 NVIDIA RTX5090/32GB; main8193/GPU1 untouched. Unit snap-director-dogfood-8291.service, Nice19, working core ComfyUI, base ./base, models ./models.yaml. Existing local AudioCPP binary configured; no models downloaded. Server log logs/server.log.
- One visible named extra Chrome, CDP http://127.0.0.1:43471, profile ./chrome-8291, Snap page b2cbcc78828c416c854eba377cd94c21. Name calls SNAP_AGENT=director-studio. Production and critic have both released the page. All4 current board critiques are DONE,0claims. Final visible UI is the approved Book beat sheet over A small kindness / Shot2; production closed the prior take viewer through its normal Close control. No GPU/check jobs queued/running; older imported/prepared record critique rows remain due. Root independently checked both8291/8193 queues empty, source476d4f2 clean and live8542b92 clean at21:14:34; evidence/context_checkpoint_runtime.json retains that receipt. Do not stop server/preview for the context clear.
- Serving pack resolves to snap-scout. Current clean git HEAD **476d4f280cda6786609f18e74a5e180694a39a19**. Root committed **1c976ee** (Book compiler/test/gate) and **476d4f2** (UI four files); app bytes are unchanged from the final loaded a4dc2a790517. Base before these local checkpoints was c641cf2. No public push yet. Production changed no source and made no commit/push. Current served code **a4dc2a790517**, frontend192 tools/HTTP196/MCP197, page code_current true at final reload. Root owns final source review/commit/state.
- Final native reload verification: evidence/final_reload_verification.json. Raw Book/story/style files remained byte-identical across compiler-only reload (hashes below). Fixes observed: C1 opening/action no longer falsely conflicts with its own end ledger; C2 still prompt excludes exact dialogue/voice placeholder, video keeps it. Reference-check arrival now has short question title; critic clicked real Open and reached C2 take1. Existing-result routing/lifecycle proofs are in UX_CRITIC.md and root fixer reports.
- Native VoiceQAGPU **this GPU, experts in RAM** (persisted ./base/user/default/comfy.settings.json). Never use default other GPU on this lab. No voice QA/audio listening has run in this production. Agents.run true only here under authorized short; Book stages retain normal autonomy.

## Current native records

| item | exact identity / state |
|---|---|
| Book | book:book-mw8ji71lvzcx@6, On the House |
| Story | story:story-mw8ji71a9bly@5; b1/b2 accepted, p1–p5 all accepted |
| Style | look:look-mw8jlqlq767f@2; approved warm hand-drawn dusk |
| Production | production:of-book-mw8ji71lvzcx; no Astrid import/auto-push |
| Scene | scene-mw8khsydsspo, A small kindness |
| C1 | shot-mw8khsyq37mx, The bowl; b1,3.75s/90frames proposed, no active take/board |
| C2 | shot-mw8kic4gqbh2, For me; b2,3.75s/90frames proposed, opens_on C1, no active take/board |
| Mio | cast:cast-mw5ig1ktoq32@2; one ladle in right hand |
| Kuroe | local cast:cast-mw5ig1ny8ylr@7; same original pictures/audio, authoritative voice.words empty |
| Prepared set | location:location-mw8kb2x2kc1p@1, separate local prep; Front clean plate + derived top |
| C2 preference | instruction:note-mw8kjhmu6xpz@1, shot scope, Dialogue Director candidate_count1; C1 inherits2 |

Use bare cast:id entity references in Book/cut lists. Version-qualified unit refs silently miss bare story-state IDs (F-DD02); native generation pins actual versions itself. Local Kuroe6 once held expected words from historical notes; Kuroe7 clears them, keeps expected “One more bowl.” only in a version note. Do not delete history or call that phrase verified/listened. Main Kuroe remains v5. Existing reference WAV is input/snap/kuroe_voice_ref_s5601.wav, SHA36761442b2f44c214ff6cd26e28529d150e5daa21ce328ebc163d18fda806cfe; it was historically made at12steps, not regenerated here.

## Approved story and state

1. C1/b1: Mio lowers the one soup bowl with two blue rim stripes from her LEFT hand onto the counter before Kuroe, then withdraws that hand; ladle stays RIGHT. b1c1 sets Mio.carried.left_hand→null; b1c2 sets prop:bowl.holder→on the counter.
2. C2/b2: Kuroe looks from bowl toward Mio, says **For me?**; Mio smiles/nods once; bowl stays on counter. Exact line remains b2.lines and video prompt, excluded only from still prose by reviewed compiler fix.

Both cuts stay on original front customer-side camera: Mio frame-right behind counter, Kuroe seated center-left/back three-quarter. One bowl, one ladle, one stockpot/burner, one red lantern; three stools with middle occupied/occluded. No music/dials/added FX; only Kuroe gets voice on C2. The opening C1 frame is bowl-in-left-hand BEFORE the ledger end state, grounded in inspected original f89. C2 begins after placement, bowl COUNTER/left clear.

## Prepared references (selected, separate from provisional boards)

- Qualified clean original-side **take-92f8f7d1-e8ee-4f08-8260-924b40040715**, ./base/output/snap_views/e9b7a5da_00002_.png; input/snap/take-92f8f7d1-e8ee-4f08-8260-924b40040715_f0.png. Formal CLEAN and root viewed whole. Preserves red circular pot/burner detail; its function is uncertain.
- Qualified derived wood-top **take-3e9f5038-ebed-4382-906c-7da233f7f543**, ./base/output/snap_views/e9b7a5da_00008_.png. Approximate bird-eye, NOT calibrated orthographic; rear shutter projects broadly. Unseen floor/depth/clearance are explicit design assumptions. No metre scale assigned. Root viewed whole; one original side + textured top minimum prepared, second side preferred but unnecessary for these same-front cuts. Keep top OUT of video conditioning.
- Original pose source ./base/input/snap/director_sources/set_ref_source_f89.png, uploaded from parent study wip_finish_2026-11-08/final_2830523/set_ref_source_f89.png. It shows exactly2people,1bowl LEFT/1ladle RIGHT; colored wall/wood effects are not set authority.
- Original empty P1b source ./base/input/snap/director_sources/take-c285ecf3-902e-4c30-b387-97ee04feeec0_f0.png. Older original location9 master/reverse disagree in look, remain separate and unused.
- Native import archive ./base/input/snap_imports/snap-world-20261108-195023.zip; SHA1d000729eb3105950a62cefa14db8b584af30a3ab670f776cf6d8a41e5691e78. Current3records/12media imported without conflict, no Book/takes. ASSET_SCOUT reports prove source.

## Current provisional opening boards — NO picks

| cut/candidate | decision, full take, seed | pixels / review |
|---|---|---|
| C1c1 | cand-mw8lt6tk-uxux; take-3930e8d1-06e5-4b2b-9d5e-a419d6a51062;11101 | output/snap_views/f4295406_00001_.png; formal CLEAN crit-1a1be00423c-f1b7 |
| C1c2 | same decision; take-679dd7cc-e75c-4017-bee7-df2cf31569dd;11102 | output/snap_views/f4295406_00002_.png; formal CLEAN crit-1a1be00b9f8-553d; only PROVISIONAL input to C2 edit |
| C2 native | cand-mw8luu2b-wxsd; take-3a19aa9a-c2f7-48dd-8a23-937aec206e7b;11103 | output/snap_views/95b54bac_00001_.png; bowl counter/no lettering, Kuroe wrongly faces front; formal1HIGH wrong-facing, crit-1a1be028907-b024 |
| C2 region | cand-mw8m2mcu-w5ge; take-b4ca10dd-f34b-4e4b-b4c5-a49c536cfdfd;11104 | output/snap_views/95b54bac_00002_.png; bowl counter/left clear/facing protected; formal1MEDIUM visible seam, crit-1a1be06a642-c9e7 |

C1 adapts Director worklist through native edit_from_context (root-approved caller craft): P-H3 edits f89 canvas, clean Front plate is set authority, original Cast refs3–5. C2 native make_board roleopening/count1/context[] succeeded despite opens_on waiting for C1video, so **no dependency cycle**; it failed facing, then changed method rather than rerolling. C2 region is native P-H3 paste_back crop[.47,.42,.32,.38] of unpicked C1c2 with clean plate appearance support. Heads/facing are outside crop; detector flags TOP/RIGHT breaks and top box17.4grey darker. Critic confirmed at native100% a visible apron horizontal tone/contour break and sleeve edge, region[.585,.405,.215,.1], owner take:1MEDIUM. Counts/state/facing otherwise correct. Do not pick/re-render blindly; next source repair must address this demonstrated seam. All failed outputs retained.

## Native story provenance distinction — do not flatten it

- Adapted C1 candidate get_take **does not expose a story pin**; raw executed history workflow.extra.snap contains only world (location1/Mio2/Kuroe7). Purpose remains edit/ph3_view. No set_board has run, so resulting board unit story/from hashes remain to inspect. Evidence evidence/c1_board_candidate_take.json, c1_candidate1_context_checkpoint.json, c1_candidate2_context_checkpoint.json and history_3930e8d1-06e5-4b2b-9d5e-a419d6a51062.json / history_679dd7cc-e75c-4017-bee7-df2cf31569dd.json.
- Native C2 make_board raw history **does pin story5**, b2, roleboard, scene/shot/cut and from hashes: b2.text a5fe3da20ab0; Mio.left 2a02f5c99d61; bowl.holder19588f75b9c0; dialogue a3d3ed4f4a7e; location4d5d193ac3bd; style da61f0949d4f. Evidence history_3a19aa9a-c2f7-48dd-8a23-937aec206e7b.json.
- C2 region raw history history_b4ca10dd-f34b-4e4b-b4c5-a49c536cfdfd.json has only location1 in world (no Cast pins) and no story pin; source-parent history still links provisional C1c2. Normal set_board resulting unit pin remains to inspect. Do not assume wrapper equivalence or retroactively rewrite take history. Existing helper instruction-pin gaps remain release findings; do not block solely for cosmetic metadata.

## Models, actual timing and logs

All actual workflows/hyperparameters are in evidence/history_<prompt UUID>.json; tool inputs/results are logs/*.json.

- P-H3: h3/p-h3-image_int8_convrot.safetensors + matching text encoder/VAE; SigmaShift1/1, BasicGuider, Euler,8updates on ManualSigmas1,.984753,.967905,.951688,.925372,.881923,.810083,.528718,0; no negative/CFG. C1 boards2560×1408,5context images,41.970/30.250s execution wall. C2 region crop processed about1MP and pasted back full frame,2context images,20.722s. No denoise override.
- Native C2 Fizgig: h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors; h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors; h3/minimax_h3_video_vae_fp16.safetensors; turbo v4 step600 EMA LoRA .38; BasicGuider, er_sde/simple20steps;2560×1408,4references,109.046s execution wall. Tool estimate38s was not this measured first-load/size time.
- Prior prep8stills:18.882,9.855,14.783,7.357,28.154,19.275,20.855,11.508s;41.970/30.250/109.046/20.722s production-board attempts above. Hardware same RTX5090, GPU0; includes model/encoding overhead, not kernel-only time.
- Future video is **Pika6steps**, normal Ref2V; no more steps as a quality fix. Exact native ready setup/reference order must be inspected at apply_unit after boards/person look. No video-model recipe was applied/run yet.

## Plans and verified gates

- Dialogue Director exact pack:dialogue-director@1.0.0, inherited Script to Film; definition SHA df78b19c9582036a7811e36a3aa261486b03a83767e2ea9f1cc545ce03fc4235. Plan v3 evidence/plan_v3_accepted.json SHA fd907c77c38f4bce839adb31411c6d6906d92e9ba8dea42d9debe40239b64919; no errors/warnings, C1count2/C2count1. Replan after latest timing/blocking/board picks before execution.
- Packing helper uses actual core H3 length schema5..3600frames,17k+5grid,24fps; estimated action3.5s each + C2speech floor1s gives90frames/3.75s each,7.5s total. This is a planning estimate, not measured speech. Both native units now3.75s.
- C1 role helper evidence/reference_roles_c1_input.json/result.json proposes front/Mio/Kuroe-front/Kuroe-back, top review-only and non-speaking voice excluded; native pre-board compile agrees. Adapted P-H3 actual order intentionally adds f89 edit canvas first, clean plate second, then Cast3–5. **Actual video apply_unit order still pending**; profile_verified_against_live_graph=false was preserved.
- Compiler proof evidence/compile_c1_fixed.json, compile_c2_fixed.json; actual exact prompts checked. Raw approved files hashes before/after final reload: story d0921c662d09de558e3bee0967538681d1eb756dc8fd58010e7996b660504425; style c3753c603566d6cd2628ccb9ff348d48c2e0eb41b23292bd004afbded2574048; Book40b4083ff81863e80c8bfe53b86b29f5c34f7333f09fc50d13e7217454af7fbd.
- Critic prompt unchanged; blind critic floor26/31+1FA remains below release floor27/31/0FA. Dogfood allowed, no release qualification claim.

## Next native command after the current critic receipt/checkpoint

1. Read this box, PROGRESS/LESSONS/FINDINGS, then native pages/instructions; bind own page only after critic release. Confirm no new user steering, source revision/current code and queue. Do NOT re-approve story; p1–p5 are accepted.
2. First content read: get_take{take:"take-b4ca10dd-f34b-4e4b-b4c5-a49c536cfdfd"} and its completed critique/seam notes. All4 current rows are done. Repair the confirmed medium seam at the native source (clean C1 pose), with a crop beyond the crossing item’s end or another targeted method; preserve Kuroe facing, bowl counter, Mio.left empty/ladle right. Do not blindly use crop_to_try or reroll seed. Review new candidate with unchanged critic before any pick.
3. After current reviews, choose technically viable C1/C2 candidates through **set_board**, explicit roleopening (never apply_candidate in a Book cut). Inspect actual returned board.story/from hashes and get_take pin after set_board. Neither unit has a video active take.
4. Replan, native animatic{book:"book:book-mw8ji71lvzcx"}, wait_for real job; board cut-pair critique and actual person-look on boards/animatic before video. Do not claim unseen approval.
5. After that look: open real cut, initialize native Pika reference setup if empty, apply_unit, inspect final inputs/reference order/voice (only Kuroe C2), run Pika6. C1 first, pick after actual review, replan/resume, C2 opens selected C1trim-out. Count every0.5s, copy/voice QA, actual listening limitations explicit.
6. Native CutMP4+OTIO and whole export review; test trim/staleness without duplicate jobs, preserve pre-edit export. No Astrid push.

## UX tests actually observed versus still pending

- Before routing fix: actual automatic copy-check Work rows exposed Park only, no Open. Actual adjacent parent aisle-decision Open showed source Take6, with picked Take8/candidates down its sidebar. This is recorded in critic_artifacts/work_before_open.png and parent_decision_opened.png.
- After reviewed fixes/current app: the real new C2 board arrival displayed **Checking reference matches · Is the bowl on the counter before Kuroe asks?: done**. Critic actually clicked that toast Open at01:54Z; it correctly opened C2 scene/Shot2 native take1, seed11103. It also selected/loaded Shot2’s default recipe tab from scratch; no render, settings change or pick was made. This single real new-toast path is qualified, not every Open path.
- Post-fix old completed-check rows (old c1→Take7/c2→Take8), applied-parent→Take8 and unpicked candidate-sheet close/disconnect/outside pointer release/cancel lifecycle were covered by source-owner local regression harnesses. **Their final-app real browser click/lifecycle qualification remains pending in this production record.** Do not turn harness coverage into a claim that those UI paths were all clicked after the final reload.
- Final UI preparation: native open_view said Book open but read_ui still reported Take1 because viewer remained above it. Production closed only that viewer via normal Close, then read_ui verified sheet Book. Current visible Book is ready; both page holds released. No new source work, job or pick for this checkpoint.

## Files map

- STORY_REVIEW.md and PREP_REVIEW.html now show approved canon/current provisional-board status.
- PROGRESS.md dated execution/UX/approval rows; LESSONS.md traps/fixes; FINDINGS.md F-DD01–04 plus metadata limitation.
- UX_CRITIC.md + critic_artifacts/ = formal review and real UI/navigation captures.
- evidence/ = full raw native histories, accepted proposal metadata, current Book/compiles/plans/helpers/hashes.
- logs/ = full native generation inputs/responses/candidates.
- HANDOFF_HISTORY_2026-11-08_2103.md preserves older checkpoint text, including statements that were true before approval; it is history, not current instruction.
