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
All of this is off unless the install turns it on (SNAP-R37): with no user/snap_privacy.json {"on": true}, nothing is
private, from any source, and only the NSFW tags count.
On a snap-gate install, only the admins' snap/ files count (SNAP-R32), and a file's rating level backs up the gate's cap
(SNAP-R33).
Ratings come from how a thing was made (SNAP-R39): a prompt is rated from its text (the terms list) and the files it
loads, highest wins; a file made here (a dial) is rated when it is saved, in user/snap_ratings.json, a file the server
writes outside every user's folder; the pack's model graph rates what the kits download; a dial file nobody rated (a
released one) is rated from the sentences and parents its own metadata records (SNAP-R54).
SNAP-R12 identity LoRAs are private · SNAP-R20 private takes marked · SNAP-R27 a file stamped private · SNAP-R32 the
admins' files decide on a gated install · SNAP-R33 the rating cap's second line · SNAP-R37 privacy is per install, off
by default · SNAP-R39 ratings from how a thing was made · SNAP-R54 dials rated from their own sentences · see docs/SNAP_RULES.md
"""
import json
import os
import re
import struct
import threading
import time
from fnmatch import fnmatch
from pathlib import Path

PACK = Path(__file__).parent / "snap_cards" / "models.json"
TERMS = Path(__file__).parent / "snap_cards" / "nsfw_terms.json"
MADE = "snap_ratings.json"  # user/snap_ratings.json: "<folder>/<name>" -> {"rating", "why", "at"} for files made here (SNAP-R39)
made_lock = threading.Lock()
MODEL_FILE = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin")
STAMPED = (".safetensors", ".sft")  # formats whose header is plain JSON
HEADER_CAP = 16 << 20  # a LoRA's header is ~65 KB; a header past this is skipped, never read whole
TRIGGER_KEYS = ("trigger", "trigger_word", "trigger_phrase", "triggers")
LORA_TAG = re.compile(r"<lora:([^:>]+)")  # A1111 / LoRA Manager text: <lora:name:weight>
LEVELS = {"pg": 0, "general": 0, "mature": 1, "sensitive": 1, "questionable": 1, "adult": 2, "explicit": 2}  # shown as PG / Mature / Adult
NAMES = ["pg", "mature", "adult"]  # level -> the name ratings are saved as
# SNAP-R33 mirrors the gate's SNAP-R44: files here don't decide what a picture shows, so an unrated one counts as PG
HELPER_FOLDERS = {"vae", "vae_approx", "text_encoders", "clip", "clip_vision", "upscale_models", "latent_upscale_models", "configs", "custom_nodes",
                  "audio_encoders", "background_removal", "detection", "frame_interpolation", "geometry_estimation", "optical_flow", "classifiers",
                  "face_recognition", "controlnet", "gligen"}
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


def switched_on(user_dir, broken=None):
    """Whether this install marks anything private (SNAP-R37): user/snap_privacy.json says {"on": true}. It sits outside
    every user's folder, so no page can write it; with no such file privacy is off. One that doesn't parse was put there
    to turn privacy on, so it counts as on and as broken (every take private until it is fixed)."""
    f = Path(user_dir) / "snap_privacy.json"
    if not f.exists():
        return False
    data = read(f, [] if broken is None else broken, dict)
    return data is None or data.get("on") is True


def owners(user_dir, broken):
    """Whose snap/ files count: every ComfyUI user's (None), or, when snap-gate wrote user/snap_admins.json
    ({"admins": [ComfyUI user ids]}), only the admins' (SNAP-R32). That file sits outside every user's folder, so no page
    can write it. One that doesn't parse counts as broken and names no one."""
    f = Path(user_dir) / "snap_admins.json"
    if not f.exists():
        return None
    ids = (read(f, broken, dict) or {}).get("admins", [])
    if not (isinstance(ids, list) and all(isinstance(x, str) for x in ids)):
        broken.append(str(f))
        return set()
    return set(ids)


def model_graph(user_dir):
    """What decides privacy: file name -> entry (the pack's entries under each counted ComfyUI user's own
    snap/models.json, the person winning field by field, a null keeping the pack's value), their private paths, patterns
    and triggers, and the files that don't parse or have the wrong shape (a rules file that can't be read whole counts as
    broken, never as fewer rules; a model graph entry with no file name is skipped)."""
    terms = json.loads(TERMS.read_text(encoding="utf-8"))
    graph = {"entries": {base(e["file"]): e for e in json.loads(PACK.read_text(encoding="utf-8"))["files"]}, "paths": [], "patterns": [], "triggers": [], "broken": [],
             "parts": list(terms["parts"]), "words": list(terms["words"]), "made": made(user_dir)}
    graph["private"] = switched_on(user_dir, graph["broken"])
    who = owners(user_dir, graph["broken"])
    counted = lambda name: sorted(f for f in Path(user_dir).glob(f"*/snap/{name}") if who is None or f.parent.parent.name in who)
    for f in counted("models.json"):
        for e in read(f, graph["broken"], list) or []:
            if isinstance(e, dict) and isinstance(e.get("file"), str):
                graph["entries"][base(e["file"])] = {**graph["entries"].get(base(e["file"]), {}), **{k: v for k, v in e.items() if v is not None}}
    for f in counted("nsfw_terms.json"):
        own = read(f, graph["broken"], dict) or {}
        graph["parts"] += [t.lower() for t in own.get("parts", []) if isinstance(t, str)]
        graph["words"] += [t.lower() for t in own.get("words", []) if isinstance(t, str)]
    for f in counted("private.json") if graph["private"] else []:
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


