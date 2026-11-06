#!/usr/bin/env python3
"""A stand-in for Chrome in test_agent_page.py's start path (no window, no browser): it records its arguments in
<user-data-dir>/argv and answers DevTools' /json/version and /json/list on its --remote-debugging-port until killed."""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
Path(opts["user-data-dir"], "argv").write_text(json.dumps(sys.argv[1:]))


class DevTools(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"Browser": "fake"} if self.path.startswith("/json/version") else []).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


HTTPServer(("127.0.0.1", int(opts["remote-debugging-port"])), DevTools).serve_forever()
