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

Either the person opens `$BASE/?snap` in their browser, or you start a headless page of your own:

    bash $PACK/tools/snap_agent_page.sh $BASE

- The script returns once the page has registered. `bash $PACK/tools/snap_agent_page.sh $BASE --stop` stops the
  page(s) it started for that ComfyUI; you need no pid and no `kill`.
- If a page of yours is already open, the script says so and starts nothing, because calls already go to that page.
  Pass `--new` to start another one anyway.
- Each launch uses a fresh Chrome profile, so a page that died earlier never blocks the next one.
- On a signed-in install, give the sign-in link as the page:
  `bash $PACK/tools/snap_agent_page.sh $BASE "$BASE/gate/login?token=$SNAP_TOKEN&next=/%3Fsnap"`

Calls go to a page of your own user that is still connected: one running the server's current code first, then your
own headless page before the person's visible tab, then the newest. Each call's answer names the page under `page`.
If it says the page runs older Snap code (`page_warning`, or an "Unknown Snap tool" error that says so), start your own
page with `snap_agent_page.sh $BASE --new`; never reload or close the person's tab yourself. Run `curl -s $BASE/mainodes/snap/tools` to see
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
   A headless page has no screen to share: use `take_frames` to look at takes.
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
5. `run` returns `run`, the run's id. A `warning` says when the prompt is still the recipe's default text: the run
   still goes, so set the prompt first.
6. Call `run_status {"run": "<id>", "wait_s": 25}` again until `state` is `done` or `failed`. The state goes
   `queued` → `running` → `done` / `failed`. When the run is done, `run_status` gives the take id and the output files
   (`path` on the ComfyUI machine, and `url`). `metadata_kept` names nodes that wrote the prompt into their files
   although Save metadata was off: tell the person.
7. `list_takes`, `take_frames` (look at a take) and `rank_takes` / `judge_takes` (your own judgments, kept apart from
   the person's) come after that. Snap notes a take whose sound is quiet (mean below about -45 dB): its `sound.quiet` is
   true. Then tell the person, and offer `make_louder` (a louder version of the take) or a prompt that names the sounds
   the action makes. With no note the level is normal (our good takes are about -25 to -45 dB): don't re-render for it.
8. To make a take longer, call `edit_take {"take": "<id>", "method": "chain", "clips": 2}`. Standard (`chain`) holds the
   colour; `geiru` (Strong) keeps the look but may reset the action. Each clip adds about 4.25 s, and the longer take
   lands as a version of the take.

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

## Limits

- A call times out after 30 s. `run_status` waits at most 25 s per call.
- Results are never trimmed. If one is too big for your context, save it to a file and hand it to a subagent to break
  down and report back.
- `screenshot` needs a person's press on "Let agents see" in a visible page.
- Snap proposes and you act, always with the person's yes for downloads, installs and anything that spends their GPU
  without "Let agents run".
