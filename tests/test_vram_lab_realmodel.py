# SPDX-License-Identifier: GPL-3.0-or-later
"""Gate (a''): whole MiniMaxH3Model forward, stock vs patches_replace-installed streamed blocks."""
import os, sys
sys.path.insert(0, os.getcwd())
import torch
import comfy.options
comfy.options.enable_args_parsing()
import comfy.model_management as mm, comfy.sd
from comfy.ldm.minimax.model import PackedLayout
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
from importlib import import_module
vram_lab = import_module("ComfyUI-MAINodes.vram_lab")
torch.set_grad_enabled(False)
patcher = comfy.sd.load_diffusion_model(os.environ["H3_CKPT"])
mm.load_models_gpu([patcher], force_full_load=True)
dm = patcher.model.diffusion_model
dev = mm.get_torch_device()
dt = torch.bfloat16
torch.manual_seed(2)
video = torch.randn(1, 24, 27, 48, 86, device=dev, dtype=torch.float32)
audio = torch.randn(1, 32, 2, 150, device=dev, dtype=torch.float32)
text_dim = dm.condition_proj.weight.shape[1]
ctx = dm.preprocess_text_embeds(torch.randn(1, 64, text_dim, device=dev, dtype=dt))
ts = torch.tensor([600.0], device=dev)
def run(to):
    out = dm([video.clone(), audio.clone()], ts, context=ctx, transformer_options=to, minimax_payload={"seed": 0})
    return [o.float().cpu() for o in out]
a = run({})
a2 = run({})
print("stock twice bit-equal:", all(torch.equal(x, y) for x, y in zip(a, a2)))
cfg = {"q_chunk": 4096, "kv_chunk": 4096, "mlp_chunk": 4096, "min_tokens": 0, "kv_block": 0}
rep = {("double_block", i): vram_lab._make_replacement(b, cfg) for i, b in enumerate(dm.blocks)}
b = run({"patches_replace": {"dit": rep}})
for name, x, y in zip(("video", "audio"), a, b):
    d = (x - y).abs()
    print(f"{name}: max {d.max().item():.3e} mean {d.mean().item():.3e} exact {(d==0).float().mean().item()*100:.1f}%  scale {x.abs().max().item():.2f}")
