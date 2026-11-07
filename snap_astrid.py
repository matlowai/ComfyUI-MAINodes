"""Snap <-> Astrid on the server (PROTOCOL_V1_1): where Astrid is on this machine (the person's settings "Astrid on this
machine": its launcher and Runtime data root), and the one way the server runs it: tools/astrid_push.py as a child
process outside ComfyUI's Python, in an environment built here (no key or token of this server's reaches it), on
loopback, for a request from this machine only.
SNAP-R215 every archive is probed before the answer · SNAP-R18 local only · see docs/snap/SNAP_RULES.md"""
import asyncio
import json
import os
import sys
from pathlib import Path

from comfy.cli_args import args
from server import PromptServer

PUSH = Path(__file__).parent / "tools" / "astrid_push.py"
LAUNCHER, DATA_ROOT = "MAINodes.Snap.AstridLauncher", "MAINodes.Snap.AstridDataRoot"  # the page registers them (snap_view.js)
LOOPBACK = {"127.0.0.1", "::1"}


def where(request):
    """{launcher, data_root} from the person's ComfyUI settings, or {said: why Astrid can't run}"""
    path = PromptServer.instance.user_manager.get_request_user_filepath(request, "comfy.settings.json")
    settings = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            settings = json.load(f)
    launcher, root = str(settings.get(LAUNCHER) or "").strip(), str(settings.get(DATA_ROOT) or "").strip()
    if not launcher:
        return {"said": "Astrid isn't set up on this machine: say where its launcher is (Settings > MAINodes > Snap > Astrid)"}
    if not (os.path.isabs(launcher) and os.path.isfile(launcher) and os.access(launcher, os.X_OK)):
        return {"said": f"The Astrid launcher {launcher!r} isn't an executable file on this machine (Settings > MAINodes > Snap > Astrid)"}
    if root and not os.path.isdir(root):
        return {"said": f"The Astrid data root {root!r} isn't a folder on this machine (Settings > MAINodes > Snap > Astrid)"}
    return {"launcher": launcher, "data_root": root or None}


async def run(request, *argv):
    """tools/astrid_push.py <argv>: (exit code, its one JSON answer, whole; or what it printed when that isn't JSON).
    The child's environment is built, never inherited: PATH, HOME, the Runtime's data root, this server's loopback base
    and the agent name it calls back with (the lab found Astrid's host inheriting provider keys from a tool shell)."""
    if request.remote not in LOOPBACK:
        return 1, {"ok": False, "error": "not_loopback", "message": f"Astrid runs only for a request from this machine; this one came from {request.remote}"}
    at = where(request)
    if "said" in at:
        return 1, {"ok": False, "error": "no_launcher", "message": at["said"]}
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": os.path.expanduser("~"), "SNAP_BASE": f"http://127.0.0.1:{args.port}", "SNAP_AGENT": "snap-push",
           **({"ASTRID_RUNTIME_DATA_ROOT": at["data_root"]} if at["data_root"] else {})}
    proc = await asyncio.create_subprocess_exec(sys.executable, "-I", str(PUSH), *argv, "--launcher", at["launcher"], env=env, cwd=str(PUSH.parent),
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    text = out.decode(errors="replace").strip()
    try:
        return proc.returncode, json.loads(text)
    except ValueError:
        return proc.returncode or 1, {"ok": False, "error": "no_answer", "message": f"{text}\n{err.decode(errors='replace')}".strip()}
