"""Snap's half of the Snap <-> Astrid protocol (PROTOCOL_V1_1), outside ComfyUI: it runs Astrid's own CLI through the
launcher the person named (Settings > MAINodes > Snap > Astrid: a script that runs `astrid ...` and `python ...` with
Astrid's interpreter in a clean environment), so nothing of Astrid enters ComfyUI's Python, and it reaches Snap through
the bridge on loopback like any agent (Snap's tool table is the API, SNAP-R19).

usage: SNAP_BASE=http://127.0.0.1:<port> SNAP_AGENT=<name> python3 -I astrid_push.py <command> [options]
  push --book B        the whole push: `cut`, then `context` (what the Cut lens's button and the auto-push run)
  cut --book B         the Cut into the production's Astrid project: imported as the Book's timeline the first time,
                       after that every changed cut swapped in place (the clip keeps its id, the cut id; its file,
                       label, generation.snap and words become the new take's); a Cut whose shape changed (a cut added, removed or moved, a length changed) is
                       refused unless --new-timeline, which imports a new timeline and keeps the old one
  swap --book B --cut C10 [--expected-head REV]   one cut swapped in place (a re-take), whatever else changed
  context --book B     the production's project (metadata.snap), a reference per Cast and place (pins from the active
                       takes' own versions), the Book's documents (snap.story / beat-sheet / style / voices.<project>.<book>,
                       snap.production.<project>), and the production style's marked section in the project preferences when
                       the Book's "Share the production style with Astrid" is on (removed when it is off)
  render --book B      the Book's timeline rendered by Astrid, mastered to -16 LUFS / -1 dBTP
  proposal-note --book B   the snap.proposals.<project> document: Snap's proposals, each with its state and the Room's link
  probe ARCHIVE        is this archive editable in Astrid? Imported into the scratch project `snap-probe`, one clip
                       trimmed by 0.1 s, committed and read back (the lab's probe_editable.py steps). Nothing is deleted.
options: --launcher PATH (default: the person's setting, from Snap), --archive FILE (an export already written: no
export_cut call), --page ID (the Snap page to call; default: where SNAP_AGENT's calls go), --by WHO (who pushed, for the
receipt), --user NAME (a --multi-user ComfyUI's user).
Every Astrid call passes --project. Nothing but this machine is ever reached: SNAP_BASE and the Astrid Runtime's
endpoint (its discovery file) must be loopback, else nothing is run. Snap's receipt (snap/astrid.json) is written after
every push: it is the only record of where a Cut went. The answer is one JSON object, whole, on stdout.
SNAP-R215 every archive probed · SNAP-R217 a pushed Book changes in place · SNAP-R221 references from the takes' own pins ·
SNAP-R224 the push runs on loopback, a linked Book is never imported again · SNAP-R225 the receipt · SNAP-R226 the style
section, words only · SNAP-R18 local only · see docs/snap/SNAP_RULES.md
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from urllib.parse import urlsplit

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
PROBE_PROJECT = "snap-probe"
STYLE_WORDS = ("paragraph", "palette", "voice", "sound", "genre")  # SNAP-R226: never still, lora or source


class Refused(Exception):
    """A step that can't go on: its answer is {ok: false, stage, error, message, ...}."""
    def __init__(self, stage, message, error=None, **more):
        super().__init__(message)
        self.answer = {"ok": False, "stage": stage, "error": error or stage, "message": message, **more}


def loopback(url, what):
    if urlsplit(url).hostname not in LOOPBACK:
        raise Refused("loopback", f"{what} is {url}, which isn't this machine: nothing was run (SNAP-R18)", "not_loopback")


