"""tools/snap_dataset.py on a tiny fake user folder (review P2 L1 and the `by` split): the same pair judged blind and
then not keeps both judgments, a person's and an agent's ranking stay apart, and a rank that agrees with a judgment is
one row with both sources. U22 (SNAP-R20): private takes (flagged by the save gate, or found from the prompt and the
person's model graph for takes captured before the gate) and NSFW-tagged takes stay out of a default export, their pairs
too; --include-private / --include-nsfw bring them back. U71 (SNAP-R27): a LoRA whose safetensors header carries
`"privacy": "full"` inside a JSON-string field, or a trigger that matches a private pattern, is private whatever its name
and folder; a pattern also matches the folder part of the name (a symlinked folder); a header that says neither stays
public; a version (an edit) of a private take is private too. Review fixes (H2, M1, M3, L1, L2): a header trigger counts
only when it is one of the person's `triggers` in private.json (patterns don't match triggers); a LoRA inside a dict input
(rgthree rows) or a <lora:name:w> tag in text is checked; `"Privacy": "FULL"` in a .sft file counts; a rules file with the
wrong shape makes every take private instead of crashing the export; a header read that fails is not cached. U80
(SNAP-R37): all of that only on an install with privacy on (user/snap_privacy.json); with it off nothing is left out for
privacy, broken rules included. Prints one summary line; writes only under a temporary folder."""
import os
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

