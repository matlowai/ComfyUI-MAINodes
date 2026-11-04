"""Which prompts (and so which Snap takes) are private or NSFW (SNAP-R12, SNAP-R20).

Shared by the server's save gate (snap_bridge.py) and the dataset export (tools/snap_dataset.py), so both decide the
same way. Plain Python, no ComfyUI imports: the export runs outside ComfyUI; each caller says how a value resolves to
files on disk.

A prompt is private when any node loads a file that the model graph gives role `identity` or tags `private`, whose
real path (symlinks followed) lies under one of the person's private paths, whose name (folders included) or real path
matches one of their private patterns, or whose safetensors header is stamped private or names one of their private
triggers (SNAP-R27); or when Snap's Cast brick has a LoRA row on. It is NSFW when it loads a file tagged `nsfw`.
Every input counts: plain names, names inside dict values (rgthree's Power Lora Loader rows) and `<lora:name:w>` tags
in text.
The private paths, patterns and triggers live only in the person's own user/<name>/snap/private.json
({"paths": [globs], "patterns": [globs], "triggers": [words]}), never in the pack, and the page never reads them.
Reasons name nodes, never files.
SNAP-R12 identity LoRAs are private · SNAP-R20 private takes marked · SNAP-R27 a file stamped private · see docs/SNAP_RULES.md
"""
import json
import os
import re
import struct
from fnmatch import fnmatch
from pathlib import Path

PACK = Path(__file__).parent / "snap_cards" / "models.json"
MODEL_FILE = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin")
STAMPED = (".safetensors", ".sft")  # formats whose header is plain JSON
HEADER_CAP = 16 << 20  # a LoRA's header is ~65 KB; a header past this is skipped, never read whole
TRIGGER_KEYS = ("trigger", "trigger_word", "trigger_phrase", "triggers")
LORA_TAG = re.compile(r"<lora:([^:>]+)")  # A1111 / LoRA Manager text: <lora:name:weight>
stamps = {}  # realpath -> ((mtime_ns, size), (stamped full, triggers)); one small entry per file a prompt loaded


def base(name):
    return str(name).replace("\\", "/").split("/")[-1]


def read(f, broken, shape):
    """A person's JSON file, or None (listed as broken) when it doesn't parse or isn't a `shape`."""
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = None
    if not isinstance(data, shape):
        broken.append(str(f))
        return None
    return data


def model_graph(user_dir):
    """What decides privacy: file name -> entry (the pack's entries under each ComfyUI user's own snap/models.json, the
    person winning field by field, a null keeping the pack's value), every user's private paths, patterns and triggers,
    and the person's files that don't parse or have the wrong shape (a rules file that can't be read whole counts as
    broken, never as fewer rules; a model graph entry with no file name is skipped)."""
    graph = {"entries": {base(e["file"]): e for e in json.loads(PACK.read_text(encoding="utf-8"))["files"]}, "paths": [], "patterns": [], "triggers": [], "broken": []}
    for f in sorted(Path(user_dir).glob("*/snap/models.json")):
        for e in read(f, graph["broken"], list) or []:
            if isinstance(e, dict) and isinstance(e.get("file"), str):
                graph["entries"][base(e["file"])] = {**graph["entries"].get(base(e["file"]), {}), **{k: v for k, v in e.items() if v is not None}}
    for f in sorted(Path(user_dir).glob("*/snap/private.json")):
        rules = read(f, graph["broken"], dict)
        if rules is None:
            continue
        lists = {k: rules.get(k, []) for k in ("paths", "patterns", "triggers")}  # present but not a list of strings: broken
        if not all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in lists.values()):
            graph["broken"].append(str(f))
            continue
        graph["paths"] += [p.rstrip("/") for p in lists["paths"]]
        graph["patterns"] += [p.lower() for p in lists["patterns"]]
        graph["triggers"] += [t.lower() for t in lists["triggers"]]
    return graph