class Snap:
    """Snap's bridge on loopback, called as an agent: the tool table, the receipt and its link"""
    def __init__(self, base, agent, page=None, user=None):
        loopback(base, "SNAP_BASE")
        self.base = base.rstrip("/")
        self.headers = {"Content-Type": "application/json", "X-Snap-Agent": agent, **({"X-Snap-Page": page} if page else {}), **({"comfy-user": user} if user else {})}

    def request(self, path, body=None, headers=None):
        req = urllib.request.Request(f"{self.base}{path}", data=None if body is None else json.dumps(body).encode(), headers={**self.headers, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(text)
            except ValueError:
                return e.code, {"error": f"Snap answered {e.code}: {text}"}

    def call(self, tool, **args):
        """one Snap tool; a timeout or a call still running is asked again with the same key (SNAP-R159, R208)"""
        key = f"astrid-push-{uuid.uuid4().hex[:16]}"
        for attempt in range(6):
            status, out = self.request("/mainodes/snap/call", {"tool": tool, "args": args}, {"Idempotency-Key": key})
            if not (out.get("in_flight") or status == 504) or attempt == 5:
                break
            time.sleep(5)
        if "error" in out or "result" not in out:
            raise Refused("snap", f"Snap's {tool}: {out.get('error') or out}", "snap_refused")
        return out["result"]

    def receipt(self):
        status, out = self.request("/mainodes/snap/astrid")
        if status != 200:
            raise Refused("snap", f"Snap's receipt: {out.get('error') or out}", "snap_refused")
        return out

    def link(self, **q):
        status, out = self.request("/mainodes/snap/astrid/link", q)
        if status != 200:
            raise Refused("receipt", f"Snap's receipt refused the push's record: {out.get('error') or out}", "receipt")
        return out


class Astrid:
    """Astrid's CLI through the person's launcher, which owns the interpreter and a clean environment"""
    def __init__(self, launcher):
        if not launcher:
            raise Refused("setup", "Astrid isn't set up on this machine: say where its launcher is (Settings > MAINodes > Snap > Astrid)", "no_launcher")
        self.launcher = launcher
        root = os.environ.get("ASTRID_RUNTIME_DATA_ROOT")
        if root:  # R13: a Runtime that isn't on this machine is refused before anything is sent to it
            found = os.path.join(root, "runtime", "discovery.json")
            if not os.path.isfile(found):
                raise Refused("setup", f"no Astrid Runtime runs for {root} (no runtime/discovery.json): start it, then push again", "no_runtime")
            with open(found, encoding="utf-8") as f:
                loopback(json.load(f).get("endpoint", ""), "the Astrid Runtime's endpoint")

    def run(self, *args, stage):
        """one Astrid CLI call with --json: its envelope's data, or Refused with the whole of what it said"""
        done = subprocess.run([self.launcher, "astrid", *args, "--json"], capture_output=True, text=True)
        start = done.stdout.find("{")
        try:
            envelope = json.loads(done.stdout[start:]) if start >= 0 else None
        except json.JSONDecodeError:
            envelope = None
        if not (envelope and envelope.get("ok")):
            error = (envelope or {}).get("error") or {}
            raise Refused(stage, f"astrid {' '.join(args[:2])}: {done.stdout}{done.stderr}".strip(), error.get("code") if isinstance(error, dict) else stage)
        return envelope["data"]

    def project(self, slug, name, snap=None):
        """the project by slug, made when missing, with metadata.snap = `snap` when given. A settings update replaces
        the project's metadata whole (F-AE01), so the rest of it is sent back with Snap's part"""
        try:
            data = self.run("projects", "show", slug, stage="project")
        except Refused:
            return self.run("projects", "create", slug, "--name", name, *(["--settings", json.dumps({"snap": snap})] if snap else []), stage="project")
        if snap and (data.get("metadata") or {}).get("snap") != snap:
            data = self.run("projects", "update", slug, "--settings", json.dumps({**(data.get("metadata") or {}), "snap": snap}), stage="project")
        return data

    def clips(self, project, timeline):
        """every clip of the timeline's published head (paged through, never cut short) and the head's revision"""
        data = self.run("timelines", "show", timeline, "--project", project, "--limit", "100", stage="show")
        clips = list(data["clips"])
        while data["pagination"].get("next_cursor"):
            data = self.run("timelines", "show", timeline, "--project", project, "--limit", "100", "--cursor", data["pagination"]["next_cursor"], stage="show")
            clips += data["clips"]
        return clips, data["summary"]["head_revision_id"]

    def python(self, *args, stdin):
        """this file again, under Astrid's own interpreter (the launcher's `python`), for the SDK steps the CLI lacks"""
        done = subprocess.run([self.launcher, "python", "-I", os.path.abspath(__file__), *args], input=json.dumps(stdin), capture_output=True, text=True)
        try:
            return json.loads(done.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise Refused("swap", f"Astrid's SDK step said: {done.stdout}{done.stderr}".strip(), "sdk")


def probe(astrid, archive, name):
    """import into snap-probe, trim the first picture clip by 0.1 s, read it back (the lab's probe_editable.py)"""
    report = {"ok": False, "stage": "start", "project": PROBE_PROJECT, "archive": archive, "timeline_id": None, "clip": None}
    try:
        astrid.project(PROBE_PROJECT, "Snap probe")
        timeline = astrid.run("timelines", "import", archive, "--project", PROBE_PROJECT, "--name", f"{name} (probe)", stage="import")["timeline_id"]
        report.update(stage="imported", timeline_id=timeline)
        clips, _ = astrid.clips(PROBE_PROJECT, timeline)
        media = sorted((c for c in clips if c.get("clip_type") == "media" and c["track_id"] == "V1"), key=lambda c: (c["authored_timing"].get("at", 0), c["clip_id"]))
        if not media:
            raise Refused("pick", f"no picture clip to trim in {[c.get('clip_id') for c in clips]}")
        clip, before = media[0]["clip_id"], float(media[0]["authored_timing"].get("from", 0))
        report.update(stage="trim", clip=clip, from_before=before)
        done = astrid.run("timelines", "edit", timeline, "--project", PROBE_PROJECT, "--clip", f"parent/clip:{clip}", "--trim-in", f"{before + 0.1:.6f}",
                          "--idempotency-key", f"snap-probe-{uuid.uuid4().hex[:12]}", stage="trim")
        report.update(status=done.get("status"), accepted_revision_id=done.get("accepted_revision_id"))
        if done.get("status") != "accepted":
            raise Refused("trim", json.dumps(done), "not_accepted")
        after = next((float(c["authored_timing"].get("from", 0)) for c in astrid.clips(PROBE_PROJECT, timeline)[0] if c["clip_id"] == clip), None)
        report["from_after"] = after
        if after is None or abs(after - (before + 0.1)) > 1e-4:
            raise Refused("verify", f"the trim was accepted but the clip's from is {after}, not {before + 0.1}", "not_applied")
    except Refused as e:
        return {**report, **e.answer}
    return {**report, "ok": True, "stage": "done", "error": None, "message": "editable in Astrid: an import, a trim, a commit and the trim read back"}


# ---- the Book, its production and its archive, as Snap says them -----------------------------------------------------
def the_book(snap, ref):
    book = snap.call("get_book", book=ref)
    production = book["production"]["ref"].split("@")[0]
    return book, production, snap.call("get_production", production=production)


def entry_of(snap, production, book):
    at = snap.receipt()["productions"].get(production) or {}
    return at, (at.get("books") or {}).get(book)


def read_archive(path):
    """the archive's clips by cut: {cut: {picture, dialogue?, picture_media, dialogue_media}}, in timeline order"""
    with zipfile.ZipFile(path) as z:
        parent = json.loads(z.read("timeline.json"))["parent"]
    assets, cuts = parent["registry"]["assets"], {}
    for c in sorted(parent["clips"], key=lambda c: (c["at"], c["track"])):
        snapped = c.get("generation", {}).get("snap", {})
        if c["track"] == "V1":
            cuts.setdefault(snapped["cut"], {})["picture"] = c
        elif snapped.get("audio_of"):
            cuts.setdefault(snapped["audio_of"], {})["dialogue"] = c
    for row in cuts.values():
        for part in ("picture", "dialogue"):
            if part in row:
                row[f"{part}_media"] = assets[row[part]["asset"]]["media_id"]
    return parent, cuts


def media_file(archive, media_id, into):
    """one media entry of the archive as a file of its own (a swap imports it into the project's catalog)"""
    digest = media_id.removeprefix("sha256:")
    with zipfile.ZipFile(archive) as z:
        kind = next(m["media_type"] for m in json.loads(z.read("manifest.json"))["media"] if m["sha256"] == digest)
        path = os.path.join(into, f"{digest}.{'wav' if 'wav' in kind else 'mp4'}")
        with open(path, "wb") as f:
            f.write(z.read(f"media/{digest}"))
    return path


def export(snap, book):
    """the Cut written by Snap (export_cut without the mp4), its probe said (SNAP-R215)"""
    out = snap.call("export_cut", book=book, mp4=False)["otio"]["astrid"]
    if out.get("probe", {}).get("ok") is False:
        raise Refused("probe", f"Astrid can't edit the archive Snap wrote, so it wasn't pushed: {json.dumps(out['probe'])}", "not_editable", probe=out["probe"])
    return out["archive"]


def length(c):
    return round(float(c["to"]) - float(c["from"]), 3)


# ---- cut / swap -----------------------------------------------------------------------------------------------------
def push_cut(a, snap, astrid, only=None):
    """import the Book's Cut once, then swap in place what changed (`only`: just that cut, whatever else moved)"""
    book, production, prod = the_book(snap, a.book)
    bref, slug = book["book"].split("@")[0], prod["astrid"]["project"]["slug"]
    at, entry = entry_of(snap, production, bref)
    archive = a.archive or export(snap, bref)
    parent, cuts = read_archive(archive)
    units = {u["cut"]: u for u in book["units"] if u.get("cut")}
    project = astrid.project(slug, prod["name"], {"production": production})
    linked = {"project_id": project["project_id"], "slug": project["slug"], "name": project["name"]}
    row_of = lambda cut: {"take": units.get(cut, {}).get("active"), "trim": units.get(cut, {}).get("trim") or {}, "media": cuts[cut]["picture_media"], "from": cuts[cut]["picture"]["from"], "to": cuts[cut]["picture"]["to"],
                          "volume": cuts[cut]["picture"].get("volume", 1), **({"dialogue_media": cuts[cut]["dialogue_media"]} if "dialogue" in cuts[cut] else {})}
    if entry and not a.new_timeline:
        pushed = [c for c in entry.get("order", []) if c in entry["clips"]]
        changed = [c for c in cuts if c in entry["clips"] and any(entry["clips"][c].get(k) != row_of(c).get(k) for k in ("take", "media", "from", "to", "volume", "dialogue_media", "trim"))]
        if only:
            if only not in cuts or only not in entry["clips"]:
                raise Refused("swap", f"{only} isn't a cut of {book['name']} in Astrid (in Astrid: {', '.join(pushed) or 'none'}; in the Cut now: {', '.join(cuts)})", "no_cut")
            changed = [only]
        retimed = [c for c in changed if abs(length(cuts[c]["picture"]) - (entry["clips"][c]["to"] - entry["clips"][c]["from"])) > 0.001 or ("dialogue" in cuts[c]) != ("dialogue_media" in entry["clips"][c])]
        if not only and (list(cuts) != pushed or retimed):
            added, removed = [c for c in cuts if c not in entry["clips"]], [c for c in pushed if c not in cuts]
            said = "; ".join(filter(None, [added and f"added {', '.join(added)}", removed and f"removed {', '.join(removed)}", list(cuts) != pushed and not added and not removed and "the order moved", retimed and f"{', '.join(retimed)} changed length or gained or lost its line"]))
            raise Refused("shape", f"The Cut's shape changed ({said}): a cut can't be swapped into a different slot, so nothing was pushed. Push with --new-timeline (the Cut lens's button) to make a new timeline in {linked['name']} and keep \"{entry['timeline']['name']}\" as it is.", "shape_changed", added=added, removed=removed, retimed=retimed)
        if only and only in retimed:
            raise Refused("swap", f"{only} is {length(cuts[only]['picture'])} s now and {round(entry['clips'][only]['to'] - entry['clips'][only]['from'], 3)} s in Astrid (or gained or lost its line): a swap keeps the slot, so trim it to the same length, or push the whole Cut as a new timeline", "retimed")
        return swap(a, snap, astrid, archive, production, bref, entry, cuts, changed, linked, row_of)
    timeline_name = book["name"] if not entry else f"{book['name']} · Cut {len(entry.get('timelines_before', [])) + 2}"
    data = astrid.run("timelines", "import", archive, "--project", linked["slug"], "--name", timeline_name, stage="import")
    clips, head = astrid.clips(linked["slug"], data["timeline_id"])
    ids = {c["clip_id"] for c in clips}
    rows = {cut: {"clip": cut, **row_of(cut), "archive": archive, **({"dialogue": f"{cut}-dialogue"} if "dialogue" in cuts[cut] else {})} for cut in cuts if cut in ids}
    before = (entry.get("timelines_before", []) + [entry["timeline"]]) if entry else []
    left_out = [{"cut": u["cut"], "why": "its take stays out of Astrid (kept private, or a still)" if u.get("active") else "no active take"} for u in book["units"] if u.get("cut") and u["cut"] not in cuts]
    snap.link(production=production, project=linked, book=bref, set={"timeline": {"timeline_id": data["timeline_id"], "name": timeline_name}, "head": head, "order": list(cuts), "pushed_at": int(time.time() * 1000),
                                                                      "by": a.by, "archive": archive, "left_out": left_out, "timelines_before": before, "clips": rows})
    gaps = f"; gaps: {', '.join(x['cut'] for x in left_out)}" if left_out else ""
    return {"ok": True, "did": "imported", "project": linked, "timeline": {"timeline_id": data["timeline_id"], "name": timeline_name}, "head": head, "clips": sorted(ids), "left_out": left_out,
            **({"kept": before} if before else {}), "said": f"In Astrid: {linked['name']} › {timeline_name} ({len(cuts)} cuts{gaps})"}


def swap(a, snap, astrid, archive, production, book, entry, cuts, changed, linked, row_of):
    """each changed cut replaced in place: the clip keeps its id (the cut id), its media becomes the new take's file and
    its label, generation.snap (the new take), app.astrid (the new words) and volume become what Snap's archive wrote"""
    timeline = entry["timeline"]["timeline_id"]
    if not changed:
        _, head = astrid.clips(linked["slug"], timeline)
        snap.link(production=production, project=linked, book=book, set={"head": head})
        return {"ok": True, "did": "nothing", "project": linked, "timeline": entry["timeline"], "head": head, "said": f"In Astrid: {linked['name']} › {entry['timeline']['name']}: in sync, nothing to swap"}
    done, rows = {}, {}
    with tempfile.TemporaryDirectory(prefix="astrid-push-") as into:
        for cut in changed:
            was, new = entry["clips"][cut], cuts[cut]
            reps = [{"clip": was["clip"], "row": new["picture"], "file": media_file(archive, new["picture_media"], into), "old_file": media_file(was["archive"], was["media"], into)}]
            if "dialogue" in new:
                reps.append({"clip": was["dialogue"], "row": new["dialogue"], "file": media_file(archive, new["dialogue_media"], into), "old_file": media_file(was["archive"], was["dialogue_media"], into)})
            out = astrid.python("_swap", linked["slug"], timeline, "--key", f"snap-swap-{uuid.uuid4().hex[:16]}", *(["--expected-head", a.expected_head] if a.expected_head else []), stdin=reps)
            if not out.get("ok"):
                raise Refused("swap", f"Astrid refused the swap of {cut}: {json.dumps(out)}", out.get("error") or "swap_refused", swapped=done)
            done[cut] = out["changed"]
            rows[cut] = {**row_of(cut), "clip": was["clip"], **({"dialogue": was["dialogue"]} if "dialogue" in new else {}), "archive": archive, "swapped_at": int(time.time() * 1000), "by": a.by}
    _, head = astrid.clips(linked["slug"], timeline)
    snap.link(production=production, project=linked, book=book, set={"head": head, "pushed_at": int(time.time() * 1000), "by": a.by}, clips=rows)
    return {"ok": True, "did": "swapped", "project": linked, "timeline": entry["timeline"], "head": head, "swapped": done,
            "said": f"In Astrid: {linked['name']} › {entry['timeline']['name']}: {', '.join(changed)} swapped in place (same clip ids, the new takes' files and generation.snap)"}


SWAPPED_FIELDS = ("label", "generation", "app", "volume", "from", "to", "hold")


def swap_sdk(project, timeline, key, expected):
    """runs under Astrid's own interpreter: each {clip, row, file, old_file} on stdin keeps its clip id and slot; its
    media is swapped in place (clip.swap-media, both files admitted to the project's catalog so the Runtime can verify
    them) and its authored fields set to the new row's (doc.patch), all in one atomic commit. No clip is deleted: a
    delete is refused in any timeline whose clips carry words (F-AE02), and an id can't be reused (lab check A5)"""
    # imported here: only Astrid's interpreter has these (the launcher runs this file there)
    from astrid.sdk import AstridClient
    from astrid.sdk.timeline._command_state import State
    from astrid.sdk.timeline.media_add import _selection
    from astrid.sdk.timeline.native_occurrence_media_commands import capture_parent_swap_media
    from astrid.sdk.timeline.sync import TimelineSession
    reps = json.load(sys.stdin)
    session = TimelineSession.open(project, timeline, client=AstridClient.open_from_launcher(start_pack_host=False))
    with session.outbox.locked():
        state = session._state()
    base = state["base"]["revision_id"]
    if expected and base != expected:
        return {"ok": False, "error": "stale_head", "expected": expected, "current": base, "message": "the timeline moved since that head was read: read it again (the receipt or timelines show) and decide with what is there now"}
    bundle, commands, verified, changes, changed = session._bundle(state), [], [], [], {}
    for r in reps:
        old = State(bundle).entity(f"parent/clip:{r['clip']}")
        was, wv = _selection(session, bundle, r["old_file"])
        now, nv = _selection(session, bundle, r["file"])
        if was["object_id"] != now["object_id"]:
            commands.append(capture_parent_swap_media(bundle, f"parent/clip:{r['clip']}", was, now, verified_media=[wv, nv]))
            verified += [wv, nv]
        row = {**r["row"], "hold": round(float(r["row"]["to"]) - float(r["row"]["from"]), 6)}
        moved = [k for k in SWAPPED_FIELDS if old.get(k) != row.get(k)]
        for k in moved:
            path = ["clips", f"id:{r['clip']}", k]
            before = {"state": "present", "value": old[k]} if k in old else {"state": "absent"}
            changes.append({"op": "set", "ref": "parent", "path": path, "before": before, "value": row[k]} if k in row else {"op": "remove", "ref": "parent", "path": path, "before": before})
        changed[r["clip"]] = {"media": now["object_id"], "fields": moved}
    if changes:
        commands.append({"schema_version": 1, "op": "doc.patch", "version": "1", "select": None, "args": {"changes": changes}})
    result = session.commit_many(commands, idempotency_key=key, via="python", verified_media=verified, label=f"Snap re-take: {', '.join(r['clip'] for r in reps)}")
    data = getattr(result, "data", result)
    data = data if isinstance(data, dict) else {}
    ok = bool(getattr(result, "ok", True)) and data.get("status") == "accepted"
    return {"ok": ok, "base": base, "status": data.get("status"), "accepted_revision_id": data.get("accepted_revision_id"), "changed": changed,
            **({} if ok else {"error": str(getattr(result, "error", "") or data.get("status") or "not accepted")})}


# ---- context: references, documents, the style section -----------------------------------------------------------------
def front_of(body):
    refs = body.get("refs") or []
    pick = next((r for r in refs if "front" in (r.get("role") or "")), refs[0] if refs else None)
    return pick["file"] if pick else None


def context(a, snap, astrid):
    book, production, prod = the_book(snap, a.book)
    bref, bid, slug = book["book"].split("@")[0], book["book"].split(":")[1].split("@")[0], prod["astrid"]["project"]["slug"]
    at, entry = entry_of(snap, production, bref)
    project = astrid.project(slug, prod["name"], {"production": production})
    linked = {"project_id": project["project_id"], "slug": project["slug"], "name": project["name"]}
    inputs = snap.request("/mainodes/snap/info")[1]["input"]
    # SNAP-R221: the versions the Cut used come from each active take's own pins, never from the records' heads
    pins = {}
    for u in book["units"]:
        if u.get("active"):
            for w in snap.call("get_take", take=u["active"]).get("world") or []:
                if w["ref"].split(":")[0] in ("cast", "location") and w.get("n"):
                    pins.setdefault(w["ref"], set()).add(w["n"])
    refs = list(dict.fromkeys([*prod.get("cast", []), *book.get("cast", []), *[c for u in book["units"] for c in u.get("cast") or []], *prod.get("locations", []), *book.get("locations", []),
                               *[u["location"] for u in book["units"] if u.get("location")], *pins]))
    existing = astrid.run("media", "references", "list", "--project", slug, stage="references")
    rows, more = (existing[0], existing[1]) if isinstance(existing, list) else (existing, None)
    by_record = {(r.get("metadata") or {}).get("snap", {}).get("record"): r for r in rows}
    imported, out, skipped = {}, {}, []

    def media(rel):
        path = os.path.join(inputs, rel)
        if rel not in imported:
            imported[rel] = astrid.run("media", "import", path, "--project", slug, stage="references")["object_id"]
        return imported[rel]

    for ref in refs:
        record = snap.call("get_record", ref=ref)
        body, kind = record["body"], ref.split(":")[0]
        picture = front_of(body) if kind == "cast" else (body.get("master") or {}).get("file") or next((p["file"] for p in body.get("plates") or [] if p.get("file")), None)
        if not picture:
            skipped.append({"ref": ref, "name": body.get("name"), "why": "no picture to stand for it (an Astrid reference needs one)"})
            continue
        meta = {"snap": {"record": ref, "version": record["head"]}}
        description = body.get("details") or body.get("description") or ""
        found = by_record.get(ref)
        if not found:
            found = astrid.run("media", "references", "create", "--project", slug, "--kind", "character" if kind == "cast" else "place", "--name", body["name"], "--media", media(picture),
                               "--description", description, "--metadata", json.dumps(meta), stage="references")
        elif found.get("metadata") != meta or found.get("description") != description:
            found = astrid.run("media", "references", "update", found["reference_id"], "--project", slug, "--description", description, "--metadata", json.dumps(meta), stage="references")
        held = {(m["media_id"], (m.get("metadata") or {}).get("snap", {}).get("version"), (m.get("metadata") or {}).get("snap", {}).get("role")) for m in found.get("media_references") or []}
        versions = sorted(pins.get(ref, set()))
        for n in versions:  # every version the Cut's takes ran on, as `depicts` with its version
            pinned = snap.call("get_record", ref=f"{ref}@{n}")["body"] if n != record["head"] else body
            p = front_of(pinned) if kind == "cast" else (pinned.get("master") or {}).get("file")
            if p and (media(p), n, None) not in held:
                astrid.run("media", "references", "associate", found["reference_id"], "--project", slug, "--media", media(p), "--role", "depicts", "--metadata", json.dumps({"snap": {"version": n}}), stage="references")
        voice = (body.get("voice") or {}).get("file") if kind == "cast" else None
        if voice and (media(voice), record["head"], "voice") not in held:  # Astrid has no voice role yet (ledger Q-L6): the role rides in metadata
            astrid.run("media", "references", "associate", found["reference_id"], "--project", slug, "--media", media(voice), "--role", "inspired_by", "--metadata", json.dumps({"snap": {"role": "voice", "version": record["head"]}}), stage="references")
        out[ref] = {"reference_id": found["reference_id"], "name": body["name"], "version": record["head"], "pinned": versions}
    docs = documents(a, snap, astrid, slug, book, bid, prod, at)
    style = style_section(astrid, slug, book, bid)
    snap.link(production=production, project=linked, references={**(at.get("references") or {}), **out}, documents={**(at.get("documents") or {}), **docs}, style={**(at.get("style") or {}), bid: style})
    return {"ok": True, "did": "context", "project": linked, "references": out, "documents": docs, "style": style, **({"skipped": skipped} if skipped else {}),
            "links": "none: Snap has no clothing, sub-place or prop records with pictures yet, so there is nothing to link (wears, located_in, belongs_to)",
            **({"more_references": f"Astrid's reference list has more rows than one page ({more}); its CLI takes no cursor, so references past the first page weren't matched"} if more else {}),
            "said": f"In Astrid: {linked['name']}: {len(out)} reference{'s' if len(out) != 1 else ''}, {len(docs)} documents, the style section {style['state']}"}


def documents(a, snap, astrid, slug, book, bid, prod, at):
    """the Book's documents by stable id, and the production's snap.production. Astrid's document ids are unique in the
    whole realm, not per project (a second project's create fails "internal runtime error", F-AE04), so each id names
    the project and the Book: snap.story.<project>.<book>"""
    story, style = book.get("story") or {}, book.get("style") or {}
    group = {b: g.get("name") for g in story.get("groups") or [] for b in g.get("beats") or []}
    receipt_books = (snap.receipt()["productions"].get(prod["production"]) or {}).get("books") or {}
    wanted = {
        f"snap.story.{slug}.{bid}": ("snap.story", "markdown", snap.call("export_fountain", book=book["book"])["text"]),
        f"snap.beat-sheet.{slug}.{bid}": ("snap.beat-sheet", "json", json.dumps({"book": book["book"], "story": story.get("ref"), "groups": story.get("groups") or [],
                                                                         "beats": [{**{k: b.get(k) for k in ("id", "order", "told", "text", "intent", "intensity", "time", "lines", "changes") if b.get(k) is not None}, "group": group.get(b["id"])} for b in story.get("beats") or []]}, indent=1, ensure_ascii=False)),
        f"snap.style.{slug}.{bid}": ("snap.style", "markdown", style_words(style) if style else "No production style yet.\n"),
        f"snap.voices.{slug}.{bid}": ("snap.voices", "json", json.dumps([{"cast": c, "name": v["name"], "casting": v["casting"]} for c, v in voices(snap, book).items()], indent=1, ensure_ascii=False)),
        f"snap.production.{slug}": ("snap.production", "json", json.dumps({"production": prod["production"], "name": prod["name"], "books": [{"book": b["book"], "name": b.get("name"), "timeline": ((receipt_books.get(b["book"]) or {}).get("timeline") or {}).get("timeline_id")} for b in prod["books"]]}, indent=1, ensure_ascii=False)),
    }
    out = {}
    with tempfile.TemporaryDirectory(prefix="astrid-push-") as into:
        for doc, (kind, form, text) in wanted.items():
            path = os.path.join(into, f"{doc}.{'md' if form == 'markdown' else 'json'}")
            try:
                now = astrid.run("documents", "show", doc, "--project", slug, stage="documents")
            except Refused:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(text)
                now = astrid.run("documents", "create", "--project", slug, "--kind", kind, "--file", path, "--format", form, "--document-id", doc, stage="documents")
                out[doc] = {"kind": kind, "version": now["version"], "made": True}
                continue
            if (now.get("content") if isinstance(now.get("content"), str) else json.dumps(now.get("content"), indent=1, ensure_ascii=False)) == text:
                out[doc] = {"kind": kind, "version": now["version"], "made": False}
                continue
            astrid.run("documents", "checkout", doc, "--project", slug, "--file", path, stage="documents")
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            out[doc] = {"kind": kind, "version": astrid.run("documents", "checkin", path, stage="documents")["version"], "made": True}
    return out


def voices(snap, book):
    out = {}
    for ref in dict.fromkeys(c for u in book["units"] for c in u.get("cast") or []):
        body = snap.call("get_record", ref=ref)["body"]
        if (body.get("voice") or {}).get("casting"):
            out[ref] = {"name": body["name"], "casting": body["voice"]["casting"]}
    return out


def style_words(style):
    """the production style as words only (SNAP-R226): never its still, LoRA or source"""
    said = {"paragraph": "Style", "palette": "Palette", "voice": "Voice direction", "sound": "Sound palette", "genre": "Genre notes"}
    return f"## Production style: {style.get('name')} ({style.get('ref')})\n\n" + "\n\n".join(f"**{said[k]}:** {style[k]}" for k in STYLE_WORDS if style.get(k)) + "\n"


def style_section(astrid, slug, book, bid):
    """SNAP-R226: the Book's marked section in the project preferences, written while its setting is on and removed when
    it is off; the person's own text outside it is kept as it is"""
    on, style = bool((book.get("to_astrid") or {}).get("share_style")), book.get("style")
    with tempfile.TemporaryDirectory(prefix="astrid-push-") as into:
        path = os.path.join(into, "preferences.md")
        astrid.run("preferences", "checkout", "--project", slug, "--scope", "project", "--file", path, stage="style")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        mark = re.compile(rf"\n?<!-- snap:style book:{re.escape(bid)} [^>]*-->.*?<!-- /snap:style -->\n?", re.S)
        block = f"<!-- snap:style book:{bid} {style['ref']} -->\n{style_words(style)}<!-- /snap:style -->\n" if on and style else ""
        new = mark.sub("\n" + block if block else "\n", text, count=1) if mark.search(text) else (text.rstrip("\n") + ("\n\n" if text.strip() else "") + block if block else text)
        if new == text:
            return {"state": "unchanged (on)" if block else "not there (off)", "on": on}
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        version = astrid.run("preferences", "checkin", path, stage="style")["version"]
    return {"state": "written" if block else "removed", "on": on, "version": version, **({"look": style["ref"]} if block else {})}


# ---- render, proposal note -----------------------------------------------------------------------------------------------
def render(a, snap, astrid):
    book, production, prod = the_book(snap, a.book)
    _, entry = entry_of(snap, production, book["book"].split("@")[0])
    if not entry:
        raise Refused("render", f"{book['name']} isn't in Astrid yet: push it first", "not_linked")
    slug = prod["astrid"]["project"]["slug"]
    data = astrid.run("timelines", "render", entry["timeline"]["timeline_id"], "--project", slug, "--idempotency-key", f"snap-render-{uuid.uuid4().hex[:16]}",
                      "--audio-target", "-16", "--true-peak", "-1", "--timeout-seconds", "1800", stage="render")
    return {"ok": True, "did": "render", "timeline": entry["timeline"], "render": data, "said": "rendered by Astrid, mastered to -16 LUFS / -1 dBTP"}


def proposal_note(a, snap, astrid):
    book, production, prod = the_book(snap, a.book)
    slug, room = prod["astrid"]["project"]["slug"], f"{snap.base}/?room"
    doc = f"snap.proposals.{slug}"  # document ids are realm-wide (F-AE04)
    rows = [{"id": p["id"], "what": p.get("reason") or p["tool"], "tool": p["tool"], "status": p["status"], **({k: p[k] for k in ("base", "stale", "either_or", "by", "driven_by") if p.get(k)}), "link": room} for p in snap.call("list_proposals")]
    with tempfile.TemporaryDirectory(prefix="astrid-push-") as into:
        path = os.path.join(into, "snap.proposals.json")
        text = json.dumps({"book": book["book"], "room": room, "proposals": rows}, indent=1, ensure_ascii=False)
        try:
            astrid.run("documents", "show", doc, "--project", slug, stage="documents")
            astrid.run("documents", "checkout", doc, "--project", slug, "--file", path, stage="documents")
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            version = astrid.run("documents", "checkin", path, stage="documents")["version"]
        except Refused:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            version = astrid.run("documents", "create", "--project", slug, "--kind", "snap.proposals", "--file", path, "--format", "json", "--document-id", doc, stage="documents")["version"]
    return {"ok": True, "did": "proposal-note", "document": doc, "version": version, "proposals": len(rows), "said": f"{doc} v{version}: {len(rows)} proposals, each with the Room's link ({room})"}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("push", "cut", "swap", "context", "render", "proposal-note", "probe", "_swap"):
        p = sub.add_parser(name)
        p.add_argument("--launcher")
        if name == "probe":
            p.add_argument("archive")
            p.add_argument("--name", default="Snap archive")
        elif name == "_swap":
            p.add_argument("project")
            p.add_argument("timeline")
            p.add_argument("--key", required=True)
            p.add_argument("--expected-head")
        else:
            p.add_argument("--book", required=True)
            p.add_argument("--archive")
            p.add_argument("--page")
            p.add_argument("--user")
            p.add_argument("--by", default=f"agent:{os.environ.get('SNAP_AGENT') or 'astrid-push'}")
            p.add_argument("--new-timeline", action="store_true")
            p.add_argument("--cut")
            p.add_argument("--expected-head")
    a = parser.parse_args()
    if a.command == "_swap":
        out = swap_sdk(a.project, a.timeline, a.key, a.expected_head)
        print(json.dumps(out, default=str))
        sys.exit(0 if out.get("ok") else 1)
    try:
        if a.command == "probe":
            if os.environ.get("SNAP_BASE"):
                loopback(os.environ["SNAP_BASE"], "SNAP_BASE")
            out = probe(Astrid(a.launcher), os.path.abspath(a.archive), a.name)
        else:
            snap = Snap(os.environ.get("SNAP_BASE") or "", os.environ.get("SNAP_AGENT") or "astrid-push", a.page, a.user)
            setup = snap.receipt()["setup"]
            if not a.launcher and "said" in setup:
                raise Refused("setup", setup["said"], "no_launcher")
            if setup.get("data_root") and not os.environ.get("ASTRID_RUNTIME_DATA_ROOT"):
                os.environ["ASTRID_RUNTIME_DATA_ROOT"] = setup["data_root"]
            astrid = Astrid(a.launcher or setup["launcher"])
            if a.command == "swap" and not a.cut:
                raise Refused("swap", "swap names the cut to swap: --cut C10", "no_cut")
            if a.command == "push":
                cut = push_cut(a, snap, astrid)
                out = {**cut, "context": context(a, snap, astrid)}
                out["said"] = f"{cut['said']}; {out['context']['said']}"
            else:
                out = {"cut": lambda: push_cut(a, snap, astrid), "swap": lambda: push_cut(a, snap, astrid, only=a.cut), "context": lambda: context(a, snap, astrid),
                       "render": lambda: render(a, snap, astrid), "proposal-note": lambda: proposal_note(a, snap, astrid)}[a.command]()
    except Refused as e:
        out = e.answer
    print(json.dumps(out, ensure_ascii=False, default=str))
    sys.exit(0 if out.get("ok") else 1)


if __name__ == "__main__":
    main()
