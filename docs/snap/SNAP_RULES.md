# Snap design rules

Code cites these by ID, e.g. `// SNAP-R3: faces show outcomes`. Each rule has a one-line statement, why it exists,
and where the full story lives. Study docs are in the research folder
the Snap study notes (local to the operator's machine): LESSONS.md, MODEL_SWITCHING.md,
MODEL_GRAPH_ONBOARDING.md, UX_SPEC.md, CONCEPT.md.

When a rule changes, edit it here and keep its ID. Retired IDs stay listed as "retired", so old comments still resolve.

How to use Snap well (how the pieces link, the order of work, which model for which job, traps and quality bars) is
in the Snap skills (`.claude/skills/`: `snap-core` first, then the task skills); these rules say how Snap must behave.

## Graph and generic behaviour

- **SNAP-R1: Generic pass-through, never per-node code.** Snap reads what a node exposes: widget types, options,
  limits, upload flags, DOM panels, previews, wiring. A pack node may offer a small interface that Snap reads
  generically (`node.presets`). Curated pack bricks only choose which values show on their face.
  *Why:* there are thousands of custom nodes; Snap must work with all of them. *More:* LESSONS "Generic pass-through".
- **SNAP-R2: The graph is the source of truth, and edits round-trip both ways.** The workflow stays plain ComfyUI plus
  `extra.snap`. Anything edited in the graph view (a value, a swapped node, a new upscaler) shows up sensibly in Snap.
  Anything that shows a widget's value re-reads it when the widget changes, from any source (graph, agent, another
  panel). *Why:* the stale side panel and the old Dial Rack both showed wrong data as current. *More:* LESSONS
  "kept its own copy of rows".
- **SNAP-R3: A value that doesn't resolve stays visible as missing.** Never silently drop it or let a default stand
  in. A file that's listed but unreadable is missing too. Basename matching (one unique match in any sub-folder) is
  the only allowed resolution. *Why:* the recipe once looked fine while it would have rendered the wrong models.
  *More:* MODEL_SWITCHING §5.

## Faces and interaction

- **SNAP-R4: Faces show outcomes in the person's terms.** Each decision gets one control. Never show what the brick's
  presence already implies. Example: Upscale shows `1280×704 → 2560×1408` and `Off · 2× · 4×`, not the model variant
  and a scale number, and Render says nothing about upscaling. Implementation details (model variant, tiers, knobs)
  live in the inspector. *More:* MODEL_GRAPH_ONBOARDING §7.
- **SNAP-R5: Start/new never touches open work.** Starting a recipe on a non-empty graph, or switching model family,
  opens a new tab. In a scene tab, opening another shot saves the open one into its scene first (SNAP-R24). A re-take or
  re-run loads the take's graph into the shot's tab only while that tab holds the shot's saved workflow (the load is an
  Undo step); a tab with unsaved changes keeps them, and the take's graph opens in a new tab of the same shot ("From take
  2 · …"), so the new take still lands under the shot. The comparison is the frontend's own (`graphEqual`), on JSON,
  without the shot mark or node sizes (drawing resizes nodes). *More:* LESSONS "Start/new", "Batch E".
- **SNAP-R6: Panels close only when the person asks.** The side panel collapses from its header button (the brick's
  icon + ›) or Esc, never from presses on the chain, empty space or a scrollbar. *Why:* a pointerdown on a scroll
  container also fires for its scrollbar. *More:* LESSONS.
- **SNAP-R7: Lists that can re-render keep their elements while a pointer is down.** ComfyUI checks for graph changes
  on every mouseup/keyup and re-renders Snap, so a toggle on pointerup survives where a click does not. *More:* LESSONS
  "ComfyUI frontend traps".
- **SNAP-R8: Judge UI from real screenshots, as a product.** Green tests are not enough. Test with realistic data
  sizes (83 dials, 900 LoRAs).

## Models, setups, LoRAs

