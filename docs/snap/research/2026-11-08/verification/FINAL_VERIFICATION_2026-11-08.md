> Coordinator checkpoint note: the executed application/skill bytes are qualified at `032876c`. Later report/capture additions, device-neutral identity-test wording and a GPU test-history preservation guard change no application logic or test thresholds. This report preserves the full original run and its explicit exceptions. Selected complete sanitized native data are indexed in [native_evidence_copies.json](native_evidence_copies.json).

# Final local verification report — 2026-11-08

**Outcome:** bounded verification complete, with explicit remaining limits. The original full run was not green. Its two real Voice QA bugs were fixed and qualified on GPU; census/skill metadata/citation corrections and quiet UI reruns pass as specified below. The fresh visual critic remains below its floor, and the historical file-embedded instruction-pin check remains9/10. No production landing or main restart occurred.

Latest fully identified source for affected-lane verification: `032876c889192c0694f5aa8126f98cf1ecd4e8d6` on `snap-research-2026-11-08`. Root has a pending display-text-only identity-test edit outside this worker’s ownership; it is not part of the recorded execution source.

## Source and lane matrix

| Lane | Exact source | Device / result | Evidence |
|---|---|---|---|
| Original full run | `2830523b2ffbbc6bbb4dd4c66c0c2cb631136c71` | CPU services plus original GPU suites;215 numeric result lines,14 partials,0 skips;Director79 checks reportedPASS. Three explicitly interrupted cases are not passes. | `final_2830523/gate_2830523_coordinator.txt`, `gate.env`, `summary_raw.json`, `gate_out/` |
| Corrected tool census | `a34ac16a05acfdaeb9b9b751971f75180af5c8ea` checks on original283 complete JSON |5/5,15/15,20/20;MCP197unique,WebMCP192 | `final_2830523/rescore_census_a34ac16.out`, `director_tool_count.json` |
| Native word timing/export | `e95b1a74c4354fafb5f20eda558405828408c000` | GPU0 RTX5090,experts in RAM;7/7 | `final_2830523/gpu_fix_e95b1a7/` |
| Native final Voice QA | `a7dd97bf58c411d77e9bd7caf0e0619835271919` | GPU0 RTX5090,experts in RAM;8/8;no page errors | `final_2830523/gpu_fix_a7dd97b/` |
| Final instruction/library/citation/discovery | `032876c889192c0694f5aa8126f98cf1ecd4e8d6` |14/14,22/22,20/20;cite6/6;CPU regression9/9 | `final_032876c/` |
| Final UI quiet reruns | `032876c889192c0694f5aa8126f98cf1ecd4e8d6` |ui10/10,adopt14/14;UI2unlimited-frame12/13,normal-visible13/13 | `final_032876c/focused_summary.out`, `ui2_normal/` |
| Critic mechanics/copy/sound integration | `032876c889192c0694f5aa8126f98cf1ecd4e8d6` | Separate GPU0 lane11/11 in25s;original CPU notqualified | `final_032876c/gpu_critic/` |
| Identity analysis | `032876c889192c0694f5aa8126f98cf1ecd4e8d6` | Separate GPU0 lane14frames,7/7cases,maxhairL90delta0.23L*,10s;original CPU interrupted | `final_032876c/gpu_identity/` |
| Native set-reference generation | actual283 runtime; helpers byte-identical acrosseb8/283/032 |2real2560×1408stills,formal critiques,10/10record/provenance checks | `final_2830523/native_set_reference*`, `history_*.json`, `setref_component_provenance.json` |
| Fresh visual critic | Current critic skill/reference bytes, unchanged throughfinal032 |26/31caught,1FA on9clean,32/32written;BELOW27/31,0FAfloor | `fresh_critic/` |

The source changes after283 are narrowly qualified: native model discovery reads AudioCPPLocalServer’s declared combo because core’s experimental inventory omits GGUF; successful empty-speech QA reportsok; explicit interface census updates; set-design metadata and a documentation cite correction. No model math, dtype/device implementation, test thresholds or critic prompt were changed by this worker.

## Full-run provenance and comparison

The immutable283 run started `2026-11-08T17:44:25-05:00` and ended `2026-11-08T19:00:03-05:00`: 75m38s, shell exit0. Exit0 does not aggregate suite failures. Full input fixtures verified434/434 SHA256. Served-source verification matched12/12module reads on four isolated services before the native work. Main serving revision remained8542b92.

