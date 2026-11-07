"""The critic's fixtures run (SNAP-R108, R109): measure a critic (an agent with the snap-critic skill) on pictures the
operator judged by eye, blind, and hold the floor in fixtures.json (the last accepted round: r5b, 27/31 caught, 0 false alarms).

  load    --port P --root DIR [--run NAME]   put every fixture on a Snap server's docket: its picture and context pictures
                                             uploaded into input/, a take for it, and a critique row asked with the
                                             fixture's words (what, context) and context pictures. A critic then works
                                             the docket with Snap's own tools (list_critiques, claim_critique,
                                             critique_packet, write_critique) and sees nothing of `expected`.
  score   --port P --run NAME [--confirm F]  read the written critiques back from the server and score them
  score   --results FILE [--confirm F]       ... or from a JSON lines file of {fixture, verdict, notes: [{severity, pass, text}]}
  packets --root DIR --out DIR               blind packets on disk for a critic with no Snap server (whole picture, 1536 px
                                             tiles with 10 % overlap, context pictures, manifest.json)
  add     --root DIR PICTURE --polarity positive|negative [--flaw ... --where ... --severity ... --owner ...]
          [--what ... --context ... --note ...]   the "Add as fixture" press's twin: appends to DIR/fixtures.local.json

Scoring (fixtures.json `scoring`): an expected flaw is caught when one note matches all of its keys (any severity; the
row is printed with the note so a person confirms it names and locates the same flaw); a medium or high note on a clean
picture is a false alarm until confirmed otherwise (printed beside the picture's allowed minors and must-not-flags).
--confirm FILE is JSON {"X03#1": "caught" | "missed" | 0.5, "X12#cn2": "ok" | "fa"} settling rows; an unsettled
false-alarm row counts as one. Exits 1 below the floor. --port also records the score for critic_report
(user snap/critic_report/fixtures.json).
SNAP-R108 a miss becomes a fixture · SNAP-R109 a prompt change ships only when the floor holds · see docs/snap/SNAP_RULES.md
"""
import argparse
import json
import mimetypes
import os
import re
import shutil
import sys
import time
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "fixtures.json")


def manifest(root=None):
    m = json.load(open(MANIFEST, encoding="utf-8"))
    local = os.path.join(root, "fixtures.local.json") if root else None
    if local and os.path.exists(local):
        m["fixtures"] += [{**f, "counted": False, "local": True} for f in json.load(open(local, encoding="utf-8"))["fixtures"]]
    return m


def root_of(a):
    root = a.root or os.environ.get("SNAP_CRITIC_FIXTURES")
    if not root:
        sys.exit("give --root (the fixtures folder: blind/X01.png ..., blind/ctx/...) or set SNAP_CRITIC_FIXTURES; README.md says where it is")
    return root


def http(base, path, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": ctype} if data is not None else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")


def upload(base, path, sub):
    boundary = uuid.uuid4().hex
    name = os.path.basename(path)
    parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: {mimetypes.guess_type(name)[0] or 'image/png'}\r\n\r\n".encode(), open(path, "rb").read(),
             f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\n{sub}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()]
    out = http(base, "/upload/image", raw=b"".join(parts), ctype=f"multipart/form-data; boundary={boundary}")
    return f"{out['subfolder']}/{out['name']}"


