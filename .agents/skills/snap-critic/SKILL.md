---
name: snap-critic
description: 'The critic in Snap: claim the critique rows Snap puts on the docket for every landed take, board, sheet, plate, master, location version and cut pair, read each packet (whole frames first, then tiles, then context) with the measured r4 prompt below, and write the verdict and notes (severity, pass, region, owner, fix) back; then fix a flaw at its source record and re-run what depended on it. Use it whenever critiques are due (list_critiques), before you call any picture good or show results to the person, after a batch of candidates lands, and whenever a flaw comes back after a re-roll.'
---

Read `snap-core` first, then read `.claude/skills/snap-critic/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-critic/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-critic"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
