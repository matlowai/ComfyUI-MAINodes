"""G1b items 1 and 2 (SNAP-R111, R112) through the pack's own nodes on a server (default :8194, the GPU test unit; DINOv3
ViT-H at 1024 px is slow on CPU): the fixtures of scout/id_copy_measures_2026-11-06.md (<fixtures>/id_copy/fixtures.json).
- identity: MAISnapIdentity with the encoder on each fixture picture, its face mask the fixture's head box (a rectangle,
  so the crop is the scout's 1.5x head crop); every probe against every Cast front, "probably a different person" when
  the character score is below the model graph's character_check.different. Wants 0 false alarms on the 21
  same-character pairs (ArcFace below 0.35 raised 7); the misses on the 105 other-character pairs are reported.
- copy: MAISnapCopyScore's soft score on the 18 pairs plus two controls of the master (a 6 % crop made brighter, and
  mirrored): copied at or above copy_check.soft_threshold. Wants 10/10 copies (8 + the controls) and 10/10 new views below it.
Prints "g1bidcopy n/m" last. usage: comfyui_venv/bin/python -I test_g1b_id_copy.py [port 8194]"""
import io
import json
import os
import sys
import time
import urllib.request
import uuid

from PIL import Image, ImageEnhance, ImageOps
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.GPU_PORT
BASE = f"http://127.0.0.1:{PORT}"
FIX = str(C.fixture("id_copy"))
GRAPH = str(C.PACK / "snap_cards" / "models.json")
t0 = time.time()


def upload(img, name):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\nsnaptest_g1b\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + buf.getvalue() + f"\r\n--{boundary}--\r\n".encode()
    r = urllib.request.Request(BASE + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    out = json.load(urllib.request.urlopen(r))
    return f"{out['subfolder']}/{out['name']}"


def run(prompt):
    r = urllib.request.Request(BASE + "/prompt", data=json.dumps({"prompt": prompt, "client_id": "snaptest-g1b"}).encode(), headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(r))["prompt_id"]
    while True:
        h = json.load(urllib.request.urlopen(f"{BASE}/history/{pid}")).get(pid)
        if h and (h["status"].get("completed") or h["status"].get("status_str") == "error"):
            break
        time.sleep(2)
    if h["status"].get("status_str") != "success":
        sys.exit(f"g1bidcopy 0/2 (the prompt didn't run: {json.dumps(h['status'])})")
    return h["outputs"]


graph = json.load(open(GRAPH))["files"]
enc = next(e for e in graph if e.get("character_check"))
face = next(e for e in graph if e.get("identity_check"))
DIFF, SOFT = enc["character_check"]["different"], enc["copy_check"]["soft_threshold"]
fx = json.load(open(os.path.join(FIX, "fixtures.json")))

# identity: one MAISnapIdentity per picture, its face mask the head box
ids = fx["identity"]
p = {"fm": {"class_type": "MAISnapFaceModelLoader", "inputs": {"model_name": face["file"]}}, "e": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": enc["file"]}}}
for i, x in enumerate(ids):
    im = Image.open(os.path.join(FIX, x["image"])).convert("RGB")
    mask = Image.new("L", im.size, 0)
    mask.paste(255, tuple(x["head_box"]))
    p[f"i{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(im, f"{x['id']}.png")}}
    p[f"m{i}"] = {"class_type": "LoadImageMask", "inputs": {"image": upload(mask.convert("RGB"), f"{x['id']}__head.png"), "channel": "red"}}
    p[f"x{i}"] = {"class_type": "MAISnapIdentity", "inputs": {"face_model": ["fm", 0], "image": [f"i{i}", 0], "faces": [f"m{i}", 0], "hair": [f"m{i}", 0], "encoder": ["e", 0]}}
o = run(p)
look = {x["id"]: {"char": o[f"x{i}"]["characters"][0][0], "face": o[f"x{i}"]["faces"][0][0]} for i, x in enumerate(ids)}
cos = lambda a, b: round(sum(u * v for u, v in zip(a, b)), 4)
anchors = {x["person"]: x["id"] for x in ids if x["kind"] == "anchor"}
pairs = [{"probe": x["id"], "anchor": person, "view": x["view"], "same": x["person"] == person, "character": cos(look[x["id"]]["char"], look[aid]["char"]), "arcface": cos(look[x["id"]]["face"], look[aid]["face"])}
         for x in ids if x["kind"] == "probe" for person, aid in anchors.items()]
same, other = [q for q in pairs if q["same"]], [q for q in pairs if not q["same"]]
false_alarms = [q for q in same if q["character"] < DIFF]
misses = [q for q in other if q["character"] >= DIFF]
arc_alarms = [q for q in same if q["arcface"] < 0.35]

# copy: the soft score of each pair, and the two controls against the master
cps = fx["copy"]
master = Image.open(os.path.join(FIX, "images/MASTER_village.png")).convert("RGB")
w, h = master.size
controls = {"control: master, 6% crop + brighter": ImageEnhance.Brightness(master.crop((int(w * .03), int(h * .03), int(w * .97), int(h * .97)))).enhance(1.25), "control: master mirrored": ImageOps.mirror(master)}
rows = [(c["id"], c["candidate"], c["reference"], c["copied"]) for c in cps] + [(k, k, "images/MASTER_village.png", True) for k in controls]
files = {}
for _, cand, ref, _ in rows:
    for f in (cand, ref):
        if f not in files:
            files[f] = upload(controls[f] if f in controls else Image.open(os.path.join(FIX, f)).convert("RGB"), f"copy_{len(files)}.png")
p = {"e": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": enc["file"]}}}
for k, f in enumerate(files):
    p[f"l{k}"] = {"class_type": "LoadImage", "inputs": {"image": files[f]}}
key = {f: f"l{k}" for k, f in enumerate(files)}
for j, (_, cand, ref, _) in enumerate(rows):
    p[f"q{j}"] = {"class_type": "MAISnapCopyScore", "inputs": {"clip_vision": ["e", 0], "reference": [key[ref], 0], "images": [key[cand], 0]}}
o = run(p)
copy = [{"id": i, "copied": c, "soft": o[f"q{j}"]["soft_scores"][0], "same_cell": o[f"q{j}"]["copy_scores"][0]} for j, (i, _, _, c) in enumerate(rows)]
hit = [r for r in copy if r["copied"] and r["soft"] >= SOFT]
clear = [r for r in copy if not r["copied"] and r["soft"] < SOFT]
n_copied, n_new = sum(r["copied"] for r in copy), sum(not r["copied"] for r in copy)

checks = [not false_alarms, len(same) == 21 and len(other) == 105, len(hit) == n_copied == 10, len(clear) == n_new == 10]
json.dump({"thresholds": {"character_different": DIFF, "soft_copy": SOFT}, "identity": {"false_alarms": false_alarms, "misses": len(misses), "arcface_alarms_at_0.35": len(arc_alarms), "pairs": pairs},
           "copy": copy, "seconds": round(time.time() - t0, 1)}, open(os.path.join(C.out(), "ui", "g1b", "test_g1b_id_copy_result.json"), "w"), indent=1)
print(f"identity: {len(false_alarms)}/{len(same)} false alarms below {DIFF} (ArcFace < 0.35: {len(arc_alarms)}/{len(same)}), {len(misses)}/{len(other)} other characters not flagged; "
      f"copy: {len(hit)}/{n_copied} copies at or above {SOFT}, {len(clear)}/{n_new} new views below; {time.time() - t0:.0f} s")
print(f"g1bidcopy {sum(checks)}/{len(checks)}")
