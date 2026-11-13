"""The Book's assembly (U97, SNAP-R131 the animatic, SNAP-R132 the Cut): one node that lays clips end to end with ffmpeg,
and a route that writes the Cut as OpenTimelineIO.

MAISnapCut takes the clips in order (Load Video of a take, or Create Video of a board still) and a plan, one entry per
clip: a take's {in_s, out_s, gain_db} (a trim and its sound level) or a board's {hold_s} (the still held that long). Every
clip is scaled and padded to one size and frame rate, sound resampled to 48 kHz stereo (H3 renders 32 kHz, Make it
louder 48 kHz: short04 F-A23) and a clip without sound gets silence, so the concat never drifts. It runs inside a
prompt, so a take kept encrypted is opened in memory by its loader, worked on in RAM scratch (SNAP-R98) and saved by
the prompt's own saver like any other output (privacy fails closed: the vault's on_prompt gate sees the prompt).

POST /mainodes/snap/book/otio writes the Cut's timeline (one video and one audio track of the active takes as source
ranges, a marker at each cut, metadata.snap with each take and the Book version) beside the outputs, as JSON an NLE
opens (OTIO's Timeline.1 / Clip.1 schema, no opentimelineio package needed), and the same Cut as an Astrid timeline
archive (SNAP-R212): `<name>.astrid`, a zip with every entry stored: manifest.json (format astrid.timeline/1, the media
by sha256), timeline.json (the authoring bundle: parent {name, config, clips, registry.assets}) and media/<sha256> for
each take's file, plus the bundle and an asset list beside it to read. Nothing is sent anywhere; the answer names the
`astrid timelines import` command. A take kept private (sealed by the vault, or marked by the page) is left out: its
bytes never enter the archive and its cut stays a gap.
SNAP-R131 the animatic · SNAP-R132 the Cut · SNAP-R98 RAM scratch for sealed takes · SNAP-R212 the Cut opens in Astrid,
private takes stay out (fails closed) · SNAP-R18 local only · SNAP-R233 each clip's dial rows in the take's seconds ·
see docs/snap/SNAP_RULES.md
"""
import asyncio
import contextlib
import hashlib
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from io import BytesIO

import folder_paths
from aiohttp import web
from comfy_api.latest import InputImpl, io
from server import PromptServer

from . import snap_astrid

NICE = ["nice", "-n", "10"] if os.name != "nt" and shutil.which("nice") else []  # low priority where `nice` exists (not Windows)

try:
    from . import snap_vault_server
except ImportError:  # no `cryptography`: private takes are refused upstream, so none reaches here sealed
    snap_vault_server = None

routes = PromptServer.instance.routes


