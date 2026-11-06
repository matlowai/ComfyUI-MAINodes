"""The metadata switch and private marks on the files (SNAP-R20, U58), against a running CPU ComfyUI with the snap-scout
MAINodes (default :8195). Queues CPU-cheap prompts (64x64 EmptyImage, 4-frame video) that carry a LoRA name in an
unconnected loader, the way a render's LoRA rows sit in its prompt, and reads every saved file back through /view.
Metadata off is what a Snap page with the switch off queues (workflow extra.snap_metadata false):
  metadata off, any prompt (a plain LoRA, an identity LoRA) -> PNG with no text chunks and no LoRA name in its bytes;
  a video -> mp4 with no workflow/prompt tags (ffprobe) and no name in its bytes; a node that writes metadata the gate
  can't switch -> it runs, and the take names it: "writes metadata anyway" (U81, SNAP-R38; refused before U81)
  metadata on (the default) -> PNG keeps ComfyUI's prompt + workflow chunks, a private one too; the same refused node runs
  private marks either way: an identity LoRA (model graph role), a Cast row (any LoRA), and with private.json rules any
  LoRA loader: a LoRA in models/loras that is a symlink into a private path, one whose name matches a private pattern,
  and a private file loaded by its absolute path -> take marked private, reasons name no file
U71 (SNAP-R27): a LoRA whose safetensors header says "privacy": "full" inside a JSON-string field (neutral name and
folder), and a file in a symlinked folder named like a pattern -> take marked private; /mainodes/snap/private_loras lists
exactly the LoRAs the rules match (lock on the rows); /mainodes/snap/take_marks re-checks saved takes with today's rules
(a take saved with no mark that loads the stamped file comes back private), booleans only.
Review fixes: a header trigger listed in private.json `triggers`; a LoRA inside a dict input (rgthree rows) and a
<lora:name:w> tag in text -> private; a private.json with the wrong shape ({"paths": null}) -> the prompt still renders,
marked private with "privacy rules unreadable", and the lock routes answer 200 with every LoRA locked.
Writes a test entry into the server's userdata snap/models.json and snap/private.json, and dummy files into its base
directory (the test server's, never the operator's). Prints one line."""
import json
import os
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.PORT
BASE = f"http://127.0.0.1:{PORT}"
IDENTITY, PLAIN = "snaptest_person_identity_lora.safetensors", "snaptest_plain_style_lora.safetensors"


def req(path, body=None, method=None):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    r = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def png_chunks(data):
    """tEXt / iTXt / zTXt keywords and texts of a PNG."""
    out, i = {}, 8
    while i < len(data):
        n, kind = struct.unpack(">I4s", data[i:i + 8])
        body = data[i + 8:i + 8 + n]
        if kind in (b"tEXt", b"iTXt", b"zTXt"):
            key, _, rest = body.partition(b"\0")
            out[key.decode("latin-1")] = zlib.decompress(rest[1:]).decode() if kind == b"zTXt" else rest.decode("latin-1", "replace")
        i += 12 + n
    return out


def queue(nodes, cast=None, metadata=True):
    workflow = {"nodes": [{"id": int(k), "type": v["class_type"], "widgets_values": [x for x in v["inputs"].values() if not isinstance(x, list)]} for k, v in nodes.items()],
                "extra": {"snap": {"version": 1, "bricks": [{"key": "cast", "nodes": {"loras": cast}}] if cast else [], "bindings": []}, **({} if metadata else {"snap_metadata": False})}}
    status, body = req("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": {"extra_pnginfo": {"workflow": workflow}}})
    res = json.loads(body)
    if status != 200:
        return None, res
    pid = res["prompt_id"]
    for _ in range(240):
        h = json.loads(req(f"/history/{pid}")[1]).get(pid)
        if h and h.get("status", {}).get("completed") is not None:
            return h, None
        time.sleep(0.25)
    raise TimeoutError(pid)


