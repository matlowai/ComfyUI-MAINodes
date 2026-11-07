---
name: snap-core
description: >
  How Snap (the MAINodes view over the ComfyUI graph) fits together and how its agent instructions nest. Read this
  first whenever you drive Snap's tools (WebMCP, MCP, snapcall), make anything in Snap (a take, a scene, a Cast, a
  location, a board, a short), or change Snap's code, and before any other snap-* skill. Covers graph, bricks and
  setups, takes, scenes and shots, Cast and world versions, locations and plates, candidates, the Work card, the Book,
  pages and the agents' window, and the instruction stack (pack, install, person, Book, scene, shot, take).
scope: [global]
rules: [SNAP-R1, SNAP-R2, SNAP-R9, SNAP-R11, SNAP-R14, SNAP-R16, SNAP-R17, SNAP-R19, SNAP-R23, SNAP-R24, SNAP-R25, SNAP-R28, SNAP-R30, SNAP-R58, SNAP-R59, SNAP-R60, SNAP-R61, SNAP-R63, SNAP-R65, SNAP-R67, SNAP-R68, SNAP-R73, SNAP-R83, SNAP-R84, SNAP-R90, SNAP-R135, SNAP-R146, SNAP-R149, SNAP-R150, SNAP-R151, SNAP-R152, SNAP-R197, SNAP-R198, SNAP-R199, SNAP-R200]
---