def probe(path):
    """(duration in seconds, has sound) of a media file."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)], capture_output=True, text=True, timeout=60, check=True)
    info = json.loads(r.stdout)
    return float(info.get("format", {}).get("duration") or 0), any(s.get("codec_type") == "audio" for s in info.get("streams", []))


def graph(entries, width, height, fps):
    """The ffmpeg filter graph for clips [(plan entry, duration, has sound)] -> ([v][a] concat, total seconds)."""
    parts, pairs, total = [], [], 0.0
    frame = f"fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"
    for i, (e, length, sound) in enumerate(entries):
        if "hold_s" in e:
            dur = float(e["hold_s"])
            parts.append(f"[{i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,{frame},tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur}[v{i}]")
            parts.append(f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={dur}[a{i}]")
        else:
            start = max(0.0, float(e.get("in_s") or 0))
            end = min(length, float(e["out_s"])) if e.get("out_s") is not None else length
            dur = end - start
            if dur <= 0:
                raise ValueError(f"{e.get('name', f'clip {i + 1}')}: trimmed to nothing (in {start} s, out {end} s of {length:.2f} s)")
            parts.append(f"[{i}:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,{frame}[v{i}]")
            if sound:
                parts.append(f"[{i}:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={float(e.get('gain_db') or 0)}dB,apad,atrim=duration={dur}[a{i}]")
            else:
                parts.append(f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={dur}[a{i}]")
        pairs.append(f"[v{i}][a{i}]")
        total += dur
    parts.append(f"{''.join(pairs)}concat=n={len(entries)}:v=1:a=1[v][a]")
    return ";".join(parts), total


class MAISnapCut(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapCut", display_name="Lay clips end to end (Snap Book)", category="MAINodes/snap",
            description="The Book's animatic and Cut: the clips in order, each a take trimmed (in_s, out_s) with its sound "
                        "level (gain_db), or a board still held for hold_s, scaled and padded to one size and frame rate, "
                        "sound at 48 kHz stereo (silence where a clip has none), concatenated into one video.",
            inputs=[
                io.Autogrow.Input("clips", template=io.Autogrow.TemplatePrefix(io.Video.Input("clip"), prefix="clip", min=1, max=100)),
                io.String.Input("plan", multiline=True, tooltip="JSON list, one per clip: {name, in_s, out_s, gain_db} for a take, {name, hold_s} for a still"),
                io.Int.Input("width", default=1280, min=16, max=8192, step=8),
                io.Int.Input("height", default=704, min=16, max=8192, step=8),
                io.Int.Input("fps", default=24, min=1, max=120),
            ],
            outputs=[io.Video.Output()],
        )

    @classmethod
    def execute(cls, clips, plan, width, height, fps) -> io.NodeOutput:
        videos = [clips[k] for k in sorted(clips, key=lambda k: int(re.sub(r"\D", "", k) or 0)) if clips[k] is not None]
        spec = json.loads(plan)
        if len(spec) != len(videos):
            raise ValueError(f"The plan names {len(spec)} clips and {len(videos)} are connected: one plan entry per clip, in order")
        # a take kept encrypted comes in as a file opened in memory (the vault's loader); a board's Create Video has no file yet
        private = any(isinstance(v, InputImpl.VideoFromFile) and isinstance(v.get_stream_source(), BytesIO) for v in videos)
        if private and snap_vault_server is None:
            raise RuntimeError("A clip is kept encrypted and this install can't open the vault: nothing was assembled")
        temp = folder_paths.get_temp_directory()
        with contextlib.ExitStack() as stack:
            def place(name):
                if private:  # SNAP-R98: with a take kept encrypted, every file of the step lives in RAM scratch
                    return stack.enter_context(snap_vault_server.scratch(name))
                p = os.path.join(temp, f"snap_cut_{uuid.uuid4().hex}_{name}")
                stack.callback(lambda: os.path.exists(p) and os.remove(p))
                return p

            paths = []
            for i, v in enumerate(videos):
                src = v.get_stream_source() if isinstance(v, InputImpl.VideoFromFile) else None
                if isinstance(src, str):
                    paths.append(src)
                    continue
                p = place(f"in{i}.mp4")
                if isinstance(src, BytesIO):
                    open(p, "wb").write(src.getbuffer())
                else:
                    v.save_to(str(p))
                paths.append(str(p))
            entries = [(e, *probe(p)) for e, p in zip(spec, paths)]
            filt, total = graph(entries, width, height, fps)
            out = place("cut.mp4")
            cmd = [*NICE, "ffmpeg", "-v", "error", "-y", *[a for p in paths for a in ("-i", p)], "-filter_complex", filt, "-map", "[v]", "-map", "[a]",
                   "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
            if r.returncode:
                raise RuntimeError(f"ffmpeg couldn't lay the clips end to end: {r.stderr.strip()}")
            logging.info(f"[MAINodes] Snap Book: {len(entries)} clips, {total:.2f} s")
            with open(out, "rb") as f:
                return io.NodeOutput(InputImpl.VideoFromFile(BytesIO(f.read())))


def rt(value, rate):
    return {"OTIO_SCHEMA": "RationalTime.1", "rate": float(rate), "value": float(value)}


def tr(start, duration, rate):
    return {"OTIO_SCHEMA": "TimeRange.1", "start_time": rt(start, rate), "duration": rt(duration, rate)}


def dials_in_seconds(snap, length):
    """SNAP-R233: a clip's dial rows (generation.snap.dials) with every key in the take's own seconds, the clock of its
    words: normalized keys times the take's length, and that length as clip_seconds."""
    dials = (snap or {}).get("dials")
    if not dials:
        return snap
    rows = []
    for r in dials["rows"]:
        c = r.get("curve")
        if c and "keys" in c:
            scale = length if c.get("unit") == "normalized" else 1.0
            c = {k: v for k, v in c.items() if k != "unit"} | {"keys": [[round(t * scale, 4), m] for t, m in c["keys"]]}
        rows.append({**r, "curve": c})
    return {**snap, "dials": {**dials, "clip_seconds": round(length, 3), "rows": rows}}


