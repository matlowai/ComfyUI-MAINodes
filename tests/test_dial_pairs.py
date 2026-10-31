#!/usr/bin/env python3
"""Make Dial pair-text extensions: '(words:w)' spans and '!' hold pairs.

  python tests/test_dial_pairs.py      (uses the ComfyUI checkout two levels up, or $COMFYUI_ROOT)

CPU only, no model files. A stand-in text encoder maps each prompt to fixed random token vectors, so encodings are
exact and the checks are algebraic:
  1. weighted_terms expands spans as enc(without) + w * (enc(with) - enc(without)), with tidy spacing;
  2. a one-sided span at weight w gives exactly w times the weight-1 dial (debias is linear);
  3. hold pairs leave the dial orthogonal to the held direction, and the report says how much they removed;
  4. a dial built without holds is unchanged by this feature.
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
    pairs, holds = core.parse_pairs("x ||| y\n! q ||| l\n# note", "")
    assert pairs == [("x", "y")] and holds == [("q", "l")]

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
    assert "holds" in kept["meta"] and "holds" not in free["meta"]
    pre, report_pre = core.make_dial(clip, model, face + "\n" + loud, subjects, "face_hold_pre", "pre")
    assert "calibrated" in report_pre and "hold pairs removed" in report_pre, report_pre
    print("dial pairs: all checks passed")


if __name__ == "__main__":
    main()
