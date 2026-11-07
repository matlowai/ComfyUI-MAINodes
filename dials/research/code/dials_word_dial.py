#!/usr/bin/env python3
"""J2: word dials without a Jacobian (logit-lens directions through H3's projection and refiner).

H3's text encoder = upstream Qwen3-VL-32B-Instruct layers 0-49 (J1: bit-identical tensors), output = unnormalized
hidden after layer 50. A word's direction in that space is g ⊙ u_w (u_w = upstream output-head row, g = upstream final
RMSNorm weight): logit_w = u_w · (g ⊙ h / rms(h)). For a word list: mean of unit word directions (over its tokens and
spellings " word", "word", " Word"), unit.

Dial = mean over base prompts of [refiner(proj(h + α·v on every token but the first)) − refiner(proj(h))] token-means,
α = r × the prompt's median token norm (first token excluded); then the 3-direction nuisance debias exactly as Make Dial;
then rescaled to the norm of a reference dial (default h3_evil_sinister) so strength 1 is a comparable push.

Run from the ComfyUI root:  python <this> --lists name=w1,w2,... [...] --out report.json [--save]
"""
import argparse
import json
import os
import sys


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lists", nargs="+", required=True, help="name=word1,word2,...")
    ap.add_argument("--clip", default="minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors")
    ap.add_argument("--unet", default="minimax_h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors")
    ap.add_argument("--tail", default=os.environ.get("QWEN3VL_TAIL"), required=os.environ.get("QWEN3VL_TAIL") is None,
                    help="upstream Qwen3-VL-32B-Instruct shard holding lm_head + final norm (model-00014-of-00014.safetensors), with shards 11-14 and config.json in the same folder")
    ap.add_argument("--r", type=float, default=0.5, help="push size as a fraction of the median token norm")
    ap.add_argument("--ref-dial", default="h3_evil_sinister")
    ap.add_argument("--out", required=True)
    ap.add_argument("--method", choices=["logit", "jlens"], default="logit",
                    help="logit: g*u_w at layer 50; jlens: per-word J-lens vector through upstream layers 50-63 (J3)")
    ap.add_argument("--center", action="store_true",
                    help="also write h3_jc_<name>: each dial minus the mean of all lists in this run (include a bland list), "
                         "rescaled to the reference size; the raw dials share one big 'any word' direction")
    ap.add_argument("--save", action="store_true", help="write loras/dials/h3_w_<name>.safetensors")
    return ap.parse_args()


ARGS = parse()
sys.argv = sys.argv[:1]
sys.path.insert(0, os.getcwd())
sys.path.insert(0, os.path.join(os.getcwd(), "custom_nodes"))
import torch  # noqa: E402
import comfy.options  # noqa: E402
comfy.options.enable_args_parsing()
import folder_paths  # noqa: E402
import comfy.model_management as mm  # noqa: E402
import nodes  # noqa: E402
from importlib import import_module  # noqa: E402
from safetensors import safe_open  # noqa: E402

core = import_module("ComfyUI-MAINodes.dials.core")

SCENE = ("integrated_multimodal_description: [Shot 1] Cinematic, natural light. An adult woman in a red coat walks along "
         "an empty train platform at dusk as a train slowly pulls in beside her. The camera tracks with her.\n\n"
         "overall_soundscape: Her footsteps on concrete, the train's brakes hissing, a distant announcement echoing.\n\n"
         "non_diegetic_music: N/A")
BASES = [SCENE, "A woman walks through a busy market.", "A dog runs along a beach.", "An old car drives down a country road.",
         "A man cooks in a small kitchen.", "Children play in a park in the afternoon.", "A cat sits on a windowsill.",
         "A cyclist rides through a city street."]


def ids_of(clip, text):
    tok = clip.tokenize(text)
    key = next(iter(tok))
    return [t[0] for batch in tok[key] for t in batch]


