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

- **SNAP-R25: Onboarding proposes; it never downloads.** "I'm new, help me set up" asks at most five things, each with a
  default and Skip: what to make, look through the models, metadata in outputs (it sets the SNAP-R20 switch), SFW only,
  and which tasks may use API models (none by default). Hardware is read from `/system_stats`, never asked. It opens by itself once, on the first Snap visit with no
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

## Agents

- **SNAP-R15: Every UI action has an agent tool.** MCP and WebMCP are built from one table. Results carry the same
  warnings the UI shows. *More:* LESSONS "Agents, WebMCP, tools".
- **SNAP-R16: GPU-spending tools wait as proposals** unless the person turns on "Let agents run". (Not gated:
  `find_people` and `take_frames`, which render nothing: a few seconds of detection or frame reading.) Each one states its
  plan first: what it would run and about how long, in seconds from measured takes (or the study it came from), shown
  with the proposal and returned with the run (plan-then-approve, UX_GEMS #5). The bridge never strands the person's
  tab; it calls the newest tab that is still connected.
- **SNAP-R17: Keep person and agent labels apart** (`by: person|agent`) on notes, judgments and takes. The data trains
  a judge model.
- **SNAP-R19: The tool table is the API.** Snap's own UI, agents (MCP/WebMCP) and a future form-based editor layer
  drive the same operations through one table. Engine and tool logic stay free of Snap-view DOM concerns; a UI action
  calls the same function its tool calls, never a private path. *More:* CONCEPT.md "Layers".

## Data and privacy

- **SNAP-R18: Local only.** No network or telemetry: registry, takes, profile and model graph are local files. Export
  happens only when the person asks. Model downloads run only when the person asks, in the agent's own tools, never
  from ComfyUI core.
- **SNAP-R20: Metadata in saved files is the person's switch; private takes are marked.** Saved pictures and videos
  keep their prompt and workflow by default, as core saves them. "Save metadata", the switch right before Run (a ComfyUI
  user setting, `MAINodes.Snap.SaveMetadata`, remembered per user), turns that off: every prompt the page queues then
  carries `extra.snap_metadata: false` in its workflow, and the server swaps core's Save Image / Preview Image / Save
  Video for twins that write no prompt or workflow, and refuses, before anything runs, any other node that would write
  them. No warning chip. A take is private when any node of its prompt loads a file the model graph gives role
  `identity` or tags `private`, whose real path (symlinks followed) is under one of the person's private paths or
  matches one of their private patterns (user `snap/private.json`, local, never in the pack and never read by the
  page), or when Snap's Cast brick has a LoRA row on; it is NSFW when it loads a file tagged `nsfw`. Reasons name nodes,
  never files. The take card shows a lock, and the export leaves private and NSFW takes out unless asked
  (`--include-private`, `--include-nsfw`). A person's model graph or private.json that doesn't parse makes every prompt
  private. *Why:* core writes the executed prompt and workflow, LoRA file names included, into every PNG and mp4, and
  `--disable-metadata` is global; Dylan chose metadata on for everything with one clean switch (2026-11-04) over
  stripping private takes automatically. *More:* `snap_privacy.py`, `snap_bridge.py`, `web/snap/metadata.js`; PLAN U22, U58.
- **SNAP-R27: A file stamped private in its own header is private, and locks follow the current rules.** Besides the
  model graph and the person's private paths and patterns, a `.safetensors` file whose header metadata says
  `"privacy": "full"` (at the top level or inside a JSON-string field such as `lorastery_recipe`, parsed once) is private,
  and so is one whose `trigger` / `trigger_word` matches one of the person's private patterns: a trigger names who the
  LoRA draws, a re-train keeps it whatever the file is called, and an over-match only costs an export row on the
  person's own machine. Only the header is read (8-byte length, capped at 16 MB), cached per real path by mtime and size;
  an unreadable or non-safetensors file is simply not stamped, never an error in the save gate. Patterns also match the
  value's folder part (a symlinked folder named like a pattern). The lock follows today's rules, not only the mark saved
  at queue time: `/mainodes/snap/take_marks` re-checks the saved takes (booleans, never file names) and
  `/mainodes/snap/private_loras` names the LoRA files the rules match, so LoRA rows in the sheet, the stack faces, the
  + LoRA picker and `list_loras` carry a lock. A version of a private take (an edit, a continued take) is private too,
  in the lock and the export, so a private take can be edited like any other. Marking only: nothing is hidden, gated or
  re-run, and the row still works (Dylan, 2026-11-04: "my machine isn't going to be the private one"; "dont artificially
  limit anything please thats for the end user to do what they decide"). *Why:* derived LoRAs that a name rule missed
  had neutral names in a neutral folder and were caught only by their stamp (U68). *More:* U68_PRIVACY_AUDIT_2026-11-04.md
  "Matcher gaps", PLAN U71, `snap_privacy.py`, `snap_bridge.py`.

## Accounts and the gate (snap-gate)

IDs R40+ were reserved for the gate while R28-R39 were open for other work (renumber at merge only if they collide). R50-R55 went to the pack (claude/snap-scout), so the gate continues at R56.

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
  Cross-site posts are 403. *Why:* rating by hand-editing JSON is how a kid ends up seeing an unrated file or nothing
  new at all. *More:* PLAN U65, U77 (6).
- **SNAP-R56: An output keeps the rating of the prompt that wrote it, and nobody sees above their cap.** The pack rates
  every prompt when it is queued (`extra_data.snap_marks.rating`, server-side; the pack's SNAP-R39). The gate learns
  each run's rating and the files it wrote from ComfyUI's history (whenever it reads it, and when a run's
  `execution_success` passes an open page) and keeps them in its own `outputs.json`, so a rating outlives ComfyUI's
  history. A non-admin never gets a run or a file rated above their cap: `/view` is 404 (in output/shared/ and in their
  own folder alike), and `/history`, `/history/<id>`, `/api/jobs` and `/api/jobs/<id>` leave the run out. A file in
  output/shared/ that no run wrote (put there by hand) counts as Adult (SNAP-R44). Core's assets API (`/api/assets`,
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
