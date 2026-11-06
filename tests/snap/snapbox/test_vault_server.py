"""U79 steps 2-6 (SNAP-R96..R99) against the gatetest ComfyUI directly (default :8199, --multi-user, privacy on), as
the gatetest accounts' ComfyUI users (comfy-user header; snap-gate's side is test_vault_gate.py):
- keys: setup for admin and member (escrow to the admin), status, lock/unlock, 4 wrong passphrases -> 429 + Retry-After,
  the key file holds no private key in the clear, a privacy-off answer is test_vault_off.py's;
- savers: a private prompt (it names a LoRA whose header is stamped private) saves Save Image, Preview Image, Save Video
  and MAI Video Out (+ meta.json) as containers at their normal names, recipe inside with Save metadata on, none with it
  off; snap_marks says encrypted; no new file under output/, temp/, input/ is plain, and the LoRA's name is in none;
- /view: the owner gets the plaintext, Range 100-199 -> 206 with that slice, Cache-Control no-store; locked -> 423 with a
  clear message, a lock tile for an <img>; the admin opens the member's take through escrow; another account can't;
- reuse: Load Image / Load Video of a container -> twins (preview sealed, same pixels, same frame count), Make it louder,
  /mainodes/snap/loudness on a container; a locked reader is refused at queue naming the vault; an account with no key
  is refused at queue;
- take records through /userdata: a private record is sealed; read back unlocked (kept_encrypted) and locked (stub: no
  prompt/graph, locked); writing a stub back is 423; an upload with snap_vault=1 lands as a container;
- recovery: the admin resets a "forgotten" member passphrase (rewrap); a server restart forgets every key (locked), and
  an unlock brings the takes back.
Queues 64 px CPU prompts only; writes test_vault_server_result.json. Needs user/snap_privacy.json {"on": true}.
usage: comfyui_venv/bin/python -I test_vault_server.py [port] [base]"""
import os
import hashlib
import io
import json
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snaptest_config as C  # noqa: E402

PORT = sys.argv[1] if len(sys.argv) > 1 else C.GATETEST_PORT
ROOT = Path(sys.argv[2]) if len(sys.argv) > 2 else C.gatetest_base()
BASE, T = f"http://127.0.0.1:{PORT}", time.strftime("%H%M%S")
USERS = {v: k for k, v in json.loads((ROOT / "user" / "users.json").read_text()).items()}
ADMIN, MEMBER = USERS["admin"], USERS["member"]
if "u79nokey" not in USERS:  # a ComfyUI user with no gate account, so it never signs in and never gets a vault key
    _r = urllib.request.Request(BASE + "/users", data=json.dumps({"username": "u79nokey"}).encode(), headers={"Content-Type": "application/json"})
    USERS["u79nokey"] = json.loads(urllib.request.urlopen(_r, timeout=30).read())
KID = USERS["u79nokey"]
GATE = json.loads(C.fixture("gate_accounts.json").read_text())
PASS = {ADMIN: GATE["admin"], MEMBER: GATE["member"]}  # the sign-in password is the vault passphrase behind snap-gate (Q4)
LORA = "u79/snaptest_u79_stamped.safetensors"  # in models/vae: a helper folder, so no rating is needed and no LoRA list changes
MAGIC = b"SNAPVLT1"
checks, R = {}, {}


