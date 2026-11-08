# Bundle validation

2026-11-08, scoped to this new evidence directory and the stable cloud handoff.

- 60 complete sanitized source report/log/provenance copies; 264 media hash records and 44 saved native render execution records. Eleven existing whole-frame images, about 7.4 MB. Total bundle about 7.9 MB.
- All new text scanned case-insensitively for machine paths, private identities, host/drive/user references, email addresses, credential patterns and adult-content terms. Binary images scanned independently using `strings -a`. No path, identity, credential, email or binary-content matches.
- Four lexical content-term matches are the existing false-valued content-mark keys in the four complete native partial-init histories. Manual context review confirms each value is false, with rating pg, and the source/output images were inspected as SFW. These are metadata field names, not adult material. Histories remain complete apart from structural path sanitization.
- Every JSON file parsed. Every clickable relative Markdown link resolves, including cloud handoff links to repository rules and portable skills. Unshipped local evidence is labelled as a plain logical locator.
- PNG copies have no metadata. JPEG copies contain only standard JFIF fields and no EXIF/workflow text. Original candidate2 and S-plate pixels exactly match copied PNGs; whole-frame JPEG previews were individually inspected after encoding.
- Eighteen model-reference strings manually reviewed: standard H3/P-H3, Qwen2.1, SAM3.1 and DINOv3 method/helper artifacts, including basename duplicates. No weights copied. The PE_i2i name documents availability rather than actual original-Qwen encoder choice.
- Independent focused CPU checks passed: `node tests/snap/test_qwen21_graph.js` and `node tests/snap/test_view_init.js`. Full G17b regression/UI/GPU/critic gates and production landing remain open.

The full scan commands, scripts, replacement ledger and unabridged output remain in the local study's cloud_bundle_audit directory. No unresolved privacy issue was identified within this bundle; coordinator independent review remains required before any outward action.
