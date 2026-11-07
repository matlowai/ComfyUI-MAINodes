"""Call one Snap tool from a shell, through the bridge to a Snap page of your user. Name yourself with SNAP_AGENT (e.g.
SNAP_AGENT=anime-studio): `--page <id|name>` then binds you to that page (use_page) and later calls without --page keep
going there; one agent drives a page at a time. `pages` lists your pages (ids, names, who drives them). With nothing
picked, calls go to the newest tab that sees: the agents' window (snap_agent_page.sh, SNAP-R83) or a tab whose person
turned "Let agents see" on. SNAP_PAGE names a page for one call without binding. Pictures (screenshot, take_frames) are saved as files in a folder of their own
under the system temp folder (snapcall-pictures/<time>-<tool>-<unique>/ per call, never where you run it: U72 F27, F29) and their paths and folder (saved_in) printed. SNAP_TOKEN in the environment goes out as a Bearer header (a snap-gate account token).
usage: python3 snapcall.py <port or base URL> [--page <id|name>] <tool> ['<json args>']
       python3 snapcall.py <port or base URL> pages
  e.g. python3 snapcall.py 8188 get_profile
       SNAP_AGENT=my-studio python3 snapcall.py 8188 --page 3f9a2c run
       python3 snapcall.py 8188 run_status '{"wait_s": 25}'
Every call carries an Idempotency-Key (SNAP-R159; SNAP_IDEMPOTENCY_KEY names one, else a new one per call, printed as
idempotency_key): a call the bridge timed out on, or a dropped connection, is retried here with the same key, and the bridge
answers the first call's answer instead of running it twice (`in_flight: true` while it still runs: asked again here). To retry
a whole command yourself, run it again with SNAP_IDEMPOTENCY_KEY=<the key it printed> (the bridge keeps answers a day).
SNAP-R30 the agent front door · SNAP-R159 retries reuse the call's key · SNAP-R208 in_flight is asked again · see docs/snap/SNAP_RULES.md
"""
import base64
import json
import os
import secrets
import sys
import tempfile
import time
import urllib.error
import urllib.request

argv = sys.argv[1:]
page = None
if "--page" in argv:
    i = argv.index("--page")
    page = argv[i + 1] if i + 1 < len(argv) else sys.exit("--page takes a page id or name (python3 snapcall.py <port> pages lists them)")
    del argv[i:i + 2]
if len(argv) < 2:
    sys.exit(__doc__)
where, tool = argv[0], argv[1]
base = (f"http://127.0.0.1:{where}" if where.isdigit() else where).rstrip("/")
args = json.loads(argv[2]) if len(argv) > 2 else {}
if tool == "pages":
    tool = "list_pages"
auth = {"Authorization": f"Bearer {os.environ['SNAP_TOKEN']}"} if os.environ.get("SNAP_TOKEN") else {}
auth.update({"X-Snap-Page": os.environ["SNAP_PAGE"]} if os.environ.get("SNAP_PAGE") else {})
auth.update({"X-Snap-Agent": os.environ["SNAP_AGENT"]} if os.environ.get("SNAP_AGENT") else {})
if page is not None:  # bind first (use_page); its refusal (a page another agent drives) is printed as the answer
    bind = urllib.request.Request(f"{base}/mainodes/snap/call", data=json.dumps({"tool": "use_page", "args": {"page": page}}).encode(), headers={"Content-Type": "application/json", **auth})
    try:
        urllib.request.urlopen(bind, timeout=60).read()
    except urllib.error.HTTPError as e:
        sys.exit(e.read().decode(errors="replace"))
key = os.environ.get("SNAP_IDEMPOTENCY_KEY") or f"snapcall-{secrets.token_hex(8)}"
request = urllib.request.Request(f"{base}/mainodes/snap/call", data=json.dumps({"tool": tool, "args": args}).encode(), headers={"Content-Type": "application/json", "Idempotency-Key": key, **auth})
for attempt in range(3):  # SNAP-R159: a timeout or a dropped connection is retried with the same key, so it never runs twice
    try:
        with urllib.request.urlopen(request, timeout=60) as r:
            out = json.load(r)
        if not out.get("in_flight") or attempt == 2:  # SNAP-R208: the first call still runs on its page: ask again for its answer
            break
    except urllib.error.HTTPError as e:  # the bridge answers errors as JSON too: print them as they are
        text = e.read().decode(errors="replace")
        try:
            out = json.loads(text)
        except ValueError:
            out = {"error": f"ComfyUI answered {e.code}: {text}"}
        if e.code != 504 or attempt == 2:
            break
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        if attempt == 2:
            sys.exit(json.dumps({"error": f"ComfyUI is not reachable at {base} ({getattr(e, 'reason', e)}); to retry this call without running it twice: SNAP_IDEMPOTENCY_KEY={key}", "idempotency_key": key}))
    time.sleep(2)
out.setdefault("idempotency_key", key)
result = out.get("result")
pictures = (result.get("images") or ([result["image"]] if isinstance(result.get("image"), dict) else [])) if isinstance(result, dict) else []
if pictures:
    stamp, saved, root = time.strftime("%Y%m%d-%H%M%S"), [], os.path.join(tempfile.gettempdir(), "snapcall-pictures")
    os.makedirs(root, exist_ok=True)
    folder = tempfile.mkdtemp(prefix=f"{stamp}-{tool}-", dir=root)  # U72 F29: one folder per call, even two in one second
    for i, p in enumerate(pictures):
        path = os.path.join(folder, f"{tool}_{i}.{p.get('mimeType', 'image/jpeg').split('/')[-1]}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(p["data"]))
        saved.append(path)
    out = {**out, "result": {**{k: v for k, v in result.items() if k not in ("image", "images")}, "saved": saved, "saved_in": folder}}
print(json.dumps(out, indent=1))
sys.exit(1 if "error" in out else 0)
