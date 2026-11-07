"""Astrid actions snap.call and snap.pages: one Snap tool call over Snap's bridge (POST /mainodes/snap/call), its whole
answer written to --out. Self-contained (Astrid copies a pack when it installs it, so nothing is looked up beside it):
SNAP_BASE must be this machine (loopback); SNAP_AGENT names the agent to Snap (X-Snap-Agent), so --page binds it to one
page and later calls keep going there; SNAP_PAGE names a page for one call; SNAP_TOKEN goes out only behind a snap-gate.
Every call carries an Idempotency-Key (--idempotency-key, else a new one), retried with the same key on a timeout or
while Snap says the first call still runs, so it never runs twice. Pictures land in a folder beside --out, their paths
in the answer. Exit 0 with the answer, 1 when the answer is an error.
SNAP-R18 loopback only · SNAP-R30 the agent front door · SNAP-R58 never trimmed · SNAP-R159/R208 an idempotency key per
call · SNAP-R211 Astrid drives Snap through its own tool table · SNAP-R220 the pack carries what it runs · see
docs/snap/SNAP_RULES.md in ComfyUI-MAINodes
"""
import argparse
import base64
import ipaddress
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--tool", required=True)
parser.add_argument("--args", default="{}", help="the tool's arguments as JSON")
parser.add_argument("--page", help="a page id, the start of one, or a name from snap.pages: binds this agent to it first")
parser.add_argument("--idempotency-key", help="the same key, the same answer: a retried call never runs twice")
parser.add_argument("--out", required=True)
a = parser.parse_args()


def write(answer, code):
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(answer, f, indent=1, ensure_ascii=False)
    sys.exit(code)


base = os.environ.get("SNAP_BASE", "http://127.0.0.1:8188").rstrip("/")
host = urlsplit(base).hostname or ""
try:
    local = host == "localhost" or ipaddress.ip_address(host).is_loopback
except ValueError:
    local = False
if not local:
    write({"error": f"SNAP_BASE {base!r} isn't this machine: Snap is reached on loopback only (http://127.0.0.1:<port>); nothing was sent"}, 1)
headers = {"Content-Type": "application/json", **{h: os.environ[e] for h, e in (("X-Snap-Agent", "SNAP_AGENT"), ("X-Snap-Page", "SNAP_PAGE")) if os.environ.get(e)},
           **({"Authorization": f"Bearer {os.environ['SNAP_TOKEN']}"} if os.environ.get("SNAP_TOKEN") else {})}


def call(tool, args, key=None):
    """one bridge call: (HTTP status, its JSON answer, whole)"""
    req = urllib.request.Request(f"{base}/mainodes/snap/call", data=json.dumps({"tool": tool, "args": args}).encode(), headers={**headers, **({"Idempotency-Key": key} if key else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, {"error": f"ComfyUI answered {e.code}: {text}"}


key = a.idempotency_key or f"astrid-{secrets.token_hex(8)}"
try:
    args = json.loads(a.args)
    if a.page:  # bind first (use_page); its refusal (a page another agent drives) is the answer
        status, out = call("use_page", {"page": a.page})
        if status != 200:
            write(out, 1)
    for attempt in range(3):  # SNAP-R159, R208: a timeout or a call still running is asked again with the same key
        status, out = call(a.tool, args, key)
        if not (out.get("in_flight") or status == 504) or attempt == 2:
            break
        time.sleep(2)
except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
    write({"error": f"Snap isn't reachable at {base} ({getattr(e, 'reason', e)}); retry with --idempotency-key {key} to get its answer without running it twice"}, 1)
out.setdefault("idempotency_key", key)
result = out.get("result")
pictures = (result.get("images") or ([result["image"]] if isinstance(result.get("image"), dict) else [])) if isinstance(result, dict) else []
if pictures:
    folder = os.path.join(os.path.dirname(os.path.abspath(a.out)), "pictures")
    os.makedirs(folder, exist_ok=True)
    saved = []
    for i, p in enumerate(pictures):
        path = os.path.join(folder, f"{a.tool}_{i}.{p.get('mimeType', 'image/jpeg').split('/')[-1]}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(p["data"]))
        saved.append(path)
    out["result"] = {**{k: v for k, v in result.items() if k not in ("image", "images")}, "saved": saved, "saved_in": folder}
write(out, 1 if "error" in out else 0)
