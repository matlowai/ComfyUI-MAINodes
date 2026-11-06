"""U79 step 7 (SNAP-R100) behind snap-gate on the gatetest install (gate :8297 -> ComfyUI :8199, privacy on):
- sign-in unlocks the account's vault with the sign-in password; an account with no vault is enrolled at sign-in;
- a second session keeps it unlocked after the first signs out; the last sign-out locks it;
- an idle session locks it (idle limit shortened to 3 s, then put back) within one sweep (15 s);
- a token session alone never unlocks it; with the person signed in the token's requests see it unlocked;
- /view through the gate: the member's private take decrypts for the member (Range answered 206 through the relay),
  423 once locked, 404 for another member (the gate, unchanged), plaintext for the admin through escrow.
Earlier runs' member sessions are marked locked in the gate's sessions.json first. Queues 64 px CPU prompts only. Writes test_vault_gate_result.json.
usage: comfyui_venv/bin/python -I test_vault_gate.py [gate 8297] [comfy 8199] [base]"""
import os
import asyncio
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

import aiohttp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

GATE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else C.GATE_PORT}"
COMFY = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else C.GATETEST_PORT}"
ROOT = Path(sys.argv[3]) if len(sys.argv) > 3 else C.gatetest_base()
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())
USERS = {v: k for k, v in json.loads((ROOT / "user" / "users.json").read_text()).items()}
GATEPY, STATE = str(C.PACK / "snap_gate" / "gate.py"), ROOT / "gate_state"
PY = C.PYTHON
LORA = "u79/snaptest_u79_stamped.safetensors"  # in models/vae: a helper folder, so no rating is needed and no LoRA list changes  # stamped private in its header (test_vault_server.py makes it)
checks, R = {}, {}


async def session(name):
    s = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True))
    async with s.post(GATE + "/gate/login", data={"username": name, "password": PASSWORDS[name], "next": "/"}, allow_redirects=False) as r:
        assert r.status == 302, (name, r.status)
    return s


async def j(s, method, url, **kw):
    async with s.request(method, url, **kw) as r:
        raw = await r.read()
        try:
            return r.status, json.loads(raw.decode()), dict(r.headers)
        except ValueError:
            return r.status, raw, dict(r.headers)


async def pack(http, name):
    """The pack's own answer for the account, straight from ComfyUI (what the gate's session state did to it)."""
    return (await j(http, "GET", COMFY + "/mainodes/snap/vault/status", headers={"comfy-user": USERS[name]}))[1].get("vault")


async def run(s, prompt):
    st, out, _ = await j(s, "POST", GATE + "/prompt", json={"prompt": prompt})
    for _ in range(120):
        _, h, _ = await j(s, "GET", f"{GATE}/history/{out['prompt_id']}")
        if out["prompt_id"] in h and h[out["prompt_id"]].get("status", {}).get("completed"):
            return h[out["prompt_id"]]
        await asyncio.sleep(0.5)


