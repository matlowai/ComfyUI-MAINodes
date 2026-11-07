"""A local OpenAI-compatible server for the LLM tests. No real network.

It serves POST /v1/chat/completions from a queue of canned answers, records
every request body and its headers, and when the queue is empty answers in
the shape the request asked for: a tool call when `tools` are present, a
`{"value": ...}` object when a `response_format` json_schema is, otherwise
plain text. That default is what makes it a fixture rather than a mock of
one exchange: a test that cares about the answer queues it.

It binds 127.0.0.1 on an ephemeral port, so the sandboxed ComfyUI can reach
it by that port and nothing else can.

Two attackers live here as well, both loopback: a MockLLM built with
`redirect_to` answers 302 instead of a body (the gateway that would hand the
key to another host), and DripServer answers one byte at a time (the server
that outlasts a per-socket timeout).
"""
from __future__ import annotations

import json
import socket
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PATH = "/v1/chat/completions"
FORBIDDEN_PORTS = {8188, 8189, 8190, 8191, 8777, 8791, 8801}
SAMPLE = {"boolean": True, "integer": 3, "number": 0.5, "string": "ok"}


def write_policy(path: str, base_url: str, provider: str = "local", **extra) -> str:
    """A flow_policy.json naming `provider` at `base_url`, and nothing else."""
    document = {"llm_providers": {provider: {"kind": "openai_compatible",
                                             "base_url": base_url,
                                             "api_key_env": "MAINODES_TEST_LLM_KEY",
                                             "default_model": "mock-model"}}}
    document.update(extra)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(document, fh)
    return path


def completion(content=None, tool=None, arguments=None, request_id="mock-1") -> dict:
    """One chat completion envelope: text, or a call to `tool`."""
    message = {"role": "assistant", "content": content}
    if tool is not None:
        message["tool_calls"] = [{"id": "call-1", "type": "function",
                                  "function": {"name": tool,
                                               "arguments": json.dumps(arguments or {})}}]
    return {"id": request_id, "object": "chat.completion", "model": "mock",
            "choices": [{"index": 0, "message": message,
                         "finish_reason": "tool_calls" if tool else "stop"}]}


def _echo(body: dict) -> dict:
    """The answer the request asked for, when no test queued one."""
    tools = body.get("tools")
    if tools:
        return completion(tool=tools[0]["function"]["name"], arguments={})
    schema = (body.get("response_format") or {}).get("json_schema") or {}
    properties = ((schema.get("schema") or {}).get("properties") or {})
    if "value" in properties:
        return completion(json.dumps({"value": SAMPLE.get(properties["value"].get("type"))}))
    if properties:
        return completion(json.dumps({key: SAMPLE.get(value.get("type"))
                                      for key, value in properties.items()}))
    return completion("ok")


class MockLLM:
    """A recording server. `queue` decides the next answer; `requests` keeps all."""

    def __init__(self, redirect_to: str | None = None):
        self.requests: list[dict] = []
        self.headers: list[dict] = []
        # every POST that arrives, whatever its path: `requests` only holds the
        # ones that reached the completions route, so a proxied request landing
        # here as an absolute-URI POST would leave `requests` empty and a test
        # asserting on it would pass while the request went to the wrong host
        self.hits: list[str] = []
        self.redirect_to = redirect_to        # answer 302 instead of a body
        self.answers: deque = deque()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _handler_for(self))
        self.port = self.server.server_address[1]
        assert self.port not in FORBIDDEN_PORTS, f"mock bound a live port: {self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    # ------------------------------------------------------------- lifecycle
    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop()
        return False

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=10)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def policy(self, path: str, provider: str = "local", **extra) -> str:
        """Write a flow_policy.json pointing `provider` at this server."""
        return write_policy(path, self.base_url, provider, **extra)

    # ---------------------------------------------------------------- queue
    def queue(self, payload: dict, status: int = 200):
        self.answers.append((status, payload))

    def queue_content(self, text: str, **kwargs):
        self.queue(completion(text, **kwargs))

    def queue_tool(self, name: str, arguments: dict | None = None, **kwargs):
        self.queue(completion(tool=name, arguments=arguments, **kwargs))

    def queue_status(self, status: int, payload: dict | None = None):
        self.queue(payload or {"error": {"message": "refused"}}, status=status)

    # --------------------------------------------------------------- record
    @property
    def last(self) -> dict:
        assert self.requests, "no request reached the mock server"
        return self.requests[-1]

    def answer(self, body: dict) -> tuple[int, dict]:
        return self.answers.popleft() if self.answers else (200, _echo(body))


def _handler_for(mock: MockLLM):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def do_POST(self):                        # noqa: N802 (http.server API)
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length)
            mock.hits.append(self.path)
            if mock.redirect_to:                  # the gateway that hands the key away
                self.send_response(302)
                self.send_header("Location", mock.redirect_to)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if self.path != PATH:
                return self._send(404, {"error": {"message": f"no route {self.path}"}})
            try:
                body = json.loads(raw.decode("utf-8"))
            except ValueError:
                return self._send(400, {"error": {"message": "not json"}})
            mock.requests.append(body)
            mock.headers.append(dict(self.headers))
            status, payload = mock.answer(body)
            self._send(status, payload)

        def do_GET(self):                         # noqa: N802 (http.server API)
            # a followed 302 arrives as a GET: recorded so that "nothing reached
            # the other host" is an assertion and not an empty list by accident
            mock.hits.append(self.path)
            mock.headers.append(dict(self.headers))
            self._send(405, {"error": {"message": "this server only answers POST"}})

        def _send(self, status: int, payload: dict):
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Request-Id", "mock-request-1")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):             # keep pytest output readable
            pass

    return Handler


class DripServer:
    """Answers one byte per `interval`, forever: the attack on a per-socket
    timeout. Every byte resets the socket clock, so the measured case took 91
    seconds to deliver 92 bytes against a 2 second timeout. A client that
    deadlines the whole exchange gives up on time instead.
    """

    def __init__(self, interval: float = 0.02, declared: int = 4096,
                 hangup: bool = False):
        # hangup: read the request and close, which is the post-send failure
        # (RemoteDisconnected) that urllib does not wrap in a URLError
        self.interval, self.declared, self.hangup = interval, declared, hangup
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.port = self.listener.getsockname()[1]
        assert self.port not in FORBIDDEN_PORTS, f"drip bound a live port: {self.port}"
        self.listener.listen(4)
        self.connections: list[socket.socket] = []
        self.running = True
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop()
        return False

    def stop(self):
        self.running = False
        for connection in list(self.connections):
            try:
                connection.close()
            except OSError:
                pass
        self.listener.close()
        self.thread.join(timeout=10)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def policy(self, path: str, provider: str = "local", **extra) -> str:
        return write_policy(path, self.base_url, provider, **extra)

    def _serve(self):
        while self.running:
            try:
                connection, _ = self.listener.accept()
            except OSError:
                return
            self.connections.append(connection)
            threading.Thread(target=self._drip, args=(connection,), daemon=True).start()

    def _drip(self, connection: socket.socket):
        try:
            connection.settimeout(5.0)
            connection.recv(65536)            # the request, unread beyond this
            if self.hangup:
                return
            connection.sendall(b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n"
                               b"Content-Length: %d\r\n\r\n" % self.declared)
            while self.running:
                connection.sendall(b"x")      # never reaches Content-Length
                time.sleep(self.interval)
        except OSError:
            pass
        finally:
            try:
                connection.close()
            except OSError:
                pass
