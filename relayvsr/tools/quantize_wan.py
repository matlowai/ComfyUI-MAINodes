"""Pre-quantize the RelayVSR X4 Wan checkpoint's 300 block linears with comfy-kitchen.

usage: quantize_wan.py <wan.safetensors> <out.safetensors> <int8_convrot|w6a8|w4a8>

int8_convrot: <base>.qweight int8 [out, in] + <base>.qscale fp32 (W8A8 ConvRot, 256-wide Hadamard groups).
w6a8 / w4a8:  <base>.w4a8_q, .w4a8_s_rel, .w4a8_s_channel (+ .w4a8_codebook / .w4a8_correction when present),
              comfy-kitchen grouped W6A8 / W4A8 with int8 activations.
Everything else (norms, biases, modulation tables, pre/post) is copied unchanged. The original metadata is kept,
plus relayvsr_quant = {"mode", "comfy_kitchen", "source_sha256"}; the Lab worker loads these files directly.
Run in the LightX2V venv (it has comfy-kitchen) on a CUDA GPU.
"""
import hashlib
import json
import re
import sys

import comfy_kitchen
import torch
from comfy_kitchen.tensor.int8 import TensorWiseINT8Layout
from safetensors import safe_open
from safetensors.torch import save_file

LINEAR = re.compile(r"^blocks\.\d+\..+\.weight$")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 24), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    src, dst, mode = sys.argv[1:4]
    if mode not in ("int8_convrot", "w6a8", "w4a8"):
        raise SystemExit("mode must be int8_convrot, w6a8 or w4a8")
    out, count = {}, 0
    with safe_open(src, "pt", device="cpu") as f:
        metadata = dict(f.metadata() or {})
        for key in f.keys():
            tensor = f.get_tensor(key)
            if not (LINEAR.match(key) and tensor.ndim == 2):
                out[key] = tensor
                continue
            base, weight = key.removesuffix(".weight"), tensor.cuda()
            if mode == "int8_convrot":
                q, params = TensorWiseINT8Layout.quantize(weight, is_weight=True, per_channel=True, convrot=True, convrot_groupsize=256)
                out[base + ".qweight"], out[base + ".qscale"] = q.cpu(), params.scale.float().cpu()
            else:
                q, s_rel, s_channel, correction, codebook = comfy_kitchen.quantize_w4a8_int8_weight(weight, bits=6 if mode == "w6a8" else 4)
                for name, value in (("q", q), ("s_rel", s_rel), ("s_channel", s_channel), ("correction", correction), ("codebook", codebook)):
                    if value is not None:
                        out[f"{base}.w4a8_{name}"] = value.contiguous().cpu()
            count += 1
    metadata["relayvsr_quant"] = json.dumps({"mode": mode, "linears": count, "comfy_kitchen": getattr(comfy_kitchen, "__version__", "0.2.40"),
                                             "source_sha256": sha256(src)})
    save_file({k: v.contiguous() for k, v in out.items()}, dst, metadata=metadata)
    print(f"{dst}: {count} linears -> {mode}")


if __name__ == "__main__":
    main()