def jlens_vectors(states, word_ids, tail_dir, dev):
    """Per-token J-lens vectors at H3's output (layer 50): for token t, the gradient of logit_t summed over target
    positions with respect to h_50, averaged over source positions (first excluded) and prompts (the paper's estimator,
    with the causal tail making targets >= source). Tail = upstream Qwen3-VL-32B layers 50-63 + final norm + lm_head."""
    import glob
    from safetensors import safe_open as so
    from transformers.models.qwen3_vl.modeling_qwen3_vl import Qwen3VLTextModel, Qwen3VLTextConfig
    cfg = json.load(open(os.path.join(tail_dir, "config.json")))["text_config"]
    cfg = dict(cfg, num_hidden_layers=14)
    tcfg = Qwen3VLTextConfig(**cfg)
    tcfg._attn_implementation = "sdpa"
    with torch.device("meta"):
        tail = Qwen3VLTextModel(tcfg)
    sd, head = {}, None
    for shard in sorted(glob.glob(os.path.join(tail_dir, "model-000*.safetensors"))):
        with so(shard, "pt") as f:
            for k in f.keys():
                if k == "lm_head.weight":
                    head = f.get_tensor(k)
                elif k == "model.language_model.norm.weight":
                    sd["norm.weight"] = f.get_tensor(k)
                elif k.startswith("model.language_model.layers."):
                    n = int(k.split(".")[3])
                    if n >= 50:
                        sd[f"layers.{n - 50}." + ".".join(k.split(".")[4:])] = f.get_tensor(k)
    sd = {k: v for k, v in sd.items()}
    missing = [k for k in tail.state_dict() if k not in sd and "embed_tokens" not in k and "rotary" not in k]
    assert not missing, missing[:5]
    tail.embed_tokens = None
    tail.load_state_dict(sd, strict=False, assign=True)
    tail.rotary_emb = type(tail.rotary_emb)(config=tcfg)
    tail = tail.to(dev, torch.bfloat16).eval()
    for p_ in tail.parameters():
        p_.requires_grad_(False)
    head = head.to(dev, torch.bfloat16)
    all_ids = sorted({i for ids in word_ids.values() for i in ids})
    rows = head[all_ids]  # [T, 5120]
    acc = torch.zeros(len(all_ids), 5120, device=dev, dtype=torch.float32)
    count = 0
    for h in states:
        x = h.to(dev, torch.bfloat16).unsqueeze(0).detach().requires_grad_(True)
        out = tail(inputs_embeds=x, use_cache=False).last_hidden_state[0]  # final-normed h_64 [L, 5120]
        logits = out @ rows.T  # [L, T]
        for j in range(len(all_ids)):
            gr = torch.autograd.grad(logits[:, j].sum(), x, retain_graph=j < len(all_ids) - 1)[0][0, 1:].float()
            acc[j] += gr.mean(0)
        count += 1
    acc /= count
    vec_of = {t: acc[k] for k, t in enumerate(all_ids)}
    del tail, head
    torch.cuda.empty_cache()
    return vec_of


