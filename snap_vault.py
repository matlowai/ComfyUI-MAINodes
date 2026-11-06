"""Private takes kept encrypted along their path (U79): the container format and the keys. Plain Python, no ComfyUI
imports, so tools/snap_vault_cli.py and tools/snap_dataset.py read it outside ComfyUI; snap_vault_server.py is the
ComfyUI side (saver and loader twins, the /view and take-record middleware, the routes).

A container is one file at the path and under the name the saver would have used:
    b"SNAPVLT1" | header length (uint32 LE) | header JSON | chunks
Each chunk is AES-256-GCM of 4 MiB of plaintext with its own 16-byte tag; nonce = the file's 8 random bytes + the chunk
index (uint32 BE); AAD = sha256(header) + the index + 1 for the last chunk, so an edited header, a swapped, cut or
flipped chunk fails to open. Every file has its own random key, wrapped to its owner's X25519 public key the way age
wraps to a recipient (ephemeral key, HKDF-SHA256, AES-GCM), so writing never needs a passphrase. The owner's private key
is kept in user/snap_vault.json wrapped under Argon2id(passphrase), and escrowed to each admin's public key and to an
optional recovery key, so an admin opens anything and a lost passphrase is recovered by an admin or the recovery key,
else it is lost. The header may carry a `stub`: the fields of a take record a locked page still lists.
Unlocked private keys live only in `unlocked`, in memory; lock forgets them.
SNAP-R96 a private take lives encrypted at its own path · SNAP-R97 writing needs no passphrase, reading does, lock
forgets · SNAP-R99 a lost passphrase: escrow or the recovery key, else lost · see docs/SNAP_RULES.md
"""
import base64
import hashlib
import io
import json
import os
import struct
import threading
import time
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MAGIC = b"SNAPVLT1"
CHUNK = 4 << 20
KEYS = "snap_vault.json"  # user/snap_vault.json, outside every user's folder, so no page can write it
KDF = {"kdf": "argon2id", "m": 262144, "t": 3, "p": 4}  # 256 MiB, 0.16 s on this box; kept per account so it can rise
unlocked = {}  # ComfyUI user id -> X25519PrivateKey, while that account is unlocked
keys_lock = threading.Lock()


class WrongPassphrase(Exception):
    pass


class Locked(Exception):
    """The asker holds no unlocked key that opens this file."""


b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode
raw = lambda k: k.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw) if isinstance(k, X25519PublicKey) else k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())


def sealed(path):
    """Whether a file is a container: its first 8 bytes, never its name."""
    try:
        with open(path, "rb") as f:
            return f.read(8) == MAGIC
    except (OSError, ValueError):
        return False


# ---- recipients: the age X25519 construction ------------------------------------------------------------------------
def wrap(secret, pub, info):
    e = X25519PrivateKey.generate()
    epk, rpk = raw(e.public_key()), raw(pub)
    k = HKDF(hashes.SHA256(), 32, epk + rpk, info).derive(e.exchange(pub))
    nonce = os.urandom(12)
    return {"epk": b64(epk), "wrap": b64(nonce + AESGCM(k).encrypt(nonce, secret, None))}


def unwrap(stanza, priv, info):
    epk, rpk = unb64(stanza["epk"]), raw(priv.public_key())
    k = HKDF(hashes.SHA256(), 32, epk + rpk, info).derive(priv.exchange(X25519PublicKey.from_public_bytes(epk)))
    w = unb64(stanza["wrap"])
    return AESGCM(k).decrypt(w[:12], w[12:], None)


# ---- the container --------------------------------------------------------------------------------------------------
def nonce_of(fnonce, i):
    return fnonce + struct.pack(">I", i)


def aad(hhash, i, last):
    return hhash + struct.pack(">IB", i, 1 if last else 0)