def req(path, body=None, user=MEMBER, raw=None, method=None, headers=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json", "comfy-user": user, **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=120) as res:
            return res.status, res.read(), dict(res.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def j(path, body=None, user=MEMBER, **kw):
    st, b, h = req(path, body, user, **kw)
    try:
        return st, json.loads(b)
    except ValueError:
        return st, b[:200]


def queue(nodes, user=MEMBER, metadata=True):
    workflow = {"nodes": [], "extra": {} if metadata else {"snap_metadata": False}}
    st, out = j("/prompt", {"prompt": nodes, "client_id": uuid.uuid4().hex, "extra_data": {"extra_pnginfo": {"workflow": workflow}}}, user)
    if st != 200:
        return {"refused": out}
    for _ in range(480):
        h = j(f"/history/{out['prompt_id']}", user=user)[1].get(out["prompt_id"])
        if h and h.get("status", {}).get("completed") is not None:
            files = [f for _, o in sorted(h["outputs"].items()) for lst in o.values() if isinstance(lst, list) for f in lst if isinstance(f, dict) and "filename" in f]
            msgs = [m for m in h["status"].get("messages", []) if m[0] == "execution_error"]
            return {"status": h["status"]["status_str"], "files": files, "marks": h["prompt"][3].get("snap_marks") or {}, "errors": [m[1].get("exception_message") for m in msgs]}
        time.sleep(0.25)
    raise TimeoutError(out["prompt_id"])


def path_of(f):
    return ROOT / f["type"] / f["subfolder"] / f["filename"]


def view(f, user=MEMBER, headers=None):
    return req(f"/view?filename={f['filename']}&subfolder={f['subfolder']}&type={f['type']}", user=user, headers=headers)


def png_text(b):
    out, i = [], 8
    while i < len(b):
        n, kind = struct.unpack(">I4s", b[i:i + 8])
        if kind in (b"tEXt", b"iTXt", b"zTXt"):
            out.append(b[i + 8:i + 8 + n].split(b"\0")[0].decode("latin-1"))
        i += 12 + n
    return out


def probe(b, what="format_tags"):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", f"{what}:stream=nb_read_frames", "-count_frames", "-of", "json", "-"], input=b, capture_output=True, check=True)
    return json.loads(r.stdout)


def magic(p):
    with open(p, "rb") as f:
        return f.read(8) == MAGIC


# fixtures: a LoRA stamped private in its header (SNAP-R27), placeholder weights; the switch on
lora = ROOT / "models" / "vae" / LORA
lora.parent.mkdir(parents=True, exist_ok=True)
hb = json.dumps({"__metadata__": {"recipe": json.dumps({"privacy": "full"})}}).encode()
lora.write_bytes(struct.pack("<Q", len(hb)) + hb)
checks["privacy on"] = json.loads((ROOT / "user" / "snap_privacy.json").read_text()).get("on") is True
private = lambda: {"9": {"class_type": "PrimitiveString", "inputs": {"value": LORA}}}  # a node nothing runs; the prompt still loads-names the LoRA (marks read every input)
stamp = time.time()

# ---- keys -----------------------------------------------------------------------------------------------------------
for u in (ADMIN, MEMBER):
    st, s = j("/mainodes/snap/vault/status", user=u)
    if s.get("vault") == "none":
        st, s = j("/mainodes/snap/vault/setup", {"passphrase": PASS[u]}, u)
    else:  # an earlier run's key (or snap-gate's, made at sign-in)
        st, s = j("/mainodes/snap/vault/unlock", {"passphrase": PASS[u]}, u)
    R[f"setup {u[:6]}"] = s
checks["admin then member set up, unlocked"] = all(R[f"setup {u[:6]}"].get("vault") == "unlocked" for u in (ADMIN, MEMBER))
j("/mainodes/snap/vault/unlock", {"passphrase": PASS[MEMBER]}, MEMBER)  # escrow to the admin made at this unlock
checks["member escrowed to the admin"] = ADMIN in j("/mainodes/snap/vault/status")[1].get("escrow", [])
checks["an account that never signed in has none"] = j("/mainodes/snap/vault/status", user=KID)[1].get("vault") == "none"
keys = (ROOT / "user" / "snap_vault.json").read_text()
checks["key file: wrapped keys only"] = keys.count('"ct"') == len(json.loads(keys)["accounts"]) and '"priv' not in keys
checks["member still unlocked"] = j("/mainodes/snap/vault/status")[1]["vault"] == "unlocked"

# ---- savers ---------------------------------------------------------------------------------------------------------
img = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0x3366cc}},
       "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "snaptest/u79_img"}}, "3": {"class_type": "PreviewImage", "inputs": {"images": ["1", 0]}}, **private()}
