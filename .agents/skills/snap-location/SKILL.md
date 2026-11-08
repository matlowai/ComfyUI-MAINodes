---
name: snap-location
description: 'Build a location in Snap that stays the same place in every shot: set plan, master establishing picture, a people-free H3 walkthrough, plates pulled from its frames with their camera pose, then boards placed on plates. Use it whenever a short, scene or shot needs a place (a village, a room, a street), when views of one place disagree (a gate that changes between cuts), or before making plates or boards of a set.'
---

Read `snap-core` first, then read `.claude/skills/snap-location/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-location/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-location"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
