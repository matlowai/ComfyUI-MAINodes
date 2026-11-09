# WIP qualification evidence — 2026-11-08

The current Director application code is commit `2830523`; `a34ac16` updates only four tool-census expectations (MCP 190 to 197; WebMCP 185 to 192) after adding seven Director tools. The [complete final verification matrix](FINAL_VERIFICATION_2026-11-08.md) records the broad run, exact correction sources and separate GPU qualifications. This is not a whole green CPU gate. This folder preserves the fresh visual critic failure, not a production pass.

The blind agent reviewed 32 packets with the unchanged current prompt, froze all notes before seeing answers, and caught 26/31 known defects with one confirmed false alarm against the existing manifest. Required floor: 27/31 and zero false alarms. The notes' SHA-256 is `a049d11e0dd0f31d0912c004ad036e3f56e30d45596273d7c49e773393b0b2cc`.

- [Frozen coverage and evidence limits](FRESH_CRITIC_FROZEN.md)
- [Full frozen notes](fresh_critic_results.jsonl)
- [Automatic score](fresh_critic_score_auto.json) and [confirmed score](fresh_critic_score_confirmed.json)
- [Complete manual confirmations and misses](FRESH_CRITIC_SCORER_NOTES.md)
- [Independent Astra diagnosis and proposed qualification follow-up](CRITIC_DIAGNOSIS_ASTRA.md)
- [Copy/source hash inventory](critic_evidence_manifest.json)

X32 is a physically real duplicated monocle: current R244 requires high severity, while the older fixture accepts only low/medium. That contract conflict should be reconciled explicitly; accepting it still leaves 26/31, below the catch floor. The other five static misses have usable pixels/context. Missing audio, copy metadata and full half-second video samples limit the newer passes; they do not explain the static misses. No prompt, fixture or frozen note was changed to obtain a passing score. Keep live on its existing revision.

Full local source evidence remains preserved. The copy manifest identifies the sole structural path sanitization in scored JSON; the blind results are byte-identical. No media or weights are copied here.

## Final verification and preserved native evidence

Read the [full report with all 215 original numeric results](FINAL_VERIFICATION_2026-11-08.md), [machine-readable matrix](final_verification_summary.json), [full local artifact/hash manifest](native_evidence_manifest.json), and [selected complete copy inventory](native_evidence_copies.json). Selected stdout, QA take/history data, word timeline/asset registry and set-reference provenance are copied under `native/`, with structural machine-path sanitization only. Original/copy hashes are explicit. Media, test environment/configuration files, full identity histories and the editable archive remain local, represented by their original hashes; they are not silently represented as shipped. The passing word run's raw history was cleared by the test harness before separate retention; its actual output/export remains, and no other history is relabeled as that pass.

Final corrections qualify native word timing/export 7/7, Voice QA 8/8, critic mechanics 11/11 and identity 7/7 on GPU. Director CPU tests are 79/79; native QA regression tests 9/9. The saved-workflow instruction-pin check remains 9/10, helper instruction pins are incomplete, and the fresh visual critic still fails its floor. Original resource-limited CPU analysis cases were interrupted and are not CPU numerical passes. Browser timing modes and all failures remain visible in the report.