frames = {"1": {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 12, "color": 0x336633}}, "2": {"class_type": "CreateVideo", "inputs": {"images": ["1", 0], "fps": 12}}}
vid = {**frames, "3": {"class_type": "SaveVideo", "inputs": {"video": ["2", 0], "filename_prefix": "snaptest/u79_vid", "format": "mp4", "codec": "h264"}}, **private()}
vo = {"1": frames["1"], "2": {"class_type": "MAIVideoOut", "inputs": {"images": ["1", 0], "fps": 12.0, "filename_prefix": "snaptest/u79_vo", "codec": "h264", "crf": 23}}, **private()}
imgOff = json.loads(json.dumps(img).replace("3368652", "3368653"))  # another colour: an identical prompt is served from core's cache, metadata or not
R["img"], R["imgOff"], R["vid"], R["vo"] = queue(img), queue(imgOff, metadata=False), queue(vid), queue(vo)
checks["image saved sealed, marks say encrypted"] = R["img"].get("status") == "success" and all(magic(path_of(f)) for f in R["img"]["files"]) and len(R["img"]["files"]) == 2 and R["img"]["marks"].get("encrypted") and R["img"]["marks"].get("vault") == MEMBER
st, body, hd = view(R["img"]["files"][0])
checks["/view decrypts the picture, recipe inside, no-store"] = st == 200 and body[:8] == b"\x89PNG\r\n\x1a\n" and {"prompt", "workflow"} <= set(png_text(body)) and hd.get("Cache-Control") == "no-store"
checks["preview in temp sealed too"] = R["img"]["files"][1]["type"] == "temp" and magic(path_of(R["img"]["files"][1])) and view(R["img"]["files"][1])[1][:4] == b"\x89PNG"
R["imgOffText"] = png_text(view(R["imgOff"]["files"][0])[1])
check_off = all(magic(path_of(f)) for f in R["imgOff"]["files"]) and R["imgOffText"] == []
checks["metadata off: sealed, no recipe"] = check_off
st, body, hd = view(R["vid"]["files"][0])
plain_vid = body
tags = {k.lower() for k in (probe(body).get("format", {}).get("tags") or {})}
checks["video sealed, decrypts with its recipe"] = magic(path_of(R["vid"]["files"][0])) and st == 200 and {"prompt", "workflow"} <= tags and probe(body)["streams"][0]["nb_read_frames"] == "12"
st, part, hd = view(R["vid"]["files"][0], headers={"Range": "bytes=100-199"})
checks["Range 100-199 -> 206 slice"] = st == 206 and part == plain_vid[100:200] and hd.get("Content-Range") == f"bytes 100-199/{len(plain_vid)}" and hd.get("Accept-Ranges") == "bytes"
st, tail, hd = view(R["vid"]["files"][0], headers={"Range": "bytes=-500"})
checks["suffix range (the moov tail)"] = st == 206 and tail == plain_vid[-500:]
vof = R["vo"]["files"][0]
metas = sorted(path_of(vof).parent.glob(vof["filename"].rsplit("_", 1)[0] + "*.meta.json"))
checks["MAI Video Out sealed with its meta.json"] = magic(path_of(vof)) and metas and all(magic(m) for m in metas)

