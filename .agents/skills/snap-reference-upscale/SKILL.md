---
name: snap-reference-upscale
description: 'Make a take or still bigger in Snap so it works as a reference: a stage 2 redraw (`upscale_take` `stage2`, light denoise with the take''s own recipe), then Tessera for 4K. Use it whenever a Cast picture, turnaround, plate, settei or board is too small or its face looks smeared, before a picture becomes a reference, or when the person asks for 2K or 4K.'
---

Read `snap-core` first, then read `.claude/skills/snap-reference-upscale/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-reference-upscale/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-reference-upscale"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
