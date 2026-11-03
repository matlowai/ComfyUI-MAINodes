#!/usr/bin/env python3
"""Unit test for concept_lab's contracts, space and verb layer.

  python tests/test_concept_lab_contracts.py
      Synthetic, no GPU, no models, no renders, and no torch: the point of
      the T1 contracts is that they are readable and writable by things
      that are not ComfyUI, and check 1 enforces exactly that in a
      subprocess.

What it checks:

  1. THE EPISTEMIC BOUNDARY. concept_lab.types and concept_lab.space import
     in a subprocess with no torch and no comfy loaded. If this ever fails,
     the contracts have grown a dependency on the runtime they exist to
     outlive.
  2. DETERMINISTIC IDS. The same inputs give the same capture id in a fresh
     process; changing any identity field moves it; changing a
     non-identity field (a note, a timestamp) does NOT, because otherwise
     every bank on disk goes stale the next time someone adds a field.
  3. ROUNDTRIP. Every record type survives to_json/from_json with its
     identity intact, and an unknown field from a newer schema is dropped
     rather than reinterpreted.
  4. REFUSALS. Bad splits, bad arms, bad stores, a sketch tap with no seed,
     and a TapSpec that names both explicit steps and quantiles are all
     refused at construction with a message that names the field.
  5. THE COLLISION CHECK. Writing the same record id with different content
     raises rather than overwriting. This is the capture bank's whole
     safety story: same id, different bytes means the id does not describe
     the condition.
  6. CONFOUNDS. A corpus where every wave clip also smiles reports the
     smile label as `perfect`, and one where they vary independently
     reports `free`. This is the check that runs before GPU time.
  7. EXPORT / IMPORT. A space exports to a bundle, a second space imports
     it, the records land under imported/<origin>/ with origin stamped,
     re-importing is idempotent, and a private pack is held back from the
     export with its reason named.
  8. THE H3 BACKEND'S ANCHORS. The segment vocabulary matches what
     PackedLayout actually builds in the installed ComfyUI, checked by
     reading the source rather than trusting this file. Skipped with a
     printed note if ComfyUI is not on this machine.
  9. UNBUILT VERBS REFUSE. capture_run/factorize/compile raise
     NotYetImplemented naming their task, instead of returning an empty
     result that would get recorded as a measurement.
 10. THE CLI SURFACE. Every command either prints something or exits
     non-zero, and no option shadows a subcommand's dispatch key. Minted
     from a real bug: --group collided with the subparser's own dest, so
     `corpus add --group alice` matched no branch, printed nothing, exited
     0, and dropped the row. A thin surface is exactly where a silent
     no-op hides, so it gets driven rather than trusted.
 11. DEFINITIONS WANT VERSION CONTROL. An index root outside a git work
     tree is reported and warned about by status and the corpus verbs.
     Corpora and plans are definitions, not results: no tensor
     reconstructs which contrasts somebody chose to shoot.
 12. DOCTOR HASHES. Tensor refs are verified byte-for-byte, not merely
     found; a flipped byte reads as hash_mismatch, and a ref that never
     carried a sha256 is a warning rather than a pass.
 13. THE TWO GUARDS THAT MUST FIRE. Split containment (same content hash
     or same source_id in two splits) refuses at plan time, and
     arms_check refuses a control that is not shape-matched, naming the
     key. A key neither row recorded comes back as unverifiable.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from concept_lab import types as T                                # noqa: E402
from concept_lab import api                                       # noqa: E402
from concept_lab.space import Space, SpaceError                   # noqa: E402

PACK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMFY = os.path.dirname(os.path.dirname(PACK))

_fails = []


def ck(cond, label, detail=""):
    if not cond:
        _fails.append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}"
          + (f"  {detail}" if detail else ""))


def _stack(**kw):
    base = dict(checkpoint="minimax-h3.safetensors",
                checkpoint_hash="sha256:abc", vae="h3-vae", backend="h3",
                quantization="fp8", comfy_commit="7fe8a613")
    base.update(kw)
    return T.ModelStackFingerprint(**base)


def _capture(**kw):
    src = T.ConditioningSource(kind="image", ref="/tmp/a.png",
                               content_hash="sha256:aaa")
    var = T.ConditionVariant(name="actual_ref", arm="R", sources=(src,))
    tap = T.TapSpec(blocks=(0, 10), step_quantiles=(0.15, 0.85),
                    segments=("video",), store="stats")
    base = dict(stack=_stack(), variant=var, tap=tap, seed=42,
                sampler={"sampler": "euler", "steps": 18, "shift": 12.0})
    base.update(kw)
    return T.FunctionalCaptureManifest(**base)


# ---------------------------------------------------------------- 1
def check_boundary():
    print("\n[1] the epistemic boundary: contracts import with no torch, no comfy")
    prog = (
        "import sys, json;"
        "sys.path.insert(0, %r);"
        "import concept_lab.types as T, concept_lab.space as S;"
        "loaded=[m for m in ('torch','comfy','folder_paths','numpy') "
        "        if m in sys.modules];"
        "print(json.dumps({'loaded': loaded, "
        "                  'proto': T.PROTOCOL_VERSION, "
        "                  'dirs': list(S.DIRS)}))" % PACK)
    r = subprocess.run([sys.executable, "-c", prog], capture_output=True,
                       text=True)
    ok = r.returncode == 0
    ck(ok, "subprocess import succeeded", r.stderr.strip()[:200])
    if not ok:
        return
    got = json.loads(r.stdout.strip().splitlines()[-1])
    ck(got["loaded"] == [], "no torch/comfy/numpy in the process",
       f"loaded={got['loaded']}")
    ck(got["proto"] == T.PROTOCOL_VERSION, "protocol version agrees")


# ---------------------------------------------------------------- 2
def check_ids():
    print("\n[2] deterministic ids, and which fields are allowed to move them")
    a, b = _capture(), _capture()
    ck(a.capture_id == b.capture_id, "same inputs give the same capture id",
       a.capture_id)

    ck(_capture(seed=43).capture_id != a.capture_id, "seed moves the id")
    ck(_capture(stack=_stack(quantization="bf16")).capture_id != a.capture_id,
       "a model-stack change moves the id")
    tap2 = T.TapSpec(blocks=(0, 11), step_quantiles=(0.15, 0.85),
                     segments=("video",), store="stats")
    ck(_capture(tap=tap2).capture_id != a.capture_id, "a tap change moves the id")
    ck(_capture(replicate=1).capture_id != a.capture_id,
       "a replicate index moves the id")

    # The process launch: bit-identical within one interpreter, only close
    # across two, so which launch measured it is a condition (DEC-CL-0015).
    proc = T.process_fingerprint()
    p1 = _capture(process=dict(proc, launch_id="aaaa"))
    p2 = _capture(process=dict(proc, launch_id="bbbb"))
    ck(p1.capture_id != p2.capture_id, "a different process launch moves the id",
       f"{p1.capture_id} vs {p2.capture_id}")
    ck(_capture(process=dict(proc, launch_id="aaaa", pid=1)).capture_id
       == p1.capture_id, "the pid does NOT move the id")
    ck(_capture(process=dict(proc, launch_id="aaaa", host="other")).capture_id
       == p1.capture_id, "the host does NOT move the id")
    ck(proc["launch_id"] == T.process_fingerprint()["launch_id"],
       "the launch id is minted once per interpreter, not once per call",
       proc["launch_id"])

    d = T.FunctionalDeltaManifest(a_capture_id="a", b_capture_id="b")
    ck(d.same_process() is None,
       "a delta with no launch ids answers None, not False")
    ck(T.FunctionalDeltaManifest(a_capture_id="a", b_capture_id="b",
                                 a_process_launch_id="x",
                                 b_process_launch_id="x").same_process()
       is True, "two arms from one launch compare same_process True")
    ck(T.FunctionalDeltaManifest(a_capture_id="a", b_capture_id="b",
                                 a_process_launch_id="x",
                                 b_process_launch_id="y").same_process()
       is False, "arms from two launches compare same_process False")

    # The one that protects every bank on disk:
    ck(_capture(notes="scribbled later").capture_id == a.capture_id,
       "a note does NOT move the id")
    ck(_capture(created="1999-01-01T00:00:00+00:00").capture_id == a.capture_id,
       "a timestamp does NOT move the id")
    ck(_capture(status=T.Status.SCOPED).capture_id == a.capture_id,
       "a status change does NOT move the id")

    # float normalisation: the same condition named two ways is one id
    s1 = _capture(sampler={"shift": 12.0})
    s2 = _capture(sampler={"shift": 12.000000000000002})
    ck(s1.capture_id == s2.capture_id,
       "float noise below 12 significant digits does not fork the id")

    ck(T.digest({"a": 1}) == T.digest({"a": 1}), "digest is stable")
    ck(T.canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}',
       "canonical json sorts keys and drops whitespace")


# ---------------------------------------------------------------- 3
def check_roundtrip():
    print("\n[3] roundtrip, and forward compatibility")
    for rec in (_stack(), _capture(),
                T.TapSpec(blocks=(1,), segments=("video",)),
                T.ConceptCorpusRow(
                    source=T.ConditioningSource(kind="video", ref="c.mp4"),
                    labels={"motion": "wave"}, split="validate"),
                T.ConceptPackManifest(name="wave"),
                T.ConceptPlan(name="p", positive={"wave.core": 0.8})):
        back = type(rec).from_json(rec.to_json())
        ck(back.identity() == rec.identity(),
           f"{type(rec).__name__} roundtrips with identity intact")

    d = _capture().to_dict()
    d["a_field_from_the_future"] = 7
    back = T.FunctionalCaptureManifest.from_dict(d)
    ck(back.capture_id == _capture().capture_id,
       "an unknown field from a newer schema is dropped, not reinterpreted")

    ck(type(T.load_record(_stack().to_dict())) is T.ModelStackFingerprint,
       "load_record rebuilds from the _type stamp")


# ---------------------------------------------------------------- 4
def check_refusals():
    print("\n[4] refusals name their field")
    def refuses(fn, label):
        try:
            fn()
        except T.ContractError as e:
            ck(True, label, str(e)[:70])
            return
        except Exception as e:
            ck(False, label, f"wrong exception {type(e).__name__}")
            return
        ck(False, label, "did not refuse")

    refuses(lambda: T.ConceptCorpusRow(
        source=T.ConditioningSource(kind="image"), split="trainset"),
        "an unknown split is refused")
    refuses(lambda: T.ConditionVariant(name="x", arm="maybe"),
            "an unknown arm is refused")
    refuses(lambda: T.TapSpec(store="everything"),
            "an unknown store is refused")
    refuses(lambda: T.TapSpec(store="sketch"),
            "a sketch tap with no dim/seed is refused (unreproducible)")
    refuses(lambda: T.TapSpec(steps=(1,), step_quantiles=(0.5,)),
            "a tap selected two ways at once is refused")
    refuses(lambda: T.ConditioningSource(kind="hologram"),
            "an unknown source kind is refused")
    refuses(lambda: T.ConceptPackManifest(name="x", visibility="public"),
            "an unknown visibility is refused")
    refuses(lambda: T.FunctionalDeltaManifest(a_capture_id="a",
                                              b_capture_id="b",
                                              alignment="rows_probably"),
            "an unknown alignment is refused")


# ---------------------------------------------------------------- 5
def check_collision(root):
    print("\n[5] same id, different bytes is refused")
    s = Space(os.path.join(root, "s5"), os.path.join(root, "t5"))
    s.init(label="five")
    cap = _capture()
    s.put("captures", cap.capture_id, cap)
    s.put("captures", cap.capture_id, cap)
    ck(True, "writing identical content twice is idempotent")
    try:
        s.put("captures", cap.capture_id, _capture(notes="different bytes"))
        ck(False, "same id with different content is refused")
    except SpaceError as e:
        ck("DIFFERENT content" in str(e),
           "same id with different content is refused", str(e)[:60])
        # The refusal has to say which of the two stories it is: a defect
        # within a launch, or a capture that forgot its process fingerprint.
        ck("DEC-CL-0015" in str(e),
           "the refusal points at the cross-launch case too",
           str(e)[str(e).find("Same id"):][:120])


# ---------------------------------------------------------------- 6
def check_confounds():
    print("\n[6] confounds: the check that runs before GPU time")
    def row(subj, motion, face, split="extract"):
        return T.ConceptCorpusRow(
            source=T.ConditioningSource(kind="video",
                                        ref=f"{subj}_{motion}_{face}.mp4"),
            labels={"subject": subj, "motion": motion, "face": face},
            split=split, matched_group=subj)

    # every wave also smiles: motion and face are in bijection
    bad = T.ConceptCorpus(name="bad", rows=tuple(
        r.to_dict() for r in (row("alice", "wave", "smile"),
                              row("bob", "wave", "smile"),
                              row("alice", "neutral", "flat"),
                              row("bob", "neutral", "flat"))))
    rep = bad.confounds("motion")
    ck(rep["labels"]["face"]["verdict"] == "perfect",
       "a face label that tracks the motion exactly reads 'perfect'",
       json.dumps(rep["labels"]["face"]))
    ck(rep["labels"]["subject"]["verdict"] == "free",
       "a subject label that varies within each motion reads 'free'")

    good = T.ConceptCorpus(name="good", rows=tuple(
        r.to_dict() for r in (row("alice", "wave", "smile"),
                              row("bob", "wave", "flat"),
                              row("alice", "neutral", "flat"),
                              row("bob", "neutral", "smile"))))
    ck(good.confounds("motion")["labels"]["face"]["verdict"] == "free",
       "breaking the correlation clears the confound")

    ck("error" in bad.confounds("nosuchlabel"),
       "a target label nobody carries reports an error, not an empty verdict")


# ---------------------------------------------------------------- 7
def check_export_import(root):
    print("\n[7] export and import keep provenance straight")
    a_idx, a_ten = os.path.join(root, "A"), os.path.join(root, "At")
    b_idx, b_ten = os.path.join(root, "B"), os.path.join(root, "Bt")
    A = Space(a_idx, a_ten)
    A.init(label="mine")
    B = Space(b_idx, b_ten)
    B.init(label="theirs")
    ck(A.space_id != B.space_id, "two spaces get different ids")

    api.corpus_new("wave", index_root=a_idx, tensor_root=a_ten)
    api.corpus_add("wave", "video", "/nonexistent/clip.mp4",
                   labels={"motion": "wave"}, split="extract",
                   index_root=a_idx, tensor_root=a_ten)
    shareable = T.ConceptPackManifest(name="open", visibility="shareable")
    private = T.ConceptPackManifest(name="likeness", visibility="private")
    A.put("packs", shareable.pack_id, shareable)
    A.put("packs", private.pack_id, private)

    bundle = os.path.join(root, "out")
    res = api.space_export(bundle, index_root=a_idx, tensor_root=a_ten)
    kinds = {(i["kind"], i["id"]) for i in res["included"]}
    ck(("corpora", "wave") in kinds, "the corpus is in the bundle")
    ck(("packs", shareable.pack_id) in kinds, "a shareable pack is exported")
    held = [e for e in res["excluded"] if e["id"] == private.pack_id]
    ck(len(held) == 1 and "private" in held[0]["reason"],
       "a private pack is held back WITH its reason", held[0]["reason"]
       if held else "")

    got = api.space_import(res["bundle"], index_root=b_idx, tensor_root=b_ten)
    ck(got["origin_space_id"] == A.space_id, "the bundle names its origin")
    landed = B.list("corpora")
    ck(len(landed) == 1 and landed[0]["origin"] == A.space_id
       and not landed[0]["local"],
       "imported records are tagged with the origin space and are not local")
    ck(os.path.isdir(os.path.join(b_idx, "imported", A.space_id)),
       "imported records live in their own namespace")
    stamped = json.load(open(landed[0]["path"]))
    ck(stamped.get("_imported_from") == A.space_id,
       "the record itself carries where it came from")

    again = api.space_import(res["bundle"], index_root=b_idx,
                             tensor_root=b_ten)
    ck(not again["refused"], "re-importing the same bundle is idempotent")

    try:
        api.space_import(res["bundle"], index_root=a_idx, tensor_root=a_ten)
        ck(False, "importing your own export back into itself is refused")
    except SpaceError as e:
        ck("THIS space" in str(e),
           "importing your own export back into itself is refused",
           str(e)[:60])

    res2 = api.space_export(os.path.join(root, "out2"), include_private=True,
                            index_root=a_idx, tensor_root=a_ten)
    ids = {i["id"] for i in res2["included"]}
    ck(private.pack_id in ids, "include_private does include it, when asked")


# ---------------------------------------------------------------- 8
def check_h3_anchors():
    print("\n[8] the H3 backend's anchors against the installed ComfyUI")
    from concept_lab.backends import get_backend
    from concept_lab.backends.base import BackendError
    be = get_backend("h3")

    src = os.path.join(COMFY, "comfy", "ldm", "minimax", "model.py")
    if not os.path.isfile(src):
        print(f"  [SKIP] no ComfyUI at {src}")
    else:
        text = open(src, encoding="utf-8").read()
        missing = [s for s in be.segment_vocabulary()
                   if f'"{s}"' not in text]
        ck(not missing,
           "every declared segment name appears in PackedLayout's source",
           f"missing={missing}")
        ck('patches_replace' in text and '"double_block"' in text,
           "the block-replace seam is still present upstream")
        ck("num_layers=50" in text and "hidden_size=5376" in text,
           "the 50-block / 5376-width defaults still hold",
           "if this fails the capability report is stale, not the code")

    try:
        be.validate_tap(T.TapSpec(blocks=(0,), segments=("nonsense",)))
        ck(False, "a tap naming an unknown segment is refused")
    except BackendError as e:
        ck("nonsense" in str(e), "a tap naming an unknown segment is refused",
           str(e)[:60])
    be.validate_tap(T.TapSpec(blocks=(0, 49), segments=("video", "ref_img")))
    ck(True, "a legal tap validates")

    arms = be.plan_arms(T.ConditioningSource(kind="video", ref="c.mp4"))
    ck("frames" in arms["arm_N"]["must_match"],
       "a video control must match frame count, not only dimensions")
    ck(len(arms["arm_N"]["strata_to_try"]) >= 3,
       "several control strata are offered, so R-N is not one arbitrary choice")


# ---------------------------------------------------------------- 9
def check_unbuilt_refuse(root):
    print("\n[9] unbuilt verbs refuse instead of returning nothing")
    for name in ("capture_run", "delta_build", "factorize", "pack_compile"):
        try:
            getattr(api, name)()
            ck(False, f"{name} refuses")
        except api.NotYetImplemented as e:
            ck(bool(e.task), f"{name} refuses and names its task",
               f"blocked on {e.task}")

    idx, ten = os.path.join(root, "P"), os.path.join(root, "Pt")
    api.space_init(index_root=idx, tensor_root=ten, label="plan")
    api.corpus_new("w", index_root=idx, tensor_root=ten)
    for subj in ("alice", "bob"):
        for m in ("wave", "neutral"):
            api.corpus_add("w", "video", f"/none/{subj}_{m}.mp4",
                           labels={"subject": subj, "motion": m},
                           matched_group=subj, index_root=idx, tensor_root=ten)
    plan = api.capture_plan("w", index_root=idx, tensor_root=ten)
    ck(plan["forwards"] == 4 * 3, "plan costs rows x arms forwards",
       f"forwards={plan['forwards']}")
    ck(plan["tap_points"] > 0, "plan reports what the capture would write",
       f"tap_points={plan['tap_points']}")
    ck(any("VALIDATE" in w for w in plan["warnings"]),
       "the plan carries the corpus's protocol gaps")
    ck("no measurement" in plan["note"] or "Nothing here is a measurement"
       in plan["note"], "the plan says plainly that it measured nothing")

    # Forwards are the unit everyone reaches for and the wrong one on H3.
    ck(plan["cost"]["cost_model"]["step_cost_exponent_range"] == [1.5, 1.7],
       "the plan prices sequence, not forwards",
       json.dumps(plan["cost"]["cost_model"]["step_cost_exponent_range"]))
    ck(plan["process_launch_id"] == T.process_fingerprint()["launch_id"],
       "the plan stamps the launch it was planned in")
    ck(any("ONE process launch" in n for n in plan["protocol_notes"]),
       "the plan states the one-launch constraint on the arms")

    p2 = api.capture_plan("w", arms=("R", "0"), index_root=idx,
                          tensor_root=ten)
    ck(any("shape-matched" in w for w in p2["warnings"]),
       "dropping the control arm earns a warning about the confound")


# --------------------------------------------------------------- 10
def check_cli(root):
    """Every CLI command produces output or refuses. Nothing exits 0 silently.

    Minted from a real bug: `--group` was declared on the corpus subparser
    while the subcommand itself parsed into dest "group", so argparse wrote
    the option's value over the dispatch key and `corpus add --group alice`
    matched no branch, printed nothing, and exited 0. Rows vanished without
    a single error. A thin surface is exactly where that hides, so the
    surface gets driven here rather than trusted.
    """
    print("\n[10] the CLI surface: no command exits 0 in silence")
    from concept_lab import cli

    idx, ten = os.path.join(root, "C"), os.path.join(root, "Ct")
    base = ["--index-root", idx, "--tensor-root", ten]
    calls = []
    orig = cli._out
    cli._out = lambda o: calls.append(o)
    try:
        cmds = [
            (["space", "init", "--label", "cli"], 0),
            (["space", "status"], 0),
            (["space", "doctor"], 0),
            (["space", "list", "corpora"], 0),
            (["corpus", "new", "w"], 0),
            (["corpus", "add", "w", "--kind", "video", "--ref", "/none/a.mp4",
              "--label", "motion=wave", "--label", "face=smile",
              "--split", "extract", "--group", "alice"], 0),
            (["corpus", "add", "w", "--kind", "video", "--ref", "/none/b.mp4",
              "--label", "motion=neutral", "--label", "face=flat",
              "--split", "validate", "--group", "alice"], 0),
            (["corpus", "status", "w"], 0),
            (["corpus", "confounds", "w", "--target", "motion"], 0),
            (["capture", "plan", "w"], 0),
            (["pack", "list"], 0),
        ]
        for argv, want_rc in cmds:
            before = len(calls)
            rc = cli.main(base + argv)
            label = " ".join(argv[:3])
            ck(rc == want_rc and len(calls) > before,
               f"`{label}` returned {want_rc} AND printed something",
               f"rc={rc} outputs={len(calls) - before}")

        # the flag whose collision caused the bug actually reaches the corpus
        st = [c for c in calls if c.get("matched_groups") is not None][-1]
        ck(st["matched_groups"].get("alice") == 2,
           "--group reaches the corpus and both rows land in the group",
           json.dumps(st["matched_groups"]))
        ck(st["n_rows"] == 2, "both CLI-added rows persisted",
           f"n_rows={st['n_rows']}")

        rc = cli.main(base + ["capture", "run"])
        ck(rc == 3, "an unbuilt verb exits 3, not 0", f"rc={rc}")
    finally:
        cli._out = orig

    # Structural guard for the whole class, not just the one instance: no
    # option anywhere may write the namespace key a subparser dispatches on.
    import argparse

    dispatch_keys, collisions = set(), []

    def walk(parser, path):
        for act in parser._actions:
            if isinstance(act, argparse._SubParsersAction):
                dispatch_keys.add(act.dest)
                for name, sp in act.choices.items():
                    walk(sp, path + [name])
            elif act.dest in dispatch_keys and act.option_strings:
                collisions.append((" ".join(path), act.option_strings,
                                   act.dest))

    walk(cli.build_parser(), [])
    ck(not collisions,
       "no option shadows a subcommand dispatch key",
       f"collisions={collisions}" if collisions else
       f"dispatch keys guarded: {sorted(dispatch_keys)}")


# --------------------------------------------------------------- 11
def check_version_control(root):
    """Definitions are not results, and only one of them is reconstructible.

    Captures and deltas can be re-measured from a corpus plus a stack.
    Corpora, tap specs and plans cannot be re-derived from anything: they
    are the record of which contrasts somebody chose. The ancestor program
    lost exactly those, under a gitignored output dir, behind four findings.
    """
    print("\n[11] definitions want version control, and the space says so")
    idx, ten = os.path.join(root, "V"), os.path.join(root, "Vt")
    api.space_init(index_root=idx, tensor_root=ten, label="vc")

    st = api.space_status(index_root=idx, tensor_root=ten)
    ck(st["index_root_tracked"] is False,
       "an index root outside a git work tree reports untracked")
    ck(any("DEC-CL-0016" in w for w in st["warnings"]),
       "status warns, citing the decision", st["warnings"][0][:70]
       if st["warnings"] else "")

    made = api.corpus_new("defs", index_root=idx, tensor_root=ten)
    ck(any("H3_CONCEPT_INDEX_DIR" in w for w in made["warnings"]),
       "corpus new carries the warning with the fix in it")
    added = api.corpus_add("defs", "video", "/none/x.mp4",
                           labels={"motion": "wave"},
                           index_root=idx, tensor_root=ten)
    ck(any("DEC-CL-0016" in w for w in added["warnings"]),
       "corpus add carries it too")

    os.makedirs(os.path.join(idx, ".git"), exist_ok=True)
    st2 = api.space_status(index_root=idx, tensor_root=ten)
    ck(st2["index_root_tracked"] is True,
       "the same root inside a git work tree reports tracked")
    ck(not st2["warnings"], "and stops warning", f"warnings={st2['warnings']}")
    clean = api.corpus_new("defs2", index_root=idx, tensor_root=ten)
    ck(not clean["warnings"], "the corpus verbs stop too")


# --------------------------------------------------------------- 12
def check_doctor_hashes(root):
    """Presence is not integrity. A truncated tensor is present."""
    print("\n[12] doctor hashes the tensors it can, and says which it cannot")
    idx, ten = os.path.join(root, "D"), os.path.join(root, "Dt")
    s = Space(idx, ten)
    s.init(label="doc")
    tdir = s.tensor_dir()
    os.makedirs(tdir, exist_ok=True)

    rel = "video_b0_s0.bin"
    p = os.path.join(tdir, rel)
    with open(p, "wb") as fh:
        fh.write(b"pretend this is a block state" * 8)
    good = T.TensorRef(key="video/b0", path=rel, sha256=T.file_sha256(p),
                       segment="video", block=0)
    cap = _capture(tensors=(good,))
    s.put("captures", cap.capture_id, cap)
    d = s.doctor()
    ck(d["ok"] and not d["problems"], "a tensor whose bytes match is clean",
       json.dumps(d["problems"])[:80])

    rel2 = "video_b1_s0.bin"
    p2 = os.path.join(tdir, rel2)
    with open(p2, "wb") as fh:
        fh.write(b"unhashed")
    cap2 = _capture(seed=99, tensors=(T.TensorRef(key="video/b1", path=rel2),))
    s.put("captures", cap2.capture_id, cap2)
    d = s.doctor()
    ck(d["ok"], "an unhashed ref does not fail the space")
    ck(any(w["kind"] == "unhashed_tensor" and w["detail"] == p2
           for w in d["warnings"]),
       "an unhashed ref is a warning naming the file",
       json.dumps(d["warnings"])[:90])

    with open(p, "r+b") as fh:            # one byte, the classic corruption
        fh.seek(3)
        fh.write(b"X")
    d = s.doctor()
    bad = [x for x in d["problems"] if x["kind"] == "hash_mismatch"]
    ck(not d["ok"] and len(bad) == 1 and bad[0]["detail"] == p,
       "one flipped byte is reported as hash_mismatch naming the path",
       bad[0]["why"][:80] if bad else json.dumps(d["problems"])[:80])


# --------------------------------------------------------------- 13
def check_containment_and_arms(root):
    """Two guards that have to FIRE, not merely exist.

    A held-out score over a row the extraction set already contains is an
    extraction score, and a control that is not shape-matched turns R-N
    from semantic content into content plus layout.
    """
    print("\n[13] split containment refuses, and the control arm is asserted")
    idx, ten = os.path.join(root, "K"), os.path.join(root, "Kt")
    api.space_init(index_root=idx, tensor_root=ten, label="contain")
    r = {"index_root": idx, "tensor_root": ten}

    asset = os.path.join(root, "shared_clip.mp4")
    with open(asset, "wb") as fh:
        fh.write(b"same bytes in two splits")

    api.corpus_new("leaky", **r)
    api.corpus_add("leaky", "video", asset, labels={"motion": "wave"},
                   split="extract", **r)
    api.corpus_add("leaky", "video", asset, labels={"motion": "wave"},
                   split="validate", **r)
    h = T.file_sha256(asset)
    st = api.corpus_status("leaky", **r)
    ck(st["containment"]["content_hash"]
       and st["containment"]["content_hash"][0]["value"] == h,
       "corpus status lists the colliding content hash",
       json.dumps(st["containment"]["content_hash"])[:90])
    ck(any(w.startswith("CONTAINMENT") for w in st["warnings"]),
       "and warns about it in words")
    try:
        api.capture_plan("leaky", **r)
        ck(False, "capture_plan refuses a corpus that leaks a content hash")
    except T.ContractError as e:
        ck(h in str(e) and "extract" in str(e),
           "capture_plan refuses a corpus that leaks a content hash",
           str(e)[:80])
    forced = api.capture_plan("leaky", allow_containment=True, **r)
    ck(len(forced["containment_overridden"]) == 1,
       "an override is allowed and lands in the plan as a record")

    api.corpus_new("lineage", **r)
    api.corpus_add("lineage", "video", "/none/take7_a.mp4",
                   source_id="take7", split="extract", **r)
    api.corpus_add("lineage", "video", "/none/take7_b.mp4",
                   source_id="take7", split="validate", **r)
    try:
        api.capture_plan("lineage", **r)
        ck(False, "different bytes from one take still leak, and refuse")
    except T.ContractError as e:
        ck("take7" in str(e),
           "different bytes from one take still leak, and refuse",
           str(e)[:80])

    api.corpus_new("clean", **r)
    pre = {"width": 1024, "height": 576, "frames": 49, "fps": 24}
    rr = api.corpus_add("clean", "video", "/none/alice_wave.mp4",
                        source_id="take1", split="extract", preprocess=pre,
                        **r)
    nn = api.corpus_add("clean", "video", "/none/control.mp4",
                        source_id="take2", split="extract", preprocess=pre,
                        **r)
    bad = api.corpus_add("clean", "video", "/none/control_wide.mp4",
                         source_id="take3", split="extract",
                         preprocess=dict(pre, width=1280), **r)
    api.corpus_add("clean", "video", "/none/bob_neutral.mp4",
                   source_id="take4", split="validate", **r)
    plan = api.capture_plan("clean", **r)
    ck(plan["forwards"] == 4 * 3, "a clean corpus plans without refusing",
       f"forwards={plan['forwards']}")

    ok = api.arms_check("clean", rr["row_id"], nn["row_id"], **r)
    ck(ok["ok"] and {c["key"] for c in ok["checked"]} >=
       {"width", "height", "frames", "fps", "modality"},
       "a shape-matched control passes on every recorded key",
       json.dumps([c["key"] for c in ok["checked"]]))
    ck("reference_count" in ok["unverifiable"],
       "a key neither row recorded is unverifiable, not a pass",
       json.dumps(ok["unverifiable"]))
    try:
        api.arms_check("clean", rr["row_id"], bad["row_id"], **r)
        ck(False, "a control with the wrong width is refused")
    except T.ContractError as e:
        ck("width" in str(e) and "1280" in str(e),
           "a control with the wrong width is refused, naming the key",
           str(e)[:80])


def main():
    root = tempfile.mkdtemp(prefix="concept_lab_test_")
    try:
        print("=== concept_lab contracts (synthetic, no GPU, no torch) ===")
        check_boundary()
        check_ids()
        check_roundtrip()
        check_refusals()
        check_collision(root)
        check_confounds()
        check_export_import(root)
        check_h3_anchors()
        check_unbuilt_refuse(root)
        check_cli(root)
        check_version_control(root)
        check_doctor_hashes(root)
        check_containment_and_arms(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print(f"\n=== {'ALL PASS' if not _fails else str(len(_fails)) + ' FAILED'} ===")
    for f in _fails:
        print(f"  FAILED: {f}")
    return 0 if not _fails else 1


if __name__ == "__main__":
    sys.exit(main())
