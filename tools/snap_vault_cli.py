"""Seal private takes that were saved before the vault was on (U79, SNAP-R96): their take records and output files are
rewritten in place as containers, under the same names, to the account's public key (no passphrase needed).

A take counts when its record says private (the save gate marked it), or when it is a version of one or made from its
frame (SNAP-R27). Records and files already sealed are left as they are. Without --go it only lists what it would seal.
The plaintext a sealed file replaces stays on an SSD until the drive trims those blocks: this keeps new copies out of
reach of other accounts, not of someone with the raw disk.

  comfyui_venv/bin/python tools/snap_vault_cli.py encrypt-existing --comfy <ComfyUI base> --user <ComfyUI user id> [--go]
SNAP-R96 kept encrypted at its own path · see docs/snap/SNAP_RULES.md
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # the pack folder, for snap_vault (no ComfyUI imports)
import snap_vault  # noqa: E402

STUB = ("id", "kind", "prompt_id", "created", "finished", "seconds", "group", "workflow", "number", "status", "media", "private", "nsfw",
        "rating", "rating_set", "parent", "made_from", "verdict", "prior", "metadata", "cached_from", "sound", "updated", "world", "hash", "seed_hash")  # snap_vault_server.STUB


def encrypt_existing(args):
    users = args.comfy / "user"
    pub = snap_vault.public(users, args.user)
    if pub is None:
        sys.exit(f"{args.user} has no vault key yet: sign in once (snap-gate sets it up) or set it up from Snap's lock sheet.")
    takes = {}
    for f in sorted((users / args.user / "snap" / "takes").glob("*.json")):
        if not snap_vault.sealed(f):
            takes[f.stem] = (f, json.loads(f.read_text(encoding="utf-8")))
    sealed_ids = {f.stem for f in (users / args.user / "snap" / "takes").glob("*.json") if snap_vault.sealed(f)}

    def private(t, seen=()):
        came = [i for i in [(t.get("parent") or {}).get("take"), *t.get("made_from", [])] if i and i not in seen]
        return bool(t.get("private")) or any(i in sealed_ids or (i in takes and private(takes[i][1], (*seen, t["id"]))) for i in came)
    roots = {"output": args.comfy / "output", "input": args.comfy / "input", "temp": args.comfy / "temp"}
    plan = []
    for tid, (f, t) in takes.items():
        if not private(t):
            continue
        media = [roots.get(m.get("type", "output"), roots["output"]) / m.get("subfolder", "") / m["filename"] for m in t.get("media", [])]
        plan.append((f, t, [p for p in media if p.is_file() and not snap_vault.sealed(p)]))
    for f, t, media in plan:
        print(f"{'seal' if args.go else 'would seal'} take {t['id']}: its record and {len(media)} file(s): {', '.join(str(p.relative_to(args.comfy)) for p in media) or '(no files left)'}")
        if args.go:
            for p in media:
                snap_vault.seal(p, p.read_bytes(), args.user, pub)
            snap_vault.seal(f, f.read_bytes(), args.user, pub, {k: t[k] for k in STUB if k in t})
    print(f"{len(plan)} private take(s) {'sealed' if args.go else 'to seal (dry run; add --go)'}."
          " The plaintext these files replace stays on the drive until it trims those blocks.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("encrypt-existing")
    e.add_argument("--comfy", type=Path, required=True, help="ComfyUI's base directory")
    e.add_argument("--user", required=True, help="the ComfyUI user id (user/<id>)")
    e.add_argument("--go", action="store_true", help="seal them (without it: only list)")
    args = ap.parse_args()
    encrypt_existing(args)


if __name__ == "__main__":
    main()
