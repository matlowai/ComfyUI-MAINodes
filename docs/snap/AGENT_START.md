# Snap for agents: start here

Snap is the full-screen view of the MAINodes pack in ComfyUI. An agent drives it with tools. The tools run inside an
open Snap page, and you reach them through that page. Snap never downloads anything by itself.

How Snap's pieces link and how to make things well with these tools (the order of work, which model for which job,
traps and quality bars) is in the Snap skills, `.claude/skills/<name>/SKILL.md` in the pack (also `list_skills` /
`read_skill`, which give the person's version when they have one): `snap-core` first, then `snap-location`,
`snap-turnaround`, `snap-new-view`, `snap-reference-upscale`, `snap-boards`, `snap-voice`, `snap-critic`,
`snap-model-choice` and `snap-book` (a production in the Book). The rules Snap follows are in [`SNAP_RULES.md`](SNAP_RULES.md).

Below, `$BASE` is the ComfyUI address (for example `http://127.0.0.1:8188`) and `$PACK` is
`<ComfyUI>/custom_nodes/ComfyUI-MAINodes`. On a signed-in install (snap-gate), `$BASE` is the gate's address. There you
`export SNAP_TOKEN=<your account token>`, which every tool below sends as a Bearer header.

## 0. Find this server's Snap

    curl -s $BASE/mainodes/snap/info

It returns `pack` (use it as `$PACK` below: `tools/snap_agent_page.sh` and `tools/snapcall.py` are in it), `input`
(this server's input folder: pictures you name must be there), `output`, `base`, and `code` (the Snap code the server
serves). A machine can hold several ComfyUI installs: trust this answer, not a folder you found by searching.
`docs` gives where this file, the rules and the skills folder are, and `skills` lists every Snap skill (name,
description, file, bytes); `GET $BASE/mainodes/snap/skills?name=snap-core` returns one whole, with no page open (`skill_read` says so).

## 1. Open a Snap page

You drive the person's main tab (SNAP-R83): their own tab once they press "Let agents see" in Snap's top bar, or the
agents' window, one visible Chrome on this machine that agents attach to, reload and restart. Never a headless page, and
never another tab without the person's yes.

    bash $PACK/tools/snap_agent_page.sh $BASE            # start: attach to the agents' window, or open it if nothing runs
    bash $PACK/tools/snap_agent_page.sh $BASE status     # whether it runs, its DevTools port, its tabs
    bash $PACK/tools/snap_agent_page.sh $BASE reload     # reload its Snap tab, e.g. after the ComfyUI restarted

- The agents' window is ONE Chrome (profile `~/.config/snap-agent-chrome`, DevTools on 127.0.0.1:9222). Whatever
  answers on 9222 is it: the script attaches and never starts a second one. It opens it only when nothing answers there,
  and only on a display (it never runs headless). Its tab counts as a tab that sees: your calls go there by default,
  `screenshot` works at once, and the page names it "agents' window".
- The `chrome` tool does the same from any client, even when no Snap page answers: `{"action": "status"}`,
  `{"action": "reload"}` (after a server restart or an update: it waits until the tab is current again), `{"action":
  "start"}`, `{"action": "restart"}` (closes every process of its profile, then opens it again). Reload it yourself
  when it runs older code; you don't wait on the person.
- The window opens no tab by itself on a ComfyUI it has none on. Another tab is the person's call: ask, then
  `snap_agent_page.sh $BASE new --asked`.
- Parallel work that doesn't contend with the person's (e.g. GPU checks on a second server while 9222 serves theirs) may
  use an extra window for that server only: `snap_agent_page.sh $BASE start --extra "<purpose>"` (its own profile and
  port, the purpose as its window name; refused when 9222 already has a tab on that server). Close it with `stop --extra
  "<purpose>"` when the work ends.
- On a signed-in install, give the sign-in link as the page:
  `bash $PACK/tools/snap_agent_page.sh $BASE "$BASE/gate/login?token=$SNAP_TOKEN&next=/%3Fsnap"`

**Pick your page, and name yourself.** Several people's tabs and agents' pages can be open on one ComfyUI; choose the
one you work in so you never collide:
- `list_pages` (or `python3 $PACK/tools/snapcall.py $BASE pages`) lists every page of yours: `id`, `name` (whose it
  is, the id's first six characters, the tab or shot it shows), `managed` (the agents' window), `headless`, `sees` (its
  person lets agents see and drive it), `driven_by`, `yours`, and `calls_go_here`.
- `use_page {"page": "<id, the start of one, or a name>"}` binds you to that page for your session: every call goes
  there until you pick another or pass `null`. With snapcall, name yourself once and bind with `--page`:
  `SNAP_AGENT=my-studio python3 $PACK/tools/snapcall.py $BASE --page 3f9a2c get_profile`; later calls with the same
  SNAP_AGENT keep going there. snap_mcp.py names each connection itself (or SNAP_AGENT).
- One agent drives a page at a time. The page shows "Driven by: <you>" with a Release button for its person. A page
  another agent drives is refused with its name: pick another, or ask the person. If the person presses Release, your
  next call says so; pick a page again.
- **Let go when your job ends** (SNAP-R135): `use_page {"page": null}` (snapcall: `use_page '{"page": null}'`). A
  finished agent that keeps its hold leaves the page "Driven by" it. snap_mcp.py lets go when its connection closes; a
  hold with no call for 10 minutes lapses by itself, the chip shows "idle n min" before that, and your next call says
  it lapsed and names the `use_page` call that takes the page back. A long read is not idle (SNAP-R146): while you hold
  a critique you claimed (each `critique_packet` renews the claim) or a run of yours is queued or running, the hold
  stays; `list_pages` says `driver_busy`. So claim first, then read. Every call must carry your name (SNAP_AGENT / X-Snap-Agent): an unnamed call on a driven page is refused
  and says it carries no name.
- With nothing picked, calls go to the newest tab that sees: the agents' window, or a tab whose person turned "Let
  agents see" on. While a person's tab is open with the control off, a call is refused (it says how to get a page); it
  never goes to another page instead. `SNAP_PAGE=<id>` (or the `X-Snap-Page` header) sends one call to a page without
  binding. Every answer names its page under `page` (`id`, `name`, `driven_by`).
If it says the page runs older Snap code (`page_warning`, or an "Unknown Snap tool" error that says so): on the agents'
window, reload it yourself (`chrome {"action": "reload"}`); on a person's own tab, never reload or close it yourself:
`request_reload {page}` shows a "Snap was updated: reload to get the new tools" bar on it with your name (the tab shows
it by itself after an update too), and the person presses Reload. Run `curl -s $BASE/mainodes/snap/tools` to see
your open pages under `pages`, with when each registered and when it last answered. When no page is open, every call
says how to start one.

## 2. Call tools

    curl -s $BASE/mainodes/snap/tools                       # names, descriptions, argument schemas, your open pages
    python3 $PACK/tools/snapcall.py $BASE get_profile        # one call; pictures go to a new folder under <temp>/snapcall-pictures/ (saved_in), paths printed
    python3 $PACK/tools/snapcall.py $BASE run_status '{"wait_s": 25}'

Every call carries an `Idempotency-Key` (SNAP-R159): snapcall and snap_mcp make one per call and retry a bridge timeout
or a dropped connection with it, and the bridge answers the first call's answer (`replayed: true`) instead of running it
twice. snapcall prints the key (`idempotency_key`); to retry a whole command, run it again with
`SNAP_IDEMPOTENCY_KEY=<that key>`. With curl, send your own `-H 'Idempotency-Key: <one per call>'`.

You can also run the tools as an MCP server (Claude Code):

    claude mcp add comfy-snap -- python3 $PACK/tools/snap_mcp.py --base-url $BASE

- A call ends after 30 s. Long work, such as a render, returns at once, and you follow it as described in step 4.
- A wrong or missing argument is refused, and every error names the arguments the tool takes. Read the error and call
  again.
- Call `describe_recipe` before you change a recipe, and read its `revision`, `about` and `prompt_help`. A brick with
  `on: false` is off, its values are not used, and `off` says why.

### Agent instructions (read them, follow them, keep them current)

Every call runs under a resolved stack of notes (SNAP-R93): the pack's, an install's shared ones, and the person's own,
nested pack → install → person → book → scene → shot → take. Read the whole stack before you act:

    instructions {}                                   # the open recipe: also describe_recipe.instructions
    instructions {"scope": "tool:edit_from_context"}  # before a tool; or brick:render, shot:<scene>/<shot>, take:<id>, cast:<id>
    list_instructions {}                              # every note, each layer, with status (active, off, overridden, archived)

- Each row has `ref`, `layer`, `scope`, `kind` (`note` text, or `model_choice`: job, choice, why), `by`, `source` and
  `rule`. `overridden` lists notes another replaced; `conflicts` are two model choices for one job at one level: ask
  the person or take the newer. `off` notes are ones the person turned off: don't follow them, even when a tool's
  description (which ends with the pack's notes for it) still says them.
- When the person tells you a preference ("use Fizgig for characters here", "always side by side"), save it:
  `save_instruction {"scope": "global", "text": "..."}`, or `{"scope": "tool:edit_from_context", "kind":
  "model_choice", "job": "...", "choice": "...", "why": "..."}`, with `source {"quote": "<their words, typos fixed>"}`.
  "Change that" means a new version of their note: `save_instruction {"id": "instruction:<id>", "text": "..."}`.
  Change a pack note with a note that replaces it (`"mode": "replace", "supersedes": ["pack:<id>"]`).
- What you write applies at once and shows as "new from <you>" in the person's Agent library (SNAP-R95). Your own
  notes go off with `set_instruction_status {"ref", "status": "off"}`; turning off the person's or the pack's waits as
  a proposal.
- `get_take.instructions` says what a take ran under (`ran`), what applies now (`now`), `same`, and `diff` (added,
  removed, changed with both texts, turned_off, turned_on): read it when a take went wrong.
- Skills: `list_skills`, `read_skill {"name": "snap-core"}` (whole; `file` for a file beside it); fold what you learned
  about using Snap into a skill with `save_skill {"name", "markdown"}` (the whole file), not into your own notes.
- Outside a Snap session, `bash $PACK/tools/snap_skills.sh link` puts the pack's skills into `~/.claude/skills/` for
  Claude Code (`unlink`, `status`); the files stay the pack's, the person's versions are served by `read_skill`.

## 3. Set up with the person

1. `get_profile` returns the person's answers, the hardware and `agents`. `agents.run` says whether your runs start
   right away; `agents.see` says whether `screenshot` can see their tab. On a signed-in install, `account` names the
   account and its rating cap; below Adult, don't ask about SFW only.
2. Ask the person the onboarding questions: what they want to make, SFW only, metadata in files, which tasks may use
   API models, and whether you should read new code first. Save the answers with `set_profile`. Never decide these
   for them.
3. If the person says agents may run renders without asking, call `set_agent_permissions {"run": true}`. It applies
   right away, with no reload. Otherwise `run`, `preview` and `make_dial` wait as proposals the person accepts.
   `{"see": true}` shares their tab with `screenshot`, but only after they press "Let agents see" in Snap's top bar.
   In the agents' window (`snap_agent_page.sh`) `screenshot` works at once, no press needed: use it to check what the
   person sees (the Work card, a take's chip).
4. `scan_models` and `list_kits` show what is ready and what is missing.
5. `propose_downloads` gives exact files, sizes, target folders and commands.
   - Add-ons the recipe runs without are listed apart under `optional`, with their size and how to install them.
     RelayVSR for the Upscale brick is one; offer these as optional.
   - A file with no public download is under `optional` too ("no public download: bring your own file"): ask the
     person whether they have it, and go on without it if not.
   - Each file needs the person's yes, and then you run the command (safetensors only).
   - A pack's `review` follows the person's code-review setting.
6. Unsorted LoRAs (`list_loras {"role": "unsorted"}`): read each with `describe_lora` and file it with
   `set_lora_category {"file": ..., "role": ..., "by": "agent", "reason": "<what in its metadata says so>"}`; the person
   can re-file any of them, and their filing wins. A name alone says a kind only with a step count (`4step`).

## 4. Render

1. `start_recipe` (video), `start_recipe {"intent": "stills"}` (pictures: an onboarding kit's recommended setup) or
   `apply_setup` (any setup from `list_setups`). They open a **new workflow tab** when the open one has work in it, and
   every later call acts on that new tab. So call them first, and then set the prompt and settings.
   - The video recipe starts as text to video: First frame stays off until it gets a picture (`use_take`, or
     `set_setting` on `first_frame`). A first frame and references combine: when the setup reads references (Ref2V,
     which reads no first frame), the First frame's picture is also `<Picture 1>` in References, the opening frame,
     ahead of the rest (SNAP-R115); the answers say so. A walkthrough's camera height comes from its first frame, never
     from words: start it from an eye-level still (skill `snap-location`). There is no last frame yet: core's H3 node
     takes one, but the pack's H3 setups don't wire it, and `use_take {as: "last_frame"}` says so (F-F20); end on a
     picture by citing it as a reference ("the shot ends on <Picture 2>").
   - Upscale starts off when RelayVSR isn't installed, and on when it is: `open_shot` on a new shot says so
     (`upscale`); switch it off (`set_method {"slot": "upscale", "method": "off"}`) for a walkthrough, a plate or a
     draft (F-G09).
   - **Pika at 6 steps is the quality standard** (SNAP-R149): video takes run on a Pika setup at its 6 steps. The
     "no turbo (20 steps)" presets that Turbo off puts on are opt-in, not a quality step up (20 and 30 steps drifted
     off the plate and the Cast); never reach for them to improve a take. Voice references take 12+ steps (below).
2. Set the prompt: `set_setting {"brick": "render", "name": "prompt", "value": "..."}`.
   - `render` names the recipe's Render in every family (the stills recipe's brick id is `image`). Titles such as
     `save`, `models` and `upscale` work the same way. A brick that isn't there is refused with the recipe's brick ids.
   - For H3 video, write the three sections, each on its own line:
     - `integrated_multimodal_description:` starts with `[Shot 1]`, then what we see: shot size, light, who does what
       and how the camera moves. `<Picture 1>` and so on name the reference pictures.
     - `overall_soundscape:` names the specific sounds the action makes (paws pattering on grass, a door slamming, a
       short bark), then a short ambience tail. Don't lead with soft, gentle, faint or distant: an ambience-only
       soundscape comes out near-silent. Keep them diegetic and subtle: no stings, "tada" hits, clash bursts or
       game-style effects (SNAP-R150: they sink a take).
     - `non_diegetic_music:` `N/A`. Music is a reference input the production supplies (`<Audio n>`, held across
       cuts), never generated per take (SNAP-R151); sound effects come after picture lock.
   - For stills, write two or three concrete sentences.
   - `describe_recipe` → `prompt_help` repeats this for the open recipe.
3. Set the length in frames or seconds: `set_setting {"brick": "render", "name": "length", "value": "5s"}`. Seconds
   round to the nearest frame count the model takes (H3 at 24 fps: 17n + 5 frames), and the answer says what the
   length became. `describe_recipe` shows the seconds next to the frames.
4. `new_seed` draws a new seed for the Render. You can name another brick with `brick`. The seed's setting is
   `noise_seed` on the video Render (`render`) and on the stills Render (`image`); `describe_recipe` lists each brick's
   settings by name. A run with the same recipe and seed as an earlier take answers `cache_hit`: ComfyUI hands back that
   take's file, not a new render.
5. `run {"question": "does the jacket hold through the turn?"}` returns `run`, the run's id (always; a refusal is an
   error that says why). The question is what the person reads on the Work card; leave it out and it reads "Run <tab>".
   A `warning` says when the prompt is still the recipe's default text: the run still goes, so set the prompt first.
6. Call `wait_for {"job": "<id>", "until": "done"}` (or `run_status {"run": "<id>", "wait_s": 25}`) again until it is
   done or failed: each call waits up to 25 s, and `reached` says whether it got there. The state goes `queued` →
   `running` → `done` / `failed`. When the run is done, `run_status` gives the take id and the output files
   (`path` on the ComfyUI machine, and `url`). `metadata_kept` names nodes that wrote the prompt into their files
   although Save metadata was off: tell the person.
7. `list_takes`, `take_frames` (look at a take) and `rank_takes` / `judge_takes` (your own judgments, kept apart from
   the person's) come after that. Judge a video take with its sound on (SNAP-R150): an options page plays the takes
   with sound, and a recommendation says what the audio does. Snap notes a take whose sound is quiet (mean below about -45 dB): its `sound.quiet` is
   true. Then tell the person, and offer `make_louder` (a louder version of the take) or a prompt that names the sounds
   the action makes. With no note the level is normal (our good takes are about -25 to -45 dB): don't re-render for it.
8. To make a take longer, call `edit_take {"take": "<id>", "method": "chain", "clips": 2}`. Standard (`chain`) holds the
   colour; `geiru` (Strong) keeps the look but may reset the action. Each clip adds about 4.25 s, and the longer take
   lands as a version of the take.
9. To make a take bigger, see "Making a take bigger" below (`upscale_take`).

### Takes kept encrypted (installs with privacy on, SNAP-R96..R100)

Where privacy is on, a private take is saved encrypted with its recipe inside. `list_takes` and `get_take` mark it
`kept_encrypted: true`; you read it like any take (`take_frames`, `get_take`, reuse in `edit_take` / `use_take`) while
its person is signed in. With `locked: true` the vault is locked: the take is listed, but its prompt, notes and frames
are not readable (`take_frames` says why), and a run that reads it is refused at queue naming the vault. Don't retry:
tell the person to sign in (or click the take's lock to unlock). You never unlock it yourself, and you never ask for or
hold the passphrase. `export_records` leaves such takes encrypted unless the person asks to include them
(`decrypt_private: true`). Pictures `take_frames` gave you of such a take are yours to keep private or remove.
A run refused with "no vault key yet" means the person has no vault key: ask them to open the lock sheet (the lock on
a take, or sign in again behind snap-gate) and set one up; never work around it (no other saver, no privacy switch).

### Making a take bigger (stage 2, Tessera)

A reference is redrawn, never only sharpened (SNAP-R85): a Cast picture, a turnaround, a location's master or plate,
settei. `get_take` says a take's `purpose` and how it is known (set with `set_purpose`, from what made it, or from the
Cast or location that uses its frame); `upscale_take` on a reference answers `why` it redraws. Stage 2 redraws stills
too (a New view or sheet still: its own graph at the new size, starting from the still at `denoise`).

H3 renders at about 0.85 MP, and the VAE's compression smears small faces. `upscale_take` makes an existing take
bigger and lands the result as a new take whose parent is the take (SNAP-R81, R82; `list_methods {"slot": "upscale"}`
lists them as `kind: take`):

    upscale_take {"take": "<id>", "method": "stage2", "factor": 2, "denoise": 0.3}
    upscale_take {"take": "<id>", "method": "tessera", "factor": 4}

- `stage2` (the default): the take's own recipe (model, LoRAs, words, references, seed) runs again from its own
  frames, upscaled with Lanczos (or `upscaler`, a pixel model such as `2x-AnimeSharpV4_RCAN.safetensors`, first),
  VAE-encoded at the size and sampled from `denoise` on its own schedule; the sound is kept. H3 takes only. On the
  short03 orbit (832x1024, 5 s) the 2K pass took 15-19 min on a 5090 (d0.25 / 0.30 / 0.35) and drew the face again
  while hilt, scabbard, straps and braid held; 0.25-0.35 looked alike, so keep 0.3 unless the person asks.
  A 2K pass at cfg 5 fills a 32 GB card. `"speed": "fast"` samples at cfg 1 (SNAP-R113): 10.4 min instead of 17.9 on
  that orbit, a touch softer; quality (the take's own cfg) is the default, so use fast for drafts or when asked.
- `h3_latent`: the same from the take's latent made bigger by a latent model (`upscaler`, default the H3 3D-conv one).
- `tessera` (needs the ComfyUI-Tessera pack; its streamed decode writes ~10 GB of buffers at 4K x 124 frames to
  `TESSERA_SCRATCH`, else the system temp, so point that at a big disk): about 1 MP tiles on Ref2VA, the take as <Video 1>, a first-frame still
  as <Picture 1> (default: the take's newest stage 2's frame 0, so run `stage2` first; `anchor: "none"` uses the take's
  own frame 0) and a hero tile on `hero` (default "face"). On the same orbit, 4K took 33 min and carried the stage 2
  face up to 4K without seams; it skips near-empty backdrop tiles (`flat_skip` 8: at Tessera's own 4 those tiles grew
  ghost figures). Look at whole frames at several angles for anything new in the backdrop.
- Size: `factor`, or `width` and/or `height` (the other keeps the shape); multiples of 32.
- It answers at once with the run id and the take it lands as; follow it with `wait_for {job: <prompt_id>}`. It uses
  GPU time, so it waits as a proposal unless the person lets agents run.
- Look at the result at 100 % (`take_frames`) before saying it is better: the face against the Cast's picture, the
  carried props (hilt, scabbard, straps) and the braid against the original, the backdrop for anything new. RelayVSR
  (`set_method upscale`, inside a new render) sharpens the same drawing; stage 2 draws the face again.

## 5. Characters, versions and re-takes

A character lives once, on a Cast record: name, trigger words, a details line, an identity LoRA (optional) and
reference pictures. Every save of a record is a new version; old versions stay. Recipes and takes pin the version
they used (`cast:<id>@2`).

1. Put the picture into this server's input folder first (works on a signed-in install too, with your Bearer header):
   `curl -s -F image=@front.png -F subfolder=snap $BASE/upload/image` answers `{"name": ..., "subfolder": "snap"}`: the
   file is then `snap/<name>`. A file already there is fine: `curl -s "$BASE/mainodes/snap/info?input=snap/front.png"`
   says `input_exists`.
2. Make one: `save_cast {"name": "Kon", "trigger": "kon_fennec", "details": "a fennec-eared courier girl, teal hoodie",
   "lora": {"file": "<an identity LoRA from list_loras>", "strength": 0.8}, "refs": [{"file": "<input picture>",
   "role": "identity: front"}]}`. Without a LoRA, give `"lora": null`. A take's frame becomes a picture with
   `use_take {"take": ..., "as": "reference"}` (its file is in References).
3. Put it in the recipe: `apply_cast {"cast": "cast:<id>"}`. The Cast row, the details sentence and the pictures go in;
   `describe_recipe` → `world` shows `n` (the version the recipe holds).
4. Render as usual (`run`, `run_status`).
5. Change the character: `save_cast` again with `"cast": "cast:<id>"` and only the fields that change (the rest is kept
   and `kept` names it, F-K02; null clears one; say what changed in `note`). Read one Cast with `get_cast {"cast":
   "cast:<id>"}` (or `@n` for a version). The recipe does not change by itself: `describe_recipe.world` says `moved: true`, and `list_takes` shows
   `stale.world` ("Kon v1 → v2").
6. Re-take: `retake {"take": "<id>", "world": "latest"}` updates each moved record first ("today's world");
   `"world": "pinned"` runs it exactly as it was. It spends GPU time, so it waits as a proposal unless agents may run.
   The new take is a version of the old one in `get_scene`. To update the open recipe without running, call
   `update_pins`.

Before you tell the person how a take looks, or that a look changed, look at it: `take_frames {"take": ...}`, and
compare the frames with the character's picture. A version number says what Snap put in, not what the model drew. If
`apply_cast` says the pictures are not read, or `describe_recipe` has `references_unused`, fix that first (a setup with
reference pictures); a take card that says "not all of it ran" names what didn't reach the render.

- Is the person in a take still the Cast? `check_identity {"take": "<id>", "cast": "cast:<id>"}` scores any take or
  still against the Cast's picture (a video's first, middle and last frame by default, `frames` for others; a list of
  Casts for a two-shot, each face matched to one Cast). It returns the lowest character score per Cast (DINOv3 on a
  head crop: the same character 0.55-0.94, below 0.45 "probably someone else"; ArcFace beside it, which drops near 0 on
  a profile or a bowed head) and each frame's face crops: look at the crops, the score only informs.
- What still uses an old version: `dependents {"ref": "cast:<id>"}` (or a location, `location:<id>`, or one version
  `@n`) lists the takes, stills and boards pinned to each version, with their scene and shot, and under `stale` the
  `rerun` arguments that re-make each on the newest version.
- References by hand: `add_ref {"file": "snap/<name>", "role": "back view"}` puts an input/ picture in (it answers its
  `<Picture n>`); `remove_ref {"picture": 3}` takes one out. `use_take` takes `frame` (a frame number) and `crop`: two
  frames or two parts of one take are two pictures.

### Locations (a place kept once)

A location is a record like a Cast (`location:<id>@n`, SNAP-R84): its **master** (the establishing picture), its
**plan** (the set plan or overhead map), **camera marks** on the plan and named **plates**, each a picture with its
camera pose and the take and frame it came from. Build a place as a plate set from one walkthrough (set plan with
cameras → master → a people-free walkthrough → plates from its frames), then cite plates by name in each shot.

    save_location {"name": "Village", "notes": "...", "master": {"take": "<id>"}, "plan": {"file": "snap/plan.png"},
                   "cameras": [{"name": "C1", "x": 0.11, "y": 0.78, "heading": 38, "eye_height": 1.6, "lens": 24}]}
    add_plate {"location": "location:<id>", "name": "Pb gate inside", "take": "<walkthrough>", "frame": 100,
               "pose": {"x": 0.64, "y": 0.52, "heading": 280, "eye_height": 1.6, "lens": 28}, "use": "C2, C4"}
    apply_location {"location": "location:<id>", "plates": ["Pb gate inside"], "camera": "Pb gate inside"}
                                                       # answers cite (master, plan, plates), use and prompt_hint
    save_location {"location": "location:<id>", "master": {"take": "<fixed>"}}   # a new master; the rest is kept (kept says what)
    add_plate {"location": "location:<id>", "name": "Pb gate inside", "pose": {"eye_height": 1.5}}   # one plate's pose; its picture and the rest kept
    add_plate {"location": "location:<id>", "name": "Pc N row", "camera": {"name": "Pc N", "x": 0.4, "y": 0.2, "heading": 0, "eye_height": 1.6}}
                                                       # a camera mark added (or moved, by name) with the plate (SNAP-R148)
    save_location {"location": "location:<id>", "scale": [{"name": "house door", "height_m": 2.0}, {"name": "gate door", "height_m": 3.7}]}
                                                       # scale anchors: the critic measures eye and wall heights against them (SNAP-R155)
    remove_plate {"location": "location:<id>", "name": "Parch"}   # a plate out; the others keep their from (F-K05)

- A pose's `x`, `y` are fractions of the plan picture from its top left; `heading` is degrees clockwise from the
  plan's up (north); `eye_height` in metres; `lens` in mm. `list_locations` gives every place whole;
  `get_record {"ref": "location:<id>@n"}` one version.
- H3 takes a reference picture as the shot's camera and copies its framing. Say which picture is the camera
  (`camera`: master or a plate) and the rest show the place; put the answer's `prompt_hint` in the prompt. Cite this
  cut's own place, never the next place's plate (it makes H3 hard-cut to it).
- `apply_location` puts the master, the plan (`master: false` / `plan: false` leave them out) and the plates named into
  References, each a `<Picture n>` (`cite`), and pins the version, so every take says which version of the place it
  used; `rerun` swaps it like a Cast. A New view cites a plate the same way: `{"location": "location:<id>", "plate":
  "Pb gate inside"}` (or `"master"`, `"plan"`) among its pictures.
- A place kept as a Cast (before location records) moves over with `cast_to_location {"cast": "cast:<id>"}`: its
  master and map become the location's master and plan; the Cast stays, and its takes stop showing "its description
  wasn't in the prompt". Those takes stay the location's dependents (SNAP-R147): `dependents` lists them (`via`), and
  their rerun swaps the Cast for the location (`{"cast:<id>": {"to": "location:<id>"}}`). A take a plate or the master
  came from that pins nothing has `rerun: null` (`by_hand` in rerun_dependents' plan): make it again in a shot that
  applies the location. `remove_from_world {"ref": "cast:<id>"}` takes any record out of the open recipe (its
  pictures, its line in the prompt, its pin; the record stays), as the x on its chip does.
- `open_view {"view": "location", "location": "location:<id>"}` opens the Location sheet for the person (switching
  their page to Snap if it shows the graph): the master, the plan with every camera mark and plate drawn as a dot and a
  wedge, the camera map, and the plate tiles; every picture opens full size. The person ticks plates there and presses
  "Use in this shot". `"masks": true` shows the critic's masks on every picture at once, numbered as in the sheet's list
  of notes (owner and fix beside each); `open_view {"view": "picture", "location", "plate": "master"}` shows one picture
  with its masks (SNAP-R136).
- **Build a place from a list, one version:** `add_plate {"location", "plates": [{...}, {...}], "version_note": "what
  changed"}`. One version per plate floods the critic's docket with rows that go stale at once (F-E14). The answer gives
  each plate's `size`, `sha256` and the take and frame it came from: compare them with the picture you meant (F-E12).
  `save_location` takes `map {file}`: the camera map (the walks' wedges over the plan), its own picture beside the bare
  plan, shown to people and critics and never put into a render (F-E11).
- **Eye gaps are typed numbers.** `eye_gaps` compares a plate's typed pose with its camera mark (or, with no mark, the
  height every mark shares). It doesn't measure the picture: look at the horizon against the doors before you trust a
  pose, and fix whichever number is wrong (F-E18).
- **Find a take anywhere:** `find_take {"file": "output/…"}` (an `input/` picture a location or Cast keeps finds the
  take its frame came from), `{"seed": n}` or `{"id": "<start of an id>"}`. Every tool that takes a take id takes a unique
  start of one (the 8 characters notes quote).

### Re-run with swaps (the same shot with another character, set or version)

Every record a take pinned is a slot you can swap (SNAP-R63). `rerun_slots {"take": ...}` lists each slot with every
choice: `pinned`, `latest`, `@n` (a version), or another record of its kind (`cast:<id>`); plus `scene` (another
scene's set comes in: `scene:<id>`) and `setup` (a setup name from `list_setups`). Two routes:

- **Re-generate** rebuilds the recipe with the swaps, the same seed by default: similar motion, not the same.
  `rerun {"take": ..., "swaps": {"cast:<kon>": {"to": "cast:<mara>"}}, "route": "regenerate"}`. The plan says what
  changes per swap, the rating it would have, and `cache_hit` when nothing the prompt holds changes (pick
  `"seed": "new"`). The new take is "Re-run · Kon → Mara" under the old one.
- **Reuse the motion** keeps the take's own video: a Cast swap is a recast (Viggle Remake, painted from the new Cast's
  details line and its first picture; its LoRA doesn't reach Remake), a set or card swap is a Change something. It
  returns a candidates decision: look at the painted frames with `candidate_frames {"decision": ...}` (beside the
  Cast's own picture), then `apply_candidate` (about 3 min).
  A Setup or shot swap can't use the take's own motion and comes back under `not_possible`.
- **Several at once:** give a list, `{"to": ["cast:<a>", "cast:<b>", "cast:<c>"]}`. Re-generate returns one decision
  whose candidates are the new takes; `apply_candidate` makes one the shot's active take.

Both spend GPU time and wait as proposals unless agents may run. Look at every new take with `take_frames` before you
say who is in it: it gives start, quarter, middle, three quarters and end; compare them across the clip before you say
the motion matches or not (one frame doesn't show motion). A saved file works too: `rerun {"file": "output/<subfolder>/<name>", ...}` finds the take it is.

`get_record {"ref": "cast:<id>@1"}` reads one version and the takes that pinned it; `diff_record {"a": "cast:<id>@1",
"b": "cast:<id>"}` lists what changed. Note: H3 copies a reference picture closely, so a new look (clothes, hair)
needs a new picture, not only new words. `list_world` shows every record with its size; `archive_record`,
`export_records` and `import_records` tidy them. `delete_record` can't be undone: it waits for the person.

### A new view of a place (stills from context pictures)

A location is one place: make each new view of it from pictures you already have, not from words alone.
`edit_from_context` makes a still with an H3 model from context pictures and your own words (nothing is added to
them). It works on stills: masters, plates, boards.

    edit_from_context {"method": "fizgig_still", "width": 2112, "height": 1184, "seeds": [1, 2, 3],
                       "pictures": [{"take": "<the location's master>"}, {"take": "<the nearest earlier view>"},
                                    {"cast": "cast:<id>"}, {"cast": "cast:<id2>"}],
                       "prompt": "<Picture 1> shows the village ... Show the same gatehouse from inside the square at eye height ... the woman from <Picture 3> on the left ..."}

- A picture is `{take}` (a still; a video take with `frame`), `{file}` (in input/), `{cast, ref}` (a Cast's
  picture) or `{location, plate}` (a location's plate by name, its master or its plan). `crop` is `[x, y, width, height]` in fractions of the picture.
- Say what the still is for with `purpose` (SNAP-R86): `character` (people in frame), `turnaround` and `cast_picture`
  run on the Fizgig still; `set`, `master`, `plate`, `settei` and `edit` (a targeted edit of Picture 1) on P-H3-Image.
  With no purpose, a Cast picture among the pictures reads as a character shot, else a set view. The answer's `chosen`
  names the model and why; the stills keep their purpose (`get_take.purpose`). `method` overrides it.
- `method` picks the model (`list_methods {"slot": "view"}`, which also lists the purposes): `ph3_view` (P-H3-Image, listed first: an edit of
  Picture 1 with the others as references, 8 steps, about 8 s at 1280x704, up to 9 pictures) or `fizgig_still`
  (stock H3 Reference to Video on the FL2VA model and the Fizgig H3 Still pack's one-frame latent, as the pack's own
  edit example runs it: every picture a reference, 20 steps,
  about 38 s at 2.5 MP; soft below 2-3 MP, so give `width`/`height`). In U101's C2 test both held the location's
  gatehouse at eye height with both people on-model; the Fizgig still gave the closest two-shots.
- **What Picture 1 is depends on the model** (each method's `picture_one`; the answer names it too). For both, the
  words set the camera, so the location's master can go first. Write `<Picture 1>`, `<Picture 2>`, … in the prompt.
- One candidate per seed (`seeds`, or `count`), each a take in the shot it lands in (`land`; by default Picture 1's
  shot). `wait_for {job: <decision>, until: "waiting"}`, look with `candidate_frames` beside the master, then
  `apply_candidate` makes the one that holds the set the shot's take.
- In the take viewer the same route is "New view from these pictures": add this picture, a marked region of it, or a
  Cast's picture, move them up or down, and pick the model.
- A small change to one detail (eyes, a prop): `ph3_view` with the still (or a crop of the part, e.g. the face) as
  Picture 1, name only the change, describe its shape and say what it is not: "Change only her eyes: gold irises, each
  with a single thin black vertical slit pupil like a cat's, no round pupil. Everything else stays." drew true slits
  3/3 (short03 F-C16); "slit pupils" alone gave round ones, and an unpinned head turns to show the eyes.
- Each candidate gets notes: each Cast's character score against its picture, and "copied Picture n" when its soft
  copy score against a context picture reaches 0.82, "· same framing" (it re-rendered that view) or "· same
  composition" (the picture drawn again from another viewpoint, e.g. the master's aerial turned). Notes inform, never block.
- Land each cut's board in that cut's shot (`land`), so each shot holds its own take; the answer's `land_hint` says
  when a context board sits in another shot.

### Showing a picture

`open_view {"view": "picture", "take": "<id>"}` (or `cast` + `ref`, `decision` + `candidate`, `file`, `path`) opens it
full size on the page you drive, for its person: fit / 100 %, zoom, arrows through its row, Esc closes. Every
thumbnail in Snap opens the same viewer on a click; nothing changes by viewing.

### Character sheets (turnarounds)

`make_character_sheet` draws a Cast as a sheet with one method of the sheet slot (`list_methods {"slot": "sheet"}`):

    make_character_sheet {"cast": "cast:<id>", "method": "contact_sheet", "seeds": [1, 2, 3]}

- `contact_sheet` (H3 Turnaround LoRA: five views jointly denoised from the Cast's picture; `contact_sheet_instruct` is
  its early checkpoint), `h3_ref_sheet` (stock H3 Ref2V lays out an 8-panel sheet from five pictures: the Cast's
  picture plus four more in `pictures`, e.g. a turnaround's views or crops), `fizgig_sheet` (the Fizgig still with a
  sheet prompt), `krea2_quadview`, `krea2_dynamic` (Krea 2 sheet LoRAs) and `moss_charref` (MOSS-Image CharRef asked
  for a turnaround).
- `design` is the character in words for the methods that write it into the prompt (default the Cast's details; `;`
  separates Krea's identity locks).
- One candidate per seed, each a still take: `candidate_frames {decision}` shows the sheet first, then each view the
  method draws apart (the contact sheet's five). `apply_candidate` keeps the one that holds the design.
- Which one (U101 round 2, Maren v1/v2 and Brann): `contact_sheet` for the turnaround itself (Picture 1 is padded
  square, which makes it orbit: front to back 9/9, about 39 s a sheet), `h3_ref_sheet` for an 8-panel reference sheet
  with close-ups once you have views to give it (it kept v2's scabbard on her back in profile 5/6). `krea2_quadview`
  looks cleanest but drops carried props; `krea2_dynamic` is a pitch sheet with garbled labels; `moss_charref` drifts
  off-model. None reliably draws "from above".
- A turnaround from one continuous orbit holds carried props best: an H3 orbit LoRA such as ORB360 on a Ref2VA setup
  with the front and back pictures beat every stills method; pull frames at 90/180/270 (skill `snap-turnaround`).
  From a front picture alone, back views mirror carried props: give a back reference.

### Voices and audio references

- Upload audio like pictures: `curl -s -F image=@line.wav -F subfolder=snap $BASE/upload/image` gives `snap/line.wav`.
  Load Audio lists the audio under input/snap/.
- `add_audio_ref {"file": "snap/line.wav", "role": "voice: Kon"}` wires it into References and answers `cite`, the
  `<Audio n>` to write in the prompt ("her voice is the voice of <Audio 1>: the same speaker and timbre, not repeating
  its words"). `describe_recipe.references` lists every `<Picture n>` and `<Audio n>`; `remove_audio_ref {"audio": n}`
  takes one out (the later ones move up).
- A Cast can hold the voice: `save_cast {..., "voice": {"file": "snap/kon_voice.wav", "casting": "young woman, low
  cool alto, clipped"}}`. `apply_cast` then puts the voice in with the pictures and says its `<Audio n>`.
- H3 reads audio references only with a reference setup (Ref2V). A voice reference itself is made at 12 steps or more
  (low resolution is fine; SNAP-R88); normal video takes stay at the setup's steps. Text alone doesn't cast a voice:
  H3 ignores pitch, age and sex words, so anchor the voice with a talking take and measure it (skill `snap-voice`).
- A take that cites a Cast voice gets the voice note once it lands (SNAP-R114): `get_take` / `list_takes` give
  `voice` with `status` ok, check (with `why`) or no voice, and per voice its line ("voice matches Maren 0.98, next
  closest Liesl 0.91 (+0.07), F0 184 Hz vs ref 184 Hz"). `check_voice {"take": "<id>"}` runs it again. It needs
  `models/audio_encoders/wavlm_base_plus_sv.safetensors`; a note without it says so. It never blocks: check = listen.

### The critic (SNAP-R101..R110)

Snap puts a critique row on the docket for every landed take, board, sheet, candidate, location version and cut pair,
and waits for an agent; it never judges a picture itself. When you are on duty (between your own renders too), work
it with the `snap-critic` skill: `list_critiques {"state": "due"}` (add `"compact": true` to scan a long docket),
`claim_critique {"critique": "<id>"}`, `critique_packet {"critique": "<id>"}` (the subject whole at native size, then
100 % tiles, then the context pictures and the words; pictures saved by snapcall in the order its `pictures[].image`
says), then `write_critique {"critique", "verdict": "clean" | "flaws", "passes": {...}, "notes": [{"severity",
"pass", "text", "picture", "region": [x, y, w, h], "owner", "fix"}]}`. The notes land on the take with masks; nothing
is blocked by them. An owner names the part it was born in ("plate Pb", "plan", "location master", "location notes",
"camera marks"): Snap stores that part and lists words it can't map in `owners_unmapped` (SNAP-R156). A mistake in a
row you wrote: `write_critique {"critique", "amend": true, ...}` writes it again as a new row that supersedes it
(SNAP-R157). `critique {"location": "location:<id>", "part": "views"}` asks for one (every view of a place side
by side); `critic_report` says how the critic agreed with the person. Only a record's newest version
gets rows; a row of an older version holds while the picture it read is unchanged, and an unwritten row whose picture
changed is `stale` (off the due list; `list_critiques {"state": "stale"}`). The packet's record notes are claims to
check, never evidence. When your run ends, `use_page {"page": null}` (SNAP-R135). After a fix at the source (a new master or plate
version), `rerun_dependents {"ref": "location:<id>"}` re-makes what used the old one, plates before boards before
cuts, as candidates; it stops before video unless `"through": "cuts"`. The fixtures that measure the critic:
`tests/snap/critic/README.md` in the pack.

### Shots, references and pictures (SNAP-R118..R125)

`list_tabs` lists the workflow tabs open on the page (name, active, modified, temporary, nodes, and the scene and shot
of a shot's tab): check it before opening more, and tell the person which scratch tabs you left.

- **A new shot keeps the open shot's setup only** (models, preset, turbo, sampling, size): no Cast, location, References,
  first frame, dials, style rows or prompt. `open_shot`'s `built` lists what it left out. `add_shot {start: "copy"}` copies
  the shot as it is.
- **References:** `add_ref` (a role for a picture already there renames it), `remove_ref`, `move_ref {picture, to}`.
  Moving or removing a picture keeps the prompt's `<Picture n>` on the picture they meant. A cite of a picture taken out
  becomes `<Picture ?>` (`orphaned` says so): rewrite it. A cite is the number only: say who or what it is outside the
  tag, "<Picture 2> is Maren" (SNAP-R137; `set_setting` answers `cites` when a tag holds more). `describe_recipe.references[].named` says whether the prompt
  cites each picture. "Missing" means the file is gone (subfolder files count as there).
- **Where a picture goes:** `use_take {as: "cast", cast, role}` makes a frame a Cast's next picture (a new version);
  `{as: "plate", location, name}` makes it a location's plate; `{as: "voice", cast, at, length}` makes a stretch of its
  sound the Cast's voice reference (SNAP-R143).
- **A Cast's pictures per shot:** `apply_cast {cast, pictures: ["state A"]}` (roles). The pin keeps the choice. An update
  to a version without one of them is refused. A re-run can take a Cast out: `rerun {swaps: {"cast:<id>": {to: "out"}}}`.
- **Is this shot's recipe what made its ★ take?** `open_shot` and `run` answer `recipe_matches_active` and, when it
  doesn't, `recipe_differs`. `run` answers `cache_hit` when the recipe and seed match an earlier take.
- **A family switch by preset name** (`apply_setup "Pika H3 Flex"` in a stills shot) starts from a pack card or the
  recommended recipe. It answers `carried` (dials, LoRA rows, Upscale) and which shot the tab still is. `start_recipe`
  from a shot answers `not_in_scene` with the `add_shot` call that puts the new tab there.
- `get_take` gives `prompts {positive, negative}` and `sound`. `describe_lora` gives `beside`: the caption files that
  came with the LoRA. `add_lora {role: "motion"}` takes an orbit/camera LoRA. `remove_lora {file}` works.
- `open_view {view: "library", tab, scope}` opens the Agent library for the person.
- A plan over 10 minutes says `holds_queue`. `list_locations` and `add_plate` answer `eye_gaps` when a plate's eye
  height is off its camera mark's (`add_plate {plates: [...]}` saves several as one version).

### The Book (a production: beats, boards, the Cut)

The Book is Snap's production layer (SNAP-R67-R69, R130-R133; skill `snap-book`). One Book holds a production: its
story as beats, its production style, its Cast and places, and its cuts (each a shot of a Book scene). The person sees
it on the Library rail's **Book** row (lenses Beat sheet, Settei, Boards, Cut bag, the Cut); `open_view {"view":
"book", "book": "book:<id>", "lens": "boards"}` opens it for them.

- `create_book {"name", "medium": "anime", "cast": [...], "locations": [...]}` makes the Book and an empty story;
  `list_books` / `get_book {"book"}` read it whole (beats with ids, changes, plants; every cut with its unit and stale
  takes).
- **Canon waits for the person.** `add_beat`, `edit_beat`, `move_beat`, `add_change`, `remove_change`, `save_story`,
  `keep_as_canon`, `set_autonomy` and a change to the Book's style (`save_style`) always answer `proposed`: the
  person's Accept (the Book's "Waiting for you" row, or the Work card) makes the version. The answer says what the edit
  would re-flag (`reversal_cost`). Don't ask them to turn anything on to skip this; it holds at every dial position.
  The Book's first style is the exception: a Book with no style takes it directly, and the answer says so.
- **Proposals stack and stay** (SNAP-R139). A story edit builds on the story as the Book's waiting proposals would leave
  it: propose b1, then `add_change {"beat": "b1"}` at once; the answer's `needs` names the proposal that adds b1, and
  the person's Accept of the change accepts b1 first (rejecting b1 withdraws the change). Proposals live on the server:
  a reload or another page keeps them, `list_proposals` and `get_book.proposals` give each one's answer (accepted,
  rejected, failed, withdrawn), and the person sees them on the Book's "Waiting for you" rows, as ghost beats on the
  Beat sheet and on the Work card.
- **The dial** (`autonomy`): per stage (beat_sheet, pages, settei, boards, cut_bag, dailies, the_cut) assist (your GPU
  work and picks wait), collaborate (as "Let agents run"), automatic (they go ahead, recorded as yours). It applies
  while the open shot is a Book cut; elsewhere "Let agents run" decides as before.
- **A change is state on the story clock**: `add_change {"book", "beat": "b4", "entity": "cast:<id>", "path":
  "carried.right_hand", "op": "set", "value": "prop:letter", "why"}`. Paths the compile says in pictures: wardrobe,
  carried.right_hand / left_hand / worn, holder (a prop's), mood, position, facing, hair, injuries; knows, wants and
  relationships are prose only. `state_at {"book", "entity", "beat"}` folds them (story order, never telling order).
- **Cuts**: `add_cut {"book", "scene_name" or "scene", "beats": ["b3"], "cast": [...], "props": ["prop:letter"],
  "location": "location:<id>", "plate": "P1", "seconds": 4, "sound", "transition"}` makes a shot with its unit and
  the next cut number (C1, C2…: an id). `set_unit` changes it (`trim {in_s, out_s, gain_db}` for the Cut).
- **Compile, then apply**: `compile_unit {"scene", "shot"}` is the compiled state sheet (each field with the beat and
  change that set it, its sentence, "words only" or its state picture; the place; the reference package; the prompt
  with the style paragraph first, then the beats' text, the unit's blocking and camera; palette notes; a beat still
  waiting in a proposal is named with its id; `board`: exactly what `make_board` sends). `apply_unit` puts it into the cut's recipe (open the shot and
  `start_recipe` first on an empty one) and pins what the take will carry, citing every picture from References as
  they finally stand and giving a Cast its voice only where it has a line (SNAP-R141); its answer gives the whole
  prompt. Then `run`. Both take `beats` (the Beat
  slot): the same cut at another story moment, and its takes remember it. `story_stale {"book"}` names
  the takes whose used fields moved.
- **Style**: `save_style {"book", "name", "paragraph", "palette": "monochrome" | "limited" | "full", "still": {"take"} or
  {"file"}, "voice", "sound", "genre"}`. Under monochrome or limited keep colour words out of Cast lines (the compile
  notes them). No negative.
- **Settei**: `save_cast_state {"cast", "state": "oilskin", "covers": {"wardrobe": "the oilskin"}, "pictures": [{"take",
  "view": "front"}]}`; a state with no picture compiles "words only".
- **Boards → animatic → video → the Cut**: `make_board {"scene", "shot"}` (a New view from the cut's plate, the previous
  board and its Cast; candidates land in the shot; `context: [{"cut": "C2"}]` picks the prior view, e.g. the cut that
  shares this camera; `role: "key"` draws the beat's peak instead of the opening), `set_board {"scene", "shot", "take"
  or "file", "approved": true}` (`role: "key"` sets the key drawing: a reference the cut builds to, SNAP-R142),
  `animatic {"book"}` (boards timed in telling order, kept takes in place of their boards; one video lands as a take of
  the Book: `wait_for` its run), then video per cut from its approved board (`apply_unit` opens it on the board), and
  `export_cut {"book"}` (the active takes in telling order with their trims and levels: one mp4 plus an OTIO file
  under output/snap_book/).
- **Pages**: `export_fountain {"book"}` gives the story as a Fountain script (scene headings, action, `=` intents,
  dialogue under each name); `import_fountain {"book", "text"}` proposes a story from one. A beat keeps its id (and its
  changes) when its text is unchanged or edited in place in its scene; moving a scene changes telling order only.
- **Scene groups and the colour script** (SNAP-R175): `add_group {"book", "name", "beats": ["b1", "b2"], "place"}` and
  `set_group {"book", "group", ...}` group beats into scenes (proposals, like every story edit). The colour script is
  one frame per scene group: `set_colour_frame {"book", "group", "take" or "file"}` (the board or take that sets the
  scene's colour and light); the Beat sheet's strip offers the group's cuts' boards until one is chosen.
- **Props by name** (F-L16): `add_change {..., "value": "prop:rag", "name": "the rag"}` keeps the prop's name in the
  story. A prop's `holder` and the people whose `carried.*` names it must agree: the compile's lint and the Beat
  sheet's flags say where they don't; `state_at {"entity": "prop:<id>"}` gives `carried_by` (F-L11).
- **Settei: design it** (SNAP-R176): `design_state {"book", "cast", "state", "view": "front"}` makes candidates of a
  Cast in a state from its own pictures, with the style paragraph first and the state's words (covers and words come
  from the Cast's state of that name). They land in "Settei · <Book>"; pick with `save_cast_state {"cast", "state",
  "covers", "pictures": [{"take", "view"}]}`, which writes the Cast version (the person's Use this does the same).
  A wardrobe state leaves the Cast line's clauses that are its items out of the prompt ("green apron" under "no
  apron"), named in `left_out`; a clause that still disagrees comes back as `lint` (SNAP-R178): read both before the
  GPU spends on it.
- **dry_run** (SNAP-R177): the story edits, `save_style` and `save_cast_state` take `"dry_run": true`: the answer is the
  would-be diff (a story edit also its reversal cost and `needs`) and nothing is written. Read it before proposing a
  big edit. A stacked proposal's `reversal_cost` is its own; the whole stack's is in `with_waiting` (F-L06).
- **Set plan**: `draw_set_plan {"location", "shapes": [{"kind": "rect", "x": 0.5, "y": 0.1, "w": 0.3, "h": 0.14,
  "label": "Hall"}, ...], "cameras": [{"name": "C1", "x": 0.5, "y": 0.86, "heading": 0, "lens": 35}]}` saves the
  plan picture (shapes and labels only) and the marks on the location; the person draws the same in "Draw the plan".

### Verdicts, the option cemetery and blind pairs (SNAP-R173, R174)

The person judges with one key (`p` keep, `x` reject, `n` neither) on a take card, in the viewer, on the Work card and in
the Room; a reject, a declined candidate, a rejected proposal or a parked row may say why (`because`) and when to look
again (`revive_if`). Before proposing something again, read `cemetery` (scope `scene` + `shot`, `group` or `book`): what
was turned down and why. A verdict taken back stays in `verdict_detail.retracted`. `setup_ab {take_a, take_b}` asks
the person a blind question: the server keeps which take is A until they judge it (the page never sees it), so don't
name the takes when you tell them it waits.

### The Room (SNAP-R70)

The person's front door: `open_view {"view": "room"}` (or `/?room`) shows what waits for them, one question at a time,
pictures full width, with no machinery. Your words reach it as job questions (`run {question}`) and proposal reasons:
write them for a person: no ids, file paths, model names, status words or counts; say what you want to know ("does the
gate hold through the turn?"), and when you can't find something, say so plainly. A verdict there is the same record as
anywhere else.

## When Snap can't do it

A missing route is a gap in Snap, not a reason to leave it: a take queued outside Snap (raw API, a side graph) never
shows in its shot, its Cast pins or the Work card. Tell the person what you tried, which tool and what it answered, so
the route gets built into Snap. When several agents log such findings at the same time, each takes the ID range it was
given (F-H01..F-H49 for one, F-H50..F-H99 for the next) so no two rows share an ID (SNAP-R152).

## Limits

- A call times out after 30 s. `run_status` waits at most 25 s per call.
- Results are never trimmed. If one is too big for your context, save it to a file and hand it to a subagent to break
  down and report back.
- `screenshot` needs a person's press on "Let agents see" in their own tab; the agents' window needs none.

## Your work and the person's: the Work card

Everything you or the person started (renders, re-takes, re-runs, edits and their candidates, plates, extends, checks,
Make a dial, proposals and blind pairs waiting for the person, refusals) is one list, read from the server, so it
survives reloads and covers every page: `list_activity` (filters `zone`, `state`, `kind`, `by`, `about`; the whole list
unless you page it with `offset`/`limit`). `zone` is `in_flight` (queued, running, checking, failed), `landed` (waiting
for the person, or done and not opened yet), `parked` or `closed`. `list_docket` is what waits for the person.
`wait_for {"job": "<run id or decision id>", "until": "done" | "waiting" | "failed" | "settled"}` waits for one job:
an edit's candidates are `waiting` once their identity notes are in. Never poll JSON files or sleep: wait_for answers.
`cancel_run {"run": "<id>"}` takes a queued run out of the queue or stops a running one (yours at once; the person's
waits as a proposal; SNAP-R144).
- Snap proposes and you act, always with the person's yes for downloads, installs and anything that spends their GPU
  without "Let agents run".