def timeline(name, book, fps, rows):
    """An OTIO Timeline.1 dict: rows [{cut, take, path, in_s, dur_s, length_s, gain_db, private}] in order."""
    def clip(r, kind):
        return {"OTIO_SCHEMA": "Clip.1", "name": r["cut"], "metadata": {"snap": {"take": r.get("take"), "cut": r["cut"], "gain_db": r.get("gain_db", 0), **({"private": True} if r.get("private") else {}),
                                                                                  **({"dials": r["snap"]["dials"]} if (r.get("snap") or {}).get("dials") else {})}},
                "source_range": tr(round(r["in_s"] * fps), round(r["dur_s"] * fps), fps), "effects": [], "markers": [], "enabled": True,
                "media_reference": {"OTIO_SCHEMA": "ExternalReference.1", "name": os.path.basename(r["path"]), "metadata": {}, "target_url": "file://" + r["path"],
                                    "available_range": tr(0, round(r["length_s"] * fps), fps)}}

    def track(kind):
        return {"OTIO_SCHEMA": "Track.1", "name": "V1" if kind == "Video" else "A1", "kind": kind, "metadata": {}, "source_range": None, "effects": [], "markers": [], "enabled": True,
                "children": [clip(r, kind) for r in rows]}
    at, markers = 0, []
    for r in rows:
        markers.append({"OTIO_SCHEMA": "Marker.2", "name": r["cut"], "color": "RED", "comment": r.get("take") or "", "metadata": {"snap": {"cut": r["cut"]}}, "marked_range": tr(at, 0, fps)})
        at += round(r["dur_s"] * fps)
    return {"OTIO_SCHEMA": "Timeline.1", "name": name, "metadata": {"snap": {"book": book}}, "global_start_time": None,
            "tracks": {"OTIO_SCHEMA": "Stack.1", "name": "tracks", "metadata": {}, "source_range": None, "effects": [], "markers": markers, "enabled": True,
                       "children": [track("Video"), track("Audio")]}}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def sound_of(path, out):
    """a take's own sound as a 48 kHz stereo wav (the dialogue lane's file); False when the take has none"""
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", out], capture_output=True, text=True, timeout=600)
    return r.returncode == 0 and os.path.isfile(out) and os.path.getsize(out) > 1000


