---
name: snap-model-choice
description: Which model or method to pick for each job in Snap (new views, targeted edits, turnarounds and sheets, making a reference bigger, 4K, video cuts, longer takes, Change something), with the measured reason for each. Use it whenever you choose a `method`, setup or slot in Snap, compare models for a job, or the person asks "which model should do this". These are pack defaults; the person's own model-per-job notes override them.
---

Read `snap-core` first, then read `.claude/skills/snap-model-choice/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-model-choice/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-model-choice"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
