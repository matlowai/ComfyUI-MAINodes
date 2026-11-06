"""U79 step 9: tools/snap_vault_cli.py encrypt-existing seals private takes saved before the vault was on, on the
gatetest base. With the vault switched off (snap_privacy.json {"on": true, "vault": false}) a private prompt saves
plain; its record is written plain; the dry run lists exactly it; --go seals the record and the file in place; /view
serves the same bytes as before (member unlocked); tools/snap_dataset.py counts it as kept encrypted. The switch is put
back to {"on": true}. usage: comfyui_venv/bin/python -I test_vault_migrate.py [port] [base] [pack]"""
import os
import json
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.GATETEST_PORT
ROOT = Path(sys.argv[2]) if len(sys.argv) > 2 else C.gatetest_base()
PACK = Path(sys.argv[3]) if len(sys.argv) > 3 else C.PACK
PY = C.PYTHON
BASE, T = f"http://127.0.0.1:{PORT}", time.strftime("%H%M%S")
USERS = {v: k for k, v in json.loads((ROOT / "user" / "users.json").read_text()).items()}
MEMBER, PASS = USERS["member"], json.loads(C.fixture("gate_accounts.json").read_text())["member"]
SWITCH = ROOT / "user" / "snap_privacy.json"
checks, R = {}, {}


def req(path, body=None, raw=None, method=None):
    r = urllib.request.Request(BASE + path, data=raw if raw is not None else (None if body is None else json.dumps(body).encode()), method=method, headers={"Content-Type": "application/json", "comfy-user": MEMBER})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run(nodes):
    _, out = req("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": {"extra_pnginfo": {"workflow": {"nodes": [], "extra": {}}}}})
    pid = json.loads(out)["prompt_id"]
    for _ in range(240):
        h = json.loads(req(f"/history/{pid}")[1]).get(pid)
        if h and h.get("status", {}).get("completed") is not None:
            return h
        time.sleep(0.25)


def magic(p):
    return p.read_bytes()[:8] == b"SNAPVLT1"


try:
    SWITCH.write_text(json.dumps({"on": True, "vault": False}))
    h = run({"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": int(T)}}, "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u79_old"}},
             "9": {"class_type": "PrimitiveString", "inputs": {"value": "u79/snaptest_u79_stamped.safetensors"}}})
    f = h["outputs"]["2"]["images"][0]
    path = ROOT / "output" / f["subfolder"] / f["filename"]
    checks["vault off: private take saved plain"] = h["prompt"][3]["snap_marks"]["private"] and not magic(path) and "encrypted" not in h["prompt"][3]["snap_marks"]
    tid = f"take-u79old-{T}"
    req(f"/userdata/snap%2Ftakes%2F{tid}.json?overwrite=true", raw=json.dumps({"id": tid, "kind": "run", "private": True, "media": [{"kind": "image", **f}], "text": "old recipe", "prompt": {}, "notes": [], "number": 1, "created": 1, "status": "success"}).encode(), method="POST")
    rec = ROOT / "user" / MEMBER / "snap" / "takes" / f"{tid}.json"
    checks["record written plain"] = not magic(rec)
finally:
    SWITCH.write_text(json.dumps({"on": True}))
before = path.read_bytes()
cli = [PY, "-I", str(PACK / "tools" / "snap_vault_cli.py"), "encrypt-existing", "--comfy", str(ROOT), "--user", MEMBER]
dry = subprocess.run(cli, capture_output=True, text=True, check=True).stdout
R["dry"] = dry
checks["dry run lists it, touches nothing"] = f"would seal take {tid}" in dry and f["filename"] in dry and not magic(path) and not magic(rec)
go = subprocess.run(cli + ["--go"], capture_output=True, text=True, check=True).stdout
R["go"] = go
checks["--go seals record and file in place, names the TRIM caveat"] = magic(path) and magic(rec) and "trims" in go
req("/mainodes/snap/vault/unlock", {"passphrase": PASS})
st, body = req(f"/view?filename={f['filename']}&subfolder={f['subfolder']}&type=output")
checks["/view serves the same bytes"] = st == 200 and body == before
st, got = req(f"/userdata/snap%2Ftakes%2F{tid}.json")
checks["the record opens"] = json.loads(got).get("text") == "old recipe"
ds = subprocess.run([PY, "-I", str(PACK / "tools" / "snap_dataset.py"), "--comfy", str(ROOT), "--user", MEMBER, "--out", str(C.out("snapbox", "u79") / "dataset_check"), "--include-private"], capture_output=True, text=True, check=True).stdout
R["dataset"] = ds
checks["snap_dataset counts it kept encrypted"] = json.loads(ds)["left_out"]["kept_encrypted"] >= 1 and "kept encrypted" in ds
again = subprocess.run(cli, capture_output=True, text=True, check=True).stdout
checks["a second dry run finds nothing left"] = f"take {tid}" not in again
bad = [k for k, v in checks.items() if not v]
C.out("snapbox", "test_vault_migrate_result.json").write_text(json.dumps({"checks": checks, "R": R}, indent=1))
print(f"vaultmig  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")
