#!/usr/bin/env python3
"""CPU picture-dial contracts with tagged conditioning; no model files or downloads.

COMFYUI_ROOT=/path/to/ComfyUI CUDA_VISIBLE_DEVICES= python tests/test_dial_pictures.py
"""
import importlib
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

import torch

HERE = Path(__file__).resolve().parent
COMFY = os.environ.get("COMFYUI_ROOT") or str(HERE.parents[2])
sys.path.insert(0, COMFY)
import comfy.cli_args
comfy.cli_args.args.cpu = True
import comfy.model_patcher
import folder_paths

pkg_dir = HERE.parent / "dials"
spec = importlib.util.spec_from_file_location("mai_dials", pkg_dir / "__init__.py", submodule_search_locations=[str(pkg_dir)])
pkg = importlib.util.module_from_spec(spec)
sys.modules["mai_dials"] = pkg
spec.loader.exec_module(pkg)
core = importlib.import_module("mai_dials.core")
nodes = importlib.import_module("mai_dials.nodes")

H = 8
PROMPT = "A video in the style and content of <Picture 1>."
SCALE = torch.arange(1, H + 1, dtype=torch.float32)


class MixingRefiner(torch.nn.Module):
    def forward(self, x):
        # Like attention, the text outputs depend on vision rows. Masking before this step is wrong.
        return x + x.mean(0) / 8


