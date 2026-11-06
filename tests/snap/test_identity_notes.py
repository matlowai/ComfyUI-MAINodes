"""U61 identity notes on the CPU server (default :8195): MAISnapFaceModelLoader + MAISnapIdentity on U56b's frames and its
SAM 3.1 face / hair masks (gpubase input/u56b_*, output/u56b/), with the real ArcFace weights. Checks:
  the port's hair L* p90 matches U56b's metrics2.json (OpenCV) within 0.5 on every frame;
  the notes Snap's page makes from these numbers (checks.js identityCheck: the character score (DINOv3 CLS on the head
  crop, G1b) below the encoder's character_check.different, the edit's hair over the originals' median above
  hair_check.lighter) on the U53b/U54 cases:
  silver edit (U53b seed A akhaliq) -> hair lighter; another woman (seed A vs seed B) -> different person; a later frame
  of the same take -> no flag; U54's kept night anchor c1 -> hair not lighter and never flagged as a relight
  (identity_check.unreliable_for); U54's blonder c2 -> hair not lighter (U56b's known miss, recorded).
Writes fixtures/u61/looks.json (each picture's embedding and hair) for test_candidates.js. Prints one line."""
import json
import os
import statistics
import sys
import time
import urllib.request
import uuid
import glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.PORT
BASE = f"http://127.0.0.1:{PORT}"
GRAPH = str(C.PACK / "snap_cards" / "models.json")


