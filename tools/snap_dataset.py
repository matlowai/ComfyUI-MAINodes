"""Export Snap takes as training rows for a judge model (a VLM that ranks takes and says where they go wrong).

Reads what the Snap page keeps in ComfyUI's user folder (user/<name>/snap/takes, rankings, judgments) and writes three
JSONL files; nothing leaves the machine:
  takes.jsonl  one row per take: media paths, prompt, seed, status, verdict, rank in its workflow, prior, notes
  notes.jsonl  one row per note: the take's media, moment (s), region [x, y, w, h] as fractions, wrong/right, tags, words
  pairs.jsonl  preferences: better/worse take ids with their media, from the person's ranking (source "rank"), keep over
               reject in the same workflow ("verdict"), and A/B picks ("ab", with blind and the reason)

  python tools/snap_dataset.py --comfy /path/to/ComfyUI --out /path/to/dataset_dir
"""
import argparse
import json
from itertools import combinations
from pathlib import Path


def read(path, missing):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else missing


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--comfy", type=Path, required=True, help="the ComfyUI folder (or the --base-directory it runs with)")
    ap.add_argument("--user", default="default", help="ComfyUI user name (user/<name>)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--settings", action="store_true", help="include each take's full executed prompt (large)")
    args = ap.parse_args()

    snap = args.comfy / "user" / args.user / "snap"
    roots = {"output": args.comfy / "output", "input": args.comfy / "input", "temp": args.comfy / "temp"}
    takes = {t["id"]: t for t in (read(f, None) for f in sorted((snap / "takes").glob("*.json"))) if t}
    ranks = {r["group"]: r["order"] for r in (read(f, None) for f in (snap / "rankings").glob("*.json")) if r}
    judged = [row for f in sorted((snap / "judgments").glob("*.json")) for row in read(f, [])]

    def files(t):
        return [str(roots.get(m["type"], roots["output"]) / m["subfolder"] / m["filename"]) for m in t["media"]]

    args.out.mkdir(parents=True, exist_ok=True)
    counts = {"takes": 0, "notes": 0, "pairs": 0}
    with open(args.out / "takes.jsonl", "w", encoding="utf-8") as ft, open(args.out / "notes.jsonl", "w", encoding="utf-8") as fn:
        for t in takes.values():
            order = [i for i in ranks.get(t["group"], []) if i in takes]
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
        rows = []
        for group, order in ranks.items():
            order = [i for i in order if i in takes]
            rows += [pair(a, b, source="rank", group=group, margin=order.index(b) - order.index(a)) for a, b in combinations(order, 2)]
        by_group = {}
        for t in takes.values():
            by_group.setdefault(t["group"], []).append(t)
        for group, ts in by_group.items():
            rows += [pair(k["id"], r["id"], source="verdict", group=group) for k in ts if k.get("verdict") == "keep" for r in ts if r.get("verdict") == "reject"]
        for j in judged:
            if j["winner"] == "tie" or j["a"] not in takes or j["b"] not in takes:
                continue
            loser = j["b"] if j["winner"] == j["a"] else j["a"]
            rows.append(pair(j["winner"], loser, source="ab", blind=j["blind"], why=j["why"], at=j["at"], by=j.get("by", "person")))
        for r in rows:
            fp.write(json.dumps(r) + "\n")
        counts["pairs"] = len(rows)

    print(json.dumps({**counts, "out": str(args.out)}))


if __name__ == "__main__":
    main()
