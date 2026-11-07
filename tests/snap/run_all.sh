#!/usr/bin/env bash
# Every Snap test suite against a CPU ComfyUI that loads this pack; one summary line per suite (README.md).
# Ports, bases and folders come from an env file: $SNAP_TEST_ENV, else tests/snap/.env (start from .env.example).
# test_onboarding.js and the fresh suites also need the empty CPU server ($SNAP_TEST_FRESH_PORT).
# The main base keeps user/snap_privacy.json {"on": true} (SNAP-R37: privacy is opt-in per install); the fresh one has none.
# usage: tests/snap/run_all.sh   (queues only 64 px CPU prompts (test_private_files.py, test_newcomer.js) and, on the fresh
# server, test_kits_fresh.js's kit prompts, which fail at their first loader on empty placeholder files; CPU work under nice 19)
set -u
T="$(cd "$(dirname "$0")" && pwd)"
env_file=${SNAP_TEST_ENV:-$T/.env}
[ -f "$env_file" ] && { set -a; . "$env_file"; set +a; }
for v in SNAP_TEST_BASE SNAP_TEST_FRESH_BASE SNAP_TEST_OUT SNAP_TEST_FIXTURES SNAP_TEST_REAL_MODELS SNAP_TEST_NODE_PATH SNAP_TEST_PYTHON; do
  [ -n "${!v:-}" ] || { echo "$v is not set: copy tests/snap/.env.example to $env_file and fill it in (README.md)"; exit 1; }; done
