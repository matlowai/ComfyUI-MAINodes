"""Batch G14 on the CPU server (default :8195), the pack's two picture nodes on real region edits (fixtures g14/: crops of
Kuroe's fixes and the C2 key's chain edits, the box with 24 px of the picture around it):
- SNAP-R205 (F-Z03): MAISnapSeam's tone: s9962 (a box pasted ~21 grey levels lighter, "no break" before G14) shows along
  its left and right edges, lighter, over most of each, with still no break; the 16 clean region edits (eye, lapel and
  head crops, the tiny bridge crops, the masked removals as pasted) show nothing;
- SNAP-R206 (F-Z01): MAISnapKeepEdit on fix B s9912 and its two stage 2 redraws (d0.30, d0.20), which drew the nose bar
  back: where the bar was, the output is the edit (scaled) and the redraw is not; the hair above the edit's box is the
  redraw untouched; the output is the redraw's size.
usage: python -I test_g14_nodes.py [port]   prints "g14nodes n/m" last"""
import io
import json
import os
import sys
import time
import urllib.request
import uuid

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.PORT
BASE = f"http://127.0.0.1:{PORT}"
FX = C.fixture("g14")


def upload(path):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\nsnaptest_g14\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    out = json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})))
    return f"{out['subfolder']}/{out['name']}"


def run(prompt):
    r = urllib.request.Request(BASE + "/prompt", data=json.dumps({"prompt": prompt, "client_id": "snaptest-g14"}).encode(), headers={"Content-Type": "application/json"})
    pid, t0 = json.load(urllib.request.urlopen(r))["prompt_id"], time.time()
    while time.time() - t0 < 600:
        h = json.load(urllib.request.urlopen(f"{BASE}/history/{pid}")).get(pid)
        if h and (h["status"].get("completed") or h["status"].get("status_str") == "error"):
            if h["status"].get("status_str") != "success":
                sys.exit(f"g14nodes: FAIL, the prompt didn't run: {json.dumps(h['status'])}")
            return h["outputs"]
        time.sleep(1)
    sys.exit("g14nodes: FAIL, the prompt didn't finish in 10 min")


def png(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


cases = json.load(open(FX / "seam_cases.json"))
prompt = {}
for i, c in enumerate(cases):
    prompt[f"p{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / f"{c['name']}_picture.png")}}
    prompt[f"e{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / f"{c['name']}_edit.png")}}
    prompt[f"s{i}"] = {"class_type": "MAISnapSeam", "inputs": {"picture": [f"p{i}", 0], "edit": [f"e{i}", 0], "x": c["x"], "y": c["y"], "feather": c["feather"]}}
prompt["kb"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / "keep_s9912_before.png")}}
prompt["ke"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / "keep_s9912_edit.png")}}
for d in ("d30", "d20"):
    prompt[f"kr{d}"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / f"keep_s9912_redraw_{d}.png")}}
    prompt[f"k{d}"] = {"class_type": "MAISnapKeepEdit", "inputs": {"redraw": [f"kr{d}", 0], "edit": ["ke", 0], "before": ["kb", 0], "feather": 10}}
    prompt[f"ko{d}"] = {"class_type": "SaveImage", "inputs": {"images": [f"k{d}", 0], "filename_prefix": f"snaptest/g14_keep_{d}"}}
out = run(prompt)

R = {"seam": {}, "keep": {}}
for i, c in enumerate(cases):
    o = out[f"s{i}"]
    R["seam"][c["name"]] = {"kind": c["kind"], "breaks": o["seam"], "tone": o["seam_tone"], "checked": o["seam_checked"]}
shows = R["seam"][next(c["name"] for c in cases if c["kind"] == "shows")]
side_len = {"left": 320, "right": 320, "top": 340, "bottom": 340}
clean = {n: r["tone"] for n, r in R["seam"].items() if r["kind"] == "clean"}

before, edit = png(FX / "keep_s9912_before.png"), png(FX / "keep_s9912_edit.png")
bar = (np.abs(edit - before).max(-1) > 60)
bar[:, :120] = False  # the monocle's lens and chain are left of x 120 in this crop; the bar runs right of it, across the nose
bar = bar.repeat(2, 0).repeat(2, 1)
up = np.asarray(Image.fromarray(edit.astype(np.uint8)).resize((512, 512), Image.LANCZOS)).astype(np.float32)
for d in ("d30", "d20"):
    img = out[f"ko{d}"]["images"][0]
    got = png(io.BytesIO(urllib.request.urlopen(f"{BASE}/view?filename={img['filename']}&subfolder={img['subfolder']}&type={img['type']}").read()))
    redraw = png(FX / f"keep_s9912_redraw_{d}.png")
    R["keep"][d] = {"size": list(got.shape[:2]), "bar_px": int(bar.sum()), "bar_redraw_vs_edit": round(float(np.abs(redraw - up)[bar].mean()), 2), "bar_out_vs_edit": round(float(np.abs(got - up)[bar].mean()), 2),
                    "hair_out_vs_redraw": round(float(np.abs(got[:32] - redraw[:32]).max()), 2)}

checks = {
    "F-Z03: s9962's box shows along its left and right edges, lighter by 15+ levels over most of each": {t["side"] for t in shows["tone"]} >= {"left", "right"} and all(t["delta"] >= 15 for t in shows["tone"] if t["side"] in ("left", "right"))
        and all(sum(t["to"] - t["from"] + 1 for t in shows["tone"] if t["side"] == s) >= 0.9 * side_len[s] for s in ("left", "right")),
    "F-Z03: s9962 still has no break (the tone is its only flag)": shows["breaks"] == [],
    "F-Z03: every edge's mean step is in seam_checked": all(len(r["checked"]) == 4 and all("tone" in x for x in r["checked"]) for r in R["seam"].values()),
    f"F-Z03: none of the {len(clean)} clean region edits shows a box": all(t == [] for t in clean.values()),
    "F-Z01: the output is the redraw's size": all(k["size"] == [512, 512] for k in R["keep"].values()),
    "F-Z01: where the bar was, the redraw drew it back and the output is the edit (within Lanczos rounding)": all(k["bar_px"] > 50 and k["bar_redraw_vs_edit"] > 10 and k["bar_out_vs_edit"] < min(5, k["bar_redraw_vs_edit"] / 5) for k in R["keep"].values()),
    "F-Z01: away from the edit's change (the hair above its box) the output is the redraw": all(k["hair_out_vs_redraw"] <= 1 for k in R["keep"].values()),
}
json.dump({"result": R, "checks": checks}, open(C.out("ui", "test_g14_nodes_result.json"), "w"), indent=1)
print(json.dumps({"keep": R["keep"], "shows": shows["tone"], "clean_tone": clean}, indent=1))
bad = 0
for k, v in checks.items():
    print(f"{'PASS' if v else 'FAIL'} {k}")
    bad += not v
print(f"g14nodes {len(checks) - bad}/{len(checks)}")
sys.exit(1 if bad else 0)