If a Snap server is reachable, `read_skill {"name": "snap-core"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# Snap core: how the pieces link

How to call each tool is in `docs/snap/AGENT_START.md` (start there for setup, pages and the call shape). This skill is
the map; the task skills (`snap-location`, `snap-turnaround`, `snap-new-view`, `snap-reference-upscale`,
`snap-boards`, `snap-voice`, `snap-critic`, `snap-model-choice`, `snap-book`) say how to do each job well. Rules are
`docs/snap/SNAP_RULES.md` (SNAP-Rn).

## The layers

- **Graph.** Plain ComfyUI nodes and links. A saved workflow is plain ComfyUI plus `extra.snap`, and edits round-trip
  both ways (SNAP-R2). Snap reads what each node exposes, generically (SNAP-R1).
- **Snap.** Bricks over that graph: a recipe is a chain of bricks; a **setup** owns the whole model set (SNAP-R9);
  **method slots** (upscale, turbo, extend, edit, view, sheet) are chips over interchangeable methods from the
  registry (SNAP-R14).
- **The Book** (layer 3, SNAP-R67-R69, R130-R133; skill `snap-book`): a production's story as beats on the story
  clock, its production style, settei per state, cuts compiled at their beat, boards, the animatic and the Cut, on the
  same tool table and record store. Story, style and the dial are the person's: your edits to them are proposals.
- **One tool table** drives all of it: Snap's own UI, WebMCP in the page, and MCP / snapcall from outside call the
  same functions (SNAP-R19, R30).

## The records and how they link

| record | holds | links to |
|---|---|---|
| **take** | what ran (workflow, executed prompt, outputs), read from ComfyUI's history | its shot; its parent take (a version: an edit, an upscale, a longer take); the world versions it pinned |
| **scene → shot** | a scene is a document: its set, its shots in order; each shot has its workflow, its takes, one active take (SNAP-R24) | takes by id; tabs are only scratch |
| **Cast** | name, trigger, details, identity LoRA, reference pictures, voice (SNAP-R59, R73) | versioned; recipes and takes pin `cast:<id>@n` (SNAP-R60) |
| **location** | plan, master, camera map, named plates with camera pose (SNAP-R84) | shots cite plates; plates come from takes' frames |
| **decision** | N candidates of one "make N, keep one" step, each with provenance and notes (SNAP-R23) | `apply_candidate` makes one a shot's take; agents' picks wait as proposals unless agents may run (SNAP-R16) |
| **job** | every asynchronous run, edit, check, proposal (SNAP-R65) | the Work card (`list_activity`, `wait_for`); its take's card; its shot |
| **book → story, look** | a production: the story's beats with state changes (story and telling order), the production style, the dial per stage (SNAP-R67, R130) | its scenes' shots are its cuts (`shot.unit`); takes of a cut carry `story` {ref, beat, from} beside `world` (SNAP-R68) |

**Walk it with `nearby {ref}`** (SNAP-R197..R199): for any take, record or picture path it says what the thing is (a
still or a frame of a video, its kind, its cut, active or approved, the model and the pictures it was made from) and
lists its neighbours both ways (the cut's boards and video takes, the other candidates, what it was made from and what
was made from it, the Cast and location versions it cites, its beat, its critiques), each a tile with a ref to step to.
Read it before judging or reusing a picture you didn't make; the person has the same as the Nearby modal.

Every save of a world record is a new version, kept forever; a take re-runs as it was, with today's world, or with
swaps (SNAP-R60, R61, R63). A fix to an upstream record re-runs what pinned it (SNAP-R90, `snap-critic`).
Labels by person and by agent stay apart (SNAP-R17).

## How instructions nest (SNAP-R93-R95)

Every call in Snap runs under one resolved stack of agent instructions. Read it before you act, and read all of it
(SNAP-R58):

- `instructions {}` gives the stack for the open recipe; `instructions {"scope": "tool:edit_from_context"}` (or
  `brick:render`, `scene:<id>`, `shot:<scene>/<shot>`, `take:<id>`, `cast:<id>`, `location:<id>`) for one target.
  `describe_recipe.instructions` and `get_take.instructions` carry it too, and each tool's description ends with the
  pack's notes for that tool.
- **Layers, outer to inner:** pack (ships with Snap: `snap_cards/pack_notes.json` and these skills) → install (notes an
  admin shared, on a gated install) → person (their own notes, including which model does which job) → Book → scene →
  shot → take, plus notes on any record the recipe pins (a Cast, a location).
- **Scope** is one target at one level: `global`, `tool:<name>`, `brick:<key>`, `method:<id>`, a record
  (`cast:<id>`, `location:<id>`, `card:<id>`), `scene:<id>`, `shot:<scene>/<shot>`, `take:<id>`. A rule for the
  whole project (until the Book has its own scope) is `global`, or `scene:<id>` for one scene; a rule for one job
  is `tool:<name>`.
- **Kinds:** `note` (a line you read whole) and `model_choice` (job → choice, why). Inner notes add to outer ones; a
  note `replace`s an outer one only by naming it in `supersedes`. Two `model_choice` notes for the same job: the inner
  layer wins (the outer is listed under `overridden`); in the same layer they are a `conflict`: ask the person or take
  the newer.
- **Writing:** `save_instruction` makes or changes a note; it applies at once, marked "new from <you>" in the person's
  Agent library until they look, with one click to turn it off (SNAP-R95). When the person says "change that", save a
  new version of their note (`id`) instead of adding another. Turning off a note the person or the pack wrote waits as
  a proposal (`set_instruction_status`); your own notes go off at once. Imported notes land off.
- **Provenance:** every queued run pins the stack (`extra.snap.instructions`: refs and the off list); `get_take`
  says what it ran under, what applies now and what changed (`same`, `diff`), so a bad take can be traced to its
  instructions. The stack hash ignores skills (read on demand).
- **Skills:** `list_skills` and `read_skill {"name"}` return the whole text, the person's version when they have one
  (`yours`); `save_skill` saves your edit of a skill as their new version. What you learn about using Snap goes into a
  skill or a note this way, not into your own memory.
- The person sees all of it in the **Agent library** (Library rail, and the "Agent instructions" button on bricks,
  scenes, shots, takes and Cast records): skills, every note with its author and source, and what applies here.

## Pages and who drives

- Work in the person's main tab (they turned "Let agents see" on) or the agents' window: one visible Chrome that
  agents attach to and reload; never headless; another tab only with the person's yes (SNAP-R83, AGENT_START §1).
- Bind your page with `use_page`; one agent drives a page at a time (SNAP-R30). Name every call (SNAP_AGENT). When your
  job ends, let go: `use_page {"page": null}`; a hold with no call for 10 minutes lapses by itself (SNAP-R135), unless
  you hold a claimed critique or a run of yours is on the queue (SNAP-R146).
- GPU-spending tools wait as proposals unless the person lets agents run (SNAP-R16). Downloads and installs always
  wait for the person's yes; Snap itself never downloads (SNAP-R25).

## Working rules

- **Consistency is data, not prompting.** Words make a new place and a new design every render. Carry pictures and
  state: a location's master and plates, Cast records with turnarounds, positions and facing from cut to cut. One
  continuous H3 video holds a place or a character together; separate stills guess each view again.
- **Look before you say.** A version number says what Snap put in, not what the model drew: look at frames
  (`take_frames`, whole frames at 100 %) before telling the person how a take looks (`snap-critic`).
- **Results are never trimmed** (SNAP-R58); if one is too big, save it and hand it to a subagent.
- **When Snap can't do it, it's a Snap gap.** A take queued outside Snap (raw API, a side graph) never shows in its
  shot, its Cast pins or the Work card. Tell the person what you tried, the tool and its answer, so the route gets
  built into Snap; don't route around it.
- Before installing a node pack, read its code (the person's code-review setting, SNAP-R28) and grep the installed
  packs for its node ids. Weights are safetensors only.
- Warn, never block; marks inform (SNAP-R11).
- **A change to part of a picture is a region edit** (SNAP-R190, R191): for a face, eyewear, a hand or a prop, crop that
  part of Picture 1 and paste it back (`edit_from_context {paste_back: true}`); a whole-picture edit turns heads (a face
  looking away turned 4/4). Take the crop past where a thin thing crossing it ends, and read each candidate's seam note.
  A flaw in a Cast's own picture is fixed the same way and saved with `use_take … replace` as a proposal (SNAP-R196).
- **Keep the GPU working toward the goal.** The operator, 2026-11-06: "find useful things to keep GPU busy and working
  towards a goal or learning". When the GPU is idle and the main job waits (on a person, a review, a list), start the
  next useful GPU work toward the goal; do the parts of a fix that are already known instead of waiting for the whole
  list; otherwise run a cheap experiment that teaches something, and write down what it taught. When the open question
  is the person's, make the options: render each (or the likely 2-3) side by side with a recommendation, so they
  pick from results; nothing becomes active until they pick (the operator: "even decisions that are mine to make, it
  might be worth doing it both ways or several options"). Still ask first for anything outward or irreversible
  (publishing, deleting, downloads, installs). Run it on the visible page. (A short once drew plans on the CPU while both GPUs
  sat idle, waiting on a critic list it partly didn't need.)
- **When seeds keep failing, change the approach, not the seed** (SNAP-R200; the operator, 2026-11-07: "if you fail
  with reroll seeds it's a sign the approach is wrong"). Two or three failed seeds of one recipe stop that recipe; don't
  roll more or ask yet. Step up the chain: wording → references or crop → method or tool → the source record that carries
  the flaw → a missing Snap capability (a finding, then a build). Try a few genuinely different approaches side by side
  before giving up; only a taste choice between working results goes to the person.
- **Due critiques are idle work too.** When your renders run, claim the critic's due rows (`list_critiques {"state":
  "due"}`, skill `snap-critic`): the Work card says "no critic on duty" while nobody does (SNAP-R101).
- **Pika at 6 steps is the quality standard** (SNAP-R149). Video takes run on the Pika setups at 6 steps; more steps
  is not a quality step up (20/30 steps drifted off the plate and the Cast). The "no turbo (20 steps)" presets are
  opt-in: never reach for them to "improve" a take, and never offer them as better. Voice references (12+ steps,
  `snap-voice`) and the audio pass in post are the exceptions.
- **Judge a take with its sound on** (SNAP-R150). A pick, a recommendation or an options page plays the takes with
  sound, not only frame sheets, and says what the audio does. Ask for subtle, diegetic sound; a sting, a "tada" hit,
  a clash burst or a game-style effect sinks a take whatever its picture does, so it is a finding.
- **Music is a reference input** (SNAP-R151): the production supplies it as an `<Audio n>` held across cuts; a take's
  prompt never asks for a score. Sound effects come after picture lock.
- **Parallel agents get disjoint finding ranges** (SNAP-R152): when you start agents that log findings side by side,
  give each its own ID range up front (F-H01..F-H49, F-H50..F-H99), so their rows never collide.