Compared with the prior G17a coordinator log:210→215numeric result lines;no prior suite name lost;added `g17bcontinuity, g17bcraft, g17bcritic, g17bmisc, g17bvoiceqa`. The earlier G17b builder log has211numeric lines and no GPU slot, while this run attempted all configured GPU cases. No environment-caused skip remains. The new9case discovery regression is separately run on finalsource rather than falsely counted as part of the immutable215-line run.

The model guard passed before and after: no CPU test folder linked into real models, and no file under real models/loras changed during the full run. GPU slots intentionally read existing real weights; each additional GPU script was inspected first and creates no fake model files. No downloads, installs, model deletion or weight modification occurred.

## Raw failures, corrections and limits

| Original result | Interpretation / confirmed follow-up |
|---|---|
| `ui       9/10 FAIL [1]` | 032 quiet visible/unlimited-frame mode:10/10; drag lift32ms, no page errors. |
| `ui2      12/13 FAIL [0]` | 032 same-mode quiet12/13 (palette61ms); predeclared normal-visible13/13 (palette7ms). Adapter-dependent; raw58/61ms failures retained. |
| `agent    4/5 FAIL [0]` | Exact a34 census re-summary of original complete JSON:5/5. Native count197unique,7Director additions. |
| `adopt    13/14 FAIL [11]` | 032 quiet rerun14/14; original folded-drop gesture failure retained. |
| `agentfull 13/15 FAIL [0, 12]` | Exact a34 re-summary15/15: MCP197,WebMCP192; original complete JSON retained. |
| `newcomer 19/20 FAIL [0]` | Exact a34 re-summary20/20. |
| `g16words 2/7` | e95 actual GPU0 rerun7/7; word times exported and published in Astrid. |
| `g17bvoiceqa 0/8` | Original missing-kit test interrupted (browser-close exception, raw0/8), notPASS; e95 intermediate7/8; a7 actualGPU rerun8/8. |
| `instrstore 12/14` | 032 rerun14/14 after explicit12skill census plus real set-design scope metadata fix. |
| `instrresolve 21/22` | 032 rerun22/22 after explicit12skill census. |
| `instrpins 9/10` | OPEN9/10: saved file workflow instruction pin predicate fails, exactly the same predicate as historical coordinator output. Other9 checks pass; no blanket flake approval. |
| `agentlib 19/20` | 032 rerun20/20 after explicit12skill card census. |
| `g3cards 5/6` | 032 cite lint6/6 after rewording the invalid Audio-k example in a lesson; validator unchanged. |
| `g17bcritic 3/11` | Original CPU analysis interrupted/resource-limited, raw3/11 NOTPASS; exact032 GPU analysis11/11 in25s. No model math or thresholds changed. |
| CPU identity: no completed result; `Terminated` | Exact own script/PID and prompt2031dc1a… were interrupted after separate GPU qualification. Not a CPU numerical pass. Full graph/evidence in `cpu_identity_interrupted.json`. |

CPU critic interruption was specific: firstkey result/progress was preserved, then only prompt00645e8d… and Node2169946 were stopped. CPU identity interruption was similarly restricted to its own client_id/prompt and Python2399040. No whole queue clear, unrelated job interruption or file deletion was used for these bounded exceptions. Their original failure/partial output stays in the raw run.

The UI modes are explicit. Every test browser was actually visible; an external preload retained the original headless user-agent only for routing assertions. The unlimited-frame adapter adds `--disable-frame-rate-limit --disable-gpu-vsync` to avoid the headed desktop’s30Hz drag budget mismatch. That mode produced58ms and61ms palette measurements. A single predeclared normal-visible diagnostic, with identical finalsource/data/assertions, produced7ms and13/13. These are adapter-dependent timing results, not a claim that one uniform full CPU/browser run passed every budget. No repeated search for a green threshold or app performance rewrite was performed.

The open instruction-pin check is exactly “the saved file’s workflow holds extra.snap.instructions.” The same failed predicate is present in the historical coordinator output; other take/stack-diff/viewer/off-metadata checks pass. It stays an open historical finding. Native New-view helper takes also report no pinned instruction stack; the resolved instruction stack was captured separately, so the helper evidence is not claimed to prove a complete reference/instruction ledger.

