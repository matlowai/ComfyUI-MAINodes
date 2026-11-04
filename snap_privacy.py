"""Which prompts (and so which Snap takes) are private or NSFW, read from the model graph (SNAP-R12, SNAP-R20).

Shared by the server's save gate (snap_bridge.py) and the dataset export (tools/snap_dataset.py), so both decide the
same way. Plain Python, no ComfyUI imports: the export runs outside ComfyUI.

A prompt is private when it loads a file the model graph gives role `identity` or tags `private`, or when Snap's Cast
brick has a LoRA row on; it is NSFW when it loads a file the model graph tags `nsfw`. Reasons name nodes, never files.
"""
import json
from pathlib import Path

PACK = Path(__file__).parent / "snap_cards" / "models.json"


def base(name):
    return str(name).replace("\\", "/").split("/")[-1]


def model_graph(user_dir):
    """file name -> entry, the pack's entries under each ComfyUI user's own snap/models.json (the person wins field by
    field, a null keeps the pack's value), and the person's files that don't parse."""
    entries = {base(e["file"]): e for e in json.loads(PACK.read_text(encoding="utf-8"))}
    broken = []
    for f in sorted(Path(user_dir).glob("*/snap/models.json")):
        try:
            own = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            broken.append(str(f))
            continue
        for e in own:
            entries[base(e["file"])] = {**entries.get(base(e["file"]), {}), **{k: v for k, v in e.items() if v is not None}}
    return entries, broken


def marks(prompt, workflow, graph):
    """{"private": [reasons], "nsfw": [reasons]} for an API prompt and the workflow it came from. A model graph the
    person wrote but that doesn't parse can't say which LoRAs are private, so every prompt counts as private then."""
    entries, broken = graph
    private = [f"{f} doesn't parse, so no LoRA can be told apart" for f in broken]
    nsfw = []
    snap = ((workflow or {}).get("extra") or {}).get("snap") or {}
    cast = {str(n) for b in snap.get("bricks", []) if b.get("key") == "cast" for n in b.get("nodes", {}).values()}
    for nid, node in prompt.items():
        inputs = node.get("inputs") or {}
        for k, v in inputs.items():
            e = entries.get(base(v)) if isinstance(v, str) else None
            if not e:
                continue
            tags = e.get("tags") or []
            if e.get("role") == "identity" or "private" in tags:
                private.append(f"node {nid} loads {'an identity LoRA' if e.get('role') == 'identity' else 'a file tagged private'}")
            if "nsfw" in tags:
                nsfw.append(f"node {nid} loads a file tagged nsfw")
        if str(nid) in cast and any(k.endswith(".lora_name") and v not in (None, "", "None") and inputs.get(k[:-len("lora_name")] + "enabled") is True for k, v in inputs.items()):
            private.append(f"node {nid} has a Cast LoRA row on")
    return {"private": private, "nsfw": nsfw}
