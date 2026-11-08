---
name: snap-boards
description: 'Plan a short or scene in Snap the way a studio does: design lane first, then one board per cut, an animatic and cut-pair checks, and only then video cuts rendered from approved boards, with the H3 prompt craft for style and sound. Use it whenever you make a short, a scene with several cuts, a trailer, or any multi-shot video in Snap, or when cuts don''t connect (wrong positions, jumps in light, weak climax).'
---

Read `snap-core` first, then read `.claude/skills/snap-boards/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-boards/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-boards"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
