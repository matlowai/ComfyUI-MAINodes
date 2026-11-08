---
name: snap-voice
description: 'Cast and keep a character''s voice in Snap: a casting description, a talking take as the anchor, a clean 3-6 s voice reference made at 12 or more steps, saved on the Cast and cited as Audio n in every cut where the character speaks, then measured. Use it whenever a character speaks, a short has dialogue, voices sound alike or change between cuts, or you make voice settei.'
---

Read `snap-core` first, then read `.claude/skills/snap-voice/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-voice/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-voice"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
