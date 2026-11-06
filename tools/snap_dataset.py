"""Export Snap takes as training rows for a judge model (a VLM that ranks takes and says where they go wrong).

Reads what the Snap page keeps in ComfyUI's user folder (user/<name>/snap/takes, rankings, judgments) and writes three
JSONL files; nothing leaves the machine:
  takes.jsonl  one row per take: media paths, prompt, seed, status, verdict, rank in its workflow, prior, notes
  notes.jsonl  one row per note: the take's media, moment (s), region [x, y, w, h] as fractions, wrong/right, tags, words
  pairs.jsonl  preferences: better/worse take ids with their media and who said so (by person|agent), one row per pair
               and author with every source that agrees: a ranking ("rank"), keep over reject in the same workflow
               ("verdict"), and A/B picks ("ab"; each judgment kept in `judgments` with blind, the reason and when)

On an install with privacy on (SNAP-R37), private takes (an identity LoRA, a Cast row, a file the model graph tags private, a file under the person's private
paths or matching their patterns in snap/private.json, a safetensors file stamped private in its header, SNAP-R27) and
NSFW-tagged takes are left out (a version of a private take too),
with every note and pair they are in, unless --include-private / --include-nsfw ask for them (SNAP-R20). A take counts
as private when the save gate marked it or when its prompt and the model graph say so now. A take kept encrypted (U79,
SNAP-R96) can't be read here, without its owner's key: it is counted under left_out.kept_encrypted, never copied.

  python tools/snap_dataset.py --comfy /path/to/ComfyUI --out /path/to/dataset_dir
"""
import argparse
import json
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # the pack folder, for snap_privacy (no ComfyUI imports)
import snap_privacy  # noqa: E402