def load(a):
    root, base = root_of(a), f"http://127.0.0.1:{a.port}"
    run = a.run or time.strftime("fx%m%d%H%M")
    sub = f"snap/inbox/{uuid.uuid4().hex[:8]}"  # a neutral folder and name: the critic must not read "fixture" in a path
    made = []
    for i, f in enumerate(manifest(root)["fixtures"]):
        blind = os.path.join(a.out or ".", f"{run}_{uuid.uuid4().hex[:10]}{os.path.splitext(f['picture'])[1]}")
        shutil.copyfile(os.path.join(root, f["picture"]), blind)
        pic = upload(base, blind, sub)
        os.replace(blind, blind + ".uploaded")  # kept beside the run file, never deleted
        ctx = [upload(base, os.path.join(root, c), f"{sub}/ctx") for c in f["context_pictures"]]
        tid, cut = f"take-{run}-{f['id']}", pic.rfind("/")
        # the row first, with the fixture's words, so a page that sees the take land finds it already made
        row = http(base, "/mainodes/snap/critique/due", {"key": f"take:{tid}", "subject": {"kind": "take", "take": tid}, "title": f"Critic: take {9001 + i}", "checklist": f["checklist"], "trigger": "asked", "by": "fixtures",
                                                         "about": {"take": tid}, "context": {"what": f["what"], "text": f["context"], "pictures": [f"input/{c}" for c in ctx]}})["critique"]
        now = int(time.time() * 1000)
        take = {"id": tid, "kind": "run", "prompt_id": tid[5:], "created": now, "finished": now, "seconds": 0, "group": f"critic-fixtures-{run}", "workflow": "critic fixtures", "number": 9001 + i, "status": "success", "text": "", "seed": None,
                "media": [{"kind": "image", "filename": pic[cut + 1:], "subfolder": pic[:cut], "type": "input"}], "prompt": {}, "graph": None, "verdict": None, "prior": False, "notes": [], "fixture_run": run}
        http(base, f"/userdata/{urllib.request.quote(f'snap/takes/{tid}.json', safe='')}?overwrite=true", take)
        made.append({"fixture": f["id"], "take": tid, "critique": row["id"]})
    json.dump({"run": run, "port": a.port, "rows": made}, open(os.path.join(a.out or ".", f"fixtures_{run}.json"), "w"), indent=1)
    print(json.dumps({"run": run, "rows": len(made), "next": f"a critic works the docket (list_critiques {{state: due}}), then: run_fixtures.py score --port {a.port} --run {run}"}))


def matches(keys, text):
    return all(re.search(g if isinstance(g, str) else "|".join(g), text, re.I) for g in keys)


def score(a):
    m = manifest(a.root or os.environ.get("SNAP_CRITIC_FIXTURES"))
    got = {}
    if a.results:
        for line in open(a.results, encoding="utf-8"):
            if line.strip():
                r = json.loads(line)
                got[r["fixture"]] = r
    else:
        rows = http(f"http://127.0.0.1:{a.port}", "/mainodes/snap/critiques")["rows"]
        for r in rows:
            k = re.fullmatch(rf"take:take-{re.escape(a.run)}-(\w+)", r["key"])
            if k and r.get("done"):
                got[k.group(1)] = {"fixture": k.group(1), "verdict": r["verdict"], "notes": r["notes"], "by": r["done"]["by"]}
    confirm = json.load(open(a.confirm, encoding="utf-8")) if a.confirm else {}
    caught = of = fa = clean = 0
    lines, unsure = [], []
    for f in m["fixtures"]:
        r = got.get(f["id"])
        notes = (r or {}).get("notes", [])
        if f["polarity"] == "positive":
            for i, e in enumerate(f["expected"]):
                key = f"{f['id']}#{i}"
                hit = next((n for n in notes if matches(e["keys"], f"{n.get('text', '')} {n.get('fix', '')}")), None)
                v = confirm.get(key, "caught" if hit else "missed")
                pts = 0.5 if v == 0.5 else 1 if v == "caught" else 0
                if f.get("counted", True):
                    of += 1
                    caught += pts
                lines.append(f"{key:7s} {('caught' if pts == 1 else 'half' if pts else 'MISSED'):6s} {'(confirmed)' if key in confirm else '(auto) ' if hit or not r else '?      '} [{e['severity']}] {e['flaw']}"
                             + (f"\n          note [{hit['severity']}] {hit['text']}" if hit else "" if r else "\n          no critique written"))
                if not hit and r and key not in confirm:
                    unsure.append(key)
        else:
            clean += 1
            for n in notes:
                if n.get("severity") in ("medium", "high"):
                    key = f"{f['id']}#{n.get('id', notes.index(n))}"
                    v = confirm.get(key, "fa")
                    fa += v == "fa"
                    lines.append(f"{key:7s} {'FA' if v == 'fa' else 'ok':6s} {'(confirmed)' if key in confirm else '?      '} [{n['severity']}] {n.get('text', '')}\n          allowed minors: {f['allowed_true_minor']}\n          must not flag: {f['must_not_flag']}")
                    if key not in confirm:
                        unsure.append(key)
                elif any(re.search(re.escape(x[:30]), n.get("text", ""), re.I) for x in f["must_not_flag"]):
                    fa += 1
                    lines.append(f"{f['id']}     FA     must_not_flag hit at low: {n.get('text', '')}")
    fl = m["floor"]
    ok = caught >= fl["caught"] and fa <= fl["fa"]
    print("\n".join(lines))
    print(f"\ncaught {caught:g}/{of} · false alarms {fa} on {clean} clean · written {len(got)}/{len(m['fixtures'])} · floor {fl['caught']}/{fl['of']}, {fl['fa']} FA ({fl['round']}, {fl['model']}) · {'HOLDS' if ok else 'BELOW THE FLOOR'}"
          + (f" · {len(unsure)} rows to confirm: {', '.join(unsure)}" if unsure else ""))
    summary = {"caught": caught, "of": of, "fa": fa, "clean": clean, "written": len(got), "floor": fl, "holds": ok, "unsure": unsure, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "run": a.run or a.results}
    if a.port:
        http(f"http://127.0.0.1:{a.port}", f"/userdata/{urllib.request.quote('snap/critic_report/fixtures.json', safe='')}?overwrite=true", summary)
    if a.out:
        json.dump({**summary, "lines": lines}, open(a.out, "w"), indent=1)
    sys.exit(0 if ok else 1)