export SNAP_TEST_PACK=${SNAP_TEST_PACK:-$(cd "$T/../.." && pwd)} NODE_PATH=$SNAP_TEST_NODE_PATH
port=${SNAP_TEST_PORT:-8195} fresh_port=${SNAP_TEST_FRESH_PORT:-8196} gpu_port=${SNAP_TEST_GPU_PORT:-8194}
gate_port=${SNAP_TEST_GATE_PORT:-8297} gatetest_port=${SNAP_TEST_GATETEST_PORT:-8199} py=$SNAP_TEST_PYTHON
export SNAP_TEST_PORT=$port SNAP_TEST_FRESH_PORT=$fresh_port SNAP_TEST_GPU_PORT=$gpu_port SNAP_TEST_GATE_PORT=$gate_port SNAP_TEST_GATETEST_PORT=$gatetest_port
# results, .out/.err files and screenshots land in $SNAP_TEST_OUT, never beside the suites
mkdir -p "$SNAP_TEST_OUT"/{ui,_debug,snapbox} && cd "$SNAP_TEST_OUT" || exit 1
echo "pack     $SNAP_TEST_PACK (the servers must load this checkout)"
# tests save user cards into the test server's user folder; park earlier runs' cards (moved, never deleted) and clear the
# server's history of finished jobs (ComfyUI's in-memory list, no files)
cards=$SNAP_TEST_BASE/user/default/snap/cards
# U90-1: no test server may link a folder into the real models (a save there lands in the person's library); the end of the
# run fails when anything under the real models/loras changed meanwhile. SNAP_TEST_MODEL_DIRS adds model folders the
# servers share (extra model paths), separated by ':'
real=$SNAP_TEST_REAL_MODELS; stamp=_debug/run_all_start.stamp
IFS=: read -ra extra_models <<< "${SNAP_TEST_MODEL_DIRS:-}"
bash "$T/real_models_guard.sh" before "$stamp" "$real" "$SNAP_TEST_BASE/models" "$SNAP_TEST_FRESH_BASE/models" "${extra_models[@]}" ${SNAP_TEST_GATETEST_BASE:+"$SNAP_TEST_GATETEST_BASE/models"} || exit 1
park() { for d in cards cast card set_snapshot location instruction skill book story look instructions.json critiques dependents proposals.json critic_fixtures critic_report _migrated _archived crew rules.json takes candidates scenes rankings judgments models.json ../../snap_blind.json private.json profile.json ../workflows/snap\ fresh\ test.json ../workflows/snap\ fresh\ copy.json; do src="$(dirname "$cards")/$d"; [ -e "$src" ] && mkdir -p "$(dirname "$cards")/_parked" && mv "$src" "$(dirname "$cards")/_parked/$(basename "$d")-$(date +%H%M%S)-$RANDOM"; done; onboarded; curl -s -o /dev/null -X POST "http://127.0.0.1:$port/settings/MAINodes.Snap.AgentsMayRun" -d false; curl -s -o /dev/null -X POST "http://127.0.0.1:$port/history" -H 'Content-Type: application/json' -d '{"clear": true}'; true; }  # G1: an earlier suite's finished jobs would be adopted as takes (F-C25) by the next page; G3: Let agents run goes back off (a suite that turned it on would hand the next one runs instead of proposals)
# a parked profile would make Snap open onboarding by itself on the next suite's first visit: start from an answered one
onboarded() { curl -s -o /dev/null -X POST "http://127.0.0.1:$port/userdata/snap%2Fprofile.json" -H 'Content-Type: application/json' -d '{"intents":[],"sfw_only":false,"api_tasks":[],"answered":["intent","scan","metadata","sfw","local","code","kit"],"done":true}'; }
# U79 (SNAP-R96..R98): with privacy on, a private take is saved encrypted, and saving one needs the person's vault key.
# Set one up and unlock it through the lock sheet's routes, as the person would, with a passphrase made for this run and
# held only in this shell; an earlier run's key file is parked first (moved, never deleted). Off installs answer "off".
vaultkey() { local u="${cards%/default/snap/cards}" vp; vp=$(python3 -I -c 'import secrets; print(secrets.token_hex(24))')
  [ -e "$u/snap_vault.json" ] && mkdir -p "$u/_parked" && mv "$u/snap_vault.json" "$u/_parked/snap_vault.json-$(date +%H%M%S)-$RANDOM"
  for r in setup unlock; do echo "vaultkey $r $(curl -s -X POST "http://127.0.0.1:$port/mainodes/snap/vault/$r" -H 'Content-Type: application/json' -d "{\"passphrase\": \"$vp\"}" | python3 -I -c 'import json, sys; print(json.load(sys.stdin).get("vault"))')"; done; }
# a suite that crashes writes no result: park its old one first (moved, never deleted), so summary can't print a previous run's PASS
fresh() { local r; for r in "$@"; do [ -e "$r" ] && mkdir -p _parked_results && mv "$r" "_parked_results/$(basename "$r" .json)-$(date +%H%M%S)-$RANDOM.json"; done; true; }
run() { local t0=$SECONDS; fresh "ui/$(basename "$1" .js)_result.json" "$(basename "$1" .js)_result.json"; timeout 600 nice -n 19 node "$T/$1" "${@:2}" >/dev/null 2>"$1.err" || echo "$1 FAILED (see $1.err)"; echo "  ($((SECONDS - t0)) s)"; }
summary() { python3 -I - "$@" <<'PY'
import json, os, re, sys
name, path = sys.argv[1], sys.argv[2]
if not os.path.exists(path):
    sys.exit(print(f"{name:8s} FAIL (no {path}: the suite wrote no result)"))
r = json.load(open(path))
checks = {
 "engine": lambda r: [sorted(r["classDiff"]) == ["BranchNode: got 4 want 5", "CustomCombo: got 1 want 2"], [e for e in r["edgesOnlyOurs"] if "<-LoadImage" not in e] == ["SaveVideo.video<-RelayVSRUpscaleVideo[0]"],
   r["edgesOnlyExample"] == ["BranchNode.autogrow.branch0<-BranchNode[0]", "BranchNode.autogrow.branch1<-RelayVSRUpscaleVideo[0]", "SaveVideo.video<-BranchNode[0]"], r["chain"] == {"saveFrom": "RelayVSRUpscaleVideo", "upscaleFrom": 2, "outerSave": True},
   r["afterUndoBricks"][-1] == "upscale" and r["afterRedoBricks"][-1] == "save_video", r["overrides"] == ["render.model: rewired"], r["overridesAfterUndo"] == 0, r["refsLinkedAfterResnap"]] + [v is True for v in r["review"].values()],
 # k3s-server on this box runs at ~160% CPU: allow one single-vsync miss (<= 34 ms) per phase, never more
 "ui": lambda r: [r["drag"]["move"]["long"] <= 1 and r["drag"]["move"]["worstMs"] <= 34, r["drag"]["lift"]["long"] <= 1 and r["drag"]["lift"]["worstMs"] <= 34, r["upscaleAfterRemove"]["from"] == "Dials - H3 + De-rope" and "upscale" not in r["upscaleAfterRemove"]["bricks"], r["upscaleAfterInsert"]["from"] == "RelayVSR", r["drawsWhileSnap"]["draws"] == 0, r["graphUnchanged"], r["reverse"]["stuck"] == 0, r["overrideChip"] == 1, r["vue"]["bricks"] == 7, not r["errors"]],
 "ui2": lambda r: [r["paletteOpenMs"] < 50, len(r["appMode"]) == 11, 290 - 30 <= r["switchMsNormal"]["looksDone"] <= 350, r["switchMsReduced"]["looksDone"] <= 150, r["touchOrder"][0] == "refs", r["touchScroll"]["before"] == r["touchScroll"]["after"], all(v <= 0 for v in r["phone"].values()), not r["errorsA"], not r["errorsT"],
   r["groupMidDrag"], r["groupOrder"][:2] == ["render", "models"] and r["groupOrder"][-2:] == ["upscale", "save_video"], r["groupDom"] == [k for k in r["groupOrder"] if k != "preset"], not r["errorsG"]],
 "agent": lambda r: [len(r["mcpTools"]) == 182, [c["isError"] for c in r["calls"]] == [False] * 6 + [True] + [False] * 6 + [True], r["lengthInGraph"] == 97, r["unknownTool"]["isError"], not r["errors"]],
 "seteditor": lambda r: [len(r["applied"]) == 2, r["editorOpen"] == 1, "line between Ferro and Kon" in r["warn"], "Bare walls only" in r["blockAfter"],
   len(r["afterApply"]) == 2 and all("-mine_" in x for x in r["afterApply"]) and [x.split("|")[0] for x in r["afterApply"]] == [x.split("|")[0] for x in r["applied"]],
   r["editorClosed"], r["myEdit"][0] == "set-lamp-room-end-s3-mine", r["reopenedShot"] == "shot 4", "screen direction flips" in r["reopenedWarn"], len([t for t in r["savedCards"] if "bridge" not in t]) == 1, r["escClosed"], not r["errors"],
   r["setBlocksInPrompt"] == 1, "changes on screen" in r["trackNote"], r["trackSegments"] == 49, r["bridgeOffered"], any("end of shot 3, neutral bridge" in t for t in r["bridgeSaved"]), any("lens 24 mm -> 85 mm" in t for t in r["coverageNotes"]) and not any("screen direction flips" in t for t in r["coverageNotes"]), any("Ferro looks" in t for t in r["eyelineNotes"])],
 "proposals": lambda r: [r["ghostAfterPreset"], r["chipsOnRender"] == 2, r["pill"] == "3 proposals", r["nothingChangedYet"] == {"bricks": ["models", "preset", "render"], "length": 141},
   r["afterAccept"] == ["models", "preset", "rack", "render"], r["rackBound"] == "rack", r["lengthAfterReject"] == 141, r["konInPrompt"], r["pillHidden"], r["libForHiddenWhenNothingSelected"],
   r["list"] == ["snap:accepted", "set_setting:rejected", "apply_card:accepted"], r["readOnlyIgnoresPropose"] == 4, not r["errors"],
   r["crew"] == {"total": [2, 3], "kinds": {"brick rack": [1, 1], "setting length": [0, 1], "card cast": [1, 1]}}],
 "notes": lambda r: [r["noteChip"] == 1, len(r["agentSees"]) == 1 and r["agentSees"][0].startswith("render:"), r["answer"] == "answered", "agent Proposed" in r["chip"], r["reNote"] == 2,
   r["afterAccept"] == {"length": 97, "rack": ["dials/h3_motion.safetensors"]}, r["closed"], r["openAfter"] == 0, r["recipeNoteOnTop"], r["undoRemovedIt"], r["queueAttempts"] == 0, not r["errors"]],
 "dock": lambda r: [r["afterResize"] == {"docked": True, "inCanvasDirectly": False, "chromeTop": ""}, r["redock"]["docked"] and r["redock"]["chromeTop"] == "" and r["redock"]["paddingTop"] == "0px", r["dock"]["inSidebar"], r["dock"]["visible"], r["dock"]["bricks"] == 3, r["dock"]["railHidden"], not r["dock"]["paused"], r["dock"]["draws"] > 0, r["liveFrames"] == "73 frames · 3.04 s",
   r["chipSelects"], r["fullView"] == {"inCanvas": False, "showing": True, "docked": False, "paused": True}, r["queueAttempts"] == 0, not r["errors"]],
 "tabs": lambda r: [r["a1"]["showing"], not r["b1"]["showing"], r["a2"]["showing"] and r["a2"]["bricks"] == 3, not r["b2"]["showing"], r["a1"]["tab"] != r["b1"]["tab"], r["queueAttempts"] == 0, not r["errors"]],
 "board": lambda r: [r["frames"] == ["end of shot 3", "end of shot 4", "end of shot 5"], r["gaps"][0]["badges"] == ["1 break"] and "screen direction" in r["gaps"][0]["why"],
   r["gaps"][1]["badges"] == ["1 break"] and "radio" in r["gaps"][1]["why"], "end of shot 4" in r["opened"], r["queueAttempts"] == 0, not r["errors"]],
 "anynode": lambda r: ["node:VAEDecode#1" in r["keys"], r["renderFirstFrame"] is None, r["ask"]["rule"] == "ask" and [c["via"] for c in r["ask"]["candidates"]] == ["video_vae", "audio_vae"], r["askChips"] == ["Setup · video vae", "Setup · audio vae"],
   r["chosen"]["rule"] == "chosen" and r["chosen"]["via"] == "video_vae", r["linkFromVideoVae"], r["ks"]["brick"] == "node:KSampler#1", r["ksModel1"]["from"] == "preset", r["ksModel2"]["rule"] == "pack:rack.model",
   r["chosenKept"] == "chosen", "NoSuchNode" in r["unknown"].get("error", ""), r["selectedAfterPalette"] == "node:VAEDecode#1", r["constructorRefused"] is not None,
   r["review3"] == {"ksModelFrom": "preset", "askBefore": True, "askAfterUnsnap": False, "describeMissing": "NoLongerInstalled (not installed)", "missingRemoved": True}, r["loop"] == {"encPixels": "node:VAEDecode#1", "decSamples": None}, r["afterReload"] == ["preset:Render Preset", "node:KSampler#1:KSampler", "rack:Dial Rack", "node:VAEDecode#1:VAE Decode"], r["queueAttempts"] == 0, not r["errors"]],
 "adopt": lambda r: [r["button"] and r["button"].startswith("Snap this workflow"), {"preset", "rack", "refs", "render"} <= set(r["keys"]), len(r["keys"]) == 16, len(r["renderBindings"]) == 11,
   r["imported"], r["overrides"] == 0, r["graphUnchanged"], r["shown"] == 16, r["queueAttempts"] == 0, not r["errors"],
   r["fold"] == {"before": 10, "text": "+6 more", "opened": 16, "closed": 10}, r["orderAfterFoldedDrop"] == ["node:LoadImage#6", "node:LoadImage#7", "node:MAIDialMake#1", "rack"],
   r["scrollBefore"] > 0 and r["scrollWhileHeld"] == 0, r["firstAfterAutoscroll"] == "render"],
 "rules": lambda r: [r["first"] == "ask", len(r["saved"]) == 1 and r["saved"][0]["to"] == "VAEDecode" and "audio_vae" in r["saved"][0]["pick"], r["second"]["rule"] == "remembered" and r["second"]["via"] == "audio_vae",
   "audio vae" in r["secondChip"], r["freshPage"]["rule"] == "remembered" and r["freshPage"]["via"] == "audio_vae", r["queueAttempts"] == 0, not r["errorsA"], not r["errorsB"]],
 "recipe": lambda r: ["Saved" in r["saveToast"], r["after"] == r["before"], r["twice"] == r["before"]["keys"], "9 bricks" in r["applyToast"], r["afterUndo"]["bricks"] == 0, r["queueAttempts"] == 0, not r["errors"]],
 "shot": lambda r: [r["applied"]["first"] == r["preview"]["line"], r["applied"]["first"].startswith("integrated_multimodal_description: [shot 4] Kon steps forward"), "An elderly lighthouse keeper" in r["applied"]["first"],
   "over the shoulder, on Ferro, 50 mm" in r["applied"]["first"], r["applied"]["length"] == 97 and r["applied"]["pictures"] == 2, r["applied"]["lines"] == r["before"]["lines"],
   r["chips"] == ["beat", "character", "character", "set", "blocking", "camera", "direction", "direction"] and r["dots"] == 8, r["again"] == r["applied"], r["afterUndo"] == r["before"],
     r["mine"]["setFrom"] == ["set-lamp-room-end-s3-mine"] * 2 and r["mine"]["pictureCards"] == ["set-lamp-room-end-s3-mine"] * 2, r["queueAttempts"] == 0, not r["errors"]],
 "newtab": lambda r: [len(r["tabs"]) == 2, r["originalUntouched"], "MAIDialRack" in r["newTabTypes"] and "KSampler" not in r["newTabTypes"], r["snapOpen"], r["queueAttempts"] == 0, not r["errors"]],
 "passthrough": lambda r: [r["rack"]["dom"] == 1, r["models"]["dom"] == 1 and r["models"]["fields"] >= 12, r["first_frame"]["buttons"] == ["choose file to upload"],
   sorted(x.split(":")[0] for x in r["render"]["wired"]) == ["cfg", "conditioning", "de-rope steps"], r["addDial"] and '"strength": 0.5' in r["rackAfter"].replace('":', '": '),
   all(not h["inSnap"] and h["connected"] for h in r["home"]), r["queue"] == 0, not r["errs"]],
 "resize": lambda r: [r["default1600"] == 528, r["dragged"] == r["default1600"] + 200, r["afterReload"] == r["dragged"], r["afterReset"] == r["default1600"], r["default2560"] == 845, r["selectedVisible"], r["queue"] == 0, not r["errors"]],
 "back": lambda r: [not r["inGraph"]["showing"] and r["inGraph"]["len"] == r["start"]["len"] + 1, r["afterBack"]["showing"] and r["afterBack"]["selected"] == "render", not r["afterForward"]["showing"],
   r["secondTrip"]["len"] == r["inGraph"]["len"] and r["secondBack"]["showing"], len({x["url"] for x in (r["start"], r["inGraph"], r["afterBack"], r["afterForward"], r["secondBack"])}) == 1, not r["routerWarnings"], r["queue"] == 0, not r["errors"]],
 "openin": lambda r: [r["defaultSetting"] == "Side panel", r["panelMode"]["inspecting"] and r["panelMode"]["panelInInspector"] and not r["panelMode"]["opened"],
   r["switched"]["setting"] == "The brick itself" and r["switched"]["opened"] == "rack" and r["switched"]["rackPanelInBrick"] and not r["switched"]["inspecting"] and r["switched"]["openWidth"] >= 400,
   r["addDial"] and r["stillOpen"] == "rack", r["closedByHeader"] is None, r["renderOpen"]["opened"] == "render" and not r["renderOpen"]["junk"] and r["renderOpen"]["wiredLists"] == 1 and r["renderOpen"]["chipsOutside"] == 0,
   r["afterEsc"] is None, r["afterDrag"] is None, r["afterReload"]["setting"] == "The brick itself" and r["afterReload"]["opened"] == "models",
   r["backToPanel"]["setting"] == "Side panel" and r["backToPanel"]["inspecting"] and r["backToPanel"]["panelInInspector"], r["queue"] == 0, not r["errors"]],
 "dropkeys": lambda r: [r["firstFrame"]["added"] == 0 and r["firstFrame"]["value"].startswith("snapdrop_"), r["refs"]["pictures"] == 1, r["models"]["added"] == 0 and "doesn't take" in r["models"]["toast"],
   "doesn't take audio" in r["audioOnFirstFrame"]["toast"], [r["right1"], r["right2"], r["left1"], r["downIgnored"]] == ["rack", "first_frame", "rack", "rack"], r["altRightOrder"] == ["models", "preset", "first_frame"], r["queue"] == 0, not r["errors"]],
 "takes": lambda r: [len(r["strip"]) == 3 and all(s["img"] for s in r["strip"]), r["rankingAfterDrags"] == [r["strip"][0]["id"], r["strip"][2]["id"]], [x[1] for x in r["stripOrder"]] == ["#1", "#2", ""],
   len(r["viewerNotes"]) == 1 and "composition" in r["viewerNotes"][0] and "▭" in r["viewerNotes"][0], r["compareCaptions"] == ["A", "B"], "Recorded" in r["judgeToast"],
   "2 settings" in r["priorToast"] and r["restored"] == {"color": 3158271, "width": 384}, r["afterUndo"] == 64, r["agentList"] == [[3, 1, "keep", True, 1], [1, 2, None, False, 0], [2, None, "reject", False, 0]], r["agentNote"]["notes"] == 1, not r["errors"]],
 "video": lambda r: [r["stripVideo"]["src"], r["player"] == {"duration": 5.88, "w": 1280, "h": 704}, r["afterStep"] == 3.542, r["note"]["t"] == 3.542 and r["note"]["tags"] == ["hands"] and len(r["note"].get("region", [])) == 4, r["marker"] == 1,
   re.search(r"_f\d+\.png$", r["continue"]["firstFrame"]) and "is now the First frame" in r["continue"]["toast"], r["meaning"]["byMeaning"] and r["meaning"]["first"].startswith("Kon"), r["queue"] == 0, not r["errors"]],
 "dials": lambda r: ["+ Dial" in r["empty"] and "✦ Make a dial" in r["empty"], r["picker"]["tiles"] == 77 and r["pickerAll"] == 83, r["search"] == ["frozen ↔ zoomies"] * 2,
   r["row"]["ends"] == ["frozen", "zoomies"] and r["row"]["bands"], [s for _, s in r["afterSlide"]["widget"]] == [1.25] and r["afterSlide"]["panel"] == [1.25], r["libraryDials"]["n"] >= 1,
   r["make"]["posted"] == 1 and len(r["make"]["targets"]) == 1 and r["make"]["name"] == "calm_sea_stormy_sea" and r["make"]["labels"] == ["calm sea", "stormy sea"] and r["make"]["useful"] == 0,
   r["make"]["pairs"].count("|||") == 2, r["make"]["nodeRemoved"], "didn't take" in r["make"]["status"], not r["errors"]],
 "agentfull": lambda r: [r["mcpTools"]["n"] == 182 and not r["mcpTools"]["has"], r["setSeed"] == 1234, "wired from Render Preset" in r["setWired"], "takes one of" in r["badChoice"] and bool(r["goodChoice"]),
   "dials/h3_motion_hook.safetensors" in r["dialsFound"], r["setDial"]["strength"] == 1.5, r["uiSelect"]["selected"] == "rack", r["uiDials"] == "Dials" and r["uiClose"] is None,
   r["upload"]["set"]["value"] == r["upload"]["name"], bool(r["run"].get("proposed") and r["makeDial"].get("proposed")), [p["tool"] for p in r["proposals"]] == ["run", "make_dial"],
   r["undo"]["after"] != r["undo"]["before"] and r["undo"]["redone"] == r["undo"]["before"], r["webmcp"].get("count") == 177 and r["webmcp"].get("strength") == -0.75 and r["webmcp"]["consequential"]["consequentialHint"], r["queue"] == 0, not r["errors"]],
 "sight": lambda r: [r["before"]["isError"] and "Let agents see" in r["before"]["text"], r["button"].endswith("Agents can see"), not r["after"]["isError"] and r["after"]["types"] == ["image", "text"] and r["after"]["mime"] == "image/jpeg" and r["after"]["bytes"] > 10000,
   r["stopped"].endswith("Let agents see"), r["queue"] == 0, not r["errors"]],
 "models": lambda r: [r["created"]["model"].startswith("h3/") and r["created"]["lora"].startswith("h3/pika") and r["created"]["current"] == {"name": "Pika H3 Flex", "edited": False},
   r["models"] == {"clip": "h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "video": "h3/minimax_h3_video_vae_fp16.safetensors", "audio": "minimax_h3_audio_vae_fp32.safetensors", "missing": ["models.vae_name=minimax_h3_audio_vae_fp32.safetensors"]},
   [c["missing"] for c in r["chips"]] == [False, True] and "21.0 GB" in r["chips"][0]["text"] and r["chips"][0]["title"].startswith("h3/"), r["presetFace"][0] == "MiniMax H3 · Pika H3 Flex ▾" and len(r["presetFace"]) == 4 and "21.0 GB" in r["presetFace"][1] and r["presetFace"][3].startswith("Turbo: pika_h3_flex_fl2va"),
   r["edited"]["current"]["edited"] and r["edited"]["bar"] == "inline" and r["edited"]["chip"] == "MiniMax H3 · Pika H3 Flex · edited ▾" and r["edited"]["pill"].startswith("MiniMax H3 · Pika H3 Flex · edited ·"),
   r["outside"]["button"] == "1 node outside the recipe ›" and not r["outside"]["strayInTargets"] and r["outside"]["innerTargets"] > 0 and r["outside"]["strayMissing"],
   [s["name"] for s in r["sheet"]][:3] == ["Pika H3 Flex", "Pika + reference pictures", "DMAD speed LoRA"] and r["sheet"][0]["on"] and r["sheetTitle"] == "MiniMax H3 · 77 dials",
   "DMAD" in r["dmad"]["lora"] and r["dmad"]["schedule"] == "simple" and r["dmad"]["current"] == {"name": "DMAD speed LoRA", "edited": False} and r["dmad"]["sheetClosed"],
   "pika" in r["afterUndo"]["lora"] and r["afterUndo"]["steps"] == 8 and r["afterUndo"]["current"]["edited"],
   [s[:2] for s in r["listSetups"]][:3] == [["Pika H3 Flex", "MiniMax H3"], ["Pika + reference pictures", "MiniMax H3"], ["DMAD speed LoRA", "MiniMax H3"]] and {"MOSS-Image", "Krea 2"} <= {s[1] for s in r["listSetups"]}, r["applySetup"]["setup"] == {"name": "Pika H3 Flex", "edited": False},
   r["listModels"]["count"] == 1 and len(r["listFolders"]) == 4, r["basenameWidget"] == "h3/minimax_h3_video_vae_fp16.safetensors" and "DMAD" in r["basenameSetting"]["value"] and "not a choice" in r["badSetting"]["error"],
   r["describe"]["family"] == "MiniMax H3" and r["describe"]["total_gb"] > 40 and r["describe"]["checks"][0]["ready"] is False,
   r["pickerH3"] == {"on": "MiniMax H3 dials", "tiles": 77} and r["pickerKrea"] == {"on": "MiniMax H3 dials", "tiles": 77}, r["rackWarn"] is None and r["pill"].startswith("MiniMax H3 ·") and "encoder type krea2 doesn't fit MiniMax H3" in (r["typeWarn"] or ""),
   r["upscale"]["face"] == ["quality"] and r["upscale"]["check"].startswith("✕ LightX2V not found") and r["upscale"]["fields"] >= 15 and "RelayVSRModelSettings" in r["upscale"]["inside"] and r["upscaleStatus"],
   r["cardPreset"] == {"name": "DMAD speed LoRA", "edited": False}, r["queueAttempts"] == 0, not r["errors"],
   "file not readable" in r["unreadable"]["chip"] and "offloaded_te.safetensors (file not readable)" in r["unreadable"]["status"] and any("offloaded_te" in m and "not readable" in m for m in r["unreadable"]["describe"])],
 "upscale": lambda r: [r["start"]["headline"] == "1280×704 → 2560×1408" and r["start"]["on"] == "2×" and r["start"]["quality"] == ["faithful"],
   r["four"]["headline"] == "1280×704 → 5120×2816" and r["four"]["scale"] == "4" and r["four"]["switch"] == "on" and "2x" not in r["four"]["faces"] and "2×" not in r["four"]["headline"],
   r["liveWidth"] == "960×704 → 3840×2816", r["off"]["switch"] == "off" and r["off"]["scale"] == "4" and r["off"]["off"] and r["off"]["headline"] == "1280×704 (not upscaled)" and r["off"]["check"] is None,
   r["two"]["switch"] == "on" and r["two"]["scale"] == "2" and not r["two"]["off"], r["undo"]["switch"] == "off" and r["undo"]["scale"] == "4",
   all(not s["inspecting"] and s["selected"] is None and s["opened"] is None for s in (r["four"], r["off"], r["two"])), r["start"]["check"].startswith("✕ LightX2V not found"),
   not any("upscale" in f.lower() for f in r["renderPanel"]), "Model" in r["upscalePanel"] and any("X4 model is used for 2×" in t for t in r["upscalePanel"]), r["queue"] == 0, not r["errors"]],
 "graph": lambda r: [r["graph"]["base"] == {"family": "MOSS-Image", "kind": "base", "turbo": None, "role": None, "core": None, "loads": True, "inferred": False},
   r["graph"]["dmd2"]["turbo"]["how"] == "lora" and r["graph"]["dmd2"]["turbo"]["steps"] == 8 and r["graph"]["dmd2"]["role"] == "core" and r["graph"]["dmd2"]["core"] == "turbo",
   r["graph"]["int8row"]["loads"] is False, r["graph"]["merge"]["kind"] == "turbo_merge" and r["graph"]["merge"]["turbo"]["how"] == "merged", r["graph"]["ref2va"] == ["minimax_h3_ref2va_pruned_int8_convrot"],
   r["graph"]["unknown"]["role"] == "unsorted" and r["graph"]["unknown"]["inferred"], r["graph"]["dial"]["role"] == "dial", r["graph"]["inferredTurbo"]["turbo"]["steps"] == 4,
   r["taught"]["role"] == "style" and r["afterReload"] == {"role": "style", "family": "MOSS-Image", "inferred": False}, r["listModels"][0]["core"] == "turbo", r["queue"] == 0, not r["errors"]],
 "image": lambda r: [any("encoder type stable_diffusion doesn't fit MiniMax H3" in w for w in r["h3Warn"]) and any("flux2-vae is for MOSS-Image" in w for w in r["h3Warn"]),
   r["h3After"] == {"type": "minimax", "vae": "h3/minimax_h3_video_vae_fp16.safetensors", "warnings": []},
   [x["family"].split(" · ")[0] for x in r["sheet"]] == ["MiniMax H3", "MOSS-Image", "Krea 2"] and all(c["tab"] and c["about"] for x in r["sheet"][1:] for c in x["cards"] if not c["name"].startswith("Last used")),
   r["tabsAfter"] == r["tabsBefore"] + 1 and r["moss"]["bricks"] == ["image_models", "loras", "rack", "image", "save_image"] and r["moss"]["setup"] == "setup-moss-base" and r["moss"]["type"] == "moss_image" and r["moss"]["expand"] is False and r["moss"]["family"] == "MOSS-Image",
   r["lastUsed"] == [["Last used: MiniMax H3", "MiniMax H3"]],
   r["prompt"]["unet"] == "moss_image_base_int8_convrot.safetensors" and r["prompt"]["lora"] is False and r["prompt"]["rack"] == 1 and r["prompt"]["textgen"] == 1 and r["prompt"]["switch"] is False and r["prompt"]["sampler"] == "er_sde"
     and r["prompt"]["sched"]["steps"] == 25 and r["prompt"]["cfg"] == 3 and r["prompt"]["save"] == "image/dials_image",
   r["turbos"][0] == ["lodestones_kromoss_8step_dmd2_lora", "lora", True], r["turboOn"]["rows"] == [["lodestones_kromoss_8step_dmd2_lora.safetensors", 1, True]] and [r["turboOn"][k] for k in ("steps", "cfg", "sampler")] == [8, 1, "euler"] and "dmd2" in r["turboOn"]["chip"] and not r["turboOn"]["warn"],
   "set_method" in r["agentStack"].get("error", ""), any("2 turbo LoRAs stacked" in w for w in r["stacked"]["warn"]),
   r["afterOff"]["rows"] == [["lodestones_moss_sft_8step_dmd_lora_latest.safetensors", 0.4, True]] and [r["afterOff"][k] for k in ("steps", "cfg", "sampler")] == [25, 3, "er_sde"] and r["afterOff"]["chip"] == "Turbo: lodestones_moss_sft_8step_dmd_lora_latest ▾",  # M3: the person-asked second turbo row is still on
   r["undoOff"]["rows"] == r["stacked"]["rows"] and r["undoOff"]["steps"] == 8,
   r["sftState"]["prompt"] == "my own prompt" and r["sftState"]["unet"] == "moss_image_sft_deband_int8_convrot.safetensors" and r["sftTabs"] == r["tabsAfter"]
     and r["sftState"]["chain"] == ["SkipLayerGuidanceDiTSimple", "TemporalScoreRescaling", "MAIDialRack", "LoadLoraModel", "UNETLoader"] and r["sftState"]["bricks"][-1] == "save_image",
   r["sftTurbos"][0] == ["moss_image_sft_deband_fast_dmd035_int8_convrot", "merged"], any("SFT with no deband fix" in w for w in r["plainSft"]),
   r["picker"]["on"] == "MOSS-Image dials" and "about 4× the H3 strength" in r["picker"]["note"] and "4×" in (r["rackNote"] or ""), r["addDial"].endswith("+4"),
   r["style"]["brick"] == "style" and r["ask"] == 1 and r["asked"] == ["style"],
   r["kreaTabs"] == r["tabsAfter"] + 1 and r["kreaState"]["dtype"] == "fp8_e4m3fn" and r["kreaState"]["sampler"] == "res_multistep" and r["kreaState"]["sched"] == "beta" and not r["krea"]["warnings"],
   r["kreaTurboUnet"] == "krea2/krea2_turbo_fp8_scaled.safetensors" and r["kreaTurbo"]["sampling"] == {"steps": 8, "cfg": 1, "sampler": "ddim", "scheduler": "beta"} and r["kreaOffUnet"] == "krea2/krea-2-raw.safetensors" and r["kreaOff"]["sampling"]["steps"] == 30,
   any("stable_diffusion doesn't fit Krea 2" in w for w in r["kreaWarn"]) and any("can't load in core" in w for w in r["kreaWarn"]) and len(r["kreaFace"]) == 2,
   r["about"].startswith("Krea 2 Raw loaded as fp8"), "▣First frame" not in r["rail"] and "≡Core LoRAs" in r["rail"], r["queue"] == 0, not r["errors"]],
 "slots": lambda r: [[m[0] for m in r["listed"]] == ["esrgan", "resize", "relayvsr", "seedvr2", "stage2", "h3_latent", "tessera", "ltx_spatial"] and r["listed"][0][1] == "ready" and r["listed"][3][2] is False and "needs weights" in r["listed"][3][1],
   r["a"]["keys"][-3:] == ["image", "image_upscale", "save_image"] and r["a"]["saveFrom"] == "ImageScaleBy" and r["a"]["scaleBy"] == 0.5 and r["a"]["headline"] == "1024×1024 → 2048×2048" and r["a"]["quality"][0] == "4× model, scaled to 2×",
   r["four"]["scaleBy"] == 1 and r["four"]["headline"] == "1024×1024 → 4096×4096" and r["four"]["quality"][0] == "4× model" and not r["four"]["inspecting"],
   r["b"]["keys"][-3:] == ["image", "image_resize", "save_image"] and r["b"]["scaleBy"] == 4 and r["b"]["chip"] == "Plain resize ▾" and r["b"]["quality"] == ["lanczos"],
   r["off"]["saveFrom"] == "VAEDecode" and r["off"]["off"] and r["off"]["headline"] == "1024×1024 (not upscaled)" and r["offFactor"] == 4,
   "not wired yet" in r["unwired"]["error"] and "for video recipes" in r["otherMedia"]["error"], any(c["text"].startswith("SeedVR2") and c["disabled"] for c in r["sheet"]),
   r["backToEsrgan"]["up"] == "image_upscale" and r["backToEsrgan"]["scaleBy"] == 1, r["undo"]["up"] == "image_resize" and r["undo"]["off"],
   r["custom"] == {"chip": "Custom: Scale Image to Total Pixels ▾", "listed": "custom"}, r["queue"] == 0, not r["errors"]],
 "fresh": lambda r: [r["invalid"] == [], r["innerMissing"] == [], r["seedModes"] == [["111", "fixed"], ["130", "fixed"]], r["setInner"]["value"] == "increment",
   r["saved"] == {"saved": "workflows/snap fresh test.json", "tab": "workflows/snap fresh test.json"} and r["tabAfter"] == {"path": "workflows/snap fresh test.json", "temporary": False, "modified": False}
   and r["again"] == r["saved"] and r["copy"] == {"saved": "workflows/snap fresh copy.json", "tab": "workflows/snap fresh test.json"} and "exists" in r["clash"].get("error", "") and r["tabAfterCopy"] == r["tabAfter"] and r["inWorkflows"] == [True, True] and "name takes" in r["badName"]["error"],
   r["rank"] == {"ranked": 2, "by": "agent"} and r["personOrder"] == [] and r["agentFile"]["by"] == "agent" and r["agentFile"]["order"] == ["take-fresh-b", "take-fresh-a"],
   r["waiting"] == "1 blind pair waiting" and "set up by an agent" in (r["blindNote"] or "") and r["afterJudge"] == {"pending": 0, "waiting": True}, r["queue"] == 0, not r["errors"]],
 "takestale": lambda r: [r["take1"]["hash"] == 64 and r["take1"]["seed_hash"] == 64, r["unchanged"] == [["Take 1", None, False]], r["afterWidth"] == [["Take 2", None, False], ["Take 1", "stale: Empty Image width changed", False]], r["afterSeed"] == r["afterWidth"],
   "error" not in r["revision"]["first"] and "Empty Image.height" in r["revision"]["second"].get("error", "") and "error" not in r["revision"]["without"] and r["revision"]["schemaHas"] == [True, False],
   r["listed"] == [[1, ["Empty Image.height", "Empty Image.width"]], [2, ["Empty Image.height"]]], r["metaSwitch"] == ["false", "Save metadata"], r["take3"] == {"private": True, "swapped": {"2": "SaveImage"}, "metadata": False}, r["final"][0] == ["Take 3", None, True] and r["final"][1][1].startswith("stale: Empty Image height"), r["queue"] == 3, not r["errors"]],
 "cards": lambda r: [r["base"]["values"] == {"sampler": "er_sde", "schedule": "simple", "steps": 25, "cfg": 3} and "Enhance prompt (LLM)" in r["base"]["about"] and "community runs Base at 50" not in r["base"]["about"],
   r["text"]["values"] == {"sampler": "euler", "schedule": "simple", "steps": 50, "cfg": 3} and r["text"]["family"] == "MOSS-Image", "s_noise 1.05" in r["sft"]["about"],
   r["baseApplied"]["expand"] is False and r["baseApplied"]["steps"] == 25, r["kromossApplied"]["sampler"] == "er_sde" and "node:SkipLayerGuidanceDiTSimple#1" in r["kromossApplied"]["bricks"],
   r["textApplied"] == {**r["kromossApplied"], "setup": "setup-kromoss-text", "sampler": "euler", "steps": 50}, [g["steps"] for g in r["graph"]] == [25, 25] and [g["sampler"] for g in r["graph"]] == ["er_sde", "er_sde"], r["queue"] == 0, not r["errors"]],
 "polish": lambda r: [r["pill"]["oneLine"] and r["pill"]["height"] < 32, r["header"]["runInside"] and r["header"]["title"] >= 80,
   r["placed"] == [{"what": "run ", "brick": None, "inNotes": True, "chainItem": False, "inside": True}, {"what": "preview ", "brick": "image_upscale", "inNotes": False, "chainItem": False, "inside": True}],
   r["seedStart"]["mode"] == "fixed" and r["afterDice"]["seed"] != r["seedStart"]["seed"] and r["diceUndo"] == r["seedStart"]["seed"], r["fixedAfterRun"]["seed"] == r["seedStart"]["seed"],
   r["randomMode"]["mode"] == "random" and r["randomAfterRun"]["seed"] != r["randomMode"]["seed"], r["agentFixed"]["mode"] == "fixed" and r["agentRoll"]["seed"] != r["agentFixed"]["seed"] and "no seed" in r["noSeed"].get("error", ""),
   r["families"] == [["MOSS-Image", "Krea 2", "MiniMax H3"], "MOSS-Image", "Krea 2", "MiniMax H3", None],
   r["toast"]["text"].startswith("Queued") and r["toast"]["shown"] and r["toast"]["clear"] and r["toast"]["top"] < 120,
   {"model", "encoder", "VAE"} <= set(r["imageLabels"]) and not {"unet name", "clip name", "vae name"} & set(r["imageLabels"]),
   {"encoder", "video VAE", "audio VAE", "LoRA"} <= set(r["h3Labels"]) and "vae name" not in r["h3Labels"] and len(r["h3Labels"]) == len(set(r["h3Labels"])), r["queue"] == 0, not r["errors"]],
 "stale": lambda r: ["minimax" in r["before"], r["typeTo"] == "stable_diffusion" and r["typeTo"] in r["afterTool"] and "minimax" not in r["afterTool"], r["typing"], r["afterGraph"]["selected"] == "models" and "krea2" in r["afterGraph"]["panel"], r["queue"] == 0, not r["errors"]],
 "panel": lambda r: [r["opened"]["inspecting"], r["barH"] > 0 and r["atBar"] == "snap-stack" and r["overflows"], r["afterScrollbar"]["inspecting"] and r["afterScrollbar"]["selected"] == "models" and r["afterScrollbar"]["scrollLeft"] > 0,
   r["emptyFound"] and r["afterEmpty"]["inspecting"] and r["afterEmpty"]["selected"] == "models", r["switched"]["selected"] == "rack" and r["switched"]["inspecting"], r["collapseIcon"] == "◐›",
   not r["afterCollapse"]["inspecting"] and r["afterCollapse"]["selected"] is None, not r["afterEsc"]["inspecting"], r["brickOpened"] == "rack" and r["brickAfterScrollbar"] == "rack" and r["brickAfterEmpty"] is None, r["queue"] == 0, not r["errors"]],
 "library": lambda r: [len(r["rackScope"]["cards"]) >= 30 and r["rackScope"]["cards"][0].startswith("Dial: h3_motion"), r["dialApplied"]["chips"] == ["frozen ↔ zoomies +0.50"], not r["wrongDropChanged"], r["rightTargetLit"] == 1, r["kon"]["promptHasKon"], r["scene"]["konTimes"] == 1, r["undoReverted"], not r["errors"],
   len(r["set"]["pictures"]) == 2, len(r["set"]["refInputs"]) == 2 and all("LoadImage:snap/" in x for x in r["set"]["refInputs"]), all(r["set"]["thumbs"]) and len(r["set"]["thumbs"]) == 2, r["set"]["meter"] == "2 of 9 pictures", r["set"]["promptHasBlock"]],
 "switch": lambda r: [r["h1"]["rows"] == [] and [r["h1"]["steps"], r["h1"]["cfg"]] == [r["kromoss"]["steps"], r["kromoss"]["cfg"]] and r["h1"]["chip"] == "Turbo: off ▾" and not r["h1"]["warnings"],
   r["m3Removed"]["chip"] == "Turbo: off ▾", "deband_fast" in r["m3Round"]["chip"] and r["m3AfterOff"]["unet"] == "moss_image_sft_deband_int8_convrot.safetensors" and r["m3AfterOff"]["steps"] == r["sft"]["steps"] and r["m3AfterOff"]["chip"] == "Turbo: off ▾",
   {"image_upscale", "node:FreeU_V2#1"} <= set(r["m1"]["bricks"]) and not any("SkipLayer" in k for k in r["m1"]["bricks"]) and [r["m1"]["width"], r["m1"]["height"], r["m1"]["negative"]] == [768, 1152, "my own negative"] and r["m1"]["saveFrom"] == "ImageScaleBy" and r["m1"]["freeu"] == 1,
   r["m2"]["vae"] == "h3/minimax_h3_lightvae_lite_vae_int8_convrot.safetensors" and r["m2"]["type"] == "minimax",
   r["m4None"] == [] and r["m4Fresh"] == [] and r["m4FreshChip"][0].startswith("✓") and r["m4Gguf"] == [],
   "add_dial" in r["m6Dial"].get("error", "") and "Render Preset" in r["m6Turbo"].get("error", "") and r["m6After"] == r["m6Before"],
   r["h2"]["tabs"] == r["h2TabsBefore"] + 1 and r["h2"]["active"] and r["h2"]["family"] == "Krea 2" and r["h2"]["bricks"] == ["image_models", "loras", "rack", "image", "save_image"] and r["h2"]["old"] == r["m6Before"] and not any("recipe-last" in w for w in r["h2Writes"]),
   r["h2Lib"]["tabs"] == r["h2"]["tabs"] + 1 and r["h2Lib"]["family"] == "MOSS-Image" and "in a new tab" in r["h2Lib"]["toast"] and "snap/card/recipe-last-krea-2.json" in r["h2LibWrites"],
   r["m8"]["loadError"] is None and len(r["m8"]["describe"]) == 1 and "snap/models.json was skipped" in r["m8"]["describe"][0] and isinstance(r["m8"]["setups"], int) and isinstance(r["m8"]["methods"], int) and "snap/models.json" in (r["m8"]["toast"] or ""),
   "doesn't parse" in r["m8Teach"] and r["m8Writes"] == [], r["queue"] == 0 and r["queue8"] == 0, not r["errors"] and not r["errors8"]],
 "plates": lambda r: [r["openings"]["S1"][1].endswith("east wall is on the right") and r["openings"]["S2"][0].endswith("south wall is left of centre") and r["openings"]["S3"][1].endswith("behind the camera, out of view"),
   r["openings"]["walls"] == ["south", "east"] and "the tall window in the east wall is behind the camera" in r["openings"]["block"] and r["openings"]["cameras"] == ["master", "OTS on Kon", "OTS on Ferro", "single Ferro", "single Kon", "set camera"],
   r["wide"]["plate"]["by"] == "agent", bool(r["agentMake"].get("proposed")), [q["camera"] for q in r["made"]["queued"]] == ["master", "OTS on Ferro"] and r["made"]["threshold"] == 0.72 and r["made"]["encoder"].startswith("dino_v3"),
   len(r["orbitPrompts"]) == 2 and all("the camera is not where <Picture 1> was taken" in o["text"] and "Nobody is in the room" in o["text"] and o["score"] and o["group"] == "snap-plates-set-lamp-room-end-s3" and "ref2va" in o["preset"]["model"] and o["preset"]["conditioning"].startswith("Ref2V") and o["wide"].endswith("u21_plate.png") for o in r["orbitPrompts"]),
   "the door in the south wall is on the right" in r["orbitPrompts"][0]["text"].lower(), r["pendingStatus"] == ["master", "OTS on Ferro"],
   (lambda c: c["master"]["plate"]["take"] == "take-" + r["made"]["queued"][0]["prompt_id"] and c["master"]["plate"]["frame"] == "last" and c["master"]["plate"]["copy_score"] == 0.5822 and c["master"]["plate"]["by"] == "person" and c["master"]["plate"]["picked_by"] == "person" and c["master"]["fits"]
     and c["OTS on Ferro"]["plate"] is None and c["OTS on Ferro"]["candidates"]["ready"] == 1)({x["camera"]: x for x in r["status"]["cameras"]}),
   r["ferro"]["candidates"][0]["state"] == "ready" and r["ferro"]["candidates"][0]["notes"]["copy"] == {"score": 0.8969, "threshold": 0.72, "likely_copy": True} and "error" in r["ferro"]["candidates"][0]["notes"].get("layout", {"error": ""}),
   r["editor"]["doors"] == [["door", "south", ""], ["window", "east", "tall window"]] and ["master", "copy 0.58 · picked c1 · person", True] in r["editor"]["tiles"] and ["OTS on Ferro", "1 candidate to pick below", False] in r["editor"]["tiles"] and r["editor"]["make"] == "Make plate candidates for 4 cameras",
   r["doorDrag"]["wall"] == "east" and "the door in the east wall" in r["doorDrag"]["block"].lower(),
   r["compiled"]["picture"]["use"] == "wide" and "the camera is not where <Picture 1> was taken" in r["compiled"]["line"], r["presetBefore"].startswith("FL2V") and r["after"]["conditioning"].startswith("Ref2V") and r["after"]["pictures"] == [["set: plate", "snaptest/u21_plate.png"]] and "reference" in r["after"]["parts"],
   (lambda c: c["master"]["use"] == "plate" and "seen from this camera" in c["master"]["ref"] and c["master"]["pictures"] == [["set: plate", c["master"]["image"]]] and c["exact"]["use"] == "first_frame" and c["exact"]["ref"] is None and c["exact"]["firstFrame"] == c["master"]["image"] and c["exact"]["conditioning"].startswith("FL2V")
     and c["hand"] == {"by": "person", "copy_score": None} and c["own"]["use"] == "plate" and c["moved"]["use"] == "wide" and c["moved"]["fits"] is False and c["none"] is None and not c["noneRef"])(r["choices"]),
   r["copy"]["copy"]["copied"] and r["copy"]["copy"]["against"][0]["last"] >= 0.85 and not r["copy"]["view"]["copied"] and r["copy"]["view"]["against"][0]["last"] < 0.65, bool(r["agentCheck"].get("proposed")),
   dict(r["chips"]) == {"copy": "copied its reference view 0.90", "view": None} and "copied its reference view" in r["viewerLine"] and dict(r["listed"]) == {"copy": True, "view": False}, r["queuedReal"] == 2 and r["refused"] == 0, not r["errors"]],
 "candidates": lambda r: [r["wide"] == "agent" and bool(r["agentMake"].get("proposed")), len(r["made"]["queued"]) == 2 and len({q["decision"] for q in r["made"]["queued"]}) == 1 and len(set(r["orbitSeeds"])) == 2 and r["listed"] == [["set-lamp-room-end-s3/master", 2]],
   (lambda c: [x["state"] for x in c] == ["ready", "ready"] and [x["notes"]["copy"]["likely_copy"] for x in c] == [False, True]
     and all({(row["name"], row["ok"]) for row in x["notes"]["layout"]["rows"]} == {("lamp housing", None), ("lantern", True), ("door", True), ("tall window", False)} and x["notes"]["layout"]["checked"] == 3 and x["notes"]["layout"]["as_planned"] == 2 for x in c))(r["plateCands"]["candidates"]),
   sorted(r["layoutWords"]) == ["door", "lamp housing", "lantern", "window"],
   r["preview"]["previewing"] and r["preview"]["tag"] and r["preview"]["src"].endswith("copy_f106.png&subfolder=snaptest&type=input") and r["revPreview"] == r["revBefore"] and not r["nullText"],
   [t[1] for t in r["tiles"]] == [["copy 0.58", "layout 2/3"], ["likely copy 0.90", "layout 2/3"]] and all(t[2] == ["Apply", "Reject"] for t in r["tiles"]),
   bool(r["agentApply"].get("proposed")) and "person's pick" in r["agentApply"]["status"] and r["rec"] and r["rec"][0][0] == "c1" and "recommends this one" in r["rec"][0][1] and r["noPlateYet"] is None,
   r["applied"]["plate"]["candidate"].endswith("/c1") and r["applied"]["plate"]["picked_by"] == "person" and r["applied"]["plate"]["take"] == "take-" + r["made"]["queued"][0]["prompt_id"] and r["applied"]["fits"] and r["proposalAfter"] == ["accepted"],
   r["undone"] == {"plate": None, "state": ["ready", "ready"]}, [c["state"] for c in r["final"]["decision"]["candidates"]] == ["applied", "rejected"] and r["final"]["decision"]["applied"]["by"] == "person" and r["final"]["plate"]["candidate"].endswith("/c1"),
   bool(r["agentShot"]["plates"].get("proposed")) and "the set's wide plate" in r["agentShot"]["done"], r["demand"]["queued"] == 2 and "rendering 2 candidates" in (r["demand"]["toast"] or "") and r["demand"]["picture"] == "wide" and bool(r["again"].get("waiting")),
   r["recompiled"]["use"] == "plate" and r["recompiled"]["camera"] == "OTS on Ferro" and "seen from this camera" in r["recompiled"]["ref"],
   bool(r["agentEdit"].get("proposed")), [a["frames"] for a in r["anchors"]] == [[0, 53], [0, 53]] and [a["lora"] for a in r["anchors"]] == ["akhaliq_moss_edit_hq_armV5.safetensors", "chinoll_moss_image_edit_adapter.safetensors"] and [a["cfg"] for a in r["anchors"]] == [3, 5]
     and all("to night" in a["text"] and "hair colour" in a["text"] and not a["client"].startswith("snap-edit-") and a["job"]["kind"] == "paint" and a["job"]["takes"] is False for a in r["anchors"]),
   (lambda c: [(x["notes"]["identity"]["lighter"], x["notes"]["identity"]["different"], x["notes"]["identity"].get("face_unreliable")) for x in c] == [(True, False, "relight"), (False, False, "relight")] and c[1]["notes"]["identity"]["face_low"] < 0.35 and c[0]["notes"]["identity"]["different_below"] == 0.45 and c[0]["notes"]["identity"]["hair_lighter"] == 10 and [len(x["pictures"]) for x in c] == [2, 2])(r["editCands"]["candidates"]) and r["identityPairs"] == [0, 53, 27, 80],
   r["identityNodes"] == {"identity": 6, "sam": sorted(["face:9"] * 6 + ["hair"] * 6), "loader": "cvlface_arcface_ir101_webface4m.safetensors", "encoder": "dino_v3_vit_h_bf16.safetensors"} and r["crops"] == 8
     and r["identityChips"][0] == [["identity unreliable under relighting", False], ["hair lighter than original", True]] and r["identityChips"][1][0] == ["identity unreliable under relighting", False]
     and len(r["identityChips"][1]) == 2 and re.fullmatch(r"hair [+-]?\d+(\.\d)?", r["identityChips"][1][1][0]) and not r["identityChips"][1][1][1],
   r["editPreview"]["shown"] and "frame 53" in r["editPreview"]["tag"] and abs(r["editPreview"]["t"] - 53 / 24) < 0.05 and r["revEdit"] == r["revEditBefore"],
   r["ripple"]["loras"][0].endswith("minimax_H3_Ripple-v1.safetensors") and "turbo_4step" in r["ripple"]["loras"][1] and r["ripple"]["guides"] == [0, 0, 53] and r["ripple"]["length"] == 107 and r["ripple"]["guide"] == "snaptest/day_take.mp4 [input]"
     and r["ripple"]["anchors"] == ["snaptest/night_f0.png [input]", "snaptest/night_f45.png [input]"] and r["ripple"]["mine"] and r["ripple"]["group"] == r["childGroup"],
   r["child"]["parent"]["candidate"] == "c1" and r["child"]["parent"]["method"] == "edit/relight" and r["child"]["group"] == r["childGroup"] and r["child"]["stale"] is None and r["child"]["media"] == ["output/video/snap_edits/fixture_night_00001_.mp4"] and "→ Take 2" in (r["editAfter"] or ""),
   "reject its take" in r["editUndo"], r["chip"] == "↳ night of take 1",
   r["useFirst"]["frame"] == 24 and r["useFirst"]["file"].endswith("_f24.png") and r["fromChip"] == "↳ take 1, frame 24" and r["firstUndone"] == r["firstBefore"], r["useRef"]["frame"] == 106 and "take 1, frame 106" in r["refPics"],
   r["got"] == {"orbit": 4, "layout": 4, "identity": 2, "edit": 2, "ripple": 1} and r["refused"] == 0 and r["queue"] == 0, not r["errors"]],
 "methods": lambda r: [r["enum"] == ["upscale", "turbo", "edit", "extend", "region", "recast", "view", "sheet", "smooth"], r["upscale"]["ids"] == ["esrgan", "resize", "relayvsr", "seedvr2", "stage2", "h3_latent", "tessera", "ltx_spatial"] and r["upscale"]["current"] is None and r["upscale"]["relayFits"] is False,
   r["upscale"]["esrgan"]["guidance"]["line"] == "my own line" and r["upscale"]["esrgan"]["guidance"]["evidence"] == "measured" and r["upscale"]["esrgan"]["cost"]["community_s"] == [1, 2] and r["upscale"]["esrgan"]["local_or_api"] == "local",
   len(r["turboShape"]) > 0 and all(r["turboShape"]) and r["turboKind"] == "delta", r["smooth"]["methods"][0]["id"] == "rife" and r["smooth"]["methods"][0]["wired"] is False,
   r["h4List"] == {"current": None, "custom": 0} and "node:RescaleCFG#1" in r["h4"]["keys"] and r["h4"]["keys"][-2:] == ["image_upscale", "save_image"] and r["h4"]["saveFrom"] == "ImageScaleBy" and all(c[0] != "node:RescaleCFG#1" for c in r["h4"]["chips"]),
   r["m5Unknown"]["scaleBy"] == 1 and "unknown" in r["m5Unknown"]["headline"] and "unknown" in r["m5Unknown"]["facts"][0], r["m5Graph"]["scaleBy"] == 0.5 and r["m5Graph"]["headline"] == "1024×1024 → 2048×2048",
   r["offUpscale"]["on"] is False and "error" not in r["offTurbo"], bool(r["previewProposed"].get("proposed")) and r["previewRun"]["targets"] == [r["saveId"]] and r["previewTargets"] == [[r["saveId"]]],
   r["h3List"]["current"] == "custom" and r["h3"]["keys"][-2:] == ["image_upscale", "save_image"] and r["h3"]["saveFrom"] == "ImageScaleBy" and r["h3"]["scaleBy"] == 1 and r["h3"]["custom"] == 0 and r["h3"]["headline"] == "1024×1024 → 4096×4096",
   r["h3WiredBefore"]["saveFrom"] == "ImageScaleToTotalPixels" and r["h3WiredAfter"]["saveFrom"] == "ImageScaleBy" and r["h3WiredAfter"]["scaleFrom"] == "VAEDecode" and r["h3WiredAfter"]["custom"] == 0 and r["h3WiredAfter"]["scaleBy"] == 2,
   any("measured: my own line" in t for t in r["sheet"]) and any("community: 1-2 s" in t for t in r["sheet"]), r["turboSheet"][0].startswith("Off") and len(r["turboSheet"]) > 1, r["queue"] == 1, not r["errors"]],
 "u58": lambda r: [r["fresh"]["mode"] == 4 and r["fresh"]["value"] is None and r["fresh"]["missing"] == 0 and r["fresh"]["loadImage"] == 0 and "LoadImage" not in r["fresh"]["errors"],
   r["fresh"]["face"][0] and r["fresh"]["face"][1] == "the prompt" and "text to video" in r["fresh"]["face"][2], r["onEmpty"]["loadImage"] == 1 and "LoadImage" in r["onEmpty"]["errors"], r["afterPicture"] == 0 and "error" not in r["pictureTurnsOn"],
   r["setup"]["cards"][:2] == ["models", "rack"] and "preset" not in r["setup"]["cards"] and r["setup"]["engine"][:2] == ["models", "preset"] and r["setup"]["title"] == "Setup",
   r["setup"]["face"][0].startswith("MiniMax H3 · ") and "21.0 GB" in r["setup"]["face"][1] and r["setup"]["face"][-1].startswith("Turbo: pika_h3_flex"), r["setup"]["selected"] == "models" and r["setup"]["sections"][:2] == ["Models", "Sampling"] and all(r["setup"]["samplingHas"]),
   r["setup"]["moved"] == ["rack", "models", "preset"] and r["setup"]["undone"] == ["models", "preset", "rack"], r["setup"]["applied"][0] and r["setup"]["applied"][1] is None and r["setup"]["applied"][0] in r["setup"]["chipAfter"],
   r["setup"]["afterX"] == [] and r["setup"]["afterXUndo"] == ["models", "preset"] and "Setup" in r["setup"]["lanes"] and "Render Preset" not in r["setup"]["lanes"],
   r["moss"]["expand"] is False and r["moss"]["toggle"][0] == "✨ Enhance prompt (LLM)" and r["moss"]["toggle"][1] == "off" and "rewrites your prompt" in r["moss"]["toggle"][2],
   r["moss"]["cards"][0] == "image_models" and "loras" not in r["moss"]["cards"] and r["moss"]["turboOnSetup"] == 1 and r["moss"]["turboOnRender"] == 0 and r["moss"]["sections"][:2] == ["Models", "Sampling"], r["moss"]["turbo"]["steps"] == 8 and "dmd2" in r["moss"]["turbo"]["chip"],
   r["meta"]["setting"] is True and r["meta"]["beforeRun"] and r["meta"]["label"] == "Save metadata" and r["meta"]["checked"] == "true", r["meta"]["off"] == {"setting": False, "checked": "false", "read": "off"},
   r["meta"]["reloaded"] == {"on": False, "checked": "false"} and r["meta"]["tool"].get("metadata") == "on" and "on" in r["meta"]["bad"].get("error", ""), r["meta"]["flags"] == ["absent", False, False, "absent"] and r["meta"]["final"] is True,
   r["methods"]["enum"] == ["upscale", "turbo", "edit", "extend", "region", "recast", "view", "sheet"] and [m[0] for m in r["methods"]["extend"]] == ["chain", "long", "geiru"] and [m[0] for m in r["methods"]["region"]] == ["crop_inpaint"],
   all(m[1] is True for m in r["methods"]["extend"]) and r["methods"]["region"][0][1] is False and r["methods"]["extend"][1][2].startswith("needs the nodes H3Clown") and r["methods"]["region"][0][2].startswith("needs the nodes MVEx_"),
   dict(r["methods"]["installed"]) == {"chain": "ready", "long": "ready", "geiru": "needs weights in models/loras (antiburn)", "crop_inpaint": "needs weights in models/checkpoints (sam3)"},
   [c[1] for c in r["methods"]["sheet"]] == [True, True, True], not r["errors"]],
 "scenes": lambda r: (lambda f, ours: [r["onBridge"] == ["list_scenes", "get_scene", "create_scene", "add_shot", "open_shot", "set_active_take", "move_shot"], "needs a name" in r["noName"]["error"] and r["created"]["shots"] == [],
   [(t["label"], [v["label"] for v in t["versions"]]) for t in r["adopted"]["shot"]["takes"]] == [("Take 1", []), ("Take 2", ["Night version"]), ("Take 3", [])] and r["adopted"]["shot"]["active"] == f["ids"][1] and r["groupStill"] == 4 and r["workflowFile"] == 200,
   [x["parent"] for x in r["file"]["shots"][0]["takes"]] == [None, None, None, f["ids"][1]] and r["file"]["shots"][0]["groups"] == [f["group"]] and r["afterAdopt"]["scene"] is None and r["afterAdopt"]["bar"] == "snap-scene scratch",
   any(row[1] == "1 shot · 4 takes" for row in r["sheet"]), r["opened"]["scene"] == ours and r["opened"]["tabs"] == f["tabs"] + 1 and r["opened"]["temporary"] and r["opened"]["tab"].endswith("· Shot 1") and r["opened"]["crumbs"][1:] == ["Shot 1", "Take 2 ★"] and r["scratchKept"] == f["nodes"],
   [x.get("title") or [y["title"] for y in x["family"]] for x in r["tree"]] == ["Take 3", ["Take 2", "Night version"], "Take 1"] and r["tree"][1]["family"][0]["star"] == "★ active" and r["tree"][1]["family"][1]["of"] == "⟵ take 2" and r["heading"] == "Shot 1 · takes",
   r["nightActive"]["state"]["crumbs"][-2:] == ["Take 2", "Night version ★"] and r["nightActive"]["file"] == f["ids"][3] and "★ Night version" in r["nightActive"]["state"]["tiles"][0][2],
   r["viewer"]["crumbs"][1:] == ["Shot 1", "Take 2", "Night version"] and r["viewer"]["active"] == "★ Shot 1's active take", bool(r["agentPick"].get("proposed")) and "isn't a take" in r["notTaken"]["error"],
   r["menu"] == ["New shot: same setup, no characters or pictures", "Copy Shot 1 as it is", "Shot 4: Kon hands Ferro the letter"] and r["shot2"]["tabs"] == r["opened"]["tabs"] and r["shot2"]["graph"] != r["opened"]["graph"] and r["shot2"]["prompt"].startswith("integrated_multimodal_description: [shot 4]") and r["shot1Saved"] == r["opened"]["graph"],
   r["backTo1"]["graph"] == r["opened"]["graph"] and r["backTo1"]["tabs"] == r["opened"]["tabs"] and "EDITED ON SHOT 2" in r["backTo2"]["prompt"] and r["backTo2"]["graph"] == r["shot2"]["graph"],
   r["started"]["scene"] is None and r["started"]["tabs"] == r["backTo2"]["tabs"] + 1 and r["started"]["bar"] == "snap-scene scratch", r["openFromScratch"]["shot"] == r["backTo1"]["shot"] and r["openFromScratch"]["tabs"] == r["started"]["tabs"],
   r["openTool"]["tab"] == "same" and r["inPlace"]["tab"].endswith("Kon hands Ferro the letter") and r["chainFollows"], r["moved"]["order"][0] == r["shot2"]["shot"] and r["afterMove"]["tiles"][0][0] == r["shot2"]["shot"],
   r["contTake"]["parent"] == {"take": f["ids"][1], "method": "continue", "frame": 106} and r["contTake"]["label"] == "Continued from frame 106" and r["contTake"]["group"] == f["group"] and [y["title"] for y in r["contTree"][1]["family"]] == ["Take 2", "Night version", "Continued from frame 106"],
   "Add this workflow" in r["adoptSheet"] and r["adoptFile"]["scene"] == ours and r["adoptFile"]["tabs"] == r["started"]["tabs"] + 1 and r["fileUnchanged"] and r["savedTabKept"],
   len(r["final"]["shots"]) == 3 and r["final"]["shots"][0]["active_path"] == ["Take 2", "Night version"] and r["final"]["open"] == r["adoptFile"]["shot"] and any(x["id"] == ours and x["open"] and x["shots"] == 3 for x in r["list"]),
   r["phone"] == {"scroll": True, "bar": True}, r["queue"] == 0, not r["errors"]])(r["fixture"], r["created"]["id"]),
 "onboarding": lambda r: [r["foldersBefore"] == 0 and r["profileBefore"] == 404,
   r["untouched"] == {"opened": False, "profile": 404, "templates": 1} and r["coreFirstRun"]["templates"] == 0, r["auto"]["opened"] and r["auto"]["title"] == "What do you want to make?" and r["auto"]["profile"] == [] and not r["auto"]["again"],
   any(l.startswith("measured on an RTX 5090 (32 GB) · 2026-11-04") for k in r["kit"]["kits"] for c in k["cards"] for l in c["lines"]) and not any("this machine" in l for k in r["kit"]["kits"] for c in k["cards"] for l in c["lines"]),
   r["agent"]["edit"]["fast"] is None and r["agent"]["edit"]["fast_note"] == "no measured fast option yet", sorted(r["tools"]) == ["get_profile", "list_kits", "propose_downloads", "scan_models", "set_profile"], r["emptyLink"] == "New here? Set up Snap",
   r["intent"]["on"] == ["Video with sound"] and "GPU" in r["intent"]["hw"], r["scanAsk"]["button"] == "Look through them",
   r["scan"]["rows"] == [["Video with sound", "Pika H3 Flex", "5 missing"], ["Stills", "MOSS-Image Base (int8)", "3 missing"]] and r["scan"]["line"] == "Your model folders are empty.",
   r["metadata"]["on"] == "Yes" and r["metaSetting"] is True, "not a safety guarantee" in r["sfw"]["note"], len(r["local"]["rows"]) == 5 and all(x[1] == "Local only" for x in r["local"]["rows"]),
   [k["title"] for k in r["kit"]["kits"]] == ["Video with sound", "Stills"] and [[c["label"], c["title"]] for c in r["kit"]["kits"][1]["cards"]] == [["Recommended for you", "MOSS-Image Base (int8)"], ["Fast option", "Kromoss + DMD2 8-step"]]
     and all("missing" in c["state"] for k in r["kit"]["kits"] for c in k["cards"]) and all(k["try"].startswith("Try this first") for k in r["kit"]["kits"]) and "Snap never downloads" in r["kit"]["downloads"],
   "MOSS-Image SFT DeBand (int8)" in r["expanded"]["also"] and any((x["code"] or "").startswith("curl -L --fail -o") and "/models/diffusion_models/" in x["code"] for x in r["expanded"]["rows"]) and all(x["code"] for x in r["expanded"]["rows"]),  # F17: every row listed as required has a command
   r["saved"]["intents"] == ["video", "stills"] and r["saved"]["sfw_only"] is True and r["saved"]["api_tasks"] == [] and r["saved"]["answered"] == ["intent", "scan", "metadata", "sfw", "local", "code"] and not r["saved"]["done"],
   r["resumed"] == "Your setups", r["opened"]["tabs"] == 1 and len(r["opened"]["nodes"]) == 2 and all(r["opened"]["nodes"]) and not r["opened"]["sheet"] and "one tab each" in r["opened"]["toast"] and r["opened"]["missing"] > 0,
   r["done"]["done"] is True and r["done"]["answered"][-1] == "kit",
   r["agent"]["proposal"]["downloaded"] is False and r["agent"]["proposal"]["total_gb"] > 0 and r["agent"]["scan"]["models_here"] == 0 and r["agent"]["profile"]["profile"]["intents"] == ["video", "stills"], r["foldersAfter"] == 0, r["offsite"] == [] and r["queued"] == 0,
   r["sfwB"]["after"] == r["sfwB"]["before"] - 1 and r["sfwB"]["listed"] is False and r["sfwB"]["library"] is False and r["sfwB"]["tile"] is False and r["sfwB"]["back"] == r["sfwB"]["before"],
   "SFW only" in (r["sfwB"]["libraryNote"] or "") and "SFW only" in r["sfwB"]["add"].get("error", "") and "SFW only" in r["sfwB"]["picker"],
   r["apiOff"] == [] and [x[1] for x in r["apiOn"]] == ["api"] and "credits" in r["apiOn"][0][2], not r["errorsA"] and not r["errorsB"],
   r["code"]["title"] == "Should agents read new code first?" and "It costs tokens" in r["code"]["line"] and r["code"]["on"] == ["Only code Snap doesn't know (default)"] and len(r["code"]["choices"]) == 3,
   r["saved"].get("code_review") == "always" and r["review"]["setting"] == "always" and r["review"]["profile"] == "always",
   r["review"]["always"][0]["known"] is True and r["review"]["always"][0]["review"] == "required" and r["review"]["always"][0]["safety"]["network_at_import"] is False and r["review"]["always"][0]["license"] == "GPL-3.0"
     and r["review"]["always"][1]["known"] is False and r["review"]["always"][1]["review"] == "required" and r["review"]["always"][1]["command"].startswith("git clone https://github.com/example/some-new-pack"),
   r["review"]["unknown"] == ["skipped (your setting)", "required"] and r["review"]["settingAfterTool"] == "unknown",
   r["review"]["profileAfterRow"] == "never" and r["review"]["never"] == ["skipped (your setting)", "skipped (your setting)"]],
 "categories": lambda r: [r["rail"][0].startswith("dial") and r["sheet"]["on"].startswith("dial") and r["sheet"]["rows"] > 0, r["search"]["n"] > 1 and r["search"]["allCam"],
   any(c.startswith("style1") for c in r["moved"]["chips"]) and r["moved"]["own"]["role"] == "style" and r["moved"]["tool"] == [r["x"]] and r["moved"]["picker"] and "undo move" in " ".join(r["moved"]["rail"]),
   r["styleRows"] == [r["x"]], r["dropped"] == "style", r["undone"] == {"y": "dial", "x": "style", "own": False}, r["cardMoves"] > 0 and r["tileMoves"] > 0, r["reload"]["x"] == "style",
   r["pack"] == "core" and r["person"] == {"now": "style", "entry": "style"} and r["personBack"] == "core",
   r["nsfwShown"] and not r["sfw"]["rail"] and r["sfw"]["tool"] == 0 and not r["sfw"]["sheet"]["x"] and not any(c.startswith("nsfw") for c in r["sfw"]["sheet"]["chips"]) and "SFW only" in r["sfw"]["sheet"]["head"],
   r["queued"] == 0, not r["errors1"] and not r["errors2"],
   set(r["u67"]["not"].values()) == {"unsorted"} and set(r["u67"]["fast"].values()) == {"core·turbo"} and r["u67"]["chip"] == "core · turbo10",
   r["u67"]["mossTurbos"][0] == "lodestones_kromoss_8step_dmd2_lora" and r["u67"]["kreaTurbos"] == ["krea2_turbo_fp8_scaled", "krea2_turbo_lora_rank_64_bf16"],
   r["u67"]["person"] == {"now": "core·turbo", "slot": True} and r["u67"]["personBack"] == "unsorted" and not set(r["u67"]["not"]) & set(r["u67"]["sheet"]) and not r["errors3"],
   sorted(r["u71"]["take"]) == [["take-u71-lock", True], ["take-u71-version", True]] and r["u71"]["saved"] is None,
   r["u71"]["tool"] == ["snaptest_stamped_lora.safetensors"] and r["u71"]["dialPrivate"] == 0 and [f for f, l in r["u71"]["sheet"] if l] == ["snaptest_stamped_lora.safetensors"] and len(r["u71"]["sheet"]) > 1,
   r["u71"]["added"].get("brick") == "style" and [t.replace("\u200b", "") for t in r["u71"]["row"]] == ["🔒 snaptest_stamped_lora"] and r["u71"]["option"] and all("🔒 snaptest_stamped_lora" in o for o in r["u71"]["option"]) and not r["errors4"]],
 "u62": lambda r: [r["wide"] == "agent", bool(r["offer"].get("plates", {}).get("proposed")) and r["offer"]["plates"]["camera"] == "OTS on Ferro" and r["offer"]["plates"]["plan"]["renders"] == 2,
   [(p["tool"], p["args"], p["renders"]) for p in r["pending"]] == [("make_set_plates", {"set": "set-lamp-room-end-s3", "cameras": ["OTS on Ferro"]}, 2)] and "has no camera plate yet" in r["pending"][0]["reason"],
   "has no camera plate yet" in r["toast"] and "waits for your yes" in r["toast"] and r["pendingAgain"] == 1 and r["queued"] == 0 and r["pill"].startswith("1 proposal"),
   r["renamed"]["name"] == r["renamed"]["tile"] == "The letter, over Ferro" and r["renamed"]["tab"].endswith("Shot 1 · The letter, over Ferro") and "Renamed" in r["toastRename"],
   len(r["afterRemove"]["shots"]) == 1 and [x[1:] for x in r["afterRemove"]["removed"]] == [["Spare", "person"]] and r["afterRemove"]["tiles"] == 1 and r["afterRemove"]["workflowKept"] == 200 and "kept" in r["removedToast"],
   bool(r["agentRemove"].get("proposed")) and "person's pick" in r["agentRemove"]["status"],
   r["setupNote"].startswith("You're in") and "scratch tab" in r["setupNote"] and r["setupTabs"] == ["opens a scratch tab, outside this scene"],
   r["sceneRenamed"]["file"] == r["sceneRenamed"]["row"] and r["sceneRenamed"]["crumb"] == "🎬 " + r["sceneRenamed"]["file"] and "_parked" in r["confirm"],
   r["deleted"] == {"original": 404, "parked": 200, "parkedBy": "person", "parkedShots": 1, "shotFile": 200, "listed": False, "row": False, "bar": "snap-scene scratch"} and "parked" in r["deletedToast"] and "kept" in r["deletedToast"],
   r["withdrawn"]["all"] == [["withdrawn", "scene deleted"]] and not any("remove shot" in x for x in r["withdrawn"]["shown"]) and "1 agent proposal about it withdrawn" in r["deletedToast"],
   r["agentRename"]["name"].startswith("Renamed by agent") and "needs a name" in r["blankName"]["error"], r["queue"] == 0, not r["errors"]],
 "compat": lambda r: [r["loaded"]["legacy"] == {"node": "191", "upscale": "off"} and "upscale" not in r["loaded"]["shown"] and "older H3 blueprint" in r["loaded"]["note"], r["sameQueue"], r["innerSave"] == [[True, "video/dials_simple"]] and r["switchValue"] == "off",
   "upgrade_render" in r["refuse"]["save"] and "upgrade" in r["refuse"]["method"] and r["refuse"]["describe"]["upscale"] == "off",
   r["upgraded"]["bricks"][-3:] == ["render", "upscale", "save_video"] and r["upgraded"]["legacy"] is None and r["upgraded"]["note"] is None and "Upscale on" in r["toast"],
   r["compare"] == {"prompt": True, "seed": True, "relay": True, "save": [[False, "video/dials_simple", "RelayVSRUpscaleVideo"]], "switches": 1, "classes": -2}, r["upscaleOn"],
   r["undone"]["legacy"] == {"node": "191", "upscale": "RelayVSR 2x"} and r["undoSameQueue"], r["offUpgrade"] == {"bricks": ["models", "preset", "rack", "refs", "render", "upscale", "save_video"], "off": True, "relayQueued": False, "saveFrom": True},
   r["queue"] == 0, not r["errors"]],
 "eyes": lambda r: [r["slotNewest"]["tag"] == "take 2 · newest" and not r["slotNewest"]["previewing"], r["slotHover"]["tag"] == "take 1 · preview" and r["slotHover"]["previewing"] and r["saveBrickSame"], r["slotLeave"]["tag"] == "take 2 · newest",
   "In this frame, left to right: the door in the centre. The tall window is not in this frame." in r["orbit"],
   r["frames"]["types"] == ["image"] * 4 + ["text"] and r["frames"]["mime"] == "image/jpeg" and [f["frame"] for f in r["frames"]["info"]][0] == 0 and r["frames"]["info"][-1]["frame"] > 90, r["picked"] == [0, 24],
   r["webmcp"] == {"n": 2, "url": "data:image/jpeg;base64,", "data": False}, r["people"]["types"] == ["image", "text"] and [p["n"] for p in r["people"]["info"]["people"]] == [1, 2] and r["people"]["info"]["people"][0]["box"][0] < r["people"]["info"]["people"][1]["box"][0],
   r["run"]["proposed"] and r["run"]["plan"]["eta_s"] == 70 and "same recipe" in r["run"]["plan"]["from"] and "about 70 s" in (r["chip"] or "") and r["listed"],
   r["runFrom"]["tabs"] == r["tabsBefore"] + 1 and r["runFrom"]["length"] == 73 and r["runFrom"]["selected"] == "render" and r["runFrom"]["showing"] and "nothing is queued" in r["runFrom"]["toast"] and not r["runFrom"]["sheet"],
   r["listsNotStale"], r["queue"] == 0 and r["sam"] == 1, not r["errors"]],
 "newcomer": lambda r: [len(r["tools"]) == 182 and "set_agent_permissions" in r["tools"], r["profile"]["agents"]["run"] is False,
   r["allowRun"]["value"]["run"] is True and r["afterRun"]["setting"] is True and r["afterRun"]["profile"]["run"] is True,
   not r["allowSee"]["error"] and "screenshot shows this page" in r["allowSee"]["value"].get("note", ""), r["screenshot"]["error"] and "take_frames" in r["screenshot"]["value"],
   r["firstFrame"]["on"] is False and "text to video" in r["firstFrame"]["off"], r["renderLength"]["fps"] == 24 and r["renderLength"]["seconds"] == round(r["renderLength"]["value"] / 24, 2),
   "overall_soundscape" in (r["promptHelp"] or "") and "name the specific sounds" in r["promptHelp"],
   r["fiveSeconds"]["value"]["value"] == 124 and "124 frames at 24 fps" in r["fiveSeconds"]["value"]["note"], "124 frames · 5.17 s" in (r["face"] or ""),
   not r["seedDefault"]["error"] and r["seedDefault"]["value"]["brick"] == "render", r["unknownArg"]["error"] and "doesn't take bricks" in r["unknownArg"]["value"] and "takes: brick" in r["unknownArg"]["value"],
   r["toolError"]["error"] and "unsnap takes: brick (required)" in r["toolError"]["value"], bool(r["run"]["value"].get("run")),
   r["status"]["value"]["runs"][0]["state"] == "done" and r["status"]["value"]["runs"][0]["take"] == "take-" + r["run"]["value"]["run"] and r["outputExists"],
   "call again" in r["waitCap"]["value"].get("wait_s", ""), r["after"] is False, not r["errors"],
   r.get("stillIds") and all(i == b for i, _, b in r["stillIds"]) and ["image", "Render", "image"] in r["stillIds"], r.get("byId") and not r["byId"]["error"]],
 "f11": lambda r: ["default text" in r["videoDefault"]["value"].get("warning", "") and "warning" not in r["videoWritten"]["value"], r["stillBricks"][3] == "image",
   "image prompt" in r["stillDefault"]["value"].get("warning", "") and "warning" not in r["stillWritten"]["value"], not r["setRender"]["error"] and r["setRender"]["value"]["brick"] == "image" and r["imagePrompt"].startswith("A log cabin"),
   r["seedRender"]["value"]["brick"] == "image", [n["type"] for n in r["listRender"]["value"]] == ["blueprint"],
   r["badBrick"]["error"] and "its bricks: image_models, loras, rack, image, save_image" in r["badBrick"]["value"], r["badUnsnap"]["error"] and "its bricks:" in r["badUnsnap"]["value"], not r["errors"]],
 "u76sound": lambda r: [r["quiet"]["quiet"] and r["quiet"]["sound"]["mean_db"] < -45, not r["loud"]["quiet"], [c["quiet"] for c in r["cards"] if c["take"] in (r["quiet"]["id"], r["loud"]["id"])].count(True) == 1,
   r["row"]["buttons"] == ["Make it louder", "Re-prompt with sound events"] and "Sound is quiet" in r["row"]["text"], r["takesBeforeClick"] == 2,
   r["version"] and r["version"]["group"] and not r["version"]["quiet"] and r["version"]["sound"]["mean_db"] > -45, r["pictureCopied"],
   r["reprompt"]["selected"] == "render" and "name the specific sounds" in r["reprompt"]["toast"], [t["sound"]["quiet"] for t in r["listed"]] == [True, False], all(t["sound"].get("quiet_below_db") == -45 for t in r["listed"]),
   r["toolStatus"]["value"]["runs"][0]["state"] == "done", not r["errors"]],
 "u77ui": lambda r: [r["plainMe"] == 404 and r["plain"]["chip"] is None and r["plain"]["account"] is None, r["plain"]["rate"] == {"rating": "pg", "after": None} and "rated PG" in r["plain"]["ratings"], "sfw" in r["plain"]["steps"],
   r["kid"]["chip"] == "kidPGSign out" and r["kid"]["chipLink"] == "/gate/logout", r["kid"]["ratings"] == [] and "only the admin" in r["kid"]["rate"].get("error", ""), "sfw" not in r["kid"]["steps"] and len(r["kid"]["steps"]) == 6,
   r["kid"]["account"]["max_rating"] == "PG" and "sfw_question" in r["kid"]["account"], r["admin"]["chip"] == "adminAdultSign out" and "sfw" in r["admin"]["steps"] and r["admin"]["ratings"] and r["admin"]["rate"]["rating"] == "pg",
   r["lockAnswer"] == 401 and (r["lockCard"] or "").startswith("Locked: sign in again"), r["popupUrl"].startswith("/gate/login?idle=1"),
   r["afterSignIn"] == {"card": False, "popupClosed": True, "nodes": r["nodesBefore"], "queue": 200}, not r["errors"]],
 "run3": lambda r: [r["family"]["error"] and "takes: intent" in r["family"]["value"], not r["stills"]["error"] and "MOSS" in r["stills"]["value"]["opened"], "image" in (r["stillBricks"] or []),
   r["badIntent"]["error"] and "stills" in r["badIntent"]["value"], r["done"]["done"] is True and set(r["done"]["answered"]) >= {"intent", "scan", "metadata", "sfw", "local", "code", "kit"},
   r["read"]["answered"] == r["done"]["answered"], not r["errors"]],
 "f16f17": lambda r: [r["badIntent"]["error"] and '"video_with_sound" isn\'t one of "video", "stills"' in r["badIntent"]["value"], r["badMixed"]["error"] and '"pictures"' in r["badMixed"]["value"],
   r["badAnswered"]["error"] and '"intent", "scan"' in r["badAnswered"]["value"], r["badReview"]["error"] and '"unknown"' in r["badReview"]["value"], r["badKit"]["error"] and 'intent "pictures" isn\'t one of' in r["badKit"]["value"],
   r["profileAfterBad"] == r["profileBefore"], not r["good"]["error"], r["all"]["files"] and all(f.get("download") and f.get("command") for f in r["all"]["files"]),
   [f["file"] for f in r["deband"]["files"] if "deband" in f["file"]] == [] and [o["why"] for o in r["deband"].get("optional", []) if o.get("file") == "moss_image_sft_deband_int8_convrot.safetensors"] == ["no public download: bring your own file"],
   sorted({f["file"] for f in r["kitFiles"] if not f["download"]}) == ["moss_image_sft_deband_int8_convrot.safetensors", "viggle_remake_edit_r128_comfyui.safetensors"], not r["errors"]],
 "u88takes": lambda r: [r["plain"]["rating"] == "pg" and r["adult"]["rating"] == "adult", sorted(r["ungated"]) == sorted([r["plain"]["id"], r["adult"]["id"]]), r["groupAfter"] == r["group"],
   r["gated"] == [r["plain"]["id"]], r["getAdult"].startswith("No take"), r["getPlain"] == r["plain"]["id"], r["strip"] == [r["plain"]["id"]], "1 above your rating not shown" in (r["count"] or ""),
   not [e for e in r["errors"] if 'No slot "upscale"' not in e]],
 "u84loras": lambda r: [r["described"].get("trained_tags", [])[:2] == ["watercolor", "painting"] and r["described"].get("triggers") == ["wtrclr"] and r["described"].get("rank_from_tensors") == 16
   and r["described"].get("training", {}).get("ss_network_dim") == "16" and r["described"].get("inferred") is True and r["described"].get("category") == "unsorted",
   r["cats"] == {"snaptest_u84_dmd2_lora.safetensors": "unsorted", "snaptest_u84_4step_lora.safetensors": "core·turbo"},
   r["agentFiled"].get("category") == "style" and (r["agentFiled"].get("filed") or {}).get("by") == "agent" and "watercolor" in (r["agentFiled"]["filed"].get("reason") or ""),
   (r["again"].get("filed") or {}).get("by") == "agent", (r["row"] or "").startswith("agent: trained on watercolor"), (r["personFiled"] or {}).get("by") == "person" and r["rowAfter"] is None,
   "their filing wins" in (r["agentOverPerson"].get("error") or "") and r["stillPerson"] == "core·fix", (r["asPerson"].get("filed") or {}).get("by") == "person",
   (r["proposal"] or {}).get("args", {}).get("reason") == "ss_ fields name a dmd2 distillation", 'role "styles" isn\'t one of' in (r["badRole"].get("error") or ""), r["restored"] is None, not r["errors"]],
 "pikaturbo": lambda r: [r["fl2v"]["turbo"] == "h3/pika_h3_flex_fl2va_v1_bf16.safetensors" and r["fl2v"]["chip"] == ["Turbo: pika_h3_flex_fl2va_v1_bf16 ▾"],
   r["ref2v"]["turbo"] == "h3/pika_h3_flex_ref2va_comfy_bf16.safetensors" and r["ref2v"]["chip"] == ["Turbo: pika_h3_flex_ref2va_comfy_bf16 ▾"],
   len(r["fl2v"]["methods"]) == 5 and r["fl2v"]["methods"][0] == ["pika_h3_flex_fl2va_v1_bf16", "LoRA", True] and [m[1] for m in r["fl2v"]["methods"][3:]] == ["LoRA · made for ref2v; this model is fl2v"] * 2,
   r["ref2v"]["methods"][0] == ["pika_h3_flex_ref2va_comfy_bf16", "LoRA", True] and [m[1] for m in r["ref2v"]["methods"][3:]] == ["LoRA · made for fl2v; this model is ref2v"] * 2,
   r["dmad"]["lora"].endswith("DMAD_4step_full_lora_avg_rank_39_bf16.safetensors") and r["dmad"]["schedule"] == "simple" and r["dmad"]["turbo"] == r["dmad"]["lora"],
   r["back"]["schedule"] == "manual" and r["back"]["sigmas"] == "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0" and r["back"]["turbo"].endswith("ref2va_comfy_bf16.safetensors"), r["fl2v"]["shifts"] == [12, 3] and r["dmad"]["shifts"] == [12, 2] and r["back"]["shifts"] == [12, 3],
   any("2 turbo LoRAs stacked" in w for w in r["stacked"]["warnings"]) and not r["stack"].get("error"), r["queued"] == 0, not r["errors"]],
 "notrim": lambda r: [r["loras"] == {"count": 250, "returned": 250}, r["models"] == {"count": 250, "returned": 250}, r["choices"]["notrim"] == 250 and not r["choices"]["more"], r["queued"] == 0, not r["errors"]],
 "metaflows": lambda r: [all(r[k]["off"] for k in ("video", "stills", "own", "checkQueue")), r["video"]["unswitched"] == [] and "SaveVideo" in r["video"]["outputs"],
   r["stills"]["unswitched"] == [] and "SaveImage" in r["stills"]["outputs"], r["own"]["outputs"] == ["SaveImage"] and r["checkQueue"]["outputs"] == ["PreviewImage"], not r["on"]["off"], not r["errors"]],
 "kitsfresh": lambda r: [all(k["scan"] == "ready" and k["check"]["validation"] == "valid" and k["check"]["missing"] == [] and k["check"]["checks"] == [] and not k["errors"] for k in r["kits"].values()),
   r["kits"]["video"]["check"]["off"] == ["first_frame", "upscale"] and r["kits"]["stills"]["check"]["off"] == ["loras"],
   [x["id"] for x in r["kits"]["video"]["extras"] or []] == ["relayvsr"] and r["kits"]["video"]["extras"][0]["optional"] and r["kits"]["video"]["extras"][0]["size_gb"] > 0],
 "agentpage": lambda r: list(r["checks"].values()),
}[name](r)
print(f"{name:8s} {sum(checks)}/{len(checks)} {'PASS' if all(checks) else 'FAIL ' + str([i for i, c in enumerate(checks) if not c])}")
PY
}
# the gatetest pair (snap-gate in front of a --multi-user ComfyUI) and the GPU unit are optional: their suites say skipped
gate_up() { [ -n "${SNAP_TEST_GATETEST_BASE:-}" ] && curl -s -o /dev/null "http://127.0.0.1:$gate_port/gate/login"; }
# the GPU slot is the gate's own server (README "the GPU slot"), never the person's main one (SNAP_TEST_MAIN_PORT)
gpu_up() { [ "$gpu_port" != "${SNAP_TEST_MAIN_PORT:-}" ] || { echo "gpu      skipped: SNAP_TEST_GPU_PORT is the person's main ComfyUI (:$gpu_port); give the gate its own GPU slot (README)" >&2; return 1; }; curl -s -o /dev/null "http://127.0.0.1:$gpu_port/system_stats"; }
vaultkey
park; run test_engine.js "http://127.0.0.1:$port/";  summary engine test_engine_result.json
run test_ui.js "http://127.0.0.1:$port/";      summary ui ui/test_ui_result.json
run test_ui2.js "http://127.0.0.1:$port/";     summary ui2 ui/test_ui2_result.json
run test_agent.js "$port";                     summary agent ui/test_agent_result.json
run test_library.js;                           summary library ui/test_library_result.json
park; run test_proposals.js;                   summary proposals ui/test_proposals_result.json
run test_notes.js;                             summary notes ui/test_notes_result.json
run test_dock.js;                              summary dock ui/test_dock_result.json
run test_tabs.js;                              summary tabs ui/test_tabs_result.json
run test_anynode.js;                           summary anynode ui/test_anynode_result.json
run test_adopt.js;                             summary adopt ui/test_adopt_result.json
park; run test_rules.js;                       summary rules ui/test_rules_result.json
park; run test_recipe.js;                      summary recipe ui/test_recipe_result.json
run test_shot.js;                              summary shot ui/test_shot_result.json
run test_newtab.js;                            summary newtab ui/test_newtab_result.json
run test_passthrough.js;                       summary passthrough ui/test_passthrough_result.json
run test_resize.js;                            summary resize ui/test_resize_result.json
run test_panel.js;                             summary panel ui/test_panel_result.json
run test_back.js;                              summary back ui/test_back_result.json
run test_openin.js;                            summary openin ui/test_openin_result.json
run test_drop_keys.js;                         summary dropkeys ui/test_drop_keys_result.json
park; run test_takes.js;                       summary takes ui/test_takes_result.json
park; run test_takestale.js;                   summary takestale ui/test_takestale_result.json
park; run test_video_meaning.js;               summary video ui/test_video_meaning_result.json
run test_dials.js;                             summary dials ui/test_dials_result.json
run test_models.js;                            summary models ui/test_models_result.json
run test_upscale.js;                           summary upscale ui/test_upscale_result.json
park; run test_graph.js;                       summary graph ui/test_graph_result.json
run test_stale.js;                             summary stale ui/test_stale_result.json
park; run test_image.js;                       summary image ui/test_image_result.json
run test_slots.js;                             summary slots ui/test_slots_result.json
park; run test_fresh.js;                       summary fresh ui/test_fresh_result.json
run test_agent_full.js;                        summary agentfull ui/test_agent_full_result.json
run test_sight.js "$port";                        summary sight ui/test_sight_result.json
park; run test_board.js;                       summary board ui/test_board_result.json
park; run test_seteditor.js;                   summary seteditor ui/test_seteditor_result.json
run test_polish.js;                            summary polish ui/test_polish_result.json
park; run test_cards.js;                       summary cards ui/test_cards_result.json
park; run test_switch.js;                      summary switch ui/test_switch_result.json
park; run test_methods.js;                     summary methods ui/test_methods_result.json
park; run test_plates.js;                      summary plates ui/test_plates_result.json
park; run test_candidates.js;                  summary candidates ui/test_candidates_result.json
park; run test_compat.js;                     summary compat ui/test_compat_result.json
park; run test_eyes.js;                       summary eyes ui/test_eyes_result.json
park; run test_u58.js;                        summary u58 ui/test_u58_result.json
park; run test_scenes.js;                     summary scenes ui/test_scenes_result.json
park; run test_u62.js;                        summary u62 ui/test_u62_result.json
park; run test_onboarding.js "$fresh_port" "$port";    summary onboarding ui/test_onboarding_result.json
park; run test_newcomer.js "$port";           summary newcomer ui/test_newcomer_result.json
park; run test_f11.js "$port";                summary f11 ui/test_f11_result.json
park; run test_run3.js "$port";               summary run3 ui/test_run3_result.json
run test_f16_f17.js "$fresh_port";                     summary f16f17 ui/test_f16_f17_result.json
park; run test_u88_takes.js "$port";          summary u88takes ui/test_u88_takes_result.json
run test_u84_loras.js "$port";                summary u84loras ui/test_u84_loras_result.json
run test_pika_turbo.js "$port";               summary pikaturbo ui/test_pika_turbo_result.json
run test_no_trim.js "$port";                  summary notrim ui/test_no_trim_result.json
park; run test_metadata_flows.js "$port";     summary metaflows ui/test_metadata_flows_result.json
nice -n 19 python3 -I "$T"/test_metadata_off.py "$port"
park; run test_u76_sound.js "$port";          summary u76sound ui/test_u76_sound_result.json
nice -n 19 python3 -I "$T"/test_u77_cap.py "$port"
nice -n 19 python3 -I "$T"/test_u82_ratings.py "$port"
park; timeout 600 nice -n 19 node "$T"/test_u82_takes.js "$port" "$fresh_port" 2>test_u82_takes.js.err || echo "test_u82_takes.js FAILED (see test_u82_takes.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_u46c_extend.js "$port" 2>test_u46c_extend.js.err || echo "test_u46c_extend.js FAILED (see test_u46c_extend.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_u46e_long.js "$port" 2>test_u46e_long.js.err || echo "test_u46e_long.js FAILED (see test_u46e_long.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_u73_methods.js "$port" 2>test_u73_methods.js.err || echo "test_u73_methods.js FAILED (see test_u73_methods.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_polish2.js "$port" 2>test_polish2.js.err || echo "test_polish2.js FAILED (see test_polish2.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_u76_leftovers.js "$port" "$fresh_port" 2>test_u76_leftovers.js.err || echo "test_u76_leftovers.js FAILED (see test_u76_leftovers.js.err)"
nice -n 19 python3 -I "$T"/test_u76_server.py "$port"
park; timeout 600 nice -n 19 node "$T"/test_world.js "$port" 2>test_world.js.err || echo "test_world.js FAILED (see test_world.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_cast.js "$port" 2>test_cast.js.err || echo "test_cast.js FAILED (see test_cast.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_world_pins.js "$port" 2>test_world_pins.js.err || echo "test_world_pins.js FAILED (see test_world_pins.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_retake.js "$port" 2>test_retake.js.err || echo "test_retake.js FAILED (see test_retake.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_versions.js "$port" 2>test_versions.js.err || echo "test_versions.js FAILED (see test_versions.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_world_cleanup.js "$port" 2>test_world_cleanup.js.err || echo "test_world_cleanup.js FAILED (see test_world_cleanup.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_c_polish.js "$port" 2>test_c_polish.js.err || echo "test_c_polish.js FAILED (see test_c_polish.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_c_pins.js "$port" 2>test_c_pins.js.err || echo "test_c_pins.js FAILED (see test_c_pins.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_f20_f22.js "$port" 2>test_f20_f22.js.err || echo "test_f20_f22.js FAILED (see test_f20_f22.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_f23_f26.js "$port" 2>test_f23_f26.js.err || echo "test_f23_f26.js FAILED (see test_f23_f26.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_d_extend_pictures.js "$port" 2>test_d_extend_pictures.js.err || echo "test_d_extend_pictures.js FAILED (see test_d_extend_pictures.js.err)"
timeout 600 nice -n 19 node "$T"/test_d_takes_header.js "$port" 2>test_d_takes_header.js.err || echo "test_d_takes_header.js FAILED (see test_d_takes_header.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_rerun.js "$port" 2>test_rerun.js.err || echo "test_rerun.js FAILED (see test_rerun.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_rerun_sheet.js "$port" 2>test_rerun_sheet.js.err || echo "test_rerun_sheet.js FAILED (see test_rerun_sheet.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_rerun_motion.js "$port" 2>test_rerun_motion.js.err || echo "test_rerun_motion.js FAILED (see test_rerun_motion.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_rerun_batch.js "$port" 2>test_rerun_batch.js.err || echo "test_rerun_batch.js FAILED (see test_rerun_batch.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_rerun_rating.js "$port" 2>test_rerun_rating.js.err || echo "test_rerun_rating.js FAILED (see test_rerun_rating.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_f28_f31.js "$port" 2>test_f28_f31.js.err || echo "test_f28_f31.js FAILED (see test_f28_f31.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_e_r5.js "$port" 2>test_e_r5.js.err || echo "test_e_r5.js FAILED (see test_e_r5.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_e_diff.js "$port" 2>test_e_diff.js.err || echo "test_e_diff.js FAILED (see test_e_diff.js.err)"
park; timeout 600 nice -n 19 node "$T"/test_e_recast_note.js "$port" 2>test_e_recast_note.js.err || echo "test_e_recast_note.js FAILED (see test_e_recast_note.js.err)"
# U101 (SNAP-R71..R74): New view from these pictures, audio references, a Cast voice; prints "u101 n/m" last
park; timeout 600 nice -n 19 node "$T"/test_u101.js "$port" >test_u101.js.out 2>&1; tail -1 test_u101.js.out
timeout 600 nice -n 19 node "$T"/test_u101_faces.js "$port" >test_u101_faces.js.out 2>&1; tail -1 test_u101_faces.js.out
# U101 turnaround round 2 (SNAP-R77): make_character_sheet, the sheet slot's graphs and candidates; prints "u101sheet n/m" last
park; timeout 600 nice -n 19 node "$T"/test_u101_sheet.js "$port" >test_u101_sheet.js.out 2>&1; tail -1 test_u101_sheet.js.out
# short03 F-C12/F-C14/F-C15/F-C16 (SNAP-R78, R79) and every picture full size (SNAP-R80); print "u101fc n/m", "u101full n/m" last
park; timeout 600 nice -n 19 node "$T"/test_u101_fc.js "$port" >test_u101_fc.js.out 2>&1; tail -1 test_u101_fc.js.out
park; timeout 600 nice -n 19 node "$T"/test_u101_full.js "$port" >test_u101_full.js.out 2>&1; tail -1 test_u101_full.js.out
# the operator's UI items 2026-11-05 17:4x: shot tiles without an active take, plain-word chips, the resizable rail, letterboxed thumbs; prints "u101ui n/m" last
park; timeout 600 nice -n 19 node "$T"/test_u101_ui.js "$port" >test_u101_ui.js.out 2>&1; tail -1 test_u101_ui.js.out
# U102b (SNAP-R81, R82): make a take bigger (stage 2, the latent pass, Tessera), upscale_take, Make it bigger; prints "u102b n/m" last
park; timeout 600 nice -n 19 node "$T"/test_u102b.js "$port" >test_u102b.js.out 2>&1; tail -1 test_u102b.js.out
# batch F (the Work card, SNAP-R65/R66): each prints its "name n/m" line last; the full output stays in <test>.out
for t in test_f1_stamp.js test_f2_model.js test_f3_sheet.js test_f4_chips.js test_f5_open.js test_f6_cross.js test_f8_route.js test_f9_pages.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" >$t.out 2>&1; tail -1 $t.out; done
# G1 (SNAP-R83): the agents' window on the bridge (a test browser stands in; restarts the fresh server); test_f2_shot.py (the headless page's screenshot) is retired with the headless launcher
# G1 (SNAP-R84..R87): location records, a picture's purpose + New view by job + reference redraw, short03 friction + F-C26;
# print "g1loc n/m", "g1purpose n/m", "g1friction n/m" last
park; timeout 600 nice -n 19 node "$T"/test_g1_location.js "$port" >test_g1_location.js.out 2>&1; tail -1 test_g1_location.js.out
park; timeout 600 nice -n 19 node "$T"/test_g1_purpose.js "$port" >test_g1_purpose.js.out 2>&1; tail -1 test_g1_purpose.js.out
park; timeout 600 nice -n 19 node "$T"/test_g1_friction.js "$port" >test_g1_friction.js.out 2>&1; tail -1 test_g1_friction.js.out
# short03 F-C29/F-C27/F-C30 and F-C31 (the scene chain C3 → C5 → C6); print "g1world n/m", "g1chain n/m" last
park; timeout 600 nice -n 19 node "$T"/test_g1_world.js "$port" >test_g1_world.js.out 2>&1; tail -1 test_g1_world.js.out
park; timeout 600 nice -n 19 node "$T"/test_g1_chain.js "$port" >test_g1_chain.js.out 2>&1; tail -1 test_g1_chain.js.out
# short03 F-C25: a finished job whose page closed lands as its take, once (checked on the GPU unit too); prints "g1adopt n/m"
park; timeout 600 nice -n 19 node "$T"/test_g1_adopt.js "$port" >test_g1_adopt.js.out 2>&1; tail -1 test_g1_adopt.js.out
# G1 item 6: a tab reloaded straight into Snap with the method registry late; prints "g1reload n/m" last
park; timeout 600 nice -n 19 node "$T"/test_g1_reload.js "$port" >test_g1_reload.js.out 2>&1; tail -1 test_g1_reload.js.out
timeout 600 nice -n 19 node "$T"/test_g1_window.js "$fresh_port" >test_g1_window.js.out 2>&1; tail -1 test_g1_window.js.out
# G1b (SNAP-R111..R115): the character and soft copy notes, the voice note, stage 2 fast, a first frame with references;
# print "g1bnotes n/m", "g1bfast n/m", "g1bopening n/m" last
park; timeout 600 nice -n 19 node "$T"/test_g1b_notes.js "$port" >test_g1b_notes.js.out 2>&1; tail -1 test_g1b_notes.js.out
park; timeout 600 nice -n 19 node "$T"/test_g1b_fast.js "$port" >test_g1b_fast.js.out 2>&1; tail -1 test_g1b_fast.js.out
park; timeout 600 nice -n 19 node "$T"/test_g1b_opening.js "$port" >test_g1b_opening.js.out 2>&1; tail -1 test_g1b_opening.js.out
# dogfood F-D01 (SNAP-R116) records another writer saved, F-D03 (SNAP-R117) a render waiting its turn; print "g1bfresh n/m", "g1blost n/m"
park; timeout 600 nice -n 19 node "$T"/test_g1b_fresh.js "$port" >test_g1b_fresh.js.out 2>&1; tail -1 test_g1b_fresh.js.out
park; timeout 600 nice -n 19 node "$T"/test_g1b_lost.js "$port" >test_g1b_lost.js.out 2>&1; tail -1 test_g1b_lost.js.out
# G1b measures through the pack's own nodes on the GPU test unit ($SNAP_TEST_GPU_PORT, DINOv3 at 1024 px and WavLM): the scout's fixtures
if gpu_up; then for t in test_g1b_id_copy.py test_g1b_voice.py; do nice -n 19 "$py" -I "$T/$t" "$gpu_port" >$t.out 2>&1; tail -1 $t.out; done; else echo "g1bgpu   skipped: no server on :$gpu_port"; fi
# library marks + remove_lora by file + cache_hit, the shot's truth line + no-write browsing, Send to + Cast pictures +
# re-run out, Play scene + stills door + phone; each prints "g2<name> n/m" last (port and base)
for t in test_g2_refs.js test_g2_shots.js test_g2_fd.js test_g2_misc.js test_g2_truth.js test_g2_send.js test_g2_polish.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# U103/U104 (SNAP-R93..R95): agent instructions, skills, the Agent library, the install layer; print "instrstore n/m",
# "instrresolve n/m", "instrpins n/m", "agentlib n/m", "gateinstr n/m" last (they take this server's port and base)
park; timeout 600 nice -n 19 node "$T"/test_instructions_store.js "$port" "$SNAP_TEST_BASE" >test_instructions_store.js.out 2>&1; tail -1 test_instructions_store.js.out
park; timeout 600 nice -n 19 node "$T"/test_instructions_resolve.js "$port" "$SNAP_TEST_BASE" >test_instructions_resolve.js.out 2>&1; tail -1 test_instructions_resolve.js.out
park; timeout 600 nice -n 19 node "$T"/test_instructions_pins.js "$port" "$SNAP_TEST_BASE" >test_instructions_pins.js.out 2>&1; tail -1 test_instructions_pins.js.out
park; timeout 600 nice -n 19 node "$T"/test_agent_library.js "$port" "$SNAP_TEST_BASE" >test_agent_library.js.out 2>&1; tail -1 test_agent_library.js.out
park; timeout 600 nice -n 19 python3 -I "$T"/test_gate_instructions.py "$port" "$SNAP_TEST_BASE" >test_gate_instructions.py.out 2>&1; tail -1 test_gate_instructions.py.out
# U97 the Book (SNAP-R67-R69, R130-R133; +28 tools above): records, the story clock and the dial; compile, stale, settei
# and the style; boards, the animatic, the Cut, the OTIO and the set plan on short04's pictures; Pages (Fountain); each prints
# "book_<name> n/m" last; screens in ui/u97/
for t in test_book_story.js test_book_compile.js test_book_cut.js test_book_pages.js test_g4_book.js test_g4_deps.js test_g4_mediums.js test_g4_critic.js test_g4_shots.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G6 Book part (SNAP-R165..R172, F-L02..F-L20): Cast lines folded through the state, a cut's opening, boards pinned to the story,
# apply_unit {land}, louder pins, the reversal cost in words; prints "g6book n/m" last; screens in ui/g6book/
for t in test_g6_book.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# U93/U94 (SNAP-R101..R110): the critic's docket, packets, triggers and approval, the critic on the object (screens in
# ui/u93/), agreement, re-run dependents; each prints "<name> n/m" last; they take this server's port and base
for t in test_u93_critique.js test_u93_packet.js test_u93_triggers.js test_u93_marks.js test_u93_agreement.js test_u94_dependents.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G3 (SNAP-R134..R138): critique rows per part, masks all at once, the location tools' friction, page holds, the pack's
# prompt words, the eye colour step's math; each prints "g3<name> n/m" or "iris n/m" last
for t in test_g3_critic.js test_g3_pages.js test_g3_eyes.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
nice -n 19 python3 -I "$T"/test_g3_cards.py >test_g3_cards.py.out 2>&1; tail -1 test_g3_cards.py.out
# G5 (SNAP-R146..R148, F-G01..F-G11): busy page holds, a location's dependents from its Cast, one plate's fields, short
# take ids, the replaced active take, one record's critique rows, a repeated note once; prints "g5 n/m" last
for t in test_g5.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G6 (SNAP-R155..R159, F-K01..F-K11, F-L01, F-M01): scale anchors, owners' parts, amended critiques, Idempotency-Key, the
# Work card's folded critiques; prints "g6 n/m" last
for t in test_g6.js; do park; timeout 600 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G7 (SNAP-R70, R173..R177; the Book's steps 7 and 10, the colour script, settei design it; F-L06..F-L18): one-key
# verdicts and the option cemetery, blind pairs held on the server, the Room and its leak test (phone and tablet), the
# Beat sheet's leftovers, scene groups, design_state, dry_run, chrome reload by id start, list_critiques by id start;
# each prints "g7<name> n/m" last; screens in ui/g7/
for t in test_g7_verdicts.js test_g7_room.js test_g7_book.js test_g7_misc.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G8 (SNAP-R178, R179; F-N01): a wardrobe state folds the items it names out of the Cast line, and the lint says what
# stays; the Room asks each question as one plain sentence naming its thing; dry_run on add_plate, draw_set_plan and
# delete_record (SNAP-R177); each prints "g8<name> n/m" last; screens in ui/g8/
for t in test_g8_wardrobe.js test_g8_room.js test_g8_dryrun.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G9 (SNAP-R180..R184; F-Q findings): the Room asks a critic's finding with its notes, critic owners name their target,
# a held-prop cut is boarded at its key, a settei on a plain ground, a Book's export carries its story and look, board
# packets; each prints "g9<name> n/m" last; screens in ui/g9/
for t in test_g9_room.js test_g9_book.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G10 (SNAP-R185..R190; F-S findings): a still in a cut's shot is a board, a record's new view lands with it, open_view
# room says what shows, plate owners by whole name, a board says absent what its pictures may show, a region edit pastes
# back; prints "g10 n/m" last; screens in ui/g10/
for t in test_g10.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G11 (SNAP-R191..R196; F-U findings, F-T02): a region edit's seam note, a packet's crops as the model got them, its
# cut's Cast, zooms, compact critique rows, a Cast picture replaced as a new version; prints "g11 n/m" last; screens in ui/g11/
for t in test_g11.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G12 (SNAP-R197..R199, U106): what a picture is (a still or a frame of a video, its kind, cut, model, made from), the
# read-only Nearby modal (R5: records hashed before and after), the nearby tool; prints "g12 n/m" last; screens in ui/g12/
for t in test_g12.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G13 (SNAP-R202, R203; dogfood F-Y04, F-Y05, F-Y07): a still's stage 2 redraws the whole still (a region edit too) from
# any model's graph; keep eye colour on any take; take tools read a unique start of an id; a region edit's SAM mask
# (SNAP-R204, F-Y09); prints "g13 n/m" last
for t in test_g13.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# G14: a region edit's seam says when the box shows (SNAP-R205, F-Z03), its stage 2 keeps the edit's change (SNAP-R206,
# F-Z01), keep eye colour says what it did (SNAP-R207, F-Z02); the nodes on real crops (fixtures g14/); prints "g14 n/m"
# and "g14nodes n/m" last
for t in test_g14.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
nice -n 19 "$py" -I "$T"/test_g14_nodes.py "$port" >test_g14_nodes.py.out 2>&1; tail -1 test_g14_nodes.py.out
nice -n 19 "$py" -I "$T"/test_iris.py >test_iris.py.out 2>&1; tail -1 test_iris.py.out
# G15 write safety (SNAP-R208..R210, F-AD01, F-AB03): a retried key answers in_flight then replayed (one run, kept a day),
# proposals keep their base and go out of date, either/or on one Cast, re-make, expiry parks; prints "g15safety n/m" last
for t in test_g15_safety.js; do park; timeout 900 nice -n 19 node "$T/$t" "$port" "$SNAP_TEST_BASE" >$t.out 2>&1; tail -1 $t.out; done
# SNAP-R109: the shipped critic prompt's last real run on the fixtures holds the floor (fixtures.json: r5b, 27/31, 0 FA;
# a real-agent check, re-scored from its saved notes). critic = r6, the shipped prompt (r5b + metres from the record's
# scale, SNAP-R155); critic5b = the floor's own run. The r3/r4/r5 runs stay in critic/runs/ as history (critic/README.md)
nice -n 19 python3 -I "$T/critic/run_fixtures.py" score --results "$T/critic/runs/2026-11-06-r6-scale/results.jsonl" --confirm "$T/critic/runs/2026-11-06-r6-scale/confirm.json" | tail -1 | sed 's/^/critic   /'
nice -n 19 python3 -I "$T/critic/run_fixtures.py" score --results "$T/critic/runs/2026-11-06-r5b-duplicate/results.jsonl" --confirm "$T/critic/runs/2026-11-06-r5b-duplicate/confirm.json" | tail -1 | sed 's/^/critic5b /'
# U79 (SNAP-R96, R97, R99): the vault container and keys, pure Python on the pack this server loads; prints "vaultfmt n/m" last
timeout 600 nice -n 19 "$py" -I "$T"/test_vault_format.py "$SNAP_TEST_PACK" >test_vault_format.py.out 2>&1; tail -1 test_vault_format.py.out
# U79 server, migrate, gate and page suites need the gatetest pair (gate in front of the gatetest ComfyUI, --multi-user, privacy on)
if gate_up; then gt=$SNAP_TEST_GATETEST_BASE; for t in "test_vault_server.py $gatetest_port $gt" "test_vault_migrate.py $gatetest_port $gt $gt/custom_nodes/ComfyUI-MAINodes" "test_vault_gate.py $gate_port $gatetest_port $gt"; do set -- $t; nice -n 19 "$py" -I "$T"/snapbox/$t >snapbox/$1.out 2>&1; tail -1 snapbox/$1.out; done; timeout 600 nice -n 19 node "$T"/snapbox/test_vault_page.js >snapbox/test_vault_page.js.out 2>&1; tail -1 snapbox/test_vault_page.js.out; else echo "vaultsrv/vaultmig/vaultgate/vaultpage skipped: no gate on :$gate_port"; fi
if gate_up; then nice -n 19 "$py" -I "$T"/snapbox/test_f6_gate_work.py >snapbox/test_f6_gate_work.py.out 2>&1; tail -1 snapbox/test_f6_gate_work.py.out; else echo "f6gate   skipped: no gate on :$gate_port"; fi
nice -n 19 python3 -I "$T"/test_f29_snapcall.py
nice -n 19 python3 -I "$T"/test_f27_snapcall.py
nice -n 19 "$py" -I "$T"/test_longclip_check.py
if gate_up; then "$py" -I "$T"/snapbox/test_u82_gate.py; else echo "u82gate  skipped: no gate on :$gate_port"; fi
if gate_up; then "$py" -I "$T"/snapbox/test_u88_dials.py; "$py" -I "$T"/snapbox/test_u83_u88_gate.py; "$py" -I "$T"/snapbox/test_f18_gate.py; "$py" -I "$T"/snapbox/test_u90_words_gate.py; "$py" -I "$T"/snapbox/test_u90_admin_outputs.py; else echo "u88dials/u83u88/f18gate/u90words/u90outs skipped: no gate on :$gate_port"; fi
# needs the gatetest pair (gate in front of the gatetest ComfyUI); it locks every gatetest session for a few seconds
if gate_up; then run test_u77_ui.js "$port"; summary u77ui ui/test_u77_ui_result.json; else echo "u77ui    skipped: no gate on :$gate_port"; fi
if gate_up; then timeout 600 nice -n 19 node "$T"/test_e_cap.js 2>test_e_cap.js.err || echo "test_e_cap.js FAILED (see test_e_cap.js.err)"; else echo "e_cap    skipped: no gate on :$gate_port"; fi
run test_kits_fresh.js "$fresh_port";                  summary kitsfresh ui/test_kits_fresh_result.json
t0=$SECONDS; fresh ui/test_agent_page_result.json; nice -n 19 python3 -I "$T"/test_agent_page.py "$fresh_port" >/dev/null 2>test_agent_page.py.err || echo "test_agent_page.py FAILED (see test_agent_page.py.err)"; echo "  ($((SECONDS - t0)) s)"
summary agentpage ui/test_agent_page_result.json
park; run test_categories.js "$port";         summary categories ui/test_categories_result.json
park; nice -n 19 python3 -I "$T"/test_private_files.py "$port"
nice -n 19 python3 -I "$T"/test_privacy_switch.py "$port"
nice -n 19 python3 -I "$T"/test_identity_notes.py "$port"
python3 -I "$T"/test_dataset.py; node "$T"/test_continuity.mjs | head -1; node "$T"/test_continuity_heldout.mjs | head -1; node "$T"/test_coverage.mjs | head -1; node "$T"/test_eyeline_heldout.mjs | head -1
bash "$T/real_models_guard.sh" after "$stamp" "$real"
