# Snap's gate

SNAP-R126 the gate lives with the code, and nothing local lives in the gate · see docs/snap/SNAP_RULES.md

`run_all.sh` runs every Snap suite against CPU ComfyUI servers that load this checkout and prints one line per suite
(`name n/m PASS`, or `FAIL [failed check indexes]`). The full output of each suite stays in the output folder. A
branch gates with its own copy of these files: change a test on the branch whose code it tests, never in a shared copy.

## What you need

- **Two CPU ComfyUI servers** whose `custom_nodes/ComfyUI-MAINodes` links to this checkout, one systemd `--user` unit
  each (two suites restart or read them by unit name):
  - the main one, privacy on (`user/snap_privacy.json` is `{"on": true}`), with the test model files the suites expect
    (copy an existing test base; relink every symlink under the copy that points into the old base);
  - a fresh one: no user data, empty model folders (onboarding, kits, the agents' window).

  ```
  systemd-run --user --unit snap-test-cpu --working-directory <ComfyUI> nice -n 10 <venv>/bin/python main.py --cpu \
    --base-directory <base> [--extra-model-paths-config <shared test models>.yaml] --port 8195 --listen 127.0.0.1 --disable-auto-launch
  systemd-run --user --unit snap-fresh-cpu ... --base-directory <fresh base> --port 8196 ...
  ```
  Restart both after any change to the pack's Python.
- **Optional: the GPU slot**, a ComfyUI of the gate's own on its own GPU, never the person's main server (their queue
  would wait behind the measure suites). `SNAP_TEST_GPU_PORT` names it; `SNAP_TEST_MAIN_PORT` names the person's server,
  and run_all skips the GPU suites, saying why, if the two are the same:

  ```
  systemd-run --user --unit snap-gate-gpu --working-directory <ComfyUI> -E CUDA_VISIBLE_DEVICES=0 <venv>/bin/python main.py \
    --base-directory <gpu base> --port 8194 --listen 127.0.0.1 --disable-auto-launch
  ```
- **Optional:** the gatetest pair (snap-gate in front
  of a `--multi-user` ComfyUI with privacy on: vault, ratings and gate suites). Their lines say `skipped` when nothing
  answers. The gatetest suites restart its units and lock its sessions: one gate run at a time on a pair.
- **Playwright** for node (`SNAP_TEST_NODE_PATH` = its `node_modules`), Chrome, the ComfyUI venv's python, ffmpeg.
- **The local fixtures folder** (`SNAP_TEST_FIXTURES`): the pictures, clips and data the suites read, from private
  work, so not in the repo. `fixtures.json` lists every file with its size and sha256. The critic's fixtures have their
  own folder and manifest (`critic/README.md`, `SNAP_CRITIC_FIXTURES`). Check a folder against the manifest:

  ```
  python3 -c 'import hashlib,json,os,sys; r=sys.argv[1]; m=json.load(open("tests/snap/fixtures.json"))["files"]; bad=[f["path"] for f in m if not os.path.exists(os.path.join(r,f["path"])) or hashlib.sha256(open(os.path.join(r,f["path"]),"rb").read()).hexdigest()!=f["sha256"]]; print(len(m)-len(bad), "/", len(m), "ok"); print("\n".join(bad))' "$SNAP_TEST_FIXTURES"
  ```

## Run it

```
cp tests/snap/.env.example tests/snap/.env      # fill in ports, bases, units and folders (git ignores .env)
tests/snap/run_all.sh                           # or: SNAP_TEST_ENV=/path/to/other.env tests/snap/run_all.sh
```

About an hour on a busy box, under nice 19. Everything a run writes goes to `SNAP_TEST_OUT`: `ui/*_result.json`, the
screenshots under `ui/<batch>/`, `<suite>.out` / `.err`, `_debug/`, `snapbox/`, `_parked_results/`. One suite alone:

```
set -a; . tests/snap/.env; set +a; export NODE_PATH=$SNAP_TEST_NODE_PATH; cd "$SNAP_TEST_OUT"
node <repo>/tests/snap/test_takes.js       # suites take [port] [base] where they need them; the defaults come from the env
```

A suite run alone does not get `park()`: earlier runs' takes and records stay in the base, and a suite that switched a
setting on (Let agents run) leaves it on. Read the suite's header before trusting a single run.

## What run_all does around the suites

- **The real-models guard** (U90-1): before the first suite it fails the run when any test server's folder links into
  `SNAP_TEST_REAL_MODELS`; the last line fails when anything under its `loras` changed during the run.
- **The vault key step** (`vaultkey`, SNAP-R96..R98): with privacy on, a private take is saved encrypted and saving one
  needs the person's vault key. Before the suites, run_all parks the base's old key file (moved, never deleted), then
  sets up and unlocks a key through `/mainodes/snap/vault/setup` and `/unlock`, as the person would, with a passphrase
  made for this run and held only in the shell. Both lines must read `unlocked`; an off install answers `off`.
- **`park`** between suites moves the base's Snap records (takes, cards, cast, location, instructions, critiques, …) to
  `_parked/` (never deleted), answers onboarding, and clears the server's finished-job history, so no suite adopts
  another's renders (F-C25).
- **The stale-result guard**: `run` parks a suite's previous result before the suite starts, so a suite that crashes
  prints `FAIL (no ui/<suite>_result.json: the suite wrote no result)`, never the last run's PASS.
- **Expected totals** live in `summary`'s checks (`agent`, `agentfull`: MCP 181 tools, WebMCP 176 after G7). A branch that adds or
  removes tools changes those numbers in the same commit.

## Timing suites need a quiet box

`ui` (drag frame times), `ui2` (palette open, the Snap ⇄ Graph switch at ~320 ms looks-done, ≤ 350) and `proposals`
measure wall-clock time read once a frame. A box that starves the browser of frames (critic agents, renders, a long
check beside the gate) reads them late: ui2's switch read 417 ms in the G5 gate and 314-320 ms alone, 345-499 ms with
every core busy. ui2 records `worstFrameMs` (the longest gap between two frames during the switch): a fail with a worst
frame far over 17 ms is the box, not the code. Start the gate when side jobs are done, and rerun a timing fail alone
before calling it a regression.

## Privacy checks fail closed

A privacy suite that cannot check reports FAIL: the CPU server's privacy suites (`test_private_files.py`,
`test_privacy_switch.py`, `test_metadata_off.py`, the U71 lock in `test_categories.js`, the vault key step) never skip,
and a missing folder or env value stops a suite with its name instead of letting it pass on nothing. The pack's own
privacy handlers refuse a prompt on any error rather than queue it unmarked; the suites check that refusal, so a
failure there is a real one. Only the gatetest and GPU suites may say `skipped`, and only when their servers are absent.

## Add a suite

1. `tests/snap/test_<what>.js` (or `.py`) with a header naming the rules it covers (`SNAP-R…`) and its usage.
2. Ports, bases and folders from the config only: `const CFG = require("./snaptest_config.js")` (`CFG.port`,
   `CFG.base`, `CFG.out`, `CFG.fixture(…)`, `CFG.pack`); in Python `import snaptest_config as C` after
   `sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))` (`-I` drops the script's folder). No absolute paths,
   no names of people, no private pictures in the repo.
3. Results and screenshots under `CFG.out` (`ui/<suite>_result.json`, `ui/<batch>/*.png`); print `<name> n/m` last.
4. A new picture or clip goes into the local fixtures folder and gets a row in `fixtures.json`; the repo keeps the row.
5. One line in `run_all.sh` (`park;` first when it writes records), then run the whole gate on your own units.

Builders on other branches add their suites to their branch's `tests/snap/` the same way; a suite still in the study's
proto folder moves here with its paths turned into config reads.
