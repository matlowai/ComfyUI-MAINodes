#!/usr/bin/env python3
"""Make Dial pair-text extensions: '(words:w)' spans and '!' hold pairs.

  python tests/test_dial_pairs.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files. A stand-in text encoder maps each prompt to fixed random token vectors, so encodings are
exact and the checks are algebraic:
  1. weighted_terms expands spans as enc(without) + w * (enc(with) - enc(without)), with tidy spacing;
  2. a one-sided span at weight w gives exactly w times the weight-1 dial (debias is linear);
  3. hold pairs leave the dial orthogonal to the held direction, and the report says how much they removed;
  4. a dial built without holds is unchanged by this feature;
  5. named groups remove both directions, including their nuisance components, with shares summing to the total;
  6. one named or unnamed group uses the original projection bit for bit; redundant groups add no constraint.
Exit code 0 = pass.
"""
import importlib
import importlib.util
import os
import sys
import zlib

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
COMFY = os.environ.get("COMFYUI_ROOT") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))  # COMFYUI_ROOT for checkouts outside custom_nodes
sys.path.insert(0, COMFY)

import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True  # before model_management picks a device
import comfy.model_patcher  # noqa: E402


def load_core():
    pkg_dir = os.path.join(HERE, "..", "dials")
    spec = importlib.util.spec_from_file_location("mai_dials", os.path.join(pkg_dir, "__init__.py"), submodule_search_locations=[pkg_dir])
    pkg = importlib.util.module_from_spec(spec)
    sys.modules["mai_dials"] = pkg
    spec.loader.exec_module(pkg)
    return importlib.import_module("mai_dials.core")


core = load_core()
H = 16


class MiniMaxH3Model(torch.nn.Module):  # the class name is what Make Dial checks
    def __init__(self):
        super().__init__()
        self.condition_proj = torch.nn.Linear(H, H)
        self.token_refiner = torch.nn.Sequential(torch.nn.Linear(H, H), torch.nn.Tanh(), torch.nn.Linear(H, H))


