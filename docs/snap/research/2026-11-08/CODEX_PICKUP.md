# Codex pickup — local workspace, 2026-11-08

READ FIRST for Codex sessions on Snap. This is a local-only index into the existing study, not a second plan.
The setup task does not resume rendering, gates, publishing or overnight work.

## Read only what the current job needs

1. `comfyui-core/PROJECTS.md`: standing rules and project map.
2. This file, then `WRAPUP_2026-11-07.md` and the opening READ FIRST box in `HANDOFF.md` in this folder.
3. For the selected job: `DECISIONS.md`, relevant complete sections of `LESSONS.md`, `PLAN.md`, and its design doc.
   Page long files explicitly; keep each page complete. Delegate oversized research rather than trimming it.
4. For coding: the chosen MAINodes worktree's `AGENTS.md` and `docs/snap/SNAP_RULES.md`.
5. For driving Snap: `$snap-core`, then the task skill, and the serving pack's `docs/snap/AGENT_START.md`.
   Read the resolved `instructions` for the target and `read_skill` for the person's skill overrides before acting.
6. Before writing generation prompts: `PROMPT_CRAFT_RULES_2026-11-07.md`, section 0.

All unqualified study filenames above are in this folder. Skill wrappers contain full canonical source paths;
resolve a source skill's relative references against its source directory, not the wrapper directory.

## Verified state at pickup

- Dev: `pack`, HEAD `28a4351`.
  G17b code is `df30beb`; the next two commits update wrap-up docs. Cached WIP remote ref matches HEAD.
- Live: `live-pack`, HEAD `8542b92`, also cached `origin/snap`.
  The live base's MAINodes symlink resolves here. Cached refs are not a fresh GitHub verification.
- `http://127.0.0.1:8193/queue` responded with no running or pending jobs during pickup.
  GPU idleness and systemd service status were not verified: driver/session-bus access failed in the sandbox.
- G17b remains ungated by the coordinator. Its full gate, GPU Voice QA, GPU set-reference check and real-agent
  critic fixture run remain open. A builder gate against an earlier snapshot does not establish final-code success.
- Latest duel preview:
  `local-workspace/dataset/research/delta-surgery/studies/2026-11-05-anime-dogfood/seq02/cut/seq02_nine_ring_cut1f_preview_chamber.mp4`.
  Read `seq02/STUDIO.md`'s newest header in that dogfood folder: chamber s303, C4 alternate `take-e9018389`,
  C5 `take-1964dd5c` (wand starts up then lowers; coin palm stays up), C6 tail trimmed. The full edit in Snap/Astrid
  is still pending; the ffmpeg preview is not proof of an updated export or timeline.

Recheck git, serving pack and queue before doing runtime work. Old Claude agent IDs are historical, not resumable agents.

## Corrections to older notes

- Actual rules and entrypoint are `docs/snap/SNAP_RULES.md` and `docs/snap/AGENT_START.md`.
- G17b was pushed as WIP; older "not pushed" rows are stale. Do not interpret WIP as gate approval.
- The latest STUDIO header supersedes its older active-take table and undecided music notes.
- Attach to existing visible agent Chrome on CDP `127.0.0.1:9222`; no duplicate page and no headless browser.
  Follow PROJECTS' Agent Chrome section and AGENT_START page ownership rules; another tab needs permission.
  The wrap-up's generic "new tab" line is stale.
- Dylan's own name and SFW relative paths are allowed in repo text. Keep absolute machine paths, other private
  identities and credentials out of published material. Trigger names in text are allowed; private weights stay private.
- For extension choices, read `U46h_ROLLING_REFS_2026-11-07.md`; older model-choice summaries predate that verdict.
- The pause for babysat Codex work supersedes older "keep idle GPUs working overnight" advice.

## Codex setup

Repo-local `.agents/skills/snap-*` entries link to ten small validated wrappers under
`coordinator_tools/codex/skills/`. The wrappers read the original pack skills; no fork of their guidance is maintained.
The trusted project config at `comfyui-core/.codex/config.toml` registers `comfy-snap`
using `local-runtime/python3`, the live pack's `tools/snap_mcp.py`, and loopback `http://127.0.0.1:8193`.
The MCP bridge assigns each connection its own name; do not hardcode a shared SNAP_AGENT across subagents.
Start a fresh Codex session here if new tools or skills do not appear. Current sessions can use `snapcall.py`.

Read `GET /mainodes/snap/info` to locate the serving pack; its path can differ from the coding checkout.
Read the live tools before invoking a capability described in dev skills: live remains G17a while dev includes G17b.
The setup preserves existing model, reasoning, compaction and approval settings. Claude permission JSON is not a
Codex approval policy. No blanket permission is added for pushes, deletion, downloads or disclosure.

## Coordinator work

Use fresh subagents for substantial independent jobs, one writer per file/worktree. Inherit the session's model unless
Dylan requests otherwise; the old Sonnet/Opus labels describe Claude's setup. Brief each worker with ordered source
files, decisions, scope, deliverables, verification and notes to update. Verify its claims independently.
Update READ FIRST, PROGRESS and LESSONS as work happens. Keep the existing PLAN as the task DAG.

The next project job is G17b verification; the ordered project backlog stays in WRAPUP and PLAN.
No gate, live checkout move, push, render or Astrid edit is implied by opening this pickup file.

## 2026-11-08 follow-up

Map/model/set-design work is recorded in `MAP_CONTINUITY_EXPERIMENT_2026-11-08.md` and the latest HANDOFF box. The workspace now also discovers `snap-set-design` directly from its canonical development skill (in addition to the ten wrappers). Five live Agent-library notes cover sequence state, map trial, export review, whole-set review and model-order fallback. Development has local skill/rule updates and an explicit Qwen2.1 view adapter; main G17a code remains unchanged. Full regression gating and production landing are still separate work.

## Latest visual-collage recovery

Start `VISUAL_COLLAGE_PLAN_2026-11-08.md` and `visual_collage_2026-11-08/regeneration/RECOVERY_REPORT.md`. The user meant actual textured bird's-eye scenery plus real actor cutouts, not schematic dots. Six assets survived the GNOME Shell crash; twelve resumed tests completed. Native partial init is implemented/tested in development (R270), not main. Review page `regeneration/recovery_index.html`, poster `COLLAGE_OVERVIEW.jpg`. All workers finished, bindings released, lab stopped, main healthy. Full regression gating/production landing remain separate.