def astrid(path, name, fps, width, height, rows, scratch):
    """Write the Cut as an Astrid timeline archive at `path` (CONTRACT_SNAP_EXPORT v4, SNAP-R215, R216): one picture clip
    per cut on V1 whose id is the cut id, at its place in the Cut, the take's file once per sha256. A cut with a line
    (its beats' dialogue) is split: the picture plays at volume 0 and the take's own sound (48 kHz, written in `scratch`)
    goes on A2 "Dialogue" labelled "<Speaker>: <line>" with app.astrid {segment, text, words}; gain_db becomes the
    sounding clip's linear volume. No cut idiom, chapters, placements or shots (check A6: they make an import
    uneditable). Private rows add no clip and no bytes; their time stays a gap. Tracks are written overlays first (the
    first track draws on top): V1, A1 (the bed's lane), A2. -> (the authoring bundle, the assets by key, the media rows)"""
    clips, assets, media, at, spoken = [], {}, {}, 0.0, False

    def put(file, key, kind, media_type, length):
        digest = sha256_of(file)
        media.setdefault(digest, {"sha256": digest, "size": os.path.getsize(file), "media_type": media_type, "original_name": os.path.basename(file), "path": file})
        assets[key] = {"media_id": f"sha256:{digest}", "type": kind, "duration": round(length, 3)}

    for r in rows:
        if not r["private"]:
            put(r["path"], r["take"], "video", "video/mp4", r["length_s"])
            lines = r.get("lines") or []
            volume = round(10 ** (float(r.get("gain_db") or 0) / 20), 4)
            wav = os.path.join(scratch, f"{r['take']}-sound.wav")
            spoken_here = bool(lines) and sound_of(r["path"], wav)
            timing = {"at": round(at, 3), "from": round(r["in_s"], 3), "to": round(r["in_s"] + r["dur_s"], 3), "speed": 1}
            snap = {**(r.get("snap") or {"take": r["take"], "cut": r["cut"]}), **({"group": r["group"]} if r.get("group") else {})}
            clips.append({"id": r["cut"], "clipType": "media", "track": "V1", "asset": r["take"], **timing, **({"volume": 0} if spoken_here else {"volume": volume} if volume != 1 else {}),
                          **({"label": r["label"]} if r.get("label") else {}), "generation": {"snap": snap}})
            if spoken_here:
                spoken = True
                put(wav, f"{r['take']}-sound", "audio", "audio/x-wav", r["length_s"])
                said = " / ".join(f"{x['name']}: {x['text']}" for x in lines)
                text = " ".join(x["text"] for x in lines)
                clips.append({"id": f"{r['cut']}-dialogue", "clipType": "media", "track": "A2", "asset": f"{r['take']}-sound", **timing, **({"volume": volume} if volume != 1 else {}), "label": said,
                              "app": {"astrid": {"segment": f"line-{r['cut']}", "text": text, **({"words": r["words"]} if r.get("words") else {})}},
                              "generation": {"snap": {"take": r["take"], "audio_of": r["cut"], "speaker": ", ".join(dict.fromkeys(x["name"] for x in lines)), "line": text,
                                                      **({"voice_reference": r["voice_reference"]} if r.get("voice_reference") else {})}}})
        at += r["dur_s"]
    tracks = [{"id": "V1", "kind": "visual", "label": "Picture"}, {"id": "A1", "kind": "audio", "label": "A1"}, *([{"id": "A2", "kind": "audio", "label": "Dialogue"}] if spoken else [])]
    config = {"clips": clips, "tracks": tracks,
              "output": {"file": f"{os.path.splitext(os.path.basename(path))[0]}.mp4", "fps": fps, "resolution": f"{width}x{height}"},
              "theme_overrides": {"visual": {"canvas": {"fps": fps, "width": width, "height": height}}}}
    bundle = {"schema_version": 1, "parent": {"name": name, "config": config, "clips": clips, "registry": {"assets": assets}}, "placements": [], "shots": {}}
    manifest = {"format": "astrid.timeline/1", "name": name, "elements": [], "transcripts": [], "media": [{k: v for k, v in m.items() if k != "path"} for m in media.values()]}
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:  # Astrid refuses any compressed entry
        z.writestr("manifest.json", json.dumps(manifest, indent=1, ensure_ascii=False))
        z.writestr("timeline.json", json.dumps(bundle, indent=1, ensure_ascii=False))
        for m in media.values():
            z.write(m["path"], f"media/{m['sha256']}")
    return bundle, assets, list(media.values())


def sealed(path):
    return snap_vault_server is not None and snap_vault_server.snap_vault.sealed(path)


