# Snap design rules

Code cites these by ID, e.g. `// SNAP-R3: faces show outcomes`. Each rule has a one-line statement, why it exists,
and where the full story lives. Study docs are in the research folder
the Snap study notes (local to Dylan's machine): LESSONS.md, MODEL_SWITCHING.md,
MODEL_GRAPH_ONBOARDING.md, UX_SPEC.md, CONCEPT.md.

When a rule changes, edit it here and keep its ID. Retired IDs stay listed as "retired", so old comments still resolve.

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
  (the Pika H3 Flex LoRAs are turbos: 6 steps, lcm, cfg 1 on Pika's manual knots; Dylan, 2026-11-04: "pika is turbo"),
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
  and training checkpoints (`..._v01_step1500`) showed as core·turbo on the live server (PLAN U67); Dylan, 2026-11-04
  20:41: the kind is "checked by an LLM reading the LoRA itself (metadata, source), regardless of name, unless the
  name says something unambiguous like '4step'" (PLAN U84).
- **SNAP-R55: A LoRA's kind is judged by an agent reading the file; the person's filing wins.** Snap makes no LLM
  call (no internet; the agent is the LLM). `describe_lora {file}` returns what the file says about itself: its
  training metadata (ss_*), the tags it was trained on, trigger words, modelspec and other text fields, the rank its
  tensors have, size and folder, and how Snap files it now. `set_lora_category` takes `by` (agent, the default, or
  person when the person said it) and a short `reason`, kept in the person's `snap/models.json` as `filed: {by, reason,
  at}`; the LoRA sheet shows an agent's filing as "agent: <reason>" on the row. An agent filing a LoRA the person filed
  (move to…, or an entry of theirs from before `filed` existed) is refused, naming their filing: ask them or propose
  it. AGENT_START asks agents to work through the unsorted LoRAs that way. Never blocks a run. *Why:* Dylan, 2026-11-04
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
  different person" (ArcFace on a crop around SAM 3.1's face mask, cosine below `identity_check.different_person`, U56)
  and "hair lighter than original" (SAM 3.1's hair mask, lit-hair L* p90 over the take's own frames above
  `hair_check.lighter`, U56b). An edit that `does` something in `identity_check.unreliable_for` (relighting: the same
  woman scores 0.34-0.60 at night) shows its cosine as "face check unreliable under relighting" and never the
  different-person flag. What an edit does is its example's `does` (night, dusk, dawn: relight), else its method's:
  Change something in the person's own words is an edit and keeps the face check, whichever method runs it (Dylan's
  "make her jacket sparkle magic" on Ripple was muted as a relight and a different woman went unflagged, batch E). A
  recast has no face check against the take (someone else is the point), but one painted from a Cast's picture compares
  each painted face with that picture: "probably not <name>" below the same threshold, else the number only ("face vs
  Lio's picture 0.72"), since above it ArcFace doesn't rank likeness (batch E GPU check: run 7's other-looking c2 scored
  0.72, the closer c1 0.53). Both miss things (dark frames and profiles score low, blonder hair doesn't show), so the
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
  is Dylan's open question). Ids are
  stable and the shots ordered; lanes and in/out on shots and takes come with the sequence editor (layer 3).
  *Why:* takes grouped by the workflow's own id, so a scene's shots and their variants scattered over tabs
  (NEXT_DESIGN_REVIEW §10 Q2); Dylan (2026-11-04): "a scene should have the related work navigable and nested".
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
  the person applies it. The `character` card kind is `cast`. *Why:* Dylan 2026-11-04 20:48: "metadata for the cast rows
  should live with that cast record. the cast id would live on the image, not everything about the character itself";
  22:44: files carry what ran plus the pins (design Option C). *More:* `web/snap/library.js` (applyCast),
  `web/snap/castview.js`; DESIGN_U86_U87_CAST_VERSIONS_2026-11-04.md §4.1-4.2; PLAN U86.
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
  Dylan 2026-11-04 20:49: "versioning so you can properly recall the state of what it was when it was generated and
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
  carry nothing (SNAP-R38). *Why:* Dylan 2026-11-04 22:44: "open/drop a file in Snap → 'Run as it was' / 'Run with
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
  shape: it is the one step that can't be undone). *Why:* Dylan 2026-11-04 20:51: "keep every world-state version
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
  the whole refs line in `fields` and add `pictures` [{role, was, now}] (SNAP-R58). *Why:* Dylan, 2026-11-04 22:45: "run as it was, run with today's world,
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
  *Why:* AGENTS.md "No Internet Requests"; Dylan (2026-11-04): intent first, light touch, metadata asked here.
  *More:* MODEL_GRAPH_ONBOARDING §4 and §8, `web/snap/onboarding.js`, `onboardview.js`, `profile.js`.

- **SNAP-R28: Whether an agent reads code before bringing it in is the person's setting.** `code_review` in user
  `snap/profile.json` (one skippable onboarding question, and a row in ComfyUI's Settings, MAINodes › Snap › Code
  review, that mirrors it): `always` reads every node pack or script that isn't part of their setup yet, `unknown` (the
  default) only what Snap's kits carry no safety read for, `never` saves the tokens. `get_profile` returns it;
  `propose_downloads` gives every pack (a kit's, or any repo an agent names with `pack`) a `review` of `required` or
  `skipped (your setting)` beside its license and safety read, and the tool descriptions tell agents to follow it. It
  only decides the reading: every install still waits for the person's yes, and Snap itself never installs or
  downloads (SNAP-R25). *Why:* Dylan approved the Viggle Remake pack "so long as you look at everything", then made it
  a preference (2026-11-04 16:14): reading costs tokens, and the choice is his. *More:* DECISIONS "Onboarding", PLAN U70.

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
  tool table, its errors or the pack's `docs/AGENT_START.md`, never only in code. Pages are keyed by the ComfyUI user
  (the comfy-user header snap-gate sets per account): a call goes to a connected page of the caller's own user, and only
  that page may answer it: the newest tab whose person turned "Let agents see" on (that control is how a person lets
  agents drive their tab, Dylan 2026-11-05), else an agent's own headless page; a person's tab with it off is never
  driven. An agent picks its page: `list_pages` names each one (whose, the id's start, the tab or shot it shows) and
  `use_page` binds the agent (named by `X-Snap-Agent`: SNAP_AGENT for snapcall.py, one name per snap_mcp.py connection)
  to one page for its session; one agent drives a page at a time, the page shows "Driven by: <agent>" with Release, and
  another agent reaching it is refused with the driver's name, never switched silently (Dylan 2026-11-05: "easily
  select which web ui instance you want to interact with and not collide"). `SNAP_PAGE` or the `X-Snap-Page` header
  sends one call to a page; every answer names the page that answered (`page.id`, `page.name`). `snap_agent_page.sh`
  never takes a person's tab for the agent's own page. `GET /mainodes/snap/tools` lists the caller's open pages, when each registered and
  last answered; with none open, a call says it may have been locked or closed and how to open one (`tools/snap_agent_page.sh <port>`, which uses a new
  Chrome profile per launch, returns once the page has registered, starts nothing when a page is already open, and
  with `--stop` ends the pages it started, with no pid or kill from the caller). Every brick in `describe_recipe` has an `id`, exactly what
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
  action makes). A headless page from `snap_agent_page.sh` screenshots itself through its own Chrome's DevTools port (no press). The embedder sidecar's port follows ComfyUI's
  (port + 230; 8188 keeps 8418). *Why:* U72 run 1 (Sonnet at low effort): grepping JS for a setting id, a stale Chrome
  lock, a "ready" kit whose recipe wasn't, polling a run that never said done, guessing fps, `undefined has no seed`;
  Dylan: "once sonnet low is smooth I'll call it good". *More:* u72/FINDINGS.md F1-F10, PLAN U75, `snap_bridge.py`,
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
  results. *Why:* Dylan, 2026-11-04: "no limit ever"; "if a result exceeds context limits it needs to be passed to a
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
ComfyUI, Dylan's included, nothing here restricts anything (SNAP-R11, DECISIONS "No artificial limits").

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
  `--disable-metadata` is global; Dylan chose metadata on for everything with one clean switch (2026-11-04) over
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
  are dial files, which keep their own sentence pairs. *Why:* Dylan, 2026-11-04: "Save metadata off should stop metadata
  from writing. If there's anything that doesn't have a toggle for that in the flow, let them know." *More:* PLAN U81,
  `snap_bridge.py`, proto/test_metadata_off.py, test_metadata_flows.js.
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
  (https://huggingface.co/Viggle/Viggle-Remake) · MiniMax H3". *Why:* Dylan, 2026-11-04 16:45: Recast is a Snap slot, no
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
  Every prompt Snap queues carries `extra_data.snap_job`: `kind` (run, retake, rerun, paint, propagate, extend, louder,
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
  Agents read the same rows (`list_activity`, `wait_for`), whole, with explicit paging (SNAP-R58). *Why:* Dylan
  2026-11-05 08:04, after his first edit's candidates arrived with nothing on screen: "if we dont have good visibility to
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
  downloads one. *Why:* Dylan, 2026-11-04: "that wouldn't happen since the file would have been generated by them or
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
  and stay. A switch file that doesn't parse counts as on and as broken. *Why:* Dylan, 2026-11-04 19:00: "Private
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
  (Dylan, 2026-11-04: "my machine isn't going to be the private one"; "dont artificially limit anything please thats
  for the end user to do what they decide"). *Why:* derived LoRAs with neutral names in a neutral folder were caught
  only by their stamp (U68). *More:* U68_PRIVACY_AUDIT_2026-11-04.md "Matcher gaps", PLAN U71, `snap_privacy.py`,
  `snap_bridge.py`.

## Context and references (U101)

R67-R70 are reserved for the Book (CONCEPT_PRODUCTION §11); U101's rules start at R71.

- **SNAP-R71: A new view of a known place is an edit from context pictures, in the asker's words.** "New view from these
  pictures" (the take viewer's tray; `edit_from_context`) makes a still with MOSS Image Edit from 1 or more context
  pictures (a still take, a video take's frame, an input/ file, a Cast's picture, whole or cropped) and a prompt the
  person or agent writes; nothing is added to it, so the in-place Change something's "keep the place and the
  composition unchanged" text stays only on that route. It works on stills (masters, plates, boards), unlike Change
  something, which edits a video take. Each seed is a candidate take (SNAP-R23) in the shot it lands in (by default
  Picture 1's take's shot); Apply makes it the shot's active take, Reject marks the take. The take's parent and the
  decision name every context picture (`options.context`: number, take and frame, file, Cast version, crop, label), the
  lock and the rating follow every context take (SNAP-R27, R39), and a Cast picture pins its version (SNAP-R60). What it
  runs is registry data (slot `view`, method `moss_view`, SNAP-R13/R14). *Why:* Dylan 2026-11-05: "a location is one
  topology… every view of it is an edit from prior context", "moss is WAY better than klein", "when snap cant do the job
  that means you need to update snap"; short03's three different gates (F-C09). *More:* PLAN U101, LESSONS "U101".
- **SNAP-R72: Picture 1 sets the camera, and the order is the person's.** MOSS Image Edit keeps the first picture's
  framing and composition: short03's test with the aerial master first gave the aerial view in every seed, with one
  figure pasted in. So the tray and the tool keep the pictures in the order given, say "Picture 1 sets the camera" next
  to it, and let the person move each picture up or down, take it out, or add a marked region of a still as a crop (a
  part of a master: the gatehouse). Put a picture that already has the wanted camera first and the set after it. The
  encoder sees each picture after a "Picture N:" marker, so prompts may name them that way. How strongly Picture 1
  holds depends on the model: MOSS's akhaliq LoRA copies it (camera, people, objects), chinoll follows the words more
  and moved the camera into the square (U101 C2 test, 30 stills). *Why:* the coordinator's 13:4x note from short03's
  sheet; the U101 C2 test. *More:* PLAN U101, the dogfood study's F-C09, LESSONS "U101".
- **SNAP-R73: Audio references are the pictures' twins.** An audio file goes into References as a Load Audio node wired
  into H3 References' next free `ref_audios` slot (3), and the prompt cites it as `<Audio n>`, n its place among the wired
  audio slots (`describe_recipe.references` lists every `<Picture n>` and `<Audio n>`). A Cast may hold one voice
  reference (`voice {file, casting}`: a clean 3-6 s line and the casting words it was made from); `apply_cast` puts it
  in with the Cast's pictures and says its `<Audio n>`, and a version without one takes the last apply's out. Agents
  add or remove audio by tool (`add_audio_ref`, `remove_audio_ref`). *Why:* F-C07: a cut could not cite a voice through
  Snap at all; Dylan 2026-11-05: characters get voice references for timbre, cited in every cut where they speak.
  *More:* PLAN U101, the dogfood study's F-C07.
- **SNAP-R74: Load Audio lists Snap's audio under input/snap/.** Core Load Audio lists only input/'s top level, so a file
  uploaded with `subfolder=snap` (as AGENT_START says) never showed. The pack's `/mainodes/snap/input_audio` lists the
  audio under input/snap/ and the page adds it to Load Audio's choices; the node's own validation already accepts any
  input file. Snap's audio tools put the file on the node's widget whatever its folder. *Why:* F-C08. *More:* PLAN
  U101.
- **SNAP-R75: The new view's model is the person's pick.** The view slot holds more than one model as registry data
  (`moss_view`: MOSS Image Edit with its edit LoRAs; `ph3_view`: PrunaAI's P-H3-Image on core `PH3ImageConditioning`,
  an edit of Picture 1 with the rest as references, 8 steps, no negative). The tray's model menu and the tool's
  `method` choose; each model's own choices show only with it (MOSS's LoRA menu). Snap does not pick a default for the
  person between them from one test: the comparison is shown and the person calls it. *Why:* Dylan 2026-11-05 14:0x,
  after the MOSS C2 results: P-H3-Image is the strong H3-based edit he meant. *More:* PLAN U101, U17.

## Accounts and the gate (snap-gate)

IDs R40+ were reserved for the gate while R28-R39 were open for other work (renumber at merge only if they collide). R50-R55 and R58-R66 went to the pack; the gate has R56 and R57. New rules from either side take the next free ID (R67-R70 are reserved for the Book; R76 on).

- **SNAP-R40: The org layer is a wrapper, never core.** `snap_gate/gate.py` is a separate service on the port people
  use; an unmodified ComfyUI listens on 127.0.0.1 behind it (with `--multi-user`), and the gate speaks only HTTP and
  WebSocket to it. Off (`--disabled`) it relays every byte unchanged: no sign-in, no filtering, ComfyUI as it is.
  Limits (ratings, buckets, admin-only routes) exist only when an install turns the gate on; Snap itself never limits
  the person (Dylan, 2026-11-04 16:46: no artificial limits in Snap). *Why:* core and the pack keep updating; product
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
  that names nothing on disk is left alone. *Why:* Dylan, 2026-11-04 20:41: "non-admins load models only in their scope
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
  anything in it), and a mask upload can't start from it. The admin sees all of it. *Why:* Dylan, 2026-11-04 20:41:
  "input/ is per account; admin has access to all". *More:* PLAN U83.
