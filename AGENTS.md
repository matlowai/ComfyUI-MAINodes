# ComfyUI-MAINodes: notes for coding agents

Custom nodes for MiniMax H3 (Motion Lab, Dials, Contact-Sheet, RelayVSR) and Snap, a snap-together view over the
ComfyUI graph with agent tools. People start at [`README.md`](README.md).

## Where things are

| you want to | read |
|---|---|
| drive Snap with its tools | [`docs/snap/AGENT_START.md`](docs/snap/AGENT_START.md) |
| understand how Snap links together and how agent instructions nest | skill `snap-core` (`.claude/skills/snap-core/SKILL.md`) |
| make something well with Snap (locations, turnarounds, new views, upscales, boards, voices, the critic, model per job) | the task skills beside it: `snap-location`, `snap-turnaround`, `snap-new-view`, `snap-reference-upscale`, `snap-boards`, `snap-voice`, `snap-critic`, `snap-model-choice` |
| see or change what agents are told (the instruction stack, the person's versions of skills) | the Agent library in Snap (Library rail), or the `instructions` / `list_skills` tools (`docs/snap/AGENT_START.md` §2) |
| use the Snap skills from a Claude Code session outside the pack | `bash tools/snap_skills.sh link` (symlinks into `~/.claude/skills/`; `unlink`, `status`) |
| change Snap's code | [`docs/snap/SNAP_RULES.md`](docs/snap/SNAP_RULES.md) (rule IDs), then `docs/snap/` (DECISIONS, LESSONS, PLAN) |
| run or add to Snap's gate | [`tests/snap/README.md`](tests/snap/README.md) (`run_all.sh`, the env file, the local fixtures) |
| try the Snap branch as a tester | [`docs/snap/README.md`](docs/snap/README.md) |
| Dials, Motion Lab, RelayVSR, low VRAM | `dials/README.md`, `docs/MOTION_LAB.md`, `relayvsr/README.md`, `LOWVRAM.md` |

## Rules for changes

- Each Snap module starts with a short header naming the rules that govern it by ID
  (`// SNAP-R1 generic pass-through · see docs/snap/SNAP_RULES.md`). A line that would otherwise look wrong gets a one-line
  why citing its ID. A new rule takes the next free ID (the file says which); IDs are never renumbered.
- No machine-specific absolute paths, usernames or personal names in code, docs or commit messages.
- Never trim what an agent reads: tool and route results, CLI and MCP output, lists, metadata and error text come back
  whole; page explicitly with a full count (SNAP-R58).
- Snap makes no internet requests and downloads nothing; it proposes, and the person or their agent runs the command
  (SNAP-R18, R25). Weights are safetensors only: no new `torch.load` or pickle paths.
- Snap reads what a node exposes, generically; never per-node code (SNAP-R1). It warns and never blocks (SNAP-R11).
- New node inputs go at the end: saved workflows store widget values by position.
- Judge UI changes from real screenshots, as a product (SNAP-R8).
- When Snap can't do a job, change Snap; don't route around it with a side graph.
- Before adding a third-party node pack, read its code and grep this pack for its node ids (MAINodes already ships some
  nodes that standalone packs also register).

## Traps that recur

- `replaceChildren(a, cond ? b : null)` prints "null": filter the children first.
- `node --check f.js` can pass a broken ES module: check a `.mjs` copy (`cp f.js /tmp/x.mjs && node --check /tmp/x.mjs`).
- `pkill -f <pattern>` kills your own shell when the pattern is in its command line: find the pid with `pgrep -af`.
- Don't edit a shell script while it runs (bash reads it by byte offset); don't edit the worktree while its gate runs.
- After a pack Python change, restart every ComfyUI that loads the pack; an open tab keeps its old tool table until
  reloaded.
