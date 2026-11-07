"""Snap's half of the Snap <-> Astrid protocol (PROTOCOL_V1_1), outside ComfyUI: it runs Astrid's own CLI through the
launcher the person named (Settings > MAINodes > Snap > Astrid), so nothing of Astrid enters ComfyUI's Python, and it
reaches Snap through the bridge on loopback like any agent (Snap's tool table is the API, SNAP-R19).

usage: python3 -I astrid_push.py probe ARCHIVE --launcher PATH
  probe: is this archive editable in Astrid? Import it into the scratch project `snap-probe`, trim one clip by 0.1 s,
         commit, and read the trim back (the lab's probe_editable.py, one JSON line). Nothing is deleted.
Every Astrid call passes --project; nothing but this machine is ever reached: SNAP_BASE and the Runtime's endpoint (its
discovery file) must be loopback, else nothing is run. Answers are one JSON object, whole.
SNAP-R215 every archive is probed before the answer · SNAP-R18 local only · see docs/snap/SNAP_RULES.md
"""
import argparse
import json
import os
import subprocess
import sys
import uuid
from urllib.parse import urlsplit

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
PROBE_PROJECT = "snap-probe"


class Refused(Exception):
    """A step that can't go on: its answer is {ok: false, stage, error, message}."""
    def __init__(self, stage, message, error=None, **more):
        super().__init__(message)
        self.answer = {"ok": False, "stage": stage, "error": error or stage, "message": message, **more}


def loopback(url, what):
    host = urlsplit(url).hostname
    if host not in LOOPBACK:
        raise Refused("loopback", f"{what} is {url}, which isn't this machine: nothing was run (SNAP-R18)", "not_loopback")


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

    def project(self, slug, name, settings=None):
        """the project by slug, made when missing"""
        try:
            return self.run("projects", "show", slug, stage="project")
        except Refused:
            return self.run("projects", "create", slug, "--name", name, *(["--settings", json.dumps(settings)] if settings else []), stage="project")

    def clips(self, project, timeline):
        """every clip of the timeline's published head (paged through, never cut short) and the head's revision"""
        data = self.run("timelines", "show", timeline, "--project", project, "--limit", "100", stage="show")
        clips = list(data["clips"])
        while data["pagination"].get("next_cursor"):
            data = self.run("timelines", "show", timeline, "--project", project, "--limit", "100", "--cursor", data["pagination"]["next_cursor"], stage="show")
            clips += data["clips"]
        return clips, data["summary"]["head_revision_id"]


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


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("probe")
    p.add_argument("archive")
    p.add_argument("--launcher", required=True)
    p.add_argument("--name", default="Snap archive")
    a = parser.parse_args()
    try:
        if os.environ.get("SNAP_BASE"):
            loopback(os.environ["SNAP_BASE"], "SNAP_BASE")
        out = probe(Astrid(a.launcher), os.path.abspath(a.archive), a.name)
    except Refused as e:
        out = e.answer
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0 if out.get("ok") else 1)


if __name__ == "__main__":
    main()
