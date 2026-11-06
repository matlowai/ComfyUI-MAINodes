"""U72 F27: snapcall.py saves a tool's pictures under the temp folder (snapcall-pictures/), never in the directory it runs
from, and prints their paths. A stub bridge answers one call with two pictures. SNAPCALL=<path> tests another copy."""
import base64, json, os, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

SNAPCALL = os.environ.get("SNAPCALL", str(C.PACK / "tools" / "snapcall.py"))
PNG = base64.b64encode(bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000")).decode()


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = json.dumps({"result": {"take": "t1", "images": [{"mimeType": "image/png", "data": PNG}] * 2}, "page": {"headless": True, "code_current": True}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):
        pass


server = HTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
cwd = tempfile.mkdtemp(prefix="f27cwd-")
run = subprocess.run([sys.executable, "-I", SNAPCALL, f"http://127.0.0.1:{server.server_port}", "take_frames", '{"take": "t1"}'], cwd=cwd, capture_output=True, text=True)
server.shutdown()
out = json.loads(run.stdout) if run.stdout.strip().startswith("{") else {}
saved = (out.get("result") or {}).get("saved") or []
checks = {
    "nothing is written where snapcall runs": os.listdir(cwd) == [],
    "both pictures are saved under the temp folder's snapcall-pictures/ and their paths printed": len(saved) == 2 and all(os.path.isfile(p) and os.path.join(tempfile.gettempdir(), "snapcall-pictures") in p for p in saved),
    "the bridge's page note is kept": out.get("page", {}).get("headless") is True,
}
bad = [k for k, v in checks.items() if not v]
print(f"f27      {len(checks) - len(bad)}/{len(checks)} {'FAIL ' + json.dumps(bad) if bad else 'PASS'}")
