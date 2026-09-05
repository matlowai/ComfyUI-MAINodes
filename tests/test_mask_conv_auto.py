#!/usr/bin/env python3
"""Unit test for `apply_h3_mask_velocity_compat` (h3_mask_conv.py A5): the
capability-gated, idempotent #15988 install and its ordering against the audio
carry. CPU only, no GPU, no weights, no services.

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/test_mask_conv_auto.py

NOTHING HERE IS MOCKED. The patcher is a real `comfy.model_patcher.
ModelPatcher`; the model it wraps is a real `MiniMaxH3Model` built at toy
width (64 hidden, 1 layer) with real `comfy.ops` operations; the wrapper chain
is executed by the real `WrapperExecutor` through the real
`MiniMaxH3Model.forward`, which is what applies the audio carry. The only
substitution is the network itself: `_forward` is replaced on the INSTANCE by
a function returning a fixed velocity, because the quantity under test is
where the multiplication happens, not what the network would have said. The
container holding `diffusion_model` is a plain `nn.Module` rather than a
`comfy.model_base.MiniMaxH3`, which would need a model config and weights;
nothing under test reads it.

The one seam a test stands on is `h3_mask_conv.core_mask_velocity_state`, our
own module function, so a native / legacy / unknown core can be presented
without a second ComfyUI checkout. Case `compat_needed` is also the state the
live probe returns on this box, so the main path is exercised for real too.

Covered (compat handoff s.6.4 and s.6.5):
  no mask, video only, audio only, both, idempotent install,
  native / legacy / unknown -> no wrapper, non-H3 model -> no wrapper,
  off / on overrides, install order ahead of a skipping wrapper,
  and the audio-carry ordering parity test with shift 12/3 and audio_scale
  1.7 against the native #15988 formula.
"""
import importlib.util
import os
import sys

import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _root in (os.path.dirname(os.path.dirname(HERE)),
              os.environ.get("COMFYUI_ROOT", ""),
              "/mnt/work/ai/apps/ComfyUI"):
    if _root and os.path.isdir(os.path.join(_root, "comfy", "ldm", "minimax")):
        if _root not in sys.path:
            sys.path.insert(0, _root)
        break
else:
    print("CANNOT RUN: no ComfyUI checkout found (set COMFYUI_ROOT)")
    sys.exit(2)
if HERE not in sys.path:                    # h3_mask_conv's fallback import
    sys.path.insert(0, HERE)

import comfy.ops                                                  # noqa: E402
from comfy.ldm.minimax.model import MiniMaxH3Model                # noqa: E402
from comfy.model_patcher import ModelPatcher                      # noqa: E402
from comfy.patcher_extension import WrappersMP                    # noqa: E402

spec = importlib.util.spec_from_file_location(
    "h3_mask_conv", os.path.join(HERE, "h3_mask_conv.py"))
mc = importlib.util.module_from_spec(spec)
sys.modules["h3_mask_conv"] = mc
spec.loader.exec_module(mc)

DM = WrappersMP.DIFFUSION_MODEL
ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
    ok = ok and bool(cond)


# ----------------------------------------------------------- the real objects

def build_h3():
    return MiniMaxH3Model(hidden_size=64, num_layers=1, token_refiner_num_layers=1,
                          num_attention_heads=2, attention_head_dim=32,
                          ffn_hidden_size=128, text_dim=64, timestep_input_dim=32,
                          time_embed_hidden_size=64, time_embed_dim=64,
                          dtype=torch.float32,
                          operations=comfy.ops.disable_weight_init)


class Container(nn.Module):
    def __init__(self, dm):
        super().__init__()
        self.diffusion_model = dm


H3 = build_h3()
CPU = torch.device("cpu")


def patcher(dm=None):
    return ModelPatcher(Container(H3 if dm is None else dm), CPU, CPU)


def with_state(state):
    mc.core_mask_velocity_state = lambda: state