# ---- locked, escrow, others -----------------------------------------------------------------------------------------
j("/mainodes/snap/vault/lock", {})
st, out = j(f"/view?filename={R['img']['files'][0]['filename']}&subfolder={R['img']['files'][0]['subfolder']}&type=output")
R["locked"] = [st, out]
checks["locked fetch -> 423, clear message"] = st == 423 and out.get("locked") and "kept encrypted" in out.get("error", "") and "sign in" in out["error"]
st, body, hd = view(R["img"]["files"][0], headers={"Sec-Fetch-Dest": "image"})
checks["locked <img> -> lock tile"] = st == 200 and hd.get("Content-Type") == "image/png" and Image.open(io.BytesIO(body)).size == (320, 180)
checks["admin opens it through escrow"] = view(R["img"]["files"][0], user=ADMIN)[1][:4] == b"\x89PNG"
checks["another account can't"] = view(R["img"]["files"][0], user=KID)[0] == 423
loader = {"1": {"class_type": "LoadImage", "inputs": {"image": f"{R['img']['files'][0]['subfolder']}/{R['img']['files'][0]['filename']} [output]"}}, "2": {"class_type": "PreviewImage", "inputs": {"images": ["1", 0]}}}
R["lockedLoad"] = queue(loader)
checks["locked reader refused at queue"] = "vault is locked" in json.dumps(R["lockedLoad"].get("refused"))
R["noKey"] = queue(img, user=KID)
checks["no key refused at queue"] = "no vault key" in json.dumps(R["noKey"].get("refused"))
j("/mainodes/snap/vault/unlock", {"passphrase": PASS[MEMBER]})

# ---- reuse ----------------------------------------------------------------------------------------------------------
R["load"] = queue(loader)
pv = R["load"].get("files", [])
checks["Load Image twin: preview sealed, same pixels"] = R["load"].get("status") == "success" and R["load"]["marks"].get("swapped", {}).get("1") == "LoadImage" and pv and magic(path_of(pv[-1])) \
    and Image.open(io.BytesIO(view(pv[-1])[1])).convert("RGB").getpixel((5, 5)) == (0x33, 0x66, 0xcc)
annotated = f"{R['vid']['files'][0]['subfolder']}/{R['vid']['files'][0]['filename']} [output]"
R["reload"] = queue({"1": {"class_type": "LoadVideo", "inputs": {"file": annotated}}, "3": {"class_type": "SaveVideo", "inputs": {"video": ["1", 0], "filename_prefix": "snaptest/u79_copy", "format": "mp4", "codec": "h264"}}})
out = [f for f in R["reload"].get("files", []) if f["type"] == "output"]
checks["Load Video twin -> sealed copy, 12 frames"] = R["reload"].get("status") == "success" and out and magic(path_of(out[-1])) and probe(view(out[-1])[1])["streams"][0]["nb_read_frames"] == "12"
R["louder"] = queue({"1": {"class_type": "LoadVideo", "inputs": {"file": annotated}}, "2": {"class_type": "MAISnapLouder", "inputs": {"video": ["1", 0]}}, "3": {"class_type": "SaveVideo", "inputs": {"video": ["2", 0], "filename_prefix": "snaptest/u79_louder", "format": "auto", "codec": "auto"}}})
checks["Make it louder on a sealed take"] = R["louder"].get("status") == "success" or "audio" in json.dumps(R["louder"].get("errors"))  # a silent clip has no sound to normalise
st, loud = j(f"/mainodes/snap/loudness?filename={R['vid']['files'][0]['filename']}&subfolder={R['vid']['files'][0]['subfolder']}&type=output")
checks["loudness reads a sealed take"] = st == 200 and "sound" in loud

# ---- take records and uploads ---------------------------------------------------------------------------------------
tid = f"take-u79-{T}"
record = {"id": tid, "kind": "run", "created": 1, "number": 1, "status": "success", "private": True, "media": [{"kind": "image", **R["img"]["files"][0]}],
          "text": "a recipe line", "prompt": img, "graph": {"nodes": [], "extra": {}}, "notes": [{"text": "a note"}], "rating": "pg"}
