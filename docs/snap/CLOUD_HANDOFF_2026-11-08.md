# Cloud pickup — 2026-11-08

> **READ FIRST:** Use the [current session evidence and corrections](research/2026-11-08/README.md), then [canonical Snap rules](SNAP_RULES.md) and the relevant [portable snap-core entrypoint](../../.agents/skills/snap-core/SKILL.md). Read the task skill before driving Snap. All source, reports and tests are WIP; no full G17b gate or production readiness is claimed. Main serving pack remains G17a `8542b92` at this capture.

Checkpoint branch: `snap-research-2026-11-08`, based on `28a4351`. This is a research WIP for cloud code review, not the gated `snap` branch.

The original terrace is rectangular. Earlier square-aerial and camera-plate-conditioned “transfer” successes were confounded. Current R271 requires a textured top view plus at least one genuine side/elevation, preferably two; aerial-only was an explicitly requested ablation. Preserve the person's raw candidate2 choice and all negative results. Check the evidence README for the bounded top/side trial's current result/status.

From the repository root:

```sh
git diff 28a4351..HEAD
node tests/snap/test_qwen21_graph.js
node tests/snap/test_view_init.js
git diff --check
```

Before the WIP is committed, `git diff 28a4351` includes the working-tree changes. The two Node tests run without weights or a GPU server; they verify native graph contracts, not image quality or full UI/regression behavior. The README lists open GPU, critic-fixture and production-landing gates, complete sanitized reports, exact partial-init histories, selected images and media hashes.

Runtime addresses and local evidence names in historical reports are capture facts. Recheck the serving pack, live tool schemas, scoped instructions, page ownership and queue before runtime work. Cloud-only access cannot certify missing native media, listening or GPU behavior. Keep machine-specific installation/configuration and original assets local. Coordinator owns final review, commit and any outward action.