g = torch.Generator().manual_seed(15988)
VIDEO = torch.randn(1, 24, 2, 4, 4, generator=g)
AUDIO = torch.randn(1, 32, 6, generator=g)
VMASK = torch.rand(1, 1, 2, 4, 4, generator=g)
AMASK = torch.rand(1, 1, 6, generator=g)
V_RAW = torch.randn(1, 24, 2, 4, 4, generator=g)     # deterministic "network"
A_RAW = torch.randn(1, 32, 6, generator=g)
CTX = torch.zeros(1, 3, 64)
TIMESTEP = torch.full((1,), 450.0)                   # sigma 0.45


def stub_forward(pre_scale=False):
    """A deterministic stand-in for the network. `pre_scale` reproduces what
    NATIVE #15988 does: the multiplication happens inside, i.e. before the
    outer carry, which is the ordering under test."""
    def _fwd(x, timestep, context, transformer_options={}, minimax_payload=None,
             denoise_mask=None, audio_denoise_mask=None, **kwargs):
        v, a = V_RAW.clone(), A_RAW.clone()
        if pre_scale:
            if denoise_mask is not None:
                v = v * denoise_mask
            if audio_denoise_mask is not None:
                a = a * audio_denoise_mask
        return [v, a]
    return _fwd


def run(model, vmask, amask, audio_scale=1.0, pre_scale=False):
    """Real MiniMaxH3Model.forward, real WrapperExecutor, whatever wrappers
    `model` carries."""
    H3._forward = stub_forward(pre_scale)
    to = {"wrappers": getattr(model, "wrappers", {})}
    return H3.forward([VIDEO, AUDIO], TIMESTEP, CTX, transformer_options=to,
                      minimax_payload={"audio_scale": audio_scale},
                      denoise_mask=vmask, audio_denoise_mask=amask)


def n_wrappers(model):
    return len(model.wrappers.get(DM, {}).get(mc.WRAPPER_KEY, []))


# ------------------------------------------------------------ 0. the fixtures
print("\n0. real objects, no mocks")
p = patcher()
check("   a real ModelPatcher over a real MiniMaxH3Model",
      isinstance(p, ModelPatcher) and type(p.model.diffusion_model).__name__ == "MiniMaxH3Model")
check("   is_h3_model says yes", mc.is_h3_model(p) is True)
notp = patcher(nn.Linear(4, 4))
check("   is_h3_model says no for a non-H3 diffusion_model", mc.is_h3_model(notp) is False)
check("   the live capability probe on this box reports a legal state",
      mc.core_mask_velocity_state() in
      ("native", "compat_needed", "legacy_no_model_mask", "unknown"),
      mc.core_mask_velocity_state())

# ------------------------------------------- 1. auto + compat_needed installs
print("\n1. auto on a compat_needed core: install, and scale exactly once")
with_state("compat_needed")
m, rep = mc.apply_h3_mask_velocity_compat(patcher(), "both", "auto")
check("   one wrapper under our key", n_wrappers(m) == 1, str(n_wrappers(m)))
check("   the report says it installed", "ON (PR #15988)" in rep)
check("   the clone is not the input model", m is not p)

out = run(m, None, None)
check("   NO MASK: both streams untouched",
      torch.equal(out[0], V_RAW) and torch.equal(out[1], A_RAW))

out = run(m, VMASK, None)
check("   VIDEO ONLY: video scaled, audio raw",
      torch.equal(out[0], V_RAW * VMASK) and torch.equal(out[1], A_RAW))

out = run(m, None, AMASK)
check("   AUDIO ONLY: audio scaled, video raw",
      torch.equal(out[0], V_RAW) and torch.equal(out[1], A_RAW * AMASK))

out = run(m, VMASK, AMASK)
check("   BOTH: each scaled once",
      torch.equal(out[0], V_RAW * VMASK) and torch.equal(out[1], A_RAW * AMASK))

