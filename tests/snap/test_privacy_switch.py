"""U80 (SNAP-R37): privacy is a per-install opt-in, off by default, read from user/snap_privacy.json ({"on": true}),
against the CPU test server (default :8195, whose baseline is privacy on).
On: a LoRA stamped `"privacy": "full"` in its header marks its prompt private, /mainodes/snap/private_loras lists it and
/mainodes/snap/take_marks says privacy is on.
Off ({"on": false}, and with no file): the same prompt is not private (no snap_marks.private), and neither is an identity
LoRA, a file under a private path, nor a broken private.json; private_loras is empty; take_marks says privacy is off and
marks no take private (the page's locks read that flag, so none shows). NSFW tags still mark.
The switch is put back to {"on": true} at the end (and the test user's snap/ files it wrote are parked).
usage: python3 -I test_privacy_switch.py [port] [base dir]"""
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
BASE, SWITCH, USER = f"http://127.0.0.1:{PORT}", BASEDIR / "user" / "snap_privacy.json", BASEDIR / "user" / "snaptest_u80"
STAMPED, IDENTITY, NSFW = "snaptest_stamped_lora.safetensors", "snaptest_u80_identity.safetensors", "snaptest_u77_nsfw.safetensors"


def req(path, body=None):
    r = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def marks(lora):
    nodes = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
             "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u80"}}, "3": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": lora, "strength_model": 1.0}}}
    status, res = req("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": {"extra_pnginfo": {"workflow": {"nodes": [], "extra": {}}}}})
    for _ in range(240):
        h = req(f"/history/{res['prompt_id']}")[1].get(res["prompt_id"])
        if h and h.get("status", {}).get("completed") is not None:
            return h["prompt"][3].get("snap_marks") or {}
        time.sleep(0.25)
    raise TimeoutError(res["prompt_id"])


def state():
    return {"stamped": marks(STAMPED).get("private", False), "identity": marks(IDENTITY).get("private", False), "nsfw": marks(NSFW).get("nsfw", False),
            "loras": req("/mainodes/snap/private_loras")[1]["loras"], "takeMarks": req("/mainodes/snap/take_marks")[1]}


R = {}
f = BASEDIR / "models" / "loras" / IDENTITY
f.write_bytes((2).to_bytes(8, "little") + b"{}")
(USER / "snap").mkdir(parents=True, exist_ok=True)
(USER / "snap" / "models.json").write_text(json.dumps([{"file": IDENTITY, "role": "identity"}, {"file": NSFW, "tags": ["nsfw"]}]))
try:
    SWITCH.write_text(json.dumps({"on": True}))
    R["on"] = state()
    SWITCH.write_text(json.dumps({"on": False}))
    R["off"] = state()
    (USER / "snap" / "private.json").write_text(json.dumps({"paths": None}))  # broken rules: fail closed only when on
    R["offBroken"] = state()
    SWITCH.write_text("{not json")
    R["switchBroken"] = {"stamped": marks(STAMPED)}
finally:
    SWITCH.write_text(json.dumps({"on": True}))
    parked = BASEDIR / "user" / "_parked" / f"u80-{time.strftime('%H%M%S')}"
    parked.parent.mkdir(exist_ok=True)
    shutil.move(str(USER), str(parked))

on, off, ob = R["on"], R["off"], R["offBroken"]
checks = [on["stamped"] is True and on["identity"] is True and on["nsfw"] is True, STAMPED in on["loras"] and on["takeMarks"]["privacy"] is True,
          off["stamped"] is False and off["identity"] is False and off["nsfw"] is True, off["loras"] == [] and off["takeMarks"]["privacy"] is False and not any(m["private"] for m in off["takeMarks"]["takes"].values()),
          ob["stamped"] is False and ob["identity"] is False and ob["loras"] == [], R["switchBroken"]["stamped"].get("private") is True]
R["checks"] = checks
C.out("ui", "test_privacy_switch_result.json").write_text(json.dumps(R, indent=1))
print(f"privacy  {sum(checks)}/{len(checks)} {'PASS' if all(checks) else 'FAIL ' + str([i for i, x in enumerate(checks) if not x])}")
