"""U82 (SNAP-R39) on the CPU test server (default :8195, no gate): what a prompt makes is rated from its text and the files
it loads, highest wins, and a dial saved here is rated as what made it.
- a plain prompt is PG; one whose text holds a term is Adult and says which node and word; a term only in text that feeds
  a negative input doesn't count; under a cap below Adult such words are refused when queued (U90); a LoRA the person rates Mature makes the prompt Mature; an unrated LoRA adds nothing
  ungated (labels only) and counts as Adult under a gate's cap (as the gate counts it);
- the Dial editor's export (the real route) records the new dial in user/snap_ratings.json: PG from a PG parent, Adult
  when its description holds a term, and nothing when its parent is unrated (a picture dial: SNAP-R54); the rating then counts when a prompt loads it.
Queues only 64 px EmptyImage -> SaveImage prompts. Exports go to loras/dials/_editor_test/ (the editor test folder). The
person's snap/models.json written here and user/snap_ratings.json are moved to user/_parked/ afterwards (never deleted).
Prints one line, writes ui/test_u82_ratings_result.json.
usage: python3 -I test_u82_ratings.py [port] [base dir]"""
import os
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.PORT
BASEDIR = Path(sys.argv[2]) if len(sys.argv) > 2 else C.base()
BASE, USER = f"http://127.0.0.1:{PORT}", BASEDIR / "user"
MATURE, UNRATED, PARENT = "snaptest_u82_mature.safetensors", "snaptest_u82_unrated.safetensors", "dials/h3_day_night_hook.safetensors"
PICTURE_PARENT = "dials/h3_creature_lizard_squirrel_pics_hook.safetensors"
STAMP = time.strftime("%H%M%S")


def req(path, body=None):
    r = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=300) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def queue(text="a lighthouse at dusk", negative=None, lora=None, cap=None, words=False):
    nodes = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
             "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u82"}},
             "3": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": text}, "_meta": {"title": "Prompt"}}}
    if negative:  # text wired only into a negative input
        nodes["4"] = {"class_type": "PrimitiveStringMultiline", "inputs": {"value": negative}}
        nodes["5"] = {"class_type": "StringConcatenate", "inputs": {"string_a": ["3", 0], "string_b": "", "delimiter": "", "negative": ["4", 0]}}
    if lora:
        nodes["6"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": lora, "strength_model": 1.0}}
    extra = {"extra_pnginfo": {"workflow": {"nodes": [], "extra": {"snap_rate_words": True} if words else {}}}, **({"snap_user": "someone", "snap_max_rating": cap} if cap else {})}
    status, res = req("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": extra})
    if status != 200:
        return {"refused": res}
    for _ in range(240):
        h = req(f"/history/{res['prompt_id']}")[1].get(res["prompt_id"])
        if h and h.get("status", {}).get("completed") is not None:
            m = h["prompt"][3].get("snap_marks") or {}
            return {"rating": m.get("rating"), "why": m.get("rating_why")}
        time.sleep(0.25)
    raise TimeoutError(res["prompt_id"])


def export(name, description="", parent=PARENT):
    info = {"version": 2, "description": description, "negative": "day", "positive": "night", "neg": {"useful": None, "overcook": None},
            "pos": {"useful": None, "overcook": None}, "evidence": None, "pipeline": "", "notes": "U82 test export"}
    status, out = req("/mainodes/dials/editor/export", {"dial": parent, "edits": [], "name": f"_editor_test/{name}", "info": info})
    made = json.loads((USER / "snap_ratings.json").read_text()) if (USER / "snap_ratings.json").exists() else {}
    return {"status": status, "error": out.get("error"), "record": made.get(f"loras/dials/_editor_test/{name}.safetensors")}


for n in (MATURE, UNRATED):
    f = BASEDIR / "models" / "loras" / n
    f.write_bytes((2).to_bytes(8, "little") + b"{}")
