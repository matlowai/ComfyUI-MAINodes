"""Batch F behind snap-gate (pack SNAP-R65 + gate SNAP-R42), on the gatetest install: the Work card's source
(/mainodes/snap/jobs) gives each account its own jobs whole and another account's queued work only as "another
account" (no question, no stamp); a job's stamp carries the account the session signed in as, whatever the page sent.
Queues only 64 px EmptyImage -> SaveImage prompts (one slow one, so the member sees it queued). Prints one line.
usage: comfyui_venv/bin/python -I test_f6_gate_work.py [gate 8297]"""
import os
import asyncio
import json
import sys
import time
from pathlib import Path

import aiohttp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

GATE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else C.GATE_PORT}"
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())
T = time.strftime("%H%M%S")


def prompt(slow=0):
    p = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}}}
    last = "1"
    for i in range(slow):
        p[f"r{i}"] = {"class_type": "ImageScale", "inputs": {"image": [last, 0], "upscale_method": "lanczos", "width": 2048, "height": 2048, "crop": "disabled"}}
        last = f"r{i}"
    p["2"] = {"class_type": "SaveImage", "inputs": {"images": [last, 0], "filename_prefix": f"batchF_gate_{T}"}}
    return p


async def session(name):
    s = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True))
    async with s.post(GATE + "/gate/login", data={"username": name, "password": PASSWORDS[name], "next": "/"}, allow_redirects=False) as r:
        assert r.status == 302, (name, r.status)
    return s


async def main():
    admin, member = await session("admin"), await session("member")
    job = {"kind": "run", "title": "admin's private question", "about": {}, "by": "person", "eta_s": None, "at": int(time.time() * 1000), "account": "member"}
    ids = []
    for slow in (10, 10, 0):
        async with admin.post(GATE + "/prompt", json={"prompt": prompt(slow), "extra_data": {"snap_job": job}}) as r:
            ids.append((await r.json())["prompt_id"])
    async with member.get(GATE + "/mainodes/snap/jobs") as r:
        seen_by_member = (await r.json())["rows"]
    for _ in range(120):
        async with admin.get(GATE + "/queue") as r:
            q = await r.json()
        if not q["queue_running"] and not q["queue_pending"]:
            break
        await asyncio.sleep(0.5)
    async with admin.get(GATE + "/mainodes/snap/jobs") as r:
        seen_by_admin = (await r.json())["rows"]
    async with member.get(GATE + "/mainodes/snap/jobs") as r:
        member_after = (await r.json())["rows"]
    await admin.close()
    await member.close()
    theirs = [r for r in seen_by_member if r["id"] in ids]
    mine = [r for r in seen_by_admin if r["id"] in ids]
    checks = {
        "the member sees the admin's queued work only as another account's": len(theirs) >= 1 and all(set(r) == {"id", "state", "user"} and r["user"] == "another account" for r in theirs),
        "the member never sees the admin's finished jobs": not any(r["id"] in ids for r in member_after),
        "the admin sees all three whole, with the question": len(mine) == 3 and all(r["job"]["title"] == "admin's private question" for r in mine),
        "the stamp's account is the session's, not what the page sent": all(r["job"].get("account") == "admin" for r in mine),
    }
    bad = [k for k, v in checks.items() if not v]
    print(json.dumps({"theirs": theirs, "mine": [{"id": r["id"], "state": r["state"], "account": r["job"].get("account")} for r in mine]}, indent=1))
    for k, v in checks.items():
        print(("PASS " if v else "FAIL ") + k)
    print(f"f6gate   {len(checks) - len(bad)}/{len(checks)}")
    sys.exit(1 if bad else 0)

asyncio.run(main())
