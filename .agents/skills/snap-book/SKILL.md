---
name: snap-book
description: 'Run a production in Snap''s Book: a story as beats with state changes, a production style, settei per state, cuts compiled at their beat, boards and an animatic before video, then the Cut as one mp4 and an OTIO file. Use it whenever you set up or work on a short, an episode or any multi-cut piece in a Book, write or extract beats (the writers'' room, the script supervisor), check continuity of who holds or wears what, plan cuts, make boards, play an animatic or assemble the edit.'
---

Read `snap-core` first, then read `.claude/skills/snap-book/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-book/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-book"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
