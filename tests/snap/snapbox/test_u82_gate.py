"""U82 behind snap-gate: a member (Mature cap) sees the video kit's files, because the pack's model graph rates every kit
file (SNAP-R39) and the gate rates with the graph of the pack ComfyUI runs. A file made here is listed by the rating the
pack saved it with (user/snap_ratings.json); a file dropped in by hand still counts as Adult (SNAP-R44), and a made
file's rating never spills onto another file of the same name.
Puts empty placeholder files with the kit's exact names into the gatetest models/ and one made-file record into
user/snap_ratings.json (as the pack's saver writes it); afterwards the placeholders are moved to _parked_placeholders/
and the record file to user/_parked/ (never deleted). Prints one line, writes test_u82_gate_result.json.
usage: comfyui_venv/bin/python -I test_u82_gate.py [gate 8297] [comfy base dir]"""
import os
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

import aiohttp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

GATE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else C.GATE_PORT}"
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else C.gatetest_base()
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())
KIT = {"diffusion_models": ["h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"],
       "loras": ["pika_h3_flex_fl2va_v1_bf16.safetensors", "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors"],
       "text_encoders": ["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"], "vae": ["minimax_h3_video_vae_fp16.safetensors", "minimax_h3_audio_vae_fp32.safetensors"]}
MADE, HAND, CLASH = "dials/u82_made_pg.safetensors", "u82_dropped_by_hand.safetensors", "dials/greyscale-unrated.safetensors"


async def listing(s, folder):
    async with s.get(f"{GATE}/models/{folder}") as r:
        return await r.json() if r.status == 200 else []


async def main():
    placed = []
    for folder, names in {**KIT, "loras": KIT["loras"] + [MADE, HAND]}.items():
        for n in names:
            f = BASE / "models" / folder / n
            if not f.exists():
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes((2).to_bytes(8, "little") + b"{}")
                placed.append(f)
    made = BASE / "user" / "snap_ratings.json"
    made.write_text(json.dumps({f"loras/{MADE}": {"rating": "pg", "why": ["test"], "at": "now"}, f"loras/{CLASH}": {"rating": "pg", "why": ["test"], "at": "now"}}))
    R = {}
    try:
        await asyncio.sleep(6)  # the gate keeps model lists for 5 s
        async with aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True)) as s:
            async with s.post(GATE + "/gate/login", data={"username": "member", "password": PASSWORDS["member"], "next": "/"}, allow_redirects=False) as r:
                assert r.status == 302, r.status
            R["lists"] = {folder: await listing(s, folder) for folder in KIT}
    finally:
        parked = BASE / "_parked_placeholders" / f"u82-{time.strftime('%H%M%S')}"
        for f in placed:
            (parked / f.relative_to(BASE)).parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), str(parked / f.relative_to(BASE)))
        (BASE / "user" / "_parked").mkdir(exist_ok=True)
        shutil.move(str(made), str(BASE / "user" / "_parked" / f"snap_ratings-u82-{time.strftime('%H%M%S')}.json"))
    L = R["lists"]
    checks = {f"member sees {folder}/{n}": n in L[folder] for folder, names in KIT.items() for n in names}
    checks["member sees a dial made here and rated PG"] = MADE in L["loras"]
    checks["a file dropped in by hand stays hidden (Adult)"] = HAND not in L["loras"]
    checks["a made file's rating doesn't spill onto test/greyscale-unrated"] = "test/greyscale-unrated.safetensors" not in L["loras"]
    checks["member still doesn't see test/greyscale-adult"] = "test/greyscale-adult.safetensors" not in L["loras"]
    R["checks"] = checks
    C.out("snapbox", "test_u82_gate_result.json").write_text(json.dumps(R, indent=1))
    bad = [k for k, v in checks.items() if not v]
    print(f"u82gate  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")

asyncio.run(main())
