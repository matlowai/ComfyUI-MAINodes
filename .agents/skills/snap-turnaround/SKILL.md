---
name: snap-turnaround
description: 'Make a character''s turnaround and reference pictures in Snap that keep carried props, hair and costume consistent in every view: one continuous H3 orbit (an orbit LoRA such as ORB360), frames pulled at 90/180/270, then a Cast version. Use it whenever you design a character, make a Cast record or character sheet, need a back or side view, or a sheet lost or moved a prop (a floating sword, a scabbard on the wrong side).'
---

Read `snap-core` first, then read `.claude/skills/snap-turnaround/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-turnaround/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-turnaround"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