def read(path, missing):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else missing


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--comfy", type=Path, required=True, help="the ComfyUI folder (or the --base-directory it runs with)")
    ap.add_argument("--user", default="default", help="ComfyUI user name (user/<name>)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--settings", action="store_true", help="include each take's full executed prompt (large)")
    ap.add_argument("--include-private", action="store_true", help="include private takes (identity LoRAs, Cast rows, files tagged private)")
    ap.add_argument("--include-nsfw", action="store_true", help="include takes that load a file the model graph tags nsfw")
    args = ap.parse_args()

    snap = args.comfy / "user" / args.user / "snap"
    roots = {"output": args.comfy / "output", "input": args.comfy / "input", "temp": args.comfy / "temp"}
    graph = snap_privacy.model_graph(args.comfy / "user")
    models = [d for d in (args.comfy / "models").glob("*") if d.is_dir()]

    def loaded(value):  # what the server would load: the base folder's models/<folder>/<value> or an absolute path
        found = [Path(value)] if Path(value).is_absolute() else [d / value for d in models]
        return [str(f.resolve()) for f in found if f.is_file()]
    records = sorted((snap / "takes").glob("*.json"))
    sealed = [f for f in records if f.read_bytes()[:8] == b"SNAPVLT1"]  # snap_vault.MAGIC; reading one needs the owner's key, in ComfyUI
    every = {t["id"]: t for t in (read(f, None) for f in records if f not in sealed) if t}
    found = {i: snap_privacy.marks(t.get("prompt") or {}, t.get("graph"), graph, loaded) for i, t in every.items()}

    def private(t, seen=()):  # a version of a private take (an edit, a continued take), or one made from its frame, is private too (SNAP-R27, U76 M2)
        came = [every.get(i) for i in [(t.get("parent") or {}).get("take"), *t.get("made_from", [])] if i not in seen]
        return graph["private"] and bool(t.get("private") or found[t["id"]]["private"] or any(c and private(c, (*seen, t["id"])) for c in came))  # SNAP-R37
    takes, left_out = {}, {"private": 0, "nsfw": 0, "kept_encrypted": len(sealed)}
    for t in every.values():
        if private(t) and not args.include_private:
            left_out["private"] += 1
        elif (t.get("nsfw") or found[t["id"]]["nsfw"]) and not args.include_nsfw:
            left_out["nsfw"] += 1
        else:
            takes[t["id"]] = t
    # one ranking per group and author: <group>.json is the person's, <group>.agent.json an agent's (SNAP-R17)
    ranks = {(r["group"], r.get("by", "person")): r["order"] for r in (read(f, None) for f in (snap / "rankings").glob("*.json")) if r}
    judged = [row for f in sorted((snap / "judgments").glob("*.json")) for row in read(f, [])]

    def files(t):
        return [str(roots.get(m["type"], roots["output"]) / m["subfolder"] / m["filename"]) for m in t["media"]]

    args.out.mkdir(parents=True, exist_ok=True)
    counts = {"takes": 0, "notes": 0, "pairs": 0}
    with open(args.out / "takes.jsonl", "w", encoding="utf-8") as ft, open(args.out / "notes.jsonl", "w", encoding="utf-8") as fn:
        for t in takes.values():
            order = [i for i in ranks.get((t["group"], "person"), []) if i in takes]
            row = {"id": t["id"], "group": t["group"], "workflow": t.get("workflow"), "number": t["number"], "created": t["created"],
                   "status": t["status"], "error": t.get("error"), "seed": t.get("seed"), "prompt": t.get("text", ""), "media": files(t),
                   "verdict": t.get("verdict"), "prior": t.get("prior", False), "rank": order.index(t["id"]) + 1 if t["id"] in order else None,
                   "ranked_in_group": len(order), "notes": t["notes"]}
            if args.settings:
                row["settings"] = t.get("prompt")
            ft.write(json.dumps(row) + "\n")
            counts["takes"] += 1
            for n in t["notes"]:
                fn.write(json.dumps({"take": t["id"], "media": files(t), "prompt": t.get("text", ""), **n}) + "\n")
                counts["notes"] += 1

    def pair(better, worse, **extra):
        return {"better": better, "worse": worse, "better_media": files(takes[better]), "worse_media": files(takes[worse]),
                "prompt": takes[better].get("text", ""), **extra}

    with open(args.out / "pairs.jsonl", "w", encoding="utf-8") as fp:
        rows = {}  # (better, worse, by) -> one row; a rank and a judgment that agree are one pair with both sources

        def add(better, worse, source, by="person", judgment=None, **extra):
            row = rows.setdefault((better, worse, by), pair(better, worse, by=by, sources=[]))
            row["sources"].append(source)
            row.update(extra)
            if judgment:  # the same pair judged twice (blind, then not) keeps both
                row.setdefault("judgments", []).append(judgment)
        for (group, by), order in ranks.items():
            order = [i for i in order if i in takes]
            for a, b in combinations(order, 2):
                add(a, b, "rank", by, group=group, margin=order.index(b) - order.index(a))
        by_group = {}
        for t in takes.values():
            by_group.setdefault(t["group"], []).append(t)
        for group, ts in by_group.items():
            for k in ts:
                for r in ts:
                    if k.get("verdict") == "keep" and r.get("verdict") == "reject":
                        add(k["id"], r["id"], "verdict", group=group)
        for j in judged:
            if j["winner"] == "tie" or j["a"] not in takes or j["b"] not in takes:
                continue
            loser = j["b"] if j["winner"] == j["a"] else j["a"]
            add(j["winner"], loser, "ab", j.get("by", "person"), judgment={"blind": j["blind"], "why": j["why"], "at": j["at"]})
        for r in rows.values():
            fp.write(json.dumps(r) + "\n")
        counts["pairs"] = len(rows)

    print(json.dumps({**counts, "left_out": left_out, "out": str(args.out), **({"kept_encrypted": f"{len(sealed)} takes are kept encrypted: export them from a signed-in Snap page (export_records with decrypt_private)"} if sealed else {})}))


if __name__ == "__main__":
    main()