def header(real):
    """A safetensors file's JSON header (tensor names, shapes and `__metadata__`), read alone and capped; {} for a header
    past the cap, None when it can't be read."""
    try:
        with open(real, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            found = json.loads(f.read(n)) if n <= HEADER_CAP else {}
    except (OSError, ValueError, RecursionError, struct.error):
        return None
    return found if isinstance(found, dict) else {}


def metadata(real):
    """A safetensors file's header metadata (`__metadata__`, string values); {} when there is none, None when the header
    can't be read."""
    found = header(real)
    meta = found.get("__metadata__") if found is not None else None
    return meta if isinstance(meta, dict) else None if found is None else {}


def strings(o):
    """Every string in a parsed JSON value."""
    if isinstance(o, str):
        return [o]
    if isinstance(o, dict):
        o = list(o.values())
    return [t for x in o for t in strings(x)] if isinstance(o, list) else []


def dial_rating(graph, meta, parent_level):
    """(level, why) of a dial file nobody rated, from how it was made (SNAP-R54), or None when that can't be told: its
    own sentences (the pairs, the hold groups and its info, in the file's metadata) through the terms list, raised to its
    parents' ratings (a Combine or an edit names them; `parent_level(name)` rates one, None when nobody can). A dial made
    from pictures or videos inherits from them, and a file doesn't record which, so it stays unrated (the gate's admin
    rates it), and so does one with no sentences and no parents."""
    def loads(v):
        try:
            return json.loads(v) if isinstance(v, str) else v
        except ValueError:
            return v
    if meta.get("source") in ("pictures", "videos"):
        return None
    texts = [t for t in strings([loads(meta.get(k)) for k in ("pairs", "hold_groups", "dial_info")]) if t.strip()]
    parents = [p for p in (loads(meta.get("parents")) or []) if isinstance(p, str)]
    if not texts and not parents:
        return None
    lvl, term = text_level("\n".join(texts), graph)
    found = [parent_level(p) for p in parents]
    if None in found:
        return None
    why = ([f'its sentences say "{term}"'] if term else ["rated from its own sentences"] if texts else []) + [f"made from {p}, rated {NAMES[r]}" for p, r in zip(parents, found)]
    return max([lvl, *found]), why


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
    meta = metadata(real)
    if meta is None:
        return False, ()
    full, triggers = False, []
    todo = [(meta, 0)]
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
    counts as private then. With privacy off for this install (SNAP-R37) nothing is private, whatever the files say."""
    on = graph["private"]
    private = [f"privacy rules unreadable: {f} doesn't parse or has the wrong shape, so nothing can be told apart" for f in graph["broken"]] if on else []
    nsfw = []
    snap = ((workflow or {}).get("extra") or {}).get("snap") or {}
    cast = {str(n) for b in snap.get("bricks", []) if b.get("key") == "cast" for n in b.get("nodes", {}).values()}
    for nid, node in prompt.items():
        inputs = node.get("inputs") or {}
        for v in dict.fromkeys(n for x in inputs.values() for n in names(x)):
            reason = on and why(v, resolve(v), graph)
            if reason:
                private.append(f"node {nid} loads {reason}")
            if "nsfw" in (graph["entries"].get(base(v), {}).get("tags") or []):
                nsfw.append(f"node {nid} loads a file tagged nsfw")
        if on and str(nid) in cast and any(k.endswith(".lora_name") and v not in (None, "", "None") and inputs.get(k[:-len("lora_name")] + "enabled") is True for k, v in inputs.items()):
            private.append(f"node {nid} has a Cast LoRA row on")
    return {"private": private, "nsfw": nsfw}


def rated(graph, value, folders):
    """A file's rating level from what rates it, or None when nothing does: its `rating` in the model graph (the pack's
    entries, which rate every kit file, under the person's or the admins' own), else Adult when tagged nsfw, else the
    rating it was made with here (user/snap_ratings.json, by folder and name). `folders` are the model folders that hold it."""
    e = graph["entries"].get(base(value), {})
    if str(e.get("rating")).lower() in LEVELS:
        return LEVELS[str(e["rating"]).lower()]
    if "nsfw" in (e.get("tags") or []):
        return LEVELS["adult"]
    found = [LEVELS[r] for f in folders if (r := str((graph["made"].get(f"{f}/{value}".replace("\\", "/")) or {}).get("rating")).lower()) in LEVELS]
    return max(found) if found else None


def level(graph, value, folders):
    """A file's rating level: what rates it, else what the gate gives a file nobody rated, one dropped in by hand
    (SNAP-R44): PG in helper folders only, Adult anywhere else."""
    r = rated(graph, value, folders)
    if r is not None:
        return r
    return LEVELS["pg"] if set(folders) <= HELPER_FOLDERS else LEVELS["adult"]


def words(text):
    """Lowercase whole words of a text, camelCase split ("NudeLoRA" -> nude, lora)."""
    return set(re.findall(r"[a-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", text).lower()))


def text_level(text, graph):
    """(level, the term) for a text: Adult when it holds one of the terms (parts anywhere, words as whole words), else PG.
    Borderline words never rate anything (they are the person's call)."""
    low = text.lower()
    hit = next((p for p in graph["parts"] if p in low), None) or next((w for w in graph["words"] if w in words(text)), None)
    return (LEVELS["adult"], hit) if hit else (LEVELS["pg"], None)


def said(prompt, graph, folders_of):
    """(node id, input, term) for every text input whose words rate it Adult (SNAP-R39): a string input that names no model
    file; text that only feeds a negative input doesn't count."""
    negative = {str(v[0]) for n in prompt.values() for k, v in (n.get("inputs") or {}).items() if "negative" in k.lower() and isinstance(v, list) and len(v) == 2}
    feeds = {str(v[0]) for n in prompt.values() for k, v in (n.get("inputs") or {}).items() if "negative" not in k.lower() and isinstance(v, list) and len(v) == 2}
    out = []
    for nid, node in prompt.items():
        if str(nid) in negative and str(nid) not in feeds:
            continue
        for k, v in (node.get("inputs") or {}).items():
            if "negative" in k.lower() or not isinstance(v, str) or (v in names(v) and folders_of(v)):
                continue
            lvl, term = text_level(v, graph)
            if lvl:
                out.append((nid, k, term))
    return out


def rating(prompt, graph, folders_of, gated, words):
    """(level, reasons) of what an API prompt makes (SNAP-R39): the highest of the files it loads and, with `words`, its
    text (said). A file nothing rates counts only on a gated install (`gated`), as the gate counts it; ungated, ratings
    are labels and it adds nothing."""
    top, why = LEVELS["pg"], []
    for nid, node in prompt.items():
        for v in (node.get("inputs") or {}).values():
            for n in dict.fromkeys(names(v)):
                folders = folders_of(n)
                lvl = folders and rated(graph, n, folders)
                lvl = level(graph, n, folders) if folders and lvl is None and gated else lvl
                if lvl:
                    why.append(f"node {nid} loads a file rated {NAMES[lvl]}")
                    top = max(top, lvl)
    for nid, k, term in said(prompt, graph, folders_of) if words else []:
        why.append(f"node {nid}'s {k} says \"{term}\"")
        top = LEVELS["adult"]
    return top, list(dict.fromkeys(why))


def made(user_dir):
    """The ratings files made here were saved with (SNAP-R39), from user/snap_ratings.json; one that doesn't parse rates nothing."""
    try:
        data = json.loads((Path(user_dir) / MADE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def record(user_dir, folder, name, lvl, why):
    """Rate a file made here as what made it (a dial from its sentences and its parents): user/snap_ratings.json, a
    file the server writes outside every user's folder, so no page can lower a rating there. The person's or the admin's
    own rating still wins (SNAP-R35)."""
    with made_lock:
        data = made(user_dir)
        data[f"{folder}/{name}".replace("\\", "/")] = {"rating": NAMES[lvl], "why": why, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        f = Path(user_dir) / MADE
        f.with_suffix(".tmp").write_text(json.dumps(data, indent=1), encoding="utf-8")
        os.replace(f.with_suffix(".tmp"), f)


def above(prompt, graph, cap, folders_of):
    """The nodes of an API prompt that load a file rated above `cap` (a level), node id -> node title or type.
    `folders_of(value)` gives the model folders that hold a name (none for text)."""
    out = {}
    for nid, node in prompt.items():
        for v in dict.fromkeys(n for x in (node.get("inputs") or {}).values() for n in names(x)):
            folders = folders_of(v)
            if folders and level(graph, v, folders) > cap:
                out[nid] = (node.get("_meta") or {}).get("title") or node.get("class_type")
    return out
