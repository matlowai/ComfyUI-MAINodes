---
name: snap-new-view
description: 'Make a new still from context pictures in Snap (`edit_from_context`, "New view from these pictures"): a board, a plate, a two-shot, a callout, or a targeted edit such as changing only the eyes or a prop. Use it whenever you make a still of a known place or character, edit one detail of a still, or a New view candidate came back wrong (copied the master, turned the head, lost the set).'
---

Read `snap-core` first, then read `.claude/skills/snap-new-view/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-new-view/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-new-view"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
