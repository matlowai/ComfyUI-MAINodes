"""Run from root: python -m unittest discover -s tests -v (CPU-only)."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "relayvsr_package_under_test"
if PACKAGE not in sys.modules:
    pkg = types.ModuleType(PACKAGE)
    pkg.__path__ = [str(ROOT)]
    sys.modules[PACKAGE] = pkg

from relayvsr_package_under_test import bridge, nodes


class RelayVSRBridgeTests(unittest.TestCase):
    def setUp(self):
        self.ctx = tempfile.TemporaryDirectory(prefix="relayvsr_test_")
        self.addCleanup(self.ctx.cleanup)
        self.base = Path(self.ctx.name)
        self.root = self.base / "LightX2V"
        (self.root / "lightx2v").mkdir(parents=True)
        (self.root / "lightx2v" / "infer.py").write_text("# placeholder\\n")
        (self.root / "lightx2v" / "__init__.py").write_text("")
        cfg = self.root / "configs" / "relayvsr"
        cfg.mkdir(parents=True)
        for model, scale in (("relayvsr_x2", 2), ("relayvsr_x4", 4)):
            for variant in ("", "_block_offload", "_sp"):
                data = {"native_scale": scale, "clip_len": 16, "cpu_offload": variant == "_block_offload"}
                if variant == "_sp":
                    data["parallel"] = {"seq_p_size": 2, "seq_p_attn_type": "ulysses"}
                (cfg / f"{model}{variant}.json").write_text(json.dumps(data))
        self.weights2 = self.base / "models" / "x2"
        self.weights2.mkdir(parents=True)
        for fname in ("wan_x2.safetensors", "flash_x2.safetensors"):
            (self.weights2 / fname).write_bytes(b"x" * 256)
        self.weights4 = self.base / "models" / "x4"
        self.weights4.mkdir(parents=True)
        for fname in ("wan.safetensors", "flash.safetensors"):
            (self.weights4 / fname).write_bytes(b"x" * 256)
        self.input = self.base / "input.mp4"
        self.input.write_bytes(b"fake-video-for-wrapper-test")
        self.s = bridge.Settings(lightx2v_root=str(self.root), model_dir=str(self.weights2),
                                 python_executable=sys.executable, preserve_audio=False)

    def test_x2_settings_and_config(self):
        self.s.validate()
        with tempfile.TemporaryDirectory() as tmp:
            config_path = bridge.make_config(self.root, self.s, Path(tmp))
            c = json.loads(config_path.read_text())
            self.assertEqual(c["native_scale"], 2)
            self.assertFalse(c["use_compile"])
            self.assertEqual(c["video_codec"], "libx264")
            command = bridge.build_command(self.root, self.s, self.input, Path(tmp) / "output.mp4", config_path, 123)
        self.assertIn("relayvsr_x2", command)
        self.assertEqual(command[command.index("--sr_ratio")+1], "2")
        self.assertIn(str(self.weights2), command)
        self.assertIn("--seed", command)
        self.assertNotIn("-m", command[:1])

    def test_x2_refuses_4x_even_if_original_supports_2x(self):
        with self.assertRaisesRegex(ValueError, "only supports"):
            bridge.Settings(output_scale=4).validate()
        original = bridge.Settings(variant="X4 original (recommended, also for 2x)", output_scale=2, model_dir=str(self.weights4))
        original.validate()

    def test_incompatible_checkpoint_pair_rejected(self):
        with self.assertRaisesRegex(FileNotFoundError, "wan_x2"):
            bridge.find_weights(self.root, str(self.weights4), "X2 native")
        (self.weights2 / "flash_x2.safetensors").write_text("stub")
        with self.assertRaisesRegex(RuntimeError, "Git LFS"):
            bridge.find_weights(self.root, str(self.weights2), "X2 native")

    def test_gpu_mode_and_parallel_flags(self):
        self.assertEqual(bridge.validate_devices(" 0, 1 ", "two GPUs (SP)"), "0,1")
        for ids in ("0", "0,0", "0,1,2", "a,b"):
            with self.assertRaises(ValueError):
                bridge.validate_devices(ids, "two GPUs (SP)")
        from dataclasses import replace
        two_gpu = replace(self.s, mode="two GPUs (SP)", gpu_ids="2,3")
        with tempfile.TemporaryDirectory() as tmp:
            config = bridge.make_config(self.root, two_gpu, Path(tmp))
            data = json.loads(config.read_text())
            self.assertEqual(data["parallel"]["seq_p_size"], 2)
            cmd = bridge.build_command(self.root, two_gpu, self.input, self.base / "out.mp4", config, 42)
            self.assertEqual(cmd[cmd.index("--nproc_per_node=2") + 1], "-m")
            self.assertIn("torch.distributed.run", cmd)
            with mock.patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": ""}):
                env = bridge._environment(self.root, two_gpu)
            self.assertEqual(env["CUDA_VISIBLE_DEVICES"], "2,3")

    def test_gpu_ids_follow_comfyuis_own_visible_devices(self):
        from dataclasses import replace
        with mock.patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": "1"}):
            self.assertEqual(bridge._environment(self.root, self.s)["CUDA_VISIBLE_DEVICES"], "1")
            with self.assertRaises(ValueError):
                bridge._environment(self.root, replace(self.s, mode="two GPUs (SP)", gpu_ids="0,1"))
        with mock.patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": "3,1"}):
            self.assertEqual(bridge._environment(self.root, replace(self.s, mode="two GPUs (SP)", gpu_ids="1,0"))["CUDA_VISIBLE_DEVICES"], "1,3")

    def test_end_to_end_fake_worker_creates_output_and_json(self):
        # Fake runner exercises the actual subprocess interface without CUDA or HF weights.
        (self.root / "lightx2v" / "infer.py").write_text('''\
import argparse
from pathlib import Path
p=argparse.ArgumentParser()
for key in ("model_cls", "task", "model_path", "config_json", "video_path", "sr_ratio", "save_result_path", "seed"):
    p.add_argument("--"+key, required=True)
a=p.parse_args()
assert a.model_cls == "relayvsr_x2" and a.sr_ratio == "2"
Path(a.save_result_path).write_bytes(b"simulated-mp4")
print("Faux RelayVSR output generated", flush=True)
''')
        destination = self.base / "output"
        staging = self.base / "temp"
        with mock.patch.object(bridge, "output_dir", return_value=destination), \
             mock.patch.object(bridge, "temp_dir", return_value=staging):
            out, stats = bridge.process_video(self.input, self.s, on_line=lambda line: None)
            self.assertTrue(out.is_file())
            self.assertTrue(out.with_suffix(".json").is_file())
            self.assertEqual(stats["scale"], 2)
            self.assertIn("simulated-mp4", out.read_text())
            self.assertFalse(list(destination.rglob("*.inprogress.mp4")))

    def test_output_directory_cannot_escape_comfy(self):
        with mock.patch.object(bridge, "output_dir", return_value=self.base / "output"):
            with self.assertRaisesRegex(ValueError, "relative"):
                bridge.process_video(self.input, self.s, output_subfolder="../elsewhere")

    def test_cancel_silent_subprocess(self):
        start = time.monotonic()
        def interrupt():
            if time.monotonic() - start >= 0.3:
                raise KeyboardInterrupt("cancel requested")
        with self.assertRaises(KeyboardInterrupt):
            bridge._run([sys.executable, "-c", "import time; time.sleep(12)"], check_interrupt=interrupt)
        self.assertLess(time.monotonic() - start, 4)

    def test_preview_contract(self):
        with mock.patch.object(bridge, "output_dir", return_value=self.base / "output"):
            preview = bridge.make_preview(self.base / "output" / "relayvsr" / "x.mp4", {"variant": "X2 native", "elapsed_seconds": 1})
            self.assertEqual(preview["images"][0]["filename"], "x.mp4")
            self.assertEqual(preview["animated"], (True,))


class RelayVSRNodesTests(unittest.TestCase):
    def test_bundled_workflows(self):
        root = ROOT.parent / "examples" / "relayvsr"
        registered = set(nodes.NODE_CLASS_MAPPINGS) | {"LoadVideo", "SaveVideo"}
        for filename in ("workflow_comfyui_native_video.json", "workflow_comfyui_file_path.json"):
            graph = json.loads((root / filename).read_text())
            node_map = {n["id"]: n for n in graph["nodes"]}
            self.assertEqual(len(node_map), len(graph["nodes"]))
            for node in graph["nodes"]:
                self.assertIn(node["type"], registered)
            for link_id, start_id, start_slot, end_id, end_slot, dtype in graph["links"]:
                output = node_map[start_id]["outputs"][start_slot]
                incoming = node_map[end_id]["inputs"][end_slot]
                self.assertIn(link_id, output["links"])
                self.assertEqual(link_id, incoming["link"])
                self.assertEqual(dtype, incoming["type"])
                self.assertEqual(dtype, output["type"])
        for filename in ("workflow_api_native_video.json", "workflow_api_file_path.json"):
            graph = json.loads((root / filename).read_text())
            for key, node in graph.items():
                self.assertIn(node["class_type"], registered)
                for param, value in node["inputs"].items():
                    if isinstance(value, list):
                        self.assertEqual(len(value), 2)
                        self.assertIn(value[0], graph)

    def test_node_registration(self):
        self.assertEqual(len(nodes.NODE_CLASS_MAPPINGS), 6)
        self.assertEqual(nodes.RelayVSRUpscaleVideo.RETURN_TYPES[0], "VIDEO")
        self.assertEqual(nodes.RelayVSRUpscaleFrames.INPUT_TYPES()["required"]["images"][0], "IMAGE")
        r = nodes.RelayVSRModelSettings().get_settings("X2 native", "auto", "auto", "auto", "single GPU", "0", "2", False, False, 16, 4, "libx264", 17, True, True)
        self.assertEqual(r[0]["output_scale"], 2)

    def test_video_trim_is_materialized(self):
        class StubVideo:
            def get_stream_source(self):
                return "source.mp4"
            def get_active_trim_window(self):
                return 5.0, 2.0
            def save_to(self, target):
                Path(target).write_bytes(b"trimmed-video")
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(nodes, "temp_dir", return_value=Path(tmp)):
            path, disposable = nodes._video_input_to_path(StubVideo())
            self.assertEqual(path, disposable)
            self.assertEqual(path.read_bytes(), b"trimmed-video")
            disposable.unlink()


    def test_image_batch_roundtrip_through_ffmpeg(self):
        try:
            import torch
        except ImportError:
            self.skipTest("torch is required by a running ComfyUI")
        if not nodes.shutil.which("ffmpeg") or not nodes.shutil.which("ffprobe"):
            self.skipTest("ffmpeg and ffprobe unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test-rgb.mp4"
            frames = torch.rand((4, 16, 16, 3), generator=torch.Generator().manual_seed(8))
            nodes._encode_images_to_video(frames, 24.0, path)
            self.assertGreater(path.stat().st_size, 100)
            with mock.patch.object(nodes, "comfy_root", return_value=Path(tmp)):
                returned, fps = nodes.RelayVSRVideoToFrames().decode(str(path), 4, 1)
                self.assertEqual(returned.shape, (4, 16, 16, 3))
                self.assertAlmostEqual(fps, 24.0)
                self.assertLess((returned-frames).abs().mean().item(), 0.01)
                with self.assertRaises(MemoryError):
                    nodes.RelayVSRVideoToFrames().decode(str(path), 3, 1)

    def test_interrupt_uses_check_not_setter(self):
        fake_comfy = types.ModuleType("comfy")
        fake_mm = types.ModuleType("comfy.model_management")
        called = []
        fake_mm.throw_exception_if_processing_interrupted = lambda: called.append(True)
        with mock.patch.dict(sys.modules, {"comfy": fake_comfy, "comfy.model_management": fake_mm}):
            nodes._interrupt()
        self.assertEqual(called, [True])


if __name__ == "__main__":
    unittest.main()
