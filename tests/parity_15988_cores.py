#!/usr/bin/env python3
"""A6(a): our #15988 shim on the STOCK core must equal the PATCHED core's
native forward, bit for bit, on fractional rows, in the real dtypes.

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/parity_15988_cores.py \
        --stock /mnt/work/ai/apps/ComfyUI --patched /mnt/work/ai/apps/ComfyUI-15988

Runs itself once per checkout (a process can only import one `comfy`), each
child dumping the forward outputs for every arm to a .pt, then compares.
CPU only, no weights, no service. The network is a deterministic stub on the
INSTANCE (`_forward`), everything around it is the real core: the real
`MiniMaxH3Model.forward`, the real `WrapperExecutor`, the real audio carry,
the real capability probe deciding whether the shim installs in `auto`.

Arms per core (x2 dtype regimes: fp32, and bf16 with a k/256 mask which is
what core actually hands the forward):
  off      no wrapper
  auto     apply_h3_mask_velocity_compat(mode='auto'): installs on the stock
           core (state compat_needed), must stay OFF on the patched core
           (state native)
  on       forced install, which on the patched core is the mask^2 hazard

Gates:
  stock/auto == patched/auto, exactly, video and audio, both regimes
  stock/auto == patched/off (the shim reproduces native #15988 from scratch)
  patched/on != patched/auto (forcing it on a native core double-scales)
  the probe says compat_needed on stock and native on patched
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
# keep the fired-log probe out of the shared default file
os.environ.setdefault("MAINODES_MASKCONV_LOG", os.path.join(os.environ.get("TMPDIR", "/tmp"), "h3maskconv_parity_test.log"))


def child(root, out_path):
    import importlib.util
    import torch
    import torch.nn as nn
    sys.path.insert(0, root)
    sys.path.insert(0, HERE)
    import comfy.ops
    from comfy.ldm.minimax.model import MiniMaxH3Model
    from comfy.model_patcher import ModelPatcher
    spec = importlib.util.spec_from_file_location("h3_mask_conv", os.path.join(HERE, "h3_mask_conv.py"))
    mc = importlib.util.module_from_spec(spec)
    sys.modules["h3_mask_conv"] = mc
    spec.loader.exec_module(mc)
    cspec = importlib.util.spec_from_file_location("h3_capabilities", os.path.join(HERE, "h3_capabilities.py"))
    caps = importlib.util.module_from_spec(cspec)
    sys.modules["h3_capabilities"] = caps
    cspec.loader.exec_module(caps)

    H3 = MiniMaxH3Model(hidden_size=64, num_layers=1, token_refiner_num_layers=1,
                        num_attention_heads=2, attention_head_dim=32,
                        ffn_hidden_size=128, text_dim=64, timestep_input_dim=32,
                        time_embed_hidden_size=64, time_embed_dim=64,
                        dtype=torch.float32, operations=comfy.ops.disable_weight_init)

    class Container(nn.Module):
        def __init__(self, dm):
            super().__init__()
            self.diffusion_model = dm

    cpu = torch.device("cpu")
    g = torch.Generator().manual_seed(15988)
    T, Hh, W = 3, 4, 4
    video = torch.randn(1, 24, T, Hh, W, generator=g)
    audio = torch.randn(1, 32, 9, generator=g)
    v_raw = torch.randn(1, 24, T, Hh, W, generator=g)
    a_raw = torch.randn(1, 32, 9, generator=g)
    vmask = torch.randint(0, 257, (1, 1, T, Hh, W), generator=g).float() / 256.0
    amask = torch.randint(0, 257, (1, 1, 9), generator=g).float() / 256.0
    ctx = torch.zeros(1, 3, 64)
    timestep = torch.full((1,), 450.0)
    state = caps.probe_core().get("mask_velocity_conversion", "unknown")

    res = {"root": root, "probe": state}
    for regime, dt in (("fp32", torch.float32), ("bf16", torch.bfloat16)):
        vr, ar = v_raw.to(dt), a_raw.to(dt)

        def _fwd(x, timestep, context, transformer_options={}, minimax_payload=None,
                 denoise_mask=None, audio_denoise_mask=None, **kw):
            # the PATCHED core multiplies in forward() AFTER this returns; the
            # stub is the raw network in both cores
            return [vr.clone(), ar.clone()]
        H3._forward = _fwd

        for mode in ("off", "auto", "on"):
            model, rep = mc.apply_h3_mask_velocity_compat(ModelPatcher(Container(H3), cpu, cpu), "both", mode)
            installed = len(model.wrappers.get(mc._wrappers_diffusion_model(), {}).get(mc.WRAPPER_KEY, []))
            to = {"wrappers": getattr(model, "wrappers", {})}
            out = H3.forward([video.to(dt), audio.to(dt)], timestep, ctx, transformer_options=to,
                             minimax_payload={"audio_scale": 4.0},          # shift 12/3
                             denoise_mask=vmask.to(dt), audio_denoise_mask=amask.to(dt))
            res[(regime, mode)] = {"video": out[0].clone(), "audio": out[1].clone(), "installed": installed}
    torch.save(res, out_path)
    print("dumped", root, "probe:", state)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock", default="/mnt/work/ai/apps/ComfyUI")
    ap.add_argument("--patched", default="/mnt/work/ai/apps/ComfyUI-15988")
    ap.add_argument("--child-root"); ap.add_argument("--child-out")
    a = ap.parse_args()
    if a.child_root:
        return child(a.child_root, a.child_out)
    import tempfile
    import torch
    d = tempfile.mkdtemp(prefix="parity15988_")
    dumps = {}
    for name, root in (("stock", a.stock), ("patched", a.patched)):
        out = os.path.join(d, name + ".pt")
        subprocess.run([PY, __file__, "--child-root", root, "--child-out", out], check=True)
        dumps[name] = torch.load(out)
    S, P = dumps["stock"], dumps["patched"]
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
        ok = ok and bool(cond)

    print("\nprobe: stock=%s patched=%s" % (S["probe"], P["probe"]))
    check("probe classifies the stock core as compat_needed", S["probe"] == "compat_needed")
    check("probe classifies the patched core as native", P["probe"] == "native")
    for regime in ("fp32", "bf16"):
        print("\n[%s]" % regime)
        s_auto, p_auto, p_off, p_on, s_off = (S[(regime, "auto")], P[(regime, "auto")],
                                              P[(regime, "off")], P[(regime, "on")], S[(regime, "off")])
        check("  auto installs on stock, stays off on patched",
              s_auto["installed"] == 1 and p_auto["installed"] == 0)
        for stream in ("video", "audio"):
            d1 = (s_auto[stream].float() - p_auto[stream].float()).abs().max().item()
            check("  %s: stock+shim == patched native, bit-exact" % stream,
                  torch.equal(s_auto[stream], p_auto[stream]) and s_auto[stream].dtype == p_auto[stream].dtype,
                  "max abs diff %.3e, dtypes %s/%s" % (d1, s_auto[stream].dtype, p_auto[stream].dtype))
            check("  %s: patched/off is the same thing (nothing else in the shim)" % stream,
                  torch.equal(p_off[stream], p_auto[stream]))
            check("  %s: stock/off differs (the fix does something here)" % stream,
                  not torch.equal(s_off[stream], s_auto[stream]),
                  "max abs diff %.3e" % (s_off[stream].float() - s_auto[stream].float()).abs().max().item())
            check("  %s: forcing 'on' over a native core double-scales (differs)" % stream,
                  not torch.equal(p_on[stream], p_auto[stream]),
                  "max abs diff %.3e" % (p_on[stream].float() - p_auto[stream].float()).abs().max().item())
    print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