for scope, sv, sa in (("video only", True, False), ("audio only", False, True)):
    ms, _ = mc.apply_h3_mask_velocity_compat(patcher(), scope, "auto")
    o = run(ms, VMASK, AMASK)
    check("   scope %-11s video %s audio %s" % (scope, sv, sa),
          torch.equal(o[0], V_RAW * VMASK if sv else V_RAW)
          and torch.equal(o[1], A_RAW * AMASK if sa else A_RAW))

# ------------------------------------------------------------ 2. idempotence
print("\n2. IDEMPOTENT: two entry points on one chain, one wrapper")
m1, _ = mc.apply_h3_mask_velocity_compat(patcher(), "both", "auto")
m2, _ = mc.apply_h3_mask_velocity_compat(m1, "both", "auto")
check("   still exactly one wrapper under the key", n_wrappers(m2) == 1, str(n_wrappers(m2)))
out2 = run(m2, VMASK, AMASK)
check("   video scaled once, not squared",
      torch.equal(out2[0], V_RAW * VMASK)
      and not torch.equal(out2[0], V_RAW * VMASK * VMASK))
check("   audio scaled once, not squared",
      torch.equal(out2[1], A_RAW * AMASK)
      and not torch.equal(out2[1], A_RAW * AMASK * AMASK))
check("   the first model still has its own single wrapper", n_wrappers(m1) == 1)
# the guard is real: without the remove, add_wrapper_with_key APPENDS
m3 = m1.clone()
m3.add_wrapper_with_key(DM, mc.WRAPPER_KEY, mc._make_wrapper("both", {"calls": 0, "first": None}))
o3 = run(m3, VMASK, None)
check("   (control) two wrappers really do square the mask",
      n_wrappers(m3) == 2 and torch.allclose(o3[0], V_RAW * VMASK * VMASK))

# --------------------------------------------- 3. the states that install nothing
print("\n3. auto on a core that must not be touched")
for state in ("native", "legacy_no_model_mask", "unknown"):
    with_state(state)
    src = patcher()
    m, rep = mc.apply_h3_mask_velocity_compat(src, "both", "auto")
    o = run(m, VMASK, AMASK)
    check("   %-20s -> no wrapper, model passed through" % state,
          n_wrappers(m) == 0 and m is src
          and torch.equal(o[0], V_RAW) and torch.equal(o[1], A_RAW))
    check("   %-20s -> the report says why" % state,
          "not installed" in rep, rep.split(":")[1].strip()[:70] if ":" in rep else rep[:70])

with_state("unknown")
m, rep = mc.apply_h3_mask_velocity_compat(patcher(), "both", "auto")
check("   unknown names the refusal reason",
      "mask^2" in rep and "unknown" in rep)

with_state("compat_needed")
m, rep = mc.apply_h3_mask_velocity_compat(notp, "both", "auto")
check("   a non-H3 model gets nothing even on a compat_needed core",
      n_wrappers(m) == 0 and m is notp and "not a MiniMax H3" in rep)

# ------------------------------------------------------- 4. the two overrides
print("\n4. off / on are the research override")
with_state("compat_needed")
src = patcher()
m, rep = mc.apply_h3_mask_velocity_compat(src, "both", "off")
check("   off installs nothing even when the core needs it",
      n_wrappers(m) == 0 and m is src and "OFF" in rep)
with_state("native")
m, rep = mc.apply_h3_mask_velocity_compat(patcher(), "both", "on")
o = run(m, VMASK, None)
check("   on installs even on a native core (forced, for an A/B)",
      n_wrappers(m) == 1 and torch.equal(o[0], V_RAW * VMASK)
      and "forced by mode 'on'" in rep)
try:
    mc.apply_h3_mask_velocity_compat(patcher(), "both", "nonsense")
    check("   an unknown mode is refused", False, "no error raised")
except ValueError:
    check("   an unknown mode is refused", True)
check("   'auto' is the default mode of the H3MaskConversion node",
      mc.H3MaskConversion.INPUT_TYPES()["required"]["mode"][1]["default"] == "auto")

