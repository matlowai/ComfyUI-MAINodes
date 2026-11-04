"""Which prompts (and so which Snap takes) are private or NSFW (SNAP-R12, SNAP-R20).

Shared by the server's save gate (snap_bridge.py) and the dataset export (tools/snap_dataset.py), so both decide the
same way. Plain Python, no ComfyUI imports: the export runs outside ComfyUI; each caller says how a value resolves to
files on disk.

A prompt is private when any node loads a file that the model graph gives role `identity` or tags `private`, whose
real path (symlinks followed) lies under one of the person's private paths, or whose name or real path matches one of
their private patterns; or when Snap's Cast brick has a LoRA row on. It is NSFW when it loads a file tagged `nsfw`.
The private paths and patterns live only in the person's own user/<name>/snap/private.json
({"paths": [globs], "patterns": [globs]}), never in the pack, and the page never reads them. Reasons name nodes, never
files.
"""
import json
from fnmatch import fnmatch
from pathlib import Path

PACK = Path(__file__).parent / "snap_cards" / "models.json"
MODEL_FILE = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin")


def base(name):
    return str(name).replace("\\", "/").split("/")[-1]


def read(f, broken):
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except ValueError:
        broken.append(str(f))
        return None


def model_graph(user_dir):
    """What decides privacy: file name -> entry (the pack's entries under each ComfyUI user's own snap/models.json, the
    person winning field by field, a null keeping the pack's value), every user's private paths and patterns, and the
    person's files that don't parse."""
    graph = {"entries": {base(e["file"]): e for e in json.loads(PACK.read_text(encoding="utf-8"))}, "paths": [], "patterns": [], "broken": []}
    for f in sorted(Path(user_dir).glob("*/snap/models.json")):
        for e in read(f, graph["broken"]) or []:
            graph["entries"][base(e["file"])] = {**graph["entries"].get(base(e["file"]), {}), **{k: v for k, v in e.items() if v is not None}}
    for f in sorted(Path(user_dir).glob("*/snap/private.json")):
        rules = read(f, graph["broken"]) or {}
        graph["paths"] += [p.rstrip("/") for p in rules.get("paths", [])]
        graph["patterns"] += [p.lower() for p in rules.get("patterns", [])]
    return graph


def why(value, reals, graph):
    """Why loading this value makes a prompt private, or None."""
    e = graph["entries"].get(base(value))
    if e and e.get("role") == "identity":
        return "an identity LoRA"
    if e and "private" in (e.get("tags") or []):
        return "a file tagged private"
    if any(fnmatch(r, p) or fnmatch(r, p + "/*") for r in reals for p in graph["paths"]):
        return "a file under a private path"
    if (reals or value.lower().endswith(MODEL_FILE)) and any(fnmatch(n.lower(), p) for n in [base(value), *reals, *map(base, reals)] for p in graph["patterns"]):
        return "a file matching a private pattern"
    return None


def marks(prompt, workflow, graph, resolve):
    """{"private": [reasons], "nsfw": [reasons]} for an API prompt and the workflow it came from. `resolve(value)` gives
    the real paths a string input loads (none for text). Any node counts, whatever loader it is. A model graph or
    private.json the person wrote that doesn't parse can't say what is private, so every prompt counts as private then."""
    private = [f"{f} doesn't parse, so nothing can be told apart" for f in graph["broken"]]
    nsfw = []
    snap = ((workflow or {}).get("extra") or {}).get("snap") or {}
    cast = {str(n) for b in snap.get("bricks", []) if b.get("key") == "cast" for n in b.get("nodes", {}).values()}
    for nid, node in prompt.items():
        inputs = node.get("inputs") or {}
        for v in inputs.values():
            if not isinstance(v, str) or "\n" in v or len(v) > 400:
                continue
            reason = why(v, resolve(v), graph)
            if reason:
                private.append(f"node {nid} loads {reason}")
            if "nsfw" in (graph["entries"].get(base(v), {}).get("tags") or []):
                nsfw.append(f"node {nid} loads a file tagged nsfw")
        if str(nid) in cast and any(k.endswith(".lora_name") and v not in (None, "", "None") and inputs.get(k[:-len("lora_name")] + "enabled") is True for k, v in inputs.items()):
            private.append(f"node {nid} has a Cast LoRA row on")
    return {"private": private, "nsfw": nsfw}
