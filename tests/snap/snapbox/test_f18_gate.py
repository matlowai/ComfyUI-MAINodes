"""U72 F18 (run 5): an agent's headless page signs in with its account token through /gate/login?token=, which makes a
cookie session; that session must not idle-lock (SNAP-R46: tokens don't idle, and neither does the page they open),
while a password session still locks. A new token for the account ends the sessions the old one opened.
Uses its own gatetest account `tokenpage` (made once with a throwaway password; a new token on every run). Sets the
idle limit to 3 s for the proof and puts the admin's setting back afterwards (settings are read live). Prints one line,
writes test_f18_gate_result.json.
usage: comfyui_venv/bin/python -I test_f18_gate.py [gate 8297] [gate state dir]"""
import os
import asyncio
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import aiohttp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

GATE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else C.GATE_PORT}"
STATE = sys.argv[2] if len(sys.argv) > 2 else str(C.gatetest_base() / "gate_state")
GATE_PY = str(C.PACK / "snap_gate" / "gate.py")
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())


def gate(*args):
    return subprocess.run([sys.executable, "-I", GATE_PY, *args, "--state", STATE], capture_output=True, text=True, check=True).stdout.strip()


async def main():
    if "tokenpage" not in gate("account", "list"):
        with tempfile.NamedTemporaryFile("w", suffix=".txt") as f:
            f.write("tokenpage-unused-password")
            f.flush()
            gate("account", "add", "tokenpage", "--role", "member", "--password-file", f.name)
    token = gate("account", "token", "tokenpage")
    was = float(gate("settings").split()[-1])
    R, checks = {}, {}
    page = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True))
    person = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True))
    try:
        async with page.get(f"{GATE}/gate/login?token={token}&next=/", allow_redirects=False) as r:
            checks["the token link signs the page in"] = r.status == 302
        async with person.post(GATE + "/gate/login", data={"username": "member", "password": PASSWORDS["member"], "next": "/"}, allow_redirects=False) as r:
            checks["the member signs in with a password"] = r.status == 302
        gate("settings", "--idle-minutes", "0.05")
        await asyncio.sleep(5)
        async with page.get(GATE + "/gate/me") as r:
            R["page_me"] = (r.status, await r.text())
        async with page.get(GATE + "/object_info/EmptyImage") as r:
            R["page_api"] = r.status
        async with person.get(GATE + "/object_info/EmptyImage") as r:
            R["person_api"] = (r.status, await r.text())
        checks["past the idle limit the token page still answers"] = R["page_me"][0] == 200 and R["page_api"] == 200
        checks["past the idle limit the password session is locked"] = R["person_api"][0] == 401 and '"locked": true' in R["person_api"][1]
        gate("settings", "--idle-minutes", f"{was:g}")
        gate("account", "token", "tokenpage")  # a new token: the old one's page is signed out
        async with page.get(GATE + "/gate/me") as r:
            R["page_after_new_token"] = r.status
        checks["a new token for the account ends the old token's page"] = R["page_after_new_token"] == 401
    finally:
        gate("settings", "--idle-minutes", f"{was:g}")
        await page.close()
        await person.close()
    R["checks"] = checks
    C.out("snapbox", "test_f18_gate_result.json").write_text(json.dumps(R, indent=1))
    bad = [k for k, v in checks.items() if not v]
    print(f"f18gate  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")

asyncio.run(main())
