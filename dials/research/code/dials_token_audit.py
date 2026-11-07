#!/usr/bin/env python3
"""Dials research T1 (+ the offline half of T2): which tokens carry a dial's direction?

Re-encodes the stored pairs of shipped dials exactly as MAINodes Make Dial does (text encoder -> condition_proj ->
token_refiner, float32 token means) and reports, per dial:
  - token norms: first token vs the median token, at the encoder output (5120) and after the refiner (5376);
  - each token's signed share of the raw pair-mean difference d = mean_pairs( mean(B) - mean(A) ):
    share_i = <c_i, d> / |d|^2 with c_i = +B_i/L_B for B tokens and -A_i/L_A for A tokens (shares sum to 1);
    reported: first-token share (summed over pairs), top-3 fraction of absolute share per pair, differing-span share;
  - pooling variants (raw, before debias): whole mean (today), first token excluded, differing span only; cosine of
    each to the shipped dial and to today's raw mean, and the vector norms.
Optionally writes the variant vectors as dial files (`--save-variants`) for T3.

Run with the ComfyUI venv from the ComfyUI root, GPU with ~45 GB free:
  cd <ComfyUI root> && python <this> --dials h3_evil_sinister h3_x_datamosh ... --out report.json
"""
import argparse
import json
import os
import sys


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dials", nargs="+", required=True)
    ap.add_argument("--clip", default="minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors")
    ap.add_argument("--unet", default="minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors")
    ap.add_argument("--out", required=True)
    ap.add_argument("--save-variants", action="store_true",
                    help="write variant dials as loras/dials/h3_t2_<dial>_<variant>.safetensors")
    return ap.parse_args()


ARGS = parse()
sys.argv = sys.argv[:1]  # ComfyUI parses argv on import; give it none of ours
sys.path.insert(0, os.getcwd())
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
import torch  # noqa: E402
import comfy.options  # noqa: E402
comfy.options.enable_args_parsing()
import folder_paths  # noqa: E402,F401
import comfy.model_management as mm  # noqa: E402
import nodes  # noqa: E402
from importlib import import_module  # noqa: E402

core = import_module("ComfyUI-MAINodes.dials.core")


def cos(x, y):
    return float(x @ y / (x.norm() * y.norm()))


def main():
    a = ARGS
    clip = nodes.CLIPLoader().load_clip(a.clip, type="minimax")[0]
    model = nodes.UNETLoader().load_unet(a.unet, "default")[0]
    path = core.text_path(model)
    dm = model.model.diffusion_model
    proj = dm.get_submodule(path.pre)

    def encode(text):
        tokens = clip.tokenize(text)
        key = next(iter(tokens))
        ids = [t[0] for batch in tokens[key] for t in batch]
        h = clip.encode_from_tokens_scheduled(tokens)[0][0][0]  # [L, 5120]
        mm.load_models_gpu([model])
        dev, dt = mm.get_torch_device(), model.model.get_dtype_inference()
        with torch.no_grad():
            pre = proj(h.to(dev, dt))
            post = path.refine(dm, pre).float()
        return ids, h.float().cpu(), post.cpu()

    report = {"clip": a.clip, "unet": a.unet, "dials": {}}
    for name in a.dials:
        dial = core.load_dial(f"dials/{name}.safetensors")
        shipped = dial["vec"].float().flatten()
        pairs = json.loads(dial["meta"]["pairs"])
        diffs, contrib, span_info = [], [], []
        variants = {"mean_all": [], "mean_excl_tok0": [], "diff_span": []}
        norms = {"enc_tok0": [], "enc_median": [], "post_tok0": [], "post_median": []}
        for A, B in pairs:
            ia, ha, pa = encode(A)
            ib, hb, pb = encode(B)
            for h, p in ((ha, pa), (hb, pb)):
                n_e, n_p = h.norm(dim=1), p.norm(dim=1)
                norms["enc_tok0"].append(float(n_e[0]))
                norms["enc_median"].append(float(n_e[1:].median()))
                norms["post_tok0"].append(float(n_p[0]))
                norms["post_median"].append(float(n_p[1:].median()))
            la, lb = pa.shape[0], pb.shape[0]
            d = pb.mean(0) - pa.mean(0)
            diffs.append(d)
            contrib.append((pa, pb, la, lb))
            variants["mean_all"].append(d)
            variants["mean_excl_tok0"].append(pb[1:].mean(0) - pa[1:].mean(0))
            pre_n = 0  # differing span by token ids: strip the common prefix and suffix
            while pre_n < min(la, lb) and ia[pre_n] == ib[pre_n]:
                pre_n += 1
            suf_n = 0
            while suf_n < min(la, lb) - pre_n and ia[la - 1 - suf_n] == ib[lb - 1 - suf_n]:
                suf_n += 1
            sa, sb = pa[pre_n:la - suf_n], pb[pre_n:lb - suf_n]
            span_info.append((pre_n, la - suf_n, lb - suf_n, la, lb))
            if sa.shape[0] and sb.shape[0]:
                variants["diff_span"].append(sb.mean(0) - sa.mean(0))
        dmean = torch.stack(diffs).mean(0)
        e = float(dmean @ dmean)
        n = len(diffs)
        tok0, top3, span = [], [], []
        for (pa, pb, la, lb), (p0, ea, eb, _, _) in zip(contrib, span_info):
            ca = -(pa @ dmean) / la / e / n
            cb = (pb @ dmean) / lb / e / n
            tok0.append(float(ca[0] + cb[0]))
            allc = torch.cat([ca, cb])
            top3.append(float(allc.abs().topk(min(3, allc.numel())).values.sum() / allc.abs().sum()))
            span.append(float(ca[p0:ea].sum() + cb[p0:eb].sum()))
        vec = {k: torch.stack(v).mean(0) for k, v in variants.items() if v}
        rep = {
            "n_pairs": n,
            "norms": {k: round(sum(v) / len(v), 1) for k, v in norms.items()},
            "share_tok0_total": round(sum(tok0), 4),
            "top3_fraction_of_abs_share_per_pair": round(sum(top3) / len(top3), 4),
            "share_diff_span_total": round(sum(span), 4),
            "span_tokens_mean_A": round(sum(ea - p0 for p0, ea, _, _, _ in span_info) / n, 1),
            "tokens_mean_A": round(sum(la for *_, la, _ in span_info) / n, 1),
            "variants": {k: {"norm": round(float(v.norm()), 2), "cos_to_shipped": round(cos(v, shipped), 4),
                             "cos_to_mean_all": round(cos(v, vec["mean_all"]), 4)} for k, v in vec.items()},
        }
        report["dials"][name] = rep
        print(name, json.dumps(rep), flush=True)
        if a.save_variants:
            for k, v in vec.items():
                if k == "mean_all":
                    continue
                out = dict(dial)
                out["vec"] = v
                out["meta"] = dict(dial["meta"], name=f"h3_t2_{name[3:]}_{k}", pooling=k, debias_removed="off (variant)")
                core.save_dial(out, f"h3_t2_{name[3:]}_{k}")
    json.dump(report, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
