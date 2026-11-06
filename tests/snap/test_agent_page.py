"""SNAP-R83 (G1, the operator 2026-11-06: "an open chrome window you can control and hook into and restart and make it non
headless always"; one agents' window on 127.0.0.1:9222, attached to, never started twice): tools/snap_agent_page.sh on a
CPU server (:8196), as an agent meets it.
- the live agents' window (9222, the person's) is only read: status lists it; start attaches to it and starts nothing
  (its processes unchanged) and, as it has no tab on :8196, opens none by itself but says how to ask; new without
  --asked is refused; --extra is refused while 9222 has a tab on the same server (never a duplicate)
- the start path when nothing answers runs a fake launcher (fixtures/fake_chrome.py: no window) on a test port: with no
  display it refuses (never headless); with one it launches under systemd-run with the agents' flags (DevTools on
  127.0.0.1, tab capture accepted, local hosts only) and no --headless; stop ends every process of its profile
- with no page open, a call says how to open the agents' window
- tools/snap_mcp.py and tools/snapcall.py send SNAP_TOKEN as a Bearer header to the base URL they are given (U75b)
The bridge side (the window's tab is managed and sees, calls go there, screenshot, reload after an update) is in
test_g1_window.js. usage: comfyui_venv/bin/python -I test_agent_page.py [fresh port 8196]
"""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.FRESH_PORT
BASE = f"http://127.0.0.1:{PORT}"
PACK = C.PACK
LAUNCH = PACK / "tools" / "snap_agent_page.sh"
HERE = Path(__file__).parent
MAIN = str(Path.home() / ".config" / "snap-agent-chrome")
FAKE = {"SNAP_CHROME_PORT": "9339", "SNAP_CHROME_PROFILE": str(C.out("_debug", "fake_agents_window")), "SNAP_CHROME_BIN": str(HERE / "fixtures" / "fake_chrome.py")}
R = {}


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=40) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def call(tool, args=None):
    req = urllib.request.Request(BASE + "/mainodes/snap/call", data=json.dumps({"tool": tool, "args": args or {}}).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def sh(*args, env=None, timeout=60):
    try:
        p = subprocess.run(["bash", str(LAUNCH), PORT, *args], capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})
        return {"code": p.returncode, "out": p.stdout.strip(), "err": p.stderr.strip()}
    except subprocess.TimeoutExpired as e:
        return {"code": "timeout", "out": (e.stdout or b"").decode().strip(), "err": (e.stderr or b"").decode().strip()}


def procs(profile):
    rows = [line.split(None, 2) for line in subprocess.run(["ps", "-eo", "pid=,pgid=,args="], capture_output=True, text=True).stdout.splitlines()]
    return sorted(int(p) for p, _, a in rows if f"{profile} " in f"{a} " or f"{profile}/" in a)


up = lambda port: subprocess.run(["curl", "-sf", "--max-time", "2", f"http://127.0.0.1:{port}/json/version"], capture_output=True).returncode == 0
R["mainUp"] = up(9222)
R["mainBefore"] = procs(MAIN)
R["status"] = sh("status")
R["start"] = sh()
R["mainAfter"] = procs(MAIN)
R["newUnasked"] = sh("new")
R["mainTabs"] = [t["url"] for t in json.loads(subprocess.run(["curl", "-s", "http://127.0.0.1:9222/json/list"], capture_output=True, text=True).stdout or "[]") if t.get("type") == "page"] if R["mainUp"] else []

# the start path, nothing answering on the test port: a fake launcher, no window
fake = FAKE["SNAP_CHROME_PROFILE"]
sh("stop", env=FAKE)
Path(fake).mkdir(parents=True, exist_ok=True)
(Path(fake) / "argv").unlink(missing_ok=True)
R["noDisplay"] = sh(env={**FAKE, "DISPLAY": "", "WAYLAND_DISPLAY": ""})
R["noDisplayArgv"] = (Path(fake) / "argv").exists()
R["fakeStart"] = sh(env={**FAKE, "DISPLAY": os.environ.get("DISPLAY") or ":1"}, timeout=12)  # no Snap tab registers from a fake: cut the wait
R["fakeArgv"] = json.loads((Path(fake) / "argv").read_text()) if (Path(fake) / "argv").exists() else None
R["fakeUnit"] = subprocess.run(["systemctl", "--user", "is-active", "snap-chrome-9339"], capture_output=True, text=True).stdout.strip()
R["fakeProcs"] = procs(fake)
R["fakeStop"] = sh("stop", env=FAKE)
time.sleep(0.5)
R["fakeAfter"] = procs(fake)
R["fakeUp"] = up(9339)
R["noPage"] = call("get_profile")