def seal(path, data, owner, pub, stub=None):
    """Write `data` (bytes or a BytesIO) as a container at `path`, its key wrapped to `pub` (the owner's public key).
    Written beside it under a hidden name, then moved over, so a reader never sees half a file."""
    data = data.getbuffer() if isinstance(data, io.BytesIO) else memoryview(data)
    fkey, fnonce = AESGCM.generate_key(256), os.urandom(8)
    head = {"v": 1, "chunk": CHUNK, "size": len(data), "fnonce": b64(fnonce), "owner": owner, "name": os.path.basename(path),
            "made": time.strftime("%Y-%m-%dT%H:%M:%S"), "recipients": [{"to": owner, **wrap(fkey, pub, b"snap-vault/v1/file")}], **({"stub": stub} if stub else {})}
    hb = json.dumps(head, separators=(",", ":")).encode()
    hhash, gcm, n = hashlib.sha256(hb).digest(), AESGCM(fkey), max(1, -(-len(data) // CHUNK))
    tmp = os.path.join(os.path.dirname(path), f".{os.path.basename(path)}.sealing")
    with open(tmp, "wb") as f:
        f.write(MAGIC + struct.pack("<I", len(hb)) + hb)
        for i in range(n):
            f.write(gcm.encrypt(nonce_of(fnonce, i), bytes(data[i * CHUNK:(i + 1) * CHUNK]), aad(hhash, i, i == n - 1)))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class Container:
    """A container's header, and its plaintext by chunk or by byte range once a key opens it."""

    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            if f.read(8) != MAGIC:
                raise ValueError(f"{os.path.basename(path)} is not kept encrypted")
            n = struct.unpack("<I", f.read(4))[0]
            hb = f.read(n)
        self.header, self.hhash, self.start = json.loads(hb), hashlib.sha256(hb).digest(), 12 + n
        self.size, self.chunk = self.header["size"], self.header["chunk"]
        self.count = max(1, -(-self.size // self.chunk))

    def file_key(self, priv):
        """The file's key, unwrapped with an X25519 private key whose public half is one of its recipients."""
        mine = raw(priv.public_key())
        for r in self.header["recipients"]:
            try:
                return unwrap(r, priv, b"snap-vault/v1/file")
            except InvalidTag:
                continue
        raise Locked(f"no key here opens {self.header['name']} (made for {', '.join(r['to'] for r in self.header['recipients'])}; key {b64(mine)[:8]})")

    def chunks(self, fkey, first=0, last=None):
        """(index, plaintext) of chunks first..last."""
        last = self.count - 1 if last is None else last
        gcm, fnonce = AESGCM(fkey), unb64(self.header["fnonce"])
        with open(self.path, "rb") as f:
            for i in range(first, last + 1):
                f.seek(self.start + i * (self.chunk + 16))
                yield i, gcm.decrypt(nonce_of(fnonce, i), f.read(self.chunk + 16), aad(self.hhash, i, i == self.count - 1))

    def read(self, fkey, start=0, stop=None):
        """Plaintext bytes [start, stop), decrypting only the chunks that hold them."""
        stop = self.size if stop is None else min(stop, self.size)
        if start >= stop:
            return b""
        out = b"".join(p for _, p in self.chunks(fkey, start // self.chunk, (stop - 1) // self.chunk))
        skip = (start // self.chunk) * self.chunk
        return out[start - skip:stop - skip]


# ---- keys -----------------------------------------------------------------------------------------------------------
def load_keys(user_dir):
    f = Path(user_dir) / KEYS
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"accounts": {}}


def save_keys(user_dir, data):
    f = Path(user_dir) / KEYS
    tmp = f.with_name(f".{KEYS}.saving")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, f)


def passkey(passphrase, kdf, salt):
    return Argon2id(salt=salt, length=32, iterations=kdf["t"], lanes=kdf["p"], memory_cost=kdf["m"]).derive(passphrase.encode())


def lock_up(priv, passphrase):
    salt, nonce = os.urandom(16), os.urandom(12)
    return {**KDF, "salt": b64(salt), "nonce": b64(nonce), "ct": b64(AESGCM(passkey(passphrase, KDF, salt)).encrypt(nonce, raw(priv), None))}


def open_up(box, passphrase):
    try:
        return X25519PrivateKey.from_private_bytes(AESGCM(passkey(passphrase, box, unb64(box["salt"]))).decrypt(unb64(box["nonce"]), unb64(box["ct"]), None))
    except InvalidTag:
        raise WrongPassphrase() from None


def public(user_dir, user):
    """The account's public key, or None when it has no vault yet."""
    a = load_keys(user_dir)["accounts"].get(user)
    return X25519PublicKey.from_public_bytes(unb64(a["pub"])) if a else None


def escrow_to(entry, priv, user_dir, admins):
    """Escrow stanzas of this account's private key to every admin with a key (and keep the recovery one)."""
    accounts = load_keys(user_dir)["accounts"]
    kept = [s for s in entry.get("escrow", []) if s["to"] == "recovery"]
    entry["escrow"] = kept + [{"to": a, **wrap(raw(priv), X25519PublicKey.from_public_bytes(unb64(accounts[a]["pub"])), b"snap-vault/v1/escrow")}
                              for a in sorted(admins) if a in accounts and a != entry["user"]]


def recovery_words(secret):
    s = base64.b32encode(secret).decode().rstrip("=").lower()
    return "-".join(s[i:i + 4] for i in range(0, len(s), 4))


def setup(user_dir, user, passphrase, admins, recovery=False):
    """Make the account's keypair, wrapped under the passphrase and escrowed to the admins; with `recovery`, also to a
    recovery key whose words are returned once and stored nowhere."""
    with keys_lock:
        data = load_keys(user_dir)
        if user in data["accounts"]:
            raise FileExistsError(f"{user} already has a vault key")
        priv = X25519PrivateKey.generate()
        entry = {"user": user, "pub": b64(raw(priv.public_key())), "key": lock_up(priv, passphrase), "made": time.strftime("%Y-%m-%dT%H:%M:%S"), "escrow": []}
        words = None
        if recovery:
            rec = X25519PrivateKey.generate()
            entry["escrow"].append({"to": "recovery", **wrap(raw(priv), rec.public_key(), b"snap-vault/v1/escrow")})
            words = recovery_words(raw(rec))
        data["accounts"][user] = entry
        escrow_to(entry, priv, user_dir, admins)
        save_keys(user_dir, data)
    unlocked[user] = priv
    return words


def add_recovery(user_dir, user, priv):
    """A recovery key for an unlocked account (replacing any earlier one); its words are returned once and stored nowhere."""
    with keys_lock:
        data = load_keys(user_dir)
        entry = data["accounts"][user]
        rec = X25519PrivateKey.generate()
        entry["escrow"] = [s for s in entry.get("escrow", []) if s["to"] != "recovery"] + [{"to": "recovery", **wrap(raw(priv), rec.public_key(), b"snap-vault/v1/escrow")}]
        save_keys(user_dir, data)
    return recovery_words(raw(rec))


def unlock(user_dir, user, passphrase, admins):
    """Open the account's key with its passphrase and keep it in memory; escrow is brought up to the current admins."""
    with keys_lock:
        data = load_keys(user_dir)
        entry = data["accounts"].get(user)
        if entry is None:
            raise KeyError(user)
        priv = open_up(entry["key"], passphrase)
        before = [s["to"] for s in entry.get("escrow", [])]
        escrow_to(entry, priv, user_dir, admins)
        if [s["to"] for s in entry["escrow"]] != before:
            save_keys(user_dir, data)
    unlocked[user] = priv
    return priv


def reset(user_dir, user, priv, new_passphrase, admins):
    """Wrap an account's private key (opened by escrow or recovery) under a new passphrase."""
    with keys_lock:
        data = load_keys(user_dir)
        entry = data["accounts"][user]
        entry["key"] = lock_up(priv, new_passphrase)
        escrow_to(entry, priv, user_dir, admins)
        save_keys(user_dir, data)


def escrowed(user_dir, owner, asker_priv, asker):
    """The owner's private key, opened from its escrow stanza to `asker` (an admin) or to "recovery"."""
    entry = load_keys(user_dir)["accounts"].get(owner)
    for s in (entry or {}).get("escrow", []):
        if s["to"] == asker:
            return X25519PrivateKey.from_private_bytes(unwrap(s, asker_priv, b"snap-vault/v1/escrow"))
    raise Locked(f"{owner}'s key isn't escrowed to {asker}")


def from_words(words):
    s = words.replace("-", "").replace(" ", "").upper()
    return X25519PrivateKey.from_private_bytes(base64.b32decode(s + "=" * (-len(s) % 8)))


def key_for(user_dir, asker, owner, admins):
    """The private key that opens `owner`'s files for `asker`: their own unlocked key, or for an unlocked admin the
    owner's key through escrow (admin has all the power). Raises Locked otherwise."""
    if asker == owner:
        if asker in unlocked:
            return unlocked[asker]
        raise Locked(f"kept encrypted: unlock the vault (sign in) to open {owner}'s private takes")
    if asker in admins and asker in unlocked:
        return escrowed(user_dir, owner, unlocked[asker], asker)
    raise Locked("kept encrypted: only its owner and the admins open it")


def open_file(user_dir, path, asker, admins):
    """(Container, file key) for a container the asker may open; raises Locked."""
    c = Container(path)
    return c, c.file_key(key_for(user_dir, asker, c.header["owner"], admins))


def read_all(user_dir, path, asker, admins):
    c, k = open_file(user_dir, path, asker, admins)
    return c.read(k)
