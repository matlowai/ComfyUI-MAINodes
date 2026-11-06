"""U83 + U88 (2) behind snap-gate, on the gatetest install (accounts admin / member / kid, test_accounts.json):
U83: uploads land in input/<person>/ (the admin's too); input/shared/ is the admin's to fill; a person views and loads
their own input, shared input and top-level files, never another account's (the admin sees all); loading is decided by
scope, not by the path's form: a non-admin may name a library file by absolute path within their cap, nothing outside
the library or their own and shared folders; lists never name another account's input folder; core's assets API is
the admin's.
U88 (2): outputs carry the rating the pack gave the prompt that wrote them (extra_data.snap_marks.rating); a viewer
never gets a file above their cap in shared/: /view is 404; a file in output/shared/ nobody rated (put there by hand)
counts as Adult. U90 (3): a member's prompt whose words rate above its cap is refused when queued, so it never renders.
Queues only 64 px EmptyImage -> SaveImage prompts. Uploaded and hand-placed files stay (no deletes; names carry the
run's time). Prints one line, writes test_u83_u88_gate_result.json.
usage: comfyui_venv/bin/python -I test_u83_u88_gate.py [gate 8297] [comfy base dir]"""
import os
import asyncio
import io
import json
import re
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
checks = {}


def png():
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (40, 90, 160)).save(b, "PNG")
    return b.getvalue()


def save_prompt(prefix, text=None):
    p = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
         "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": prefix}}}
    if text:  # a node nothing runs: the pack still rates the prompt by every input it holds (SNAP-R39)
        p["3"] = {"class_type": "PrimitiveString", "inputs": {"value": text}}
    return p


def load_prompt(value):
    return {"1": {"class_type": "LoadImage", "inputs": {"image": value}}, "2": {"class_type": "PreviewImage", "inputs": {"images": ["1", 0]}}}


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
            return r.status, raw[:200]


async def upload(s, name, subfolder=None, kind=None):
    form = aiohttp.FormData()
    form.add_field("image", png(), filename=name, content_type="image/png")
    if subfolder is not None:
        form.add_field("subfolder", subfolder)
    if kind:
        form.add_field("type", kind)
    return await j(s, "POST", GATE + "/upload/image", data=form)


async def run(s, prompt):
    st, out = await j(s, "POST", GATE + "/prompt", json={"prompt": prompt})
    if st != 200:
        return st, out, None
    for _ in range(60):
        _, h = await j(s, "GET", f"{GATE}/history/{out['prompt_id']}")
        if out["prompt_id"] in h and h[out["prompt_id"]].get("status", {}).get("completed"):
            return st, out, h[out["prompt_id"]]
        await asyncio.sleep(0.5)
    return st, out, None


def gated(st, out):
    return st == 403 and isinstance(out, dict) and isinstance(out.get("error"), dict) and out["error"].get("type") == "snap_gate"


def view(f, kind="input"):
    return f"{GATE}/view?filename={f['name'] if 'name' in f else f['filename']}&subfolder={f.get('subfolder', '')}&type={f.get('type', kind)}"