# U75b: a token and a base URL, sent the way the gate expects them
class Seen(BaseHTTPRequestHandler):
    got = []

    def do_GET(self):
        Seen.got.append({"path": self.path, "auth": self.headers.get("Authorization")})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"tools": [], "pages": []}')

    do_POST = do_GET

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), Seen)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}"
env = {**os.environ, "SNAP_TOKEN": "tok-123"}
mcp = subprocess.run([sys.executable, "-I", str(PACK / "tools" / "snap_mcp.py"), "--base-url", url], input=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}) + "\n",
                     capture_output=True, text=True, env=env, timeout=30)
R["mcpToken"] = {"code": mcp.returncode, "seen": list(Seen.got), "err": mcp.stderr[-300:]}
Seen.got.clear()
cli = subprocess.run([sys.executable, "-I", str(PACK / "tools" / "snapcall.py"), url, "get_profile"], capture_output=True, text=True, env=env, timeout=30)
R["snapcallToken"] = {"code": cli.returncode, "seen": list(Seen.got), "err": cli.stderr[-300:]}
srv.shutdown()

argv = R["fakeArgv"] or []
on8196 = any(u.startswith(BASE) for u in R["mainTabs"])
checks = {
    "status reads the live agents' window": not R["mainUp"] or "The agents' window runs (DevTools 127.0.0.1:9222" in R["status"]["out"],
    "start attaches to 9222 and starts nothing": not R["mainUp"] or (R["mainAfter"] == R["mainBefore"] and (R["start"]["code"] == 0 if on8196 else (R["start"]["code"] == 1 and "opens none by itself" in R["start"]["err"] and "--asked" in R["start"]["err"]))),
    "new without the person's yes is refused": R["newUnasked"]["code"] == 1 and "--asked" in R["newUnasked"]["err"] and "never headless" in R["newUnasked"]["err"],
    "no display: refused, never headless, nothing launched": R["noDisplay"]["code"] == 1 and "never runs headless" in R["noDisplay"]["err"] and not R["noDisplayArgv"],
    "nothing on its port: it launches (systemd-run) with the agents' flags, never --headless": R["fakeUnit"] == "active" and not any("headless" in a for a in argv)
        and f"--user-data-dir={fake}" in argv and "--remote-debugging-port=9339" in argv and "--remote-debugging-address=127.0.0.1" in argv
        and "--auto-accept-this-tab-capture" in argv and "--auto-select-tab-capture-source-by-title=Snap" in argv and any(a.startswith("--host-resolver-rules=MAP * ~NOTFOUND") for a in argv) and argv[-1] == f"{BASE}/?snap",
    "stop ends every process of its profile": R["fakeProcs"] != [] and R["fakeStop"]["code"] == 0 and R["fakeAfter"] == [] and not R["fakeUp"],
    "with no page, a call says how to open the agents' window": R["noPage"][0] == 503 and "snap_agent_page.sh" in R["noPage"][1]["error"] and "never headless" in R["noPage"][1]["error"],
    "snap_mcp.py and snapcall.py send the token": R["mcpToken"]["seen"] == [{"path": "/mainodes/snap/tools", "auth": "Bearer tok-123"}] and R["snapcallToken"].get("seen") == [{"path": "/mainodes/snap/call", "auth": "Bearer tok-123"}],
}
R["checks"] = checks
C.out("ui", "test_agent_page_result.json").write_text(json.dumps(R, indent=1))
print(json.dumps(R, indent=1))
bad = 0
for k, v in checks.items():
    print(("PASS " if v else "FAIL ") + k)
    bad += not v
print(f"agentpage {len(checks) - bad}/{len(checks)}")
sys.exit(1 if bad else 0)