class MiniMaxH3Model(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.condition_proj = torch.nn.Linear(H, H, bias=False)
        with torch.no_grad():
            self.condition_proj.weight.copy_(torch.diag(SCALE))
        self.token_refiner = MixingRefiner()


class FakeModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.diffusion_model = MiniMaxH3Model()

    def get_dtype_inference(self):
        return torch.float32


def picture_rows(index):
    label = torch.arange(H, dtype=torch.float32).unsqueeze(0)
    vision = torch.full((index % 3 + 1, H), 100.0 * index)
    text = torch.arange((index % 2 + 1) * H, dtype=torch.float32).reshape(-1, H) * (index + 1)
    text[:, 0] += index * 3
    return label, vision, text


def expected_mean(index):
    label, vision, text = picture_rows(index)
    # Text-only mean after refinement; the prefix label is also a text token.
    return (torch.cat([label, text]).mean(0) + torch.cat([label, vision, text]).mean(0) / 8) * SCALE


def pictures(*indices):
    return torch.stack([torch.full((4, 5, 3), i / 10.0) for i in indices])


class FakeClip:
    def __init__(self, tags="valid"):
        self.tags = tags
        self.calls = []

    def tokenize(self, text, **kwargs):
        self.calls.append((text, kwargs))
        return text, kwargs

    def encode_from_tokens_scheduled(self, tokens):
        text, kwargs = tokens
        if not kwargs:
            if text in ("nuisance A", "nuisance B"):
                ctx = torch.zeros(1, H)
                ctx[0, 0] = float(text.endswith("B"))
            else:
                ctx = torch.randn(3, H, generator=torch.Generator().manual_seed(zlib.crc32(text.encode())))
            return [[ctx.unsqueeze(0), {}]]
        refs = kwargs["minimax_ref_items"]
        assert len(refs) == 1 and refs[0]["type"] == "image"
        assert refs[0]["data"].shape == (1, 4, 5, 3)
        index = round(float(refs[0]["data"][0, 0, 0, 0]) * 10)
        label, vision, text_rows = picture_rows(index)
        ctx = torch.cat([label, vision, text_rows])
        tags = torch.tensor([1] + [0] * len(vision) + [1] * len(text_rows))
        if self.tags == "missing":
            extra = {}
        else:
            if self.tags == "short":
                tags = tags[:-1]
            elif self.tags == "vision_only":
                tags = torch.zeros_like(tags)
            elif self.tags == "batched":
                tags = tags.unsqueeze(0)
            extra = {"minimax_token_tags": tags}
        return [[ctx.unsqueeze(0), extra]]


class PictureDialTests(unittest.TestCase):
    def setUp(self):
        self.inference = torch.inference_mode()
        self.inference.__enter__()
        self.addCleanup(self.inference.__exit__, None, None, None)
        self.model = comfy.model_patcher.ModelPatcher(FakeModel(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
        self.clip = FakeClip()
        self.a, self.b = pictures(1, 2), pictures(3, 4)

    def make(self, **kwargs):
        args = dict(clip=self.clip, model=self.model, pictures_a=self.a, pictures_b=self.b,
                    prompt=PROMPT, name="pictures_test", debias=False, nuisance_dims=3)
        args.update(kwargs)
        return core.make_picture_dial(**args)

    def test_full_sequence_then_text_pooling_and_index_agreement(self):
        dial, report = self.make()
        diffs = torch.stack([expected_mean(3) - expected_mean(1), expected_mean(4) - expected_mean(2)])
        expected = diffs.mean(0)
        torch.testing.assert_close(dial["vec"], expected)
        agreement = float(torch.nn.functional.cosine_similarity(diffs, expected.unsqueeze(0)).mean())
        self.assertEqual(dial["meta"]["pair_agreement_cos"], f"{agreement:.3f}")
        self.assertEqual(dial["meta"]["pairs"], [[0, 0], [1, 1]])
        self.assertEqual(dial["meta"]["n_pairs"], "2")
        self.assertEqual((dial["target"], dial["mode"]), ("token_refiner", "post"))
        self.assertIn("paired by index", report)
        self.assertEqual([text for text, _ in self.clip.calls], [PROMPT] * 4)
        self.assertFalse(dial["vec"].requires_grad)
        self.assertEqual(dial["vec"].device.type, "cpu")
        flipped, _ = self.make(pictures_a=self.b, pictures_b=self.a)
        torch.testing.assert_close(flipped["vec"], -expected)

    def test_unequal_counts_give_each_picture_equal_weight(self):
        dial, report = self.make(pictures_b=pictures(3, 4, 5))
        expected = torch.stack([expected_mean(i) for i in (3, 4, 5)]).mean(0) - torch.stack([expected_mean(i) for i in (1, 2)]).mean(0)
        torch.testing.assert_close(dial["vec"], expected)
        self.assertFalse(dial["meta"]["paired_by_index"])
        self.assertEqual(dial["meta"]["n_pairs"], "0")
        self.assertEqual(dial["meta"]["pair_agreement_cos"], "n/a")
        self.assertIn("side means only; pair agreement n/a", report)
        self.assertEqual((dial["meta"]["n_pictures_a"], dial["meta"]["n_pictures_b"]), (2, 3))

    def test_debias_removes_same_wording_basis_as_text_dial(self):
        raw, _ = self.make()
        with patch.object(core, "NUISANCE_PAIRS", ["nuisance A ||| nuisance B"]), patch.object(core, "NUISANCE_SUBJECTS", ""):
            dial, report = self.make(debias=True, nuisance_dims=1)
        expected = raw["vec"].clone()
        expected[0] = 0
        torch.testing.assert_close(dial["vec"], expected)
        removed = float(raw["vec"][0].square() / raw["vec"].square().sum())
        self.assertEqual(dial["meta"]["debias_removed"], f"{removed:.3f}")
        self.assertIn("debias removed", report)

    def test_default_nuisance_pairs_and_batched_tags(self):
        dial, _ = self.make(debias=True)
        self.assertTrue(torch.isfinite(dial["vec"]).all())
        plain, _ = self.make()
        batched, _ = self.make(clip=FakeClip("batched"))
        self.assertTrue(torch.equal(plain["vec"], batched["vec"]))

    def test_identical_sides_report_finite_zero(self):
        for debias in (False, True):
            with self.subTest(debias=debias):
                dial, report = self.make(pictures_b=self.a, debias=debias)
                self.assertEqual(float(dial["vec"].norm()), 0.0)
                self.assertEqual(dial["meta"]["pair_agreement_cos"], "n/a")
                self.assertNotIn("nan", report)
                self.assertIn("zero dial", report)

    def test_wrong_encoder_and_no_text_fail_clearly(self):
        for kwargs, message in [
            ({"clip": FakeClip("missing")}, "requires minimax_token_tags"),
            ({"clip": FakeClip("vision_only")}, "at least one text token"),
        ]:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, message):
                self.make(**kwargs)

    def test_v3_node_registration_and_saved_dial_roundtrip(self):
        cls = nodes.NODE_CLASS_MAPPINGS["MAIDialMakeFromPictures"]
        schema = cls.GET_SCHEMA()
        self.assertTrue(schema.is_output_node)
        inputs = {item.id: item for item in schema.inputs}
        self.assertEqual(inputs["prompt"].default, PROMPT)
        self.assertEqual(inputs["pictures_a"].io_type, "IMAGE")
        self.assertEqual(inputs["pictures_b"].io_type, "IMAGE")
        # Retain test artifacts: the study's rules forbid deleting even temporary output files.
        scratch = tempfile.mkdtemp(prefix="C1_picture_dial_")
        self.addCleanup(shutil.rmtree, scratch)
        with patch.dict(folder_paths.folder_names_and_paths, {"loras": ([scratch], {".safetensors"})}):
            result = cls.execute(self.clip, self.model, self.a, self.b, PROMPT, "C1_picture_test", debias=False, nuisance_dims=3)
            loaded = core.load_dial("dials/C1_picture_test.safetensors")
            self.assertTrue(torch.equal(loaded["vec"], result.result[0]["vec"].to(torch.bfloat16).float()))
            self.assertEqual(loaded["meta"]["source"], "pictures")
            self.assertIn("saved", result.ui.as_dict()["text"][0])
            with patch.object(core, "save_dial") as save:
                unsaved = cls.execute(self.clip, self.model, self.a, self.b, PROMPT, "", debias=False, nuisance_dims=3)
                save.assert_not_called()
                self.assertEqual(unsaved.result[0]["meta"]["name"], "unsaved")


if __name__ == "__main__":
    unittest.main(verbosity=2)
