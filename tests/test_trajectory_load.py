#!/usr/bin/env python3
"""Unit test for H3TrajectoryLoad, the resume half of the trajectory bank.

  python tests/test_trajectory_load.py
      CPU only, no GPU, no models. Needs comfy on sys.path for
      comfy.utils.pack_latents / unpack_latents and comfy.nested_tensor.

Why this exists: the bank records comfy's PACKED latent (every stream
flattened to (B, 1, N)), so for an AV model like H3 the file holds video
and audio in one vector, and the first Load handed that vector to the
model as a single stream (IndexError at model.py x[1]). The 2026-08-27 fix
unpacks it. These are the properties the fix promised, on a synthetic bank
whose values are exact in fp16 so equality is exact:

  1. PACKED + latent_shapes in the file -> a NestedTensor of the original
     streams; video bit-equal; audio bit-equal after / audio_scale.
  2. PACKED without latent_shapes + a `reference` LATENT -> the same.
  3. Single-stream packed + a plain reference -> reshaped to the reference.
  4. Legacy file with a separate "audio" key -> nested, audio / audio_scale.
  5. audio_scale 0 leaves audio untouched.
  6. Schedule: returns sigmas[k:] (x_step{k} is x ENTERING step k) and k.
  7. undo_const_scaling multiplies every stream by 1/(1-sigma_k).
  8. No shapes and no reference on a packed file -> a named ValueError
     (handing the packed vector downstream is the exact pre-fix failure).
  9. IS_CHANGED accepts the optional inputs and tracks the file mtime.
 10. A reference whose streams do not sum to the banked vector -> a named
     ValueError in both directions (shorter would silently misalign).
 11. audio_scale recorded in the bank file wins over the widget; 0 = as-is.

Exit code 0 = pass.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "mainodes_motion", os.path.join(os.path.dirname(HERE), "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)

import torch
import comfy.utils
from comfy.nested_tensor import NestedTensor

K = 17
VSHAPE = (1, 32, 3, 4, 4)
ASHAPE = (1, 16, 8, 1)
FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def exact_fp16(shape, seed):
    g = torch.Generator().manual_seed(seed)
    # multiples of 1/8 in [-4, 4): exactly representable in fp16
    return (torch.randint(-32, 32, shape, generator=g).float() / 8.0)


def make_bank(tmp, video, audio=None, packed=True, shapes_in_file=True, legacy_audio=False):
    sigmas = torch.linspace(1.0, 0.0, 26)
    sigmas[K] = 0.85
    torch.save(sigmas, os.path.join(tmp, "sigmas.pt"))
    if legacy_audio:
        payload = {"step": K, "total_steps": 25, "video": video.half(), "audio": audio.half(), "packed": False}
    elif packed and audio is not None:
        vec, shapes = comfy.utils.pack_latents([video, audio])
        payload = {"step": K, "total_steps": 25, "video": vec.half(), "packed": True}
        if shapes_in_file:
            payload["latent_shapes"] = [list(int(v) for v in s) for s in shapes]
    elif packed:
        vec, shapes = comfy.utils.pack_latents([video])
        payload = {"step": K, "total_steps": 25, "video": vec.half(), "packed": True}
        if shapes_in_file:
            payload["latent_shapes"] = [list(int(v) for v in s) for s in shapes]
    else:
        payload = {"step": K, "total_steps": 25, "video": video.half(), "packed": False}
    torch.save(payload, os.path.join(tmp, f"x_step{K:03d}.pt"))
    return sigmas


def main():
    node = motion.H3TrajectoryLoad()
    video = exact_fp16(VSHAPE, 1)
    audio = exact_fp16(ASHAPE, 2)

    print("1. packed + latent_shapes in file")
    with tempfile.TemporaryDirectory() as tmp:
        sig = make_bank(tmp, video, audio)
        out, rem, step = node.load(tmp, K)
        s = out["samples"]
        check(isinstance(s, NestedTensor) and len(s.tensors) == 2, "two streams come back nested")
        check(tuple(s.tensors[0].shape) == VSHAPE and torch.equal(s.tensors[0], video), "video stream bit-equal")
        check(tuple(s.tensors[1].shape) == ASHAPE and torch.equal(s.tensors[1], audio / 4.0), "audio stream = banked / 4")
        print("6. schedule")
        check(torch.equal(rem, sig[K:]), "remaining sigmas are sigmas[k:] (len %d)" % len(rem))
        check(step == K, "step returned")

    print("2. packed, shapes only from `reference`")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio, shapes_in_file=False)
        ref = {"samples": NestedTensor((torch.zeros(VSHAPE), torch.zeros(ASHAPE)))}
        out, _, _ = node.load(tmp, K, reference=ref)
        s = out["samples"]
        check(isinstance(s, NestedTensor) and torch.equal(s.tensors[0], video) and torch.equal(s.tensors[1], audio / 4.0),
              "reference supplies the stream shapes")

    print("3. single stream packed + plain reference")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, None, shapes_in_file=False)
        out, _, _ = node.load(tmp, K, reference={"samples": torch.zeros(VSHAPE)})
        s = out["samples"]
        check(not getattr(s, "is_nested", False) and tuple(s.shape) == VSHAPE and torch.equal(s, video),
              "reshaped to the reference shape")

    print("4. legacy file with a separate audio key")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio, legacy_audio=True)
        out, _, _ = node.load(tmp, K)
        s = out["samples"]
        check(isinstance(s, NestedTensor) and torch.equal(s.tensors[1], audio / 4.0), "nested, audio / 4")

    print("5. audio_scale 0 leaves audio as-is")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio)
        out, _, _ = node.load(tmp, K, audio_scale=0.0)
        check(torch.equal(out["samples"].tensors[1], audio), "audio untouched")

    print("7. undo_const_scaling")
    with tempfile.TemporaryDirectory() as tmp:
        sig = make_bank(tmp, video, audio)
        out, _, _ = node.load(tmp, K, undo_const_scaling=True)
        s = out["samples"]
        f = 1.0 / (1.0 - float(sig[K]))
        check(torch.allclose(s.tensors[0], video * f) and torch.allclose(s.tensors[1], (audio / 4.0) * f),
              "every stream scaled by 1/(1-sigma_k) = %.4f" % f)

    print("8. packed, no shapes, no reference: a named error, never the raw vector")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio, shapes_in_file=False)
        try:
            node.load(tmp, K)
            check(False, "raised")
        except ValueError as e:
            check("reference" in str(e), "ValueError names the reference input")

    print("10. reference from a different clip: a named error, never silent misalignment")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio, shapes_in_file=False)
        short = {"samples": NestedTensor((torch.zeros(1, 32, 2, 4, 4), torch.zeros(1, 16, 5, 1)))}
        try:
            node.load(tmp, K, reference=short)
            check(False, "raised on a shorter reference")
        except ValueError as e:
            check("misalign" in str(e), "shorter reference rejected with the sizes named")
        longer = {"samples": NestedTensor((torch.zeros(1, 32, 4, 4, 4), torch.zeros(1, 16, 9, 1)))}
        try:
            node.load(tmp, K, reference=longer)
            check(False, "raised on a longer reference")
        except ValueError as e:
            check("misalign" in str(e), "longer reference rejected with the sizes named")

    print("11. audio_scale recorded in the bank file wins over the widget")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio)
        d = torch.load(os.path.join(tmp, f"x_step{K:03d}.pt"), weights_only=True)
        d["audio_scale"] = 2.0
        torch.save(d, os.path.join(tmp, f"x_step{K:03d}.pt"))
        out, _, _ = node.load(tmp, K, audio_scale=4.0)
        check(torch.equal(out["samples"].tensors[1], audio / 2.0), "file value 2.0 used, widget 4.0 ignored")
        out, _, _ = node.load(tmp, K, audio_scale=0.0)
        check(torch.equal(out["samples"].tensors[1], audio), "widget 0 still means leave as-is")

    print("9. IS_CHANGED")
    with tempfile.TemporaryDirectory() as tmp:
        make_bank(tmp, video, audio)
        a = motion.H3TrajectoryLoad.IS_CHANGED(tmp, K, reference=None, audio_scale=4.0, undo_const_scaling=True)
        check(a == a, "returns a number for an existing file")
        b = motion.H3TrajectoryLoad.IS_CHANGED(tmp, K + 1)
        check(b != b, "NaN for a missing step file")

    print("\nRESULT:", "PASS" if not FAILS else "FAIL %d" % len(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