## Native evidence and visual/listening bounds

`native_evidence_manifest.json` gives exact complete evidence files, sizes and SHA256s for word timing, QA, set-reference, extra device lanes and cleanup.

- Words: Nemotron heard “it’s you” at1.881–1.968 and1.968–2.588seconds. The complete Astrid archive/timeline retains these words, and the published-word CLI read them back. The per-suite park cleared that passing raw prompt history before it was separately retained; do not relabel legacy `gpu_histories/` as the passing word history. The complete real test output and export remain.
- Voice QA: leaked Maren speech is identified with0.4791margin; Kuroe’s “one more bowl” matches with0.5297margin and2.384–3.694swords; silentC1 is checked,0unscripted,overallok. Allthree complete final execution histories and take records are saved. This is targeted regression coverage, not a new broad voice benchmark or a listening taste verdict.
- Set-reference: root-level `native_set_reference.json` is the earlier read-only eb8 preflight and contains no generation. Actual job histories are17:47:27.584–17:47:48.755 and17:47:49.364–17:47:59.463EST, after the283service restart. Actual runtime files, served-code verification and byte-identical booktools/edits/methods components establish the source; hardcoded header/folder labels alone are not provenance. Bothpeople were removed; majorcamera/fixtures held; sourcecut unchanged; picked testplate preserves side/set/camera/pose/provenance and the originalplate. Faintwalltone/colourpatches remain; no calibratedgeometry, perfectproductionplate or productionpick is claimed. Wholeimages,all100%tiles,measuringcopies andsource were read before formal verdicts.
- Fresh critic: automatic25/31,5candidateFAs; confirmed26/31,1FA under the existing floor protocol. X03’s duplicate is a semantic regex miss, accepted with explicitcount1→2. Misses: X03innerwall;X14unsupportedwire andkite intersections;X21LEFTscabbardfloat andprofilemismatch. The oneFA is a real duplicate monocle ratedhigh by newcountpolicy while the unchanged fixture allows onlylow/medium. Even accepting that policy conflict,26/31stillfails27/31. No frozen note, prompt, fixture or floor was changed after answers.
- Blind packets contain stills/clip-sheets only: no complete half-second stream, playback audio, copy.reaches or VoiceQA metadata. Thus their new sound/destination passes cannot be fully measured by these32visualfixtures. The runtime GPUcritic11/11 proves packet/measurement/severity mechanics; it does not supersede the failed fresh visual floor.
- Visible “lamp room in a lighthouse” was an old mocked CPU demo: original fixture images and synthetichistory IDs, not a new lighthouse render. Exact screenshots/provenance are retained. No complete R271 lighthouse geometry packet or successful lighthouse production generation was claimed.

## Complete original numeric result table

All215numeric result lines follow, including both real-model guards. Additional nonnumeric suites/results are listed afterward. The follow-up column does not rewrite the original result.