- **SNAP-R9: Setups own the whole model set.** A setup covers diffusion model, encoder + type, VAEs and core LoRAs.
  Applying one is a single undo step. In Snap the setup's bricks (Models + Render Preset; the image kit's Models + Core
  LoRAs) show as one Setup brick: family · model · turbo on its face, Models and Sampling sections when opened. The
  graph and the engine keep them separate (SNAP-R2); moving, removing or selecting the card acts on all of them. A family mismatch (e.g. an encoder type that doesn't fit the model) is shown,
  not left as an empty family. *More:* MODEL_SWITCHING §4.
- **SNAP-R10: Turbos are either merged into a checkpoint or are LoRAs.** Don't add a turbo LoRA on a turbo merge unless
  the person asks. Stacking N LoRAs, including 2-3 turbo LoRAs at lower strengths, is normal. Swapping turbos is one
  chip. A turbo can live in a core stack or in a recipe's one LoRA setting: H3's Render Preset `lora` holds its turbo
  (the Pika H3 Flex LoRAs are turbos: 6 steps, lcm, cfg 1 on Pika's manual knots; the operator, 2026-11-04: "pika is turbo"),
  so the Setup card and `describe_recipe` name it, and the Turbo slot swaps that setting with every sampling setting the
  turbo's model graph entry records, by the setting's own name: steps, cfg, sampler, scheduler, Pika's knots and H3's
  shifts (Pika 12 / 3, DMAD 12 / 2; U90). The slot lists the family's turbos with the ones for this model first: same Base / SFT lineage and the same
  base variant, which the model graph's family names (H3: ref2v, fl2v); the others stay listed, labelled ("made for
  ref2v; this model is fl2v"). *More:* MODEL_GRAPH_ONBOARDING §2, `web/snap/models.js` (`turbos`, `setTurbo`).
- **SNAP-R11: Warn and explain, never block.** Mismatches, odd stacks and degraded settings get a warning; the
  workflow still runs (ComfyUI AGENTS.md "User Input Tolerance"). An optional input with nothing to give is off, not
  a failure: First frame starts bypassed until it has a picture (the H3 Render's first frame is optional, so the run is
  text to video); a fresh recipe on a server with an empty input folder used to fail LoadImage's validation.
- **SNAP-R12: LoRAs have roles.** The roles are core (turbo / fix / task / hires / edit / control), style, identity
  and dial. Each role has its own home:
  - core rows go with the setup;
  - style rows go with the shot or recipe;
  - identity rows go with character cards;
  - dials go in the Dial Rack.

  Unknown LoRAs ask once, and the answer is remembered. The Library's "LoRAs by kind" chips and the LoRA sheet show one
  chip per category the model graph gives the files here (core · sub-kind, style, identity, dial, unsorted, and tags such
  as nsfw); "move to…" on any LoRA row, card or dial tile, or a row dropped on a chip, files it in the person's
  `snap/models.json` (person over pack), everything follows at once, and Undo puts the person's entry back
  (`set_lora_category` is the same function). Filing under any role but core·turbo writes `turbo: false`, so neither the
  pack nor the name keeps it a turbo; every write of that file reads it fresh inside one chain, so parallel filings all
  stand, and a read that fails (a 5xx) writes nothing (U76 M4, M5, L10). Identity LoRAs are private by default: never exported or
  shown on shared pages. *More:* MODEL_GRAPH_ONBOARDING §6.
- **SNAP-R26: A LoRA's name files it as a turbo only with a step count.** The model graph says first; with no entry, a
  name counts only with a sampling step count (16 or fewer, no digits after: `8step`, `4_steps`). Distillation words
  (dmd, dmad, lightx2v, lcm, causvid), "turbo" inside a name, "deband" and training step counts (`step1500`,
  `5000steps`) are not signals; such a LoRA is unsorted until an agent reads the file or the person files it
  (SNAP-R55). *Why:* concept LoRAs trained on a turbo model (`<concept>-krea-turbo`, an ai-toolkit run of 2500 steps)
  and training checkpoints (`..._v01_step1500`) showed as core·turbo on the live server (PLAN U67); the operator, 2026-11-04
  20:41: the kind is "checked by an LLM reading the LoRA itself (metadata, source), regardless of name, unless the
  name says something unambiguous like '4step'" (PLAN U84).
- **SNAP-R55: A LoRA's kind is judged by an agent reading the file; the person's filing wins.** Snap makes no LLM
  call (no internet; the agent is the LLM). `describe_lora {file}` returns what the file says about itself: its
  training metadata (ss_*), the tags it was trained on, trigger words, modelspec and other text fields, the rank its
  tensors have, size and folder, and how Snap files it now. `set_lora_category` takes `by` (agent, the default, or
  person when the person said it) and a short `reason`, kept in the person's `snap/models.json` as `filed: {by, reason,
  at}`; the LoRA sheet shows an agent's filing as "agent: <reason>" on the row. An agent filing a LoRA the person filed
  (move to…, or an entry of theirs from before `filed` existed) is refused, naming their filing: ask them or propose
  it. AGENT_START asks agents to work through the unsorted LoRAs that way. Never blocks a run. *Why:* the operator, 2026-11-04
  20:41 (PLAN U84). *More:* `snap_bridge.py` (`/mainodes/snap/lora_info`), `web/snap/models.js` (`moveTo`),
  `web/snap/tools.js`, `web/snap/loraview.js`.
- **SNAP-R13: Family rules come from the model graph, not code branches.** These include: MOSS SFT always carries a
  deband fix; MOSS Base wants long, concrete prompts, and its prompt expander ("✨ Enhance prompt (LLM)" on the
  Render) stays off by default because it can drop details; Krea Raw int8 is `int8_rowwise` and can't load in core.
  Pack entries are in `snap_cards/models.json`, and the person's own entries win. *More:* MODEL_GRAPH_ONBOARDING §1.
- **SNAP-R14: A method slot (upscale, turbo, and later others) is a chip over interchangeable implementations.** All
  share one face shape. A method wired in by hand in the graph still shows up, recognised by its wiring (one media
  input and the same type out), never by its name. Slots and methods are data: `snap_cards/methods.json` under the
  person's `snap/methods.json`. Render blueprints give their media (IMAGE, or H3's VIDEO with its sound), so a media
  slot is the bricks between the Render and Save; a workflow saved with the older H3 Render (Save and the RelayVSR switch
  inside it) runs as saved and offers a one-press upgrade. *More:* MODEL_GRAPH_ONBOARDING §7, scout/upscalers, UX_GEMS §5.

## Sets and continuity

- **SNAP-R21: A shot's reference picture shows that shot's own camera.** H3 copies whatever picture it is given, view
  included: one wide plate as every shot's reference became the wrong view in 8/12 takes (U21), a per-shot picture the
  right one 12/12 (U48). So a set keeps one people-free plate per camera, made by an orbit pass from its wide plate
  (H3 Ref2V, "the camera is not where <Picture 1> was taken" plus that camera's doors and windows). One render per
  camera is unreliable (U49 moved off the plate 8/9, U52 pass 1 copied 3/3), so each camera gets 2-3 renders as
  candidates (SNAP-R23) and the person picks. The copy score (DINOv3 patch tokens matched by grid position, threshold
  from the model graph: 0.72) marks a likely copy of the wide plate's view and the layout check says where each door,
  window and prop landed against the plan; neither rejects (push-ins score 0.56-0.68, like new views at 0.50-0.66).
  A shot that compiles with no plate for its camera gets its candidates made then; opening a scene's card shot with no
  plate offers them as a proposal (GPU time nobody asked for by opening it); "make all" does every camera. Each
  plate records its take, frame, copy score, seed, camera, who made it and who picked it; the person can swap any
  plate. The shot compiler sends the shot's plate with "seen from this camera", falls back to the wide plate with "the
  camera is not where <Picture N> was taken", and uses a plate as FL2V's first frame only when the shot card asks to
  start on that exact frame. A plate stops counting once its camera moves. The same score flags a take that copied its
  own reference picture's view (DINOv3's room score can't). *More:* U48_PER_SHOT_PLATES §3 and U49, `web/snap/plates.js`,
  `web/snap/checks.js`, `MAISnapCopyScore`.
- **SNAP-R22: Doors and windows are said from the shot's camera.** The set card names each opening and its wall (from
  the plan geometry); the set block says where each is for this camera ("the tall window in the east wall is on the
  right", "the door in the south wall is behind the camera, out of view"), computed, never typed per shot. *Why:* with
  props only, H3 and MOSS put the window on the wrong wall in every reverse shot of U21 and U48. *More:* `setsnap.js`
  `openings`.

- **SNAP-R23: A decision with several possible results shows them as candidates before anything changes.** Camera
  plates, an edit's anchor frames and later any "make N, keep one" step hold N candidates, each with its provenance
  (take, frame, seed, by) and pre-screen notes (copy score, layout against the plan, identity). The person previews a
  candidate in place (the plate slot or the take viewer shows it; nothing is edited), applies one (one step Undo takes
  back) or rejects one. A check only leaves a note: it never rejects alone, because every score so far overlaps between
  right and wrong somewhere. An edit's identity notes are two flags with thresholds from the model graph: "probably a
  different person" (the character score on a crop around SAM 3.1's face mask, below `character_check.different`,
  SNAP-R111; ArcFace until G1b) and "hair lighter than original" (SAM 3.1's hair mask, lit-hair L* p90 over the take's own frames above
  `hair_check.lighter`, U56b). An edit that `does` something in `identity_check.unreliable_for` (relighting: the same
  woman scores 0.34-0.60 at night) shows its scores as "identity unreliable under relighting" and never the
  different-person flag. What an edit does is its example's `does` (night, dusk, dawn: relight), else its method's:
  Change something in the person's own words is an edit and keeps the face check, whichever method runs it (the operator's
  "make her jacket sparkle magic" on Ripple was muted as a relight and a different woman went unflagged, batch E). A
  recast has no face check against the take (someone else is the point), but one painted from a Cast's picture compares
  each painted face with that picture: "probably not <name>" below the same threshold, else the number only ("character
  vs Lio's picture 0.72"), since above it no score ranks likeness (batch E GPU check: run 7's other-looking c2 scored
  ArcFace 0.72, the closer c1 0.53). Both miss things (dark frames and profiles score low, blonder hair doesn't show), so the
  head crops sit beside them and decide. Agents list and pre-screen candidates and recommend one; their apply / reject / undo waits
  for the person as a proposal unless "Let agents run" is on (SNAP-R16), and every pick records who made it (SNAP-R17).
  Any take's frame can be used as an input (First frame or a reference picture), and the brick remembers which take
  and frame it came from. *Why:* U49 and U52 showed one render per camera is unreliable, and U53b's edits drifted the
  person's hair; Krita's preview-then-Apply, Invoke's staging area and Runway's "use as input" (UX_GEMS #2).
  *More:* `web/snap/candidates.js`, `candidateview.js`, `edits.js`.

## Scenes

- **SNAP-R24: Scenes own the work; tabs are scratch.** A scene (user `snap/scenes/<id>.json`) is a document: a name,
  a set card, and its shots in order. Each shot has the workflow Snap keeps for it (`snap/scenes/<scene>/<shot>.json`),
  the take groups it gathers (graph ids, as takes record them), its takes by id with versions nested through their
  parent take (a night version, a take continued from another's last frame), and one active take. Takes keep their own
  store; a run in a shot's workflow or an edit of one of its takes joins the shot by itself. Opening a shot saves the
  open shot first and goes to a tab that already shows it (from a scratch tab, to the scene's own tab), then swaps the
  graph there. A scratch tab, or the tab of a saved workflow file, is never swapped (its next save would write another
  shot into that file): the shot opens in a new tab. Adopting a workflow's takes copies its graph with its id, so its
  take group keeps working, and leaves the workflow as it was. Above the chain the navigator shows where the tab is
  (Scene › Shot › Take › version, ending on the active take) and the scene's shots; in a scene tab the Takes strip is
  the shot's takes tree. The active take is the person's pick; an agent's waits as a proposal (SNAP-R16). Renaming
  and deleting delete nothing: a shot taken out of a scene stays in the scene's file under `removed` (its takes listed,
  its workflow file kept), and a deleted scene's document is parked in `snap/scenes/_parked/<id>.json` with its shot
  workflows and takes where they were; an agent's remove waits for the person. Switching model family inside a shot
  opens a scratch tab outside the scene, and the setups sheet says so (whether it should stay as a version of the shot
  is an open question for the operator). Ids are
  stable and the shots ordered; lanes and in/out on shots and takes come with the sequence editor (layer 3).
  *Why:* takes grouped by the workflow's own id, so a scene's shots and their variants scattered over tabs
  (NEXT_DESIGN_REVIEW §10 Q2); the operator (2026-11-04): "a scene should have the related work navigable and nested".
  *More:* `web/snap/scenes.js`, `web/snap/sceneview.js`; PLAN U59, scout/editor_layer §5.6-5.7.

## World state

- **SNAP-R59: Cast by reference: a character's details live once, on its Cast record.** A Cast record (user
  `snap/cast/<id>.json`, versioned by SNAP-R60) holds the name, alias, trigger words, the details line, the identity LoRA
  and strength (by file name), reference pictures (input/ files, in `input/snap/cast/<id>/` when uploaded), lore and a
  rating. The graph stays plain ComfyUI: `applyCast` writes one version into the recipe (a row on the Cast brick, the
  trigger + details sentence in the prompt's first line, the pictures in References with `source: cast:<id>`) and pins
  it in `extra.snap.world["cast:<id>"]` with where each piece went, so applying again (another version, or after a
  hand edit) replaces its own pieces in place. So every check that reads the queued prompt (the gate's cap, the pack's
  second line, privacy marks, metadata twins, the take hash, core's cache) still sees what runs, and the file runs in
  plain ComfyUI. Editing a character means editing the record (the Cast sheet, `save_cast`); a recipe changes only when
  the person applies it. The `character` card kind is `cast`. *Why:* the operator, 2026-11-04 20:48: "metadata for the cast rows
  should live with that cast record. the cast id would live on the image, not everything about the character itself";
  22:44: files carry what ran plus the pins (design Option C). *More:* `web/snap/library.js` (applyCast),
  `web/snap/castview.js`; DESIGN_U86_U87_CAST_VERSIONS_2026-11-04.md §4.1-4.2; PLAN U86.
  A Cast is in a recipe only while it is applied there (short03 F-C31: Maren walked into C5 and Liesl + Tam into C6):
  a shot copied from another starts without its Casts and locations, a Cast's line comes back into the prompt only
  while its pictures are in References or its LoRA row is on, and a take whose prompt has a Cast's line without its
  pictures says so. A Cast keeps each picture's and voice's hash, and a newer upload of the same name is said (F-C30).
- **SNAP-R60: World state is versioned, and a take pins the versions it used.** The records a take depends on (Cast
  records, set snapshots, the person's own Library cards) live one per file in user `snap/<kind>/<id>.json` with every
  version inside (`n`, a sha-256 `hash` of the body, `at`, `by`, `note`). Saving is versioning: a body equal to the head
  makes no version, any other is appended as the next number; no code edits or removes a version. Writes go through
  the pack's `/mainodes/snap/world/*` routes, one at a time on the server, so two pages can't drop each other's
  version. A set keeps its editor's working copy (`draft`, shown as the `<set>-mine` card) and its camera plates outside
  the versions. A reference is `kind:id@n`, or `kind:id` for the newest; a pack card is version 0. Model and LoRA files
  are pinned by name only. Every version is kept forever; archiving (`snap/_archived/`) keeps it resolvable. Cards from
  before records (`snap/cards/`) are wrapped once on load and the originals parked in `snap/_migrated/cards/`. Every
  apply path pins what it put in, in `extra.snap.world` (`{n, hash, name, follow, placed}`): applyCast, a set (its working
  copy saved first as an unlisted version, so a take never pins a draft), a shot card with its set and characters, a
  card's words, and the family recipe card a setup came from (`setup: true`, one at a time: the next setup replaces it;
  a setup that opens a new tab pins on that tab, and the tab it left keeps its own pins). A pack card's pin (version 0)
  keeps the card's hash: when a pack update changes the card it reads "<name> (the pack updated this card)" with the same
  one-press update, and "(no longer in the pack)" when the pack drops it. A take keeps the pins it ran with (`world`), and its stale flag names a record that moved on first
  ("Kon v1 → v2"), before the chain's own changes. A pinned reference never updates by itself: the brick that holds it
  shows "v2 available · update", one press. Scenes version their authored fields only (name, set, shots in order
  with names and cards) inside their own document; take lists, the active take and workflow files make no version. The
  set editor's "Save as version" takes a note. `get_record` and `diff_record` read any version and what changed, values
  whole. *Why:*
  the operator, 2026-11-04 20:49: "versioning so you can properly recall the state of what it was when it was generated and
  regenerate with updated world state, or with the old world state"; 20:51: keep every version, files by name. *More:*
  `web/snap/world.js`, `snap_world.py`; DESIGN_U86_U87_CAST_VERSIONS_2026-11-04.md §4.3; PLAN U87.

- **SNAP-R61: A take or a saved file re-runs as it was, with today's world, or edited first.** "As it was" runs the
  workflow the take or file holds, seed included: it already holds what each pinned version put in, so it reproduces
  even where a record has moved on or isn't here. "With today's world" updates each pinned record that moved on (or only
  the ones named) to its newest version first, through the same apply paths, and says what differs field by field.
  "Edit then run" opens the pinned versions in their editors; saving there makes a new version. A re-take opens in the
  shot's own scene tab when the take belongs to a shot (the take's whole graph, not widget by widget), else in a new
  tab, never on unrelated open work; its run carries `extra.snap.retake`, so the new take nests under the original as
  "Retake · as it was" / "Retake · today's world". An agent's retake spends GPU time, so it waits as a proposal with its
  plan (SNAP-R16). Saved files carry core's prompt and workflow (with `extra.snap.world`); with Save metadata off they
  carry nothing (SNAP-R38). *Why:* the operator, 2026-11-04 22:44: "open/drop a file in Snap → 'Run as it was' / 'Run with
  today's world' / 'Edit then run' … showing what differs". *More:* `web/snap/retake.js`, `web/snap/worldsheet.js`;
  DESIGN_U86_U87 §4.4; PLAN U87, U89 (swap any reference builds on it).

- **SNAP-R62: Clean-up is the person's choice; nothing is pruned by itself.** The World sheet (Library rail, "World:
  versions and sizes") lists every record biggest first with its versions, its bytes (its file and the input/
  pictures it names, from `/mainodes/snap/sizes`) and the takes that pin each version. Archive moves a record to
  `snap/_archived/` (out of the Library and pickers, still resolving, one press back). Export writes a zip to
  `output/snap_exports/` (manifest with refs, versions, hashes and files; the record files; their pictures; with takes,
  the takes that pin them and their files); import adds what isn't there and never renumbers a version (a clash is
  reported). Delete (a version or a record) first says how many takes pin it and that they still run as they were,
  and offers Export first; its pictures stay in input/. An agent's `delete_record` waits as a proposal (SNAP-R16's
  shape: it is the one step that can't be undone). *Why:* the operator, 2026-11-04 20:51: "keep every world-state version
  forever; when it grows, a clean-up UX offers archive / export (zip) / delete, always the person's choice".
  *More:* `web/snap/worldview.js`, `snap_world.py`; DESIGN_U86_U87 §4.5.
- **SNAP-R63: Re-run swaps any reference.** Every record a take (or a saved file) pinned is a slot that stays pinned, or
  goes to the newest version, a chosen version, or another record of its kind. Two slots are not records and say so: the
  scene (a different scene brings its set into the recipe; where the new take lands is a separate choice) and the Setup
  (the take's setup pin, else read from its prompt; Re-generate only). Re-generate opens the take's whole graph where it
  belongs, puts each swap in through the record's own apply, with the old record's pieces taken out first (its Cast row,
  sentence and pictures; a set's pictures and text; a card's words), keeps the take's seed unless asked for a new one,
  and nests the new take under the original ("Re-run · Kon → Mara"). A Cast a shot card compiled in is swapped by
  compiling that shot again, the card untouched and its pin marked `edited`. A swap that changes nothing the prompt holds
  is said before the run (core serves the take's own file): a note and a new-seed choice, never a refusal. Reuse the
  motion keeps the take's own video: a Cast swap is a recast painted from the new Cast's details line and its first
  picture (the paint's Picture 2; its LoRA can't reach Remake), a set, scene or card swap is a Change something, and a
  Setup or shot swap says it can't use the take's motion (Re-generate does it). A take shorter than Remake's 90 frames
  holds its last frame and is cut back. A list of choices is a batch: Re-generate gathers the takes as one decision's
  candidates (Apply = the shot's active take, Reject = the take's verdict, by whoever pressed it). The plan says the
  rating the run would have, and on a signed-in install that the server will refuse one above the cap. A file saved
  without metadata re-runs from the take it is. Errors name the take's slots and every choice of a slot. A changed
  reference picture reads "front picture changed" with both pictures and their file names on the sheets; the tools keep
  the whole refs line in `fields` and add `pictures` [{role, was, now}] (SNAP-R58). *Why:* the operator, 2026-11-04 22:45: "run as it was, run with today's world,
  run with a version or a different scene, run scene with different characters... think Disney re-running the same
  animations with different movies and characters but same motions"; coordinator calls 2026-11-05 03:34. *More:* PLAN
  U89, DESIGN_U89_RERUN_SWAPS_2026-11-05.md, `web/snap/rerun.js`.

## Onboarding

- **SNAP-R25: Onboarding proposes; it never downloads.** "I'm new, help me set up" asks at most six things, each with a
  default and Skip: what to make, look through the models, metadata in outputs (it sets the SNAP-R20 switch), SFW only,
  which tasks may use API models (none by default), and whether agents read new code first (SNAP-R28). Hardware is read from `/system_stats`, never asked. It opens by itself once, on the first Snap visit with no
  profile; that visit writes the profile, so closing or skipping is final. Answers go
  in user `snap/profile.json`, saved per step, so it resumes; reopened it asks only what's new ("Add a capability").
  It ends on a kit per intent: the recommended setup for this machine (ready first, then one whose missing files all
  have a download), a fast option, alternatives on request, each with good-at, VRAM fit and an evidence grade with a
  date and the hardware it was measured on, said in words ("measured on an RTX 5090 (32 GB)", never "this machine": the
  page may run elsewhere) (measured / community-measured / community opinion / untested); no measured fast option says so; "Open in new tabs" opens one
  recommended setup per intent (SNAP-R5). Kits are data (`snap_cards/kits.json`): they name setups, and a file's
  folder, size, source, link and license come from the model graph, a method's needs from the method registry. What's
  missing is listed with exact files, sizes, targets and a command, node packs with author, repo, license and our
  safety read (network at import, pickles, auto-downloads); the person or their agent runs them after a yes. API
  setups appear only for tasks the person allowed; the intent step holds Next until one is picked. SFW only hides files,
  dials, LoRAs, turbos (the Turbo slot) and Library cards the model graph tags `nsfw` from pickers and agent tools
  (list_models' counts too); takes and the graph view's own lists still show them; it's a preference filter on the person's own tags, and the UI says so.
  *Why:* AGENTS.md "No Internet Requests"; the operator (2026-11-04): intent first, light touch, metadata asked here.
  *More:* MODEL_GRAPH_ONBOARDING §4 and §8, `web/snap/onboarding.js`, `onboardview.js`, `profile.js`.

- **SNAP-R28: Whether an agent reads code before bringing it in is the person's setting.** `code_review` in user
  `snap/profile.json` (one skippable onboarding question, and a row in ComfyUI's Settings, MAINodes › Snap › Code
  review, that mirrors it): `always` reads every node pack or script that isn't part of their setup yet, `unknown` (the
  default) only what Snap's kits carry no safety read for, `never` saves the tokens. `get_profile` returns it;
  `propose_downloads` gives every pack (a kit's, or any repo an agent names with `pack`) a `review` of `required` or
  `skipped (your setting)` beside its license and safety read, and the tool descriptions tell agents to follow it. It
  only decides the reading: every install still waits for the person's yes, and Snap itself never installs or
  downloads (SNAP-R25). *Why:* the operator approved the Viggle Remake pack "so long as you look at everything", then made it
  a preference (2026-11-04 16:14): reading costs tokens, and the choice is theirs. *More:* DECISIONS "Onboarding", PLAN U70.

- **SNAP-R29: Onboarding opens by itself only for a person.** The one-time auto-open on the first Snap visit with no
  profile, and the empty profile it writes, wait for a real (trusted) pointer move, press, key or wheel on the visible
  page. An agent's headless page gets no input, so its visit never uses the person's first look; an agent that set the
  profile up with the person meanwhile (set_profile) leaves nothing to open. When it opens it closes core's first-run
  dialog (the Templates browser on frontend 1.58), so two first-run screens never compete. *Why:* U72 F1: the gate
  agent's headless page wrote the profile before the newcomer arrived; F3: core's Templates dialog sat on top of
  onboarding on a fresh install. *More:* u72/FINDINGS.md, `web/snap/view.js` firstVisit, LESSONS "Newcomer batch".

- **SNAP-R53: A file with no download link is never proposed as required.** `propose_downloads` puts a file in
  `files` only when the model graph has its download link and a target folder, so every row there has a command. A
  kit file without one (a local build such as the SFT DeBand checkpoint, or the converted rank-128 Viggle LoRAs) is
  listed under `optional` with `why: "no public download: bring your own file"` and `for` (the setups that use it),
  never in the total size. Kit selection already prefers a setup whose missing files can all be fetched. Links are
  recorded only after the repo file was found and matched (the local copy's sha256 against the repo's LFS id). *Why:*
  U72 run 5: the newcomer kit listed the DMAD LoRA with no link, and the agent had to judge whether to skip a "required"
  file. *More:* u72/FINDINGS.md F17, `web/snap/onboarding.js` (`proposeDownloads`), `snap_cards/models.json`.

## Agents

- **SNAP-R15: Every UI action has an agent tool.** MCP and WebMCP are built from one table. Results carry the same
  warnings the UI shows. *More:* LESSONS "Agents, WebMCP, tools".
- **SNAP-R16: GPU-spending tools wait as proposals** unless the person turns on "Let agents run". (Not gated:
  `find_people` and `take_frames`, which render nothing: a few seconds of detection or frame reading.) Each one states its
  plan first: what it would run and about how long, in seconds from measured takes (or the study it came from), shown
  with the proposal and returned with the run (plan-then-approve, UX_GEMS #5). The bridge never strands the person's
  tab; it calls the newest tab of the caller's user that is still connected (SNAP-R30).
- **SNAP-R17: Keep person and agent labels apart** (`by: person|agent`) on notes, judgments and takes. The data trains
  a judge model.
- **SNAP-R19: The tool table is the API.** Snap's own UI, agents (MCP/WebMCP) and a future form-based editor layer
  drive the same operations through one table. Engine and tool logic stay free of Snap-view DOM concerns; a UI action
  calls the same function its tool calls, never a private path. *More:* CONCEPT.md "Layers".
- **SNAP-R30: The agent front door works for a moderate agent on its first try.** Everything an agent needs is in the
  tool table, its errors or the pack's `docs/snap/AGENT_START.md`, never only in code. Pages are keyed by the ComfyUI user
  (the comfy-user header snap-gate sets per account): a call goes to a connected page of the caller's own user, and only
  that page may answer it: the newest tab that sees, the agents' window or a tab whose person turned "Let agents see" on
  (that control is how a person lets agents drive their tab, the operator, 2026-11-05); a person's tab with it off is never
  driven, and while one is open a call never goes to another page instead (SNAP-R83). An agent picks its page: `list_pages` names each one (whose, the id's start, the tab or shot it shows) and
  `use_page` binds the agent (named by `X-Snap-Agent`: SNAP_AGENT for snapcall.py, one name per snap_mcp.py connection)
  to one page for its session; one agent drives a page at a time, the page shows "Driven by: <agent>" with Release, and
  another agent reaching it is refused with the driver's name, never switched silently (the operator, 2026-11-05: "easily
  select which web ui instance you want to interact with and not collide"). `SNAP_PAGE` or the `X-Snap-Page` header
  sends one call to a page; every answer names the page that answered (`page.id`, `page.name`). `GET /mainodes/snap/tools`
  lists the caller's open pages, when each registered and last answered; with none open, a call says it may have been
  locked or closed and how to open the agents' window (`tools/snap_agent_page.sh <port>`: it attaches to the one visible
  agents' Chrome, opens it only when nothing answers, never headless, returns once its tab has registered; `status`,
  `reload`, `restart` and `stop` need no pid or kill from the caller; SNAP-R83). Every brick in `describe_recipe` has an `id`, exactly what
  `set_setting`'s `brick` takes, next to its title and kit (U72 F19). `start_recipe` takes an onboarding
  kit's `intent` (stills opens MOSS-Image), and `set_profile {done: true}` answers every question (U72 run 3, F12-F14).
  `snap_mcp.py` and `snapcall.py` take a base URL and send `SNAP_TOKEN` as a Bearer header. An agent's call with an
  unknown or missing argument is refused, and every tool error names the arguments the tool takes (the U44 contract).
  `get_profile` says whether agents may run and see, and `set_agent_permissions` sets what the person said, live. `run`
  always returns its run id (or says why it was refused); `run_status` gives each run's state (queued, running, done, failed), its take and output paths,
  and waits up to 25 s (`wait_s`; a call ends after 30 s). A recipe opens runnable: an optional brick whose own check
  fails (Upscale without RelayVSR) and a LoRA stack with no file start off, a brick that is off says so and why in
  `describe_recipe`, and a kit lists add-ons the recipe runs without under `optional`, apart from its files. Video
  lengths read as frames and seconds at the recipe's fps, and `set_setting` takes `"5s"`, rounds to the model's frame
  grid and says what it became. `describe_recipe` carries the model's `prompt_help` (H3's sections; name the sounds the
  action makes). The agents' window screenshots itself through its Chrome's DevTools port (no press; SNAP-R83). The embedder sidecar's port follows ComfyUI's
  (port + 230; 8188 keeps 8418). *Why:* U72 run 1 (Sonnet at low effort): grepping JS for a setting id, a stale Chrome
  lock, a "ready" kit whose recipe wasn't, polling a run that never said done, guessing fps, `undefined has no seed`;
  the operator: "once sonnet low is smooth I'll call it good". *More:* u72/FINDINGS.md F1-F10, PLAN U75, `snap_bridge.py`,
  `web/snap/tools.js`, `tools/`.
- **SNAP-R31: A brick's title names it in every family.** Tools take a brick's id or the title it shows: `render`
  is the stills recipe's `image` brick, `models` its `image_models`, `save` its `save_image`. A brick that isn't in the
  recipe is refused with the recipe's brick ids. `run` warns, and still runs, while a prompt holds its blueprint's
  default text. *Why:* U72 run 2 (Sonnet at low effort): AGENT_START's `render` failed on the stills recipe, the agent
  pressed run anyway and got the example picture. *More:* u72/FINDINGS.md F11, `web/snap/tools.js`.
- **SNAP-R52: A value outside an argument's choices is refused, naming them.** Every tool argument with an `enum`
  (and every array whose items have one) takes only those values: anything else fails the whole call before it runs,
  saying which value and listing the accepted ones (`set_profile: intents "video_with_sound" isn't one of "video",
  "stills", ...`), and nothing is saved. `set_profile`'s `answered` takes the onboarding step ids. The check sits beside
  the unknown-argument check (SNAP-R30), so it covers every tool, MCP and WebMCP alike. *Why:* U72 run 5 (Sonnet at low
  effort): `set_profile {intents: ["video_with_sound"]}` was saved silently, and the agent only noticed on a re-read.
  *More:* u72/FINDINGS.md F16, `web/snap/tools.js` (`checkArgs`).
- **SNAP-R58: Results are never trimmed.** Every tool, route and client gives the whole answer: every LoRA and model
  file in a list (with its count), every choice of a setting, every Library match, a take's whole prompt, a LoRA's full
  metadata values and all the tags it was trained on, and error texts in full (`snap_mcp.py`, `snapcall.py`). A tool
  that pages takes explicit arguments that default to all and says the full count; nothing is shortened silently. If a
  result is too big for an agent's context, the agent saves it to a file and hands it to a subagent to break down and
  report back (AGENT_START, Limits). Purely visual cuts in the page (a tooltip, a slug, a label on a brick) are not
  results. *Why:* the operator, 2026-11-04: "no limit ever"; "if a result exceeds context limits it needs to be passed to a
  subagent to break down, analyze and report back". *More:* `web/snap/tools.js`, `snap_bridge.py`, `tools/`.
- **SNAP-R36: Quiet sound is a note with two ways out, never a silent fix.** A video take's sound is read once at
  capture (ffmpeg volumedetect through `/mainodes/snap/loudness`; no ffmpeg, no note) and kept as `sound` (mean and max
  dB). Below -45 dB mean, the card says "sound is quiet" and the viewer offers two actions. "Make it louder" queues
  LoadVideo → MAISnapLouder (loudnorm I=-23, TP=-2, 48 kHz AAC) → Save Video. The result is a version of the take, with
  the picture stream copied as it is. "Re-prompt with sound events" opens the Render's prompt and shows its prompt_help.
  Agents get `sound.quiet` in list_takes and `make_louder`. Nothing runs until someone presses or calls it. *Why:* U78:
  an ambience-only H3 soundscape renders about -57 dB, against -27..-41 dB when it names the action's sounds; the fix
  is the prompt, the backstop is the note. Measured on two real -57 dB kit takes: -29.5 dB mean and -23.4 LUFS after.
  *More:* PLAN U76, U78_KIT_AUDIO_2026-11-04.md, `snap_bridge.py`, `web/snap/takes.js`, `web/snap/edits.js`.

## Signed-in installs (the pack's side of snap-gate)

These hold only where snap-gate runs in front of ComfyUI (a separate install whose admin sets them). On an ungated
ComfyUI, the operator's included, nothing here restricts anything (SNAP-R11, DECISIONS "No artificial limits").

- **SNAP-R32: On a gated install, only the admins' snap/ files decide ratings and marks.** snap-gate writes
  `user/snap_admins.json` (`{"admins": [ComfyUI user ids]}`) when it starts and at every sign-in, outside every user's
  folder, so no page can write it. When it exists, `snap_privacy.model_graph` reads `snap/models.json` (rating, nsfw,
  private, role) and `snap/private.json` only from those users; a non-admin's files change marks for no one. With no
  such file every user's files count, as before. One that doesn't parse counts as broken: every take is marked private
  and nobody's ratings count. Known edge: an admin created while the gate runs who only ever uses a token (never a
  sign-in) is published at the next gate start. *Why:* under --multi-user any account writes its own user data, and the
  gate rates from the admins' graph only (SNAP-R43). *More:* PLAN U77 (2), `snap_privacy.py`, the gate's `publish_admins`.
- **SNAP-R33: The rating cap has a second line in the pack.** snap-gate puts `snap_user` and `snap_max_rating` in every
  prompt's extra_data and refuses files above the cap itself. The pack's on_prompt handler checks again with the same
  levels: the file's `rating`, else Adult when tagged nsfw, else PG in helper folders (VAE, encoders, upscalers…) and
  Adult anywhere else (SNAP-R44). A prompt that still names one becomes one MAIRatingRefused node per such node, which
  fails validation with "Node N (title) loads a file rated above this account's PG cap. Ask the admin.", so nothing of
  it runs. Core would otherwise run the prompt's other outputs. Under a cap below Adult a prompt's words always count
  (SNAP-R39), so one whose words rate it Adult is refused the same way when it is queued, naming the node, the input and
  the word ("its value says "nude", which rates this prompt Adult, above this account's PG cap. Change the words, or ask
  the admin."), instead of rendering and then being hidden from its own account (U90; CONTENT_RATINGS_VAULT §2 "refused
  at validation"). A world record pinned in the queued workflow with its own rating above the cap (a Cast the person
  rated Adult: the page copies the pinned version's rating onto its pin) is refused the same way ("Vex v1 is rated Adult,
  above this account's Mature cap"), as the re-run plan's line says; the pin's rating also raises the take's rating
  (SNAP-R39). A re-take or re-run shows the refusal's own reason. A saver named Save… with no filename_prefix (SaveLoRA)
  is noted in the log and in extra_data.snap_notes, never refused. With no snap_max_rating nothing changes. *Why:* the
  gate is the first line; the pack sees the executed prompt and the files on disk. *More:* PLAN U77 (3), `snap_bridge.py`.
- **SNAP-R34: Snap shows the signed-in account and keeps the page through an idle lock.** `GET /gate/me` names the
  account and its cap: the top bar shows "name · PG" and Sign out (`/gate/logout`), and get_profile carries `account`.
  Any other answer means no gate, and Snap shows nothing. When a request answers 401 `{"locked": true}`, a small "Locked:
  sign in again" card shows over the page, graph view included. Its Sign in opens the gate's sign-in in a small window,
  and the card goes once `/gate/me` answers again. The page, its graph and its socket's client id stay as they were.
  Under a cap below Adult, onboarding has no SFW-only question, because the gate already hides what that would.
  *Why:* PLAN U77 (4); LESSONS "An untouched ComfyUI page makes no requests". *More:* `web/snap/account.js`.
- **SNAP-R35: A rating is set from move to….** "rated PG / Mature / Adult" and "unrated" sit in a LoRA's move to…, and
  `rating` in set_lora_category. They write the person's snap/models.json. Ungated, anyone may rate. Gated, only the
  admin is offered them, because only the admin's ratings count (SNAP-R32). The pack's model graph rates every file it
  knows, every kit file among them, PG (base models, VAEs, encoders, task LoRAs); a community finetune it can't vouch for
  stays unrated for the admin (SNAP-R39). *Why:* PLAN U77 (6). *More:* `web/snap/models.js`
  (`moveTo`), `snap_cards/models.json`.

## Data and privacy

- **SNAP-R18: Local only.** No network or telemetry: registry, takes, profile and model graph are local files. Export
  happens only when the person asks. Model downloads run only when the person asks, in the agent's own tools, never
  from ComfyUI core.
- **SNAP-R20: Metadata in saved files is the person's switch; private takes are marked.** Saved pictures and videos
  keep their prompt and workflow by default, as core saves them. "Save metadata", the switch right before Run (a ComfyUI
  user setting, `MAINodes.Snap.SaveMetadata`, remembered per user), turns that off: every prompt the page queues then
  carries `extra.snap_metadata: false` in its workflow, and the server swaps core's Save Image / Preview Image / Save
  Video (and the pack's MAIVideoOut) for twins that write no prompt or workflow; a node it can't switch runs and is
  named (SNAP-R38). No warning chip. A take is private when any node of its prompt loads a file the model graph gives role
  `identity` or tags `private`, whose real path (symlinks followed) is under one of the person's private paths or
  matches one of their private patterns (user `snap/private.json`, local, never in the pack and never read by the
  page), or when Snap's Cast brick has a LoRA row on; it is NSFW when it loads a file tagged `nsfw`. Reasons name nodes,
  never files. The take card shows a lock, and the export leaves private and NSFW takes out unless asked
  (`--include-private`, `--include-nsfw`). A person's model graph or private.json that doesn't parse makes every prompt
  private. *Why:* core writes the executed prompt and workflow, LoRA file names included, into every PNG and mp4, and
  `--disable-metadata` is global; the operator chose metadata on for everything with one clean switch (2026-11-04) over
  stripping private takes automatically. *More:* `snap_privacy.py`, `snap_bridge.py`, `web/snap/metadata.js`; PLAN U22, U58.
- **SNAP-R38: Save metadata off writes no metadata, and anything that still does is named.** With the switch off, the
  server swaps every saver it can switch for a twin: Save Image, Preview Image, Save Video and MAIVideoOut (MAIVideoOut's
  twin also writes no meta.json). A node with its own `save_metadata` input (VHS Video Combine) gets it set false. Save
  Video of a file (LoadVideo, the louder version) is remuxed without the source's tags first, because core's stream copy
  carries them over. Any other node that asks for the prompt or workflow is no longer refused: it runs, and the run and
  its take say "node N (title) writes metadata anyway" (`snap_marks.kept`, `metadata_kept` in run_status and
  list_takes, a chip on the card). Every default flow's saver is one the server switches: both recipes' Save bricks,
  the blueprints (no saver inside), Upscale (no saver), and Snap's own graphs (edits, plates, candidates, louder). The
  person's own data in user/snap (take records, which hold the prompt) is not a saved file and isn't affected. Neither
  are dial files, which keep their own sentence pairs. *Why:* the operator, 2026-11-04: "Save metadata off should stop metadata
  from writing. If there's anything that doesn't have a toggle for that in the flow, let them know." *More:* PLAN U81,
  `snap_bridge.py`, tests/snap/test_metadata_off.py, test_metadata_flows.js.
- **SNAP-R51: Change something, recast anyone, pin what was painted.** The edit slot is "Change something": the person
  writes what changes, or picks an example (night, dusk, dawn, rain, snow), and no example is a feature of its own.
  relight (Ripple) paints frames 0 and middle and is fastest, and it was tested on light. remake_edit (Viggle Remake)
  paints the middle frame, or the frames asked for: a moving object needs one where it enters and one where it leaves (up
  to 4, Remake's limit). The recast slot puts someone else in a take: "X → Y" is its face and its version's name, the
  identity notes give way to a "new person" note, and nothing is refused, private takes included (a version of a private
  take is private too, SNAP-R27). A pinning method's candidates carry "📌 pin at frame N", on by default: on, the take
  passes through the painted frame at that moment; off, it only sets the look. The lighter rank-128 LoRA is offered as
  "the same picture, half the disk, no speed gain", and is used by itself when it is the only one installed. A method's
  `credit` is the tooltip of the controls that run it while it is picked, and of its card: "Powered by Viggle Remake
  (https://huggingface.co/Viggle/Viggle-Remake) · MiniMax H3". *Why:* the operator, 2026-11-04 16:45: Recast is a Snap slot, no
  artificial limits, night is only an example; U69: one pin holds an object only near its frame, a recast scores ArcFace
  about 0 by design. *More:* PLAN U73, U69_VIGGLE_REMAKE_2026-11-04.md, `web/snap/edits.js`.
- **SNAP-R50: A longer take carries the sampler's latent.** The extend slot makes a take longer by whole clips and lands
  the joined clip as a version of the take. Standard encodes the take's last 39 frames and their sound once, then every
  new clip starts from the clip before it as sampled (Geiru Context, protection off, head 39, drop_last 17): nothing is
  decoded and encoded again per clip, which is where the old chain's colour creep came from. Each clip's colour is matched
  on the 22 frames it holds (Seam Normalize). Anti-Burn is a slider, off by default. Strong adds Geiru's keystone (the
  take's end), Late Lock, context noise and Anti-Burn 0.5, and its face says "keeps the look, may reset the action". The
  button says the length it makes ("Make it 15.6 s (+9.8 s)"). Any number of clips can be asked for. *Why:* U46b:
  saturation over 8 clips 1.08-1.16 with the carry vs 1.37-1.58 re-encoding; Anti-Burn on a carry only softened (detail
  0.59 vs 1.41); a 100 % crop of the carry's rising detail shows crisper faces, no grain (proto/ui/262). *More:* PLAN
  U46c, U46_EXTEND_AB_2026-11-04.md, `web/snap/extend.js`.
- **SNAP-R64: Long re-anchors, and the extend default follows the length.** Long is Standard's carry plus Geiru's
  keystone front + capstone back from the take's first clip on every 3rd clip of the longer take (the take is clip 1),
  with Geiru Context's protection flag on and `hold_audio` off on exactly those clips; nothing else of Strong (no Late
  Lock, protection LoRA or context noise). Its face: "keeps the face and the sound for 2 minutes". The slot's
  `defaults` pick the method by the length asked for, Standard up to 40 s and Long beyond; Strong is only ever a pick.
  The take viewer follows the length until the person picks a method, then keeps their pick and names it as theirs;
  either way it says why, and list_methods gives agents the same rows. If the drone comes back between anchors on
  chains past ~2 minutes, the fallback is `hold_audio` off on every clip, not a new node. *Why:* U46d: Standard grows
  a mosaic texture past ~40 s (detail 1.63x at 91 s); U46e/U46f: the re-anchor alone holds 2 minutes, face included
  (detail 1.07x, ArcFace 0.75-0.89), and Late Lock makes it decay; U46g: the H3 audio drone rides on Context's audio
  carry, and cutting it on the anchor clips gave 0 of 24 drone segments with the picture unchanged. *More:* PLAN U46e,
  U46g, U46_EXTEND_AB_2026-11-04.md, U46g_LONG_AUDIO_2026-11-05.md, `web/snap/extend.js`.
- **SNAP-R65: Every asynchronous job is visible on the Work card and where it belongs, from the server's own records.**
  Every prompt Snap queues carries `extra_data.snap_job`: `kind` (run, retake, rerun, paint, propagate, extend, upscale, louder,
  plate, check, preview, make_dial; settei, board, compile, prose kept for the Book), `title` = the job's question in the
  person's words (refused when empty), `about` (take, group, scene, shot, decision, candidate, set, camera, slot; book,
  beat, unit, entity, state kept for the Book), `by` (person | agent; on a gated install the gate adds the session's
  `account`), `eta_s` (null reads "no estimate yet") and `takes: false` for paints and checks, which run under the page's
  own client id and never become takes. The Work card derives every row from the server's queue and history
  (`/mainodes/snap/jobs`), the candidates store, waiting proposals and blind pairs, and refusals at queue: states queued |
  running | checking | waiting | done | failed | gone, and zones that are queries over them, never stored: **In flight**
  (queued, running, checking, failed, gone), **Landed, unjudged** (waiting for the person, or done and not opened yet),
  **Parked** (the person's Park: kept, never counted) and closed. The **docket** is the waiting rows (`list_docket`). A
  failure stays In flight with the server's own text, whole, until parked or retried; a refusal at queue is a failed row,
  never only a toast. A job shows on its take's card (a chip), as a ghost card where its take will land, and as a count
  on its shot's tile. Rows survive a reload, a closed viewer and another tab, and agent-started work shows to the person.
  A finished job whose queuing page closed before it landed still becomes its take: the first live page to claim it
  (`POST /mainodes/snap/adopt`, one claim per prompt) writes it, so two open pages never write it twice (short03 F-C25:
  an 18-minute stage 2 vanished when its tab closed).
  Agents read the same rows (`list_activity`, `wait_for`), whole, with explicit paging (SNAP-R58). *Why:* the operator,
  2026-11-05 08:04, after his first edit's candidates arrived with nothing on screen: "if we don't have good visibility to
  what is going on with the right screen context the ux fails... consider this for all possible paths"; names from the
  box1 Production Book (DECISIONS 09:08). *More:* DESIGN_REACTIVE_UX_2026-11-05.md, CONCEPT_PRODUCTION_2026-11-05.md
  §11.3, `web/snap/jobs.js`, `web/snap/activity.js`, `web/snap/workview.js`.
- **SNAP-R66: An arrival announces; only a press moves the person.** A job that lands, fails, or starts elsewhere (an
  agent, another tab) is said once, with one press to its result in context (Open: the take's viewer after its shot,
  the decision's candidates, the set editor, the blind compare); nothing navigates, opens or switches by itself. Nothing
  is said when the result's home is already on screen (it updates in place), except a failure. In the graph view
  ComfyUI's own toast says it. *Why:* SNAP-R5 (open work is never touched by itself) applied to every async path.
  *More:* DESIGN_REACTIVE_UX_2026-11-05.md §10, `web/snap/view.js` (`openJob`, `A.onArrive`).
- **SNAP-R39: A rating comes from how a thing was made.** Nothing Snap makes or proposes is unrated. A prompt is rated
  when it is queued, from the files it loads and its words, and the highest wins. Its words count for an account capped
  below Adult; anyone else (an Adult cap, or no gate) counts them only with their setting "Rate takes from their prompt's
  words too" on, off by default and remembered. A prompt's words make it Adult when a string input holds one of
  the terms in `snap_cards/nsfw_terms.json` (parts anywhere, words as whole words, camelCase split; a person's own
  `snap/nsfw_terms.json` adds to them; borderline words never rate; text that only feeds a `negative` input doesn't
  count). A file nobody rated adds nothing on an ungated install, where ratings are
  labels only, and counts as the gate counts it (SNAP-R44) on a gated one. The take keeps that rating (`snap_marks.rating`
  and why), raised to the rating of any take it came from: a version, an edit, a louder version, a run from a take's
  frame. The pack's model graph rates every kit file, so downloads arrive rated, and propose_downloads says each one's
  rating. A dial saved here (Make Dial, the Dial editor's export) is rated as its sentences and its parent dial, in
  `user/snap_ratings.json`, which only the server writes, outside every user's folder; a parent nobody rated leaves the
  new dial unrated too. The gate reads that file and the pack's model graph, so its unrated-is-Adult fallback is left for
  files someone drops in by hand. The person's own rating always wins: the take viewer's "Rated" pick for a take, move
  to… for a file (the admin's on a gated install). There is no picture tagger: none is installed here, and Snap never
  downloads one. *Why:* the operator, 2026-11-04: "that wouldn't happen since the file would have been generated by them or
  someone and their prompt would be nsfw or not". *More:* PLAN U82, `snap_privacy.py` (`rating`, `record`),
  `snap_bridge.py` (`rate_dial`), `web/snap/takes.js`.
- **SNAP-R54: Dials are rated from how they were made, and takes above a cap are left out.** A dial file in
  `loras/dials/` that nothing rates (a released dial someone downloaded or copied in) is rated from what its own
  metadata records: its sentence pairs, hold groups and info through the same prompt-words rating as a prompt, raised to
  its parents' ratings (a Combine or an edit names them; a parent rated that way first). One made from pictures or
  videos, or whose parent isn't here, stays unrated, since the file doesn't record its inputs, and snap-gate counts it
  Adult until the admin rates it. The pack does this at startup and whenever a page reads the model graph, once per
  file, into `user/snap_ratings.json` (SNAP-R39). Dials made here from pictures or videos, and Combine's saves, are
  rated when saved like text dials: their own words, their parents, and the rating of the run that made them (the files
  and words of the prompt that loaded their pictures or dials). On a signed-in install a take rated above the account's
  cap is left out of `list_takes`, `get_take` and Dailies, whose count says how many it left out ("1 above your rating
  not shown"); snap-gate refuses the files themselves (its SNAP-R56). Without a gate there is no cap and nothing is
  left out. *Why:* PLAN U88, answered by the recorded rules (DECISIONS: no file is unrated; CONTENT_RATINGS_VAULT §2:
  items above the cap are omitted). *More:* `snap_privacy.py` (`dial_rating`), `snap_bridge.py` (`rate_released`,
  `rate_dial`), `web/snap/takes.js` (`aboveCap`).
- **SNAP-R37: Privacy is a per-install opt-in, off by default.** Everything private in SNAP-R12, R20, R27 and R32 holds
  only where `user/snap_privacy.json` says `{"on": true}`. That file sits outside every user's folder, so no page can
  write it; the install's admin puts it there (snapbox does). Off, nothing is private from any source: private.json
  rules aren't read, and header stamps, the identity role, the `private` tag and Cast rows mark nothing. There are no
  lock badges (`take_marks` says `privacy: false`, `private_loras` is empty), the export leaves nothing out for privacy,
  recipe cards keep their Cast rows, and rules that can't be read don't fail closed. Saves are exactly as core makes them,
  and the Save metadata switch stays the person's own (SNAP-R20). NSFW tags for SFW-only filtering are a separate feature
  and stay. A switch file that doesn't parse counts as on and as broken. *Why:* the operator, 2026-11-04 19:00: "Private
  should only be on our new comfyui instance; my main instance isn't Private." *More:* PLAN U80, `snap_privacy.py`
  (`switched_on`).
- **SNAP-R27: A file stamped private in its own header is private, and locks follow the current rules.** Besides the
  model graph and the person's private paths and patterns, a `.safetensors` / `.sft` file whose header metadata says
  `"privacy": "full"` (any case, at any level, inside JSON-string fields too, parsed a few levels deep) is private, and
  so is one whose `trigger` / `trigger_word` / `trigger_phrase` / `triggers` names one of the person's private
  `triggers` in their own `snap/private.json`: a trigger names who a LoRA draws and survives a re-train under any file
  name, and an over-match only costs an export row. The pack knows only the generic stamp; trigger words, like paths
  and patterns, live only in the person's file. Only the header is read (8-byte length, capped at 16 MB), cached per
  real path by mtime and size; a read that fails is not stamped and not cached. Patterns also match the value's folder
  part (a symlinked folder named like a pattern), and every input counts: names inside dict values (rgthree's Power Lora
  Loader rows) and `<lora:name:w>` tags in text. Rules that can't be read (a file that doesn't parse or has the wrong
  shape, or any error in the check) mark every take private with "privacy rules unreadable" and log an error; they
  never stop a render. The lock follows today's rules, not only the mark saved at queue time:
  `/mainodes/snap/take_marks` re-checks the saved takes (booleans, never file names) and `/mainodes/snap/private_loras`
  names the LoRA files the rules match, so LoRA rows in the sheet, the stack faces, the + LoRA picker and `list_loras`
  carry a lock. A version of a private take (an edit, a continued take), or a take made from one of its frames (a
  reference picture's `source`, kept as `made_from`), is private too, in the lock and the export, so a private take can
  be edited like any other (U76 M2). A take file that doesn't parse is named under `unreadable` in take_marks, never a
  500 that hides every lock; moving a LoRA out of identity says it may no longer be private. Marking only: nothing is hidden, gated or re-run, and the row still works
  (the operator, 2026-11-04: "my machine isn't going to be the private one"; "don't artificially limit anything please thats
  for the end user to do what they decide"). *Why:* derived LoRAs with neutral names in a neutral folder were caught
  only by their stamp (U68). *More:* U68_PRIVACY_AUDIT_2026-11-04.md "Matcher gaps", PLAN U71, `snap_privacy.py`,
  `snap_bridge.py`.

## Private takes kept encrypted (U79)

These hold only where privacy is on (`user/snap_privacy.json` `{"on": true}`, SNAP-R37; `"vault": false` there turns
the vault alone off). With privacy off nothing below runs: savers, loaders, `/view` and take records behave as before,
byte for byte (proto/snapbox/test_vault_off.py).

- **SNAP-R96: A private take lives encrypted at its own path, under its own name, with its recipe inside.** A private
  prompt (SNAP-R20's marks, a prompt that reads a take kept encrypted, or rules that can't be read: fail closed) gets
  Save Image, Preview Image, Save Video and MAI Video Out swapped for twins that render into memory and write one
  container (`SNAPVLT1`: chunked AES-256-GCM, 4 MiB chunks, its header bound to every chunk) where core would have
  written the file; Save metadata decides whether the recipe is inside, as everywhere (SNAP-R38). The container's magic,
  never its name, says it is one, so history, take records, the gate's maps and every `/view` URL stay as they were.
  Load Image, Load Image Mask, Load Video and Load Audio are swapped for twins that open it in memory; any other node
  that names one is noted (`snap_marks.vault_notes`), and a saver Snap can't seal is noted too ("saves this private
  take in plain"). The take's record is sealed the same way through `/userdata`, and a frame lifted from it is uploaded
  sealed (`snap_vault=1`). The lock reads "🔒 kept encrypted". The world export keeps containers as they are unless the
  person includes them decrypted (`decrypt_private`, vault unlocked). *Why:* the operator, 2026-11-04 18:56: "Private still
  has metadata, it just lives encrypted along the path." *More:* DESIGN_U79_VAULT_2026-11-05.md §4 Option A,
  `snap_vault.py`, `snap_vault_server.py`.
- **SNAP-R97: Writing a private take needs no passphrase; reading one does, and lock forgets.** Every file has its own
  key, wrapped to its owner's X25519 public key (the age construction), so a render that ends after the lock still
  saves sealed. The owner's private key sits in `user/snap_vault.json` wrapped under Argon2id(passphrase) and lives
  unlocked only in the server's memory: behind snap-gate the sign-in password unlocks it (SNAP-R100), without a gate the
  person unlocks it once per server start from a take's lock. Locked, `/view` answers 423 ("kept encrypted: unlock the
  vault (sign in) to open it") or a lock tile for a picture, a record reads as its stub (`kept_encrypted`, `locked`; no
  prompt, graph or notes), and a prompt that reads a sealed take is refused at queue naming the vault. An account with no
  key yet is refused at queue rather than saved plain. Admins open anyone's through escrow ("admin has all the power");
  other accounts never. *More:* DECISIONS 2026-11-05 04:08 (Q1, Q4, Q5, Q8).
- **SNAP-R98: No plaintext of a private take is written to disk by Snap.** Savers and loaders work in memory; `/view`
  of a container is `Cache-Control: no-store`; the only plaintext stop is the RAM-backed scratch (`/dev/shm/snap-vault-<pid>/`)
  an ffmpeg step needs (louder, loudness, the no-metadata remux), unlinked when the step ends and swept at the next start.
  Limits said in the vault sheet: not against the machine's account or root while unlocked, swap or GPU memory; core
  nodes that write their own temp previews (Trim/Crop Video) and savers Snap can't seal are named, not covered.
- **SNAP-R99: A lost passphrase is recovered by an admin or the recovery key, else it is lost, and Snap says so before
  asking.** Each account's key is escrowed to every admin with a key (refreshed at each unlock); an unlocked admin
  resets a member's passphrase (`vault/rewrap`). A recovery key (made at setup or later from the vault sheet) is shown
  once and kept nowhere. With neither, the private takes are gone, and the sheet says that sentence before the person
  chooses. Changing a password with the gate's CLI prints that the vault still opens with the old one.

## Context and references (U101)

R67-R69 are the Book's (see "The Book" below) and R70 is the Room (G7); U101's rules start at R71.

- **SNAP-R71: A new view of a known place is an edit from context pictures, in the asker's words.** "New view from these
  pictures" (the take viewer's tray; `edit_from_context`) makes a still with an H3 model from 1 or more context
  pictures (a still take, a video take's frame, an input/ file, a Cast's picture, whole or cropped) and a prompt the
  person or agent writes; nothing is added to it, so the in-place Change something's "keep the place and the
  composition unchanged" text stays only on that route. It works on stills (masters, plates, boards), unlike Change
  something, which edits a video take. Each seed is a candidate take (SNAP-R23) in the shot it lands in (by default
  Picture 1's take's shot); Apply makes it the shot's active take, Reject marks the take. The take's parent and the
  decision name every context picture (`options.context`: number, take and frame, file, Cast version, crop, label), the
  lock and the rating follow every context take (SNAP-R27, R39), and a Cast picture pins its version (SNAP-R60). What it
  runs is registry data (slot `view`, methods `ph3_view` and `fizgig_still`, SNAP-R13/R14). *Why:* the operator, 2026-11-05: "a location is one
  topology… every view of it is an edit from prior context", "moss is WAY better than klein", "when snap can't do the job
  that means you need to update snap"; short03's three different gates (F-C09). *More:* PLAN U101, LESSONS "U101".
- **SNAP-R72: The order is the person's, and what Picture 1 is depends on the model.** The tray and the tool keep the
  pictures in the order given, name beside Picture 1 what it is for the picked model, and let the person move each
  picture up or down, take it out, or add a marked region of a still as a crop (a part of a master: the gatehouse).
  P-H3-Image edits Picture 1 with the rest as references and the Fizgig H3 still reads every picture as a reference; for
  both the words set the camera, so a location's master can go first. The label and its tip come from each method's
  `picture_one` in the registry, never from code. (MOSS Image Edit, tested first, kept Picture 1's framing: its aerial
  master first gave the aerial view in every seed; it is no longer a New view model, SNAP-R75.) *Why:* the coordinator's
  13:4x note from short03's sheet; the U101 C2 test. *More:* PLAN U101, the dogfood study's F-C09, LESSONS "U101".
- **SNAP-R73: Audio references are the pictures' twins.** An audio file goes into References as a Load Audio node wired
  into H3 References' next free `ref_audios` slot (3), and the prompt cites it as `<Audio n>`, n its place among the wired
  audio slots (`describe_recipe.references` lists every `<Picture n>` and `<Audio n>`). A Cast may hold one voice
  reference (`voice {file, casting}`: a clean 3-6 s line and the casting words it was made from); `apply_cast` puts it
  in with the Cast's pictures and says its `<Audio n>`, and a version without one takes the last apply's out. Agents
  add or remove audio by tool (`add_audio_ref`, `remove_audio_ref`). *Why:* F-C07: a cut could not cite a voice through
  Snap at all; the operator, 2026-11-05: characters get voice references for timbre, cited in every cut where they speak.
  *More:* PLAN U101, the dogfood study's F-C07.
- **SNAP-R74: Load Audio lists Snap's audio under input/snap/.** Core Load Audio lists only input/'s top level, so a file
  uploaded with `subfolder=snap` (as AGENT_START says) never showed. The pack's `/mainodes/snap/input_audio` lists the
  audio under input/snap/ and the page adds it to Load Audio's choices; the node's own validation already accepts any
  input file. Snap's audio tools put the file on the node's widget whatever its folder. *Why:* F-C08. *More:* PLAN
  U101.
- **SNAP-R75: The new view's model is the person's pick, among registered view models.** The view slot holds its models as registry
  data: `ph3_view` (PrunaAI's P-H3-Image on core `PH3ImageConditioning`, an edit of Picture 1 with the rest as
  references, 8 steps, no negative) and `fizgig_still` (stock H3 Reference to Video on the Fizgig H3 Still pack's
  one-frame latent, which says it needs that pack when it isn't installed). The tray's model menu and the tool's
  `method` choose; the first listed is used when none is named. Explicit `qwen21_view` adds native Qwen Image 2.1
  editing, using its encoder's first-reference canvas and ordered reference sockets; existing H3 purpose defaults
  stay unchanged. The operator requested both H3 image paths before this editing fallback (2026-11-08).
  MOSS Image Edit is not a New view model: on short03's C2
  it copied Picture 1 or redesigned the set and the people across views (the operator, 2026-11-05: "Not any moss edit those were
  bad"); Change something on video takes still uses it. *Why:* the operator, 2026-11-05 14:0x-15:0x after the C2 sheets.
  *More:* PLAN U101, U17, PROGRESS 2026-11-05 13:57-14:55.
- **SNAP-R76: Every face is its own measurement, matched one to one.** The identity check asks SAM 3.1 for every face
  ("face:9": SAM keeps one detection per text unless told how many) as separate masks; MAISnapIdentity gives each face
  its own embedding, box and head crop and drops a second detection of the same face. The faces of every picture
  compared with one picture (the take's frame against an edit, or each Cast picture against a new view) are matched to
  that picture's faces one to one, best total first (ArcFace plus the character score, SNAP-R111), so a two-shot scores each person against their own face and
  shows the crops that belong to each score; a person with no face matched says so. The people check asks for
  "person:20" the same way. *Why:* the U101 bake-off: a Maren-and-Brann board scored Maren and showed Brann's head,
  and Brann was never measured. ArcFace scores profiles and bowed heads low (Brann's bow: 0.06), which is why the
  character score raises the note now (SNAP-R111); the crops still decide. *More:* PLAN U101, tests/snap/test_u101_faces.js, proto/ui/u101/faces_twoshot_after*.
- **SNAP-R77: A character sheet is a method of the sheet slot, and its candidates are takes.** "Make a character sheet"
  (`make_character_sheet`) draws a Cast's picture (and any more pictures, e.g. a turnaround's views) as a sheet with one
  method of the slot `sheet`: the H3 Turnaround LoRA through ComfyUI-H3-ContactSheet (five views jointly denoised, and
  its instruct checkpoint), stock H3 Ref2V with JahJedi's five-reference prompt, the Fizgig H3 still with a sheet
  prompt, Krea 2 with Alissonerdx's QuadView / DynamicCharacterSheet LoRAs (comfyui-krea2edit), MOSS-Image Base with the
  CharRef LoRA. Which graph a method runs, its words, LoRA, steps and size are registry data (`anchors.kind` picks one
  of the edits.js graphs, SNAP-R13/R14). Each seed is one candidate still take (SNAP-R23) in the shot it lands in, its
  pictures the sheet first and then each view the method draws apart; its parent names the Cast and every picture, and
  the Cast's version is pinned (SNAP-R60). A five-view LoRA is only ever used through its node, never in a video graph
  (it breaks motion). *Why:* the operator, 2026-11-05: "even fizgig had a hard time" on turnarounds; "an early prototype, feel
  free to try it out tho with the others". *More:* PLAN U101, PROGRESS 2026-11-05 (turnaround round 2),
  proto/ui/u101/bakeoff/round2_*.
- **SNAP-R78: A stale tab says so; agents ask, the person reloads.** A tab whose Snap code is older than the code the
  server serves (it registers with the hash it loaded; `code_current` false) shows a non-blocking "Snap was updated:
  reload to get the new tools" bar with a Reload button and ✕, on registering (load, focus, reconnect after a restart).
  An agent asks with the bridge tool `request_reload` (the server's, so a stale tab without the new page tools still
  gets it), and the bar names the agent. Nothing reloads by itself (SNAP-R5), and a tab whose code predates the bar is
  named as such so the agent asks in words. *Why:* F-C12: short03 waited 9 min for a reload only the coordinator could
  ask for. *More:* the dogfood study's FINDINGS F-C12, tests/snap/test_u101_fc.js.
- **SNAP-R79: A new view says which picture it copied.** Each New view candidate is scored against each of its context
  pictures with the copy check (DINOv3 patch tokens at the same grid position, MAISnapCopyScore, the model graph's
  threshold); at or above it the tile says "copied Picture n" (the note `copied`: threshold, each picture's score, the
  numbers copied), else "no copy · nearest Picture n" with its score. A note, never a gate (SNAP-R23). It catches a
  re-render of a picture's framing (plates' copies 0.77-0.94); P01's establishing candidates, the master's aerial re-drawn
  and turned, score only 0.52-0.54 against it (two-shots in the same village 0.42-0.45), under the threshold, so the
  nearest score is shown and the person looks. *Why:* F-C14: P01's establishing candidates re-drew the master's aerial
  and nothing flagged it. *More:* the dogfood study's FINDINGS F-C14, tests/snap/test_u101_fc.js.
- **SNAP-R80: Every picture is one click from full size.** A thumbnail (References' `<Picture n>` rows, the New view
  tray, Cast pictures, camera plates, candidate tiles and their head crops, the Re-run sheet) opens Snap's viewer on a
  click: fit or 100 %, wheel zoom about the pointer, drag to pan, ← → through the same row or tray, Esc closes, with
  the picture's name, source and size, and "Open in a new tab". A take card and the take viewer have a ⤢ button (their
  own click opens the take and marks regions). A thumbnail whose click did something else keeps it as a button in the
  viewer (References: Edit the Cast record / the set); an audio reference row plays on a click. Viewing never
  navigates away or changes anything (SNAP-R5). The agent twin is `open_view {view: "picture"}` on the page the agent
  drives. *Why:* the operator, 2026-11-05: "it would sure be nice to click on the references, click on a picture and it brings
  it up full size in the web ui". *More:* DECISIONS 2026-11-05, tests/snap/test_u101_full.js.

## Making a take bigger (U102b)

- **SNAP-R81: A take's upscale is a second pass of its own recipe, and lands as a new take.** The upscale slot's take
  methods (`kind: take` in `snap_cards/methods.json`; `upscale_take`, the take viewer's "Make it bigger") start from a
  take that exists, never from the chain: `stage2` runs the take's own executed prompt again (model, LoRAs, words,
  references, seed) with three changes only: its empty H3 latent becomes the take's own frames, upscaled (Lanczos, or a
  pixel model first) and VAE-encoded at the target, through H3V2VInit with the sound pinned (the jerk/oracle branch's
  video-to-video start); every sampler that started from that latent starts at `denoise` on its own sigmas
  (H3DeropeSigmas, the same fraction-of-the-denoise as KSampler's); every size at the render size takes the target. The
  saved video keeps the take's own sound. `h3_latent` is the same with the take's latent made bigger by a latent model.
  The result is a take whose parent is the take (`upscale/<method>`, options: size, denoise, upscaler), with the take's
  world pins (SNAP-R60) and its rating (SNAP-R39). Size is a factor of the render size or a width/height, snapped to
  multiples of 32. The media methods (RelayVSR, ESRGAN, resize) stay bricks in the chain; `set_method` refuses a take
  method and names `upscale_take`. A folder ComfyUI doesn't list (RelayVSR's models/relayvsr) is said as checked when it
  runs, not as missing weights. *Why:* the operator, 2026-11-05: "spatial compression has whacked the face. 2k resolution is
  wise", "a full pixels through vae like a stage 2 upscale with a light denoise type deal"; short03's F-C23 (no route
  started from a take at a denoise). *More:* PLAN U102b, LESSONS "U102b", tests/snap/test_u102b.js.
- **SNAP-R82: Tessera tiles a take with the take as its reference.** `tessera` runs hashu786's ComfyUI-Tessera (MIT, its
  own pack; Snap says "needs the nodes" without it): Streamed Encode makes the upscaled plate and its guide window by
  window, Refine samples about 1 MP tiles (20 at 3328x4096) on Ref2VA with the take as <Video 1> and a first-frame still
  as <Picture 1>, on its validated v4 recipe (turbo head, detail-LoRA euler tail, sigmas 1.0 / 0.7 / 0.4 / 0, guide
  release 0.8, cfg 1) but its flat-tile skip at 8, not 4 (at 4 the near-empty backdrop tiles of the orbit grew ghost
  figures and a face), with a hero tile on `hero` (SAM 3.1 words, default "face") on its own schedule.
  The still is the take's newest stage 2's frame 0 by default (else its own frame 0), cropped to each tile with the take
  (`image_ref_crop: per_tile`): given whole, it painted small copies of the person into the backdrop tiles. Tessera's
  laws say a pixel splice is a 2x tool, so at 4x the still goes in as the attention reference. Files, words, sigmas and tiling are the
  method's `run` (SNAP-R13). *Why:* the operator, 2026-11-05: "you can even try the tessera tiled upscaling process if we wanna
  try out 4k". *More:* PLAN U102b, the pack's docs/LAWS.md, tests/snap/test_u102b.js.

## Voices, reflection and sources (U93-U95, 2026-11-06)

- **SNAP-R88: A voice reference renders at 12 steps or more; ordinary takes keep their setup's steps.** A take made to
  be a voice reference (a Cast's voice, a casting round) runs at 12 or more sampling steps at a low resolution (256x160
  is enough: only the sound is kept), and its plan says so; every other take stays at its setup's steps (6 on the Pika
  turbo). The reference carries the timbre, because H3 ignores pitch, age and sex words in text (a boy "voiced by an
  actress" came out at 97-138 Hz, and two different castings read as one speaker, WavLM 0.78-0.94); every cut where the
  character speaks cites it (SNAP-R73). Until a voice route exists, an agent sets the steps by hand (AGENT_START,
  Voices). *Why:* the operator, 2026-11-05: "if you generate audio with H3 you can do it at pretty low resolution but you
  need at least 12 steps to get good audio quality … for a reference voice"; "normal video is fine at the specified 6".
  *More:* DECISIONS 2026-11-05, the dogfood study's LESSONS (voice lane) and FINDINGS F-C11.

- **SNAP-R89: The critic reads whole frames, a place's logic and cut pairs, and only leaves notes.** *(built as SNAP-R101-R104, U93)*
  A critic job runs on every landed take and on every master, sheet, plate and board, since a flaw in a plate flaws
  every cut that cites it. It looks at the whole frame at full resolution before any crop (a tiled upscale tile by
  tile), and checks: logic, not only consistency (an enclosure closes, walls, roads and gates connect, a structure makes
  sense from every view); contact (bodies meet what they rest on); attachments (every wire, string, strap and sheath is
  held at both ends, per view on a character sheet); intersections (nothing clips); every view of a location side by
  side and against its master; cut pairs (the previous cut's last frame against this cut's first: position, facing,
  eyeline, light, props); the right Cast only, in its state; sound (a drone needs a spectral look, not loudness). Its
  findings are notes with a severity, drawn as masks (SNAP-R91), routed to the record they trace to (SNAP-R90); they
  never reject (SNAP-R23). Each flaw the person catches that the critic missed becomes a fixture; the critic is
  measured by its catch rate on fixtures and its false alarms on clean pictures. It is an agent role over the tool
  table (no model call from Snap, SNAP-R18). *Why:* every visible flaw in the 2026-11-05/06 shorts was caught by the
  person, not by agents: three different gates, a palisade that doesn't enclose the village, a floating sword, a
  double wall, ghost figures in an upscale's backdrop; causes: pictures judged one at a time, crops before frames,
  consistency checked but not logic. The person: "we need some kind of reflection process to catch obvious things like
  this"; "there is a wall and not surrounding the village … our reflection should be good enough I would have thought
  to catch this but it might need the right prompt iteration". *More:* DECISIONS 2026-11-05 10:12 and 2026-11-06,
  LESSONS "Synthesis 2026-11-06", the study's critic/ fixtures.

- **SNAP-R90: A flaw is fixed at its source record, then its dependents re-run upstream first.** *(built as SNAP-R105/R106, U94)* A
  note that traces to an upstream record (a location's plan, master or plates; a Cast version; the look) becomes a fix
  proposal on that record. Once applied (a new version, SNAP-R60), Snap lists what pinned the old version (takes,
  stills, boards, plates) and offers "re-run dependents" in DAG order (plates → boards → cuts → the cut), each stage
  with its plan and time (SNAP-R16), through re-run with swaps to the new version (SNAP-R63); new takes land as
  candidate versions beside the old ones (SNAP-R23), so no pick is lost. A canon change stays a proposal. *Why:* a
  re-rolled take keeps a flaw that lives in its plate (the double wall came back with a new seed and went with a new
  plate); after a Cast version, the boards that used the old one were found by hand (F-C22). The person: "if they came
  from a prior setting that needs changed up and re-ran any DAG things that depended on them?" *More:* DECISIONS
  2026-11-05 10:12, the dogfood study's FINDINGS F-C22.

- **SNAP-R91: A mark on a picture is a visible mask, and the mask feeds the fix.** *(planned, U95)* Marking a region
  draws a translucent highlight with an outline and a label; it stays on the picture and shows as a badge on the take's
  tile. Finishing a mark opens its note in place (tags such as architecture, physics, "object to nowhere"; words;
  Reject in the same step); a draft saves itself, and closing with an unsaved mark asks first. "Fix this" on a note
  opens Change something with the mask as the edit region, or routes to the source record (SNAP-R90). `note_take` takes
  a mask, and the critic writes its notes as masks (SNAP-R89). *Why:* the person, after a first "Mark region" on a
  rooftop take with a string going nowhere: "wanted to mark it as a fail and why … was hoping to see some masking
  transparency outline or something where I marked on what went wrong". *More:* DECISIONS 2026-11-05 10:22.

- **SNAP-R92: A third-party character catalog is a linked resource; its characters are never shipped.** Snap and its
  docs may link a catalog of styles and characters (such as the MOSS-Image Character & Style Catalog) for people to
  browse. Its existing characters are never embedded in the pack, offered as Cast sources, kits or Library cards. A
  later style list may take the catalog's styles with the character details permuted, so no entry is an existing
  character. *Why:* the operator, 2026-11-05: "You are free to link that as a resource for people, there's plenty of fair
  use, but I'm not embedding those direct characters into this app." *More:* DECISIONS 2026-11-05 14:4x.

## Agent instructions and skills (U103/U104, 2026-11-06)

- **SNAP-R93: Agent instructions are layered records, resolved per scope, pinned by every run.** An instruction is a
  world record (kind `instruction`, SNAP-R60) with one scope (`global`, `tool:<name>`, `brick:<key>`, `method:<id>`,
  a pinned record's ref such as `cast:<id>` or `location:<id>`, `scene:<id>`, `shot:<scene>/<shot>`, `take:<id>`;
  `book:<id>` is kept for the Book) and a kind (`note`, a line read whole, or `model_choice`: job → choice, why). The
  pack ships its own in `snap_cards/pack_notes.json` (each version 0 with a hash, `/mainodes/snap/pack_notes`); an
  admin's notes with `shared: true` form the install layer on a gated install; the rest are the person's. For any call
  the stack is the fold pack → install → person → book → scene → shot → take, plus notes on records the recipe pins,
  general targets before specific, oldest first. A note adds unless it `replace`s outer ones it names in `supersedes`;
  same-job `model_choice` notes: the inner level wins (the outer is listed `overridden`), at one level they are a
  `conflict`; both cases are shown, never hidden. Off and seen are the person's marks (`snap/instructions.json`), never
  versions. The stack has a hash of its live refs (an off note is out of them; G2, dogfood F-D09: turning a tweak off gives back the old hash); `instructions`, `describe_recipe`, `get_take` and
  `get_scene` return it whole (SNAP-R58), the pack's `tool:` notes end that tool's description, and every queued Snap
  run pins `{refs, off, context}` in `extra.snap.instructions`, so a take says what it ran under, what applies now and
  what changed (texts at both versions). Instructions stay off the take's stale chip: a note edit doesn't change what a
  chain renders. *Why:* the operator, 2026-11-06: "learned things for the agents using a particular set of tools should
  have instructions attached in that Snap block's WebMCP, but then each person will have their own memory instructions
  that get bound to particular projects or particular scoped workflows … a button that you can view all the agentic
  instructions that would have been applied to a particular block or a particular workflow or a particular project …
  if things aren't going well you can inspect the instruction set and troubleshoot easier". *More:*
  DESIGN_U103_U104_AGENT_LIBRARY_2026-11-06.md, PLAN U103, `web/snap/instructions.js`, `snap_instructions.py`,
  tests/snap/test_instructions_resolve.js, test_instructions_pins.js.

- **SNAP-R94: Skills are pack files a person's version sits over.** A skill is `.claude/skills/<name>/SKILL.md` in the
  pack (the format Claude Code loads; front matter `name`, `description`, `scope`, `rules`), served whole by
  `/mainodes/snap/skills`, `list_skills` and `read_skill` and named by `/mainodes/snap/info` (no page needed). A
  person's version is a `skill` record whose body keeps the pack text it began from; it is what agents read, with a
  diff against the pack and one press back to it, and when the pack file changes under it the record says so and shows
  pack then, pack now and theirs, never reverting by itself. `snap-core` says how Snap links together and how
  instructions nest; task skills say how to do one job with exact calls and measured numbers. This extends SNAP-R30's
  front door: what agents learn about using Snap is written into a skill (`save_skill`) or an instruction, with its
  numbers and its reason, not into one agent's private memory. The Agent library (Library rail; an "Agent instructions"
  button on bricks, the recipe, scenes, shots, takes and Cast records) shows skills, every note and what applies to
  one object. *Why:* the operator, 2026-11-06: "we need to make sure we have a proper skill on how things link together
  in Snap and how things get their instructions nested, and good other skills that show you how to do certain things
  easier, and we have a good way to view these skills in the web UI too, as an agent library kind of thing … that way
  all the dogfooding we are doing is using the app, and we keep optimizing a nice package we can hand people, but then
  they can tweak it if there are things they want to change"; on the docs: what we are learning as we go "should apply
  substantially to using it too". *More:* PLAN U104, `web/snap/agentlibrary.js`, `tools/snap_skills.sh`,
  tests/snap/test_agent_library.js.

- **SNAP-R95: An agent's instruction applies at once and stays marked until the person looks.** `save_instruction` and
  `save_skill` write a version `by: agent:<name>` (the bridge names the calling agent) that is in force at once; the
  Agent library shows it "new from <agent>" and the rail row counts it until the person opens it, a quiet toast says
  it arrived, and one click turns it off. An agent turns its own notes off directly; turning off a person's or the
  pack's note waits as a proposal (SNAP-R23), and the agent can write a replacing note meanwhile. Imported notes and
  skill versions land off until the person turns them on. A member of a gated install may turn an admin-shared note
  off for themselves ("off by you"; marks inform, SNAP-R11). *Why:* the operator, 2026-11-06, on apply-now with a mark
  and one-click off: "that sounds wise to me … it's a clear set of instructions that you can tell the agent to tweak".
  *More:* DECISIONS 2026-11-06 04:19 and 04:38 (Q1-Q5), tests/snap/test_instructions_store.js.

## Batch G1 (2026-11-06)

- **SNAP-R83: Agents drive the person's main tab; the agents' window is one visible Chrome they attach to, reload and
  restart, never headless.** With no use_page, calls go to the newest tab that sees: the agents' window or a tab whose
  person turned "Let agents see" on. While a person's tab is open with the control off a call is refused, never sent to
  another page instead; only a server with no person's tab at all (a test server) falls back to an agent's headless page.
  The agents' window is one Chrome (profile `~/.config/snap-agent-chrome`, DevTools on 127.0.0.1:9222) that
  `tools/snap_agent_page.sh` attaches to whenever 9222 answers and opens only when nothing does, on a display, under
  systemd-run so a ComfyUI restart never takes it down and stopping it ends every process of its profile. The launcher
  tells the server its port (kept in the user folder); the bridge finds its tab by the client id in the tab's
  sessionStorage, counts it as a tab that sees, captures it for screenshot, and the `chrome` tool (status, reload, start,
  restart) reloads it after an update, so an agent never waits on the person for a stale tab (F-C24). It opens no
  other tab by itself: another tab needs the person's yes (`new --asked`); an extra window (its own profile and port,
  its purpose as its window name) serves only parallel work on another server and is closed when that work ends.
  *Why:* the operator, 2026-11-05: "the default behavior should always be my main tab and you should need permission to open
  another tab and if you do it should NEVER be headless"; 2026-11-06: "we need to make sure you have an open chrome
  window you can control and hook into and restart and make it non headless always", and on extra windows: fine "if you
  are doing some things on one gpu and some things on another or doing non gpu contention things". *More:* DECISIONS
  2026-11-05 12:36 and 2026-11-06, PLAN U96, tests/snap/test_agent_page.py, tests/snap/test_g1_window.js.

- **SNAP-R84: A location is a record, and a shot cites its plates by name.** A location (`snap/location/<id>.json`,
  versioned like a Cast, SNAP-R60) holds a master picture, a set plan, camera marks on the plan and named plates, each
  plate a picture in input/ with its camera pose ({x, y} in fractions of the plan from its top left, heading in degrees
  clockwise from its up, eye height in metres, lens in mm) and the take and frame it came from (a take's frame is saved
  into input/ when it is added). `apply_location` puts the master, the plan and the plates named into References as
  `<Picture n>` (the answer cites each) and pins the version; a New view takes `{location, plate}` as a picture and
  pins it too, so every still, board and take says which version of the place made it. A cut cites its own place's
  plates, never the next place's as a reference: in the walk test a plate of where she would walk next made H3 hard-cut
  to it in 3 takes of 8. Each cited picture is the shot's camera (this exact framing) or the place (the same set, the
  camera the words describe), named per shot (`camera`) or by the picture's record role, and the References row and the
  answer's `prompt_hint` say which: H3 takes a reference picture as the camera and copies its framing unless told
  (short03 F-C28, 3/3); `rerun` swaps a location like a
  Cast and `dependents` lists what each version of any record still feeds. The Location sheet shows the master, the plan
  with each camera mark and plate drawn as a dot and a wedge (where it stands, where it looks, how wide its lens sees)
  and the plate tiles; every picture opens full size (SNAP-R80). A place kept as a Cast moves over with
  `cast_to_location` (the Cast stays; its takes stop showing the description miss, which a set never had: F-C29), and
  `remove_from_world` (or the x on a pin chip) takes any record out of a recipe, the record kept (F-C27). *Why:* the operator, 2026-11-05: "getting the topology of the
  town ... is what you need to do in order to get a consistent setting", and on the walkthrough plates: "yep this is the
  right shape"; short03 kept its village as a Cast for want of a record (F-C17). *More:* DECISIONS 2026-11-05 13:1x and
  16:5x, PLAN U99, dogfood FINDINGS F-C17/F-C19/F-C22, tests/snap/test_g1_location.js.

- **SNAP-R85: What a picture is for is a known field, and a reference is redrawn when made bigger.** The view slot's
  registry names the purposes (character, turnaround, cast_picture, set, master, plate, settei, edit), each with its
  New view model and whether it is a reference. A take knows its purpose from the word set on it (`set_purpose`), from
  what made it (a New view keeps the purpose it was made for, a character sheet is a turnaround), else from the records
  that use it (a location's master or plate, a Cast picture made from its frame); an upscaled take is for what its parent
  is for. Made bigger, a reference is redrawn by stage 2 at a light denoise, stills included (the still's own graph at
  the new size, starting from the still), never only sharpened, and `upscale_take` and the take viewer say why.
  *Why:* the operator, 2026-11-06, on Maren v4: "redraw a bit is good because we are trying to make the REFERENCE :)
  this should be obvious and that it is not means we need to tweak our harness / app a bit". *More:* DECISIONS
  2026-11-06, tests/snap/test_g1_purpose.js.
- **SNAP-R86: The New view model follows the job, and says so.** With no method given, the purpose picks it: character
  shots, turnarounds and Cast pictures on the Fizgig H3 still, sets, wide shots, masters, plates, settei and targeted
  edits on P-H3-Image; with no purpose either, a Cast picture among the pictures reads as a character shot, else a set
  view. The answer's `chosen` and the tray's line under "what it is for" name the model and why; a method or a purpose
  picked by hand wins. *Why:* the operator, 2026-11-06: Fizgig for character shots and turnarounds, P-H3-Image for
  sets, wide shots and targeted edits, chosen from the job and overridable (bake-off B: characters 25/33 vs 22/33; P-H3
  held the master's gatehouse and is the fastest). *More:* DECISIONS 2026-11-06, PROGRESS 2026-11-05 15:45.

- **SNAP-R87: A finished render is never lost to the step after it.** When the Upscale brick fails (RelayVSR out of
  memory at 4096x2048 in short03 F-C26), the same prompt runs again without the upscale, its consumers fed by the
  upscale's own input, so ComfyUI serves the render from its cache and it lands as its own take, a child of the failed
  one, whose job says what failed; a node out of GPU memory says so by its title on the Work card. Before the run, an
  upscale whose output is past the GPU's memory (the method's measured VRAM scaled by output pixels) warns on its brick,
  never blocks (SNAP-R11). *Why:* short03 lost a finished render and two GPU minutes to an upscale it never asked for.
  *More:* dogfood FINDINGS F-C26, tests/snap/test_g1_friction.js.

## Batch G1b (2026-11-06)

- **SNAP-R111: The character score raises "probably a different person"; ArcFace is a number to look at.** The
  identity check (MAISnapIdentity with the copy check's encoder) gives every face SAM 3.1 finds a character embedding:
  DINOv3 ViT-H's CLS token of a square crop 1.5x the face's box, the whole crop at the encoder's input. A pair whose
  character score is below the encoder's `character_check.different` (0.45) gets "probably a different person" (a new
  view's or a recast's "probably not <name>"); from `same` (0.55) the quiet chip says "same character". ArcFace stays in
  the title and in every answer (`face`, `face_low`, `arcface_lowest`) and never flags. Faces are matched one to one by
  the sum of both cosines (SNAP-R76). The hair check stays: the character score read a grey-haired edit as kept (U54),
  and relighting still mutes the flag (SNAP-R23). A note written before this says "identity: older check". *Why:* on six
  anime characters (27 pictures) ArcFace below 0.35 flagged 7 of 21 same-character pairs, both of Brann's bowed
  profiles among them (0.03-0.06); the character score flagged none and caught 87 of 105 other-character pairs; on
  U56b's photo frames it still flags the other woman (0.405) and no longer flags U54's kept night anchor (0.523, an
  ArcFace false alarm at 0.29). *More:* scout/id_copy_measures_2026-11-06.md, tests/snap/test_g1b_id_copy.py,
  tests/snap/test_identity_notes.py.
- **SNAP-R112: "Copied Picture n" reads the soft score; the same-cell score tells framing from composition.**
  MAISnapCopyScore gives a second score per picture: each DINOv3 patch's best match anywhere in the other picture, both
  ways, averaged. A New view still at or above `copy_check.soft_threshold` (0.82) against a context picture gets
  "copied Picture n · same framing" when its same-cell score also reaches `threshold` (it re-renders that view), else
  "copied Picture n · same composition" (the same picture drawn from another viewpoint: short03's aerials of the master,
  a mirror). Below it the tile names the nearest picture quietly. *Why:* the same-cell score put the U101 aerial re-draws
  at 0.52-0.54, among new views (0.42-0.53), so the 0.72 note missed every one; the soft score separates all 20 pairs
  (copies 0.839+, a mirror 0.874, new views at most 0.805). *More:* scout/id_copy_measures_2026-11-06.md,
  tests/snap/test_g1b_id_copy.py, tests/snap/test_u101_fc.js.
- **SNAP-R113: Stage 2 has a fast choice, and quality stays the default.** `stage2`'s `speed` is "quality" (the take's
  own cfg) or "fast" (cfg 1 on every guider that samples again, one model pass per step); the take viewer's Speed row
  and `upscale_take` name what each costs (about 1.7x faster, a touch softer), the estimate divides by it, and the new
  take's options and job title say "fast (cfg 1)". Nothing picks fast by itself. *Why:* the stage 2 A/B on the Maren
  v4 orbit at 2K: 10.4 min instead of 17.9, same VRAM, flicker 3.71 vs 4.07, slightly softer eyes and line weight, the
  same scabbard, straps and face; one orbit and one seed, so the operator decides whether it ever becomes the default.
  *More:* u102b/STAGE2_CFG_AB_2026-11-06.md, tests/snap/test_g1b_fast.js.
- **SNAP-R114: A take that cites a Cast voice gets a voice note, and the note never blocks.** When a take whose
  recipe has a Cast's voice reference in References (`<Audio n>`, SNAP-R73) lands, the page that captured it queues a
  check (MAISnapVoice: WavLM-SV speaker embedding and the median F0 of the loud voiced frames) of its soundtrack, the
  cited reference and every other Cast's newest voice, and keeps the result on the take as `voice`: per cited voice
  "voice matches <Cast> 0.98, next closest <other> 0.91 (+0.07), F0 186 Hz vs ref 184 Hz", status ok (own at least
  `voice_check.ok`, ahead of every other Cast by `margin`, F0 within `f0_semitones`), check (with why; worded "voice
  vs <Cast>") or no voice. The card and the take viewer show it, amber unless ok; `check_voice` runs it again. The
  numbers come with the margin, never "the same person". *Why:* the operator, 2026-11-05: every cut where a character
  speaks cites the reference and "timbre consistency across cuts is checked"; the voice scout found cuts citing the
  reference keep it (own 0.97-0.99) while two young women overlap (0.81-0.95), so a margin and F0 say more than a
  score. *More:* scout/voice_timbre_2026-11-06.md, tests/snap/test_g1b_voice.py, tests/snap/test_g1b_notes.js.
- **SNAP-R115: A first frame combines with references: under Ref2V it opens the shot as <Picture 1>.** A Ref2V render
  reads no first frame, so while the Render Preset conditions on Ref2V and the First frame brick holds a picture, that
  picture is also in References as `<Picture 1>` (role "first frame: the shot opens on it"), wired into H3 References'
  first slot ahead of every other picture. It follows the recipe: a setup change to Ref2V (apply_cast or apply_location
  switching it, apply_setup, the setup sheet) puts it in, a change back to FL2V takes the copy out (the First frame is
  read as it is), a new First frame replaces it; apply_cast, apply_location and use_take say so, and apply_location's
  prompt_hint names it first. *Why:* short03 F-C32: use_take as the first frame, then apply_cast switched the preset to
  Ref2V and the frame dropped out; and the walk's camera height is set by its first frame, never by words (an eye-level
  still as Picture 1 of a Ref2V walk held eye height 2/2 with the set kept; words 0/2). *More:* dogfood FINDINGS F-C32
  and LESSONS 2026-11-06 05:50, tests/snap/test_g1b_opening.js.
- **SNAP-R116: A page never works from records another writer changed.** Every write the server makes to a record
  (save, fields, archive, delete) is told to open pages (`snap_world`, with the writer); a page that didn't write it reads
  the records again and says "<name> updated by <writer>". Before any tool runs, the page asks `/mainodes/snap/world/rev`
  (a fingerprint of the person's record files and instruction marks) and reads again when it moved, so a script's or a
  hand edit's change is in the next answer too: `instructions`, describe_recipe, list_cast and the run's pins see it
  without a reload. *Why:* dogfood F-D01 (short04): the operator's 11 seeded person notes were missing from every
  instruction answer and run pin until a reload, with no stale hint; the Agent library only re-read on focus.
  *More:* dogfood FINDINGS F-D01, tests/snap/test_g1b_fresh.js.
- **SNAP-R117: A render is lost only when the server has it neither queued nor in its history.** A candidate whose
  /history read is empty is waiting while its prompt is in /queue; when it isn't, /history is read once more (it can
  finish between the two reads) before the candidate is marked "the server has no record of this render", and a
  candidate marked so whose prompt later shows in /history turns ready with its pictures. *Why:* dogfood F-D03
  (short04): a New view candidate queued behind five runs was failed for good while its render succeeded, so it could
  be neither seen nor applied. *More:* dogfood FINDINGS F-D03, tests/snap/test_g1b_lost.js (2/6 on the code before).

## Batch G2 (2026-11-06)

- **SNAP-R118: References are edited where they show, and the prompt's cites follow the pictures.** Each picture on the
  References brick shows its `<Picture n>` (P1, P2 …), its role (click to rename), ‹ › to move it and ✕ to take it out,
  plus "+ Add ▾" (a take from any scene through the take picker, a picture file, a Cast, a location). A file dropped on
  References is a new picture, never a swap of one already there. Moving or removing a picture rewrites the Render
  prompt's `<Picture n>` so each cite keeps naming the picture it meant; a cite of a picture taken out becomes
  `<Picture ?>` and the toast (or remove_ref's `orphaned`) says to rewrite it. A picture the prompt names nowhere shows
  "not named in the prompt" (`describe_recipe.references[].named`). Agent twins: add_ref (a role for a picture already
  there renames it), remove_ref, move_ref, use_take. *Why:* UX walkthrough UI-01 / B1 / B12: a plate dropped on References
  replaced the Cast's turnaround silently, and nothing could be removed, reordered or numbered from the UI.
  *More:* UX_WALKTHROUGH_2026-11-05.md UI-01, tests/snap/test_g2_refs.js.
- **SNAP-R119: "Missing" means the file is gone, not that core's list doesn't show it.** Core's Load Image and Load Audio
  list only input/'s top level, so the page asks `/mainodes/snap/input_exists` once per graph for input files its lists
  lack (a take's frame in snap/, a Cast's picture in snap/cast/<id>/); a file the server has joins its widget's list,
  and the status pill, the inspector and describe_recipe.missing count only what is really gone. *Why:* UX walkthrough B2
  and dogfood F-A29: every Ref2V shot built from take frames or Cast pictures read "N missing" though it rendered.
  *More:* UX_WALKTHROUGH_2026-11-05.md UI-08, tests/snap/test_g2_refs.js.
- **SNAP-R120: A new shot keeps the open shot's setup and none of its content; copying is asked for.** "+ Shot ›
  New shot" (add_shot's default `start: "clean"`) keeps the models, Render Preset, core and turbo LoRAs, sampling, size,
  Upscale and Save, and leaves out the Casts, locations and sets (pins and pieces), References, the First frame, dials,
  style and Cast LoRA rows and the prompt; open_shot's `built` lists what was left out. "Copy Shot n as it is"
  (`start: "copy"`) copies everything. *Why:* dogfood F-A17, F-C27, F-C31, F-D07, F-D12: each later shot inherited the
  earlier one's characters, hand-added pictures, a night-rain dial and its prompt, and rendered them unseen.
  *More:* G2_TRIAGE.md, tests/snap/test_g2_shots.js.
- **SNAP-R121: An agent's answer carries what the work really is, never a shortened stand-in.** Decision titles and take
  labels hold the whole prompt or change words, plus the method and count ("New view · P-H3-Image ×2 (…)"); only the
  tiles shorten what they show (`shortLabel`). A family switch by preset name starts from a pack card or the recommended
  recipe, never from a "Last used" stack, and says what the new recipe carries besides its setup (`carried`: dials, LoRA
  rows, Upscale) and which shot the tab still is; a new tab opened from a shot says it isn't in the scene and how to add
  it. A location plate's eye height is compared with its camera mark's (`eye_gaps`); a LoRA's caption files come with
  describe_lora (`beside`); a Cast's words go under a bare section header, keeping a trained caption's shape; apply_location
  puts its `camera` picture first. *Why:* dogfood F-D02, F-D04, F-D05, F-D06, F-D08, F-D10 (short04): two decisions read
  the same, a night-rain dial rode into a dusk shrine shot unseen, an agent thought it had left its scene, the walkthrough's
  camera plate came third, a caption's structure broke, a 0.6 m low walk passed unflagged. *More:* tests/snap/test_g2_fd.js.
- **SNAP-R122: A shot says when its recipe no longer makes its ★ take, and looking never writes.** When the open shot's
  chain (seeds aside, as the stale chips read it) differs from its active take's, a line over the chain names what
  differs, with "Load ★ take's recipe" (one undo step) and "Keep editing"; open_shot and run answer
  `recipe_matches_active` and `recipe_differs`. Moving between shots saves the open one only when its graph differs from
  its file (compared without node sizes, sockets by name), so browsing a scene, someone else's too, writes nothing.
  *Why:* UX walkthrough UI-09 / B3 / B10 and dogfood F-A19, F-A30: C04's recipe was another cut's while its ★ take was
  Granny, and every shot switch rewrote the shot and scene files. *More:* tests/snap/test_g2_truth.js.
- **SNAP-R123: A picture goes where it is going from the take that made it.** The take viewer's "Send to ▾" sends the
  frame at the playhead (or the still) to References, to a Cast as its next picture (a new version whose note names the
  take and frame), to a new cast member, or to a location as a plate (a new version, the plate's `from` = the take); the
  Cast sheet has "+ from a take" (the take picker); use_take `as: cast | plate` is the agents' twin. A new Cast's uploads
  go to its own folder from the first picture. A still's viewer shows no video-only verbs. *Why:* UX walkthrough UI-03,
  UI-12, B14: the design lane's pictures could only reach the video lane by a file hunt on disk.
  *More:* tests/snap/test_g2_send.js.
- **SNAP-R124: A shot chooses which of a Cast's pictures it uses, and nothing swaps them silently.** apply_cast `pictures`
  (roles: a state, a view) puts only those in and the pin keeps them; the Cast chip's picture button picks them; an update
  to a version that lacks one is refused with what to do, never applied as another state. A re-run can take a Cast out
  (`{to: "out"}`, the sheet's "— take X out"); the Scene row lists only scenes with a set. *Why:* UX walkthrough UI-04 /
  UI-15, dogfood F-A20: "v4 available · update" would have turned a state-A cut into state D, and a Granny-only cut
  carried a Suna row nobody could remove. *More:* tests/snap/test_g2_send.js.
- **SNAP-R125: A scene plays in order, and the design lane has its own door.** "▶ Play scene" plays each shot's ★ take
  (its newest when none is active) in order, a still held 2 s, with a strip of the shots (the current one lit, a press
  jumps; Space, arrows, Esc). The empty state offers "Start a picture" (the stills kit) beside the video start, and the
  stills Render shows size chips (1024², 16:9, the video size, portrait). get_take gives `prompts {positive, negative}`
  (a negative that is the positive zeroed out is null); set_widget takes a brick's node key. On a phone a scene row
  stacks and the take viewer's date wraps under where it is. *Why:* UX walkthrough UI-07 (v0; trims, sound across cuts
  and export wait for the Cut), UI-10, UI-18, dogfood F-A33, F-A34. *More:* tests/snap/test_g2_polish.js.
- **SNAP-R126: The gate lives with the code, and nothing local lives in the gate.** Every suite `run_all.sh` calls is in
  `tests/snap/` on the branch it tests; ports, bases, units and folders come from one config (`snaptest_config.js` /
  `.py`, set by an env file), results and screenshots go to `SNAP_TEST_OUT`, and pictures from private work stay in
  `SNAP_TEST_FIXTURES` with only their manifest (`fixtures.json`) in the repo. A missing folder fails the suite by name;
  the CPU server's privacy suites never skip. *Why:* parallel builders broke each other's gates by editing one shared
  copy of the tests outside the repo (2026-11-06), and a test path is a private path. *More:* tests/snap/README.md.

## The Book (U97, 2026-11-06)

Snap's production layer (layer 3 in the same app): `web/snap/book.js` (records, the story clock, compile, stale, the dial,
assembly), `booktools.js` (the tools), `bookview.js` (the Book sheet), `planview.js` (a set plan drawn in Snap),
`snap_book.py` (the assembly node and the OTIO route). R67-R69 and R130-R133 are the Book's; R70 is the Room
(G7, below with R173-R177).

- **SNAP-R67: The Book holds a production on two clocks, and its canon is the person's.** A `book` record (story,
  production style, autonomy dial, Cast, locations, scenes in order) and one `story` record (beats in story order, each
  with `order` and `told` ranks, text, intent, intensity, lines, `changes` {entity, path, op, value, why, source},
  `plants` {what, window} and `pays_off`; `groups` over beat ids) version on the production clock like a Cast; a beat
  is a moment on the story clock. Units are the Book scene's shots (`shot.unit`: cut number, beats, Cast, props,
  location and plate, timing, board, trim, transition); a cut number is an id, never a position, and the Cut follows
  telling order. Story, style and the dial are canon: an agent's write to them is always a proposal (`add_beat`,
  `edit_beat`, `move_beat`, `add_change`, `save_story`, `keep_as_canon`, `save_style` on the Book's style,
  `set_autonomy`), at every dial position, and the story version made by the person's Accept names the proposal in its
  note; `saveStory` refuses an agent's write without one. Everything else follows the dial per stage (`beat_sheet`,
  `pages`, `settei`, `boards`, `cut_bag`, `dailies`, `the_cut`: assist waits, collaborate follows Let agents run,
  automatic goes ahead with `by: agent`), read where SNAP-R16's flag is read; outside a Book nothing changes. A take made
  from a unit carries `story` {book, ref, beat, unit, from} beside `world`, and its job's `about` names the book, beat
  and cut. Pages is the story as Fountain (`import_fountain`, `export_fountain`, the Pages lens): the script is telling
  order, and a beat keeps its id and changes when its text is unchanged or edited in its scene. *Why:* the operator's answers of 2026-11-05 (the Book, the Room, the Work card; canon changes are always
  proposals, even on automatic; the first anime's dial mix). *More:* CONCEPT_PRODUCTION §11.1-§11.5 steps 1-2;
  tests/snap/test_book_story.js.
- **SNAP-R68: A unit compiles from the state at its beat, with provenance; a render never writes state.** An entity's
  state at a beat is its base folded with every change on a beat at or before it in **story** order (a flashback compiles
  as the younger state). `compile_unit` shows the compiled state sheet: each field with the beat and change that set it
  (`story:<id>@n b4 change c2`), the sentence it becomes, and its backing (a state picture or "words only"); the place
  and plate; the reference package with roles and the 9-picture budget; the prompt sentences with their sources. The
  production style's paragraph goes first. Takes pin a hash per field the compile used, so `story_stale` names only the
  fields a unit used ("story: Ferro.carried.right_hand changed at b4"; a reworded intent flags nothing), and a story
  edit's proposal says what it would re-flag before it is saved (reversal cost). A take that shows something the story
  didn't say becomes canon only through `keep_as_canon`: a proposed change on that take's beat. *Why:* §4.1.2-§4.1.3 and
  §6 risk 5 (hash only the fields used); "pictures beat words" is why the backing is shown. *More:* tests/snap/test_book_compile.js.
- **SNAP-R69: A state is held by its pictures.** A Cast's `states` [{name, covers {path: value}, pictures [{file, view,
  from}], words}] are its settei per state; wherever the fold gives a state's `covers`, the compile cites its pictures
  first (role "state: <name>"), and a state with none reads "words only" on the sheet and in the Settei lens.
  `save_cast_state` saves a new Cast version whose note names the take each picture came from, so takes made before read
  the version move. *Why:* three GPU runs where the picture won over the words (green coat, red scarf); DECISIONS
  2026-11-05 08:38 (two lanes). *More:* CONCEPT_PRODUCTION §4.1.4b; tests/snap/test_book_compile.js.
- **SNAP-R130: A production's style is one record every cut inherits: paragraph first, palette linted, a still, no
  negative.** The `look` record holds the style paragraph (2-3 sentences in the catalogue's register), placed first in
  every compiled prompt and still prompt (then a blank line, then the subject); `palette` (monochrome, limited, full):
  under monochrome or limited the compile notes colour words in a Cast's line or state (a note, never a block); one
  reference `still` (the Ref2V Picture 1 for video); an optional LoRA; the house voice direction, sound palette and
  genre playbook. No negative (the H3 models run at cfg 1). The style is pinned on every take like a Cast, so a style
  change marks them. *Why:* the style scout of 2026-11-06 (placement is a wash, a colour word in the subject beat the
  palette 8/8, a colour-free subject held it); DECISIONS 2026-11-05 12:25. *More:* scout/style_record_2026-11-06.md.
- **SNAP-R131: Boards first: one frame per cut, approved before video, played as an animatic.** `make_board` makes
  candidates by New view from the cut's context (its plate as the camera, the previous cut's board as the nearest prior
  view, its Cast's state and identity pictures) with the cut's still prompt; `set_board` picks one (`approved`: the gate
  before video, a default and never a block). The animatic lays each cut in telling order: its kept active take where
  there is one, else its board held for its seconds; `apply_unit` opens an approved board as the cut's first picture.
  *Why:* DECISIONS 2026-11-05 12:22 (blocking, framing, transitions solved in storyboarding first); short03 F-C06.
  *More:* tests/snap/test_book_cut.js.
- **SNAP-R132: The Cut is assembled in a prompt, and exported as OpenTimelineIO.** The animatic and the Cut are one
  `MAISnapCut` prompt (Load Video of each take, Create Video of each board, trims, sound levels, one size and frame rate,
  sound at 48 kHz, silence where a clip has none) saved by the prompt's own saver as a take of the Book's group, so a
  take kept encrypted is opened by its loader and worked on in RAM scratch (SNAP-R98) and privacy fails closed.
  `export_cut` also writes an OTIO file (video and audio tracks, a marker per cut, `metadata.snap` with each take) under
  output/snap_book/. *Why:* short04 F-A23 and F-D15 (ordering, trims and loudness happened in ffmpeg outside Snap).
  *More:* tests/snap/test_book_cut.js.
- **SNAP-R133: A set plan is drawn in Snap, and its picture holds shapes and labels only.** `draw_set_plan` and the
  "Draw the plan" editor keep `plan {file, shapes}` and the camera marks on the location record (a new version); the
  saved picture is black on white with shapes and labels, while camera marks stay on the record and the Location sheet
  draws them over it. *Why:* short04 had no drawing tool (the shrine's plan was drawn outside Snap), and marks drawn into
  a plan picture leak into renders that cite it. *More:* tests/snap/test_book_cut.js.

## Accounts and the gate (snap-gate)

IDs R40+ were reserved for the gate while R28-R39 were open for other work (renumber at merge only if they collide). R50-R55 and R58-R66 went to the pack; the gate has R56 and R57. New rules from either side take the next free ID (the Book took R67-R69 and R130-R133 and keeps R134-R139; R70 is the Room (G7); G1 took R83-R87, the docs migration R88-R92, the agent library R93-R95, the vault R96-R100; U93/U94 took R101-R110; G1b took R111-R117; G2 took R118-R125; the tests move R126; the next free ID is R127, then R140 after R129).

- **SNAP-R40: The org layer is a wrapper, never core.** `snap_gate/gate.py` is a separate service on the port people
  use; an unmodified ComfyUI listens on 127.0.0.1 behind it (with `--multi-user`), and the gate speaks only HTTP and
  WebSocket to it. Off (`--disabled`) it relays every byte unchanged: no sign-in, no filtering, ComfyUI as it is.
  Limits (ratings, buckets, admin-only routes) exist only when an install turns the gate on; Snap itself never limits
  the person (the operator, 2026-11-04 16:46: no artificial limits in Snap). *Why:* core and the pack keep updating; product
  logic stays out of `comfy/` (ComfyUI AGENTS.md). *More:* CONTENT_RATINGS_VAULT §5, PLAN U65/U66.
- **SNAP-R41: A session decides the user; the client never does.** Every request needs a session (the sign-in form,
  or an account token as `Authorization: Bearer`, or a one-time `/gate/login?token=` link for a headless agent page).
  The gate drops the client's `comfy-user`, cookie and token and sets `comfy-user` to the account's own ComfyUI user (made
  through core's `/users` on first sign-in). `GET /users` answers in the single-user shape so core's user picker never
  shows; `POST /users` and `/internal/*` are the admin's. Passwords are scrypt hashes in the gate's own state folder,
  outside ComfyUI's `user/`. The admin can do everything. *Why:* `--multi-user` alone trusts a header any page can set.
- **SNAP-R42: Work is owned.** `POST /prompt` records prompt_id -> account, and refuses a prompt_id another account owns.
  `/history`, `/queue`, `/api/jobs`, WebSocket events, deletes, cancels and interrupts only reach the account's own runs.
  A WebSocket client id belongs to the first account that used it, and a prompt aimed at another account's client id
  is re-aimed at nobody. Saves go to `output/<account>/` (every `filename_prefix` input is rewritten; `shared/...` stays
  shared; one that climbs out is refused). `/view` serves the account's folder, `shared/`, and files its own runs wrote;
  hash names and others' files are 404. The Snap bridge sends a call to the newest page of the caller's own account (the
  pack keys pages by the comfy-user header the gate sets, SNAP-R30), and a page registers only its account's own socket.
  *Why:* core's history, outputs and `/view` are
  shared by everyone on one server, and core hands a reused client id the old socket's events.
- **SNAP-R43: Ratings cap files everywhere they appear.** Accounts have a max rating, PG / Mature / Adult (role
  defaults: admin Adult, member Mature, kid PG; the booru four map onto them). A file's rating comes from the pack's
  model graph under the admins' own `snap/models.json` (`rating`, or an `nsfw` tag = Adult), else from the rating the
  pack saved a file made here with (`user/snap_ratings.json`, the pack's SNAP-R39). The pack graph is the one of the
  pack ComfyUI runs (`<comfy-dir>/custom_nodes/ComfyUI-MAINodes`), so a gate from another checkout rates the same way.
  Other accounts' model graphs never rate anything, because they can write their own user data. Files above the cap are removed from every
  list generically (any list in `/object_info`, `/models/*`, `/experiment/models/*`, `/embeddings`, and any GET under
  `/mainodes/`), their metadata and previews are 404, and a prompt or pack request naming one (by name or file name) is
  refused before ComfyUI sees it. *Why:* hidden-only lists can be bypassed by typing a name into a prompt.
- **SNAP-R44: An unrated content file counts as Adult.** Kit downloads arrive rated and made files are rated when
  they are saved (the pack's SNAP-R39), so this covers files someone drops in by hand. An unrated LoRA, checkpoint, diffusion model, embedding (any
  folder not in the gate's helper list) is hidden from PG and Mature accounts until an admin rates it. Unrated helpers
  that can't decide what a picture shows (VAEs, TAESD, text encoders, CLIP vision, upscalers, detectors, ControlNets)
  count as PG. *Why:* a fresh download is unknown. For a kid, seeing nothing new until the admin rates it is the safe
  failure, and one rating opens it for everyone at or above that level.
- **SNAP-R45: Loading is decided by scope, not by the path's form.** A non-admin may load any library file within their
  cap, by name or by absolute path, and nothing outside the library and their own folders. An absolute path in a
  non-admin's prompt (or in a pack request) that names a file or folder on disk must be inside a model folder ComfyUI
  lists (`/experiment/models`) and rated at or below the account's cap, or inside the account's own, shared or top-level
  input, or its own or shared output within its cap (SNAP-R56, SNAP-R57); anything else is refused, naming why. Text
  that names nothing on disk is left alone. *Why:* the operator, 2026-11-04 20:41: "non-admins load models only in their scope
  (their role + rating)"; scope, not path form, decides. Nodes that load arbitrary paths (`MAILoadVideoPath` and many
  custom packs) would otherwise read any file the server user can. *More:* PLAN U83.
- **SNAP-R46: Sessions persist, and an idle one locks.** Sessions live in the gate's `sessions.json` under the sha256
  of the cookie, never the cookie itself, with a server-side expiry (7 days), so a gate restart signs nobody out. A
  session with no request for the admin's idle limit (`gate.py settings --idle-minutes`, default 30) locks: API calls
  answer 401 with `"locked": true`, a page load goes to the sign-in card ("Locked after 30 minutes without use… open
  pages keep their work") with the name filled in, and the page's open WebSocket gets nothing more. Signing in again
  keeps the page's client id and its runs. Account tokens (agents) don't idle, and neither does a page a token sign-in
  link opened (its session carries the token; a new token for the account signs those pages out; U72 F18). *Why:* the gated install is a shared
  machine; a restart shouldn't sign everyone out, and an unattended screen shouldn't stay open. An untouched ComfyUI
  page makes no requests (measured: none in 90 s), so the lock does fire for an open tab. *More:* PLAN U65.
- **SNAP-R47: Failed sign-ins wait, per account and per client address.** Three failures on an account (ten from one
  address, across names, the token link included) start a wait of 5 s that doubles with each further failure, capped at
  15 minutes; failures are forgotten after an hour without one, and a sign-in clears its account and address. During a
  wait even the right password answers 429; the card says when to try again and holds the button with a countdown.
  Counts are kept in memory (a restart clears them). *Why:* passwords on a family machine are short; a fixed delay
  alone lets a script guess all night. *More:* PLAN U65.
- **SNAP-R48: Shared pack files are the admin's.** The pack's preset folders (`models/loras/dials/presets/`, render
  presets under `render/`) and dial files' info are shared by every account, so only the admin writes them. Anyone
  else's preset save goes to its own user data (`snap/presets/<dials|render>/<name>.json`, in the shape the pack's
  load answers); its list is the shared presets then its own, and a load finds its own copy first. A name the shared
  folder has is taken (409, as the pack answers). `POST /mainodes/dials/info` (it rewrites a shared dial file) is 403
  for non-admins. *Why:* the U65 build let any account write files every account sees. *More:* PLAN U65.
- **SNAP-R49: The admin rates files on /gate/admin.** An admin-only page lists every model file by folder (helpers
  folded away, since unrated helpers count as PG) with a PG / Mature / Adult / Unrated select. A change writes `rating`
  (null for Unrated, so the pack's value stands) into the signed-in admin's `snap/models.json` through core's
  `/userdata`, reading it fresh first, the same file and field the gate rates from (SNAP-R43), so it applies at once.
  Cross-site posts are 403. The page also lists every file in `output/shared/` (its own "output/shared" section, the
  same selects): one a run wrote shows what it counts as from its run, one put there by hand "counts as Adult (nobody
  rated it)". The admin's rating of an output is kept in the gate's `outputs.json` (`admin`), wins over the run's own
  rating for `/view`, and Unrated hands it back; only files inside `output/shared/` can be rated
  (`POST /gate/admin/output_rating`). *Why:* rating by hand-editing JSON is how a kid ends up seeing an unrated file or
  nothing new at all; a picture the admin copies into shared/ for everyone stayed Adult with no way to open it (U90).
  *More:* PLAN U65, U77 (6), U90 (4).
- **SNAP-R56: An output keeps the rating of the prompt that wrote it, and nobody sees above their cap.** The pack rates
  every prompt when it is queued (`extra_data.snap_marks.rating`, server-side; the pack's SNAP-R39). The gate learns
  each run's rating and the files it wrote from ComfyUI's history (whenever it reads it, and when a run's
  `execution_success` passes an open page) and keeps them in its own `outputs.json`, so a rating outlives ComfyUI's
  history. A non-admin never gets a run or a file rated above their cap: `/view` is 404 (in output/shared/ and in their
  own folder alike), and `/history`, `/history/<id>`, `/api/jobs` and `/api/jobs/<id>` leave the run out. A file in
  output/shared/ that no run wrote (put there by hand) counts as Adult (SNAP-R44) until the admin rates it (SNAP-R49). Core's assets API (`/api/assets`,
  `/api/tags`), which lists every account's files, is the admin's. The admin sees everything. *Why:* a member could
  save into shared/ what a kid then opened; CONTENT_RATINGS_VAULT §2: caps are server-enforced, items above the cap are
  omitted. *More:* PLAN U88 (2).
- **SNAP-R57: input/ is per account.** An upload (`/upload/image`, `/upload/mask`) lands in `input/<account>/` (output
  uploads in `output/<account>/`), the admin's too, since the admin is a person with a bucket; a subfolder the page
  asks for goes inside it (`snap` → `input/<account>/snap/`). Only the admin puts files in `input/shared/`. A file name
  can't carry a folder. Anyone reads their own input, `input/shared/` and top-level files (the admin's); another
  account's input is 404 on `/view`, refused in a prompt or pack request (`kid/x.png`, `kid/x.png [input]`, or its
  absolute path), left out of the loaders' lists in `/object_info` (an input folder named after another account and
  anything in it), and a mask upload can't start from it. The admin sees all of it. *Why:* the operator, 2026-11-04 20:41:
  "input/ is per account; admin has access to all". *More:* PLAN U83.
- **SNAP-R100: Sign-in unlocks the account's vault; the last person's session locking or signing out locks it.**
  After the password checks, snap-gate unlocks the pack's vault for the account with the same password (an account
  with no vault is set up then), and a sweep every 15 s locks it once no person's session of the account is signed in
  (idle, expired or signed out). Token sessions ride on the person's: an agent sees private takes exactly while its
  person is signed in, and never unlocks alone. Unlock and the sweep take turns, so a lock never lands after a sign-in's
  unlock. *Why:* DECISIONS 2026-11-05 04:08 Q4 ("per session on a shared one"). *More:* `snap_gate/gate.py` (snap-gate
  branch), tests/snap/snapbox/test_vault_gate.py.

## The critic and fix at the source (U93/U94, 2026-11-06)

- **SNAP-R101: The critic is a docket job an agent claims; Snap makes the packet and keeps the notes, and never calls a
  model itself.** Every landed picture (a take, a New view candidate, a sheet, a board, an edit's painted candidate, a
  location version's master, plan and new plates, a Cast version's pictures, a cut pair) makes one critique row in the
  person's critiques store (`snap/critiques/`, written by the server, one row per subject), due until an agent claims
  it (`claim_critique`: one claim, server-side, lapsing after 30 minutes untouched) or the person reads its packet
  themselves. The Work card shows the rows, folded per decision and per record version, and says "critique due · no
  critic on duty" when nobody claims them. *Why:* the only measured critic is an agent reading full frames with the
  iterated prompt (r3: 24/29 caught, 0 false alarms; the first docket run: 25/29, 0); the operator, 2026-11-05: "we
  need some kind of reflection process to catch obvious things like this". *More:* DESIGN_U93_U94 §4.1, §4.5, SNAP-R89.
- **SNAP-R102: A critique reads the whole frame first, and nothing it reads is shrunk.** `critique_packet` hands over
  the subject whole at its native size, then 100% tiles (1536 px, 10% overlap, each labelled with its cell and pixel
  box) of every subject picture bigger than that, then the context pictures whole, then the words; part, offset and
  limit page it. A region named on a tile is stored in the subject's own fractions. *Why:* every miss of the first
  shorts was a crop or a thumbnail read before the frame (bodies sunk into a roof at 420 px; a scabbard floating on a
  sheet too small to read). *More:* SNAP-R58, §4.2.
- **SNAP-R103: A critique note carries its severity, its pass, its region drawn as a mask, its owner and a one-line fix;
  it informs and never blocks.** Notes land on the take they are about (`get_take` notes, by agent, with the critique
  id) and are drawn as translucent masks with an outline and a label on the take viewer and the Location sheet; the
  take card and candidate tiles say "critic: 2 high", and a clean verdict is shown too. Severity orders the list and
  feeds the approval rule only; nothing is hidden, rejected or held back by a note. A critique of a private take keeps
  its words on the take, which the vault seals. *Why:* checks are notes (SNAP-R23), marks are masks (SNAP-R91), no
  artificial limits. *More:* §4.3.
- **SNAP-R104: What is critiqued and how follows the picture's purpose and its place.** A checklist per kind of picture
  (master, plate, location, plan, settei, sheet, board, cut, cut pair, upscale, edit, still) names the passes and the
  context pictures (`snap_cards/critic.json`); the words for each live in the snap-critic skill's reference.md.
  *Why:* the dogfood critics showed which checks earn their keep where (architecture and continuity on cuts, cross-view
  on boards and plates, attachments on sheets), and a flaw in a reference spreads to every cut. *More:* SNAP-R85, §4.4.
- **SNAP-R105: A note's owner is where the flaw was born, and "Fix at source" opens that record's picture with the fix.**
  The owner is a record and part (a location's master, plan or plate by name, at the version the subject pinned; a
  Cast) or the subject itself (take, board, prompt). Fix at source shows the owner's picture (with the mask when it was
  drawn there) and a New view of it whose words are the fix line, so the fix lands as candidates beside the old picture;
  a pick of a plate or master makes the record's next version. *Why:* a re-roll keeps a flaw that lives in the plate;
  the operator: "if they came from a prior setting that needs changed up and re-ran any DAG things that depended on
  them?". *More:* SNAP-R90, §4.7.
- **SNAP-R106: Re-run dependents is a staged batch of candidates with its plan and time, stopping before video unless
  told.** `rerun_dependents` re-makes a record's stale takes on its newest version in stages, plates, then boards, then
  cuts; each re-made take is a candidate beside the old one, which stays active until a pick. A stage starts after the
  previous stage's picks, and a picked plate or master is written into the location first, so boards cite its new file.
  The plan says each stage's takes and time from their own runs ("no estimate yet" where none). chain ask waits for the
  person; chain run applies a candidate by itself only where its critique has no high note and the scene's note says
  approval: critic. through stops before cuts by default. A take the record holds as its own picture is stale only when
  what it was made from moved. *Why:* DECISIONS 2026-11-05 10:12 (upstream first, per-stage plan, the dial decides
  whether it chains); the coordinator's call 2026-11-06 05:12 (stop before video by default). *More:* SNAP-R16, SNAP-R63.
- **SNAP-R107: Approval is the person's, or the critic's where a note says so, and never a block.** A scene's or Book's
  instruction "approval: critic" (the innermost wins) lets a critique with no high note set the take's verdict to keep,
  by agent, with the critique named; a high note sets nothing; the person's verdict is never overwritten; the pack
  default is "approval: person". *Why:* "approval gate (person, or critic on automatic)" (DECISIONS 2026-11-05 12:22).
  *More:* SNAP-R17, SNAP-R93.
- **SNAP-R108: Every miss the person catches is one press from a fixture, and the critic's agreement is measured.** "Add
  as fixture" (or `add_fixture`) on a note copies the picture into the install's fixtures folder and appends the
  fixture with the note's words, region and severity; a private take's picture is refused. `critic_report` says verdict
  agreement, pick agreement, the misses and the last fixtures score, kept once a day. *Why:* the operator, 2026-11-06:
  "it might need the right prompt iteration to find things like this". *More:* §4.8-4.9.
- **SNAP-R109: The critic skill is the prompt's one home, and a prompt change ships only after the fixtures run holds the
  floor.** `.claude/skills/snap-critic/SKILL.md` carries the measured prompt verbatim; tool descriptions and pack notes
  point at it. `tests/snap/critic/fixtures.json` carries the floor (24/29 caught, 0 false alarms); `run_fixtures.py
  score` fails below it, and the fixture answers live beside it, never in what a critic reads. *Why:* the study's r2
  round lost a fifth of its catches to one wrong rule. *More:* tests/snap/critic/README.md.
- **SNAP-R110: A critique goes stale with its subject or its owners, and says why.** A critique is stale when its
  subject was re-made (re-run, re-take, upscale) or a note's owner record moved past the version the critique named;
  it shows "stale: <why>" on the row, the card and the viewer, and `list_critiques {stale: true}` lists them. *Why:* a
  note about a plate that has since been remade is noise. *More:* SNAP-R60.

## Batch G3 (2026-11-06)

Next free ID after this batch: SNAP-R139.

- **SNAP-R134: "Keep eye colour" is an optional step after a redraw, located by SAM, never the default.** A reference
  redrawn by stage 2 says, in a static line, to compare the eyes with the Cast picture; `keep_eye_colour` (and the
  take viewer's "Keep eye colour" press) re-tints the irises of the redrawn take toward the Cast front's iris colour: Snap's
  SAM 3.1 path finds the eyes on every frame and on the Cast picture (no hand seeding), the a/b of Lab moves inside the
  iris only, lightness never ("eye:2" ANDed with "pupil:2, iris of the eye:2"); only a pair of irises side by side counts, so a
  profile, a back or a lone eye-like thing (a gold hair bell) passes through untouched, and a Cast whose iris is grey
  skips the step rather than invent a colour. It makes a
  new take beside the redrawn one; nothing is replaced, and it runs only when asked. *Why:* the operator, 2026-11-06,
  decision 5 ("keep the redraw at d0.30, a static note, an optional iris re-tint, default off"); the redraw greyed
  Hiyori's brown eyes and Liesl's amber (u102b/IRIS_COLOUR, IRIS_SAM). *More:* SNAP-R85, SNAP-R113.
- **SNAP-R135: An agent's hold on a page ends with its job.** `use_page {page: null}` lets go; a snap_mcp.py connection
  that bound a page lets go when it closes; a hold whose agent made no call for 10 minutes lapses by itself and its agent
  hears so on its next call. The page's "Driven by" chip counts the idle minutes, `list_pages` gives `driver_idle_s`, and
  an unnamed call on a driven page is refused saying it carries no agent name. *Why:* the blind critic finished and left
  the agents' window "Driven by: critic-v10" until the coordinator released it (F-E24, F-E23). *More:* SNAP-R30, SNAP-R83.
- **SNAP-R136: A critique row holds while the picture it read holds, and the sheet shows every note at once.** Only a
  record's newest version gets rows; a row of an older version still holds while its part (master, plan, map, a plate's
  file and pose, a Cast's pictures) is unchanged, and the Location sheet shows it "read on vN"; an unwritten row whose
  part changed is `stale` (off the docket and the Work card) and says "vN → vM: its <part> changed"; a location or Cast
  saved before the critic started gets one row set for its newest version. The sheet's "Show masks" (and `open_view
  location {masks: true}`) draws every holding note on its picture at once as a numbered box, with no words over the
  picture, and lists the notes by number with their owner and fix; the picture viewer draws a location picture's masks.
  A packet carries what the sheet shows: stills as PNG (the label says the format), the plan with its marks drawn beside
  the bare plan, the camera map, each plate's camera mark and eye gap, and the record's notes flagged as claims to check.
  *Why:* the two blind village critics (F-E01..F-E22): 17 stale rows counted due, masks one row at a time with labels
  cut mid-word, a critic checking poses from numbers. *More:* SNAP-R101..R103, SNAP-R110.
- **SNAP-R137: A prompt cites a picture as plain `<Picture n>`.** No card, builder, tool, skill or doc writes a name or
  role inside the tag; who or what a picture is goes outside it ("<Picture 2> is Maren"). `set_setting` on a prompt
  answers `cites` when a tag holds anything but its number. *Why:* the operator, 2026-11-06 ("prompt placeholders are
  plain <Picture n>"); G2_OPTIONS UI-14 option C (the graph stays the truth). *More:* SNAP-R118.
- **SNAP-R138: A prompt the pack sends to an image model holds no words it would draw.** Capital headings, `[TAG]` lines
  and "visible text" blocks in a sheet prompt are drawn onto the sheet as garbled labels; the pack's prompts are prose,
  and a method that must not draw text says so in prose. *Why:* the Krea 2 DynamicCharacterSheet card drew labels on 4/4
  sheets with the author's headings and on 0/4 with prose, same layout and identity (F-E25, scout
  krea_pitch_sheet_2026-11-06). *More:* tests/snap/test_g3_cards.py.

## Batch G4 (2026-11-06)

Next free ID after this batch: SNAP-R146 (G5 took R146 on).

- **SNAP-R139: An agent's proposals live on the server, stack on each other, and keep their answers.** A proposal is a
  row in the person's `snap/proposals.json` (`/mainodes/snap/proposals`), not page memory: a reload, a second page or
  the agents' window restarting keeps it, and an answer (accepted with its result, rejected, failed, withdrawn) stays
  listed. A recipe proposal belongs to its graph; a Book's canon proposal (story, style, dial) belongs to the Book and
  shows on every graph, on the Book's "Waiting for you" rows, as a ghost beat on the Beat sheet, on the Work card and in
  `get_book.proposals`. A story edit is built on the story as the Book's waiting proposals would leave it: it may name
  a beat that is only proposed (`needs`), the Accept of it accepts what it needs first, and rejecting one withdraws what
  was built on it. A proposed beat keeps the id the answer gave. Only one page applies an Accept (the server holds it).
  *Why:* short05 F-F02 (the script supervisor's pass stalled at the first proposed beat), F-F10 (the Book's proposals
  showed nowhere the person looks), F-F19 (a reload of the agents' window lost the whole draft without a trace).
  *More:* SNAP-R67, SNAP-R65.
- **SNAP-R140: A record's own pictures are not its dependents, and a take made from a stale take follows it.**
  `dependents` and `rerun_dependents` leave out the record itself (each version's master take, the takes it was edited
  from, and the other candidates of the decision that made each) and candidates that were rejected or not picked, and
  name them in `left_out`; a take made from a stale take (an edit, a first frame, a reference) is listed in `follows`
  with its parent, even when it pins nothing of the record. *Why:* short05 F-F07: after the master fix, re-run
  dependents would have re-made the master's own first candidates from the plan (undoing the fix), re-run rejected
  candidates, and missed the eye-level still and the walkthrough that carried the old cart. *More:* SNAP-R105,
  SNAP-R106.
- **SNAP-R141: apply_unit cites every picture from References as they finally stand, and voices only the speakers.**
  The cites (board, camera plate, place, key drawing, each Cast by its pictures) are read after the last picture went
  in; the description carries the beats' action and the unit's blocking and camera; a Cast's voice reference stays only
  on a cut where that Cast has a line; the length is the next one the model takes, never a shorter one, and said when
  it differs. `compile_unit.board` is exactly what `make_board` sends, and a beat waiting in a proposal is named with
  the proposal's id. *Why:* short05 F-F09 (four cuts with <Picture 5> called the place when it was a Cast's back view,
  no action, a voice on cuts where its character is silent, 4 s became 3.75 s) and F-F03 (the sheet didn't show the
  board's prompt). *More:* SNAP-R68, SNAP-R137.
- **SNAP-R142: A cut has an opening board and may have a key drawing.** The board (`set_board`, role opening) is the
  frame the cut starts on, before the beat's peak; the key drawing (role key) is the peak, put in References as what
  the cut builds to. `make_board` takes `context` (another cut's board, a take or a file) instead of the previous
  cut's board, so a cut that shares a camera with an earlier one starts from it. Ref2V reads a board as a reference,
  not an exact first frame, and apply_unit says so. *Why:* short05 F-F16 (C3's board at the burst's peak made the video
  start at its peak; C4 couldn't take C2's camera). *More:* SNAP-R131.
- **SNAP-R143: A take's sound can become a Cast's voice in one call.** `use_take {as: "voice", cast, at, length,
  casting}` cuts that stretch of the take's sound into `input/snap/voice/` (48 kHz mono) and saves it as the Cast's
  voice reference, a new version whose note names the take and the stretch; a still or a take kept encrypted is refused
  with why. *Why:* short05 F-F06: the voice anchor ran in Snap but becoming a Cast voice took ffmpeg, an upload and a
  whole save_cast retyped. *More:* SNAP-R73, SNAP-R114.
- **SNAP-R144: An agent can cancel a run.** `cancel_run {run}` does what the Work card's Cancel and Stop do: a queued
  run leaves the queue, a running one is interrupted; an agent's run goes at once, a run the person started waits as
  a proposal. *Why:* short05 F-F13: two walkthroughs with mis-cited pictures had to run to the end. *More:* SNAP-R65.
- **SNAP-R84 (amended, G4): a location's new version keeps what it leaves out, and its pictures keep one order.**
  `save_location {location}` keeps every field the call leaves out (the plan's shapes while its file is the same) and
  says so in `kept`; null or an empty list clears one. `apply_location` puts the place's pictures in the same order
  every time (camera, master, plan, plates), however an earlier apply left them. *Why:* short05 F-F05 (a master change
  lost the plan's shapes and the camera marks) and F-F08 (a re-apply after `master: false` put the plan before the master).
- **SNAP-R133 (amended, G4): a drawn plan has a render picture, and a render cites it as layout only.** `draw_set_plan`
  saves beside the plan picture a render picture (`plan.render`): the shapes alone, no labels, cropped so the drawing
  fills it edge to edge. New view and `apply_location` put that picture in when they cite the plan, and New view adds a
  plain line that it is the set plan seen from above, the layout only, not a picture to draw. The plan picture with its
  labels stays the record's (the sheet, critics, coordinates). *Why:* short05 F-F04: the plan's blank paper became flat
  grey areas and its small labelled circles white discs on the street in both master candidates.
- **SNAP-R136 (amended, G4): a docket row says where it is, and a passed-over candidate leaves the docket.** A take's row
  is titled scene › shot › take n (seed) · the decision it came from (rows made before say so too); a candidate that
  was rejected or not picked reads stale; a cut pair is made only between two video takes or in a Book scene; a New
  view's packet carries the pictures it was made from as context; `critique_packet {part}` lists only that part's
  pictures (each keeps its packet #index). *Why:* short05 F-F11: 73 rows titled "Critic: take 1", unpicked candidates
  due forever, a "cut" pair between a front and a back sheet, a board packet with no Cast pictures.
- **SNAP-R145: Work made from another shot's take lands where it was asked to, and the source shot stays as it was.** A
  take's graph carries its shot's graph id, which is the group its runs land in; loading it into another shot (`rerun
  {land}`, `retake`) gives it that shot's id, a scratch tab (`land: "tab"`, `run_from_take`) a new one, so no take
  lands back in the source shot. `run_from_take` puts the take's own seed back (the saved workflow holds the seed after
  the run moved it on). `add_shot {from: {scene, shot}}` copies a shot's recipe into any scene now, and `start: "copy"`
  into another scene copies the open recipe now, each with a graph id of its own and none of the takes. *Why:* the
  preset-options run (F-F21, F-F22, F-F23): re-runs landed as versions in the Cut's own shots, a copy into another
  scene built the stock recipe, and "run from take" opened a tab owned by the Cut's shot with the seed one past.

## Batch G5 (2026-11-06)

Next free ID after this batch: SNAP-R155.

- **SNAP-R146: A long read is not an idle hold.** An agent's page hold does not lapse after 10 idle minutes while that
  agent holds a critique it claimed (`claim_critique`; each `critique_packet` renews the claim, which lapses by itself
  after 30 untouched minutes) or has a run of its own queued or running (the job stamp names the agent whose call
  queued it, `snap_job.agent`). `list_pages` says what keeps it (`driver_busy`); a hold that does lapse says, on the
  agent's next call, the `use_page` call that takes the page back when nobody else holds it. *Why:* the village v11
  critic read 10 packets for 16 minutes between calls, and its hold lapsed mid-job (F-G05). *More:* SNAP-R135,
  SNAP-R101.
- **SNAP-R147: A location's dependents include what used it before it was a location.** A take that pinned the Cast a
  place was kept as (cast_to_location's `from_cast`) used the location version made from it, and re-runs with that
  Cast swapped for the location (`rerun {swaps: {"cast:<id>": {to: "location:<id>"}}}`: the Cast's pictures and words
  go, the location's master, plan and the plates the Cast's pictures became go in); a take a master or plate came
  `from` that pins nothing used the version that first held the picture, is listed with `rerun: null`, and is named
  `by_hand` in the re-run plan (make it again in a shot that applies the location). *Why:* village v11: after master
  v5, `dependents` said nothing used an older version while every walkthrough and plate source had pinned the village
  Cast, and every plate was re-made by hand (F-G01). *More:* SNAP-R140, SNAP-R106.
- **SNAP-R148: One plate or camera mark changes alone.** `add_plate` on a plate that exists keeps every field the call
  leaves out, its picture too (null clears one), and says what it `kept`; `camera` may be a mark `{name, x, y,
  heading, eye_height, lens, note}`, added to the place or moved when it has one of that name, the other marks kept.
  *Why:* village v11: a pose or a note change meant list_locations, merge, save_location with every plate and mark,
  and a helper script to keep each plate's `from` (F-G03). *More:* SNAP-R84 (save_location keeps what it leaves out).
- **SNAP-R149: Pika at 6 steps is the quality standard.** The Pika turbo setups at 6 steps are the default and the
  quality bar for video takes; more steps is not a quality step up. The no-turbo presets ("First frame, no turbo (20
  steps)", "Reference pictures, no turbo (20 steps)") are opt-in, named for what they are, and no card, tool answer,
  skill or doc labels or suggests them as better; agents never reach for them to "improve" a take. Kept: voice
  references at 12 steps or more (SNAP-R88) and the audio pass in post. *Why:* the operator, 2026-11-06 ("Pika 6 steps
  is the de facto standard for quality"); the preset test's 20/30 steps drifted off the plate and the Cast.
- **SNAP-R150: Takes are judged with their sound on, and subtle sound is preferred.** A recommendation, a pick and an
  options page judge a video take with its sound (videos with sound, not frame sheets alone), and say what the audio
  does. Prompts ask for subtle, diegetic sound; stings, "tada" hits, clash bursts and game-style effects are a finding
  that sinks a take whatever its picture. *Why:* the operator, 2026-11-06, on short05 C3: option b was out for its
  "corny game tada sounds", and the coordinator had recommended it from frame sheets and loudness numbers.
- **SNAP-R151: Music is a reference input, never generated per take.** A production's music comes in as an audio
  reference (`<Audio n>`) the production supplies and holds across cuts; a take's own generation never makes the
  music, and agents don't ask a prompt for a score. Sound effects are added after picture lock (the audio pass in post).
  *Why:* the operator, 2026-11-06 ("music should be a reference input… sfx can be added in post").
- **SNAP-R152: Parallel agents take disjoint finding-ID ranges.** When two or more agents log findings at the same
  time, each is given its own range of IDs up front (F-H01..F-H49 for one, F-H50..F-H99 for the next, …), so rows never
  collide and need no renumbering. *Why:* the village studio and the voice agent both wrote F-G01/F-G02 the same
  evening; the second pair was renumbered F-G12/F-G13.
- **SNAP-R153: A costume is built the same in every view.** The critic's cross-view pass checks garment construction:
  every slit, split, vent, hem, opening, closure and layer is where every view that can see it says, and it looks
  *through* one view's gaps (between the legs, under an arm) at the far side another view shows; a disagreement is a
  medium flaw (r5). *Why:* the operator on X02, 2026-11-06: "the back has a split in her clothing vs no split in the
  look-through to the back between her legs"; no r3 or r4 run caught it. *More:* SNAP-R109 (measured on the fixtures).
- **SNAP-R154: A set plan's layout is tried without a version.** `draw_set_plan {preview: true}` draws the plan and
  answers the picture with every label that runs off it or over another label (shape, box, off_edge, overlaps), and
  saves nothing; a saved plan's answer lists them too. *Why:* village v11: labels at one size ran off a 1400 px plan and
  over the gatehouse, and each try was a location version (v15, then v16 to fix it; F-G04). *More:* SNAP-R133.
- **SNAP-R136 (amended, G5): a row answered on a later version leaves the docket, and every view reads the notes.** A due
  row whose part a later version's written row read unchanged is stale ("read on vN (crit-…): the same <part>"); the
  "every view" part covers the record's notes and camera marks, so a notes-only version gets its own views row. A plate
  or master packet adds a measuring copy (a 10 % grid with pixel positions, mapped like a tile), a still's context goes
  as PNG, and the plan with marks drawn names the file it was drawn over (`drawn_over`). *Why:* village v11: v3-v5 rows
  of unchanged plates stayed due at v16, a notes-only save asked nothing, and every height came from the critic's own
  crops (F-G06, F-G07).

## Batch G6 (2026-11-06)

Next free ID after this batch: SNAP-R160 (the G6 Book part took R165-R172; R160-R164 and R173 on are free; G7 took R70 and R173-R177, so the next free is R178).

- **SNAP-R155: A location keeps its scale, and the critic measures against it.** A location record holds `scale`, a
  list of anchors `{name, height_m, note}`: things its pictures show whose real height the person decides (a house door
  2.0 m, the gate door 3.7 m). save_location keeps it when left out; the Location sheet shows and edits it; a critique
  packet sends it with a `scale_rule`, and the critic measures camera (eye) and wall heights against the anchors and
  says "measured against the record's scale (house door 2.0 m)", or "no scale on record" and gives ratios. *Why:* the
  village v21 critic read the eye-level plates as ~2 m on an assumed 2.7 m gate door, then ~2.2-2.8 m on the houses'
  own doors: a height with no anchor is a guess at a door's size (critic round village_v11_r4). *More:* SNAP-R84,
  SNAP-R102.
- **SNAP-R156: A critic note is owned by the part it names.** The owner words map to that part of the record: a plate
  by its whole name or its label ("plate Pb"; several plates: the first is the part, `parts` lists all), the plan, the
  master, the record's notes, its camera marks and plate poses (`marks`). Words that name no part are kept with part
  null and said in the write's `owners_unmapped`, never read as the master. Fix at source opens that part: a picture
  gets a New view with the fix; notes and marks (typed words and numbers) open the Location sheet with the call that
  changes them. *Why:* village v21: every owner the critic wrote ("plate Pb", "plate Pa / plate Pab", "location record
  (plate poses and camera marks)") was stored as the master, so Fix at source opened the wrong record (F-K09).
  *More:* SNAP-R105.
- **SNAP-R157: A critic amends its own written critique as a new row.** `write_critique {critique, amend: true, ...}`
  by the row's author writes the whole critique again as a new row that `supersedes` the old one; the old row stays,
  marked `superseded_by`, and its notes leave the take's list. Nobody else amends it (they ask for it again), and an
  amended row isn't amended twice (amend the new one). *Why:* the village v21 critic found a scale error in its own Pb
  note after writing, and the correction could live only in another row and a report (F-K10). *More:* SNAP-R103.
- **SNAP-R158: The Work card says what waits for the person first.** Critique rows waiting for a critic fold into one
  row ("38 critiques due", whether a critic is on duty) with an explicit press that lists every one; the pill counts
  them apart from the jobs in flight; in a group, the agents' proposals come before other rows. A row's buttons are
  real buttons (a nested list of elements is flattened, never printed). *Why:* short05: the Work card opened on "In
  flight 104", mostly critique rows, with the 24 proposals far below, each showing "[object HTMLButtonElement]" where
  Accept and Reject should be (F-L01, F-M01). *More:* SNAP-R65.
- **SNAP-R159: A retried call never runs twice.** `POST /mainodes/snap/call` takes an `Idempotency-Key` header (or
  `idempotency_key` in the body): the bridge keeps the first call's answer per user, agent and key for a day (SNAP-R208;
  an hour in memory only before G15); the same key with the same tool and args answers that answer with `replayed: true`, waiting for the page's
  late answer when the first call timed out, and never sends the call to the page again; the same key with other args
  is refused (409); a read-only tool's answer isn't kept. snapcall.py and snap_mcp.py send a key with every call and
  retry a timeout (504) or a dropped connection with the same key; snapcall prints it, and `SNAP_IDEMPOTENCY_KEY`
  reuses it for a whole command run again. *Why:* a run whose answer timed out at the bridge was run again by a retry
  (Astrid interop map §6, the Runtime's mutation rule). *More:* SNAP-R30.
- **SNAP-R84 (amended, G6): every record save keeps what it leaves out.** save_cast, like save_location and add_plate,
  keeps every field a version leaves out and says so (`kept`; F-K02); a picture given by its file alone keeps the take
  and frame the record had for that file (F-K05), and remove_plate takes plates out with the others' provenance kept.
  diff_record lists a file hash stamped onto a picture that had none as `sha_recorded`, not as a change (F-K03).
- **SNAP-R104 (amended, G6): a walkthrough is read as a walk.** A video that pins a location and no Cast gets the
  `walk` checklist (the set holds frame to frame, the camera keeps its first frame's height, nobody appears), not a
  story cut's (F-K06). Every view of a location gets measuring copies, and a packet with no tiles says why (each
  subject picture is within the tile size, so its whole is already at 100 %; F-K11).

## Batch G6, Book part (2026-11-06)

SNAP-R165..R172 (the Book's share of G6; G6's other rules take SNAP-R155..R164).

- **SNAP-R165: A Cast line folds through the story's state.** A clause of a Cast's details line that the state speaks
  for (a hand, a thing worn or carried that the story moves) is left out of a cut's compile, its still prompt and
  apply_unit's prompt when the state at that cut disagrees with it, and the compile names it with the beat and change
  that override it (`cast_line.left_out`: "Cast line 'a steel ladle in her right hand' left out: b2 c1"); a clause the
  state agrees with stays, look words and all. The beat's text or the blocking that still puts a thing in a hand the
  state puts elsewhere is a lint line. *Why:* short05 story pass, F-L02: "Mio's right hand is empty" and "a steel
  ladle in her right hand" in one prompt, with an empty lint; the C2 board drew the ladle, and the first pass's C3
  put the monocle back on his eye. *More:* SNAP-R68.
  *Amended G16 (F-SQ02):* the line is cut into clauses on commas and semicolons outside brackets only, a carried value
  is matched to a clause by the item it names (its head: "the greatsword in its long scabbard on her back" is a
  greatsword), never by its place words (back, shoulder), and a hair clause never folds under carried.*. *Why:* seq01:
  Maren's braid went from 13 of 16 cuts and "tip by her left calf)" was cut out of its bracket. *More:*
  tests/snap/test_g16_braid.js.
- **SNAP-R166: apply_unit lands off the Cut.** `apply_unit {land: {scene, shot}}` compiles a cut into another shot (a
  test at a story moment): the cut's own shot and the Cut stay as they are, and the takes there pin the story, beat and
  unit they came from, with `landed`. A shot copied with `add_shot {from}` drops the source's story pin: a copy is not
  that cut. story_stale lists landed takes with where they are. *Why:* F-L10: the only story-pinned route rewrote the
  Cut's shot, and a hand-made copy claimed to be the Cut's C1 at story v1 while rendered from v27 words.
- **SNAP-R167: A holder is a person or a place; a mood is a look or a face.** "The bowl is in Kuroe's hand" only for a
  person; a place is said as written ("The bowl is on the counter …", "The monocle is hanging from its chain …"); a
  mood reads "looks calm" or, for a face word, "has a confident grin". *Why:* F-L07: "The bowl is in the counter …
  empty's hand." reached the board and video prompts.
- **SNAP-R168: A cut opens before its own beat.** When a cut's own beats move a field, the compile gives `opens`: the
  state before them (after the beat before, in story order) with its own still prompt and Cast line; the opening board
  draws it, the key drawing draws the end, and the video prompt says "At the start of the cut, …" and "By the end, …"
  for those fields. *Why:* F-L09: C3 (the sip) compiled only the after-state (monocle off) while its board and blocking
  opened before it.
- **SNAP-R169: Boards pin the story.** make_board's candidates carry the story pin a cut's take carries (`role:
  board` or `key`, the unit, the field hashes); story_stale lists a board made from a story that moved, and the
  reversal cost counts boards it would re-flag. *Why:* F-L04: the C1 board read current after two b1 mood changes
  that change its prompt.
- **SNAP-R170: A re-board keeps the cut's own board.** make_board on a cut with an approved board takes that board
  as its context by default ("keep its blocking: who stands or sits where"), named in the answer; `context` chooses
  another. The role sentence ("This frame is the moment the cut starts …") is part of the board prompt compile_unit
  shows. *Why:* F-L20: both new C1 boards moved Kuroe to another stool; F-L14: make_board sent a sentence the compile
  didn't show.
- **SNAP-R171: A sound-only version keeps its parent's pins.** A louder version of a take carries the parent's world
  and story pins: it is the same picture, so dependents, story_stale and the reversal cost see the Cut's take whichever
  version is active. *Why:* F-L05: the Cut's active C1 (a louder version) had no pins and read current whatever moved.
- **SNAP-R172: The reversal cost says what moves.** A story edit's cost names the cuts whose compile changes and by
  which fields, the takes and boards it newly flags, and the takes already stale that it flags again ("already stale,
  now also for Kuroe.mood"); "nothing" only when nothing moves. *Why:* F-L03: two b1 mood edits said "re-flags
  nothing" while they changed C1 and C2's compiles, because those takes were already stale.

## Batch G7 (2026-11-07): the Book's steps 7 and 10, the colour script, settei design it

SNAP-R70 (reserved for the Room since U97) and SNAP-R173..R177. R160-R164 stay free; the next free ID was SNAP-R178 (G8 took it on).

- **SNAP-R70: The Room is the person's front door, never a restriction, and its verdicts are the record's.** The Room
  (`web/snap/room.js`; `/?room`, The Room on the Work card, `open_view {view: "room"}`) renders the Work card's landed
  rows one question at a time, newest first: pictures full width, one verdict and a sentence ("neither, same
  problem" among them), a reply saying what the verdict moved, the next questions, and "earlier" with "actually, no".
  It is a second renderer of the same rows, never its own data: a verdict there is the take's (`by: person`), a pick
  is the candidate's apply, a yes is the proposal's Accept, a blind pair is judged on the server. Machinery is not
  rendered (not hidden): no ids, file names, model names, state words, counts or progress; every agent-written text
  passes `plain()`, and the leak test (`BANNED`) asserts none shows. It works at phone (390×844) and tablet (820×1180)
  widths with no sideways scroll. On the person's own install it is a localhost page; a phone door (pairing link,
  server-sent events) belongs to snap-gate. Agents write for it: no ids, paths, status words or counts in a question
  or a proposal's reason; grounded or silent. *Why:* CONCEPT_PRODUCTION §11.2 (box1's role-true Room and its jargon
  leak test); DECISIONS 2026-11-05 09:15 (the Room on main is a view; the phone door only behind snap-gate).
  *More:* tests/snap/test_g7_room.js.
- **SNAP-R173: A verdict is one key, and a turned-down option keeps why.** `p` keep, `x` reject, `n` neither on a
  focused take card, in the take viewer and on the Work card's landed rows, the same record the viewer's buttons
  write (`verdict`, `verdict_by`, `verdict_at`); "neither" (the same problem in every take so far) is a value. A
  reject, a declined candidate, a rejected proposal and a parked Work card row may carry `because` (a line) and
  `revive_if` (when it is worth another look): the option cemetery, read with the `cemetery` tool. A verdict replaced
  or taken back ("actually, no") stays on the take in `verdicts_past`, struck through, with a reason that names what
  failed, never the person: misfire (the interface), evidence, changed_mind, superseded. *Why:* CONCEPT_PRODUCTION
  §11.2 (one-key verdicts, the option cemetery, retractions; box1:42, 67, 71). *More:* tests/snap/test_g7_verdicts.js.
- **SNAP-R174: A blind pair's labels stay on the server until the person judges it.** `setup_ab` sends the two takes'
  files to `/mainodes/snap/blind`, which shuffles the sides and keeps which take is A in `user/snap_blind.json` (not
  served by /userdata). The page lists pairs by id and shows each side from `/blind/media?pair&side`; the Work card,
  Dailies and the Room name no take; `/blind/judge` writes the judgment first, then answers the labels. *Why:*
  CONCEPT_PRODUCTION §11.2 (server-side blind A/B, box1:70: nothing in devtools reveals them). *More:*
  tests/snap/test_g7_verdicts.js.
- **SNAP-R175: The colour script is one chosen frame per scene group.** A story group may hold `colour` {file or take,
  from}; the Beat sheet draws the strip over the spine, and a group with none offers its cuts' approved boards and
  active takes to choose from. Choosing is a story version (`set_colour_frame` from an agent waits as a proposal, like
  every story edit). Scene groups come in with `add_group` / `set_group` (F-L16) or "+ Scene group". The compile does
  not yet cite the colour frame (open question for the operator). *Why:* CONCEPT_PRODUCTION §4.1.4b and §11.5 step 11
  (the colour script strip). *More:* tests/snap/test_g7_book.js.
- **SNAP-R176: A state's settei is designed from the Cast's own pictures, and approval writes the Cast.**
  `design_state` (and Design it on a state in the Settei lens) makes candidates by a New view from the Cast's pictures
  with the production style paragraph first, the Cast line as the state tells it, the state's sentences and words and
  the view; they land in the scene "Settei · <Book>" pinned `{role: settei, cast, state, view}`. Use this (or
  `save_cast_state` with the take) saves the picture as the state's view in a new Cast version naming the take, by the
  person when pressed in the lens. GPU follows the Book's dial at the settei stage. *Why:* CONCEPT_PRODUCTION §4.1.4b
  ("design it" cells) and §11.5 step 6. *More:* tests/snap/test_g7_book.js.
- **SNAP-R177: dry_run answers what a write would do and writes nothing.** The story edits (`add_beat`, `edit_beat`,
  `move_beat`, `add_change`, `remove_change`, `save_story`, `import_fountain`, `keep_as_canon`, `add_group`,
  `set_group`, `set_colour_frame`), `save_style` and `save_cast_state` take `dry_run: true`: the answer gives the
  would-be diff (a story edit also its reversal cost and `needs`) and nothing is written: no proposal, no version, the
  world rev unchanged. *Why:* Astrid interop map, write safety step (commit after a dry run). *More:*
  tests/snap/test_g7_misc.js.
- **SNAP-R172 (amended, G7): a stacked proposal's cost is its own.** On top of waiting proposals, `reversal_cost` is
  the edit's own delta over the story they would leave, with the whole stack's cost apart in `with_waiting` (F-L06).
- **SNAP-R67 (amended, G7): a story version says who accepted it.** A version made by an accepted proposal carries
  `accepted_by` {by, where (a person's tab or the agents' window), page, driven_by} and says it in its note (F-L17).
  Proposal titles and version notes keep beat text, lines and fields whole, with people by name (F-L12, SNAP-R58).
- **SNAP-R68 (amended, G7): props follow the people.** A prop's holder and the people whose `carried.*` names it agree,
  or the compile (for the cut's props and Cast) and the Beat sheet's flags say where they don't; `state_at` of a prop
  gives `carried_by` and `disagree` (F-L11). The Beat sheet reads a change by its op (`→` set, `+` add, `−` remove), has
  a lane per prop, a beat's lines on its card, a payoff by its plant's words, and waiting changes as ghosts under their
  beat (F-L08, F-L15).

## Batch G8 (2026-11-07)

SNAP-R178 on. R160-R164 stay free.

- **SNAP-R178: A wardrobe state folds the items it names out of the Cast line.** Beside SNAP-R165's hands and worn
  things: a clause of a Cast's details line that is an item a wardrobe change of that person names (its head word:
  "green apron" is an apron) is left out of a cut's compile, its still and board prompts, apply_unit's prompt and
  design_state's prompt when the wardrobe at that moment doesn't say that item the same way ("no apron", "a blue apron"),
  named in `left_out` with the beat and change (a settei state's as `settei <state>`). A clause the wardrobe says the
  same way stays, look words and all ("oilskin coat" under "the oilskin"); every other clause stays. What stays but
  disagrees is lint, never a silent drop: a clause that mentions the item ("white blouse with long sleeves" under
  "sleeves rolled up"), a garment of the same kind worded otherwise ("green coat" under "the oilskin"), and a beat's text
  or the blocking that still uses an item the wardrobe takes off ("wipes her hands on her apron"; the words that take it
  off are not a clash). Only the named items fold until the operator rules on dropping every clothing clause. *Why:*
  F-N01: Aya's "apron off" settei prompt said "green apron" and "Aya wears no apron" in one breath. *More:*
  tests/snap/test_g8_wardrobe.js.
- **SNAP-R179: A Room question is one plain sentence that names its thing.** At the top and on every "Then" line the
  Room asks the same sentence (`ask()` in room.js): the agent's own question when its words hold one ("Which lantern?"
  out of "Which lantern? a MOSS edit of take-… for cast:…"), else one made from what the row is: a take "Do you keep the
  lantern, second try?" (by number when Snap titled the run), a proposal "Shall I …?" without its "pN:" label or its
  stacking note, a Book story change as the state in words ("From b1 on, Aya holds the ladle in the right hand: shall I
  add that to the story?"), a new beat quoted, a pick named by its kind and place ("Which new view do you keep for Gate,
  Shot 1 · C1?"), a blind pair "Which is better, A or B?". The agent's other words go on a quiet line under the top
  question, never into it. `plain()` drops a reference it can't name with the word that led to it ("an edit of it for
  it" becomes "an edit"), an aside it empties ("(it, the picture)") goes, and the line under a question names a place
  or nothing (never "a scratch tab"). *Why:* the G7 Room read "Which lantern? an edit of it for it", "Does the take hold
  the gate? (it, the picture)" and "So: an earlier suggestion: …"; the person should read each at a glance. *More:*
  tests/snap/test_g8_room.js.
- **SNAP-R177 (amended, G8): the location and clean-up writes dry-run too.** `add_plate`, `draw_set_plan` and
  `delete_record` take `dry_run: true`. add_plate runs every check the real call runs (a missing picture, a camera mark
  that isn't there) and answers the version it would make with its diff by plate and camera mark name and what each
  plate keeps; a take's frame is named, never pulled into input/. draw_set_plan answers its preview (picture, labels)
  plus the would-be version and the plan's diff, with no picture saved. delete_record answers what it would delete and
  keep and which takes pinned it. A dry run never waits as a proposal, even on a tool that waits for the person: it
  writes nothing, so there is nothing to accept. *Why:* G7 left these three without one (Astrid interop map, write
  safety). *More:* tests/snap/test_g8_dryrun.js.
- **SNAP-R148 (amended, G8): a plate's pose merges by field.** `add_plate {location, name, pose: {eye_height: 1.7}}` on
  a plate that exists changes that number alone and keeps x, y, heading and lens; a field given null clears it, and
  `pose: null` clears the pose, as camera marks given as objects already merged. *Why:* F-P01: the G8 dry run showed a
  pose-only call wiping the plate's x, y, heading and lens.

## Batch G9 (2026-11-07)

SNAP-R180 on. R160-R164 stay free.

- **SNAP-R180: A critic's finding is said where it was born, and asked as itself.** In the Room a critic's row asks its
  worst note's first sentence ("Kuroe's eyewear is spectacles, not the Cast's monocle: keep it anyway?"; a clean row
  "The critic found nothing wrong here: keep it?"), lists every note under the picture with how much it matters
  (Serious, Worth fixing, Small), where it was born in words ("It comes from C2's approved board.") and its fix, and
  boxes each note drawn on the picture; pixel asides stay out (the box says where). An owner names its target: "camera
  marks" the plate the note is about (named in the owner's words, else in the note's text, else the plate the row
  reads) and that plate's mark; "board" the board the take was drawn from (the New view's context picture labelled a
  board) or opens on (its cut's board, the key drawing when the note says key or peak), as a take when one made it;
  Fix at source opens that board and names that mark. *Why:* F-Q20: the Room showed a critic's row as "(medium)" with
  no words (the "(medium)" was the shot's own name); F-Q24: "camera marks" and "board" pointed at nothing.
  *More:* tests/snap/test_g9_room.js.
- **SNAP-R181: A cut whose own beat changes what a hand holds is boarded at its key.** When a cut's own beats change a
  hand's thing from a stated one or empty it (or move a prop's holder), the compile gives `opens.held` and
  `board_role: "key"` with a lint line; its default board (compile_unit's `board`, make_board) is the key: the state
  after the beat with the beat's action, said in `role_why`; set_board sets a key candidate as the key. `role:
  "opening"` stays when asked. A hand that takes something up from nothing keeps the opening (the start agrees with the
  action). *Why:* F-Q09: C2's opening board drew the ladle still in Mio's hand under "sets the full bowl down … with
  both hands"; the key (s9221) drew it right. *More:* tests/snap/test_g9_book.js.
- **SNAP-R182: A settei is the whole figure alone on a plain ground, without what its state takes off.** design_state's
  subject opens with the framing (the view, the full body from head to feet, standing alone on a plain light grey
  background), the style paragraph's background sentence is left out (`style_left_out`), the state's words are a
  sentence, and each thing the state takes off is said to be absent though the Cast's picture shows it. `from` (a
  picture already in the state) goes first; without it, `if_kept` says how to make one. *Why:* F-Q13: both "monocle off"
  candidates kept the monocle and drew a bust on a night street; F-Q14: the state's words went in raw.
  *More:* tests/snap/test_g9_book.js.
- **SNAP-R183: An export carries what its records need to open.** A Book's export follows its parts, every version's
  story and look, into the zip (`manifest.carried`); its Cast and places are offered (`offered`), never carried
  unasked (they are the person's to share); a part this install lacks is `absent`; `to_another_install` says how the
  zip gets there (output/snap_exports/, or /upload/image to input/snap_imports then import_records). A Book or its lens
  naming a record this install lacks says the name a take pinned it with and how to bring it. *Why:* F-Q12: a Book
  exported alone came back as "story … isn't here"; F-Q15: the Settei lens showed a raw id. *More:*
  tests/snap/test_g9_book.js.
- **SNAP-R184: A board's packet carries who should be in it, its pictures by number, and a measuring copy.**
  `who_should_be_here` reads the cut's Cast (the story pin's unit, or the shot it landed in) as well as its pins; every
  picture a New view was made from is labelled by its Picture number, the one already in the packet too ("made from:
  Picture 1 C2's camera (= … plate P2 counter)"); boards get the measuring copy, now a 5 % grid with pixel positions and
  a 1 % ruler on the edges (plates, masters and every-view rows too). *Why:* F-Q26: board packets had an empty
  who_should_be_here, no picture named as the camera the prompt cites, and a 10 % grid too coarse to read a sill.
  *More:* tests/snap/test_g9_book.js.
- **SNAP-R67 (amended, G9): a press on the agents' window an agent drives is the agent's.** `answered_by.by` is `agent`
  (with `driven_by`) when the managed window has a driver: nothing says a person pressed (F-Q03).
- **SNAP-R172 (amended, G9): a stacked proposal reads as it stands.** The Work card, the Room and the Book's rows drop a
  proposal's "with pN waiting: …" clause once one of those is answered; the stored reason stays whole (F-Q04). A
  remove_change says what it takes back (F-Q02).
- **SNAP-R154 (amended, G9): a plan's labels are checked against lines too, and a redraw keeps the plan's size.** A label
  under another shape's line or outline (its thickness counted) is listed `under_lines`; with no size or aspect,
  draw_set_plan takes the current plan picture's (`size_from`) (F-Q07, F-Q08).
- **SNAP-R179 (amended, G9): the candidate tools carry the agent's question.** make_board, edit_from_context and
  design_state take `question`: it heads the Work card row and is the Room's question (F-Q21). The checks Snap queues
  for an agent's candidates are the agent's (F-Q11), and a board keeps its purpose when a method is named (F-Q10).

## Batch G10 (2026-11-07)

SNAP-R185 on. R160-R164 stay free.

- **SNAP-R185: A still in a cut's shot is a board, never the cut's take.** A New view or board candidate that lands in a
  Book cut's shot is a board candidate: apply_candidate from an agent refuses it before it can wait as a proposal and
  names the call (`set_board {scene, shot, take}`, role key for a key candidate), and the person's Apply (the candidate
  sheet, the Room's "This one") puts it in the cut's board slot (the key drawing for a key candidate), not approved,
  saying the cut's active take stays; Undo puts the old board back. The answer after an edit or a sheet that lands in a
  cut's shot says set_board in `next` and why in `in_a_cut`. *Why:* F-S07: the hint after a board edit said
  apply_candidate, which would have made the still the active take of a cut whose active take is its video.
  *More:* tests/snap/test_g10.js.
- **SNAP-R186: A record's picture's new view lands with the record.** With no `land`, a New view whose Picture 1 is a
  location's picture (or a Cast's picture under purpose edit) lands in the shot of the take that picture came from,
  else in the newest shot outside a Book's cuts with a take that pins the place, and says so in `lands`; when no shot
  holds the record's work an agent is refused, naming land, and a person's view lands in the open shot as before.
  *Why:* F-S02: a village plate edit landed in the open short05 shot, and its critic row and Room question then named
  a short05 shot for a village plate. *More:* tests/snap/test_g10.js.
- **SNAP-R187: open_view says what the page shows.** The Room lives in Snap's root, so `open_view {view: "room"}` on a
  page showing the graph switches to Snap first (as the Book and the sheets do), `read_ui` reports `room`, and the
  answer says the Room is open only when the page shows it. *Why:* F-S03: it said "the Room is open" while the page
  showed the graph. *More:* tests/snap/test_g10.js.
- **SNAP-R188: A critic owner names a plate by its whole name first.** Whole plate names that appear in the owner's
  words are matched first (the longest where two overlap); a label (a name's first word) counts only where one plate
  has it and no whole name covers it; a label several plates share alone is ambiguous: the owner is unmapped, saying
  which plates it starts. *Why:* F-S12: "plate Pc square from gate eye" was stored as "plate Pc square N row" because
  both start with "Pc". *More:* SNAP-R156, tests/snap/test_g10.js.
- **SNAP-R189: A board says absent what its pictures may still show.** When the frame a board draws (the key, or a cut
  with no own-beat change) has a thing out of a hand that the cut's own beat puts down, or a Cast line clause the state
  leaves out, the board prompt says "<who> is without <thing> in this frame, even where <Picture n> shows it", citing
  the context boards and (for a Cast line clause) that person's Cast pictures; the board's `lint` says so; the board's
  story pin keeps the list as `absent`, and its critic packet lists it under `should_be_absent` for the beat pass. A
  context `{take}` takes `keep` like a file does. *Why:* F-S05: compile_unit dropped the ladle, but both key boards drew
  it again from the context board that showed it: pictures beat words. *More:* tests/snap/test_g10.js; the GPU
  measure is in the study's LESSONS "Batch G10".
- **SNAP-R190: A region edit pastes back.** `edit_from_context {paste_back: true}` with a crop on Picture 1 (ph3_view
  only, no size): P-H3 edits the crop at about 1 MP, the result is scaled back to the crop's pixels and pasted over the
  whole Picture 1 with a feathered edge (6 % of the crop's short side, none on a side the crop shares with the
  picture's border), all with core nodes. The candidate is the whole picture; everything outside the crop is the
  picture as it was, so a face edit can't turn the body. *Why:* F-S04: a whole-board monocle edit turned a face that
  looked away from camera (2/2). *More:* tests/snap/test_g10.js.
- **SNAP-R180 (amended, G10): a context board is the board of the cut that holds it.** A critic's "board" owner on a
  take drawn from another cut's board names that cut, its take and "<cut>'s board" (make_board's "the previous cut's
  board" was read as the take's own cut); a picture no cut holds now keeps its own label. The G9 screenshot's
  "It comes from C1's approved board" on a C2 take was right: that test's one-cut Book numbered its only cut C1 while
  its shot was named "C2 the bowl lands".
- **SNAP-R179 (amended, G10): a question asked in the same words as one above waits behind it.** The Room's Then list
  shows each sentence once; the next row with the same words comes up when that one is answered (F-S11: 35 identical
  "Which new view do you keep for …?" rows).

## Batch G11 (2026-11-07)

SNAP-R191 on. R160-R164 stay free.

- **SNAP-R191: A region edit's seam is checked.** The paste-back graph (SNAP-R190) ends in the pack's seam check
  (MAISnapSeam): just inside each edge of the crop, past the feather, the edit is compared with the picture it is pasted
  over; a run along an edge where they differ far more than that edge does elsewhere (above 40 of 255 and three times
  the edge's median, or above 100: an edge redrawn all along) is a break: something drawn inside that doesn't meet the
  picture outside. A side on the picture's border is not read. Each candidate gets a seam note (`breaks` with side,
  pixel run and peak; `crop_to_try`, the crop reaching past each side that breaks (half again; 1.5 crops since G12); a sentence) and a chip on
  its tile ("seam breaks · bottom" or "seam ok"). It informs and never blocks (SNAP-R23). *Why:* F-T02: the monocle's
  chain crossed the eye crop's bottom edge, was redrawn inside and kept outside, and broke at the seam; a wider feather
  would only cross-fade two offset chains, and a named-feature extension needs the agent to foresee the feature. The
  check finds what nobody named and says where. *More:* tests/snap/test_g11.js; the GPU measure is in the study's
  LESSONS "Batch G11".
- **SNAP-R192: A packet shows a cropped picture as the model got it.** A context picture a New view or edit was made
  from with a crop goes into its critique packet as that crop (the pixels ComfyUI's crop cut, its px box in the label
  and `crop {box, of}`), then the whole picture it was cut from, labelled as context only (the model saw only the crop).
  Picture 1 of a region edit says it was edited and pasted back. *Why:* F-U03: the packet showed the whole 896x1152 Cast
  picture labelled "cropped", and the critic rebuilt the crop by hand from get_take.
- **SNAP-R193: Zooms are 100 % tiles over the small things.** After the context, a packet adds zoom tiles (role tile,
  `zoom: true`, mapped like tiles so a note drawn on one lands on the subject), each padded by a quarter of its size and at
  least 160 px a side, with a 2x copy when it is at most 512 px: over a region edit's pasted crop; over where an edit
  changed its Picture 1 (8 px cells whose colour moved more than 28, joined; none when more than half the picture
  changed, a new view rather than an edit); and any the critic asks for with `critique_packet {zoom: [{region, picture}
  | {find, picture}]}` (a note's region, or a thing in words that SAM 3.1 boxes, smallest first, none over a quarter of the picture, up to 4). Asked zooms stay on the row,
  so a later call keeps every picture's number; `part: "zoom"` pages only the zooms. *Why:* F-U05: the "100 % tiles" of
  a 2048x1152 still were two 1536 px halves, too big to read a 60 px monocle; the critic cropped faces by hand.
- **SNAP-R194: An edit's or New view's packet carries its cut's Cast.** Who a take's packet expects is the Cast it pins,
  its cut's Cast (the story pin's unit, or the shot it landed in), a board's story pin, and the Cast the take it was
  made from pins (Picture 1's), each once at a version: one the take doesn't pin joins `pins` with `not_pinned` saying
  where it came from, `who_should_be_here` names them all, and the edit checklist now reads the Cast pictures too
  (snap_cards/critic.json `edit.context`: source, cast). *Why:* F-U04: an edit candidate in C2's shot had Kuroe only
  through its reference crop and Mio not at all; G9 had fixed this for key boards only (SNAP-R184).
- **SNAP-R195: A compact critique row names its take and how it was made, never the job's prompt.** `list_critiques
  {compact: true}` rows carry `take` (the id's start that every take tool takes), `decision`, the agent's `question`
  when it asked one, and a title of the place, the take, its seed and the job's method ("… › take 10 (seed 9401) · New
  view · P-H3-Image ×2"); `list_critiques {decision}` lists one decision's rows (an id or a unique start). The row's whole
  title, prompt and all, stays on `list_critiques {critique}` and `{take}`, never cut (SNAP-R58). *Why:* F-U06: compact
  rows had no take id and each title carried the ~600-character edit prompt; with 125 rows due the critic found its rows
  by "seed 9401".
- **SNAP-R196: One detail of a Cast picture is fixed as a new Cast version.** `use_take {take, as: "cast", cast,
  replace: n}` puts the take's picture in place of the Cast's picture n (its role kept unless one is given) as a new
  version; the version before keeps the old picture, and what pinned it still reads it until rerun_dependents re-makes
  it. The route for a detail: a region edit of the Cast picture (`edit_from_context {pictures: [{cast, ref, crop}],
  purpose: "edit", paste_back: true}`), then `use_take … replace`; from an agent with `propose: true`, since the Cast is
  the person's. For a person: the New view tray offers "edit only the marked region, then paste it back" when Picture 1
  is a marked region on P-H3-Image, and a take's Send to lists "Cast: <name>, in place of picture n (<role>)" for each
  Cast it pins. *Why:* F-U01: Kuroe's Cast front picture draws a bar across the nose that every edit copied; use_take
  could only add a picture, so fixing one meant restating every picture in save_cast.

## Batch G12 (2026-11-07): what a picture is, and what is near it (U106)

SNAP-R197 on. R160-R164 stay free.

- **SNAP-R197: Every picture says what it is, from its records.** `nearby.js` `what()` gives one line and a second:
  a still ("A still, not a frame of a video") or a frame of a video (which take, which second and frame) or a video
  take; a still's kind (the key drawing of a cut, the picture its video builds to; the board, the frame its video opens
  on; a board or key candidate; a settei of a Cast in a state; a New view; a region edit; a character sheet; a bigger,
  changed, re-run or continued version of take n); the cut (or scene › shot) it belongs to; where it stands (the cut's
  active take, its approved board, picked, turned down or not picked yet, kept or set aside, and every Cast picture, plate,
  master, board or key drawing kept from it, with the frame and the record's version); then "Made by <model> from
  Picture 1 …, Audio 1 …", the model being the method's (P-H3-Image, Stage 2 …) or, for a run, the diffusion model and
  LoRAs its prompt loaded, and the pictures as the model got them (a New view's context labels, a render's References,
  its opening picture, its sounds). Only stored metadata: a take's story pin, parent, context and prompt, the cut slots
  and the records' pictures with their `from`. It shows in the Room (under the picture, and above a pick's candidates
  once for what they share; no model named and every word through `plain()`, so the leak test holds), the take viewer,
  the full-size viewer (under its bar), candidate tiles and the Work card's rows with a take. Never on a blind pair
  (SNAP-R174). *Why:* the operator, 2026-11-07, on the Room's first question: "is that image a frame from a video or is
  it a seed image for making a video? Things like this should be generally clearer through metadata". *More:*
  DECISIONS 2026-11-07 07:59, PLAN U106, tests/snap/test_g12.js.
- **SNAP-R198: Nearby is one press from any picture, and it only reads.** The "Nearby" press beside every what-line
  (and `m` in the take viewer and the full-size viewer) opens a modal over the page: the picture full size with its two
  lines, then its neighbours as tiles, each with its own line: the cut's board and key drawing and its video takes
  (playable, sound on, the active one and the approved board marked), the other candidates of the same pick, the other
  takes of its shot, what it was made from and what was made from it (takes, frames, record pictures and boards kept
  from it), the Cast and location versions it cites with their pictures ("the newest is n" when one moved on), the story
  beat it is pinned to and whether that pin is stale (with why), and its critiques (each note's severity in words, the
  note and its fix). A tile's name (or its picture) re-centres the modal on that tile; Back (or Backspace) walks back;
  Esc closes only the modal. It writes nothing: no take is marked opened, nothing is applied or judged, and no key
  reaches what is under it (the take viewer's p / x / n). From the Room it speaks the Room's words. A phone (390 px)
  stacks the picture over two tiles a row with no sideways scroll. *Why:* the operator, 2026-11-07: "there should be a
  way to get a modal to pop up to look at nearby things or other takes and related things nearby in the data model".
  *More:* SNAP-R5, R80; tests/snap/test_g12.js (records hashed before and after).
- **SNAP-R199: `nearby {ref}` answers the same neighbourhood as data, whole.** ref: a take (id or a unique start, with
  or without "take-"), a record (kind:id, @n for a version) or a picture's path (input/…, output/…, or a /view address).
  The answer: `what` {line, more, form}, `subject`, `cut` {boards, takes}, `candidates`, `shot`, `made_from`,
  `made_into`, `records`, `beat`, `critiques` and `counts`; every neighbour is a tile {ref, kind, path, name, marks,
  what}, so an agent walks the model by passing a tile's ref back. Never trimmed; `part` with `offset` / `limit` pages
  one list with its `total` and the `next` page (SNAP-R58). `open_view {view: "nearby"}` opens the modal on the person's
  page. *Why:* agents get the same view as the person (DECISIONS 2026-11-07 07:59). *More:* tests/snap/test_g12.js.
- **SNAP-R200: When seeds keep failing, change the approach, not the seed.** Two or three failed seeds of one recipe
  stop that recipe: no more seeds and no question to the person yet. Step up the chain in order: the wording, the
  references or the crop, the method or tool, the source record that carries the flaw (remake the Cast picture from its
  design), and a missing Snap capability (a finding, then a build). Try a few genuinely different approaches, measured
  side by side, before giving up; only a taste choice between results that work goes to the person. *Why:* the
  operator, 2026-11-07, on Kuroe's nose bar: "if you fail with reroll seeds it's a sign the approach is wrong, and the
  agent should take a few approaches before giving up". *More:* DECISIONS 2026-11-07 08:26; skills snap-core and
  snap-boards; AGENT_START "Working habits".
- **SNAP-R191 (amended, G12): crop_to_try reaches one and a half crops.** Past each side that breaks, the next crop
  reaches 1.5 times the crop's size (it was half): on C2 key s9221 half again broke 2/2 (the redraw hung a longer chain
  below the new edge), and the eye crop (0.13 of the height) held 2/2 only when taken down to the lapel (0.33), 1.5 crops
  further. Read the seam note after every retry; set the crop where the thing ends when you can see it.

- **SNAP-R201: A proposal that changes a record's pictures shows them now and after, and waits in order.** A waiting
  `save_cast` (new `refs`), `use_take {as: "cast"}` (with `replace` or a new picture), `save_location` (master, plan,
  map or plates) or `add_plate` / `use_take {as: "plate"}` carries, for each picture it changes, the record's picture
  now and the one it would put there (`nearby.js` `changeOf`); the Room shows them side by side ("Picture 1 (identity:
  front) now" / "… after"), each with its what-line and Nearby, and the record's line with Nearby above them (its
  versions and what pins it). A proposal row sorts by when it was asked (the server's `created`), not below every other
  row. *Why:* dogfood F-Y11: Kuroe's Cast fix (save_cast v5 with a new front) sorted last in the docket and showed no
  picture, so the person couldn't see what they were saying yes to. *More:* tests/snap/test_g12.js.

- **SNAP-R202: A still's stage 2 redraws the whole still, whatever made it.** `upscale_take {method: "stage2"}` on a
  still runs the still's own graph at the asked size from the still itself (Lanczos, VAE-encoded) at `denoise`. A region
  edit (paste_back, SNAP-R190) is redrawn as an edit of its whole picture: Picture 1 is the edited still, not the crop,
  and the decode is saved as it is, with no crop, paste back, mask or seam check (`edits.js` `unpaste`). An H3 still's
  latent carries sound, so the encoded still is its video half (the method's `run.av_latents` name the nodes that make
  such a latent); any other model's still (MOSS, Krea) starts from the encoded still alone, a KSampler at `denoise`.
  *Why:* dogfood F-Y04: stage 2 of Kuroe's region-edit fixes re-ran the crop and the paste with the whole picture as the
  crop and came back at 1x with a small whole-body copy in the head box (2/2); F-Y05: stage 2 of the MOSS still his Cast
  front came from crashed in LTXVSeparateAVLatent. *More:* tests/snap/test_g13.js.

- **SNAP-R203: Keep eye colour runs on any still or video take, and says what it ran on.** `keep_eye_colour` (SNAP-R134)
  is no longer only for a stage 2 child: any take with a picture or video, toward the Cast the take pins or the one given
  (`cast`, for a still made from other takes, which pins none). The answer's `ran_on` (and its `said`) is the take's
  what-line (SNAP-R197), so the person sees whether it re-tinted a redraw, a region edit or a video. The node still skips
  a Cast whose iris is grey. *Why:* dogfood F-Y07: the only 2x redraw that worked for Kuroe's front (a P-H3 redraw, then
  the region edit) darkened his irises, and the step refused it for not being a stage 2. *More:* tests/snap/test_g13.js,
  test_g3_eyes.js.

- **SNAP-R204: A region edit can keep its change only where SAM finds a named thing.** `edit_from_context {paste_back:
  true, mask: "<words>"}` runs SAM 3.1 on Picture 1's crop with the words (`:n` keeps the best n), grows the mask by the
  feather and softens it, and multiplies it into the paste's feathered mask, so only that thing changes; the rest of the
  crop is the picture as it was, eyes and line work included. SAM finding nothing leaves the picture unchanged. Core
  nodes only (SAM3_Detect, GrowMask, ImageBlur, MaskComposite); refused without paste_back. *Why:* dogfood F-Y09: a
  removal that words can't make had no route on a still; on :8194 the masked removal of Kuroe's nose bar ("the thin gold
  bar across the bridge of the nose:1") took it off 2/2 on his original front, changing a 55x46 px patch, where words
  over the same crop had failed 0/4 (F-V05). *More:* tests/snap/test_g13.js.

- **SNAP-R205: A region edit's seam check also says when the box shows.** MAISnapSeam reads the box as pasted (a crop of
  the composite, so a masked edit is judged by what shows) and, beside the breaks, takes the edit's luma minus the
  picture's just inside each edge past the feather: outside the box the picture is the picture, so that is the step
  across the edge. Its median along the edge (a window of a quarter of it, so moved line work drops out) at 10 grey
  levels or more over at least a quarter of the edge is a box that shows: the seam note's `box_shows` lists each run
  {side, from, to, delta} (delta + lighter, - darker), `checked` carries every edge's mean step, the note says "the box
  shows" with the edges and levels, and the chip says "box shows · <sides>". A note, never a gate. *Why:* dogfood F-Z03:
  s9962's box came out ~22 levels lighter than the background around it, a rectangle at 100 %, and the note said "no
  break" (runs against each edge's own median can't see a whole-edge step). On 22 real region edits s9962 held +21
  over 95 % of its left and right edges; every clean edit stayed under 10 (one 37 px edge reached 12 over 22 %).
  *More:* tests/snap/test_g14_nodes.py (real crops), test_g14.js.

- **SNAP-R206: Stage 2 of a region edit keeps the edit's change.** After the whole redraw (SNAP-R202), MAISnapKeepEdit
  compares the edited still with the picture it was made over (Picture 1's own loader, kept in the graph; its crop
  goes): where they differ (max channel over 7x7 px above 24, grown by the edit's feather, softened), the edit, Lanczos
  to the redraw's size, goes back over the redraw; everywhere else the redraw stays. A masked edit (SNAP-R204) changed
  only its mask, so only that comes back. `upscale_take`'s answer and plan say it (`keeps`). *Why:* dogfood F-Z01: a
  whole redraw draws the model's prior again, and Kuroe's fix B got its nose bar back at d0.30 and d0.20. Measured on
  :8194 (both B seeds, both denoise values): where the bar was, the plain redraw was 25-32 grey levels from the edit,
  the kept one 0.8-3.7; the rest of the head kept the redraw (the change was 15 % of the box on s9912). Pasting the
  whole box back also kept the bar off but put the 1x head back; editing the redraw again kept the bar 2/2 (its
  Picture 1 shows it). *More:* tests/snap/test_g14.js, test_g14_nodes.py; study proto/ui/g14.

- **SNAP-R207: Keep eye colour says what it did.** MAISnapEyeColour's report (the target, every frame touched or why
  not, the mean shift, or why it skipped) is also its UI output; Snap writes it on the new take (`eye_colour` {said,
  report}, in get_take and as a line in the take viewer), and `keep_eye_colour` waits up to 25 s for the step so its
  answer says it: "skipped, so the new take is the picture as it was: <why>" (a grey Cast iris also says the step moves
  hue only, never lightness), "changed nothing … no iris on the still (<why>)", or "re-tinted the irises on n of m
  frames …"; past 25 s it says where to read it. A repeat ComfyUI serves whole from its cache keeps no UI output, so its take
  carries the report of the take it repeats (`cached_from`). No lightness matching (decision 5: hue only; the operator hasn't ruled
  on more). *Why:* dogfood F-Z02: on Kuroe's grey Cast iris the new take was byte-identical and nothing said why (the
  report was an unconnected STRING output). *More:* tests/snap/test_g14.js, test_iris.py.

## Batch G15 (2026-11-07): Astrid interop, phase B (files, MCP, write safety)

Study: the Astrid interop study (INTEROP_MAP §6, CONTRACT_SNAP_EXPORT, INTEROP_LOG).

- **SNAP-R208: A retried call's answer is kept a day, survives a restart, and says when it is still running.** The
  bridge owns the Idempotency-Key store (SNAP-R159): memory plus the user's `snap/idempotency.json` (written when the
  page answers, rows older than 24 h dropped; nothing else reads or writes it). A retry while the first call still
  runs on its page answers 202 `{in_flight: true, tool, call, since}` and is not run again; snapcall.py and snap_mcp.py
  ask again with the same key. A timeout never cancels the answer a retry waits for. *Why:* an Astrid agent retries
  after its own timeouts (the Runtime's mutation rule), and the first call's timeout cancelled the shared answer, so a
  retry got an empty reply (F-AD01). *More:* tests/snap/test_g15_safety.js.
- **SNAP-R209: A proposal keeps the version it was made against, and goes out of date when that moves.** A waiting
  write to a record (save_cast, save_cast_state, save_location, add_plate, remove_plate, draw_set_plan, use_take as
  cast or plate, delete_record) keeps `base {ref, version}`; a Book story edit keeps the story's head plus `on`, the
  waiting story edits it was drafted over (their accepts don't move it; a story version names the proposal that made it)
  and the beats it names or makes: only a later version that changed one of those beats (order and telling rank
  aside) moves it, so independent story edits keep stacking; one that names no beat watches the whole story.
  Once the record has a newer version that moves it, list_proposals gives `stale {from, to, by, said}`, Accept refuses, and the
  Room, the Work card and the Book docket offer "re-make against vN": the same call made again as a new proposal on
  the record as it is now, the old one withdrawn naming it. Two waiting writes on one record at one version are
  `either_or`; the Room says a yes to one leaves the other out of date. *Why:* F-AB03 (two proposals for Kuroe's
  front would have made v5 then v6), and the Astrid App's proposals (`baseVersion` → stale): the person never accepts a
  change against something that moved. *More:* tests/snap/test_g15_safety.js.
- **SNAP-R210: Proposal expiry parks, and is off by default.** With the person's setting "Park agents' proposals nobody
  answered after this many hours" above 0, a new proposal carries `expires_at`; past it the Work card shows it under
  Parked ("expired"), still waiting and still acceptable, never deleted. *Why:* the operator's open question on
  expiry (INTEROP_MAP §9): stale yes, time expiry only as an opt-in (no artificial limits). *More:*
  tests/snap/test_g15_safety.js.

- **SNAP-R211: Astrid's agents drive Snap through Snap's own tool table, on loopback.** The pack's
  `integrations/astrid/` (an Astrid pack, schema v3, checked by Astrid's own validator) has two actions, `snap.pages`
  and `snap.call {tool, args, page, idempotency_key}`, both running the pack's `tools/snapcall.py` (found through
  SNAP_PACK, since Astrid copies a pack on install) and writing its whole answer to the action's output. A SNAP_BASE
  that isn't this machine is refused before anything is sent. An Astrid agent is an agent (SNAP-R16, R95): its GPU
  calls wait as proposals unless the person lets agents run. Astrid-hosted Claude Code uses snap_mcp.py directly
  (AGENT_START "From Astrid"), which also serves Snap's skills as MCP prompts. *Why:* INTEROP_MAP step 2; files plus
  loopback, nothing in ComfyUI core or Snap's page. *More:* tests/snap/test_g15_astrid.py.
- **SNAP-R212: The Cut opens in Astrid; a private take stays out.** `export_cut` writes, beside the .otio, `<name>.astrid`
  (format astrid.timeline/1, every zip entry stored: manifest.json with each file's sha256, size and type;
  timeline.json, the authoring bundle whose parent clips mirror its config's; media/<sha256>), plus its timeline.json
  and assets.json to read. One media clip per cut on V1 at its place in the Cut (`from`/`to` = the trim), asset key =
  the take id, `label` "C2 · take 4", `generation.snap` {take, cut, book, beat, world pins, instructions, recipe_digest},
  ids only for a take run with metadata off (SNAP-R20). A take kept private, or one the page doesn't say may be shared,
  adds no clip and no bytes; its time stays a gap, named in `left_out` (fails closed). Every clip names a registered
  asset (Astrid doesn't check this itself). Takes store `recipe_digest` (sha-256 of the prompt they ran). Nothing is
  sent; the answer gives the `astrid timelines import` command, and each import makes a new timeline. *Why:*
  INTEROP_MAP step 1 as the lab proved it (CONTRACT_SNAP_EXPORT v1: there is no import of a bare TimelineConfig).
  *More:* tests/snap/test_g15_cut.js.
- **SNAP-R213: A cut can stand on a take from another shot, and says where it came from.** `set_active_take` with a
  take that isn't the shot's own (an earlier scene's, as a sequence reusing a short's takes) lists it in the shot with
  `from {scene, shot, name}` and makes it active; the take itself (its group, provenance, pins) is unchanged and its
  own shot keeps it. The answer says `brought_from`, and its Nearby line says "It is the active take of C3 too, brought
  from <scene> › <shot>". A take that doesn't exist is refused. *Why:* seq01 pre-production (step P7): a Book cut had
  no way to adopt an existing take. *More:* tests/snap/test_g15_cut.js.

- **SNAP-R214: A graph with no nodes never opens as a recipe or becomes a shot's workflow.** A take made by a paint or
  an edit queued as a bare prompt (a region edit, a New view) keeps a workflow with no nodes; `rerun` and `retake` of
  it are refused before anything opens ("make it again with the call that made it"), and loading any graph with no
  nodes into a shot is refused, so the shot's saved workflow and the open recipe stay as they were. *Why:* dogfood
  F-AC08: a refused `rerun` of short05's C2 key opened its empty workflow and saved it over the shot, and every
  recipe-reading tool then threw until a retake restored it. *More:* tests/snap/test_g15_cut.js. *Extended G16 (F-AD05):* `rerun` checks what each swap needs before the take's graph opens
  (opening saves it as the shot's workflow): the pin it swaps is in the take's own recipe, a set is in the Library, a
  setup exists; otherwise it refuses, "Nothing was opened or saved". *More:* tests/snap/test_g16_rerun.js.

- **SNAP-R215: The Cut goes to Astrid as an archive Astrid can edit, its clips named by cut, and every archive is proved
  editable before the answer.** `export_cut`'s `.astrid` (archive v2): one picture clip per cut on V1 whose id is the cut
  id;
  `gain_db` becomes the sounding clip's linear `volume`; a re-take swaps the clip's media and fields in place, so the
  clip keeps the cut id (SNAP-R217); tracks overlays first (the first draws on top): V1, A1 (the
  bed's lane), A2; `generation.snap` as SNAP-R212 plus the cut's scene `group`; never `app.astrid.cut`, chapters,
  placements or shots. With "Astrid on this machine" set (Settings > MAINodes > Snap > Astrid: the launcher and the
  Runtime's data folder), the server imports the archive into Astrid's scratch project `snap-probe`, trims a clip by
  0.1 s, commits and reads it back (tools/astrid_push.py probe, the lab's probe_editable.py steps) before it answers;
  without it the archive is still written and `probe` says nobody checked it. The import command names the
  production's project. *Why:* lab check A6: the cut idiom made an import uneditable ("invalid timing input: ''", "trim
  v1 does not support cut") and a placed-shot archive failed to import; the probe would have caught the jam's archive.
  *More:* tests/snap/test_g16_cut.js.
- **SNAP-R216: A speaking cut's sound has its own lane, with its line.** A cut whose beats carry dialogue is split: its
  picture plays at volume 0 and `<cut>-dialogue` on A2 "Dialogue" carries the take's own sound (48 kHz wav, inside the
  archive), labelled "<Speaker>: <line>", with `app.astrid {segment, text, words}` (words from the take's voice note,
  SNAP-R227) and `generation.snap {take, audio_of, speaker, line, voice_reference}`. A cut with no line keeps its sound
  inside its clip. *Why:* the G15 UX note "sound rides inside video clips, so Astrid's audio lane looks empty"; lab
  check A3: a dialogue clip with words on its own track imports, trims and lists its words. *More:*
  tests/snap/test_g16_cut.js.
- **SNAP-R217: A pushed Book changes in place; its diff says what moved.** Once a Book is in Astrid, `get_book.astrid`
  and `export_cut`'s `otio.astrid.diff` say what changed in the Cut since the push: `changed` (a new active take, or a
  trim or sound level moved), `added`, `removed`, `order_changed`, `shape`. A push swaps the changed cuts in place
  (SNAP-R224): through Astrid's SDK, `clip.swap-media` (both files admitted to the project's catalog) plus one
  `doc.patch` of the clip's label, `generation.snap`, `app.astrid` words, volume and trim, in one commit, so the clip
  keeps its id (the cut id) and its slot and says the new take. No clip is ever deleted (a delete is refused in any
  timeline whose clips carry words, F-AE02). A changed shape (a cut added, removed or moved, a length changed) can't be
  swapped, so a push refuses and `--new-timeline` makes "<Book> · Cut 2" beside the one in Astrid, said plainly. *Why:* each import makes a new timeline (contract §0.5), so importing again would orphan the finish work in
  Astrid (PROTOCOL_V1 §7.9). *More:* tests/snap/test_g16_receipt.js.
- **SNAP-R218: Every cut says its Astrid state.** `get_book` units carry `astrid {clip, media, take, head, state}`:
  "in sync", "swapped HH:MM", "changed here since the push", "a gap in Astrid (kept private)", "not in Astrid"; the
  Cut lens shows "Astrid: C7 · in sync" on each row. *Why:* the person lives in Snap until the finish and needs to see
  the hand-off without opening Astrid (PROTOCOL_V1 §7.18). *More:* tests/snap/test_g16_receipt.js.
- **SNAP-R219: On a page another agent drives, reads answer and proposals may be made; nothing else.** A call to a
  driven page from an agent that isn't its driver runs when the tool is read-only (`readOnlyHint`: get_book, get_take,
  list_proposals, describe_recipe…), when it asks only for a proposal (`propose: true` on a tool that takes it), or
  when it is `withdraw_proposal` (it writes only the proposals store); anything else is refused naming the driver and
  saying what works. Such a call doesn't count as the driver's (its hold's idle clock). Every proposal records `by` (the
  agent whose call made it) and, when that wasn't the page's driver, `driven_by` apart. *Why:* F-SQ08: the critic, and
  an Astrid-side agent asking for a re-take, couldn't read while the studio held the agents' window (PROTOCOL_V1 §7.17).
  *More:* tests/snap/test_g16_guest.js.
- **SNAP-R220: The Astrid pack carries what it runs.** `integrations/astrid/actions/call/run.py` calls Snap's bridge
  itself (POST /mainodes/snap/call: the agent name, a page, an Idempotency-Key retried on a timeout or `in_flight`,
  pictures saved beside the answer), so the copy Astrid installs needs only SNAP_BASE (loopback) and SNAP_AGENT; no
  SNAP_PACK, nothing looked up beside it. Amends SNAP-R211. *Why:* the G15 note: SNAP_PACK had to be set by hand because
  Astrid copies a pack on install. *More:* tests/snap/test_g15_astrid.js.
- **SNAP-R221: What Snap puts in Astrid's project are projections of its records, by Snap's ids and the takes' own
  pins.** `tools/astrid_push.py context` makes or updates one Astrid reference per Cast and place (canonical = the
  front picture or the master; `metadata.snap {record, version}`; every version the Cut's active takes ran on as a
  `depicts` association with its version, read from each take's pins, never from the records' heads; a Cast's voice as
  an association with `metadata.snap.role: "voice"` until Astrid has a voice role), the Book's documents
  (`snap.story/beat-sheet/style/voices.<project>.<book>`, `snap.production.<project>`; Astrid's document ids are
  realm-wide, F-AE04) and nothing else. It matches by `metadata.snap.record` and document id, so a second run makes
  nothing new. Nothing comes back as a write: an Astrid-side wish is a Snap proposal, a fact a note. *Why:* the jam
  hand-wrote today's heads where the takes had run on older versions (INTEROP_LOG 13:38); PROTOCOL_V1 §7.3, §7.6.
  *More:* tests/snap/test_g16_push.js.
- **SNAP-R222: Snap ↔ Astrid is one owner per record, projections one way, the cut id as the join.** Snap owns story,
  style, Cast, places, boards, takes and every generation proposal; Astrid owns the timeline after the Cut, its finish
  and its render. What Astrid holds of Snap's records is a projection stamped with Snap's ids and versions
  (`generation.snap`, `metadata.snap`); what Snap holds of Astrid's is the receipt. Nothing syncs back as a write: an
  Astrid-side wish is a Snap proposal, an Astrid-side fact a take note. The cut id is the clip id, kept across
  re-takes. The skills (snap-core "To Astrid and from Astrid", the pack's SKILL) and the study's CONTRACT_SNAP_EXPORT
  v4 say it whole. *Why:* PROTOCOL_V1 §1, v1.1 §1. *More:* tests/snap/test_g16_push.js.
- **SNAP-R223: A production is the record above the Book, and it is what an Astrid project is.** A `production` record
  holds a name, its Books in order, the Cast and places they share, a default style and `astrid.project` (the Astrid
  project's slug, from the name unless given). A Book is in one production: listing it in another takes it out of the
  first, whose version says where it went. A Book made alone, or an old Book read for the first time, gets a production
  of its own name (`production:of-<book>`, so two pages asking at once make one), never a refusal. Its export carries
  its Books and their stories; Cast and places are offered. The Book sheet names it ("Book 2 of 2"). *Why:* the
  operator, 2026-11-07: "one per book but it sounds like we need some higher organizational tree layers", and "a
  project being a trilogy or multi books"; one Astrid project per production, one timeline per Book (PROTOCOL_V1_1 §3,
  §14.1). *More:* tests/snap/test_g16_production.js.

- **SNAP-R224: The Cut goes to Astrid by the person's button or their per-Book setting, as one job the Work card shows;
  the server runs Astrid's CLI on loopback in a built environment and never re-imports a linked Book.** The Cut lens's
  Astrid card has Push to Astrid (Open in Astrid once in sync; "Push as a new timeline" when the shape changed); the
  Book's settings (under Dial) have "Push the Cut to Astrid by itself" (off by default): when the Cut's canon moves (an
  active take, a trim or sound level, the shared style) and the Cut has been still 20 s, the page pushes; a changed
  shape stops it and says so on the card. Either way the page writes the archive (probed, SNAP-R215) and POSTs
  `/mainodes/snap/astrid/push` (loopback only), which runs tools/astrid_push.py with exactly PATH, HOME,
  ASTRID_RUNTIME_DATA_ROOT, SNAP_BASE (this server, loopback) and SNAP_AGENT=snap-push, one job per Book (a second
  request while one runs queues one more), recorded `by: person (button)` / `person (auto-push)`; the job is a Work card
  row (running, failed with its answer whole) and the card's status line. Agents and the dial never turn these on; an
  agent's own push is tools/astrid_push.py from its shell. *Why:* the operator, 2026-11-07: "both options are good.
  setting on off and button to push over there"; the lab found Astrid's host inheriting provider keys from a tool
  shell. *More:* tests/snap/test_g16_settings.js.
- **SNAP-R225: Snap remembers where a Cut went.** The bridge keeps a receipt per user (`snap/astrid.json`): production
  -> Astrid project `{project_id, slug, name}`, its references, documents and the style section; Book -> timeline
  `{timeline_id, name}`, head, order, and per cut `{clip, media, take, trim, swapped_at}`. tools/astrid_push.py writes it
  after every push (`link_astrid` is the same write as a tool); `get_production.astrid.project` and the Cut lens's
  Astrid card read it ("In Astrid: seq02 › Cut 1 · head a3f… · 2 cuts changed since the push", with Open in Astrid,
  the App's address from the person's settings, loopback only, when in sync). It is the only source of truth for the
  link: Astrid drops a manifest's `snap` block on re-export (lab check A7), and a project's settings update replaces its
  metadata whole (F-AE01). *Why:* the G15 UX notes: nothing linked the two back, and the import named a placeholder
  project. *More:* tests/snap/test_g16_receipt.js.

- **SNAP-R226: The production style reaches Astrid's agent only as a marked preference section the person switched on;
  words only; removed when switched off.** "Share the production style with Astrid" (the Book's settings, off by
  default, with the help text of PROTOCOL_V1_1 §5): on a push, `<!-- snap:style book:<id> look:<id>@n -->` … `<!--
  /snap:style -->` in the project's preferences carries the look's paragraph, palette, voice direction, sound palette
  and genre notes (never its still, LoRA or source), through the CLI's checkout/checkin; off, the next push removes it;
  the person's own text outside it stays. *Why:* the operator, 2026-11-07: "this should be a configuration item and
  needs better explaining". *More:* tests/snap/test_g16_settings.js.

- **SNAP-R227: A take with a line gets its words timed in Snap.** The Voice QA's Nemotron Transcribe (SNAP-R240) hears
  the take's words with their times in the same pass as the voice note: `voice.words [[start s, end s, word]]` in the
  take's own seconds, `voice.text`, and `voice.line_match` against the cut's line as the take's story pin says it
  ("Nemotron exact", or how many of its words were heard, in order). get_take / list_takes carry them; the Cut's
  export puts them on the dialogue clip's `app.astrid.words` (SNAP-R216), which Astrid's `timelines words` lists. One
  speech model: the G16 Whisper path (MAISnapWords) is gone, with no fallback kept. *Why:* lab check A4: Astrid's
  `editorial.transcribe` is OpenAI whisper-1 and needs a key, so word times are Snap's (PROTOCOL_V1_1 §6); the
  operator, 2026-11-07 18:41: "why are you contemplating Whisper... we are using Nemotron for diarization". *More:*
  tests/snap/test_g16_words.js (GPU, on Nemotron since G17b), tests/snap/test_g17b_voice_qa.js (GPU).
- **SNAP-R228: An agent may withdraw its own out-of-date proposal, and says why; the person's answered ones and other
  agents' stay.** `withdraw_proposal {id, because}` withdraws a waiting proposal whose `by` is the calling agent (the
  bridge names it; the server checks the maker again), recorded `withdrawn by agent:<name>: <because>`; list_proposals
  shows it and the Room and the Work card drop it. Another agent's, or one already answered, is refused. *Why:* the
  operator, 2026-11-07: "yes they can withdraw"; the G15 note: an agent saw `stale` and had no tool for its own old one.
  *More:* tests/snap/test_g16_guest.js.

- **SNAP-R229: Two waiting proposals on one record at one version are asked as one question with both outcomes
  shown.** The Room asks "Two suggestions for Maren: which one?" with the record as it is and each suggestion's "after"
  pictures side by side, one "Yes to suggestion n" per side and "Neither"; a yes accepts that one and withdraws the
  others, naming it ("either/or: the person chose p14 instead"). The Work card shows the pair as one row ("Either/or: 1:
  … | 2: …", Accept 1, Accept 2, Reject both). *Why:* the operator, 2026-11-07: "yes side by side"; the G15 note:
  either/or was one quiet line on each proposal, answered one at a time. *More:* tests/snap/test_g16_either.js.

- **SNAP-R230: A Book cut owns its dial rows.** A cut's unit holds `dials`: rack rows as the Dial Rack stores them (the
  steering dials, not the Book's autonomy dial), time curve keys in clip seconds. `set_cut_dials` (by `{scene, shot}`
  or `{book, cut}`) writes them: the whole plan, one row, one key moved (`move_key`, kept between its neighbours), or the
  open rack adopted (`from_rack`); each row is checked with the rack's own rules before anything is written.
  `compile_unit` shows them with each row's effective strength and lints them; `apply_unit` sets the rack exactly from
  them and names any row it took off; a take keeps the rows that ran inside its graph, and reads stale ("dial rows
  changed") when its cut's rows move. A row set by hand on a cut's shot (`add_dial`) says where the plan lives. *Why:*
  the operator, 2026-11-07 ~17:5x, on G17's questions: "all of these sound good to me ... feel free to use your
  judgement through this leg" (replace the whole rack, name what was removed, one-call adopt); seq02 is a mage duel
  driven by dial time curves (DECISIONS ~15:0x-16:5x); the bake-off set curves by hand through `set_widget` (F-SQ13).
  *More:* study DESIGN_G17 §4.1-4.2; tests/snap/test_g17_dials.js.
- **SNAP-R231: On a Book cut, a time row blends on every step and protects the sound unless told otherwise.** `steps`
  defaults to the setup's step count (6 on Pika) unless the dial's info measured fewer for the recipe's pipeline;
  `audio` defaults to protect; the strength to the pipeline's measured useful strength, else the dial's own, else 0.5.
  Every default is filled into the row when it is written (a later default change never moves an old cut) and said in
  `defaulted` with its reason. `add_dial` / `set_dial {time}` use the same defaults. *Why:* the operator's standing
  rule "audio: protect is the default for look rows, SFX laid in post"; F-SQ14/F-SQ30 (look dials at k = 2 drew
  nothing under two reference pictures; k = 6 drew every one); bake-off round 1 (+6-9 LU of roar under follow).
  *More:* dials/README.md "Time curves"; tests/snap/test_g17_dials.js.
- **SNAP-R232: A dial file says what it does and how strong it runs per pipeline.** dial_info stays version 2 and may
  carry `kind` (look, light, weather, motion, camera, voice, other) and `pipelines {t2v | ref2v | fl2v: {useful,
  overcook, steps, evidence, notes}}`; older files read without them. `set_dial_info` merges info into the file (the
  tensors and their sha unchanged, said before and after); `list_dials` shows the block and, with a recipe open, its
  pipeline's numbers (`models.pipeline()`: ref2v under the Ref2V conditioning, fl2v with a First frame on, else t2v);
  the rack's ⚙ keeps both when it saves. The published Hugging Face dial files stay as they are until a released pack
  reads the block. *Why:* F-SQ16/F-SQ31/F-SQ35 (no tool wrote dial info; strengths differ per pipeline); the operator,
  2026-11-07 ~17:5x ("all of these sound good"). *More:* tests/snap/test_g17_dials.js.
- **SNAP-R233: The Cut's export carries each clip's dial rows in the take's seconds.** `generation.snap.dials
  {pipeline, clip_seconds, rows [{dial, strength, on, curve {interp, smooth, keys} | null, steps, audio}]}`, read from
  the take's own graph with the rack's defaults filled for hand-set rows, normalized keys turned into seconds by the
  take's length; the .otio clip's `metadata.snap.dials` says the same. The keys share the clock of `app.astrid.words`
  (the take's seconds; a trimmed cut's picture shows a key at key − in_s); a re-take's swap rewrites them and the clip
  keeps its id. *Why:* protocol v1.1 §15: an Astrid-side re-take moves a dial's peak onto a spoken word. *More:* the
  study's CONTRACT_SNAP_EXPORT v5; tests/snap/test_g17_export.js.
- **SNAP-R234: A re-take can take the cut's dial rows as they stand, or only open.** `retake {dials: "cut" | "take",
  open_only}`: for a take of a Book cut whose plan has dial rows, `cut` (the agent's default) puts the plan's rows on
  the rack before the run and names each key it moved; `take` keeps the rows that ran (the person's "Retake · as it
  was" does). `open_only` opens a take's chain into its shot and saves it with nothing queued, never waiting as a
  proposal. *Why:* the Astrid round trip (set_cut_dials move_key, then a same-seed re-take); F-SQ18's restore without a
  render. *More:* tests/snap/test_g17_export.js, test_g17_shots.js.
- **SNAP-R235: A shot has one tab.** When a setup switch moves a shot's recipe into a new tab, the old tab stops
  claiming the shot (its mark goes, it is renamed "was <shot> · <scene>", its nodes and undo stay); `open_shot` with
  two claimants opens the one holding the shot's saved workflow (else the newest) and says so; a tab is never saved
  over a shot when a newer open tab holds the shot's saved workflow: the save is refused, said in the answer and a
  toast, and the tab becomes scratch. *Why:* F-SQ18 (Shot 5's Pika recipe overwritten by a stale MOSS tab after
  apply_setup moved it), F-AC08. *More:* tests/snap/test_g17_shots.js.
- **SNAP-R236: An insert cites a frame of its master.** `set_unit {master: {cut, at_s, crop?}}`: that cut's active
  take's frame at `at_s` (cropped) goes into the cut's reference package and References as `continuity: <cut> at <s>`,
  is the board's nearest prior view unless the cut has its own approved board or a context, and `apply_unit`'s hint
  says to keep its light, colours and background; `from.master` makes the insert stale when the master's active take
  or the frame moves; a cut whose camera reads as an insert or close-up and names no master gets a lint. *Why:* the
  operator, 2026-11-07 ~16:5x: "dramatic light wins btw. also it might be good to take a frame of the blocking as a
  reference to feed the Corvin block sweat drop :P"; F-SQ23. *More:* tests/snap/test_g17_dials.js.
- **SNAP-R237: A Cast's voice goes in only where that Cast speaks.** One rule in one place (`library.voiceWanted`),
  for `apply_cast`, `apply_unit`, `update_pins`, `retake` and `rerun` alike: a recipe a Book cut compiled goes by its
  story pin's lines; a plain shot keeps a voice already in and adds one when the prompt gives the Cast a line;
  `apply_cast {voice: true | false}` overrides; a recast speaks where the Cast it replaces spoke. A voice left out is
  said ("no voice for Kuroe: no line in C2"); a speaker with no Cast voice reference is a compile lint. *Why:* F-SQ11 /
  F-SQ12 (H3 spoke a reference's words into silent cuts), F-AC11 (a retake with today's world added a voice); the
  operator's rule "every speaking character needs a Cast voice reference". *More:* tests/snap/test_g17_dials.js.
- **SNAP-R238: list_nodes lists hidden widgets too, marked hidden.** Only `$$` widgets are left out; a widget its node's
  own panel hides (the Dial Rack's `rack`) comes back with `hidden: true`, and `set_widget` sets it. *Why:* F-SQ13 (the
  rack's rows could not be found from the tools); the no-trim rule (SNAP-R58). *More:* tests/snap/test_g17_dials.js.
- **SNAP-R239: Make a dial puts nothing on the rack unless asked, and says where the file landed.** `make_dial
  {add_to_rack}` defaults to false (the Make a dial sheet, a person's press, still puts it on); Make Dial's last input
  `folder` names each loras root by its shortest distinct tail and is checked again where the file is written; the
  answer gives `saved`, `folder`, `shared` (false = this server's own models folder: on a `--base-directory` server,
  that base's) and the other folders it reads, such as a shared dial library. A dev or test server keeps saving into
  its own folder unless `folder` says otherwise. *Why:* F-SQ17, F-SQ33; the operator, 2026-11-07 ~17:5x ("all of these
  sound good to me"); the gate's realmodels guard. *More:* tests/snap/test_g17_dials.js.

Next free ID after this batch: SNAP-R240 (R160-R164 stay free; G16 reserved R215-R229).

## Batch G17b (2026-11-07): the Voice QA, prompt craft from the measurements, continuity across cuts, the set reference

- **SNAP-R240: The voice note hears words, times, who, and what nobody scripted.** With the AudioCPP fork's nodes
  (matlowai/ComfyUI-AudioCPP, branch nemotron-diarization) and the model graph's two `voice_qa` files on the server
  (the Nemotron Transcribe GGUF, the WavLM-large ECAPA voice model), `check_voice` and the check on landing also run the
  H3 Voice QA in the same prompt as the voice note: Local Server → Reference Speakers (every Cast voice of the take's
  Book, the cited ones first, others from the Cast library filling in to two, at most seven) → Nemotron Transcribe
  (English) → the voice model → H3 Voice QA → a core PreviewAny on its `report` (lab check L6: the JSON reaches
  /history only that way). The QA's prompt is Snap's, written in H3's dialogue grammar from the cut's lines
  (`[Shot 1] <Audio n> <d>line</d>` with `cast` "Audio n: Name"; a plain shot uses its prompt's `Name says "…"`
  lines), because the fork's parser reads only `<d>` lines. `voice.qa` keeps each line's verdict, the unscripted
  speech, `why` and `listen`; `voice.status` is check on a wrong voice, a missing or mistimed line, or unscripted
  speech, and listen on a voice under the pack's 0.08 margin (never "wrong person"); the critic packet carries it as a
  measured claim, the Cut lens and the take viewer show it amber; every take of a Book cut is checked, a silent cut too.
  The QA's server runs on the Voice QA setting: the other GPU by its UUID (GET /mainodes/snap/gpus), or ComfyUI's own
  with the experts in RAM, or off. Never a block. *Why:* the operator, 2026-11-07 17:51: "all of these sound good to
  me and yes you can install audio.cpp fork on the main ComfyUI" (GPU 0 by default, the slower same-card mode as a
  setting, English barks); the ship rule: Nemotron for what was said and when, ECAPA for who, unsure below 0.08
  (the Nemotron study, 5 voices / 1344 swaps); F-SQ11/F-SQ12 (two shipped leaks). *More:* study DESIGN_G17 §4.8, LAB_G17
  L6; tests/snap/test_g17b_voice_qa.js (GPU).
- **SNAP-R241: A Cast's voice reference keeps its words, and a reference that says a line of the script is a lint.**
  `use_take {as: "voice"}` stores the words the stretch says (`voice.words`, from the take's Voice QA words in take
  seconds; the answer says when they aren't known and how to get them), `save_cast voice {words}` sets them by hand;
  `compile_unit` lints a speaker whose reference says a line anywhere in the story ("Hiyori's voice reference says
  'Tomoshi, I just swept that.', which is their own line at b4"). *Why:* F-SQ12 (H3 spoke the reference's words, so the
  short said her one line twice); the operator's rule "every speaking character needs a Cast voice reference".
  *More:* study DESIGN_G17 §4.8; tests/snap/test_g17b_misc.js.
- **SNAP-R242: A picture in References is a target, whatever its citation syntax: the inclusion policy is the rule.**
  `apply_unit` leaves the cut's key drawing out of References unless the cut ends on a held pose (`set_unit {hold:
  true}`), and leaves the location's master out of a cut that has its camera plate unless asked (`set_unit
  {cite_master: true}`); each is said with its measurement, and `compile_unit` lists them in `left_out`. A key picture
  on a cut without hold, or a place picture beside this cut's camera picture, is an error-level lint in apply_unit's
  `errors` and run's `lint`, whatever the prompt says about it (said, never enforced: SNAP-R11). AGENT_START's old
  advice "end on a picture by citing it as a reference" is withdrawn. *Why:* M6: a key picture in References turned an
  action cut into a near-still of the key by 1.5-2.5 s in 4/4 takes, with no sentence or with "the shot ends on
  <Picture 4>" (motion after 2.5 s 3.3-6.5 against 12.7-13.3 without it; lab L8 first); M2/M7: every end-of-take cut
  landed on the cited master (13/18 at 640, 3/10 at 1280, 0/3 without it), and wrapping it in a `<Subject N>` did not
  stop it; the operator, 2026-11-07 19:0x: prompting lessons are "a harness change for the agentic stuff". *More:*
  study PROMPT_CRAFT_RULES §0 items 1-2, §8 M2/M6/M7; DESIGN_WORLD_STATE §8.1 item 5; tests/snap/test_g17b_craft.js.
- **SNAP-R243: A cited picture has a job; a look-alike cite in the action is an error.** A sentence that cites a picture
  as something to look like ("like <Picture n>", "as in", "similar to") is an error-level lint in `compile_unit` (beats,
  blocking, camera), apply_unit's `errors` and run's `lint`; any other picture cite inside the action is a lint. Cite a
  picture for its job only: the opening, this cut's camera, who someone is, a continuity frame. *Why:* F-SQ20: "a power
  clash like <Picture 4>" made H3 jump-cut into the key's framing at ~2 s on 2/2 seeds and stall (motion 2.6 against
  ~10.8); G17a's own test story wrote "Corvin holds like <Picture 4>" and only a soft lint caught it. *More:* study
  PROMPT_CRAFT_RULES PC-06; tests/snap/test_g17b_craft.js.
- **SNAP-R252: A cut that continues the previous cut's action opens on that cut's out-frame.** `set_unit {opens_on:
  {cut, at?}}`: the named cut's ACTIVE take at its trim out-point (the last frame the Cut shows: frame ceil(out_s × 24)
  − 1, so an out of 3.75 s is frame 89; `at` seconds picks another frame) goes into the cut's package and References as
  `opening: <cut>'s out-frame`, first, cited "<Picture 1> is the first frame: the shot opens exactly on it and keeps
  its camera, framing, set and light"; the cut's own board and the location's pictures stay out (the frame holds the
  set), said; `from.opens_on` makes the cut stale ("its opening frame changed") when that take or its trim moves; a cut
  that follows another on the same plate with no opens_on gets a lint; `use_take {as: "reference", role}` names a hand-
  pulled frame's job (F-SQ49); the critic packet's `continuity` sentence asks the cut-pair pass to compare the join.
  *Why:* the operator, 2026-11-07 19:49: "the jump between the 2 scenes is a bit rough; it needs that last frame as a
  reference in Ref2V, talking about it being the first frame of the next ... also that needs to be a rule"; short05
  v3a2's C2, made this way by hand, joined C1 seamlessly (RERUN_V3 "C1 → C2"). *More:* study DESIGN_WORLD_STATE §4.3,
  §8.1 item 1; dogfood F-SQ49; tests/snap/test_g17b_continuity.js.
- **SNAP-R253: Every cut plays from its side's set reference, made from the picked look; the walkthrough plates stay.**
  A location's plates may carry `side` (a camera side; without it a plate's side is its camera mark, else its name) and
  `set: true` (that side's set reference). `make_set_reference {book, cut}` makes candidates from the cut's active
  take at its trim out-point with every person removed (a New view on P-H3-Image, purpose plate), landing in a design
  lane beside the Book ("<Book> · set references", one shot per side), never in the cut's own shot; `make_set_reference
  {book, cut, pick}` saves the picked still as a plate (set, role camera, the cut's plate's camera mark and pose, its
  provenance) as a new location version and names the cuts on that side that don't play from it. `compile_unit` lints
  a cut whose plate isn't its side's set reference when one exists, and a side with none; `set_active_take` and
  `apply_candidate` on a Book cut whose side has none offer the call. *Why:* the operator, 2026-11-07 19:51: "that
  scene needs a proper 'this is the set' type reference for each of the shots to play from"; short05 v3a2's P1b, made
  by hand this way from C1's out-frame, held the stall for C4 (RERUN_V3 "Set reference"); F-SQ50 (plates made before
  the look was picked made the set jump). *More:* study DESIGN_WORLD_STATE §4.3, §8.1 item 2; tests/snap/test_g17b_continuity.js.
- **SNAP-R244: Pictures beat words: a duplicated story prop or person is high on a board as on a take.** A critique note
  with `count {thing, expected, seen}` where seen is above expected is written high whatever severity it was given
  (`raised` says so), so the "no high note" approval (SNAP-R107) never passes a board that would put a second bowl into
  every take made from it; the snap-critic skill's severity list says the same. *Why:* the operator, 2026-11-07 18:43:
  "the answer is 11-6 preset C ... because it's clear and there's only 1 bowl, not a duplicate bowl"; M1: on a clean
  one-bowl board every prompt drew one bowl (6/6, the bowl named four times), on the old two-bowl board no wording
  removed it (0/3): the approved board's "low" second bowl made the duplicate. *More:* study PROMPT_CRAFT_RULES §3
  CC-3, §6 item 2, §8 M1; tests/snap/test_g17b_critic.js.
- **SNAP-R245: The critic counts story props and people every half second, on takes and boards.** The `cut` checklist
  reads a frame every half second and the last ("every 12"); `board` and `cut` gain the `count` pass; the packet's
  `count_these` lists a Book cut's story props (the unit's props and what its Cast carries) with the expected count
  and the holder at the opening and the end, its people and its dial rows. *Why:* short05 C1's second bowl was missed
  by the critic and the coordinator on 5 spread frames (LESSONS "Count the props"); PROMPT_CRAFT_RULES §0 item 11.
  *More:* §3 CC-1, CC-2; tests/snap/test_g17b_critic.js. The skill's new passes ship before a fixtures re-run (an
  open item for the coordinator under SNAP-R109).
- **SNAP-R246: The copy check names where a take goes.** `check_copies` scores a take's frames every half second and
  its last against every cited picture; `copy.reaches` names a picture the take didn't open on and turns into later,
  staying at the copy threshold or more to the end (its role, from_s, score; the M6 key take scored 0.63 at 0 s and 0.85 from 2.5 s), and `copy.said` says to leave it out of References; the packet
  carries it so the beat pass names the destination instead of "prompt ignored". *Why:* M2/M6/M7 found every cut,
  dissolve and freeze this way at 0.92-0.99 (the master, the key); F-AC12 counted 3/11 takes ending on the master
  unnamed. *More:* §3 CC-4; tests/snap/test_g17b_critic.js.
- **SNAP-R247: The critic packet carries the prompt that ran and what to hold it to.** `words.prompt` is the executed
  prompt; a Book cut's take adds `count_these` (SNAP-R245), `copy` (R246), `voice` (R240), `continuity` (a continuing
  cut's join, R252) and the sound onset (R249). *Why:* CC-5: the beat pass reads verbs, counts and negations against the
  frames and can name "prompt" as an owner with the sentence that caused it. *More:* tests/snap/test_g17b_critic.js.
- **SNAP-R248: The soundscape leads with hard events.** `compile_unit` and run's `lint` flag a soundscape whose first
  clause is soft, ambient or a steady/tonal source (soft, gentle, faint, distant, ambience; hiss, hum, buzz, drone,
  rumble, horn, engine), and a music line other than N/A; the tail is not linted. *Why:* U78 (controlled): an
  ambience-only soundscape rendered -57.8 dB against -39 to -42 with events; tonal words became drones; M3: the tail
  neither helped nor hurt, and the "low hiss cost 16 dB" claim did not reproduce (withdrawn). *More:* §2 PC-13, §8 M3;
  tests/snap/test_g17b_craft.js.
- **SNAP-R249: A take's biggest short transient is measured, and a sub-bass hit is said.** At capture the loudness route
  also measures the biggest 10 ms transient: its time, level, dB over the sound within a second around it, and its
  share below 150 Hz; 20 dB over with half or more below 150 Hz is a `hit` (an impact boom), in get_take's `sound.onset`
  and the packet's sound words; the critic's `sound` pass judges it with sound on. *Why:* F-SQ46: AST's 2 s windows
  averaged short05 C3's 0.1 s boom away (Explosion 0.04) while the blind critic measured -6.9 dBFS, 62 % below 150 Hz;
  on the fixtures this measure flags that take (21.3 dB over, 63 %) and not the softer pick (16.8 dB). *More:*
  tests/snap/test_g17b_misc.js.
- **SNAP-R250: One ordered action, and no two lines disagree.** `compile_unit` and run's `lint` flag a hit placed by a
  place-word ("at the middle of the shot") with no "then", and one prop put in two places in one prompt ("the monocle
  in his left hand" and "the monocle hanging on his lapel"). *Why:* PC-02: "at the middle of the shot" put the hit at
  0.9 s, a written wind-up and "then" at 2.0 s (2/2); PC-09: two disagreeing lines drew the wrong one (2/2, several
  cases). *More:* tests/snap/test_g17b_craft.js.
- **SNAP-R251: The measured "remember these things" list lives in the Agent library, the skills and AGENT_START.** The
  list of PROMPT_CRAFT_RULES §0 is the snap-core skill's "Writing a prompt" section and one pack note each in
  pack_notes.json (global and per tool), cited by snap-book, snap-boards and AGENT_START §4. Demoted by the measurements
  to tidiness, never linted: name a prop once (M1: the board made the duplicate, not the wording), a bare Cast line vs
  one joined to its name (M5: no difference), `<Subject N>` wrapping (M7: neutral; it does not stop a cited master
  pulling cuts), and "the street stays empty: no cars" (M4: seed-specific, may name the vehicle into the shot).
  *Why:* the operator, 2026-11-07 18:46: "this should be a harness change for the agentic stuff in terms of prompting
  lessons ... 'remember these things'". *More:* study PROMPT_CRAFT_RULES §0, §6 (each contradiction with an older rule
  resolved in LESSONS "Batch G17b").

Next free ID after this batch: SNAP-R254 (G18 reserved R254-R262, G19 R263-R266).

## Sequence review and provisional map continuity (2026-11-08)

- **SNAP-R267: Review continuity across the assembled sequence, including the action phase and the export.** Before
  video, compare the previous out-pose with the next opening: hands and props, position, facing, and whether the
  action has already happened. A changed camera does not justify repeating a wind-up or clearing accepted damage.
  After assembly, compare adjacent views at playback size for grade and detail changes, accounting for camera
  direction and exposure, and inspect the whole piece
  for things the named checks missed. Check audio/video start and end times, then listen across splices and the
  ending; ASR and levels cannot certify the sound, and a sampled review must say what it did not watch or hear.
  *Why:* seq02 cut1f repeated a wand thrust and lost floor fractures between views; its wide/single grade and detail
  were flagged as perceived mismatches, and its audio ended before its picture. *More:* dogfood seq02/review_2026-11-08/REVIEW.md; `snap-boards`,
  `snap-book`. This adds planning and assembly guidance; the measured critic prompt stays under SNAP-R109.
- **SNAP-R268: Preserve a textured overhead collage separately from schematic state metadata.** A visual layout
  reference is the actual textured bird's-eye set with genuine overhead RGBA actor cutouts placed at explicit
  positions, scales, orientations and overlap order; rotated front portraits and symbolic dots are not substitutes.
  Inspect the raw collage and retain source layers, clean references and placement metadata. In image editing, the
  collage supplies layout, original references supply appearance, and the model reconciles light, shadows and edges.
  Original set references govern footprint, proportions and landmark relations; check generated aerials against them.
  Canvas aspect is not floor footprint: repair a square-for-rectangle error from sources, never stretch the image
  and its circular ring. Use the scene reference minimum in SNAP-R271 for new-camera work; distinguish side geometry
  references from a target-camera composition plate. Aerial + actors only is an explicitly selected ablation,
  not the default preparation. Test H3 and explicitly selected Qwen2.1 with a few guided seeds;
  schematic-map failures do not test this route or exclude a model globally. Prior two-seed frames looked good but
  used a conflicting square aerial, a clean camera plate and strong placement words; they validate neither same-world
  aerial continuity nor its contribution. Use a matched no-aerial control when attributing benefit. Retain observed
  H3/Qwen same-camera image-finishing results without a reliability claim. Keep landmarks fixed
  across state versions; update intended or accepted damage, items and actor placements under existing production
  canon/autonomy policy without an extra approval step. Generated errors do not become canon. First-frame image
  editing is a separate test from video: overhead collages and annotations are not default video References because
  of framing-target and mark-leakage risks (SNAP-R242, R133). *Why:* the operator clarified actual textured overhead
  set/actor cutouts, regeneration for cohesive lighting and proportions, then a starting frame and a few seeds;
  schematic dots/arrows tested a different proposal. *More:* study VISUAL_COLLAGE_PLAN_2026-11-08.md;
  LAYERCRAFT_COLLAGE_SCOUT_2026-11-08.md; MAP_CONTINUITY_EXPERIMENT_2026-11-08.md;
  visual_collage_2026-11-08/AERIAL_GEOMETRY_CORRECTION.md; `snap-location`, `snap-new-view`.

- **SNAP-R269: Review the whole location's design and staging across existing views before choosing shots.** Read the
  pinned plan, notes, scale, camera marks and accepted state; inspect whole native views before details. Assess usable
  ground and circulation, fixed landmarks, architectural/material coherence, scale, light and camera coverage. Keep
  recognizable structures grounded in original references that establish function and access. Derived angles can
  share an incorrect master premise; distinguish building levels and dated states before combining their views. Keep
  advisory design preferences apart from evidenced physical or continuity flaws. Test camera, projection, occlusion
  and accepted-state explanations before declaring a difference wrong; name unseen areas and source ownership.
  *Why:* a shot-by-shot continuity check does not establish that a set works as a whole place for the story, and
  changing cameras can explain screen-side differences. *More:* skill `snap-set-design`; study
  SET_DESIGN_REVIEW_2026-11-08.md; `research/2026-11-08/lighthouse/`. Instruction-only workflow, not a change to the measured critic under SNAP-R109.

- **SNAP-R270: Partial New view denoise initializes from Picture 1's pixels, not an empty target.** Omitting
  `denoise` or giving 1 preserves the existing reference-only graph. A partial P-H3 or Qwen 2.1 edit encodes the
  first picture at the native target canvas with the same VAE and keeps the ordered references as conditioning.
  P-H3 retains its empty audio through the native AV split/join and uses a model-aware H3DeropeSigmas tail;
  Qwen uses its native KSampler denoise schedule. Their numeric strengths are different schedule conventions.
  Record the init picture, schedule and requested canvas, and preserve them on a New view rerun. Blurring a
  reference changes conditioning; it does not itself supply a sampled init. *Why:* the collage experiment needs
  a real partial redraw, while both native conditioners return empty target latents. *More:* study
  visual_collage_2026-11-08/PARTIAL_DENOISE_SCOUT.md; tests/snap/test_view_init.js.

- **SNAP-R271: Prepare a scene reference packet with a textured top and genuine sides.** Before generating views of
  a known scene, agents must prepare at least one textured top/bird's-eye view and at least one genuine side/elevation
  of the same set; prefer two distinct informative sides. The top establishes layout and footprint; sides establish
  height, proportions, architecture and occlusion. Repeated crops do not count as distinct views. Label each picture's
  camera, role and source version; resolve conflicts against authoritative originals, never blend incompatible
  geometry. Obtain missing views within existing authorized scene work, otherwise report the coverage gap without
  claiming a complete packet. A side geometry reference need not match the requested output camera: distinguish its
  geometry role from copied composition. Any cited side frame means the run is not aerial-only. Omitting sides is
  only an explicitly selected ablation, not a normal preparation step. This is agent guidance; native tools remain
  permissive, with no new node/server validation, model parameter or approval gate. *Why:* the operator, 2026-11-08:
  "we need the side view...for the geometry...make that mandatory at least top and at least one side view...preferably2".
  *More:* study SCENE_REFERENCE_MINIMUM_2026-11-08.md; `snap-location`, `snap-new-view`, `snap-set-design`,
  `snap-model-choice`.

- **SNAP-R272: Production strategies preview native work and retain native authority.** A strategy resolves exact
  versioned data into an inspectable plan over existing tools. Preview does not create records, materialize frames,
  change graphs, queue work or grant permission. Variants use existing versioned cards; parameter preferences use
  native instruction notes and their scope, supersession and pins. Resolve each cut/tool independently, including its
  selected method's notes; expose an actual method-choice cycle. Default a saved preference to the selected production
  or narrower target, with global available explicitly. Replan after accepted changes, picks and trims. Keep all
  diagnostics and supplied inputs; limits come from the actual native capability or an explicit helper profile.
  Reference-role and duration helpers remain proposals; native compilers own final sockets, prompts and schedules.
  R270 and R271 still govern initialization and scene preparation. Strategies are visible in Snap's Library rail and
  use the same command/dialog and tool boundary as the ordinary frontend. *Why:* customizable directing must preserve
  existing work, per-production choices and the measured native generation paths. *More:* `director/README.md`;
  `snap-director`; `tests/snap/director/`.

- **SNAP-R273: Book instructions match their explicit Book and its scene contexts.** Book-scoped notes apply to an
  explicit Book context, a Book pin, or a shot/scene listed by that Book. Other Books retain their own notes. The
  normal resolver's precedence, off marks, conflicts and queued instruction pins remain authoritative. Treat
  activation of previously unmatched Book notes as a behavior change and inspect existing stacks before rendering.
  *Why:* the declared Book scope formerly fell through the matcher, silently omitting production guidance.
  *More:* `director/README.md`; `tests/snap/director/native-instructions.test.mjs`.

Next free ID after this batch: SNAP-R274 (G18 reserved R254-R262, G19 R263-R266).
