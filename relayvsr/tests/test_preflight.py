"""CPU preflight checks; retain fixtures in RELAYVSR_TEST_ARTIFACTS for review."""
import asyncio
import importlib
import json
import os
from pathlib import Path
import sys
import types
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'relay_preflight_test'
pkg = types.ModuleType(PACKAGE); pkg.__path__ = [str(ROOT)]; sys.modules[PACKAGE] = pkg
server = types.ModuleType('server')
server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=types.SimpleNamespace(post=lambda path: lambda fn: fn)))
sys.modules['server'] = server
routes = importlib.import_module(PACKAGE + '.routes')
nodes = importlib.import_module(PACKAGE + '.nodes')

class PreflightTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ['RELAYVSR_TEST_ARTIFACTS']) / uuid.uuid4().hex
        self.root = base / 'LightX2V'; (self.root / 'lightx2v').mkdir(parents=True)
        (self.root / 'lightx2v' / 'infer.py').write_text('# test fixture\n')
        self.weights = base / 'weights'; self.weights.mkdir()
        for name in ['flash.safetensors', 'wan_int8_convrot.safetensors']:
            (self.weights / name).write_bytes(b'fixture' * 40)
        self.body = {'variant': 'X4 original (recommended, also for 2x)', 'lightx2v_root': str(self.root), 'model_dir': str(self.weights), 'vram': '24 GB+: int8 ConvRot weights + int8 KV (fastest)'}
        nodes.gpu_memory_gib = lambda ids: 96

    def check(self, **changes):
        body = {**self.body, **changes}
        class Request:
            async def json(self): return body
        return json.loads(asyncio.run(routes.check(Request())).text)

    def test_prequantized_pair_is_ready_without_full_precision_file(self):
        self.assertTrue(self.check()['ready'])
        self.assertTrue(self.check(vram='auto (pick by GPU memory)')['ready'])

    def test_full_precision_requires_its_own_checkpoint(self):
        self.assertIn('weights not found', self.check(vram='full precision: bf16 weights + bf16 KV')['problems'])

    def test_missing_backend_is_reported_separately(self):
        result = self.check(lightx2v_root=str(self.root / 'missing'))
        self.assertEqual(result['problems'], ['LightX2V not found'])

if __name__ == '__main__': unittest.main()
