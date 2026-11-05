"""Call one Snap tool from a shell, through the bridge to the newest Snap page of your user (a person's tab or an agent's
headless page from snap_agent_page.sh). Pictures (screenshot, take_frames) are saved as files in a folder of their own
under the system temp folder (snapcall-pictures/<time>-<tool>-<unique>/ per call, never where you run it: U72 F27, F29) and their paths and folder (saved_in) printed. SNAP_TOKEN in the environment goes out as a Bearer header (a snap-gate account token).
usage: python3 snapcall.py <port or base URL> <tool> ['<json args>']
  e.g. python3 snapcall.py 8188 get_profile
       python3 snapcall.py 8188 run_status '{"wait_s": 25}'
SNAP-R30 the agent front door · see docs/SNAP_RULES.md
"""
import base64
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

if len(sys.argv) < 3:
    sys.exit(__doc__)
where, tool = sys.argv[1], sys.argv[2]
base = (f"http://127.0.0.1:{where}" if where.isdigit() else where).rstrip("/")
args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
auth = {"Authorization": f"Bearer {os.environ['SNAP_TOKEN']}"} if os.environ.get("SNAP_TOKEN") else {}
request = urllib.request.Request(f"{base}/mainodes/snap/call", data=json.dumps({"tool": tool, "args": args}).encode(), headers={"Content-Type": "application/json", **auth})
try:
    with urllib.request.urlopen(request, timeout=60) as r:
        out = json.load(r)
except urllib.error.HTTPError as e:  # the bridge answers errors as JSON too: print them as they are
    text = e.read().decode(errors="replace")
    try:
        out = json.loads(text)
    except ValueError:
        out = {"error": f"ComfyUI answered {e.code}: {text}"}
except urllib.error.URLError as e:
    sys.exit(json.dumps({"error": f"ComfyUI is not reachable at {base} ({e.reason})"}))
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
