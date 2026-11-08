---
name: snap-core
description: How Snap (the MAINodes view over the ComfyUI graph) fits together and how its agent instructions nest. Read this first whenever you drive Snap's tools (WebMCP, MCP, snapcall), make anything in Snap (a take, a scene, a Cast, a location, a board, a short), or change Snap's code, and before any other snap-* skill. Covers graph, bricks and setups, takes, scenes and shots, Cast and world versions, locations and plates, candidates, the Work card, the Book, pages and the agents' window, and the instruction stack (pack, install, person, Book, scene, shot, take).
---

Read `.claude/skills/snap-core/SKILL.md` in full from the MAINodes repository root
(the directory containing `AGENTS.md` and `.claude/skills/`). That file is the canonical guidance.
Resolve its skill-local references against `.claude/skills/snap-core/`; resolve `docs/` and `tools/` paths
against the repository root.

When a Snap server is reachable, read its current tool table, the resolved `instructions` for your target,
and `read_skill {"name": "snap-core"}` for the person's overrides. The serving pack can differ from this
checkout; confirm live capabilities before using a tool or method described here. Without a server, use the
repository guidance and report runtime checks as unverified.