def packets(a):
    from PIL import Image
    root, out = root_of(a), a.out
    os.makedirs(out, exist_ok=True)
    rows = []
    for f in manifest(root)["fixtures"]:
        d = os.path.join(out, f["id"])
        os.makedirs(d, exist_ok=True)
        im = Image.open(os.path.join(root, f["picture"])).convert("RGB")
        pics = [{"file": f"{f['id']}/whole.png", "role": "subject", "width": im.width, "height": im.height}]
        im.save(os.path.join(out, pics[0]["file"]))
        size, ov = 1536, 0.1
        axis = lambda n: [(0, n)] if n <= size else [(round(i * (n - size) / (k - 1)), size) for k in [-(-(n - size) // int(size * (1 - ov))) + 1] for i in range(k)]
        for r, (y, h) in enumerate(axis(im.height)):
            for c, (x, w) in enumerate(axis(im.width)):
                if (w, h) != (im.width, im.height):
                    name = f"{f['id']}/tile_r{r + 1}c{c + 1}.png"
                    im.crop((x, y, x + w, y + h)).save(os.path.join(out, name))
                    pics.append({"file": name, "role": "tile", "cell": f"r{r + 1}c{c + 1}", "box": [x, y, w, h]})
        for cp in f["context_pictures"]:
            name = f"{f['id']}/ctx_{os.path.basename(cp)}"
            shutil.copyfile(os.path.join(root, cp), os.path.join(out, name))
            pics.append({"file": name, "role": "context"})
        rows.append({"fixture": f["id"], "checklist": f["checklist"], "what": f["what"], "context": f["context"], "pictures": pics})
    json.dump({"about": "blind packets: whole picture first, then tiles, then context; nothing of expected", "packets": rows}, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(json.dumps({"packets": len(rows), "manifest": os.path.join(out, "manifest.json")}))


def add(a):
    root = root_of(a)
    os.makedirs(os.path.join(root, "pictures"), exist_ok=True)
    local = os.path.join(root, "fixtures.local.json")
    data = json.load(open(local, encoding="utf-8")) if os.path.exists(local) else {"about": "the person's own fixtures", "fixtures": []}
    fid = f"L{len(data['fixtures']) + 1:02d}"
    name = f"{fid}{os.path.splitext(a.picture)[1].lower()}"
    shutil.copyfile(a.picture, os.path.join(root, "pictures", name))
    data["fixtures"].append({"id": fid, "polarity": a.polarity, "checklist": a.checklist, "what": a.what or "", "context": a.context or "", "context_pictures": [],
                             "expected": [{"flaw": a.flaw, "where": a.where or "", "severity": a.severity, "owner": a.owner or "", "keys": [[re.escape(w)] for w in (a.keys or [])]}] if a.polarity == "positive" else [],
                             "allowed_true_minor": [], "must_not_flag": [], "note": a.note or "", "picture": f"pictures/{name}"})
    json.dump(data, open(local, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({"fixture": fid, "file": local}))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("mode", choices=["load", "score", "packets", "add"])
    p.add_argument("picture", nargs="?")
    for k in ("--port", "--root", "--run", "--results", "--confirm", "--out", "--flaw", "--where", "--owner", "--what", "--context", "--note"):
        p.add_argument(k)
    p.add_argument("--polarity", choices=["positive", "negative"])
    p.add_argument("--severity", choices=["high", "medium", "low"], default="high")
    p.add_argument("--checklist", default="still")
    p.add_argument("--keys", nargs="*", help="words that a note naming the flaw must contain (each one)")
    a = p.parse_args()
    {"load": load, "score": score, "packets": packets, "add": add}[a.mode](a)
