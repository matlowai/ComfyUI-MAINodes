# Partial-denoise implementation progress — 2026-11-08

- Read scout, project/pickup, core skill, relevant rules, native core contracts and existing stage2 path.
- Proposed one optional `denoise` argument to coordinator; agreed narrow P-H3/Qwen path and replay preservation.
- Added native target canvas query, first-picture encode, H3 AV audio retention and continuous partial schedule, Qwen native sampler denoise. Default graphs unchanged. No render or server reload.
- Focused CPU graph/provenance/tool/replay checks pass; existing Qwen graph test passes; three modified JS modules pass ES module syntax check; diff whitespace check passes. Native dev registry confirms all added node types present.
- Ready for coordinator diff review and runtime worker's dev-page reload/native execution. No image-quality claim.
