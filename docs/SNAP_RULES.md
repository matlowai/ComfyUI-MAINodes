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
  opens a new tab. In a scene tab, opening another shot saves the open one into its scene first (SNAP-R24). *More:*
  LESSONS "Start/new".
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
  chip. *More:* MODEL_GRAPH_ONBOARDING §2.
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
  (`set_lora_category` is the same function). Identity LoRAs are private by default: never exported or
  shown on shared pages. *More:* MODEL_GRAPH_ONBOARDING §6.
- **SNAP-R26: A LoRA's name files it as a turbo only on a strong signal.** The model graph says first; with no entry,
  a name counts only with a sampling step count (16 or fewer, no digits after: `8step`, `4_steps`) or a distillation
  method as its own word (dmd, pdmd, dmd2, dmad, lightx2v, lcm, causvid). "turbo" inside a name and training step counts
  (`step1500`, `5000steps`) are not signals; such a LoRA is unsorted until someone files it. *Why:* concept LoRAs
  trained on a turbo model (`<concept>-krea-turbo`, an ai-toolkit run of 2500 steps) and training checkpoints
  (`..._v01_step1500`) showed as core·turbo on the live server (PLAN U67).
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
  `hair_check.lighter`, U56b). An edit whose method `does` something in `identity_check.unreliable_for` (relighting:
  the same woman scores 0.34-0.60 at night) shows its cosine as "face check unreliable under relighting" and never the
  different-person flag. Both miss things (dark frames and profiles score low, blonder hair doesn't show), so the
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
  setups appear only for tasks the person allowed. SFW only hides files, dials, LoRAs and Library cards the model graph
  tags `nsfw` from pickers and agent tools; it's a preference filter on the person's own tags, and the UI says so.
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
  (the comfy-user header snap-gate sets per account): a call goes to the newest connected page of the caller's own user,
  and only that page may answer it. `GET /mainodes/snap/tools` lists the caller's open pages, when each registered and
  last answered; with none open, a call says how to open one (`tools/snap_agent_page.sh <port>`, which uses a new
  Chrome profile per launch, returns once the page has registered, starts nothing when a page is already open, and
  with `--stop` ends the pages it started, with no pid or kill from the caller). `start_recipe` takes an onboarding
  kit's `intent` (stills opens MOSS-Image), and `set_profile {done: true}` answers every question (U72 run 3, F12-F14).
  `snap_mcp.py` and `snapcall.py` take a base URL and send `SNAP_TOKEN` as a Bearer header. An agent's call with an
  unknown or missing argument is refused, and every tool error names the arguments the tool takes (the U44 contract).
  `get_profile` says whether agents may run and see, and `set_agent_permissions` sets what the person said, live. `run`
  returns its run id; `run_status` gives each run's state (queued, running, done, failed), its take and output paths,
  and waits up to 25 s (`wait_s`; a call ends after 30 s). A recipe opens runnable: an optional brick whose own check
  fails (Upscale without RelayVSR) and a LoRA stack with no file start off, a brick that is off says so and why in
  `describe_recipe`, and a kit lists add-ons the recipe runs without under `optional`, apart from its files. Video
  lengths read as frames and seconds at the recipe's fps, and `set_setting` takes `"5s"`, rounds to the model's frame
  grid and says what it became. `describe_recipe` carries the model's `prompt_help` (H3's sections; name the sounds the
  action makes). A headless page's screenshot says to use take_frames. The embedder sidecar's port follows ComfyUI's
  (port + 230; 8188 keeps 8418). *Why:* U72 run 1 (Sonnet at low effort): grepping JS for a setting id, a stale Chrome
  lock, a "ready" kit whose recipe wasn't, polling a run that never said done, guessing fps, `undefined has no seed`;
  Dylan: "once sonnet low is smooth I'll call it good". *More:* u72/FINDINGS.md F1-F10, PLAN U75, `snap_bridge.py`,
  `web/snap/tools.js`, `tools/`.
- **SNAP-R31: A brick's title names it in every family.** Tools take a brick's id or the title it shows: `render`
  is the stills recipe's `image` brick, `models` its `image_models`, `save` its `save_image`. A brick that isn't in the
  recipe is refused with the recipe's brick ids. `run` warns, and still runs, while a prompt holds its blueprint's
  default text. *Why:* U72 run 2 (Sonnet at low effort): AGENT_START's `render` failed on the stills recipe, the agent
  pressed run anyway and got the example picture. *More:* u72/FINDINGS.md F11, `web/snap/tools.js`.
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
  it runs. Core would otherwise run the prompt's other outputs. A saver named Save… with no filename_prefix (SaveLoRA)
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
  admin is offered them, because only the admin's ratings count (SNAP-R32). The pack rates only the obvious: the base
  and SFT checkpoints are PG, everything else is left unrated. *Why:* PLAN U77 (6). *More:* `web/snap/models.js`
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
  carry a lock. A version of a private take (an edit, a continued take) is private too, in the lock and the export, so a
  private take can be edited like any other. Marking only: nothing is hidden, gated or re-run, and the row still works
  (Dylan, 2026-11-04: "my machine isn't going to be the private one"; "dont artificially limit anything please thats
  for the end user to do what they decide"). *Why:* derived LoRAs with neutral names in a neutral folder were caught
  only by their stamp (U68). *More:* U68_PRIVACY_AUDIT_2026-11-04.md "Matcher gaps", PLAN U71, `snap_privacy.py`,
  `snap_bridge.py`.