@routes.post("/mainodes/snap/book/otio")
async def otio(request):
    q = await request.json()
    fps = float(q.get("fps") or 24)
    name = str(q.get("name") or "the Cut")

    def write():
        rows = []
        for c in q.get("clips", []):
            path = folder_paths.get_annotated_filepath(c["video"])
            if not os.path.isfile(path):
                raise FileNotFoundError(f"{c['cut']}: {c['video']} isn't on this server")
            # the page says a take may be shared; anything else stays out of the archive (fails closed)
            private = "kept private" if sealed(path) or c.get("private") is True else None if c.get("private") is False else "the page didn't say whether it is private (reload a tab older than this server)"
            length = probe(path)[0] if not sealed(path) else float(c.get("out_s") or 0)
            start = float(c.get("in_s") or 0)
            end = min(length, float(c["out_s"])) if c.get("out_s") is not None else length
            rows.append({"cut": c["cut"], "take": c.get("take"), "path": os.path.abspath(path), "in_s": start, "dur_s": max(0.0, end - start), "length_s": length, "gain_db": c.get("gain_db", 0), "private": private,
                         **{k: c.get(k) for k in ("snap", "label", "lines", "words", "voice_reference", "group")}, "snap": dials_in_seconds(c.get("snap"), length)})
        if not rows:
            raise ValueError("The Cut has no clips yet (each unit needs an active take)")
        out_dir = os.path.join(folder_paths.get_output_directory(), "snap_book")
        os.makedirs(out_dir, exist_ok=True)
        stem = f"{re.sub(r'[^A-Za-z0-9._-]+', '_', name).strip('_') or 'cut'}_{time.strftime('%Y%m%d-%H%M%S')}"
        fname = f"{stem}.otio"
        with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
            json.dump(timeline(name, q.get("book"), fps, rows), f, indent=2)
        locked = [r["cut"] for r in rows if r["private"]]
        archive = os.path.join(out_dir, f"{stem}.astrid")
        with tempfile.TemporaryDirectory(prefix="snap_cut_sound_") as scratch:  # the dialogue lane's wavs live only until they are inside the archive
            bundle, assets, media = astrid(archive, name, fps, int(q.get("width") or 1280), int(q.get("height") or 704), rows, scratch)
        with open(os.path.join(out_dir, f"{stem}.timeline.json"), "w", encoding="utf-8") as f:
            json.dump(bundle, f, indent=1, ensure_ascii=False)
        listed = {k: {**v, **({"file": next(r["path"] for r in rows if r["take"] == k)} if v["type"] == "video" else {"sound_of": k.removesuffix("-sound")}), "content_sha256": v["media_id"].removeprefix("sha256:")} for k, v in assets.items()}
        with open(os.path.join(out_dir, f"{stem}.assets.json"), "w", encoding="utf-8") as f:
            json.dump(listed, f, indent=1, ensure_ascii=False)
        left_out = [{"cut": r["cut"], "take": r["take"], "at_s": round(sum(x["dur_s"] for x in rows[:i]), 3), "seconds": round(r["dur_s"], 3), "why": f"{r['private']}: its file never enters the archive; its time stays a gap"} for i, r in enumerate(rows) if r["private"]]
        return {"file": f"snap_book/{fname} [output]", "clips": len(rows), "seconds": round(sum(r["dur_s"] for r in rows), 3),
                **({"note": f"{', '.join(locked)} {'is' if len(locked) == 1 else 'are'} kept private: an editing program can't read {'it' if len(locked) == 1 else 'them'} from this file"} if locked else {}),
                "astrid": {"archive": archive, "timeline": os.path.join(out_dir, f"{stem}.timeline.json"), "assets": os.path.join(out_dir, f"{stem}.assets.json"),
                           "clips": len(bundle["parent"]["clips"]), "media": len(media), "left_out": left_out,
                           "import": f"astrid timelines import {shlex.quote(archive)} --project {shlex.quote(project)} --name {shlex.quote(name)}",
                           "said": f"An Astrid timeline of {len(bundle['parent']['clips'])} clip{'s' if len(bundle['parent']['clips']) != 1 else ''}, {len(media)} file{'s' if len(media) != 1 else ''} inside{f'; left out (private): {chr(44).join(locked)}' if locked else ''}. "
                                   "Each import makes a new timeline in the project: a pushed Book is changed in place by the next push (tools/astrid_push.py), not imported again."}}
    project = str(q.get("project") or "<project>")
    try:
        out = await asyncio.to_thread(write)
    except (FileNotFoundError, ValueError, KeyError) as e:
        return web.json_response({"error": str(e)}, status=400)
    # SNAP-R215: every archive is imported and trimmed in Astrid's scratch project before the answer, when Astrid is here
    at = snap_astrid.where(request)
    if "said" in at:
        out["astrid"]["probe"] = {"ran": False, "said": f"{at['said']}: the archive is written, and nobody has checked it opens editable in Astrid"}
    else:
        _, out["astrid"]["probe"] = await snap_astrid.run(request, "probe", out["astrid"]["archive"], "--name", name)
    return web.json_response(out)


NODE_CLASS_MAPPINGS = {"MAISnapCut": MAISnapCut}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISnapCut": "Lay clips end to end (Snap Book)"}
