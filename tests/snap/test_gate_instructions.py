"""U103 B6 (SNAP-R93/R95) on a CPU test server without the gate: the install layer. A user/snap_admins.json naming an
admin (as snap-gate writes it) and that admin's own instruction records stand in for a gated install; the caller is the
server's default user, a member.
- an admin's note with shared: true is in /mainodes/snap/pack_notes' install list, as install:<admin>/<id>@n; one
  without shared isn't; an archived shared one isn't;
- the member's page resolves it in the install layer (between pack and person), labelled with the admin, and the
  member's off hides it for the member only (the admin's file is untouched);
- without snap_admins.json there is no install layer.
Everything it writes is parked afterwards (moved, never deleted). usage: python3 -I test_gate_instructions.py [port 8290] [base]
prints "gateinstr n/m" last. The member/admin split across real accounts (members' notes never reach admins) holds by
construction (the route reads only the admins' folders) and is left to the gate units' run after the merge."""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

port = sys.argv[1] if len(sys.argv) > 1 else C.PORT
base = sys.argv[2] if len(sys.argv) > 2 else str(C.base())
user = os.path.join(base, "user")
parked = os.path.join(user, "_parked_gateinstr", time.strftime("%H%M%S"))
admins, admin_dir = os.path.join(user, "snap_admins.json"), os.path.join(user, "gi-admin")
here = os.path.dirname(os.path.abspath(__file__))


def get(route):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}{route}"))


def record(rid, body, archived=None):
    return {"id": rid, "kind": "instruction", "created": 1, "by": "person", "head": 1, "archived": archived, "versions": [{"n": 1, "hash": rid, "at": 1, "by": "person", "note": "", "body": body}]}


R, checks = {}, {}
assert not os.path.exists(admins), "this server already has snap_admins.json: run on a test server without the gate"
try:
    os.makedirs(os.path.join(admin_dir, "snap", "instruction"))
    for rid, body, arch in (("gi-shared", {"scope": "global", "kind": "note", "text": "Install note: render drafts at 6 steps.", "shared": True}, None),
                            ("gi-private", {"scope": "global", "kind": "note", "text": "Admin's own note, not shared."}, None),
                            ("gi-old", {"scope": "global", "kind": "note", "text": "Archived shared note.", "shared": True}, "2026-11-06T00:00:00")):
        json.dump(record(rid, body, arch), open(os.path.join(admin_dir, "snap", "instruction", f"{rid}.json"), "w"))
    R["none"] = get("/mainodes/snap/pack_notes")["install"]
    json.dump({"admins": ["gi-admin"]}, open(admins, "w"))
    R["install"] = get("/mainodes/snap/pack_notes")["install"]
    page = subprocess.run(["node", os.path.join(here, "test_gate_instructions_page.js"), port], capture_output=True, text=True, timeout=300, env={**os.environ, "NODE_PATH": C.NODE_PATH})
    R["page"] = json.loads(page.stdout or "{}") if page.returncode == 0 else {"error": page.stderr[-3000:]}
    R["adminFile"] = json.load(open(os.path.join(admin_dir, "snap", "instruction", "gi-shared.json")))["versions"][0]["body"]["text"]
finally:
    os.makedirs(parked, exist_ok=True)
    for p in (admins, admin_dir):
        if os.path.exists(p):
            shutil.move(p, os.path.join(parked, os.path.basename(p)))
checks = {
    "no snap_admins.json: no install layer": R["none"] == [],
    "the admin's shared note is the install's, as install:<admin>/<id>@n": [x["ref"] for x in R["install"]] == ["install:gi-admin/gi-shared@1"],
    "an unshared or archived admin note isn't": not any("gi-private" in x["ref"] or "gi-old" in x["ref"] for x in R["install"]),
    "the member's stack has it in the install layer, between pack and person, from the admin": R["page"].get("layer") == "install" and R["page"].get("from") == "gi-admin" and R["page"].get("between") is True,
    "the member's off hides it for the member only": R["page"].get("offHidden") is True and R["adminFile"] == "Install note: render drafts at 6 steps.",
    "the member can list it with status off": R["page"].get("listed") == "off",
}
print(json.dumps(R, indent=1))
bad = 0
for k, v in checks.items():
    print(("PASS " if v else "FAIL ") + k)
    bad += not v
print(f"gateinstr {len(checks) - bad}/{len(checks)}")
sys.exit(1 if bad else 0)
