"""U90 (3) behind snap-gate, on the gatetest install (accounts admin / member / kid, test_accounts.json): a capped account's
prompt whose words rate above its cap is refused when it is queued, with the reason (the node, the word, the cap), so
nothing of it renders; CONTENT_RATINGS_VAULT §2 "refused at validation" (the pack's SNAP-R33 second line). Text that only
feeds a negative input doesn't count, the same words are fine for an Adult cap, and plain words run as before.
Queues only 64 px EmptyImage -> SaveImage prompts. Outputs stay (no deletes; names carry the run's time). Prints one
line, writes test_u90_words_gate_result.json.
usage: comfyui_venv/bin/python -I test_u90_words_gate.py [gate 8297] [comfy base dir]"""
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
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else C.gatetest_base()
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())
T = time.strftime("%H%M%S")
WORDS = "a nude figure study in charcoal"


def prompt(prefix, text, negative=None):
    p = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
         "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": prefix}},
         "3": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": text}, "_meta": {"title": "Prompt"}}}
    if negative:  # text wired only into a negative input
        p["4"] = {"class_type": "PrimitiveStringMultiline", "inputs": {"value": negative}}
        p["5"] = {"class_type": "StringConcatenate", "inputs": {"string_a": ["3", 0], "string_b": "", "delimiter": "", "negative": ["4", 0]}}
    return p


async def session(name):
    s = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True))
    async with s.post(GATE + "/gate/login", data={"username": name, "password": PASSWORDS[name], "next": "/"}, allow_redirects=False) as r:
        assert r.status == 302, (name, r.status)
    return s


async def queue(s, p):
    """(status, every error text of the answer, the run's history entry or None)."""
    async with s.post(GATE + "/prompt", json={"prompt": p}) as r:
        st, out = r.status, await r.json()
    if st != 200:
        texts = [str(out.get("error", {}).get("message", "")), str(out.get("error", {}).get("details", ""))]
        texts += [str(e.get(k, "")) for n in (out.get("node_errors") or {}).values() for e in n.get("errors", []) for k in ("message", "details")]
        return st, texts, None
    for _ in range(60):
        async with s.get(f"{GATE}/history/{out['prompt_id']}") as r:
            h = await r.json()
        if out["prompt_id"] in h and h[out["prompt_id"]].get("status", {}).get("completed") is not None:
            return st, [], h[out["prompt_id"]]
        await asyncio.sleep(0.5)
    return st, [], None


def files(name):
    return sorted(p.name for p in (BASE / "output" / name).glob(f"u90_*_{T}_*.png"))


async def main():
    S = {n: await session(n) for n in ("admin", "member", "kid")}
    R, checks = {}, {}
    try:
        for who in ("kid", "member"):
            st, why, h = await queue(S[who], prompt(f"u90_words_{T}", WORDS))
            R[f"{who}_words"] = {"status": st, "why": why, "ran": h is not None}
            said = " ".join(why)
            checks[f"{who}: a prompt whose words rate Adult is refused when queued (400)"] = st == 400 and h is None
            checks[f"{who}: ... the reason names the node, the word and the cap"] = "Node 3" in said and '"nude"' in said and ("PG cap" if who == "kid" else "Mature cap") in said
            st, why, h = await queue(S[who], prompt(f"u90_plain_{T}", "a lighthouse at dusk"))
            R[f"{who}_plain"] = {"status": st, "why": why, "rating": ((h or {}).get("prompt", [None] * 4)[3] or {}).get("snap_marks", {}).get("rating") if h else None}
            checks[f"{who}: plain words still run, rated PG"] = st == 200 and R[f"{who}_plain"]["rating"] == "pg"
        st, why, h = await queue(S["kid"], prompt(f"u90_negative_{T}", "a lighthouse at dusk", negative="nude, nsfw, bad hands"))
        R["kid_negative"] = {"status": st, "why": why}
        checks["kid: the words only in a negative input don't count (it runs)"] = st == 200 and h is not None
        st, why, h = await queue(S["admin"], prompt(f"shared/u90_admin_{T}", WORDS))
        R["admin_words"] = {"status": st, "why": why, "rating": ((h or {}).get("prompt", [None] * 4)[3] or {}).get("snap_marks", {}).get("rating") if h else None}
        checks["admin (Adult cap): the same words run (an Adult cap counts words only with its own setting on, SNAP-R39)"] = st == 200 and h is not None
        R["outputs"] = {who: files(who) for who in ("kid", "member")}
        checks["no file was written for a refused prompt"] = all(not any(f.startswith(f"u90_words_{T}") for f in R["outputs"][who]) for who in ("kid", "member"))
    finally:
        for s in S.values():
            await s.close()
    R["checks"] = checks
    C.out("snapbox", "test_u90_words_gate_result.json").write_text(json.dumps(R, indent=1))
    bad = [k for k, v in checks.items() if not v]
    print(f"u90words {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")

asyncio.run(main())
