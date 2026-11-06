"""U81 (SNAP-R38): Save metadata off writes no metadata from any saver Snap can switch, against the CPU test server
(default :8195). Each prompt is queued the way a Snap page queues it with the switch off (workflow extra.snap_metadata
false), and every file it wrote is read back:
- Save Image and Preview Image: PNGs with no text chunks
- Save Video from frames (CreateVideo): an mp4 with no prompt / workflow / comment tags
- Save Video of a file (LoadVideo, a stream copy): the source take's own tags are not copied over
- LoadVideo -> Make the sound louder -> Save Video (the take's louder version, U76)
- MAI Video Out: no tags and no .meta.json sidecar
- a saver Snap can't switch (Save Animated WEBP) runs, and the run names it in snap_marks.kept
The same video prompt with the switch on keeps prompt and workflow (control). Tiny CPU prompts (64 px, 12 frames).
The page side (the recipes' Run and Snap's own graphs carry the switch) is test_metadata_flows.js.
usage: python3 -I test_metadata_off.py [port] [base dir]"""
import json
import os
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.PORT
BASEDIR = Path(sys.argv[2]) if len(sys.argv) > 2 else C.base()
BASE = f"http://127.0.0.1:{PORT}"


def req(path, body=None):
    r = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def queue(nodes, metadata=False):
    workflow = {"nodes": [], "extra": {} if metadata else {"snap_metadata": False}}
    status, res = req("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": {"extra_pnginfo": {"workflow": workflow}}})
    if status != 200:
        return {"error": res}
    for _ in range(480):
        h = req(f"/history/{res['prompt_id']}")[1].get(res["prompt_id"])
        if h and h.get("status", {}).get("completed") is not None:
            files = [BASEDIR / f["type"] / f["subfolder"] / f["filename"] for out in h["outputs"].values() for lst in out.values() if isinstance(lst, list) for f in lst if isinstance(f, dict) and "filename" in f and f.get("type") in ("output", "temp")]
            return {"status": h["status"]["status_str"], "files": files, "marks": h["prompt"][3].get("snap_marks") or {}}
        time.sleep(0.25)
    raise TimeoutError(res["prompt_id"])


def png_chunks(path):
    data, out, i = path.read_bytes(), [], 8
    while i < len(data):
        n, kind = struct.unpack(">I4s", data[i:i + 8])
        if kind in (b"tEXt", b"iTXt", b"zTXt"):
            out.append(data[i + 8:i + 8 + n].split(b"\0")[0].decode("latin-1"))
        i += 12 + n
    return out


def tags(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", str(path)], capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    return sorted({k.lower() for k in (d.get("format", {}).get("tags") or {})} | {k.lower() for s in d.get("streams", []) for k in (s.get("tags") or {})})


RECIPE = {"prompt", "workflow", "comment"}  # comment: where some muxers put the workflow
frames = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 12, "color": 3355443}},
          "2": {"class_type": "CreateVideo", "inputs": {"images": ["1", 0], "fps": 12}}}
save = lambda src, prefix: {"class_type": "SaveVideo", "inputs": {"video": src, "filename_prefix": f"snaptest/u81_{prefix}", "format": "auto", "format.codec": "auto", "codec": "auto"}}
R = {}
R["image"] = queue({"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
                    "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u81_image"}}, "3": {"class_type": "PreviewImage", "inputs": {"images": ["1", 0]}}})
R["imageChunks"] = [png_chunks(f) for f in R["image"]["files"]]
R["videoOn"] = queue({**frames, "3": save(["2", 0], "on")}, metadata=True)
R["videoOnTags"] = tags(R["videoOn"]["files"][0])
R["video"] = queue({**frames, "3": save(["2", 0], "off")})
R["videoTags"] = tags(R["video"]["files"][0])
# a stream copy of a take that has its recipe inside (the "on" file), as Snap's louder version and any LoadVideo flow do
src = R["videoOn"]["files"][0]
annotated = f"{src.relative_to(BASEDIR / 'output').as_posix()} [output]"
R["copy"] = queue({"1": {"class_type": "LoadVideo", "inputs": {"file": annotated}}, "3": save(["1", 0], "copy")})
R["copyTags"] = tags(R["copy"]["files"][0])
R["louder"] = queue({"1": {"class_type": "LoadVideo", "inputs": {"file": annotated}}, "2": {"class_type": "MAISnapLouder", "inputs": {"video": ["1", 0]}}, "3": save(["2", 0], "louder")})
R["louderTags"] = tags(R["louder"]["files"][0])
R["videoOut"] = queue({"1": frames["1"], "2": {"class_type": "MAIVideoOut", "inputs": {"images": ["1", 0], "fps": 12.0, "filename_prefix": "snaptest/u81_videoout", "codec": "h264", "crf": 23}}})
out = R["videoOut"]["files"][0]
R["videoOutTags"] = tags(out)
R["videoOutMeta"] = sorted(p.name for p in out.parent.glob(out.name.rsplit("_", 1)[0] + "*.meta.json"))
R["anyway"] = queue({"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 2, "color": 0}},
                     "2": {"class_type": "SaveAnimatedWEBP", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u81_webp", "fps": 6.0, "lossless": False, "quality": 80, "method": "default"}}})
for k in ("image", "videoOn", "video", "copy", "louder", "videoOut", "anyway"):
    R[k]["files"] = [str(f) for f in R[k].get("files", [])]

checks = [R["image"].get("status") == "success" and len(R["imageChunks"]) == 2 and R["imageChunks"] == [[], []],
          {"prompt", "workflow"} <= set(R["videoOnTags"]),
          R["video"].get("status") == "success" and not RECIPE & set(R["videoTags"]),
          R["copy"].get("status") == "success" and not RECIPE & set(R["copyTags"]),
          R["louder"].get("status") == "success" and not RECIPE & set(R["louderTags"]),
          R["videoOut"].get("status") == "success" and not RECIPE & set(R["videoOutTags"]) and R["videoOutMeta"] == [] and R["videoOut"]["marks"].get("swapped") == {"2": "MAIVideoOut"},
          R["anyway"].get("status") == "success" and R["anyway"]["marks"].get("kept") == ["node 2 (SaveAnimatedWEBP) writes metadata anyway"]]
R["checks"] = checks
C.out("ui", "test_metadata_off_result.json").write_text(json.dumps(R, indent=1, default=str))
print(f"metaoff  {sum(checks)}/{len(checks)} {'PASS' if all(checks) else 'FAIL ' + str([i for i, x in enumerate(checks) if not x])}")
