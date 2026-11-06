"""U77 (2) and (3), the pack's side of snap-gate, against the CPU test server (default :8195, no gate in front).
(2) SNAP-R32: once user/snap_admins.json names the admins (snap-gate writes it), only their snap/models.json and
    private.json decide ratings and marks: a non-admin's file that tags a LoRA private or rates a file PG changes nothing;
    the admin's does. With no admins file every user's file counts, as before.
(3) SNAP-R33: a prompt carrying the gate's extra_data.snap_max_rating has every node that loads a file above that cap
    swapped for MAIRatingRefused (refused before anything runs, the message names the node and the cap); unrated LoRAs
    count as Adult, unrated VAEs as PG, a file the admin rates PG runs under a PG cap, an nsfw tag counts as Adult.
    With no snap_max_rating nothing changes. A saver with no filename_prefix (SaveLoRA) is noted in the server log.
Simulates the gate by writing the extra_data itself. Writes dummy safetensors into the test server's models/, the test
users' snap/ files, and user/snap_admins.json; afterwards the admins file and the test users' folders are moved to
user/_parked/ (never deleted), so later suites see a single-user server again. Prints one line, writes ui/test_u77_cap_result.json.
usage: python3 -I test_u77_cap.py [port] [base dir]"""
import json
import os
import shutil
import subprocess
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
UNRATED, RATED, NSFW, KIDPG, VAE = (f"snaptest_u77_{n}.safetensors" for n in ("unrated", "rated_pg", "nsfw", "kid_says_pg", "vae"))
ADMIN, KID = "snaptest_u77_admin", "snaptest_u77_kid"


def req(path, body=None):
    r = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def queue(lora, cap=None, folder="loras"):
    loader = {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": lora, "strength_model": 1.0}} if folder == "loras" else {"class_type": "VAELoader", "inputs": {"vae_name": lora}}
    nodes = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
             "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u77"}}, "3": {**loader, "_meta": {"title": "Style LoRA"}}}
    extra = {"extra_pnginfo": {"workflow": {"nodes": [], "extra": {"snap": {"version": 1, "bricks": [], "bindings": []}}}}}
    if cap:
        extra.update(snap_user="kid", snap_max_rating=cap)
    status, res = req("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": extra})
    if status != 200:
        return {"refused": [f"{e['message']}: {e.get('details')}" for n in res.get("node_errors", {}).values() for e in n["errors"]] or [res.get("error", {}).get("message")]}
    for _ in range(240):
        h = req(f"/history/{res['prompt_id']}")[1].get(res["prompt_id"])
        if h and h.get("status", {}).get("completed") is not None:
            return {"ran": h["status"]["status_str"], "marks": h["prompt"][3].get("snap_marks")}
        time.sleep(0.25)
    raise TimeoutError(res["prompt_id"])


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


R = {}
for folder, name in [("loras", UNRATED), ("loras", RATED), ("loras", NSFW), ("loras", KIDPG), ("vae", VAE)]:
    f = BASEDIR / "models" / folder / name
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes((2).to_bytes(8, "little") + b"{}")
write(USER / ADMIN / "snap" / "models.json", [{"file": RATED, "rating": "pg"}, {"file": NSFW, "rating": None, "tags": ["nsfw"]}, {"file": UNRATED, "tags": ["private"]}])
write(USER / KID / "snap" / "models.json", [{"file": KIDPG, "rating": "pg"}, {"file": RATED, "tags": ["private"]}])

# no admins file: every user's file counts (the kid's PG rating too), and no cap means nothing is refused
R["single"] = {"kidPg": queue(KIDPG, "pg"), "rated": queue(RATED)}
write(USER / "snap_admins.json", {"admins": [ADMIN]})
try:
    R["capped"] = {"unrated": queue(UNRATED, "pg"), "ratedPg": queue(RATED, "pg"), "nsfwMature": queue(NSFW, "mature"), "kidPg": queue(KIDPG, "pg"),
                   "vaePg": queue(VAE, "pg", "vae"), "adultCap": queue(NSFW, "adult"), "noCap": queue(UNRATED)}
    R["marks"] = {"adminPrivate": queue(UNRATED), "kidPrivate": queue(RATED)}
    t0 = time.time()
    req("/prompt", {"prompt": {"1": {"class_type": "SaveLoRA", "inputs": {"lora": ["9", 0], "prefix": "loras/u77"}}}, "client_id": uuid.uuid4().hex,
                    "extra_data": {"snap_user": "kid", "snap_max_rating": "adult"}})
    time.sleep(1)
    log = subprocess.run(["journalctl", "--user", "-u", C.UNIT, "--since", f"@{int(t0) - 1}", "--no-pager", "-o", "cat"], capture_output=True, text=True).stdout
    R["saverNote"] = [l for l in log.splitlines() if "without a filename_prefix" in l]
finally:
    parked = USER / "_parked" / f"u77-{time.strftime('%H%M%S')}"
    parked.mkdir(parents=True, exist_ok=True)
    for p in (USER / "snap_admins.json", USER / ADMIN, USER / KID):
        shutil.move(str(p), str(parked / p.name))

c, m = R.get("capped", {}), R.get("marks", {})
checks = [R["single"]["kidPg"].get("ran") in ("success", None) and "refused" not in R["single"]["kidPg"], "refused" not in R["single"]["rated"] and (R["single"]["rated"]["marks"] or {}).get("private") is True,
          any("Node 3 (Style LoRA)" in x and "PG cap" in x for x in c["unrated"].get("refused", [])), c["ratedPg"].get("ran") == "success",
          any("Mature cap" in x for x in c["nsfwMature"].get("refused", [])), "refused" in c["kidPg"], c["vaePg"].get("ran") is not None and "refused" not in c["vaePg"],
          c["adultCap"].get("ran") == "success", c["noCap"].get("ran") == "success",
          (m["adminPrivate"].get("marks") or {}).get("private") is True, not (m["kidPrivate"].get("marks") or {}).get("private"),
          any("SaveLoRA" in l and "kid" in l for l in R["saverNote"])]
R["checks"] = checks
C.out("ui", "test_u77_cap_result.json").write_text(json.dumps(R, indent=1))
print(f"u77cap   {sum(checks)}/{len(checks)} {'PASS' if all(checks) else 'FAIL ' + str([i for i, x in enumerate(checks) if not x])}")
