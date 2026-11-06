"""U72 F29: two snapcall picture calls in the same second each get their own folder (the folder was named by the second,
so the second call overwrote the first's pictures), and the result says the folder (saved_in). A stub bridge answers
with two pictures; both calls run at once. SNAPCALL=<path> tests another copy."""
import base64, json, os, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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


server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
cmd = [sys.executable, "-I", SNAPCALL, f"http://127.0.0.1:{server.server_port}", "take_frames", '{"take": "t1"}']
procs = [subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=tempfile.mkdtemp(prefix="f29cwd-")) for _ in range(2)]
outs = [json.loads(p.communicate()[0] or "{}") for p in procs]
server.shutdown()
saved = [o.get("result", {}).get("saved", []) for o in outs]
folders = [os.path.dirname(s[0]) if s else None for s in saved]
checks = {
    "both calls saved two pictures": all(len(s) == 2 and all(os.path.isfile(x) for x in s) for s in saved),
    "the two calls got different folders": folders[0] and folders[1] and folders[0] != folders[1],
    "the result says the folder (saved_in)": all(o.get("result", {}).get("saved_in") == f for o, f in zip(outs, folders)),
}
bad = [k for k, v in checks.items() if not v]
print(f"f29snap  {len(checks) - len(bad)}/{len(checks)} {'FAIL ' + json.dumps(bad) if bad else 'PASS'}")