# off must be able to UNDO an earlier install on the same chain (2026-09-04):
# H3StreamedBlocks applies mode auto before the guider, so an explicit off
# downstream that only returned its input would render the control arm ON.
_on, _ = mc.apply_h3_mask_velocity_compat(src, "both", "on")
check("   on installed one wrapper (precondition)",
      len(_on.wrappers.get(DM, {}).get(mc.WRAPPER_KEY, [])) == 1)
_off, _rep_off = mc.apply_h3_mask_velocity_compat(_on, "both", "off")
check("   off REMOVES a wrapper installed earlier on the chain",
      len(_off.wrappers.get(DM, {}).get(mc.WRAPPER_KEY, [])) == 0, _rep_off.splitlines()[-1][:80])
check("   off on a clean model returns the same object (no clone)",
      mc.apply_h3_mask_velocity_compat(src, "both", "off")[0] is src)
check("   the on model is untouched by the downstream off (clone semantics)",
      len(_on.wrappers.get(DM, {}).get(mc.WRAPPER_KEY, [])) == 1)


# --------------------------------------- 5. order: ahead of a skipping wrapper
print("\n5. INSTALL ORDER (the SLA hazard: executor.original() skips the rest)")
with_state("compat_needed")
src = patcher()
src.add_wrapper_with_key(DM, "h3_sla_state", lambda executor, *a, **k: executor.original(*a, **k))
m, rep = mc.apply_h3_mask_velocity_compat(src, "both", "auto")
check("   our key is first in the wrapper dict",
      list(m.wrappers[DM])[0] == mc.WRAPPER_KEY, str(list(m.wrappers[DM])))
check("   the report names who we jumped", "h3_sla_state" in rep)
o = run(m, VMASK, None)
check("   and we still fire through a wrapper that calls original()",
      torch.equal(o[0], V_RAW * VMASK))

# ------------------------------- 6. handoff s.6.5: mask BEFORE the audio carry
print("\n6. AUDIO CARRY ORDERING (compat handoff s.6.5)")
print("   video shift 12, audio shift 3, audio_scale 1.7, non-uniform audio mask")
check("   the model's shifts are the real 12 / 3",
      (H3.sigma_shift_video, H3.sigma_shift_audio) == (12.0, 3.0),
      "%s / %s" % (H3.sigma_shift_video, H3.sigma_shift_audio))
check("   the audio mask is non-uniform",
      float(AMASK.min()) > 0 and float(AMASK.max()) < 1
      and len(set(AMASK.reshape(-1).tolist())) == AMASK.numel())

with_state("compat_needed")
m, _ = mc.apply_h3_mask_velocity_compat(patcher(), "both", "auto")
SCALE = 1.7
# ours: raw network + our wrapper, then core's real carry
got = run(m, VMASK, AMASK, audio_scale=SCALE, pre_scale=False)
# native #15988: the multiplication happens before the carry, inside forward
want = run(patcher(), VMASK, AMASK, audio_scale=SCALE, pre_scale=True)
dv = (got[0] - want[0]).abs().max().item()
da = (got[1] - want[1]).abs().max().item()
check("   video matches native #15988 exactly", torch.equal(got[0], want[0]),
      "max abs diff %.3e" % dv)
check("   audio matches native #15988 exactly", torch.equal(got[1], want[1]),
      "max abs diff %.3e" % da)
check("   the carry actually ran (audio_scale 1.7 changed the audio)",
      not torch.allclose(want[1], A_RAW * AMASK),
      "max |carried - masked raw| = %.4f"
      % (want[1] - A_RAW * AMASK).abs().max().item())
# the negative control: the same multiplication AFTER the carry is a different
# number, which is why the PR's ordering is not a style preference
raw = run(patcher(), VMASK, AMASK, audio_scale=SCALE, pre_scale=False)
wrong = raw[1] * AMASK
check("   masking AFTER the carry gives a DIFFERENT answer (the wrong order)",
      not torch.allclose(wrong, want[1]),
      "max abs diff %.4f" % (wrong - want[1]).abs().max().item())

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
