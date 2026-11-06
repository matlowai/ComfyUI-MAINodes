"""G1b item 4 (SNAP-R114) through the pack's own nodes on a server (default :8194, the GPU test unit): the voice note's
numbers on scout/voice_timbre_2026-11-06.md's clips (<fixtures>/voice_timbre/round2.json: short03's three 12-step Cast voice
references, the two v2 references and 12 Ref2V talking cuts that cite them).
- MAISnapVoiceModelLoader + MAISnapVoice per clip (a reference as Load Audio, a cut's soundtrack from its video), with
  the model graph's voice model;
- its embeddings against the scout's (WavLM-SV through transformers' own forward with the peft stub, round2.npz): every
  pairwise cosine within 0.01;
- its F0 (YIN) against the scout's pyin medians: the median clip within 2 %, every clip within 8 % (Brann's reference,
  whose pitch spreads 3.5 semitones, reads 172 Hz against pyin's 160; the note compares a take with its reference the
  same way, so it is the difference in semitones that counts);
- the note the page makes (voices.js: own score, the closest other Cast, margin, F0 in semitones) with the model graph's
  voice_check: all 12 cuts "ok" (own 0.97-0.99, the other woman 0.86-0.93), as the scout found by ear-free numbers.
Prints "g1bvoice n/m" last. usage: comfyui_venv/bin/python -I test_g1b_voice.py [port 8194]"""
import json
import math
import os
import sys
import time
import urllib.request
import uuid

import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.GPU_PORT
BASE = f"http://127.0.0.1:{PORT}"
VT = str(C.fixture("voice_timbre"))
GRAPH = str(C.PACK / "snap_cards" / "models.json")
t0 = time.time()


def upload(path, name):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\nsnaptest_g1b_voice\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + open(path, "rb").read() + f"\r\n--{boundary}--\r\n".encode()
    r = urllib.request.Request(BASE + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    out = json.load(urllib.request.urlopen(r))
    return f"{out['subfolder']}/{out['name']}"


graph = json.load(open(GRAPH))["files"]
model = next(e for e in graph if e.get("voice_check"))
VC = model["voice_check"]
scout = json.load(open(os.path.join(VT, "round2.json")))
emb = np.load(os.path.join(VT, "round2.npz"))
clips = {k: v for k, v in scout.items() if k.startswith(("ref_", "ref2_", "a_", "b_", "c_"))}
p = {"vm": {"class_type": "MAISnapVoiceModelLoader", "inputs": {"model_name": model["file"]}}}
for i, (k, v) in enumerate(clips.items()):
    f = upload(os.path.join(VT, v["path"]), f"{k}{os.path.splitext(v['path'])[1]}")
    if f.endswith(".mp4"):
        p[f"l{i}"] = {"class_type": "LoadVideo", "inputs": {"file": f}}
        p[f"c{i}"] = {"class_type": "GetVideoComponents", "inputs": {"video": [f"l{i}", 0]}}
        src = [f"c{i}", 1]
    else:
        p[f"l{i}"] = {"class_type": "LoadAudio", "inputs": {"audio": f}}
        src = [f"l{i}", 0]
    p[f"v{i}"] = {"class_type": "MAISnapVoice", "inputs": {"voice_model": ["vm", 0], "audio": src}}
r = urllib.request.Request(BASE + "/prompt", data=json.dumps({"prompt": p, "client_id": "snaptest-g1b-voice"}).encode(), headers={"Content-Type": "application/json"})
pid = json.load(urllib.request.urlopen(r))["prompt_id"]
while True:
    h = json.load(urllib.request.urlopen(f"{BASE}/history/{pid}")).get(pid)
    if h and (h["status"].get("completed") or h["status"].get("status_str") == "error"):
        break
    time.sleep(1)
if h["status"].get("status_str") != "success":
    sys.exit(f"g1bvoice 0/4 (the prompt didn't run: {json.dumps(h['status'])})")
got = {k: {"e": np.array(h["outputs"][f"v{i}"]["voices"][0]), "f0": h["outputs"][f"v{i}"]["f0"][0]} for i, k in enumerate(clips)}
keys = list(clips)
pairs = [(a, b) for i, a in enumerate(keys) for b in keys[i + 1:]]
cos_err = max(abs(float(got[a]["e"] @ got[b]["e"]) - float(emb[a] @ emb[b] / np.linalg.norm(emb[a]) / np.linalg.norm(emb[b]))) for a, b in pairs)
f0_err = {k: round(abs(got[k]["f0"] - clips[k]["f0"]["median_hz"]) / clips[k]["f0"]["median_hz"] * 100, 2) for k in keys}

# the note voices.js makes: own = the cited reference, others = the other Casts' references (the cut's own era: a/c cite
# the first references, b the v2 ones)
refs = {"a": {"maren": "ref_maren", "liesl": "ref_liesl", "brann": "ref_brann"}, "c": {"maren": "ref_maren", "liesl": "ref_liesl", "brann": "ref_brann"}, "b": {"maren": "ref2_maren", "liesl": "ref2_liesl", "brann": "ref_brann"}}
notes = {}
for k in keys:
    if k.startswith("ref"):
        continue
    arm, who = k.split("_")[0], k.split("_")[1]
    own = float(got[k]["e"] @ got[refs[arm][who]]["e"])
    others = sorted(((float(got[k]["e"] @ got[ref]["e"]), name) for name, ref in refs[arm].items() if name != who), reverse=True)
    st = 12 * math.log2(got[k]["f0"] / got[refs[arm][who]]["f0"])
    ok = own >= VC["ok"] and own - others[0][0] >= VC["margin"] and abs(st) <= VC["f0_semitones"]
    notes[k] = {"own": round(own, 3), "other": [others[0][1], round(others[0][0], 3)], "margin": round(own - others[0][0], 3), "f0": got[k]["f0"], "ref_f0": got[refs[arm][who]]["f0"], "st": round(st, 2), "status": "ok" if ok else "check"}

checks = [cos_err <= 0.01, max(f0_err.values()) <= 8 and float(np.median(list(f0_err.values()))) <= 2, len(notes) == 12 and all(n["status"] == "ok" for n in notes.values()),
          all(0.95 <= n["own"] <= 1 and n["other"][1] < n["own"] for n in notes.values())]
os.makedirs(os.path.join(C.out(), "ui", "g1b"), exist_ok=True)
json.dump({"voice_check": VC, "cosine_max_diff_vs_scout": round(cos_err, 4), "f0_pct_diff_vs_pyin": f0_err, "notes": notes, "seconds": round(time.time() - t0, 1)},
          open(os.path.join(C.out(), "ui", "g1b", "test_g1b_voice_result.json"), "w"), indent=1)
print(f"voice: cosines vs the scout's max diff {cos_err:.4f}; F0 vs pyin median {float(np.median(list(f0_err.values()))):.2f} %, max {max(f0_err.values())} %; notes {sum(n['status'] == 'ok' for n in notes.values())}/{len(notes)} ok "
      f"(own {min(n['own'] for n in notes.values())}-{max(n['own'] for n in notes.values())}, margin {min(n['margin'] for n in notes.values())}-{max(n['margin'] for n in notes.values())}); {time.time() - t0:.0f} s")
print(f"g1bvoice {sum(checks)}/{len(checks)}")
