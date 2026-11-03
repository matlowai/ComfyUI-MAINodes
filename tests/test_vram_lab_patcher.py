# SPDX-License-Identifier: GPL-3.0-or-later
"""Gate (a'''): through ModelPatcher.apply_model, stock patcher vs H3StreamedBlocks-patched clone.

Run from the ComfyUI root with the ComfyUI venv and the checkpoint path in H3_CKPT:
    H3_CKPT=models/diffusion_models/minimax_h3/<int8 or w4a8 file>.safetensors CUDA_VISIBLE_DEVICES=0 python custom_nodes/ComfyUI-MAINodes/tests/test_vram_lab_patcher.py
"""
import os, sys
sys.path.insert(0, os.getcwd())
import torch
import comfy.options
comfy.options.enable_args_parsing()
import comfy.model_management as mm, comfy.sd, comfy.nested_tensor
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
from importlib import import_module
vram_lab = import_module("ComfyUI-MAINodes.vram_lab")
torch.set_grad_enabled(False)
stock = comfy.sd.load_diffusion_model(os.environ["H3_CKPT"])
node = vram_lab.H3StreamedBlocks()
(patched,) = node.patch(stock, 4096, 4096, 4096, 0, 0)
dev = mm.get_torch_device()
dt = torch.bfloat16
torch.manual_seed(3)
video = torch.randn(1, 24, 27, 48, 86, device=dev)
audio = torch.randn(1, 32, 2, 150, device=dev)
dm = stock.model.diffusion_model
text_dim = dm.condition_proj.weight.shape[1]
cross = torch.randn(1, 64, text_dim, device=dev, dtype=dt)
def run(p):
    mm.load_models_gpu([p], force_full_load=True)
    import comfy.utils
    x, shapes = comfy.utils.pack_latents([video.clone(), audio.clone()])
    p.model.latent_shapes = shapes
    conds = p.model.extra_conds(cross_attn=cross, latent_shapes=shapes, device=dev, seed=0)
    c = {k: v.process_cond(batch_size=1, device=dev) for k, v in conds.items()}
    c = {k: (v.cond if hasattr(v, "cond") else v) for k, v in c.items()}
    c["transformer_options"] = dict(p.model_options.get("transformer_options", {}))
    out = p.model.apply_model(x, torch.tensor([0.6], device=dev), **c)
    return [o.float().cpu() for o in comfy.utils.unpack_latents(out, shapes)]
a = run(stock)
b = run(patched)
a2 = run(stock)
print("stock twice:", all(torch.equal(x, y) for x, y in zip(a, a2)))
for n, x, y in zip(("video", "audio"), a, b):
    d = (x - y).abs()
    print(f"{n}: max {d.max().item():.3e} mean {d.mean().item():.3e} exact {(d==0).float().mean().item()*100:.1f}%")
