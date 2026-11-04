"""Snap tools for CLI agents: a stdio MCP server that forwards to a local ComfyUI's /mainodes/snap bridge.

The open Snap page owns the graph; this server lists the tools the page registered and relays calls to it, so an
agent edits the same graph a person sees (each edit is one undo step, shown live). Standard library only; talks to
127.0.0.1 only. Example Claude Code config entry (not installed by the pack):

    {"mcpServers": {"comfy-snap": {"command": "python", "args": ["custom_nodes/ComfyUI-MAINodes/tools/snap_mcp.py", "--port", "8188"]}}}
"""
import argparse
import json
import mimetypes
import secrets
import sys
import urllib.error
import urllib.request

PROTOCOL = "2025-06-18"

# answered here, not by the page: it reads a file on this machine, which the page can't
UPLOAD = {"name": "upload_file", "description": "Upload a local picture, video or audio file into ComfyUI's input folder and return its name; then set_widget points a loader at it (e.g. the First frame's image).",
          "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "description": "absolute path of the file"}, "subfolder": {"type": "string"}}, "required": ["path"]}}


def upload(base, path, subfolder=""):
    with open(path, "rb") as f:
        data = f.read()
    boundary = secrets.token_hex(16)
    name = path.rsplit("/", 1)[-1]
    parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: {mimetypes.guess_type(name)[0] or 'application/octet-stream'}\r\n\r\n".encode(), data,
             f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\n{subfolder}\r\n--{boundary}--\r\n".encode()]
    request = urllib.request.Request(base + "/upload/image", data=b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        r = json.load(response)
    return {"name": f"{r['subfolder']}/{r['name']}" if r.get("subfolder") else r["name"]}


def http(base, path, body=None):
    request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:  # the bridge answers JSON; anything else (a plain 404, a 500 page) is passed on as text
        text = e.read().decode(errors="replace")
        try:
            return json.loads(text)
        except ValueError:
            return {"error": f"ComfyUI answered {e.code}: {text[:200]}"}
    except (urllib.error.URLError, TimeoutError) as e:
        return {"error": f"ComfyUI is not reachable at {base} ({getattr(e, 'reason', e)})."}


def handle(base, message):
    method, params = message.get("method"), message.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": {"name": "comfy-snap", "version": "0.1"}}
    if method == "tools/list":
        listing = http(base, "/mainodes/snap/tools")
        return {"tools": [{k: t[k] for k in ("name", "description", "inputSchema", "annotations") if k in t} for t in listing.get("tools", [])] + [UPLOAD]}
    if method == "tools/call" and params.get("name") == "upload_file":
        args = params.get("arguments") or {}
        try:
            return {"content": [{"type": "text", "text": json.dumps(upload(base, args["path"], args.get("subfolder", "")))}], "isError": False}
        except (OSError, KeyError, urllib.error.URLError) as e:
            return {"content": [{"type": "text", "text": f"upload failed: {e}"}], "isError": True}
    if method == "tools/call":
        answer = http(base, "/mainodes/snap/call", {"tool": params.get("name"), "args": params.get("arguments") or {}})
        failed = "error" in answer
        text = answer["error"] if failed else json.dumps(answer.get("result"), indent=1)
        return {"content": [{"type": "text", "text": text}], "isError": failed}
    if method == "ping":
        return {}
    raise LookupError(method)


def reply(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8188)
    base = f"http://127.0.0.1:{parser.parse_args().port}"
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except ValueError:
            reply({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        if "id" not in message:  # notifications (initialized, cancelled) need no answer
            continue
        try:
            reply({"jsonrpc": "2.0", "id": message["id"], "result": handle(base, message)})
        except LookupError as e:
            reply({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": f"Method not found: {e}"}})
        except Exception as e:  # one bad request must not end the session
            reply({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32603, "message": f"{type(e).__name__}: {e}"}})


if __name__ == "__main__":
    main()
