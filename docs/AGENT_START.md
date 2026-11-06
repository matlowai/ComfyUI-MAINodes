# Snap for agents: start here

Snap is the full-screen view of the MAINodes pack in ComfyUI. An agent drives it with tools. The tools run inside an
open Snap page, and you reach them through that page. Snap never downloads anything by itself.

Below, `$BASE` is the ComfyUI address (for example `http://127.0.0.1:8188`) and `$PACK` is
`<ComfyUI>/custom_nodes/ComfyUI-MAINodes`. On a signed-in install (snap-gate), `$BASE` is the gate's address. There you
`export SNAP_TOKEN=<your account token>`, which every tool below sends as a Bearer header.

## 0. Find this server's Snap

    curl -s $BASE/mainodes/snap/info

It returns `pack` (use it as `$PACK` below: `tools/snap_agent_page.sh` and `tools/snapcall.py` are in it), `input`
(this server's input folder: pictures you name must be there), `output`, `base`, and `code` (the Snap code the server
serves). A machine can hold several ComfyUI installs: trust this answer, not a folder you found by searching.

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

You can also run the tools as an MCP server (Claude Code):

    claude mcp add comfy-snap -- python3 $PACK/tools/snap_mcp.py --base-url $BASE

- A call ends after 30 s. Long work, such as a render, returns at once, and you follow it as described in step 4.
- A wrong or missing argument is refused, and every error names the arguments the tool takes. Read the error and call
  again.
- Call `describe_recipe` before you change a recipe, and read its `revision`, `about` and `prompt_help`. A brick with
  `on: false` is off, its values are not used, and `off` says why.

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
     `set_setting` on `first_frame`).
   - Upscale starts off when RelayVSR isn't installed.
2. Set the prompt: `set_setting {"brick": "render", "name": "prompt", "value": "..."}`.
   - `render` names the recipe's Render in every family (the stills recipe's brick id is `image`). Titles such as
     `save`, `models` and `upscale` work the same way. A brick that isn't there is refused with the recipe's brick ids.
   - For H3 video, write the three sections, each on its own line:
     - `integrated_multimodal_description:` starts with `[Shot 1]`, then what we see: shot size, light, who does what
       and how the camera moves. `<Picture 1>` and so on name the reference pictures.
     - `overall_soundscape:` names the specific sounds the action makes (paws pattering on grass, a door slamming, a
       short bark), then a short ambience tail. Don't lead with soft, gentle, faint or distant: an ambience-only
       soundscape comes out near-silent.
     - `non_diegetic_music:` music laid over the scene, or `N/A`.
   - For stills, write two or three concrete sentences.
   - `describe_recipe` → `prompt_help` repeats this for the open recipe.
3. Set the length in frames or seconds: `set_setting {"brick": "render", "name": "length", "value": "5s"}`. Seconds
   round to the nearest frame count the model takes (H3 at 24 fps: 17n + 5 frames), and the answer says what the
   length became. `describe_recipe` shows the seconds next to the frames.
4. `new_seed` draws a new seed for the Render. You can name another brick with `brick`.
5. `run {"question": "does the jacket hold through the turn?"}` returns `run`, the run's id (always; a refusal is an
   error that says why). The question is what the person reads on the Work card; leave it out and it reads "Run <tab>".
   A `warning` says when the prompt is still the recipe's default text: the run still goes, so set the prompt first.
6. Call `wait_for {"job": "<id>", "until": "done"}` (or `run_status {"run": "<id>", "wait_s": 25}`) again until it is
   done or failed: each call waits up to 25 s, and `reached` says whether it got there. The state goes `queued` →
   `running` → `done` / `failed`. When the run is done, `run_status` gives the take id and the output files
   (`path` on the ComfyUI machine, and `url`). `metadata_kept` names nodes that wrote the prompt into their files
   although Save metadata was off: tell the person.
7. `list_takes`, `take_frames` (look at a take) and `rank_takes` / `judge_takes` (your own judgments, kept apart from
   the person's) come after that. Snap notes a take whose sound is quiet (mean below about -45 dB): its `sound.quiet` is
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
- `h3_latent`: the same from the take's latent made bigger by a latent model (`upscaler`, default the H3 3D-conv one).
- `tessera` (needs the ComfyUI-Tessera pack): about 1 MP tiles on Ref2VA, the take as <Video 1>, a first-frame still
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
5. Change the character: `save_cast` again with `"cast": "cast:<id>"` and the whole character (say what changed in
   `note`). The recipe does not change by itself: `describe_recipe.world` says `moved: true`, and `list_takes` shows
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
  Casts for a two-shot, each face matched to one Cast). It returns the lowest score per Cast and each frame's face
  crops: look at the crops, the score only informs.
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
  wasn't in the prompt". `remove_from_world {"ref": "cast:<id>"}` takes any record out of the open recipe (its
  pictures, its line in the prompt, its pin; the record stays), as the x on its chip does.
- `open_view {"view": "location", "location": "location:<id>"}` opens the Location sheet for the person: the master,
  the plan with every camera mark and plate drawn as a dot and a wedge, and the plate tiles; every picture opens full
  size. The person ticks plates there and presses "Use in this shot".

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
- Each candidate gets notes: each Cast's face against its picture, and "copied Picture n" when its copy score against
  a context picture reaches the threshold (it re-rendered that view, e.g. the master's aerial). Notes inform, never block.
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
  (low resolution is fine); normal video takes stay at the setup's steps.

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
- Snap proposes and you act, always with the person's yes for downloads, installs and anything that spends their GPU
  without "Let agents run".
