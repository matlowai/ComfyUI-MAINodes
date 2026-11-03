"""Snap tools for CLI agents: a stdio MCP server that forwards to a local ComfyUI's /mainodes/snap bridge.

The open Snap page owns the graph; this server lists the tools the page registered and relays calls to it, so an
agent edits the same graph a person sees (each edit is one undo step, shown live). Standard library only; talks to
127.0.0.1 only. Example Claude Code config entry (not installed by the pack):

    {"mcpServers": {"comfy-snap": {"command": "python", "args": ["custom_nodes/ComfyUI-MAINodes/tools/snap_mcp.py", "--port", "8188"]}}}
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

PROTOCOL = "2025-06-18"


def http(base, path, body=None):
    request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        return json.load(e)
    except urllib.error.URLError as e:
        return {"error": f"ComfyUI is not reachable at {base} ({e.reason})."}


def handle(base, message):
    method, params = message.get("method"), message.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": {"name": "comfy-snap", "version": "0.1"}}
    if method == "tools/list":
        listing = http(base, "/mainodes/snap/tools")
        return {"tools": [{k: t[k] for k in ("name", "description", "inputSchema", "annotations") if k in t} for t in listing.get("tools", [])]}
    if method == "tools/call":
        answer = http(base, "/mainodes/snap/call", {"tool": params.get("name"), "args": params.get("arguments") or {}})
        failed = "error" in answer
        text = answer["error"] if failed else json.dumps(answer.get("result"), indent=1)
        return {"content": [{"type": "text", "text": text}], "isError": failed}
    if method == "ping":
        return {}
    raise LookupError(method)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8188)
    base = f"http://127.0.0.1:{parser.parse_args().port}"
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        if "id" not in message:  # notifications (initialized, cancelled) need no answer
            continue
        try:
            reply = {"jsonrpc": "2.0", "id": message["id"], "result": handle(base, message)}
        except LookupError as e:
            reply = {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": f"Method not found: {e}"}}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