class Fake(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.diffusion_model = MiniMaxH3Model()

    def get_dtype_inference(self):
        return torch.float32


class FakeClip:
    """One deterministic random vector per word, so every prompt has an exact, repeatable encoding."""

    def tokenize(self, text):
        return text

    def encode_from_tokens_scheduled(self, text):
        words = text.split() or [""]
        vecs = [torch.randn(H, generator=torch.Generator().manual_seed(zlib.crc32(w.encode()))) for w in words]
        return [[torch.stack(vecs).unsqueeze(0), {}]]


def main():
    torch.manual_seed(0)
    assert core.weighted_terms("a man talks.") == [("a man talks.", 1.0)]
    assert core.weighted_terms("a man talks (loudly:2).") == [("a man talks.", -1.0), ("a man talks loudly.", 2.0)], core.weighted_terms("a man talks (loudly:2).")
    assert core.weighted_terms("he says (softly:1), then (smiles:0.5)") == [("he says, then", -0.5), ("he says softly, then", 1.0), ("he says, then smiles", 0.5)]
    assert core.plain_text("a man talks (very loudly:2).") == "a man talks very loudly."
    pairs, _, holds = core.parse_pairs("x ||| y\n! q ||| l\n# note", "")
    assert pairs == [("x", "y")] and holds == {"": [("q", "l")]}
    pairs, _, holds = core.parse_pairs("{subject} a ||| {subject} b\n![voice] q ||| l\n! u ||| v\n"
                                   "![motion] s ||| t\n![voice] w ||| z", "A man\n# skip\nA woman")
    assert pairs == [("A man a", "A man b"), ("A woman a", "A woman b")]
    assert list(holds) == ["voice", "", "motion"]
    assert holds["voice"] == [("q", "l"), ("q", "l"), ("w", "z"), ("w", "z")]
    assert holds[""] == [("u", "v"), ("u", "v")]
    assert core.parse_pairs("a ||| b\n![] c ||| d\n! e ||| f", "")[2] == {"": [("c", "d"), ("e", "f")]}
    try:
        core.parse_pairs("a ||| b\n![voice c ||| d", "")
    except ValueError as exc:
        assert "![name]" in str(exc)
    else:
        raise AssertionError("an unclosed group name must report the syntax error")

    model = comfy.model_patcher.ModelPatcher(Fake(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
    clip = FakeClip()
    subjects = "A man\nA woman\nA nurse"
    face = "{subject} talks with a blank face. ||| {subject} talks with an expressive face, eyebrows moving.\n" \
           "{subject} listens, stoic. ||| {subject} listens, reacting with big expressions."
    loud = "! {subject} speaks quietly. ||| {subject} speaks loudly.\n! {subject} murmurs. ||| {subject} shouts."

    one, _ = core.make_dial(clip, model, "{subject} talks. ||| {subject} talks (loudly:1).", subjects, "w1", "post")
    two, _ = core.make_dial(clip, model, "{subject} talks. ||| {subject} talks (loudly:2).", subjects, "w2", "post")
    assert torch.allclose(two["vec"], 2 * one["vec"], atol=1e-4), "a one-sided span at weight 2 must double the dial"

    free, _ = core.make_dial(clip, model, face, subjects, "face", "post")
    kept, report = core.make_dial(clip, model, face + "\n" + loud, subjects, "face_hold", "post")
    assert "hold pairs removed" in report, report
    held, _ = core.make_dial(clip, model, loud.replace("! ", ""), subjects, "loud", "post")
    # the hold direction is the loudness dial; the held face dial has no component along it
    cos = float(torch.nn.functional.cosine_similarity(kept["vec"], held["vec"], dim=0))
    assert abs(cos) < 1e-4, cos
    assert float(torch.nn.functional.cosine_similarity(free["vec"], held["vec"], dim=0)) != 0
    free_again, _ = core.make_dial(clip, model, face, subjects, "face", "post")
    assert torch.equal(free["vec"], free_again["vec"])
    assert "hold_groups" in kept["meta"] and "hold_groups" not in free["meta"]
    pre, report_pre = core.make_dial(clip, model, face + "\n" + loud, subjects, "face_hold_pre", "pre")
    assert "calibrated" in report_pre and "hold pairs removed" in report_pre, report_pre

    motion = "{subject} stands still. ||| {subject} walks.\n{subject} sits still. ||| {subject} dances."
    groups = loud.replace("! ", "![voice] ") + "\n" + "\n".join("![motion] " + line for line in motion.splitlines())
    for mode in ("post", "pre"):
        for debias in (False, True):
            kwargs = dict(debias=debias, calibrate=False)
            free, _ = core.make_dial(clip, model, face, subjects, "free", mode, **kwargs)
            voice, _ = core.make_dial(clip, model, loud.replace("! ", ""), subjects, "voice", mode, **kwargs)
            moving, _ = core.make_dial(clip, model, motion, subjects, "motion", mode, **kwargs)
            named, report = core.make_dial(clip, model, face + "\n" + groups, subjects, "named", mode, **kwargs)
            for direction in (voice["vec"], moving["vec"]):
                cos = float(torch.nn.functional.cosine_similarity(named["vec"], direction, dim=0))
                assert abs(cos) < 1e-5, (mode, debias, cos)
            shares = named["meta"]["hold_group_removed"]
            removed = float(1 - named["vec"].square().sum() / free["vec"].square().sum())
            assert abs(sum(shares.values()) - removed) < 1e-6, (shares, removed)
            assert all(0 <= share <= 1 for share in shares.values()), shares
            assert "hold group [voice] removed" in report and "hold group [motion] removed" in report
            reversed_groups = "\n".join(reversed(groups.splitlines()))
            reordered, _ = core.make_dial(clip, model, face + "\n" + reversed_groups, subjects, "reordered", mode, **kwargs)
            assert torch.allclose(named["vec"], reordered["vec"], atol=1e-6)
            mixed, _ = core.make_dial(clip, model, face + "\n" + groups.replace("![voice]", "!"), subjects, "mixed", mode, **kwargs)
            assert torch.equal(mixed["vec"], named["vec"])
            assert list(mixed["meta"]["hold_groups"]) == ["", "motion"]

            unit = (voice["vec"] / voice["vec"].norm()).unsqueeze(1)
            legacy = free["vec"] - unit @ (unit.T @ free["vec"])
            for prefix in ("!", "![voice]"):
                single, _ = core.make_dial(clip, model, face + "\n" + loud.replace("!", prefix), subjects, "single", mode, **kwargs)
                assert torch.equal(single["vec"], legacy), (mode, debias, prefix)
    named_pre, _ = core.make_dial(clip, model, face + "\n" + loud.replace("!", "![voice]"), subjects, "named_pre", "pre")
    assert torch.equal(named_pre["vec"], pre["vec"]), "naming one group must also preserve pre calibration"

    axes = torch.eye(5)
    nuisance = axes[:, :1]
    directions = [torch.zeros(5), axes[0] + axes[1], 2 * (axes[0] + axes[1]), axes[1] + axes[2], axes[0]]
    basis = core.hold_basis(directions, nuisance)
    assert torch.equal(basis[:, [0, 2, 4]], torch.zeros(5, 3)), "zero, duplicate and nuisance-only groups add no constraint"
    assert torch.allclose(basis[:, [1, 3]].T @ basis[:, [1, 3]], torch.eye(2), atol=1e-6)
    raw = torch.tensor([0., 2., 3., 4., 5.])
    projected = raw - basis @ (basis.T @ raw)
    assert torch.allclose(projected, torch.tensor([0., 0., 0., 4., 5.]), atol=1e-6), projected
    assert torch.allclose(torch.stack(directions) @ projected, torch.zeros(5), atol=1e-6)
    full = core.hold_basis([*axes, axes[1]], None)
    assert torch.allclose(full[:, :5].T @ full[:, :5], torch.eye(5), atol=1e-6)
    assert torch.equal(full[:, 5], torch.zeros(5)), "a full basis cannot gain another direction"
    # prompt sets and pair weights (debias off so the comparisons are exact arithmetic)
    one_pair, _ = core.make_dial(clip, model, "a calm street ||| a stormy street", "", "p", "post", debias=False)
    one_set, _ = core.make_dial(clip, model, "+1 a stormy street\n-1 a calm street", "", "s", "post", debias=False)
    assert torch.allclose(one_set["vec"], one_pair["vec"], atol=1e-5), "a +1/-1 prompt set must equal the plain pair"
    weighted_set, _ = core.make_dial(clip, model, "+2 rain at night\n+ neon signs\n-1 bright midday", "", "ws", "post", debias=False)
    as_pairs, _ = core.make_dial(clip, model, "bright midday ||| rain at night :: 2\nbright midday ||| neon signs :: 1", "", "wp", "post", debias=False)
    assert torch.allclose(weighted_set["vec"], as_pairs["vec"], atol=1e-5), "a weighted set must equal the same mix as weighted pairs"
    assert as_pairs["meta"]["pair_weights"] == [2.0, 1.0] and "pair_weights" not in one_pair["meta"]
    _, w, _ = core.parse_pairs("+ {subject} smiles\n- {subject} frowns\nx ||| y :: 0.5", "A man\nA woman")
    assert w == [0.5, 0.5, 1.0, 1.0], w  # the pair once per subject (as every pair line), then one set per subject
    for bad in ("+1 only plus", "a ||| b\n! c ||| d :: 2", "+0 zero weight\n-1 x", "a ||| b :: 0", "a ||| b :: 0\nc ||| d :: 0"):
        try:
            core.parse_pairs(bad, "")
            raise AssertionError(f"accepted: {bad}")
        except ValueError:
            pass
    assert core.parse_pairs("a ||| b :: 0\nc ||| d", "")[1] == [0.0, 1.0], "one zero-weight pair next to others is fine"
    for mode in ("post", "pre"):  # identical sides: a zero dial with finite bookkeeping, not NaN
        same, report = core.make_dial(clip, model, "{subject} talks. ||| {subject} talks.\n! {subject} sits. ||| {subject} stands.", subjects, "same", mode)
        assert not same["vec"].any() and "nan" not in report and "nan" not in same["meta"]["debias_removed"], report
    events = []

    class Recording(FakeClip):
        def encode_from_tokens_scheduled(self, text):
            events.append("encode")
            return super().encode_from_tokens_scheduled(text)
    load = core.comfy.model_management.load_models_gpu
    core.comfy.model_management.load_models_gpu = lambda models, *a, **kw: (events.append("load"), load(models, *a, **kw))[1]
    try:
        ordered, _ = core.make_dial(Recording(), model, face + "\n" + loud, subjects, "face_hold_pre", "pre")
    finally:
        core.comfy.model_management.load_models_gpu = load
    assert events[-1] == "load" and events.count("load") == 1, "Make Dial encoded text after loading the model"
    assert torch.equal(ordered["vec"], pre["vec"])
    degenerate, _ = core.make_dial(clip, model, face + "\n! {subject} speaks. ||| {subject} speaks.", subjects, "deg", "post")
    assert torch.isfinite(degenerate["vec"]).all(), "a hold group with no difference must remove nothing, not make NaN"
    print("dial pairs: all checks passed")


if __name__ == "__main__":
    main()
