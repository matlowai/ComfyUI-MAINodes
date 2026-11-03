"""The shell surface. A thin client over concept_lab.api, nothing else.

    python -m concept_lab.cli space init [--label NAME]
    python -m concept_lab.cli space status
    python -m concept_lab.cli space doctor
    python -m concept_lab.cli space export OUT.h3space.zip [--include-private]
    python -m concept_lab.cli space import THEIRS.h3space.zip
    python -m concept_lab.cli space list captures

    python -m concept_lab.cli corpus new wave
    python -m concept_lab.cli corpus add wave --kind video --ref clip.mp4 \
        --label subject=alice --label motion=wave --split extract \
        --group alice
    python -m concept_lab.cli corpus status wave
    python -m concept_lab.cli corpus confounds wave --target motion

    python -m concept_lab.cli capture plan wave --arms R,N,0
    python -m concept_lab.cli capture arms-check wave <r_row_id> <n_row_id>
    python -m concept_lab.cli capture record manifest.json

Every command prints JSON on stdout, so a shell pipeline and an agent read
the same bytes. Errors go to stderr with a non-zero exit; a refusal is
never printed as a result.

Run it from the pack directory, or with the pack on PYTHONPATH.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

if __package__ in (None, ""):                    # `python concept_lab/cli.py`
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from concept_lab import api                                    # noqa: E402
from concept_lab.space import INDEX_ENV, TENSOR_ENV            # noqa: E402


def _out(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False))


def _roots(a) -> dict:
    return {"index_root": a.index_root, "tensor_root": a.tensor_root}


def _kv(pairs) -> dict:
    """--label k=v, repeatable. A bare key with no '=' is an error, not a
    flag: silently turning it into k=True is how a corpus acquires a label
    nobody meant."""
    out = {}
    for p in pairs or []:
        if "=" not in p:
            raise SystemExit(f"--label expects key=value, got {p!r}")
        k, v = p.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def build_parser() -> argparse.ArgumentParser:
    """Built separately so the test suite can walk it.

    The dest-collision bug this file carries a comment about is invisible
    from the outside (a silent no-op at exit 0) and obvious from the inside
    (two actions writing one namespace key), so the parser has to be
    reachable without running a command.
    """
    ap = argparse.ArgumentParser(
        prog="concept_lab.cli",
        description="Concept Lab: functional conditioning, from a shell.")
    ap.add_argument("--index-root", default=None,
                    help=f"manifest root (env {INDEX_ENV})")
    ap.add_argument("--tensor-root", default=None,
                    help=f"tensor root (env {TENSOR_ENV})")
    # dest="topic", not "group": an option named --group further down would
    # otherwise write over the subcommand's own dest and the dispatch below
    # would silently match nothing. That is a no-op at exit 0, which is the
    # worst failure a research tool can have, so the two namespaces stay
    # apart on purpose.
    sub = ap.add_subparsers(dest="topic", required=True)

    # ---- space
    sp = sub.add_parser("space").add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("init")
    p.add_argument("--label", default="")
    sp.add_parser("status")
    sp.add_parser("doctor")
    p = sp.add_parser("export")
    p.add_argument("out")
    p.add_argument("--include-private", action="store_true",
                   help="include packs marked private. They can encode a "
                        "likeness; say so out loud rather than by default")
    p.add_argument("--note", default="")
    p = sp.add_parser("import")
    p.add_argument("bundle")
    p = sp.add_parser("list")
    p.add_argument("kind", choices=["corpora", "captures", "deltas", "packs",
                                    "plans"])

    # ---- corpus
    cp = sub.add_parser("corpus").add_subparsers(dest="cmd", required=True)
    p = cp.add_parser("new")
    p.add_argument("name")
    p.add_argument("--notes", default="")
    p = cp.add_parser("add")
    p.add_argument("name")
    p.add_argument("--kind", required=True,
                   choices=["image", "video", "audio", "text", "keyframe",
                            "pack"])
    p.add_argument("--ref", required=True, help="path or uri to the asset")
    p.add_argument("--label", action="append", metavar="K=V")
    p.add_argument("--split", default="extract",
                   choices=["extract", "validate", "adversarial", "null"])
    p.add_argument("--group", dest="matched_group", default=None,
                   help="matched-group id: rows that differ in one factor")
    p.add_argument("--source-id", dest="source_id", default=None,
                   help="shoot/take lineage id: two clips from one take are "
                        "one observation, whatever their bytes say")
    p.add_argument("--notes", default="")
    p = cp.add_parser("status")
    p.add_argument("name")
    p = cp.add_parser("confounds")
    p.add_argument("name")
    p.add_argument("--target", required=True)

    # ---- capture
    kp = sub.add_parser("capture").add_subparsers(dest="cmd", required=True)
    p = kp.add_parser("plan")
    p.add_argument("corpus")
    p.add_argument("--backend", default="h3")
    p.add_argument("--arms", default="R,N,0")
    p.add_argument("--blocks", default=None, help="comma-separated indices")
    p.add_argument("--store", default="stats",
                   choices=["stats", "full", "sketch"])
    p.add_argument("--replicates", type=int, default=1)
    p.add_argument("--allow-containment", action="store_true",
                   help="plan anyway when a source appears in two splits. "
                        "The override is recorded in the plan")
    p = kp.add_parser("arms-check")
    p.add_argument("corpus")
    p.add_argument("r_row")
    p.add_argument("n_row")
    p.add_argument("--backend", default="h3")
    p = kp.add_parser("record")
    p.add_argument("manifest", help="a capture manifest json the tap wrote")
    kp.add_parser("run")

    # ---- pack
    pp = sub.add_parser("pack").add_subparsers(dest="cmd", required=True)
    pp.add_parser("list")
    p = pp.add_parser("show")
    p.add_argument("pack_id")

    return ap


def main(argv=None) -> int:
    a = build_parser().parse_args(argv)
    r = _roots(a)

    try:
        if a.topic == "space":
            if a.cmd == "init":
                _out(api.space_init(label=a.label, **r))
            elif a.cmd == "status":
                _out(api.space_status(**r))
            elif a.cmd == "doctor":
                res = api.space_doctor(**r)
                _out(res)
                return 0 if res["ok"] else 1
            elif a.cmd == "export":
                _out(api.space_export(a.out, include_private=a.include_private,
                                      note=a.note, **r))
            elif a.cmd == "import":
                _out(api.space_import(a.bundle, **r))
            elif a.cmd == "list":
                _out(api.space_list(a.kind, **r))
        elif a.topic == "corpus":
            if a.cmd == "new":
                _out(api.corpus_new(a.name, notes=a.notes, **r))
            elif a.cmd == "add":
                _out(api.corpus_add(a.name, a.kind, a.ref,
                                    labels=_kv(a.label), split=a.split,
                                    matched_group=a.matched_group,
                                    source_id=a.source_id,
                                    notes=a.notes, **r))
            elif a.cmd == "status":
                _out(api.corpus_status(a.name, **r))
            elif a.cmd == "confounds":
                _out(api.corpus_confounds(a.name, a.target, **r))
        elif a.topic == "capture":
            if a.cmd == "plan":
                blocks = ([int(x) for x in a.blocks.split(",") if x.strip()]
                          if a.blocks else None)
                _out(api.capture_plan(a.corpus, backend=a.backend,
                                      arms=tuple(a.arms.split(",")),
                                      blocks=blocks, store=a.store,
                                      replicates=a.replicates,
                                      allow_containment=a.allow_containment,
                                      **r))
            elif a.cmd == "arms-check":
                _out(api.arms_check(a.corpus, a.r_row, a.n_row,
                                    backend=a.backend, **r))
            elif a.cmd == "record":
                with open(a.manifest, encoding="utf-8") as fh:
                    _out(api.capture_record(json.load(fh), **r))
            elif a.cmd == "run":
                api.capture_run()
        elif a.topic == "pack":
            if a.cmd == "list":
                _out(api.pack_list(**r))
            elif a.cmd == "show":
                _out(api.pack_show(a.pack_id, **r))
    except api.NotYetImplemented as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 3
    except Exception as e:                        # a refusal is not a result
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