own = USER / "default" / "snap" / "models.json"
saved = own.read_text() if own.exists() else None
own.parent.mkdir(parents=True, exist_ok=True)
own.write_text(json.dumps([{"file": MATURE, "rating": "mature"}, {"file": PARENT.split("/")[-1], "rating": "pg"}]))
R = {}
try:
    R["prompts"] = {"plain": queue(), "term": queue("a nude figure study on the beach", words=True), "camel": queue("TopLessBeach", words=True), "negativeOnly": queue(negative="nude, nsfw, bad hands", words=True),
                    "borderline": queue("a seductive smile", words=True), "wordsOff": queue("a nude figure study on the beach"), "adultCapOff": queue("a nude figure study", cap="adult"),
                    "matureCap": queue("a nude figure study", cap="mature"), "matureLora": queue(lora=MATURE), "unratedUngated": queue(lora=UNRATED), "unratedGated": queue(lora=UNRATED, cap="adult")}
    R["dials"] = {"pg": export(f"u82_pg_{STAMP}"), "adult": export(f"u82_adult_{STAMP}", "an explicit nsfw version")}
    own.write_text(json.dumps([{"file": MATURE, "rating": "mature"}]))
    # U88 (SNAP-R54): a text dial is rated from its own sentences, so the parent that stays unrated is one made from pictures
    R["dials"]["unratedParent"] = export(f"u82_unrated_parent_{STAMP}", parent=PICTURE_PARENT)
    R["prompts"]["madeDial"] = queue(lora=f"dials/_editor_test/u82_adult_{STAMP}.safetensors")
finally:
    parked = USER / "_parked" / f"u82-{STAMP}"
    parked.mkdir(parents=True, exist_ok=True)
    for p in (own, USER / "snap_ratings.json"):
        if p.exists():
            shutil.move(str(p), str(parked / p.name))
    if saved is not None:
        own.write_text(saved)

p, d = R["prompts"], R["dials"]
checks = {"plain prompt is PG": p["plain"]["rating"] == "pg",
          "a term makes it Adult, naming node and word": p["term"]["rating"] == "adult" and any("node 3" in w and "nude" in w for w in p["term"]["why"]),
          "camelCase words count": p["camel"]["rating"] == "adult",
          "a term only in negative text doesn't count": p["negativeOnly"]["rating"] == "pg",
          "borderline words never rate": p["borderline"]["rating"] == "pg",
          "words don't rate by default ungated (the operator: off for NSFW-rights accounts)": p["wordsOff"]["rating"] == "pg",
          "words don't rate under an Adult cap without the setting": p["adultCapOff"]["rating"] == "pg",
          # U90 (3): under a cap below Adult the words always count, so the prompt is refused when queued, saying why
          "words always rate under a Mature cap: refused at queue time": 'says "nude"' in (p["matureCap"].get("refused") or {}).get("error", {}).get("details", "") and "Mature cap" in p["matureCap"]["refused"]["error"]["details"],
          "a Mature LoRA makes it Mature": p["matureLora"]["rating"] == "mature",
          "an unrated LoRA adds nothing ungated": p["unratedUngated"]["rating"] == "pg",
          "an unrated LoRA counts as Adult under a cap": p["unratedGated"]["rating"] == "adult",
          "a dial exported from a PG parent is recorded PG": d["pg"]["status"] == 200 and (d["pg"]["record"] or {}).get("rating") == "pg",
          "a dial whose description holds a term is Adult": (d["adult"]["record"] or {}).get("rating") == "adult",
          "a dial from an unrated parent stays unrated": d["unratedParent"]["status"] == 200 and d["unratedParent"]["record"] is None,
          "a prompt loading the made Adult dial is Adult": p["madeDial"]["rating"] == "adult"}
R["checks"] = checks
C.out("ui", "test_u82_ratings_result.json").write_text(json.dumps(R, indent=1))
bad = [k for k, v in checks.items() if not v]
print(f"u82rate  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")