def saved(h):
    files = [f for out in h["outputs"].values() for lst in out.values() if isinstance(lst, list) for f in lst if isinstance(f, dict) and "filename" in f]
    return [req("/view?" + urllib.parse.urlencode({"filename": f["filename"], "subfolder": f.get("subfolder", ""), "type": f.get("type", "output")}))[1] for f in files]


def image(prefix, loader):
    return {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
            "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": f"snaptest/{prefix}"}}, "3": loader}


only = lambda name: {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": name, "strength_model": 1.0}}
stack = lambda name: {"class_type": "LoadLoraModel", "inputs": {"loras": 1, "loras.0.lora_name": name, "loras.0.strength": 1.0, "loras.0.enabled": True}}

status, _ = req("/userdata/snap%2Fmodels.json?overwrite=true", json.dumps([{"file": IDENTITY, "folder": "loras", "kind": "lora", "role": "identity"},
                                                                            {"file": PLAIN, "folder": "loras", "kind": "lora", "role": "style"}]).encode())
R = {"graphWritten": status}

h, _ = queue(image("identity", only(IDENTITY)), metadata=False)
f = saved(h)[0]
R["identity"] = {"chunks": sorted(png_chunks(f)), "nameInBytes": IDENTITY.encode() in f, "marks": h["prompt"][3].get("snap_marks")}

h, _ = queue(image("identity_on", only(IDENTITY)))
f = saved(h)[0]
R["identityOn"] = {"chunks": sorted(png_chunks(f)), "nameInBytes": IDENTITY.encode() in f, "marks": h["prompt"][3].get("snap_marks")}

h, _ = queue(image("plain_off", only(PLAIN)), metadata=False)
f = saved(h)[0]
R["plainOff"] = {"chunks": sorted(png_chunks(f)), "nameInBytes": PLAIN.encode() in f, "marks": h["prompt"][3].get("snap_marks")}

h, _ = queue(image("cast", stack(PLAIN)), cast=3)
f = saved(h)[0]
R["cast"] = {"chunks": sorted(png_chunks(f)), "nameInBytes": PLAIN.encode() in f, "private": (h["prompt"][3].get("snap_marks") or {}).get("private")}

h, _ = queue(image("plain", only(PLAIN)))
f = saved(h)[0]
R["plain"] = {"chunks": sorted(png_chunks(f)), "nameInBytes": PLAIN.encode() in f, "marks": h["prompt"][3].get("snap_marks")}

video = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 4, "color": 0}},
         "4": {"class_type": "CreateVideo", "inputs": {"images": ["1", 0], "fps": 8.0}},
         "2": {"class_type": "SaveVideo", "inputs": {"video": ["4", 0], "filename_prefix": "snaptest/identity_video", "format": "mp4", "format.codec": "h264"}}, "3": only(IDENTITY)}
h, err = queue(video, metadata=False)
if h:
    f = saved(h)[0]
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", "-"], input=f, capture_output=True)
    R["video"] = {"tags": sorted(json.loads(probe.stdout or b"{}").get("format", {}).get("tags", {})), "nameInBytes": IDENTITY.encode() in f, "status": h["status"]["status_str"]}
else:
    R["video"] = {"error": err}

# private.json: a dummy "private" LoRA outside the model folders, reached through a symlink in models/loras; a file whose
# name matches a pattern; the private file by its absolute path. Each through a different loader
argv = json.loads(req("/system_stats")[1])["system"]["argv"]
base = os.path.realpath(argv[argv.index("--base-directory") + 1])
src = os.path.join(base, "_snaptest_private_src")
os.makedirs(src, exist_ok=True)
secret = os.path.join(src, "dummy_character_v1.safetensors")
open(secret, "wb").write(b"not a real lora")
link = os.path.join(base, "models", "loras", "snaptest_linked_lora.safetensors")
if not os.path.islink(link):
    os.symlink(secret, link)
