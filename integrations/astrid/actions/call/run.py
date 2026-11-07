"""Astrid actions snap.call and snap.pages: one Snap tool call through the pack's tools/snapcall.py, its whole answer
written to --out. SNAP_BASE must be this machine (loopback); SNAP_AGENT names the agent to Snap (X-Snap-Agent), so
--page binds it to one page and later calls keep going there; SNAP_TOKEN goes out only behind a snap-gate. Astrid copies
a pack when it installs it, so SNAP_PACK names the ComfyUI-MAINodes folder (run in place, the repo's own is used).
Pictures land in a folder under --out's directory. Exit 0 with the answer, 1 when the answer is an error.
SNAP-R18 loopback only · SNAP-R30 the agent front door · SNAP-R58 never trimmed · SNAP-R159/R208 an idempotency key per
call · SNAP-R211 Astrid drives Snap through its own tool table · see docs/snap/SNAP_RULES.md in ComfyUI-MAINodes
"""
import argparse
import ipaddress
import json
import os
import subprocess
import sys
from pathlib import Path
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
snapcall = Path(os.environ["SNAP_PACK"]) / "tools" / "snapcall.py" if os.environ.get("SNAP_PACK") else Path(__file__).resolve().parents[4] / "tools" / "snapcall.py"
if not snapcall.is_file():
    write({"error": f"Snap's client isn't at {snapcall}: set SNAP_PACK to the ComfyUI-MAINodes folder (custom_nodes/ComfyUI-MAINodes)"}, 1)
out_dir = os.path.dirname(os.path.abspath(a.out))
env = {**os.environ, "TMPDIR": out_dir, **({"SNAP_IDEMPOTENCY_KEY": a.idempotency_key} if a.idempotency_key else {})}  # pictures land beside the answer
r = subprocess.run([sys.executable, str(snapcall), base, *(["--page", a.page] if a.page else []), a.tool, a.args], capture_output=True, text=True, env=env)
for text in (r.stdout, r.stderr):  # snapcall prints its answer, or exits with it (ComfyUI unreachable, a refused bind)
    try:
        write(json.loads(text), r.returncode)
    except ValueError:
        pass
write({"error": f"snapcall.py exited {r.returncode}: {r.stderr or r.stdout}"}, 1)
