"""CPU-only block-loop lab tests. These do not validate quality on real RelayVSR weights."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
import importlib
import types
# Package has a hyphen in its directory name; load it as a synthetic Python package.
pkg_name = "relayvsr_lab_test"
if pkg_name not in sys.modules:
    package = types.ModuleType(pkg_name)
    package.__path__ = [str(ROOT)]
    sys.modules[pkg_name] = package
spec = importlib.import_module(pkg_name + ".relay_looping.spec")
runtime_module = importlib.import_module(pkg_name + ".relay_looping.runtime")
bridge = importlib.import_module(pkg_name + ".bridge")
nodes = importlib.import_module(pkg_name + ".nodes")


def lab(mode="experiment", *, wan_passes=2, strength=1.0, indices="first:1", allow_stateful=False):
    return spec.LoopSpec.from_value({
        "mode": mode, "wan": {"indices": indices, "passes": wan_passes, "strength": strength},
        "flash": {"indices": "middle:1", "passes": 1},
        "allow_stateful_repeats": allow_stateful,
    })


class SpecTests(unittest.TestCase):
    def test_parse_indices(self):
        self.assertEqual(spec.parse_block_indices("0,2-4", 10), [0,2,3,4])
        self.assertEqual(spec.parse_block_indices("middle:4", 10), [3,4,5,6])
        self.assertEqual(spec.parse_block_indices("last:2", 10), [8,9])
        self.assertEqual(spec.parse_block_indices("first:2,7", 10), [0,1,7])
        for value in ("-1", "2--3", "x", "5-3", "9", "last:9"):
            with self.assertRaises(ValueError, msg=value):
                spec.parse_block_indices(value, 8)

    def test_validation_and_roundtrip(self):
        x=lab()
        self.assertEqual(spec.LoopSpec.from_value(json.loads(json.dumps(x.as_dict()))), x)
        with self.assertRaises(ValueError):
            spec.LoopSpec.from_value({"mode":"experiment", "wan":{"passes":1},"flash":{"passes":1}})
        with self.assertRaises(ValueError):
            spec.LoopSpec.from_value({"mode":"experiment","wan":{"passes":2,"strength":2.0}})
        with self.assertRaises(ValueError):
            spec.LoopSpec.from_value({"not_real":True})

    def test_presets_are_honest_and_parse(self):
        folder = ROOT / "presets"
        self.assertGreaterEqual(len(list(folder.glob("*.json"))), 6)
        for path in folder.glob("*.json"):
            item = spec.LoopSpec.from_value(json.loads(path.read_text()))
            if path.stem.startswith("EXPERIMENTAL"):
                self.assertTrue(item.active)

    def test_reject_compile_and_unreviewed_multigpu(self):
        with self.assertRaisesRegex(ValueError, "compile_model"):
            bridge.Settings(loop_experiment=lab().as_dict(), compile_model=True).validate()
        with self.assertRaisesRegex(ValueError, "unvalidated"):
            bridge.Settings(loop_experiment=lab().as_dict(), mode="two GPUs (SP)", gpu_ids="0,1").validate()
        bridge.Settings(loop_experiment=spec.LoopSpec(mode="discover").as_dict(), mode="two GPUs (SP)", gpu_ids="0,1").validate()

    def test_node_connection(self):
        self.assertEqual(nodes.RelayVSRBlockLoopLab.RETURN_TYPES, ("RELAYVSR_LOOP_SETTINGS",))
        self.assertIn("loop_experiment", nodes.RelayVSRModelSettings.INPUT_TYPES()["optional"])
        klass=nodes.RelayVSRBlockLoopLab
        props=klass.INPUT_TYPES()["required"]
        args={name: (info[1].get('default') if len(info)>1 else info[0][0]) for name,info in props.items()}
        args.update(preset="custom", mode="experiment", wan_passes=2, allow_stateful_repeats=True)
        setting=klass().configuration(**args)[0]
        self.assertEqual(setting["wan"]["passes"], 2)
        self.assertTrue(setting["allow_stateful_repeats"])

    def test_preset_supports_agent_json_overrides(self):
        klass = nodes.RelayVSRBlockLoopLab
        props = klass.INPUT_TYPES()["required"]
        args = {name: (info[1].get("default") if len(info) > 1 else info[0][0])
                for name, info in props.items()}
        args.update(preset="EXPERIMENTAL_wan_early_2pass",
                    advanced_json=json.dumps({"wan": {"indices": "middle:3", "strength": 0.25,
                                                        "every_nth_call": 3},
                                              "check_finite": True}))
        customized = klass().configuration(**args)[0]
        self.assertEqual(customized["wan"]["indices"], "middle:3")
        self.assertEqual(customized["wan"]["strength"], 0.25)
        self.assertEqual(customized["wan"]["every_nth_call"], 3)
        self.assertTrue(customized["check_finite"])
        self.assertEqual(customized["mode"], "experiment")

    def test_workflows_loop_lab_graphs(self):
        for file in sorted((ROOT.parent / "examples" / "relayvsr").glob("*loop*.json")):
            graph=json.loads(file.read_text())
            if "api" in file.name:
                self.assertEqual(graph["1"]["inputs"]["loop_experiment"], ["3",0])
                self.assertEqual(graph["3"]["class_type"], "RelayVSRBlockLoopLab")
            else:
                nodes_by={n["id"]:n for n in graph["nodes"]}
                self.assertTrue(any(n["type"]=="RelayVSRBlockLoopLab" for n in graph["nodes"]))
                for link_id, origin_id, origin_socket, dest_id, dest_socket, typ in graph["links"]:
                    self.assertIn(link_id, nodes_by[origin_id]["outputs"][origin_socket]["links"])
                    self.assertEqual(nodes_by[dest_id]["inputs"][dest_socket]["link"],link_id)
                    self.assertEqual(nodes_by[origin_id]["outputs"][origin_socket]["type"], typ)
                    self.assertEqual(nodes_by[dest_id]["inputs"][dest_socket]["type"], typ)


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import torch
        except ImportError:
            raise unittest.SkipTest("torch CPU not installed in this runtime")
        cls.torch=torch

    def toy(self, cache=False):
        torch=self.torch
        class WanBlock(torch.nn.Module):
            def forward(self, x, kv_cache=None):
                return x + 1
        class WanModel(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.blocks=torch.nn.ModuleList([WanBlock() for _ in range(4)])
            def forward(self, x):
                for block in self.blocks:
                    x=block(x, kv_cache={} if cache else None)
                return x
        return WanModel()

    def test_discovery_does_not_change_output(self):
        torch=self.torch
        worker=runtime_module.BlockLoopRuntime(lab("discover"))
        worker.activate()
        try:
            y=self.toy()(torch.tensor([0.0]))
            worker.verify()
            report=worker.report()
        finally:
            worker.close()
        self.assertAlmostEqual(y.item(),4.0)
        self.assertEqual(report["extra_block_calls"]["wan"],0)
        self.assertTrue(any("WanModel" in x["owner"] for x in report["candidates"]))
        long_error="Traceback: " + "x" * 5000 + " the last line"
        self.assertEqual(worker.report(error=long_error)["error"], long_error)  # an agent reads the report: the error comes back whole

    def test_selected_first_block_one_extra_pass(self):
        torch=self.torch
        worker=runtime_module.BlockLoopRuntime(lab())
        worker.activate()
        try:
            y=self.toy()(torch.tensor([0.0]))
            worker.verify()
            report=worker.report()
        finally:
            worker.close()
        self.assertEqual(y.item(), 5.0)
        self.assertEqual(report["extra_block_calls"]["wan"],1)
        self.assertEqual(report["installed"]["wan"][0]["indices"],[0])

    def test_blending(self):
        torch=self.torch
        worker=runtime_module.BlockLoopRuntime(lab(strength=0.5))
        worker.activate()
        try:
            y=self.toy()(torch.tensor([0.0]))
        finally:
            worker.close()
        self.assertEqual(y.item(), 4.5)

    def test_group_recurrence_is_not_per_block_recurrence(self):
        torch=self.torch
        class WanBlock(torch.nn.Module):
            def __init__(self, operation):
                super().__init__()
                self.operation=operation
            def forward(self,x):
                return x+1 if self.operation==0 else x*2
        class WanModel(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.blocks=torch.nn.ModuleList([WanBlock(0),WanBlock(1)])
            def forward(self,x):
                for b in self.blocks: x=b(x)
                return x
        baseline=WanModel()(torch.tensor([1.0])).item()  # (1+1)*2 = 4
        self.assertEqual(baseline,4)
        l=spec.LoopSpec.from_value({'mode':'experiment','wan':{
            'indices':'0-1','passes':2,'strength':1.0,'loop_style':'group'}})
        rt=runtime_module.BlockLoopRuntime(l)
        rt.activate()
        try:
            observed=WanModel()(torch.tensor([1.0])).item()
            rt.verify()
            self.assertEqual(rt.report()['extra_block_calls']['wan'],2)
        finally:
            rt.close()
        self.assertEqual(observed,10.0) # group twice: ((1+1)*2+1)*2
        # Per-block repetition produces a different result.
        l=spec.LoopSpec.from_value({'mode':'experiment','wan':{
            'indices':'0-1','passes':2,'strength':1.0,'loop_style':'per_block'}})
        rt=runtime_module.BlockLoopRuntime(l)
        rt.activate()
        try:
            independent=WanModel()(torch.tensor([1.0])).item()
        finally:rt.close()
        self.assertEqual(independent,12.0) # (1+1+1)*2*2

    def test_group_requires_contiguous_indices(self):
        torch=self.torch
        l=spec.LoopSpec.from_value({'mode':'experiment','wan':{
            'indices':'0,2','passes':2,'loop_style':'group'}})
        rt=runtime_module.BlockLoopRuntime(l)
        rt.activate()
        try:
            with self.assertRaisesRegex(ValueError,'consecutive'):
                self.toy()(torch.tensor([0.0]))
        finally:rt.close()

    def test_cache_guard_fails_closed(self):
        torch=self.torch
        worker=runtime_module.BlockLoopRuntime(lab(allow_stateful=False))
        worker.activate()
        try:
            with self.assertRaisesRegex(RuntimeError, "cache"):
                self.toy(cache=True)(torch.tensor([0.0]))
        finally:
            worker.close()

    def test_no_match_is_error(self):
        torch=self.torch
        bad=spec.LoopSpec.from_value({"mode":"experiment","wan":{
            "indices":"first:1","passes":2,"owner_regex":"ThisWillNeverMatch"}})
        worker=runtime_module.BlockLoopRuntime(bad)
        worker.activate()
        try:
            self.toy()(torch.tensor([0.0]))
            with self.assertRaisesRegex(RuntimeError,"never executed"):
                worker.verify()
        finally:
            worker.close()

    def test_runpy_bootstrap_with_fake_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            root=tmp/"upstream"
            (root/"lightx2v").mkdir(parents=True)
            (root/"lightx2v"/"__init__.py").write_text("")
            (root/"lightx2v"/"infer.py").write_text('''\
from pathlib import Path
import sys
import torch
class WanBlock(torch.nn.Module):
    def forward(self, x):
        return x + 1
class WanModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.blocks = torch.nn.ModuleList([WanBlock() for _ in range(4)])
    def forward(self, x):
        for block in self.blocks:
            x = block(x)
        return x
Path(sys.argv[1]).write_text(str(WanModel()(torch.tensor([0.0])).item()))
''')
            config=tmp/"spec.json"
            config.write_text(json.dumps(lab().as_dict()))
            report=tmp/"report.json"
            destination=tmp/"result.txt"
            env=os.environ.copy()
            env["PYTHONPATH"]=os.pathsep.join([str(ROOT),str(root),env.get("PYTHONPATH","")])
            env["RELAYVSR_LOOP_SPEC_PATH"]=str(config)
            env["RELAYVSR_LOOP_REPORT_PATH"]=str(report)
            env["RELAYVSR_LOOP_RUNTIME_ACK"]="experimental-stateful-hooks-v1"
            run=subprocess.run([sys.executable,"-m","relay_looping.launch","--",str(destination)],
                                env=env,capture_output=True,text=True,timeout=60)
            self.assertEqual(run.returncode,0,run.stderr[-2500:])
            self.assertEqual(float(destination.read_text()),5.0)
            value=json.loads((tmp/"report_rank0.json").read_text())
            self.assertEqual(value["extra_block_calls"]["wan"],1)


class BridgeLoopIntegrationTests(unittest.TestCase):
    def test_bridge_produces_real_loop_metadata_and_sidecar_with_fake_infer(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            root=base/"lightx2v_repo"
            src=root/"lightx2v"
            src.mkdir(parents=True)
            (src/"__init__.py").write_text("")
            (src/"infer.py").write_text('''\
import argparse
from pathlib import Path
import torch
class WanBlock(torch.nn.Module):
 def forward(self,x): return x+1
class WanModel(torch.nn.Module):
 def __init__(self):
  super().__init__()
  self.blocks=torch.nn.ModuleList([WanBlock() for _ in range(4)])
 def forward(self,x):
  for b in self.blocks:x=b(x)
  return x
p=argparse.ArgumentParser()
for field in ('model_cls','task','model_path','config_json','video_path','sr_ratio','save_result_path','seed'):
 p.add_argument('--'+field,required=True)
a=p.parse_args()
result=WanModel()(torch.tensor([0.0])).item()
Path(a.save_result_path).write_text(f'fake-mp4-value={result}')
''')
            conf=root/"configs"/"relayvsr"
            conf.mkdir(parents=True)
            (conf/"relayvsr_x2.json").write_text(json.dumps({"native_scale":2}))
            weights=base/"weights"
            weights.mkdir()
            for name in ("wan_x2.safetensors","flash_x2.safetensors"):
                (weights/name).write_bytes(b'0'*256)
            infile=base/"input.mp4"
            infile.write_bytes(b'fake-input')
            outdir=base/"output"
            with mock.patch.object(bridge,"output_dir",return_value=outdir), mock.patch.object(bridge,"temp_dir",return_value=base/"temp"):
                settings=bridge.Settings(lightx2v_root=str(root),model_dir=str(weights),
                    python_executable=sys.executable,preserve_audio=False,loop_experiment=lab().as_dict())
                result,stats=bridge.process_video(infile,settings,on_line=lambda message:None)
                self.assertTrue(result.exists())
                self.assertIn('fake-mp4-value=5.0',result.read_text())
                self.assertEqual(stats['block_loop_mode'],'experiment')
                sidecar=json.loads(result.with_suffix('.loop.json').read_text())
                self.assertEqual(sidecar['extra_block_calls']['wan'],1)
                self.assertTrue(sidecar['installed']['wan'])

    def test_unmatched_real_worker_fails_and_keeps_audit_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            root=base/"repo"
            src=root/"lightx2v"
            src.mkdir(parents=True)
            (src/"__init__.py").write_text("")
            (src/"infer.py").write_text('''\
import argparse
from pathlib import Path
import torch
class PlainBlock(torch.nn.Module):
 def forward(self,x): return x+1
class PlainModel(torch.nn.Module):
 def __init__(self):
  super().__init__()
  self.layers=torch.nn.ModuleList([PlainBlock() for _ in range(4)])
 def forward(self,x):
  for layer in self.layers: x=layer(x)
  return x
p=argparse.ArgumentParser()
for field in ('model_cls','task','model_path','config_json','video_path','sr_ratio','save_result_path','seed'):
 p.add_argument('--'+field,required=True)
a=p.parse_args()
PlainModel()(torch.tensor([0.0]))
Path(a.save_result_path).write_text('fake-mp4')
''')
            config=root/"configs"/"relayvsr"
            config.mkdir(parents=True)
            (config/"relayvsr_x2.json").write_text(json.dumps({"native_scale":2}))
            weights=base/"weights"
            weights.mkdir()
            for filename in ("wan_x2.safetensors","flash_x2.safetensors"):
                (weights/filename).write_bytes(b"0"*256)
            video=base/"source.mp4"
            video.write_bytes(b"fake-input")
            output=base/"output"
            setting=bridge.Settings(lightx2v_root=str(root), model_dir=str(weights),
                python_executable=sys.executable, preserve_audio=False,
                loop_experiment=lab().as_dict())
            with mock.patch.object(bridge,"output_dir",return_value=output), mock.patch.object(bridge,"temp_dir",return_value=base/"temp"):
                with self.assertRaisesRegex(RuntimeError, "never executed"):
                    bridge.process_video(video,setting,on_line=lambda message:None)
            audit=list(output.glob("relayvsr/*.failed.loop_result_rank0.json"))
            self.assertEqual(len(audit),1)
            details=json.loads(audit[0].read_text())
            self.assertEqual(details["status"],"failed")
            self.assertEqual(details["extra_block_calls"]["wan"],0)
            self.assertFalse(list(output.glob("relayvsr/*.mp4")))


if __name__=="__main__":
    unittest.main()