| # | Suite | Raw score | Original status / follow-up |
|---:|---|---:|---|
|1|`realmodels`|1/1|Reported full total|
|2|`engine`|14/14|Reported full total|
|3|`ui`|9/10|032 quiet visible/unlimited-frame mode:10/10; drag lift32ms, no page errors.|
|4|`ui2`|12/13|032 same-mode quiet12/13 (palette61ms); predeclared normal-visible13/13 (palette7ms). Adapter-dependent; raw58/61ms failures retained.|
|5|`agent`|4/5|Exact a34 census re-summary of original complete JSON:5/5. Native count197unique,7Director additions.|
|6|`library`|13/13|Reported full total|
|7|`proposals`|14/14|Reported full total|
|8|`notes`|12/12|Reported full total|
|9|`dock`|13/13|Reported full total|
|10|`tabs`|7/7|Reported full total|
|11|`anynode`|18/18|Reported full total|
|12|`adopt`|13/14|032 quiet rerun14/14; original folded-drop gesture failure retained.|
|13|`rules`|8/8|Reported full total|
|14|`recipe`|7/7|Reported full total|
|15|`shot`|12/12|Reported full total|
|16|`newtab`|6/6|Reported full total|
|17|`passthrough`|8/8|Reported full total|
|18|`resize`|8/8|Reported full total|
|19|`panel`|11/11|Reported full total|
|20|`back`|8/8|Reported full total|
|21|`openin`|12/12|Reported full total|
|22|`dropkeys`|8/8|Reported full total|
|23|`takes`|11/11|Reported full total|
|24|`takestale`|11/11|Reported full total|
|25|`video`|9/9|Reported full total|
|26|`dials`|11/11|Reported full total|
|27|`models`|21/21|Reported full total|
|28|`upscale`|12/12|Reported full total|
|29|`graph`|12/12|Reported full total|
|30|`stale`|6/6|Reported full total|
|31|`image`|25/25|Reported full total|
|32|`slots`|12/12|Reported full total|
|33|`fresh`|9/9|Reported full total|
|34|`agentfull`|13/15|Exact a34 re-summary15/15: MCP197,WebMCP192; original complete JSON retained.|
|35|`sight`|6/6|Reported full total|
|36|`board`|6/6|Reported full total|
|37|`seteditor`|19/19|Reported full total|
|38|`polish`|13/13|Reported full total|
|39|`cards`|9/9|Reported full total|
|40|`switch`|13/13|Reported full total|
|41|`methods`|16/16|Reported full total|
|42|`plates`|20/20|Reported full total|
|43|`candidates`|26/26|Reported full total|
|44|`compat`|11/11|Reported full total|
|45|`eyes`|13/13|Reported full total|
|46|`u58`|22/22|Reported full total|
|47|`scenes`|22/22|Reported full total|
|48|`u62`|14/14|Reported full total|
|49|`onboarding`|31/31|Reported full total|
|50|`newcomer`|19/20|Exact a34 re-summary20/20.|
|51|`f11`|9/9|Reported full total|
|52|`run3`|7/7|Reported full total|
|53|`f16f17`|11/11|Reported full total|
|54|`u88takes`|9/9|Reported full total|
|55|`u84loras`|12/12|Reported full total|
|56|`pikaturbo`|10/10|Reported full total|
|57|`notrim`|5/5|Reported full total|
|58|`metaflows`|6/6|Reported full total|
|59|`metaoff`|7/7|Reported full total|
|60|`u76sound`|12/12|Reported full total|
|61|`u77cap`|12/12|Reported full total|
|62|`u82rate`|15/15|Reported full total|
|63|`u82takes`|10/10|Reported full total|
|64|`u46c`|14/14|Reported full total|
|65|`u46e`|19/19|Reported full total|
|66|`u73`|18/18|Reported full total|
|67|`polish2`|5/5|Reported full total|
|68|`u76left`|16/16|Reported full total|
|69|`u76srv`|6/6|Reported full total|
|70|`world`|11/11|Reported full total|
|71|`cast`|18/18|Reported full total|
|72|`pins`|11/11|Reported full total|
|73|`retake`|11/11|Reported full total|
|74|`versions`|8/8|Reported full total|
|75|`cleanup`|13/13|Reported full total|
|76|`cpolish`|6/6|Reported full total|
|77|`cpins`|13/13|Reported full total|
|78|`f20f22`|11/11|Reported full total|
|79|`f23f26`|6/6|Reported full total|
|80|`dextpics`|8/8|Reported full total|
|81|`dtakeshd`|5/5|Reported full total|
|82|`rerun`|16/16|Reported full total|
|83|`rrsheet`|11/11|Reported full total|
|84|`rrmotion`|13/13|Reported full total|
|85|`rrbatch`|10/10|Reported full total|
|86|`rrrating`|7/7|Reported full total|
|87|`f28f31`|6/6|Reported full total|
|88|`e_r5`|11/11|Reported full total|
|89|`e_diff`|10/10|Reported full total|
|90|`e_recast`|7/7|Reported full total|
|91|`u101`|36/36|Reported full total|
|92|`u101faces`|7/7|Reported full total|
|93|`u101sheet`|21/21|Reported full total|
|94|`u101fc`|14/14|Reported full total|
|95|`u101full`|17/17|Reported full total|
|96|`u101ui`|10/10|Reported full total|
|97|`u102b`|19/19|Reported full total|
|98|`f1stamp`|8/8|Reported full total|
|99|`f2model`|7/7|Reported full total|
|100|`f3sheet`|11/11|Reported full total|
|101|`f4chips`|7/7|Reported full total|
|102|`f5open`|12/12|Reported full total|
|103|`f6cross`|4/4|Reported full total|
|104|`f8route`|5/5|Reported full total|
|105|`f9pages`|9/9|Reported full total|
|106|`g1loc`|20/20|Reported full total|
|107|`g1purpose`|14/14|Reported full total|
|108|`g1friction`|9/9|Reported full total|
|109|`g1world`|9/9|Reported full total|
|110|`g1chain`|6/6|Reported full total|
|111|`g1adopt`|4/4|Reported full total|
|112|`g1reload`|3/3|Reported full total|
|113|`g1window`|9/9|Reported full total|
|114|`g1bnotes`|16/16|Reported full total|
|115|`g1bfast`|10/10|Reported full total|
|116|`g1bopening`|9/9|Reported full total|
|117|`g1bfresh`|6/6|Reported full total|
|118|`g1blost`|6/6|Reported full total|
|119|`g1bidcopy`|4/4|Reported full total|
|120|`g1bvoice`|4/4|Reported full total|
|121|`g16words`|2/7|e95 actual GPU0 rerun7/7; word times exported and published in Astrid.|
|122|`g17bvoiceqa`|0/8|Original missing-kit test interrupted (browser-close exception, raw0/8), notPASS; e95 intermediate7/8; a7 actualGPU rerun8/8.|
|123|`g2refs`|15/15|Reported full total|
|124|`g2shots`|7/7|Reported full total|
|125|`g2fd`|10/10|Reported full total|
|126|`g2misc`|8/8|Reported full total|
|127|`g2truth`|7/7|Reported full total|
|128|`g2send`|13/13|Reported full total|
|129|`g2polish`|8/8|Reported full total|
|130|`instrstore`|12/14|032 rerun14/14 after explicit12skill census plus real set-design scope metadata fix.|
|131|`instrresolve`|21/22|032 rerun22/22 after explicit12skill census.|
|132|`instrpins`|9/10|OPEN9/10: saved file workflow instruction pin predicate fails, exactly the same predicate as historical coordinator output. Other9 checks pass; no blanket flake approval.|
|133|`agentlib`|19/20|032 rerun20/20 after explicit12skill card census.|
|134|`gateinstr`|6/6|Reported full total|
|135|`book_story`|21/21|Reported full total|
|136|`book_compile`|24/24|Reported full total|
|137|`book_cut`|15/15|Reported full total|
|138|`book_pages`|10/10|Reported full total|
|139|`g4book`|26/26|Reported full total|
|140|`g4deps`|6/6|Reported full total|
|141|`g4med`|14/14|Reported full total|
|142|`g4critic`|6/6|Reported full total|
|143|`g4shots`|7/7|Reported full total|
|144|`g6book`|26/26|Reported full total|
|145|`u93critique`|17/17|Reported full total|
|146|`u93packet`|15/15|Reported full total|
|147|`u93triggers`|11/11|Reported full total|
|148|`u93marks`|12/12|Reported full total|
|149|`u93agree`|7/7|Reported full total|
|150|`u94deps`|12/12|Reported full total|
|151|`g3critic`|26/26|Reported full total|
|152|`g3pages`|7/7|Reported full total|
|153|`g3eyes`|8/8|Reported full total|
|154|`g3cards`|5/6|032 cite lint6/6 after rewording the invalid Audio-k example in a lesson; validator unchanged.|
|155|`g5`|20/20|Reported full total|
|156|`g6`|31/31|Reported full total|
|157|`g7verdicts`|15/15|Reported full total|
|158|`g7room`|12/12|Reported full total|
|159|`g7book`|20/20|Reported full total|
|160|`g7misc`|10/10|Reported full total|
|161|`g8wardrobe`|13/13|Reported full total|
|162|`g8room`|10/10|Reported full total|
|163|`g8dryrun`|10/10|Reported full total|
|164|`g9room`|18/18|Reported full total|
|165|`g9book`|30/30|Reported full total|
|166|`g10`|35/35|Reported full total|
|167|`g11`|29/29|Reported full total|
|168|`g12`|42/42|Reported full total|
|169|`g13`|13/13|Reported full total|
|170|`g14`|15/15|Reported full total|
|171|`g14nodes`|7/7|Reported full total|
|172|`iris`|19/19|Reported full total|
|173|`g15safety`|23/23|Reported full total|
|174|`g15astrid`|11/11|Reported full total|
|175|`g15cut`|16/16|Reported full total|
|176|`g16prod`|10/10|Reported full total|
|177|`g16cut`|15/15|Reported full total|
|178|`g16receipt`|11/11|Reported full total|
|179|`g16push`|20/20|Reported full total|
|180|`g16settings`|12/12|Reported full total|
|181|`g16guest`|12/12|Reported full total|
|182|`g16braid`|7/7|Reported full total|
|183|`g16rerun`|4/4|Reported full total|
|184|`g16either`|7/7|Reported full total|
|185|`g17dials`|32/32|Reported full total|
|186|`g17export`|14/14|Reported full total|
|187|`g17shots`|10/10|Reported full total|
|188|`g17bcraft`|14/14|Reported full total|
|189|`g17bcontinuity`|18/18|Reported full total|
|190|`g17bcritic`|3/11|Original CPU analysis interrupted/resource-limited, raw3/11 NOTPASS; exact032 GPU analysis11/11 in25s. No model math or thresholds changed.|
|191|`g17bmisc`|13/13|Reported full total|
|192|`vaultfmt`|17/17|Reported full total|
|193|`vaultsrv`|43/43|Reported full total|
|194|`vaultmig`|8/8|Reported full total|
|195|`vaultgate`|14/14|Reported full total|
|196|`vaultpage`|11/11|Reported full total|
|197|`f6gate`|4/4|Reported full total|
|198|`f29snap`|3/3|Reported full total|
|199|`f27`|3/3|Reported full total|
|200|`longclip`|8/8|Reported full total|
|201|`u82gate`|10/10|Reported full total|
|202|`u88dials`|9/9|Reported full total|
|203|`u83u88`|35/35|Reported full total|
|204|`f18gate`|5/5|Reported full total|
|205|`u90words`|9/9|Reported full total|
|206|`u90outs`|17/17|Reported full total|
|207|`u77ui`|12/12|Reported full total|
|208|`e_cap`|10/10|Reported full total|
|209|`kitsfresh`|3/3|Reported full total|
|210|`agentpage`|8/8|Reported full total|
|211|`categories`|18/18|Reported full total|
|212|`private`|20/20|Reported full total|
|213|`privacy`|6/6|Reported full total|
|214|`dataset`|18/18|Reported full total|
|215|`realmodels`|1/1|Reported full total|