async def main():
    S = {n: await session(n) for n in ("admin", "member", "kid")}
    R = {}
    try:
        # ---- U83: uploads land in the person's folder ----
        st, up = await upload(S["member"], f"u83_m_{T}.png")
        R["member_upload"] = up
        checks["member's upload lands in input/member/"] = st == 200 and up.get("subfolder") == "member" and (BASE / "input" / "member" / up["name"]).is_file()
        st, up2 = await upload(S["member"], f"u83_m2_{T}.png", "snap")
        checks["member's upload to snap/ lands in input/member/snap/"] = st == 200 and up2.get("subfolder") == "member/snap"
        st, out = await upload(S["member"], f"u83_ms_{T}.png", "shared")
        checks["member can't upload into input/shared/ (the admin's)"] = st == 403 and not (BASE / "input" / "shared" / f"u83_ms_{T}.png").exists()
        st, out = await upload(S["member"], f"u83_mk_{T}.png", "kid")
        checks["member can't upload into kid's folder"] = st == 200 and out.get("subfolder") == "member/kid"
        st, adm = await upload(S["admin"], f"u83_a_{T}.png")
        checks["admin's upload lands in input/admin/ (admin is a person too)"] = st == 200 and adm.get("subfolder") == "admin"
        st, sh = await upload(S["admin"], f"u83_s_{T}.png", "shared")
        checks["admin's upload to shared/ lands in input/shared/"] = st == 200 and sh.get("subfolder") == "shared" and (BASE / "input" / "shared" / sh["name"]).is_file()
        st, kidup = await upload(S["kid"], f"u83_k_{T}.png")

        # ---- U83: who sees which input ----
        for viewer, f, ok in (("member", up, True), ("kid", up, False), ("admin", up, True), ("kid", sh, True), ("kid", kidup, True)):
            st, _ = await j(S[viewer], "GET", view(f))
            checks[f"{viewer}: /view of input/{f['subfolder']}/ -> {'200' if ok else '404'}"] = (st == 200) == ok
        st, _ = await j(S["kid"], "GET", f"{GATE}/view?filename=member/{up['name']}&type=input")
        checks["kid: member's input spelled as a path in the name -> 404"] = st == 404
        st, _ = await j(S["kid"], "GET", f"{GATE}/view?filename={up['name']}&subfolder=kid/../member&type=input")
        checks["kid: member's input by a climbing subfolder -> 404"] = st == 404

        # ---- U83: loading by scope ----
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": load_prompt(f"member/{up['name']}")})
        checks["kid: LoadImage of member's upload is refused"] = gated(st, out)
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": load_prompt(f"member/{up['name']} [input]")})
        checks["kid: ... spelled with [input] is refused"] = gated(st, out)
        st, out, h = await run(S["kid"], load_prompt(f"shared/{sh['name']}"))
        checks["kid: LoadImage of a shared input runs"] = st == 200 and h is not None
        st, out, h = await run(S["kid"], load_prompt(f"kid/{kidup['name']}"))
        checks["kid: LoadImage of its own upload runs"] = st == 200 and h is not None
        st, out = await j(S["admin"], "POST", GATE + "/prompt", json={"prompt": load_prompt(f"member/{up['name']}")})
        checks["admin: LoadImage of member's upload reaches ComfyUI"] = st == 200
        lib = BASE / "models" / "loras" / "test"
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": {"1": {"class_type": "MAILoadVideoPath", "inputs": {"path": str(lib / "greyscale-pg.safetensors")}}}})
        checks["kid: a PG library file by absolute path is in scope (reaches ComfyUI)"] = not gated(st, out)
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": {"1": {"class_type": "MAILoadVideoPath", "inputs": {"path": str(lib / "greyscale-adult.safetensors")}}}})
        checks["kid: an Adult library file by absolute path is refused (rating)"] = gated(st, out) and "rating" in str(out)
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": {"1": {"class_type": "MAILoadVideoPath", "inputs": {"path": "/etc/hostname"}}}})
        checks["kid: a file outside the library by absolute path is refused"] = gated(st, out) and "outside" in str(out)
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": {"1": {"class_type": "MAILoadVideoPath", "inputs": {"path": str(BASE / "input" / "member" / up["name"])}}}})
        checks["kid: member's input by absolute path is refused"] = gated(st, out)
        st, out = await j(S["kid"], "POST", GATE + "/prompt", json={"prompt": {"1": {"class_type": "MAILoadVideoPath", "inputs": {"path": str(BASE / "input" / "kid" / kidup["name"])}}}})
        checks["kid: its own input by absolute path is in scope"] = not gated(st, out)

        # ---- U83: lists never name another account's input ----
        st, info = await j(S["kid"], "GET", GATE + "/object_info/MAIDialMakeFromPictures")
        folders = json.dumps(info)
        checks["kid: input folder lists don't name member/ or admin/"] = st == 200 and '"member' not in folders and '"admin' not in folders
        st, info = await j(S["admin"], "GET", GATE + "/object_info/MAIDialMakeFromPictures")
        checks["admin: input folder lists name member/"] = '"member' in json.dumps(info)
        st, _ = await j(S["kid"], "GET", GATE + "/api/assets")
        checks["kid: core's assets API is the admin's (403)"] = st == 403
        async with S["kid"].get(GATE + "/", headers={"Accept": "text/html"}) as r:
            script = re.search(r'assets/index-[^"\']+\.js', await r.text())
        st, _ = await j(S["kid"], "GET", f"{GATE}/{script.group(0)}") if script else (None, None)
        checks["kid: the frontend's own /assets/ files load (not the assets API)"] = st == 200

        # ---- U88 (2): outputs above the viewer's cap ----
        st, adult, h = await run(S["admin"], save_prompt(f"shared/u88_adult_{T}", "test/greyscale-adult.safetensors"))
        fa = h["outputs"]["2"]["images"][0] if h else {}
        R["adult_marks"] = (h or {}).get("prompt", [None] * 4)[3].get("snap_marks") if h else None
        st, pg, h2 = await run(S["admin"], save_prompt(f"shared/u88_pg_{T}"))
        fp = h2["outputs"]["2"]["images"][0] if h2 else {}
        for viewer, f, ok in (("kid", fa, False), ("member", fa, False), ("admin", fa, True), ("kid", fp, True)):
            st, _ = await j(S[viewer], "GET", view(f, "output"))
            checks[f"{viewer}: /view of a shared {'Adult' if f is fa else 'PG'} output -> {'200' if ok else '404'}"] = (st == 200) == ok
        hand = BASE / "output" / "shared" / f"u88_by_hand_{T}.png"
        hand.write_bytes(png())
        st, _ = await j(S["kid"], "GET", f"{GATE}/view?filename={hand.name}&subfolder=shared&type=output")
        checks["kid: a shared output nobody rated (by hand) counts as Adult -> 404"] = st == 404
        st, _ = await j(S["admin"], "GET", f"{GATE}/view?filename={hand.name}&subfolder=shared&type=output")
        checks["admin: ... it answers"] = st == 200
        # U90 (3): words that rate a member's prompt above Mature are refused when it is queued, so its own run is never
        # rendered and then hidden (the gate's cap filter on its own runs stays as a second line nothing reaches now)
        st, out = await j(S["member"], "POST", GATE + "/prompt", json={"prompt": save_prompt(f"u88_words_{T}", "a nude figure study")})
        R["member_words"] = out
        said = json.dumps(out)
        checks["member: a prompt whose words rate Adult (above Mature) is refused when queued, saying why"] = st == 400 and "nude" in said and "Mature cap" in said
        checks["member: ... so it wrote no file"] = not list((BASE / "output" / "member").glob(f"u88_words_{T}*"))
    finally:
        for s in S.values():
            await s.close()
    R["checks"] = checks
    C.out("snapbox", "test_u83_u88_gate_result.json").write_text(json.dumps(R, indent=1))
    bad = [k for k, v in checks.items() if not v]
    print(f"u83u88   {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")

asyncio.run(main())