TOOL = str(C.PACK / "tools" / "snap_dataset.py")
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    snap = root / "comfy" / "user" / "default" / "snap"
    for d in ("takes", "rankings", "judgments"):
        (snap / d).mkdir(parents=True)
    for i in "ab":
        take = {"id": f"t{i}", "group": "g", "number": 1, "created": 1, "status": "done", "notes": [], "media": [{"type": "output", "subfolder": "", "filename": f"{i}.png"}]}
        (snap / "takes" / f"t{i}.json").write_text(json.dumps(take))
    (snap / "rankings" / "g.json").write_text(json.dumps({"group": "g", "order": ["ta", "tb"]}))
    (snap / "rankings" / "g.agent.json").write_text(json.dumps({"group": "g", "by": "agent", "order": ["tb", "ta"]}))
    (snap / "judgments" / "g.json").write_text(json.dumps([{"a": "ta", "b": "tb", "winner": "ta", "blind": True, "why": "sharper", "at": 1},
                                                           {"a": "ta", "b": "tb", "winner": "ta", "blind": False, "why": "still sharper", "at": 2}]))
    lora = lambda name: {"9": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": name, "strength_model": 1.0}}}
    hidden = {"tp": {"private": True}, "tq": {"prompt": lora("people/someone_identity.safetensors")}, "tn": {"prompt": lora("spicy_style.safetensors")},
              "tr": {"prompt": lora("linked.safetensors")}}  # a symlink in models/loras into a private path (snap/private.json)
    (root / "secret").mkdir()
    (root / "secret" / "x.safetensors").write_bytes(b"x")
    (root / "comfy" / "models" / "loras").mkdir(parents=True)
    (root / "comfy" / "models" / "loras" / "linked.safetensors").symlink_to(root / "secret" / "x.safetensors")
    # U71: stamped headers (tiny real safetensors), and a neutral folder reached through a symlink named like a pattern
    def safetensors(path, meta):
        head = json.dumps({"__metadata__": meta, "w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        path.write_bytes(struct.pack("<Q", len(head)) + head + bytes(4))
    loras = root / "comfy" / "models" / "loras"
    safetensors(loras / "neutral_v3.safetensors", {"name": "neutral", "lorastery_recipe": json.dumps({"task": "character_lora", "privacy": "full", "dataset": {"trigger": "nobody"}})})
    safetensors(loras / "relearn_b.safetensors", {"recipe": json.dumps({"dataset": {"trigger": "Qx9w"}})})
    safetensors(loras / "pattern_only.safetensors", {"recipe": json.dumps({"dataset": {"trigger": "zq7k"}})})  # a pattern is not a trigger
    safetensors(loras / "upper_case.sft", {"Privacy": "FULL"})
    safetensors(loras / "public_c.safetensors", {"recipe": json.dumps({"privacy": "none", "dataset": {"trigger": "somebody"}})})
    (root / "plain_dir").mkdir()
    (root / "plain_dir" / "a.safetensors").write_bytes(b"x")
    (loras / "zq7k_set").symlink_to(root / "plain_dir")
    hidden.update({"tv": {"parent": {"take": "tp", "method": "edit/night"}}, "ts": {"prompt": lora("neutral_v3.safetensors")}, "tt": {"prompt": lora("relearn_b.safetensors")}, "tg": {"prompt": lora("zq7k_set/a.safetensors")},
                   "td": {"prompt": {"9": {"class_type": "Power Lora Loader (rgthree)", "inputs": {"lora_1": {"on": True, "lora": "people/someone_identity.safetensors", "strength": 1}}}}},
                   "tl": {"prompt": {"9": {"class_type": "PrimitiveString", "inputs": {"value": "a portrait <lora:someone_identity:0.8>"}}}}, "tc": {"prompt": lora("upper_case.sft")}})
    (snap / "takes" / "tw.json").write_text(json.dumps({"id": "tw", "group": "u", "number": 2, "created": 3, "status": "done", "notes": [], "media": [], "prompt": lora("pattern_only.safetensors")}))
    (snap / "takes" / "tu.json").write_text(json.dumps({"id": "tu", "group": "u", "number": 1, "created": 3, "status": "done", "notes": [], "media": [], "prompt": lora("public_c.safetensors")}))
    (snap / "private.json").write_text(json.dumps({"paths": [str((root / "secret").resolve())], "patterns": ["*zq7k*"], "triggers": ["qx9w"]}))
    switch = root / "comfy" / "user" / "snap_privacy.json"
    switch.write_text(json.dumps({"on": True}))
    for i, extra in hidden.items():
        (snap / "takes" / f"{i}.json").write_text(json.dumps({"id": i, "group": "g", "number": 2, "created": 2, "status": "done", "notes": [], "media": [], **extra}))
    (snap / "models.json").write_text(json.dumps([{"file": "someone_identity.safetensors", "role": "identity"}, {"file": "spicy_style.safetensors", "role": "style", "tags": ["nsfw"]}]))
    (snap / "judgments" / "h.json").write_text(json.dumps([{"a": "ta", "b": "tp", "winner": "tp", "blind": True, "why": "private one", "at": 3}]))
    def export(*flags):
        out = root / "o" / ("-".join(flags) or "default")
        if subprocess.run([sys.executable, "-I", TOOL, "--comfy", str(root / "comfy"), "--out", str(out), *flags], capture_output=True).returncode:
            return None, ""
        return sorted(json.loads(line)["id"] for line in (out / "takes.jsonl").read_text().splitlines()), (out / "pairs.jsonl").read_text()
    ids = {flags: export(*flags)[0] for flags in [(), ("--include-private",), ("--include-nsfw",)]}
    privatePairs = export()[1].count('"tp"')
    # H2: a second user's rules file with the wrong shape: the export still runs and leaves every take out
    (root / "comfy" / "user" / "other" / "snap").mkdir(parents=True)
    (root / "comfy" / "user" / "other" / "snap" / "private.json").write_text(json.dumps({"paths": None}))
    brokenIds = export()[0]
    switch.write_text(json.dumps({"on": False}))  # U80: privacy off for this install, the broken rules file still there
    offIds = export()[0]
    switch.write_text(json.dumps({"on": True}))
    (root / "comfy" / "user" / "other" / "snap" / "private.json").write_text(json.dumps({"paths": []}))
    # L1: a header that can't be read now is not remembered as "not stamped"
    sys.path.insert(0, str(Path(TOOL).resolve().parents[1]))
    import snap_privacy
    locked = root / "locked.safetensors"
    safetensors(locked, {"privacy": "full"})
    locked.chmod(0)
    first = snap_privacy.stamp(str(locked))[0]
    locked.chmod(0o644)
    retried = snap_privacy.stamp(str(locked))[0]
    subprocess.run([sys.executable, "-I", TOOL, "--comfy", str(root / "comfy"), "--out", str(root / "out")], check=True, capture_output=True)
    pairs = [json.loads(line) for line in (root / "out" / "pairs.jsonl").read_text().splitlines()]
person = [p for p in pairs if p["by"] == "person"]
agent = [p for p in pairs if p["by"] == "agent"]
checks = [len(person) == 1 and person[0]["sources"] == ["rank", "ab", "ab"],
          [j["blind"] for j in person[0].get("judgments", [])] == [True, False] and [j["at"] for j in person[0]["judgments"]] == [1, 2],
          len(agent) == 1 and agent[0]["better"] == "tb" and agent[0]["sources"] == ["rank"],
          {"ta", "tb"} <= set(ids[()]) and not {"tp", "tq", "tr", "tn"} & set(ids[()]) and privatePairs == 0, {"tp", "tq", "tr"} <= set(ids[("--include-private",)]), "tn" in ids[("--include-nsfw",)],
          *[x not in ids[()] and x in ids[("--include-private",)] for x in ("ts", "tt", "tg", "tv")],  # U71: header stamp, trigger, folder part, a version of a private take
          *[x not in ids[()] and x in ids[("--include-private",)] for x in ("td", "tl", "tc")],  # review M1 (dict, lora tag), L2 (case, .sft)
          "tw" in ids[()],  # M3: triggers come only from private.json's triggers
          brokenIds == [],  # H2: wrong-shape rules mark everything, the export doesn't crash
          first is False and retried is True,  # L1
          "tu" in ids[()],
          {"tp", "tq", "tr", "ts", "tt", "tg", "tv", "td", "tl", "tc", "ta", "tb"} <= set(offIds or []) and "tn" not in offIds]  # U80: nothing left out for privacy, NSFW still
print(f"dataset  {sum(checks)}/{len(checks)} {'PASS' if all(checks) else 'FAIL ' + str([i for i, c in enumerate(checks) if not c])}")