## Additional terminal checks

| Check | Original result |
|---|---|
| Vault key setup/unlock |bothunlocked|
| Historical critic r6/r5b rescoring |both27/31,0FA,HOLDS;historicalnotes only|
| Continuity v0 |19/19plantedchanges,0FA over16pairs|
| Held-out continuity |20/20pairs,20/20expectedfindings,0findings on9clean|
| Coverage + eyeline |36/36|
| Held-out eyeline |16/16|
| Director |79/79,fail0,skipped0;complete Node test output`gate_out/director.out`|
| CPU identity |interrupted,notPASS;separateGPU7/7|

## Cleanup and current service state

Allfour original isolated test-base links were restored. The six isolated test services/wrappers and main areactive; all recorded queues on8193/8194/8195/8196/8199 areempty. Main is clean `8542b92a90b4b7ed921badb1fe05103c1713d3f0`, servingcode `62f5f3a07372` from snap-live. Mainwasnotrestarted/moved/driven.

Coordinator explicitly authorized retaining the working test-slot runtime `AUDIOCPP_SERVER` and `Nice=19` prerequisite. The original unitstate is preserved; no return to the known-missing binary environment was performed. All detached snapshots, outputs, raw failures, histories and `_parked` records remain. No pushes or production/main/snap landing were performed by this worker.

Cleanup record: `local-evidence/snap-study/wip_finish_2026-11-08/cleanup_status.json`. Full log: `local-evidence/snap-study/wip_finish_2026-11-08/final_2830523/gate_2830523_coordinator.txt`. Final focused evidence: `local-evidence/snap-study/wip_finish_2026-11-08/final_032876c`.

## Coordinator retention safeguard

The first passing word run exposed a provenance gap: the next suite's isolation cleared its transient ComfyUI history. That gap remains recorded. The test harness now saves complete GPU history before moving records and clearing history, and stops the gate if that save fails. This preserves records/history on failure. The actual extracted shell helper passed [three controlled checks](gpu_history_preservation_check.json): successful archive/reset, failed read without reset, and an unset GPU base. No real service was touched by those checks, and no new inference rerun was used to manufacture old evidence.
