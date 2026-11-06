"""U88 (1): a released dial (a dial file nobody rated: downloaded or copied in) is rated from how it was made, read from
its own metadata (SNAP-R54): its sentence pairs through the prompt-words rating; a Combine or an edit inherits from
its parents; one made from pictures or videos, or whose parent isn't here, stays unrated (the gate counts it Adult
until the admin rates it). The pack records the ratings in user/snap_ratings.json when a page reads the model graph,
and the gate lists by them: a Mature member sees the PG dials and not the Adult one.
Writes six tiny dial files into the gatetest's models/loras/dials/ (moved to _parked_placeholders/ afterwards, never
deleted). Prints one line, writes test_u88_dials_result.json.
usage: comfyui_venv/bin/python -I test_u88_dials.py [gate 8297] [comfy 8199] [comfy base dir]"""
import os
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

import aiohttp
import torch
from safetensors.torch import save_file
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

GATE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else C.GATE_PORT}"
COMFY = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else C.GATETEST_PORT}"
BASE = Path(sys.argv[3]) if len(sys.argv) > 3 else C.gatetest_base()
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())
T = time.strftime("%H%M%S")
D = {k: f"u88_{k}_{T}" for k in ("calm", "nude", "mix", "mixpg", "pics", "orphan")}
META = {
    "calm": {"format": "ComfyUI-Dials v1", "pairs": json.dumps([["a calm street", "a busy street"]]), "dial_info": json.dumps({"description": "how busy the street is", "negative": "calm", "positive": "busy"})},
    "nude": {"format": "ComfyUI-Dials v1", "pairs": json.dumps([["a clothed figure", "a nude figure"]])},
    "mix": {"parents": json.dumps([D["calm"], D["nude"]]), "composition": json.dumps({"kind": "combine"})},
    "mixpg": {"parents": json.dumps([D["calm"]]), "composition": json.dumps({"kind": "edit"})},
    "pics": {"format": "ComfyUI-Dials v1", "source": "pictures", "pairs": json.dumps([[0, 0]]), "prompt": "a picture"},
    "orphan": {"parents": json.dumps(["u88_not_here"]), "composition": json.dumps({"kind": "combine"})},
}


async def main():
    folder = BASE / "models" / "loras" / "dials"
    placed = []
    for k, name in D.items():
        f = folder / f"{name}.safetensors"
        save_file({"diffusion_model.x.diff_b": torch.zeros(4, dtype=torch.bfloat16)}, str(f), metadata={"name": name, **META[k]})
        placed.append(f)
    R = {}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(COMFY + "/mainodes/snap/models") as r:  # what a page reads first; the pack rates new dials then
                R["models_status"] = r.status
        made = BASE / "user" / "snap_ratings.json"
        rec = json.loads(made.read_text()) if made.exists() else {}
        R["records"] = {k: rec.get(f"loras/dials/{n}.safetensors") for k, n in D.items()}
        await asyncio.sleep(6)  # the gate keeps model lists for 5 s
        async with aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True)) as s:
            async with s.post(GATE + "/gate/login", data={"username": "member", "password": PASSWORDS["member"], "next": "/"}, allow_redirects=False) as r:
                assert r.status == 302, r.status
            async with s.get(GATE + "/models/loras") as r:
                listed = await r.json()
        R["member_sees"] = {k: f"dials/{n}.safetensors" in listed for k, n in D.items()}
    finally:
        parked = BASE / "_parked_placeholders" / f"u88-{T}"
        parked.mkdir(parents=True, exist_ok=True)
        for f in placed:
            shutil.move(str(f), str(parked / f.name))
    rating = {k: (v or {}).get("rating") for k, v in R["records"].items()}
    checks = {
        "a released dial with plain sentences is rated PG": rating["calm"] == "pg",
        "one whose sentences hold a term is rated Adult, saying which": rating["nude"] == "adult" and "nude" in json.dumps(R["records"]["nude"]),
        "a Combine of the two inherits Adult from its parents": rating["mix"] == "adult",
        "an edit of the PG dial is PG": rating["mixpg"] == "pg",
        "a picture dial stays unrated (its inputs aren't recorded)": rating["pics"] is None,
        "a Combine whose parent isn't here stays unrated": rating["orphan"] is None,
        "member (Mature) sees the PG dials": R["member_sees"]["calm"] and R["member_sees"]["mixpg"],
        "member doesn't see the Adult dial or the Combine with it": not R["member_sees"]["nude"] and not R["member_sees"]["mix"],
        "member doesn't see the unrated ones (Adult until rated)": not R["member_sees"]["pics"] and not R["member_sees"]["orphan"],
    }
    R["checks"] = checks
    C.out("snapbox", "test_u88_dials_result.json").write_text(json.dumps(R, indent=1))
    bad = [k for k, v in checks.items() if not v]
    print(f"u88dials {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")

asyncio.run(main())
