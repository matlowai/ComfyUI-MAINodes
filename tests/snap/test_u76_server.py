"""U76 review leftovers, server and export side, on the CPU test server (default :8195, privacy on):
- M2: the export leaves out a take made from a private take's frame (`made_from`), and a hand-made loop of parents and
  made_from links doesn't crash it (tools/snap_dataset.py on a fake user folder in the scratch folder given);
- L5: one take file that doesn't parse is named under `unreadable` in /mainodes/snap/take_marks, which still answers
  (it was a 500, so the page showed no rule-based locks at all);
- L6: /mainodes/snap/private_loras skips a LoRA that is a broken link instead of logging a warning per row, and says
  whether privacy is on.
Places a broken take file in the server's snap/takes and a broken link in its models/loras; both are moved to
<base>/_parked_u76/ afterwards (never deleted). Prints one line, writes ui/test_u76_server_result.json.
usage: python3 -I test_u76_server.py [port] [base dir] [scratch dir] [snap_dataset.py, e.g. a HEAD copy for a before-run]"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

arg = lambda i, default: sys.argv[i] if len(sys.argv) > i and sys.argv[i] else default  # "" keeps the default
PORT = arg(1, C.PORT)
BASEDIR = Path(arg(2, str(C.base())))
SCRATCH = Path(arg(3, str(C.out("u76_export"))))
TOOL = arg(4, str(C.PACK / "tools" / "snap_dataset.py"))
T = time.strftime("%H%M%S")


def get(path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def journal_warnings(since):
    out = subprocess.run(["journalctl", "--user", "-u", C.UNIT, "--since", since, "--no-pager", "-o", "cat"], capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if "doesn't link anywhere" in l or "snaptest_u76_dead" in l]


R, checks = {}, {}
# ---- M2: the export follows made_from; a loop doesn't crash it ----
root = SCRATCH / T / "comfy"
snap = root / "user" / "default" / "snap"
(snap / "takes").mkdir(parents=True)
(root / "user" / "snap_privacy.json").write_text('{"on": true}')
base = {"group": "g", "number": 1, "created": 1, "status": "done", "notes": [], "media": [{"type": "output", "subfolder": "", "filename": "x.png"}]}
rows = {"tp": {"private": True}, "tm": {"made_from": ["tp"]}, "tplain": {}, "ta": {"parent": {"take": "tb"}}, "tb": {"made_from": ["ta"]}}
for i, extra in rows.items():
    (snap / "takes" / f"{i}.json").write_text(json.dumps({"id": i, **base, **extra}))
out = SCRATCH / T / "out"
r = subprocess.run([sys.executable, "-I", TOOL, "--comfy", str(root), "--out", str(out)], capture_output=True, text=True)
R["export"] = {"code": r.returncode, "stderr": r.stderr[-2000:] if r.returncode else "", "stdout": r.stdout}
ids = [json.loads(l)["id"] for l in (out / "takes.jsonl").read_text().splitlines()] if (out / "takes.jsonl").exists() else []
R["exported"] = ids
checks["M2 export: a take made from a private take's frame is left out"] = r.returncode == 0 and "tm" not in ids and "tp" not in ids
checks["M2 export: a loop of parent and made_from links doesn't crash, and plain takes stay"] = r.returncode == 0 and {"tplain", "ta", "tb"} <= set(ids)

# ---- L5: one broken take file ----
takes_dir = BASEDIR / "user" / "default" / "snap" / "takes"
takes_dir.mkdir(parents=True, exist_ok=True)
broken = takes_dir / f"take-u76-broken-{T}.json"
broken.write_text('{"id": "take-u76-broken", "prompt": ')
dead = BASEDIR / "models" / "loras" / f"snaptest_u76_dead_{T}.safetensors"
os.symlink(BASEDIR / f"_nothing_here_{T}.safetensors", dead)
try:
    st, marks = get("/mainodes/snap/take_marks")
    R["take_marks"] = {"status": st, "unreadable": marks.get("unreadable") if isinstance(marks, dict) else marks}
    checks["L5 take_marks answers with one broken take file"] = st == 200
    checks["L5 ... and names it under unreadable"] = st == 200 and any(broken.name in u for u in marks.get("unreadable", []))
    # ---- L6: a broken link among the LoRAs ----
    time.sleep(1.1)
    since = time.strftime("%Y-%m-%d %H:%M:%S")
    st, locks = get("/mainodes/snap/private_loras")
    time.sleep(1.5)
    R["private_loras"] = {"status": st, "privacy": locks.get("privacy") if isinstance(locks, dict) else None, "warnings": journal_warnings(since)}
    checks["L6 private_loras logs no warning for a broken link"] = st == 200 and not R["private_loras"]["warnings"]
    checks["L6 private_loras says privacy is on here"] = st == 200 and locks.get("privacy") is True
finally:
    parked = BASEDIR / "_parked_u76"
    parked.mkdir(exist_ok=True)
    shutil.move(str(broken), str(parked / broken.name))
    shutil.move(str(dead), str(parked / dead.name))
R["checks"] = checks
C.out("ui", "test_u76_server_result.json").write_text(json.dumps(R, indent=1))
bad = [k for k, v in checks.items() if not v]
print(f"u76srv   {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")