def upload(path, name):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\nsnaptest_u61\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + open(path, "rb").read() + f"\r\n--{boundary}--\r\n".encode()
    r = urllib.request.Request(BASE + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    out = json.load(urllib.request.urlopen(r))
    return f"{out['subfolder']}/{out['name']}"


graph = json.load(open(GRAPH))["files"]
face_entry = next(e for e in graph if e.get("identity_check"))
hair_entry = next(e for e in graph if e.get("hair_check"))
enc_entry = next(e for e in graph if e.get("character_check"))
DIFF, LIGHTER, UNRELIABLE = enc_entry["character_check"]["different"], hair_entry["hair_check"]["lighter"], face_entry["identity_check"]["unreliable_for"]

NAMES = ["U19_day_f0", "U19_day_f30", "U19_day_f53", "U19_day_f90", "U54_c1_f0", "U54_c1_f53", "U54_c2_f0", "U54_c2_f53",
         "seedA_day_f0", "seedA_day_f24", "seedA_day_f48", "seedA_edit_akh", "seedB_day_f0", "seedB_day_f48"]
mask = lambda n, w: sorted(glob.glob(str(C.fixture("gpubase", "output", "u56b", f"{n}__{w}_*.png"))))[0]
prompt = {"fm": {"class_type": "MAISnapFaceModelLoader", "inputs": {"model_name": face_entry["file"]}}, "ce": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": enc_entry["file"]}}}
for i, n in enumerate(NAMES):
    prompt[f"i{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(C.fixture("gpubase", "input", f"u56b_{n}.png"), f"{n}.png")}}
    for w in ("face", "hair"):
        prompt[f"{w}{i}"] = {"class_type": "LoadImageMask", "inputs": {"image": upload(mask(n, w), f"{n}__{w}.png"), "channel": "red"}}
    prompt[f"x{i}"] = {"class_type": "MAISnapIdentity", "inputs": {"face_model": ["fm", 0], "image": [f"i{i}", 0], "faces": [f"face{i}", 0], "hair": [f"hair{i}", 0], "encoder": ["ce", 0]}}
r = urllib.request.Request(BASE + "/prompt", data=json.dumps({"prompt": prompt, "client_id": "snaptest-u61"}).encode(), headers={"Content-Type": "application/json"})
pid, t0 = json.load(urllib.request.urlopen(r))["prompt_id"], time.time()
while True:
    h = json.load(urllib.request.urlopen(f"{BASE}/history/{pid}")).get(pid)
    if h and h["status"].get("completed") or h and h["status"].get("status_str") == "error" or time.time() - t0 > 600:
        break
    time.sleep(2)
if not h or h["status"].get("status_str") != "success":
    sys.exit(f"identity notes: FAIL, the prompt didn't run: {json.dumps(h['status'] if h else 'timeout')[:800]}")
looks = {n: {"face": h["outputs"][f"x{i}"]["faces"][0][0], "character": h["outputs"][f"x{i}"]["characters"][0][0], "hair": h["outputs"][f"x{i}"]["hair_l90"][0]} for i, n in enumerate(NAMES)}  # one face mask each: faces[0][0]
heads = all(len(h["outputs"][f"x{i}"].get("images", [])) == 1 for i in range(len(NAMES)))  # SNAP-R76: each face's head crop
json.dump(looks, open(C.out("u61", "looks.json"), "w"))

U56B = json.load(open(C.fixture("u56b", "metrics2.json")))
hair_diff = max(abs(looks[n]["hair"] - U56B[n]["Lh90"]) for n in NAMES)
cos = lambda a, b, k="character": sum(x * y for x, y in zip(looks[a][k], looks[b][k]))


def notes(pairs, baseline, does=None):  # what checks.js identityCheck concludes from the same numbers
    lit = sorted([looks[a]["hair"] for a, _ in pairs] + [looks[b]["hair"] for b in baseline])
    base = statistics.median(lit)
    chars, faces = [cos(a, b) for a, b in pairs], [cos(a, b, "face") for a, b in pairs]
    up = max(looks[b]["hair"] - base for _, b in pairs)
    return {"character_low": round(min(chars), 3), "face_low": round(min(faces), 3), "hair_up": round(up, 1), "different": does not in UNRELIABLE and min(chars) < DIFF, "lighter": up > LIGHTER}


cases = {
    "silver edit (U53b A akhaliq)": (notes([("seedA_day_f0", "seedA_edit_akh")], ["seedA_day_f24", "seedA_day_f48"]), {"lighter": True}),
    "another woman (seed A vs B)": (notes([("seedA_day_f0", "seedB_day_f0"), ("seedA_day_f48", "seedB_day_f48")], ["seedA_day_f24"]), {"different": True}),
    "same take, later frame": (notes([("U19_day_f0", "U19_day_f53")], ["U19_day_f30", "U19_day_f90"]), {"different": False, "lighter": False}),
    "U54 kept c1": (notes([("U19_day_f0", "U54_c1_f0"), ("U19_day_f53", "U54_c1_f53")], ["U19_day_f30", "U19_day_f90"]), {"lighter": False}),
    "U54 kept c1 as a relight": (notes([("U19_day_f0", "U54_c1_f0"), ("U19_day_f53", "U54_c1_f53")], ["U19_day_f30", "U19_day_f90"], "relight"), {"lighter": False, "different": False}),
    "silver edit as a relight": (notes([("seedA_day_f0", "seedA_edit_akh")], ["seedA_day_f24", "seedA_day_f48"], "relight"), {"lighter": True, "different": False}),
    "U54 blonder c2 (known miss)": (notes([("U19_day_f0", "U54_c2_f0"), ("U19_day_f53", "U54_c2_f53")], ["U19_day_f30", "U19_day_f90"]), {"lighter": False}),
}
bad = [k for k, (got, want) in cases.items() if any(got[x] != v for x, v in want.items())]
ok = hair_diff < 0.5 and not bad and heads and all(len(looks[n]["face"] or []) == 512 and len(looks[n]["character"] or []) == 1280 for n in NAMES)
json.dump({"hair_max_diff_vs_u56b": round(hair_diff, 3), "cases": {k: v[0] for k, v in cases.items()}, "seconds": round(time.time() - t0, 1), "thresholds": [DIFF, LIGHTER]},
          open(C.out("ui", "test_identity_notes_result.json"), "w"), indent=1)
print(f"identity notes: {'PASS' if ok else 'FAIL'} (hair L90 vs U56b max {hair_diff:.2f} L*, {len(cases) - len(bad)}/{len(cases)} cases"
      f"{'; wrong: ' + ', '.join(bad) if bad else ''}; " + "; ".join(f"{k}: character {v[0]['character_low']} face {v[0]['face_low']} hair {v[0]['hair_up']:+}" for k, v in cases.items()) + f"; {time.time() - t0:.0f} s CPU)")