st, out = j(f"/userdata/snap%2Ftakes%2F{tid}.json?overwrite=true", raw=json.dumps(record).encode(), method="POST")
disk = ROOT / "user" / MEMBER / "snap" / "takes" / f"{tid}.json"
checks["private take record sealed on disk"] = st == 200 and out == f"snap/takes/{tid}.json" and magic(disk) and b"a recipe line" not in disk.read_bytes()
st, got = j(f"/userdata/snap%2Ftakes%2F{tid}.json")
checks["record reads back unlocked"] = st == 200 and got.get("prompt") == img and got.get("kept_encrypted") is True and not got.get("locked")
j("/mainodes/snap/vault/lock", {})
st, stub = j(f"/userdata/snap%2Ftakes%2F{tid}.json")
R["stub"] = stub
checks["locked record = stub"] = st == 200 and stub.get("locked") and stub.get("kept_encrypted") and stub.get("prompt") is None and stub.get("graph") is None and stub.get("media") and "text" not in stub
st, out = j(f"/userdata/snap%2Ftakes%2F{tid}.json?overwrite=true", raw=json.dumps(stub).encode(), method="POST")
checks["writing a stub back -> 423"] = st == 423 and magic(disk)
rec2 = {**record, "id": tid + "b"}
st, out = j(f"/userdata/snap%2Ftakes%2F{tid}b.json?overwrite=true", raw=json.dumps(rec2).encode(), method="POST")
checks["a record sealed while locked (public key only)"] = st == 200 and magic(ROOT / "user" / MEMBER / "snap" / "takes" / f"{tid}b.json")
j("/mainodes/snap/vault/unlock", {"passphrase": PASS[MEMBER]})
b = io.BytesIO()
Image.new("RGB", (8, 8), (200, 10, 10)).save(b, "PNG")
bound = uuid.uuid4().hex
form = b"".join([f"--{bound}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k, v in (("subfolder", "snap"), ("snap_vault", "1"), ("overwrite", "true"))]) + \
    f"--{bound}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{tid}_f0.png\"\r\nContent-Type: image/png\r\n\r\n".encode() + b.getvalue() + f"\r\n--{bound}--\r\n".encode()
st, out = j("/upload/image", raw=form, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={bound}"})
checks["upload with snap_vault lands sealed"] = st == 200 and magic(ROOT / "input" / "snap" / f"{tid}_f0.png") and view({"filename": f"{tid}_f0.png", "subfolder": "snap", "type": "input"})[1][:4] == b"\x89PNG"

# ---- the world export: containers as they are, decrypted only when asked ------------------------------------------
import zipfile  # noqa: E402
j("/mainodes/snap/world/save", {"kind": "cast", "id": f"u79cast{T}", "body": {"name": "U79 test cast"}})
pinned = {**record, "id": tid + "x", "world": {f"cast:u79cast{T}": {"n": 1, "name": "U79 test cast"}}}
j(f"/userdata/snap%2Ftakes%2F{tid}x.json?overwrite=true", raw=json.dumps(pinned).encode(), method="POST")
zips = {}
for dec in (False, True):
    st, out = j("/mainodes/snap/world/export", {"refs": [f"cast:u79cast{T}"], "with_takes": True, "decrypt_private": dec})
    z = zipfile.ZipFile(ROOT / "output" / out["subfolder"] / out["file"])
    zips[dec] = {"manifest": out["manifest"], "take": z.read(f"takes/{tid}x.json"), "media": z.read(f"media/output/{R['img']['files'][0]['subfolder']}/{R['img']['files'][0]['filename']}")}
R["exportManifest"] = zips[False]["manifest"]
checks["export keeps containers by default"] = zips[False]["take"][:8] == MAGIC and zips[False]["media"][:8] == MAGIC and len(zips[False]["manifest"]["kept_encrypted"]) == 2
checks["export decrypts when asked (unlocked)"] = json.loads(zips[True]["take"])["prompt"] == img and zips[True]["media"][:4] == b"\x89PNG" and zips[True]["manifest"]["kept_encrypted"] == []
st, sz = j("/mainodes/snap/sizes")
checks["clean-up sizes count kept-encrypted takes"] = st == 200 and sz["takes"]["kept_encrypted"] >= 3
st, rk = j("/mainodes/snap/vault/recovery_key", {})
rk_ok = st == 200 and len(rk.get("recovery_key", "")) > 40
j("/mainodes/snap/vault/lock", {})
st, back = j("/mainodes/snap/vault/recover", {"recovery_key": rk.get("recovery_key", ""), "new_passphrase": PASS[MEMBER]})
checks["recovery key made later opens the vault"] = rk_ok and back.get("vault") == "unlocked" and back.get("recovery") is True

# ---- no plaintext of these private takes ----------------------------------------------------------------------------
# the export zips are the person's own ask (the default one holds containers, checked above; the decrypt_private one is plain by request)
new = [p for d in ("output", "temp", "input") for p in (ROOT / d).rglob("*") if p.is_file() and p.stat().st_mtime >= stamp and "snap_exports" not in p.parts]
plain_new = [str(p) for p in new if not magic(p)]
R["newFiles"], R["plainNew"] = len(new), plain_new
checks["no plain file from the private runs"] = new and not plain_new
checks["the private LoRA's name is in no new file"] = not any(b"snaptest_u79_stamped" in p.read_bytes() for p in new)

# ---- recovery and restart -------------------------------------------------------------------------------------------
j("/mainodes/snap/vault/unlock", {"passphrase": PASS[ADMIN]}, ADMIN)
PASS[MEMBER] = f"u79-member-reset-{T}"
st, out = j("/mainodes/snap/vault/rewrap", {"account": MEMBER, "new_passphrase": PASS[MEMBER]}, ADMIN)
j("/mainodes/snap/vault/lock", {})
checks["admin resets a forgotten passphrase"] = st == 200 and j("/mainodes/snap/vault/unlock", {"passphrase": PASS[MEMBER]})[1].get("vault") == "unlocked"
checks["member can't rewrap"] = j("/mainodes/snap/vault/rewrap", {"account": ADMIN, "new_passphrase": "x"})[0] == 403
subprocess.run(["systemctl", "--user", "restart", C.GATETEST_UNIT], check=True)
for _ in range(90):
    try:
        if urllib.request.urlopen(BASE + "/", timeout=2).status == 200:
            break
    except OSError:
        time.sleep(1)
checks["restart forgets keys"] = j("/mainodes/snap/vault/status")[1].get("vault") == "locked" and view(R["vid"]["files"][0])[0] == 423
j("/mainodes/snap/vault/unlock", {"passphrase": PASS[MEMBER]})
checks["unlock after restart brings them back"] = view(R["vid"]["files"][0])[1] == plain_vid
j("/mainodes/snap/vault/unlock", {"passphrase": PASS[ADMIN]}, ADMIN)
checks["member's passphrase put back to the sign-in password"] = j("/mainodes/snap/vault/rewrap", {"account": MEMBER, "new_passphrase": GATE["member"]}, ADMIN)[0] == 200
subprocess.run(["systemctl", "--user", "restart", *C.GATE_UNITS], check=True)
for _ in range(30):  # the next suite talks to the gate at once
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{C.GATE_PORT}/gate/login", timeout=2)
        break
    except OSError:
        time.sleep(1)

# last: the waits after wrong passphrases (a restart clears them)
wrong = [req("/mainodes/snap/vault/unlock", {"passphrase": "nope"}, MEMBER) for _ in range(4)]
R["wrong"] = [(w[0], w[2].get("Retry-After")) for w in wrong]
checks["wrong passphrase waits"] = [w[0] for w in wrong][:3] == [401, 401, 401] and wrong[3][0] == 429 and wrong[3][2].get("Retry-After")
time.sleep(int(wrong[3][2].get("Retry-After") or 0) + 1)  # wait it out, so the next suite's unlock isn't refused
bad = [k for k, v in checks.items() if not v]
C.out("snapbox", "test_vault_server_result.json").write_text(json.dumps({"checks": checks, "R": R}, indent=1, default=str))
print(f"vaultsrv  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")
