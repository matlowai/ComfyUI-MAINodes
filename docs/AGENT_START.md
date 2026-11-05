# Snap for agents: start here

Snap is the full-screen view of the MAINodes pack in ComfyUI. An agent drives it with tools. The tools run inside an
open Snap page, and you reach them through that page. Snap never downloads anything by itself.

Below, `$BASE` is the ComfyUI address (for example `http://127.0.0.1:8188`) and `$PACK` is
`<ComfyUI>/custom_nodes/ComfyUI-MAINodes`. On a signed-in install (snap-gate), `$BASE` is the gate's address. There you
`export SNAP_TOKEN=<your account token>`, which every tool below sends as a Bearer header.

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

Calls go to the newest page of your own user that is still connected. Run `curl -s $BASE/mainodes/snap/tools` to see
your open pages under `pages`, with when each registered and when it last answered. When no page is open, every call
says how to start one.

## 2. Call tools

    curl -s $BASE/mainodes/snap/tools                       # names, descriptions, argument schemas, your open pages
    python3 $PACK/tools/snapcall.py $BASE get_profile        # one call; pictures are saved as files, paths printed
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

## Limits

- A call times out after 30 s. `run_status` waits at most 25 s per call.
- `screenshot` needs a person's press on "Let agents see" in a visible page.
- Snap proposes and you act, always with the person's yes for downloads, installs and anything that spends their GPU
  without "Let agents run".