async def main():
    http = aiohttp.ClientSession()
    # earlier runs' sessions of the member stay signed in for 7 days (SNAP-R46): mark them locked, so "the last
    # sign-out" means this run's (the gate reads sessions.json again when it changes)
    sf = STATE / "sessions.json"
    sessions = json.loads(sf.read_text())
    R["earlier_member_sessions"] = sum(1 for x in sessions.values() if x["account"] == "member" and not x.get("locked"))
    sf.write_text(json.dumps({k: {**x, "locked": True} if x["account"] == "member" else x for k, x in sessions.items()}, indent=1))
    a = await session("admin")
    checks["admin's vault unlocked at sign-in"] = await pack(http, "admin") == "unlocked"
    m1 = await session("member")
    checks["member's vault unlocked at sign-in"] = await pack(http, "member") == "unlocked"
    keys = json.loads((ROOT / "user" / "snap_vault.json").read_text())["accounts"]
    had = USERS["newkid"] in keys
    nk = await session("newkid")
    checks["an account with no vault is enrolled at sign-in"] = await pack(http, "newkid") == "unlocked" and (had or USERS["newkid"] in json.loads((ROOT / "user" / "snap_vault.json").read_text())["accounts"])
    # a private take through the gate, then /view
    h = await run(m1, {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 12, "color": 0x884422}}, "2": {"class_type": "CreateVideo", "inputs": {"images": ["1", 0], "fps": 12}},
                       "3": {"class_type": "SaveVideo", "inputs": {"video": ["2", 0], "filename_prefix": "u79_gate", "format": "mp4", "codec": "h264"}}, "9": {"class_type": "PrimitiveString", "inputs": {"value": LORA}}})
    f = h["outputs"]["3"]["images"][0]
    R["file"] = f
    disk = ROOT / "output" / f["subfolder"] / f["filename"]
    url = f"{GATE}/view?filename={f['filename']}&subfolder={f['subfolder']}&type=output"
    st, body, hd = await j(m1, "GET", url)
    checks["sealed in the member's folder, plain to the member"] = f["subfolder"].startswith("member") and disk.read_bytes()[:8] == b"SNAPVLT1" and st == 200 and body[4:8] == b"ftyp" and hd.get("Cache-Control") == "no-store"
    st, part, hd = await j(m1, "GET", url, headers={"Range": "bytes=10-49"})
    checks["Range through the relay -> 206"] = st == 206 and part == body[10:50] and hd.get("Content-Range", "").startswith("bytes 10-49/")
    k = await session("kid")
    checks["another member -> 404 (gate)"] = (await j(k, "GET", url))[0] == 404
    st, ab, _ = await j(a, "GET", url)
    checks["admin -> plaintext through escrow"] = st == 200 and ab == body
    # two sessions, then sign-outs
    m2 = await session("member")
    await j(m1, "GET", GATE + "/gate/logout", allow_redirects=False)
    checks["second session keeps it unlocked"] = await pack(http, "member") == "unlocked" and (await j(m2, "GET", url))[0] == 200
    await j(m2, "GET", GATE + "/gate/logout", allow_redirects=False)
    checks["last sign-out locks it"] = await pack(http, "member") == "locked"
    # a token alone never unlocks; with the person here it sees the takes
    token = subprocess.run([PY, "-I", GATEPY, "account", "token", "member", "--state", str(STATE)], capture_output=True, text=True, check=True).stdout.strip()
    bearer = {"Authorization": f"Bearer {token}"}
    st, out, _ = await j(http, "GET", url, headers=bearer)
    checks["token alone: locked (423)"] = st == 423 and out.get("locked") and await pack(http, "member") == "locked"
    m3 = await session("member")
    R["token_with_person"] = (await j(http, "GET", url, headers=bearer))[:2]
    R["pack_after_m3"] = await pack(http, "member")
    checks["person signed in: token sees it"] = R["token_with_person"][0] == 200
    # idle
    before = subprocess.run([PY, "-I", GATEPY, "settings", "--state", str(STATE)], capture_output=True, text=True, check=True).stdout.split()[-1]
    subprocess.run([PY, "-I", GATEPY, "settings", "--idle-minutes", "0.05", "--state", str(STATE)], check=True, capture_output=True)
    try:
        t0 = time.time()
        for _ in range(40):
            await asyncio.sleep(1)
            if await pack(http, "member") == "locked":
                break
        R["idle_lock_s"] = round(time.time() - t0, 1)
        checks["idle session locks it within a sweep"] = await pack(http, "member") == "locked" and R["idle_lock_s"] <= 25
        st, out, _ = await j(m3, "GET", url)
        checks["the idle page is locked by the gate (401)"] = st == 401 and out.get("locked")
    finally:
        subprocess.run([PY, "-I", GATEPY, "settings", "--idle-minutes", before, "--state", str(STATE)], check=True, capture_output=True)
    m4 = await session("member")
    checks["signing in again unlocks it"] = await pack(http, "member") == "unlocked" and (await j(m4, "GET", url))[1] == body
    for s in (a, m1, m2, m3, m4, nk, k, http):
        await s.close()


asyncio.run(main())
bad = [k for k, v in checks.items() if not v]
C.out("snapbox", "test_vault_gate_result.json").write_text(json.dumps({"checks": checks, "R": R}, indent=1, default=str))
print(f"vaultgate  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")
