"""Batch G14 on the CPU server (default :8195), the seam check on real region edits (fixtures g14/: crops of
Kuroe's fixes and the C2 key's chain edits, the box with 24 px of the picture around it):
- SNAP-R205 (F-Z03): MAISnapSeam's tone: s9962 (a box pasted ~21 grey levels lighter, "no break" before G14) shows along
  its left and right edges, lighter, over most of each, with still no break; the 16 clean region edits (eye, lapel and
  head crops, the tiny bridge crops, the masked removals as pasted) show nothing.
usage: python -I test_g14_nodes.py [port]   prints "g14nodes n/m" last"""
import json
import os
import sys
import time
import urllib.request
import uuid

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


cases = json.load(open(FX / "seam_cases.json"))
prompt = {}
for i, c in enumerate(cases):
    prompt[f"p{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / f"{c['name']}_picture.png")}}
    prompt[f"e{i}"] = {"class_type": "LoadImage", "inputs": {"image": upload(FX / f"{c['name']}_edit.png")}}
    prompt[f"s{i}"] = {"class_type": "MAISnapSeam", "inputs": {"picture": [f"p{i}", 0], "edit": [f"e{i}", 0], "x": c["x"], "y": c["y"], "feather": c["feather"]}}
out = run(prompt)

R = {"seam": {}}
for i, c in enumerate(cases):
    o = out[f"s{i}"]
    R["seam"][c["name"]] = {"kind": c["kind"], "breaks": o["seam"], "tone": o["seam_tone"], "checked": o["seam_checked"]}
shows = R["seam"][next(c["name"] for c in cases if c["kind"] == "shows")]
side_len = {"left": 320, "right": 320, "top": 340, "bottom": 340}
clean = {n: r["tone"] for n, r in R["seam"].items() if r["kind"] == "clean"}

checks = {
    "F-Z03: s9962's box shows along its left and right edges, lighter by 15+ levels over most of each": {t["side"] for t in shows["tone"]} >= {"left", "right"} and all(t["delta"] >= 15 for t in shows["tone"] if t["side"] in ("left", "right"))
        and all(sum(t["to"] - t["from"] + 1 for t in shows["tone"] if t["side"] == s) >= 0.9 * side_len[s] for s in ("left", "right")),
    "F-Z03: s9962 still has no break (the tone is its only flag)": shows["breaks"] == [],
    "F-Z03: every edge's mean step is in seam_checked": all(len(r["checked"]) == 4 and all("tone" in x for x in r["checked"]) for r in R["seam"].values()),
    f"F-Z03: none of the {len(clean)} clean region edits shows a box": all(t == [] for t in clean.values()),
}
json.dump({"result": R, "checks": checks}, open(C.out("ui", "test_g14_nodes_result.json"), "w"), indent=1)
print(json.dumps({"shows": shows["tone"], "clean_tone": clean}, indent=1))
bad = 0
for k, v in checks.items():
    print(f"{'PASS' if v else 'FAIL'} {k}")
    bad += not v
print(f"g14nodes {len(checks) - bad}/{len(checks)}")
sys.exit(1 if bad else 0)