def main():
    a = ARGS
    with safe_open(a.tail, "pt") as f:
        U = f.get_tensor("lm_head.weight").float()
        g = f.get_tensor("model.language_model.norm.weight").float()
    clip = nodes.CLIPLoader().load_clip(a.clip, type="minimax")[0]
    model = nodes.UNETLoader().load_unet(a.unet, "default")[0]
    path = core.text_path(model)
    dm = model.model.diffusion_model
    proj = dm.get_submodule(path.pre)
    special = set(ids_of(clip, "")) | set(ids_of(clip, " "))

    jvec = {}

    def word_dir(words):
        dirs, toks = [], {}
        for w in words:
            for s in (" " + w, w, " " + w.capitalize()):
                ids = [i for i in ids_of(clip, s) if i not in special]
                toks[s] = ids
                for i in ids:
                    d = jvec[i].cpu() if a.method == "jlens" else g * U[i]
                    dirs.append(d / d.norm())
        v = torch.stack(dirs).mean(0)
        return v / v.norm(), toks

    nuisance = core.nuisance_pairs("")
    texts = list(dict.fromkeys(BASES + [t for pair in nuisance for s in pair for t, _ in core.side_terms(s)]))
    states = {t: clip.encode_from_tokens_scheduled(clip.tokenize(t))[0][0][0] for t in texts}
    if a.method == "jlens":
        lists = {it.split("=", 1)[0]: [w.strip() for w in it.split("=", 1)[1].split(",") if w.strip()] for it in a.lists}
        word_ids = {f"{n}:{w}:{v}": [i for i in ids_of(clip, v) if i not in special]
                    for n, ws in lists.items() for w in ws for v in (" " + w, w, " " + w.capitalize())}
        mm.unload_all_models()
        jvec.update(jlens_vectors(list(states[t] for t in texts), word_ids, os.path.dirname(a.tail), mm.get_torch_device()))
        print("jlens vectors:", len(jvec), "tokens over", len(texts), "prompts", flush=True)
    mm.load_models_gpu([model])
    dev, dt = mm.get_torch_device(), model.model.get_dtype_inference()

    def post_mean(h):
        with torch.no_grad():
            return path.refine(dm, proj(h.to(dev, dt))).float().mean(0)

    base_post = {t: post_mean(states[t]) for t in texts}
    basis = core.nuisance_basis(nuisance, lambda t: base_post[t], 3)
    ref = core.load_dial(f"dials/{a.ref_dial}.safetensors")["vec"].float().flatten().to(dev)
    library = {}
    for fn in sorted(os.listdir(folder_paths.get_full_path_or_raise("loras", f"dials/{a.ref_dial}.safetensors").rsplit("/", 1)[0])):
        if fn.endswith(".safetensors"):
            try:
                d = core.load_dial(f"dials/{fn}")
                if d["mode"] == "post" and d["vec"].numel() == ref.numel():
                    library[fn[:-12]] = d["vec"].float().flatten().to(dev)
            except Exception:
                pass

    def shift(v, r):
        out = []
        for t in BASES:
            h = states[t].to(dev, torch.float32)
            alpha = r * float(h[1:].norm(dim=1).median())
            push = torch.zeros_like(h)
            push[1:] = alpha * v.to(dev)
            out.append(post_mean(h + push) - base_post[t])
        return torch.stack(out).mean(0)

    vecs = {}
    report = {"method": a.method, "r": a.r, "ref_dial": a.ref_dial, "ref_norm": float(ref.norm()), "dials": {}}
    for item in a.lists:
        name, words = item.split("=", 1)
        words = [w.strip() for w in words.split(",") if w.strip()]
        v, toks = word_dir(words)
        raw = shift(v, a.r)
        half = shift(v, a.r / 2)
        vec = raw - basis @ (basis.T @ raw)
        removed = 1 - float(vec.norm() ** 2 / raw.norm() ** 2)
        native = float(vec.norm())
        vec = vec * (ref.norm() / vec.norm())
        vecs[name] = vec
        cosl = sorted(((float(vec @ x / (vec.norm() * x.norm())), k) for k, x in library.items()), reverse=True)
        report["dials"][name] = {
            "words": words, "tokens": toks, "native_norm": native, "debias_removed": removed,
            "linearity_cos_half_vs_full": float(raw @ half / (raw.norm() * half.norm())),
            "top5": cosl[:5], "bottom3": cosl[-3:]}
        if a.save:
            dial = {"vec": vec.cpu(), "target": path.post, "mode": "post",
                    "meta": {"name": f"h3_{'j' if a.method == 'jlens' else 'w'}_{name}", "model_family": path.family, "pairs": [], "n_pairs": "0",
                             "inject": "post_refiner", "pair_agreement_cos": "n/a", "debias_removed": f"{removed:.3f}", "calibrated": "False",
                             "format": "ComfyUI-Dials v1", "word_dial": json.dumps({"words": words, "r": a.r,
                             "method": ("J-lens vectors via upstream layers 50-63, J3" if a.method == "jlens" else "logit-lens g*u_w, J2") + " through proj+refiner", "scaled_to": a.ref_dial})}}
            core.save_dial(dial, f"h3_{'j' if a.method == 'jlens' else 'w'}_{name}")
        print(name, f"native {native:.1f} debias {removed:.0%} lin {report['dials'][name]['linearity_cos_half_vs_full']:.3f}",
              "top:", ", ".join(f"{k} {c:+.2f}" for c, k in cosl[:3]), flush=True)
    if a.center and len(vecs) > 1:
        mean = torch.stack(list(vecs.values())).mean(0)
        report["centered"] = {}
        for name, v in vecs.items():
            c = v - mean
            c = c * (ref.norm() / c.norm())
            cosl = sorted(((float(c @ x / (c.norm() * x.norm())), k) for k, x in library.items()), reverse=True)
            report["centered"][name] = {"top5": cosl[:5], "bottom3": cosl[-3:]}
            print("centered", name, "top:", ", ".join(f"{k} {cc:+.2f}" for cc, k in cosl[:3]), flush=True)
            if a.save:
                words = report["dials"][name]["words"]
                dial = {"vec": c.cpu(), "target": path.post, "mode": "post",
                        "meta": {"name": f"h3_jc_{name}", "model_family": path.family, "pairs": [], "n_pairs": "0",
                                 "inject": "post_refiner", "pair_agreement_cos": "n/a", "calibrated": "False",
                                 "format": "ComfyUI-Dials v1", "word_dial": json.dumps({
                                     "words": words, "r": a.r, "method": f"{a.method} lens through proj+refiner",
                                     "scaled_to": a.ref_dial, "centered": f"minus the mean of {len(vecs)} lists in this run: "
                                     + ", ".join(vecs)})}}
                core.save_dial(dial, f"h3_jc_{name}")
    names = list(vecs)
    report["pairwise_cos"] = {f"{x}|{y}": float(vecs[x] @ vecs[y] / (vecs[x].norm() * vecs[y].norm()))
                              for i, x in enumerate(names) for y in names[i + 1:]}
    json.dump(report, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
