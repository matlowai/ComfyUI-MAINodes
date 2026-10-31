#!/usr/bin/env python3
"""CPU video-pair contracts; run with COMFYUI_ROOT and CUDA_VISIBLE_DEVICES=."""
from fractions import Fraction
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch

import test_dial_pictures as pictures

core, nodes = pictures.core, pictures.nodes
PROMPT = "A video in the style and content of <Video 1>."


def video(*values, fps=2):
    return pictures.pictures(*values), fps


def video_rows(item):
    values = item["data"][:, 0, 0, 0] * 10
    vision = values[:, None].expand(-1, pictures.H) * 100
    times = torch.tensor(item["timestamps"])[:, None].expand(-1, pictures.H)
    text = torch.arange(pictures.H).float()[None, :] + (values * torch.arange(1, len(values) + 1)).sum()
    return vision, torch.cat([times, text])


def expected(item):
    vision, text = video_rows(item)
    return (text.mean(0) + torch.cat([vision, text]).mean(0) / 8) * pictures.SCALE


class FakeVideoClip(pictures.FakeClip):
    def encode_from_tokens_scheduled(self, tokens):
        _, kwargs = tokens
        if not kwargs:
            return super().encode_from_tokens_scheduled(tokens)
        refs = kwargs["minimax_ref_items"]
        assert len(refs) == 1 and refs[0]["type"] == "video"
        assert len(refs[0]["data"]) == len(refs[0]["timestamps"])
        vision, text = video_rows(refs[0])
        tags = torch.tensor([0] * len(vision) + [1] * len(text))
        if self.tags == "vision_only":
            tags.zero_()
        extra = {} if self.tags == "missing" else {"minimax_token_tags": tags}
        return [[torch.cat([vision, text]).unsqueeze(0), extra]]


class FakeVideo:
    def __init__(self, data):
        self.data = data

    def get_components(self):
        return SimpleNamespace(images=self.data[0], frame_rate=self.data[1], audio=object())


