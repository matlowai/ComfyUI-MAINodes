"""U90 (4) behind snap-gate, on the gatetest install (accounts admin / member / kid, test_accounts.json): /gate/admin rates
outputs in output/shared/. A file put there by hand counts as Adult until the admin rates it (SNAP-R44, R56); the page
lists it under "output/shared" with its select; a rating applies at once to who can /view it, outlives a re-read of
ComfyUI's history (it wins over a run's own rating), and Unrated puts it back to Adult. Only the admin may rate, never
cross-site, and only files inside output/shared/.
Queues one 64 px EmptyImage -> SaveImage prompt (the admin's, into shared/). Places two small PNGs in output/shared/; they
stay (no deletes; names carry the run's time). Prints one line, writes test_u90_admin_outputs_result.json.
usage: comfyui_venv/bin/python -I test_u90_admin_outputs.py [gate 8297] [comfy base dir]"""
import os
import asyncio
import io
import json
import sys
import time
from pathlib import Path

import aiohttp
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

GATE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else C.GATE_PORT}"
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else C.gatetest_base()
PASSWORDS = json.loads(C.fixture("gate_accounts.json").read_text())
T = time.strftime("%H%M%S")


def png():
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 120, 40)).save(b, "PNG")
    return b.getvalue()


async def session(name):
    s = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True))
    async with s.post(GATE + "/gate/login", data={"username": name, "password": PASSWORDS[name], "next": "/"}, allow_redirects=False) as r:
        assert r.status == 302, (name, r.status)
    return s


async def j(s, method, url, **kw):
    async with s.request(method, url, **kw) as r:
        raw = await r.read()
        try:
            return r.status, json.loads(raw.decode())
        except ValueError:
            return r.status, raw.decode(errors="replace")


async def view(s, sub, name):
    async with s.get(f"{GATE}/view", params={"filename": name, "subfolder": sub, "type": "output"}) as r:
        return r.status


async def rate(s, file, rating, **kw):
    return await j(s, "POST", GATE + "/gate/admin/output_rating", json={"file": file, "rating": rating}, **kw)


async def main():
    S = {n: await session(n) for n in ("admin", "member", "kid")}
    R, checks = {}, {}
    hand = BASE / "output" / "shared" / "u90" / f"by_hand_{T}.png"
    hand.parent.mkdir(parents=True, exist_ok=True)
    hand.write_bytes(png())
    rel = f"shared/u90/{hand.name}"
    try:
        checks["kid: a shared output put there by hand counts as Adult (404)"] = await view(S["kid"], "shared/u90", hand.name) == 404
        st, page = await j(S["admin"], "GET", GATE + "/gate/admin")
        R["page_has_row"] = isinstance(page, str) and f'data-output="{rel}"' in page
        checks["admin: /gate/admin lists it under output/shared with a select"] = st == 200 and R["page_has_row"] and "output/shared" in page
        st, out = await rate(S["admin"], rel, "pg")
        R["rate_pg"] = [st, out]
        checks["admin: rating it PG answers with the rating"] = st == 200 and isinstance(out, dict) and out.get("rating") == "pg"
        checks["kid: ... then sees it (200)"] = await view(S["kid"], "shared/u90", hand.name) == 200
        st, out = await rate(S["admin"], rel, "mature")
        checks["member sees it at Mature, kid doesn't"] = st == 200 and await view(S["member"], "shared/u90", hand.name) == 200 and await view(S["kid"], "shared/u90", hand.name) == 404
        st, out = await rate(S["admin"], rel, None)
        R["rate_null"] = [st, out]
        checks["admin: Unrated puts it back to Adult (kid and member 404)"] = st == 200 and out.get("counts_as") == "Adult" and await view(S["kid"], "shared/u90", hand.name) == 404 and await view(S["member"], "shared/u90", hand.name) == 404
        st, page = await j(S["admin"], "GET", GATE + "/gate/admin")
        checks["admin: the page shows a hand-placed file as 'counts as Adult'"] = isinstance(page, str) and "counts as Adult" in page.split(f'data-output="{rel}"', 1)[-1][:600]
        st, out = await rate(S["member"], rel, "pg")
        checks["member can't rate outputs (403)"] = st == 403
        st, out = await rate(S["admin"], rel, "pg", headers={"Origin": "http://evil.example"})
        checks["a cross-site post is refused (403)"] = st == 403
        for bad in ("shared/../kid/x.png", "kid/x.png", "/etc/hostname", f"shared/u90/missing_{T}.png"):
            st, out = await rate(S["admin"], bad, "pg")
            checks[f"admin: {bad} is refused (outside output/shared or not a file)"] = st in (400, 404)
        # a run's own rating: the admin's Adult save into shared/ is hidden from the kid; the admin's PG rating wins over it
        st, out = await j(S["admin"], "POST", GATE + "/prompt", json={"prompt": {
            "1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
            "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": f"shared/u90/run_{T}"}},
            "3": {"class_type": "PrimitiveString", "inputs": {"value": "test/greyscale-adult.safetensors"}}}})
        made = None
        for _ in range(60):
            _, h = await j(S["admin"], "GET", f"{GATE}/history/{out.get('prompt_id')}")
            if isinstance(h, dict) and out.get("prompt_id") in h and h[out["prompt_id"]].get("status", {}).get("completed") is not None:
                made = h[out["prompt_id"]]["outputs"]["2"]["images"][0]
                break
            await asyncio.sleep(0.5)
        R["run_file"] = made
        checks["kid: the admin's Adult-rated run in shared/ is 404"] = made is not None and await view(S["kid"], made["subfolder"], made["filename"]) == 404
        st, out = await rate(S["admin"], f"{made['subfolder']}/{made['filename']}" if made else "", "pg")
        await j(S["admin"], "GET", GATE + "/history")  # the gate re-learns the run's own rating from history here
        await asyncio.sleep(5.5)
        await j(S["kid"], "GET", GATE + "/api/jobs?limit=5")
        checks["kid: ... the admin's PG rating wins over the run's own, after history is read again (200)"] = st == 200 and made is not None and await view(S["kid"], made["subfolder"], made["filename"]) == 200
        await rate(S["admin"], f"{made['subfolder']}/{made['filename']}" if made else "", None)
        checks["kid: ... and Unrated hands it back to the run's own rating (404)"] = made is not None and await view(S["kid"], made["subfolder"], made["filename"]) == 404
        kept = json.loads((BASE / "gate_state" / "outputs.json").read_text())
        checks["the admin's ratings are kept in the gate's outputs.json"] = isinstance(kept.get("admin"), dict)
    finally:
        for s in S.values():
            await s.close()
    R["checks"] = checks
    C.out("snapbox", "test_u90_admin_outputs_result.json").write_text(json.dumps(R, indent=1))
    bad = [k for k, v in checks.items() if not v]
    print(f"u90outs  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")

asyncio.run(main())
