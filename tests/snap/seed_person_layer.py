"""Load a person layer seed (default: person_seed.json in the local fixtures) into a server's user data as
instruction records, by the person, with the note 'seeded from memory 2026-11-06' (U103 B7). A note already there with the same body makes
no new version. usage: python3 -I seed_person_layer.py --port 8290 [--seed <file>] [--user <comfy user>]"""
import argparse
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("--port", required=True)
p.add_argument("--seed", default=str(C.fixture("person_seed.json")))
p.add_argument("--user")
a = p.parse_args()
out = []
for n in json.load(open(a.seed, encoding="utf-8"))["notes"]:
    rid, body = n["id"], {k: v for k, v in n.items() if k != "id"}
    req = urllib.request.Request(f"http://127.0.0.1:{a.port}/mainodes/snap/world/save", method="POST", headers={"Content-Type": "application/json", **({"comfy-user": a.user} if a.user else {})},
                                 data=json.dumps({"kind": "instruction", "id": rid, "body": body, "by": "person", "note": "seeded from memory 2026-11-06"}).encode())
    r = json.load(urllib.request.urlopen(req))
    out.append({"ref": r["ref"], "made": r["made"]})
print(json.dumps({"seeded": out}, indent=1))
