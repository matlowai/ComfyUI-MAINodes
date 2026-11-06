"""G1 (U99 / F-C17): short03's village as the first real location record, from short03/settei_bg/VILLAGE_PLATES.md.
The pictures go into the server's input/snap/location/village/ (uploaded, or copied in --direct mode) and the record is
saved as location:location-village v1 (the same body Snap's saveLocation writes; the hash is the server's own digest).
The old Cast "Village (set)" stays as it is. Poses are read off the camera map (village_cameras.png, 1280x880, north up):
x, y fractions of that map, heading degrees clockwise from north, eye height 1.6 m, lens where the table names one.
usage: python3 -I import_village_location.py --port 8194          (a running server with G1 code: upload + world/save)
       python3 -I import_village_location.py --direct <base dir>  (files only, for a server that loads the code later)
"""
import os
import hashlib
import json
import shutil
import sys
import time
import urllib.request
import uuid
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

SETTEI = C.fixture("short03", "settei_bg")
RID, SUB = "location-village", "snap/location/village"
W, H = 1280, 880
xy = lambda x, y: {"x": round(x / W, 3), "y": round(y / H, 3)}
FILES = {"master": SETTEI / "plates" / "MASTER.png", "plan": SETTEI / "village_cameras.png"}
PLATES = [  # name, file, take, frame, pose, camera, use, note
    ("Pa road outside", "Pa_road_outside.png", "take-922daba6-80df-44d7-88c7-fbf0c4d3f2f5", None, {**xy(140, 690), "heading": 38, "eye_height": 1.6, "lens": 24}, "P01/C1",
     "arrival (C1, walk a)", "New view P-H3: the old road plate edited to the master's gatehouse"),
    ("Pab gate outside, close", "Pab_gate_outside_close.png", "take-cb4d6a53-a420-4090-a47c-5601f73b6f52", 60, {**xy(300, 460), "heading": 90, "eye_height": 1.6}, None,
     "close arrival", "walkthrough B (Ref2V: P01 + master + map), the gate opening; on the road ~10 m before the gate"),
    ("Parch through the gate", "Parch_through_gate.png", "take-cb4d6a53-a420-4090-a47c-5601f73b6f52", 100, {**xy(355, 410), "heading": 90, "eye_height": 1.6}, None,
     "entering", "walkthrough B, inside the arch"),
    ("Pb gate inside, open", "Pb_gate_inside_open.png", "take-6ef925dd-c18c-4758-8a57-1a7e05a51d9f", None, {**xy(820, 460), "heading": 280, "eye_height": 1.6, "lens": 28}, "C2/C4",
     "C2/C4/C6, walk b", "New view P-H3: the C6 board with Maren removed; in the square ~15 m east of the gate, looking west"),
    ("Pc square + well", "Pc_square_well.png", "take-cb4d6a53-a420-4090-a47c-5601f73b6f52", 123, {**xy(420, 420), "heading": 90, "eye_height": 1.6}, None,
     "walk c, C5-ish wides", "walkthrough B's end, just inside the gate"),
    ("Pd houses", "Pd_houses.png", "take-5a8e93c2-0fd0-47b6-bd31-ecb4fbff223d", 95, {**xy(690, 380), "heading": 90, "eye_height": 1.6}, None,
     "walk d, C5", "walkthrough D (Ref2V from Pc + master + map), by the well looking east toward the east row"),
]
CAMERAS = [
    {"name": "P01/C1", **xy(140, 690), "heading": 38, "eye_height": 1.6, "lens": 24, "note": "on the road SW of the gate, looking NE at the gatehouse"},
    {"name": "C2/C4", **xy(820, 460), "heading": 280, "eye_height": 1.6, "lens": 35, "note": "in the square, looking west at the gate's inside face (C4 at 28 mm)"},
    {"name": "C6", **xy(880, 450), "heading": 280, "eye_height": 1.6, "lens": 28, "note": "the gate opened for her, then slammed"},
    {"name": "C5", **xy(720, 690), "heading": 55, "eye_height": 1.6, "lens": 35, "note": "south of the square, looking NE at the east row"},
]
NOTES = ("A small walled village at dusk in snow: one square two-storey timber gatehouse tower with a steep snowy hipped roof, one small "
         "square window and an arched double wooden gate, in the WEST palisade of sharpened logs (the palisade rings the village); the road "
         "comes from the SW; inside, a snowy square with a round stone well north-east of the gate and rows of dark timber houses with "
         "shutters north and east. Known drift between plates: the well's distance from the gate (Pb: beside the gate; Pc/Pd: mid-square) "
         "and the house style (New view boards: one-storey dark timber; walkthrough: two-storey with lit windows, closer to the master).")


def body():
    pic = lambda name, src=None: {"file": f"{SUB}/{name}", **({"from": src} if src else {})}
    return {"name": "Village · The Gate Price", "notes": NOTES,
            "master": pic("MASTER.png", {"take": "take-481c673c-9a20-4bfe-b9ce-15df3c8a639b", "frame": 0}), "plan": pic("village_cameras.png"),
            "cameras": CAMERAS,
            "plates": [{"name": n, **pic(f, {"take": t, "frame": fr if fr is not None else 0}), "pose": pose, **({"camera": c} if c else {}), "use": use, "note": note}
                       for n, f, t, fr, pose, c, use, note in PLATES],
            "rating": None}


def sources():
    yield FILES["master"], "MASTER.png"
    yield FILES["plan"], "village_cameras.png"
    for _, f, *_ in PLATES:
        yield SETTEI / "plates" / f, f


def upload(base, path, name):
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode(), path.read_bytes(), b"\r\n"]
    for k, v in (("subfolder", SUB), ("overwrite", "true")):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(f"{base}/upload/image", data=b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def post(base, route, q):
    req = urllib.request.Request(f"{base}{route}", data=json.dumps(q).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))


if sys.argv[1] == "--port":
    base = f"http://127.0.0.1:{sys.argv[2]}"
    for path, name in sources():
        upload(base, path, name)
    out = post(base, "/mainodes/snap/world/save", {"kind": "location", "id": RID, "body": body(), "note": "short03's village, from VILLAGE_PLATES.md (G1 import)", "by": "agent"})
    print(json.dumps({"ref": out["ref"], "made": out["made"], "plates": len(body()["plates"])}))
elif sys.argv[1] == "--direct":
    root = Path(sys.argv[2])
    dest = root / "input" / SUB
    dest.mkdir(parents=True, exist_ok=True)
    for path, name in sources():
        if not (dest / name).exists():
            shutil.copy2(path, dest / name)
    rec_path = root / "user" / "default" / "snap" / "location" / f"{RID}.json"
    if rec_path.exists():
        sys.exit(f"{rec_path} exists already: nothing written")
    b = body()
    digest = hashlib.sha256(json.dumps(b, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()  # snap_world.digest
    now = int(time.time() * 1000)
    rec = {"id": RID, "kind": "location", "created": now, "by": "agent", "head": 1, "archived": None, "updated": now,
           "versions": [{"n": 1, "hash": digest, "at": now, "by": "agent", "note": "short03's village, from VILLAGE_PLATES.md (G1 import)", "body": b}]}
    rec_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = rec_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, ensure_ascii=False))
    tmp.replace(rec_path)
    print(json.dumps({"ref": f"location:{RID}@1", "written": str(rec_path), "files": sorted(p.name for p in dest.iterdir())}))