class VideoDialTests(unittest.TestCase):
    def setUp(self):
        self.inference = torch.inference_mode()
        self.inference.__enter__()
        self.addCleanup(self.inference.__exit__, None, None, None)
        self.model = pictures.comfy.model_patcher.ModelPatcher(pictures.FakeModel(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
        self.clip = FakeVideoClip()
        self.a = [video(1, 2, 3), video(2, 3)]
        self.b = [video(4, 6, 8), video(6, 8, 9, 10)]

    def make(self, **kwargs):
        args = dict(clip=self.clip, model=self.model, videos_a=self.a, videos_b=self.b,
                    prompt=PROMPT, name="video_test", debias=False)
        args.update(kwargs)
        return core.make_video_dial(**args)

    def test_two_fps_and_source_timestamps(self):
        frames = torch.arange(141).reshape(-1, 1, 1, 1).float()
        for fps, count, indices in [
            (24, 141, list(range(0, 141, 12))),
            (30, 61, [0, 15, 30, 45, 60]),
            (Fraction(24000, 1001), 48, [0, 11, 23, 35, 47]),
            (1, 3, [0, 1, 2]),
        ]:
            with self.subTest(fps=fps):
                item = core.video_reference(frames[:count], fps)
                self.assertEqual(item["data"].flatten().tolist(), indices)
                self.assertEqual(item["timestamps"], [i / float(fps) for i in indices])

    def test_text_pooling_after_refinement_and_equal_clip_weight(self):
        dial, report = self.make()
        a = torch.stack([expected(core.video_reference(*v)) for v in self.a])
        b = torch.stack([expected(core.video_reference(*v)) for v in self.b])
        diff = b - a
        torch.testing.assert_close(dial["vec"], diff.mean(0))
        agreement = float(torch.nn.functional.cosine_similarity(diff, diff.mean(0)[None, :]).mean())
        self.assertEqual(dial["meta"]["pair_agreement_cos"], f"{agreement:.3f}")
        self.assertEqual(dial["meta"]["pairs"], [[0, 0], [1, 1]])
        self.assertEqual(dial["meta"]["timestamps_a"], [[0, .5, 1], [0, .5]])
        self.assertEqual((dial["target"], dial["mode"]), ("token_refiner", "post"))
        self.assertIn("audio excluded", report)
        self.assertEqual([text for text, _ in self.clip.calls], [PROMPT] * 4)
        flipped, _ = self.make(videos_a=self.b, videos_b=self.a)
        self.assertTrue(torch.equal(flipped["vec"], -dial["vec"]))

    def test_unequal_counts_average_clips_and_report_na(self):
        dial, report = self.make(videos_a=self.a[:1])
        target = torch.stack([expected(core.video_reference(*v)) for v in self.b]).mean(0) - expected(core.video_reference(*self.a[0]))
        torch.testing.assert_close(dial["vec"], target)
        self.assertEqual(dial["meta"]["pair_agreement_cos"], "n/a")
        self.assertEqual((dial["meta"]["n_videos_a"], dial["meta"]["n_videos_b"]), (1, 2))
        self.assertIn("side means only", report)

    def test_frame_order_reaches_encoder(self):
        dial, _ = self.make(videos_a=[video(1, 2, 3)], videos_b=[video(3, 2, 1)])
        self.assertGreater(float(dial["vec"].norm()), 0)

    def test_debias_and_zero(self):
        raw, _ = self.make()
        with patch.object(core, "NUISANCE_PAIRS", ["nuisance A ||| nuisance B"]), patch.object(core, "NUISANCE_SUBJECTS", ""):
            dial, _ = self.make(debias=True, nuisance_dims=1)
        target = raw["vec"].clone()
        target[0] = 0
        torch.testing.assert_close(dial["vec"], target)
        zero, report = self.make(videos_b=self.a, debias=True)
        self.assertEqual(float(zero["vec"].norm()), 0)
        self.assertEqual(zero["meta"]["pair_agreement_cos"], "n/a")
        self.assertIn("zero dial", report)

    def test_wrong_encoder_and_no_text(self):
        for tags, message in [("missing", "requires minimax_token_tags"), ("vision_only", "at least one text token")]:
            with self.subTest(tags=tags), self.assertRaisesRegex(ValueError, message):
                self.make(clip=FakeVideoClip(tags))

    def test_v3_numeric_index_order_and_roundtrip(self):
        cls = nodes.NODE_CLASS_MAPPINGS["MAIDialMakeFromVideos"]
        self.assertTrue(cls.GET_SCHEMA().is_output_node)
        a = {"video_a_10": FakeVideo(self.a[1]), "video_a_2": FakeVideo(self.a[0])}
        b = {"video_b_2": FakeVideo(self.b[0]), "video_b_10": FakeVideo(self.b[1])}
        scratch = tempfile.mkdtemp(prefix="C4_video_dial_")
        with patch.dict(pictures.folder_paths.folder_names_and_paths, {"loras": ([scratch], {".safetensors"})}):
            result = cls.execute(self.clip, self.model, a, b, PROMPT, "C4_video_test", debias=False)
            reference, _ = self.make()
            self.assertTrue(torch.equal(result.result[0]["vec"], reference["vec"]))
            saved = core.load_dial("dials/C4_video_test.safetensors")
            self.assertTrue(torch.equal(saved["vec"], reference["vec"].to(torch.bfloat16).float()))
            self.assertEqual(saved["meta"]["source"], "videos")
            self.assertIn("saved", result.ui.as_dict()["text"][0])
            with patch.object(core, "save_dial") as save:
                cls.execute(self.clip, self.model, a, b, PROMPT, "", debias=False)
                save.assert_not_called()
        print(f"C4 retained artifact: {scratch}/dials/C4_video_test.safetensors")


if __name__ == "__main__":
    unittest.main(verbosity=2)