open(os.path.join(base, "models", "loras", "snaptest_zq7k_lora.safetensors"), "wb").write(b"not a real lora")
RULES = json.dumps({"paths": [src], "patterns": ["*zq7k*"], "triggers": ["qx9w"]}).encode()
R["rulesWritten"] = req("/userdata/snap%2Fprivate.json?overwrite=true", RULES)[0]
# U71: a tiny real safetensors with the trainer's nested stamp, and a neutral folder reached through a symlink named like a pattern
head = json.dumps({"__metadata__": {"name": "neutral", "lorastery_recipe": json.dumps({"task": "character_lora", "privacy": "full", "dataset": {"trigger": "nobody"}})},
                   "w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
open(os.path.join(base, "models", "loras", "snaptest_stamped_lora.safetensors"), "wb").write(struct.pack("<Q", len(head)) + head + bytes(4))
plain_dir = os.path.join(base, "_snaptest_plain_dir")
os.makedirs(plain_dir, exist_ok=True)
open(os.path.join(plain_dir, "a.safetensors"), "wb").write(b"not a real lora")
head = json.dumps({"__metadata__": {"recipe": json.dumps({"dataset": {"trigger": "Qx9w"}})}, "w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
open(os.path.join(base, "models", "loras", "snaptest_trigger_lora.safetensors"), "wb").write(struct.pack("<Q", len(head)) + head + bytes(4))
if not os.path.islink(os.path.join(base, "models", "loras", "snaptest_zq7k_dir")):
    os.symlink(plain_dir, os.path.join(base, "models", "loras", "snaptest_zq7k_dir"))
cases = {"symlink": only("snaptest_linked_lora.safetensors"),
         "pattern": {"class_type": "LoraLoader", "inputs": {"lora_name": "snaptest_zq7k_lora.safetensors", "strength_model": 1.0, "strength_clip": 1.0}},
         "abspath": stack(secret), "stamped": only("snaptest_stamped_lora.safetensors"), "folder": only("snaptest_zq7k_dir/a.safetensors"),
         "trigger": only("snaptest_trigger_lora.safetensors"), "dict": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_1": {"on": True, "lora": "snaptest_zq7k_lora.safetensors", "strength": 1}}},
         "tag": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "a portrait <lora:snaptest_linked_lora:0.8>"}}}
for k, loader in cases.items():
    h, _ = queue(image(k, loader))
    f = saved(h)[0]
    R[k] = {"chunks": sorted(png_chunks(f)), "src": b"_snaptest_private_src" in f or b"zq7k" in f or b"snaptest_linked" in f, "marks": h["prompt"][3].get("snap_marks")}

# the locks read again with today's rules: LoRA rows, and a take saved with no mark (as if made before the rule)
status, body = req("/mainodes/snap/private_loras")
R["locks"] = json.loads(body) if status == 200 else {"status": status}
take = lambda i, name: req(f"/userdata/snap%2Ftakes%2F{i}.json?overwrite=true", json.dumps({"id": i, "group": "u71", "number": 1, "created": 1, "status": "success", "notes": [], "media": [],
                                                                                         "prompt": image(i, only(name)), "graph": None}).encode())
take("take-u71-stamped", "snaptest_stamped_lora.safetensors")
take("take-u71-plain", "snaptest_plain_style_lora.safetensors")
status, body = req("/mainodes/snap/take_marks")
R["takeMarks"] = {"status": status, "body": json.loads(body) if status == 200 else body.decode()[:200]}

# rules with the wrong shape: the prompt still renders, marked private, and the routes keep answering
req("/userdata/snap%2Fprivate.json?overwrite=true", json.dumps({"paths": None}).encode())
h, err = queue(image("badrules", only(PLAIN)))
R["badRules"] = {"status": h and h["status"]["status_str"], "files": len(saved(h)) if h else 0, "marks": h and h["prompt"][3].get("snap_marks"), "error": err}
status, body = req("/mainodes/snap/private_loras")
R["badRoutes"] = [status, len(json.loads(body)["loras"]) if status == 200 else 0, req("/mainodes/snap/take_marks")[0]]
req("/userdata/snap%2Fprivate.json?overwrite=true", RULES)

refused = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}},
           "2": {"class_type": "SaveAnimatedWEBP", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/refused", "fps": 6.0, "lossless": False, "quality": 80, "method": "default"}}, "3": only(IDENTITY)}
h, err = queue(refused, metadata=False)
R["refused"] = {"queued": h is not None, "status": h and h["status"]["status_str"], "kept": h and (h["prompt"][3].get("snap_marks") or {}).get("kept"), "error": json.dumps(err)[:600] if err else None}
h, err = queue(refused)
R["refusedOn"] = {"queued": h is not None, "status": h and h["status"]["status_str"]}

checks = [R["identity"]["chunks"] == [] and not R["identity"]["nameInBytes"] and (R["identity"]["marks"] or {}).get("private") is True and R["identity"]["marks"]["metadata"] is False,
          R["identityOn"]["chunks"] == ["prompt", "workflow"] and R["identityOn"]["nameInBytes"] and (R["identityOn"]["marks"] or {}).get("private") is True and R["identityOn"]["marks"]["metadata"] is True and R["identityOn"]["marks"]["swapped"] == {"2": "SaveImage"} and R["identityOn"]["marks"].get("encrypted") is True,  # U79: privacy is on here, so the vault twin saves it, recipe inside
          R["plainOff"]["chunks"] == [] and not R["plainOff"]["nameInBytes"] and (R["plainOff"]["marks"] or {}).get("private") is False and R["plainOff"]["marks"]["swapped"] == {"2": "SaveImage"},
          R["cast"]["private"] is True and R["cast"]["chunks"] == ["prompt", "workflow"],
          R["plain"]["chunks"] == ["prompt", "workflow"] and R["plain"]["nameInBytes"] and not (R["plain"]["marks"] or {}).get("private") and not R["plain"]["marks"].get("nsfw") and R["plain"]["marks"].get("rating") == "pg",  # SNAP-R39: every prompt is rated
          R["video"].get("tags") is not None and not {"prompt", "workflow"} & set(R["video"]["tags"]) and not R["video"]["nameInBytes"],
          R["refused"]["queued"] and R["refused"]["status"] == "success" and R["refused"]["kept"] == ["node 2 (SaveAnimatedWEBP) writes metadata anyway"],
          R["refusedOn"]["queued"] and R["refusedOn"]["status"] == "success",
          *[(R[k]["marks"] or {}).get("private") is True and not any(x in json.dumps(R[k]["marks"]) for x in ("snaptest", "zq7k", "dummy")) for k in cases],
          {"snaptest_stamped_lora.safetensors", "snaptest_linked_lora.safetensors", "snaptest_zq7k_lora.safetensors", "snaptest_zq7k_dir/a.safetensors", "snaptest_trigger_lora.safetensors"} == set(R["locks"].get("loras", [])),
          R["badRules"]["status"] == "success" and R["badRules"]["files"] == 1 and (R["badRules"]["marks"] or {}).get("private") is True and any("privacy rules unreadable" in w for w in R["badRules"]["marks"]["why"]),
          R["badRoutes"][0] == 200 and R["badRoutes"][1] >= 80 and R["badRoutes"][2] == 200,
          R["takeMarks"]["status"] == 200 and R["takeMarks"]["body"]["takes"].get("take-u71-stamped") == {"private": True, "nsfw": False} and "take-u71-plain" not in R["takeMarks"]["body"]["takes"]
            and "snaptest" not in json.dumps(R["takeMarks"]["body"])]
json.dump(R, open(C.out("ui", "test_private_files_result.json"), "w"), indent=1)
print(f"private  {sum(checks)}/{len(checks)} {'PASS' if all(checks) else 'FAIL ' + str([i for i, c in enumerate(checks) if not c])}")
