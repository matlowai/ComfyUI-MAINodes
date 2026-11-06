"""U79 step 1 (SNAP-R96, R97, R99): the vault container and keys, pure Python, no server.
Round trips of 0 B, 1 B, 4 MiB, 4 MiB+1 and 37 MiB; every read_range slice equals the plaintext slice; a flipped byte, a
cut last chunk, a swapped chunk pair and an edited header all fail to open (InvalidTag); a wrong passphrase raises
WrongPassphrase; an admin opens a member's file through escrow; the recovery words reset a lost passphrase; the key file
holds no private key in the clear; seal and open speeds (MB/s) and the OpenSSL version are printed. Its files stay in a new folder under $TMPDIR (no deletes).
usage: comfyui_venv/bin/python -I test_vault_format.py [pack dir]"""
import base64
import json
import os
import random
import sys
import tempfile
import time
from pathlib import Path

PACK = sys.argv[1] if len(sys.argv) > 1 else str(C.PACK)
sys.path.insert(0, PACK)
import snap_vault as V  # noqa: E402
from cryptography.exceptions import InvalidTag  # noqa: E402
from cryptography.hazmat.backends.openssl.backend import backend  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

d = Path(tempfile.mkdtemp(prefix="vaultfmt-", dir=os.environ.get("TMPDIR")))  # left in place (no deletes); TMPDIR = a scratch folder
checks, R = {}, {}
try:
    words = V.setup(d, "owner", "correct horse", admins=set())
    checks["no recovery unless asked"] = words is None
    V.setup(d, "admin", "admin pass", admins=set())
    V.unlocked.clear()
    priv = V.unlock(d, "owner", "correct horse", admins={"admin"})  # escrow brought up to the admin now
    pub = V.public(d, "owner")
    rng = random.Random(7)
    for n in (0, 1, V.CHUNK, V.CHUNK + 1, 37 << 20):
        data = rng.randbytes(n)
        p = d / f"f{n}.bin"
        V.seal(p, data, "owner", pub)
        if n == 1:
            (d / "f1.plain").write_bytes(data)
        c, k = V.open_file(d, p, "owner", set())
        ok = c.read(k) == data and V.sealed(p)
        for a, b in ((0, 1), (n // 3, n // 3 + 100), (V.CHUNK - 5, V.CHUNK + 5), (max(0, n - 7), n), (n // 2, n + 50)):
            ok = ok and c.read(k, a, b) == data[a:b]
        checks[f"round trip + ranges {n} B"] = ok
    p = d / f"f{37 << 20}.bin"
    raw = p.read_bytes()
    c = V.Container(p)

    def fails(blob):
        q = d / "bad.bin"
        q.write_bytes(blob)
        try:
            cc, kk = V.open_file(d, q, "owner", set())
            cc.read(kk)
            return False
        except (InvalidTag, ValueError):
            return True
    s, L = c.start, c.chunk + 16
    flipped = bytearray(raw); flipped[s + 1000] ^= 1
    checks["flipped byte fails"] = fails(bytes(flipped))
    checks["cut last chunk fails"] = fails(raw[:-100])
    swapped = raw[:s] + raw[s + L:s + 2 * L] + raw[s:s + L] + raw[s + 2 * L:]
    checks["swapped chunks fail"] = fails(swapped)
    hb = raw[12:s].replace(b'"v":1', b'"v":2')
    checks["edited header fails"] = fails(raw[:12] + hb + raw[s:])
    try:
        V.unlock(d, "owner", "wrong", admins=set())
        checks["wrong passphrase raises"] = False
    except V.WrongPassphrase:
        checks["wrong passphrase raises"] = True
    V.unlocked.pop("owner")
    try:
        V.open_file(d, d / "f1.bin", "owner", set())
        checks["locked owner refused"] = False
    except V.Locked as e:
        checks["locked owner refused"] = "kept encrypted" in str(e)
    V.unlock(d, "admin", "admin pass", admins=set())
    checks["admin opens through escrow"] = V.read_all(d, d / "f1.bin", "admin", {"admin"}) == (d / "f1.plain").read_bytes()
    try:
        V.read_all(d, d / "f1.bin", "stranger", {"admin"})
        checks["stranger refused"] = False
    except V.Locked:
        checks["stranger refused"] = True
    # recovery words reset a lost passphrase
    words = V.setup(d, "solo", "forgotten", admins=set(), recovery=True)
    V.seal(d / "solo.bin", b"solo take", "solo", V.public(d, "solo"))
    V.unlocked.pop("solo")
    solo = V.escrowed(d, "solo", V.from_words(words), "recovery")
    V.reset(d, "solo", solo, "new pass", admins=set())
    checks["recovery words reset the passphrase"] = V.unlock(d, "solo", "new pass", admins=set()) is not None and V.read_all(d, d / "solo.bin", "solo", set()) == b"solo take"
    keys = (d / V.KEYS).read_text()
    privs = [base64.b64encode(V.raw(k)).decode() for k in V.unlocked.values()]
    checks["no private key in the clear"] = not any(x in keys for x in privs) and keys.count('"ct"') == len(json.loads(keys)["accounts"])
    # speed
    big = rng.randbytes(64 << 20)
    t = time.time(); V.seal(d / "speed.bin", big, "owner", pub); ts = time.time() - t
    V.unlocked["owner"] = priv
    c, k = V.open_file(d, d / "speed.bin", "owner", set())
    t = time.time(); out = c.read(k); to = time.time() - t
    R["seal_MBps"], R["open_MBps"], R["openssl"] = round(64 / ts), round(64 / to), backend.openssl_version_text()
    t = time.time(); V.unlock(d, "owner", "correct horse", admins=set()); R["unlock_s"] = round(time.time() - t, 3)
    checks["speed above 1 GB/s"] = R["open_MBps"] > 1000 and out == big
finally:
    R["dir"] = str(d)
bad = [k for k, v in checks.items() if not v]
print(json.dumps(R))
print(f"vaultfmt  {len(checks) - len(bad)}/{len(checks)} {'PASS' if not bad else 'FAIL ' + str(bad)}")