def stamp(real):
    """(privacy == "full", trigger words) from a safetensors header's metadata, header only. Trainers write them inside
    JSON-string fields (`lorastery_recipe` holds {"privacy": "full", "dataset": {"trigger": "<word>"}}), so a string that
    holds JSON is parsed too, a few levels deep. A read that fails is not stamped and not cached (SNAP-R27)."""
    try:
        st = os.stat(real)
    except OSError:
        return False, ()
    key = (st.st_mtime_ns, st.st_size)
    if real in stamps and stamps[real][0] == key:
        return stamps[real][1]
    try:
        with open(real, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            header = json.loads(f.read(n)) if n <= HEADER_CAP else {}
    except (OSError, ValueError, RecursionError, struct.error):
        return False, ()
    full, triggers = False, []
    todo = [(header.get("__metadata__"), 0)] if isinstance(header, dict) else []
    while todo:
        o, depth = todo.pop()
        if isinstance(o, str) and o.lstrip()[:1] in ("{", "[") and depth < 4:
            try:
                o = json.loads(o)
            except (ValueError, RecursionError):
                continue
        for k, v in o.items() if isinstance(o, dict) else enumerate(o) if isinstance(o, list) else ():
            name = str(k).lower().rsplit(".", 1)[-1]
            if name == "privacy" and isinstance(v, str) and v.strip().lower() == "full":
                full = True
            elif name in TRIGGER_KEYS:
                triggers += [w for t in (v if isinstance(v, list) else [v]) if isinstance(t, str) for w in [t.strip().lower(), *re.split(r"[\s,]+", t.strip().lower())] if w]
            else:
                todo.append((v, depth + 1))
    stamps[real] = (key, (full, tuple(dict.fromkeys(triggers))))
    return stamps[real][1]


def why(value, reals, graph):
    """Why loading this value makes a prompt private, or None."""
    e = graph["entries"].get(base(value))
    if e and e.get("role") == "identity":
        return "an identity LoRA"
    if e and "private" in (e.get("tags") or []):
        return "a file tagged private"
    if any(fnmatch(r, p) or fnmatch(r, p + "/*") for r in reals for p in graph["paths"]):
        return "a file under a private path"
    if (reals or value.lower().endswith(MODEL_FILE)) and any(fnmatch(n.lower(), p) for n in [value.replace("\\", "/"), base(value), *reals, *map(base, reals)] for p in graph["patterns"]):
        return "a file matching a private pattern"
    for full, triggers in (stamp(r) for r in reals if r.lower().endswith(STAMPED)):
        if full or any(fnmatch(t, g) for t in triggers for g in graph["triggers"]):
            return "a file stamped private"
    return None


def names(v):
    """The names an input value can load: a plain string, every string inside a dict or list (rgthree's
    {"on": true, "lora": "x.safetensors"} rows), and each <lora:name:w> tag in text (with .safetensors added)."""
    if isinstance(v, dict):
        return [n for x in v.values() for n in names(x)]
    if isinstance(v, list):
        return [n for x in v for n in names(x)]
    if not isinstance(v, str):
        return []
    tags = [n for t in LORA_TAG.findall(v) for n in (t.strip(), t.strip() + ".safetensors")]
    return tags + ([v] if "\n" not in v and len(v) <= 400 else [])


def marks(prompt, workflow, graph, resolve):
    """{"private": [reasons], "nsfw": [reasons]} for an API prompt and the workflow it came from. `resolve(value)` gives
    the real paths a string input loads (none for text). Any node counts, whatever loader it is. A model graph or
    private.json the person wrote that doesn't parse (or has the wrong shape) can't say what is private, so every prompt
    counts as private then."""
    private = [f"privacy rules unreadable: {f} doesn't parse or has the wrong shape, so nothing can be told apart" for f in graph["broken"]]
    nsfw = []
    snap = ((workflow or {}).get("extra") or {}).get("snap") or {}
    cast = {str(n) for b in snap.get("bricks", []) if b.get("key") == "cast" for n in b.get("nodes", {}).values()}
    for nid, node in prompt.items():
        inputs = node.get("inputs") or {}
        for v in dict.fromkeys(n for x in inputs.values() for n in names(x)):
            reason = why(v, resolve(v), graph)
            if reason:
                private.append(f"node {nid} loads {reason}")
            if "nsfw" in (graph["entries"].get(base(v), {}).get("tags") or []):
                nsfw.append(f"node {nid} loads a file tagged nsfw")
        if str(nid) in cast and any(k.endswith(".lora_name") and v not in (None, "", "None") and inputs.get(k[:-len("lora_name")] + "enabled") is True for k, v in inputs.items()):
            private.append(f"node {nid} has a Cast LoRA row on")
    return {"private": private, "nsfw": nsfw}
