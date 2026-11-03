import importlib
import unittest.mock
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "relayvsr_package_under_test"
if PACKAGE not in sys.modules:
    pkg = types.ModuleType(PACKAGE)
    pkg.__path__ = [str(ROOT)]
    sys.modules[PACKAGE] = pkg
nodes = importlib.import_module(PACKAGE + ".nodes")
spec = importlib.import_module(PACKAGE + ".relay_looping.spec")


class QualityPresetTests(unittest.TestCase):
    def test_stock_without_lab_sends_no_spec(self):
        self.assertIsNone(nodes.quality_spec(None, "stock (the model as shipped)", 1.0, 0.5, "area"))

    def test_faithful_preset_ignores_knobs(self):
        s = nodes.quality_spec(None, "faithful: back-projection + residual 0.85", 0.0, 2.0, "area")
        self.assertEqual((s["mode"], s["back_projection"], s["residual_gain"], s["downscale"]), ("experiment", 1.0, 0.85, "bicubic"))
        self.assertEqual(s["flash"]["passes"], 1)

    def test_flash_presets_loop_flash_late_half(self):
        s = nodes.quality_spec(None, "smooth: every knob (calmest, least texture)", 0.0, 1.0, "bicubic")
        self.assertEqual((s["flash"]["indices"], s["flash"]["passes"], s["flash"]["strength"], s["downscale"]), ("last:4", 2, 0.5, "bilinear"))
        self.assertTrue(spec.LoopSpec.from_value(s).flash.active)

    def test_custom_reads_knobs(self):
        s = nodes.quality_spec(None, "custom (use the knobs below)", 0.4, 1.2, "bilinear")
        self.assertEqual((s["back_projection"], s["residual_gain"], s["downscale"]), (0.4, 1.2, "bilinear"))
        self.assertIsNone(nodes.quality_spec(None, "custom (use the knobs below)", 0.0, 1.0, "bicubic"))

    def test_preset_merges_with_lab_loop(self):
        lab = {"mode": "experiment", "wan": {"indices": "middle:4", "passes": 2}, "flash": {"passes": 1}}
        s = nodes.quality_spec(lab, "faithful: back-projection + residual 0.85", 0.0, 1.0, "bicubic")
        self.assertEqual((s["wan"]["indices"], s["wan"]["passes"], s["back_projection"]), ("middle:4", 2, 1.0))
        stock = nodes.quality_spec(lab, "stock (the model as shipped)", 0.0, 1.0, "bicubic")
        self.assertEqual((stock["wan"]["passes"], stock["back_projection"]), (2, 0.0))

    def test_quality_knobs_validate(self):
        with self.assertRaises(ValueError):
            spec.LoopSpec.from_value({"mode": "experiment", "back_projection": 1.5})
        with self.assertRaises(ValueError):
            spec.LoopSpec.from_value({"mode": "experiment", "downscale": "lanczos"})


if __name__ == "__main__":
    unittest.main()


class VramTierTests(unittest.TestCase):
    def test_tiers_map_to_knobs_on_single_gpu(self):
        self.assertEqual(nodes.vram_knobs("16 GB: W6A8 weights + int4 KV", "single GPU", "0"), {"weights": "w6a8", "kv_cache": "int4_rot"})
        self.assertEqual(nodes.vram_knobs("full precision: bf16 weights + bf16 KV", "single GPU", "0"), {})

    def test_offload_keeps_only_the_kv_cache_and_sp_stays_bf16(self):
        tier = "24 GB+: int8 ConvRot weights + int8 KV (fastest)"
        self.assertEqual(nodes.vram_knobs(tier, "Wan block offload", "0"), {"kv_cache": "int8_rot"})
        self.assertEqual(nodes.vram_knobs(tier, "two GPUs (SP)", "0,1"), {})

    def test_auto_picks_by_memory(self):
        for total, weights in ((31.4, "int8_convrot"), (23.5, "int8_convrot"), (15.9, "w6a8"), (11.6, "w4a8"), (None, "w6a8")):
            with unittest.mock.patch.object(nodes, "gpu_memory_gib", return_value=total):
                self.assertEqual(nodes.vram_knobs("auto (pick by GPU memory)", "single GPU", "0")["weights"], weights, total)

    def test_auto_prefers_a_tier_whose_file_is_present(self):
        with unittest.mock.patch.object(nodes, "gpu_memory_gib", return_value=31.4):
            self.assertEqual(nodes.vram_knobs("auto (pick by GPU memory)", "single GPU", "0", {"w6a8"})["weights"], "w6a8")
            self.assertEqual(nodes.vram_knobs("auto (pick by GPU memory)", "single GPU", "0", {"w4a8", "int8_convrot"})["weights"], "int8_convrot")
        with unittest.mock.patch.object(nodes, "gpu_memory_gib", return_value=11.6):
            self.assertEqual(nodes.vram_knobs("auto (pick by GPU memory)", "single GPU", "0", {"int8_convrot"})["weights"], "w4a8")

    def test_tier_joins_the_quality_spec(self):
        s = nodes.quality_spec(None, "faithful: back-projection + residual 0.85", 0.0, 1.0, "bicubic", {"weights": "w6a8", "kv_cache": "int4_rot"})
        self.assertEqual((s["weights"], s["kv_cache"], s["back_projection"]), ("w6a8", "int4_rot", 1.0))


class QuantizedCheckpointTests(unittest.TestCase):
    def test_quantized_wan_is_found_next_to_flash(self):
        import tempfile
        bridge = importlib.import_module(PACKAGE + ".bridge")
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for name in ("wan_w6a8.safetensors", "flash.safetensors"):
                (folder / name).write_bytes(b"x" * 256)
            spec_dict = nodes.quality_spec(None, "stock (the model as shipped)", 0.0, 1.0, "bicubic", {"weights": "w6a8"})
            s = bridge.Settings(variant="X4 original (recommended, also for 2x)", model_dir=str(folder), loop_experiment=spec_dict)
            self.assertEqual(bridge.resolve_wan(folder, s), (folder.resolve(), folder.resolve() / "wan_w6a8.safetensors"))
            s = bridge.Settings(variant="X4 original (recommended, also for 2x)", model_dir=str(folder))
            with self.assertRaises(FileNotFoundError):
                bridge.resolve_wan(folder, s)
