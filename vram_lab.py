# SPDX-License-Identifier: GPL-3.0-or-later
"""VRAM Lab (alpha, 2026-08-18): exact low-memory execution of MiniMax-H3 blocks.

The problem, measured 2026-08-17/18 on an RTX PRO 6000 (numbers below): a full-length H3 forward materialises, per DiT block, the fused
QKV projection ``[N, 3*7168]`` and the SwiGLU pre-activation ``[N, 2*14336]``
for the whole packed sequence. At ~217k tokens (an 8 s clip de-roped at
d_max 4) those two tensors are 8.7 GiB and 15.4 GiB, and the MLP-phase peak is
~24 GiB before weights. That is what OOMs 24 GB cards on the de-rope.

What this module does instead, per block, with the SAME math:

    phase 1  for each token chunk: h = mod(norm1(x_c)); qkv = qkv_proj(h);
             keep K, V (RMS-normed + RoPE'd) into full-sequence buffers,
             discard Q.
    phase 2  for each token chunk: recompute h and qkv, keep Q only;
             attention(Q_c, K, V) is exact per query row (flash / SDPA);
             out_proj; gated residual written in place into x[c].
    phase 3  for each token chunk: mod(norm2(x_c)) -> mlp -> gated residual.

Peak per block falls from ~N x 118 KB (MLP phase) to ~N x 39 KB (x + K + V)
plus chunk-sized transients. The projection is run twice (phase 1 and 2); at
217k tokens that is ~4% of the block's FLOPs, because attention is N^2 and
projections are N. This costs no exactness: the int8 kernel quantises
activations per row, so chunking rows is bit-identical (measured
2026-08-18 on comfy_kitchen TensorWiseINT8), and every other weight format
goes through the module's own forward, weight streaming included.

``kv_block > 0`` (experimental): phase 2 attends K/V in blocks and combines
with the flash kernel's log-sum-exp (online softmax), measured to one bf16
ulp against a single call. AS BUILT it does NOT lower memory: K and V are
still materialised in full by phase 1, and the blockwise combine adds
buffers (measured +13.0 GiB forward peak vs +11.9 plain at 216k tokens,
~7% slower). A real "turtle" needs K/V staged in host RAM and streamed per
block; until then leave it at 0.

Composition: MLP chunking here is optional (``mlp_chunk = 0`` leaves the
model's own ``mlp.forward`` alone, so KJNodes' MiniMax H3 Chunk FeedForward
keeps working). Attention goes through ``optimized_attention`` so Sol-Attn
style overrides still apply; head-group chunking from KJNodes' Low VRAM
Attention is read from ``transformer_options["minimax_head_chunks"]``.

Not a quality dial. If it changes the picture, it is a bug; the gate is a
same-seed difference clip against the stock block.
"""
import logging
import math
import os
import time

import torch

import comfy.model_management
import comfy.quant_ops
import comfy.ldm.common_dit
import comfy.model_prefetch
import comfy.ldm.minimax.model as _h3m
from comfy.ldm.modules.attention import AttentionTensorContainer, optimized_attention

try:  # A5b: SageAttention's kernels take pre-quantised K/V; optional
    from sageattention import quant as _sage_quant
    from sageattention import sm89_compile as _sage_sm89
    _SAGE_OK = True
except Exception:  # noqa: BLE001
    _sage_quant = _sage_sm89 = None
    _SAGE_OK = False

log = logging.getLogger("MAINodes.vram_lab")


# --------------------------------------------------------------------------- helpers

def _ranges(n, size, min_tail=512):
    """Row chunks of `size`; a tail shorter than `min_tail` is folded into the
    previous chunk. Row-wise ops are exact at any chunk size, but comfy_kitchen
    picks a different int8 GEMM kernel for m <= 128 rows (`_prefer_turing_fused_int8`)
    and its fp32 epilogue is not proven identical across kernels, so never emit
    a tiny tail (2026-08-18)."""
    if size <= 0 or size >= n:
        return [(0, n)]
    out = [(a, min(a + size, n)) for a in range(0, n, size)]
    if len(out) > 1 and out[-1][1] - out[-1][0] < min_tail:
        a, _ = out.pop()
        out[-1] = (out[-1][0], n)
    return out


_SM_CACHE = {}


def _sm_count(device):
    key = str(device)
    if key not in _SM_CACHE:
        try:
            _SM_CACHE[key] = torch.cuda.get_device_properties(device).multi_processor_count
        except Exception:
            _SM_CACHE[key] = 128
    return _SM_CACHE[key]


def _min_query_chunk(device, heads_per_call, q_block=128, margin=2):
    """Smallest query chunk that keeps the flash kernel on its non-split path.

    Measured 2026-08-18 on an RTX PRO 6000 (188 SMs, 56 heads): a 259-query
    tail (168 query blocks < 188 SMs) made SDPA take its split-KV path and the
    result stopped being bit-equal to the full-length call (43% of elements
    off by ~2e-4, which diffusion amplified into a visibly different clip);
    512 queries (224 blocks) was bit-equal. Query chunking is exact only while
    every chunk has at least ~SMs query blocks, so we require margin x SMs.

    Measured boundary (same card, 215k K/V, 2026-08-18): flash leaves its split-KV path exactly when
    heads_per_call x ceil(L/64) >= 0.8 x 2 x SMs (PyTorch flash_api.cpp
    set_params_splitkv / num_splits_heuristic): L >= 321 / 641 / 1345 for
    56 / 28 / 14 heads. This function returns 896 / 1792 / 3456 there, a
    2.6-2.8x margin over the measured line, so it is not the constraint on
    chunk size in practice. The heuristic constants are PyTorch's and can
    move; self_check stays the authority. cuDNN and mem-efficient SDPA are
    chunk-invariant at every length (and 1.1-2x slower); no two backends are
    bit-equal to each other, and stock renders run flash, so we stay on flash.
    """
    return q_block * math.ceil(margin * _sm_count(device) / max(1, heads_per_call))


def _balanced_ranges(n, size, min_size):
    """Split [0, n) into chunks of at most `size` tokens, all of length >= min_size
    (the tail is folded into its neighbour rather than left short). One chunk if
    n < 2 * min_size."""
    if size <= 0 or size >= n or n < 2 * min_size:
        return [(0, n)]
    parts = max(1, math.ceil(n / size))
    while parts > 1 and n / parts < min_size:
        parts -= 1
    base, extra = divmod(n, parts)
    out, a = [], 0
    for i in range(parts):
        b = a + base + (1 if i < extra else 0)
        out.append((a, b))
        a = b
    return out


def _mod_scale_shift_range(h, shift, scale, segments, c0, c1):
    """h is norm(x[c0:c1]); apply the per-segment affine restricted to [c0, c1)."""
    for a, b, row in segments:
        lo, hi = max(a, c0), min(b, c1)
        if lo < hi:
            h[lo - c0:hi - c0].mul_(1.0 + scale[row].to(h.dtype)).add_(shift[row].to(h.dtype))
    return h


def _mod_gate_range(x, gate, other, segments, c0, c1):
    """x[c0:c1] += gate[row] * other, per segment, in place on the full residual."""
    for a, b, row in segments:
        lo, hi = max(a, c0), min(b, c1)
        if lo < hi:
            x[lo:hi].addcmul_(other[lo - c0:hi - c0], gate[row].to(x.dtype))
    return x


def _norm_rope(attn, q, k, rope_c, s):
    """Mirror of Attention.forward's fused RMSNorm + split-half RoPE on a chunk.

    q, k: [s, heads*hd] views into the chunk's qkv buffer (split on last dim,
    viewable as [1, s, heads, hd] exactly as core does). Returns [s, heads, hd].
    """
    heads, hd = attn.heads, attn.head_dim
    if rope_c is not None:
        q = q.view(1, s, heads, hd)
        k = k.view(1, s, heads, hd)
        qw = comfy.model_management.cast_to(attn.q_norm.weight, device=q.device)
        kw = comfy.model_management.cast_to(attn.k_norm.weight, device=q.device)
        rot = rope_c.shape[-3] * 2
        comfy.quant_ops.ck.rms_rope_split_half_(q, k, rope_c, qw, kw, epsilon=attn.q_norm.eps, rot_dim=rot)
        return q[0], k[0]
    return attn.q_norm(q.view(s, heads, hd)), attn.k_norm(k.view(s, heads, hd))


def _blockwise_attention(qc, K, V, block, out_dtype):
    """Exact attention of qc [1,H,c,hd] against K,V [1,H,S,hd] in K/V blocks.

    Uses the flash kernel's per-row logsumexp for the online-softmax combine.
    fp32 accumulator; result cast to out_dtype. Slow on purpose.
    """
    op = torch.ops.aten._scaled_dot_product_flash_attention.default
    S = K.shape[2]
    acc = None
    lse_acc = None
    for a, b in _ranges(S, block):
        r = op(qc, K[:, :, a:b].contiguous(), V[:, :, a:b].contiguous(), 0.0, False, False)
        acc, lse_acc = _online_combine(acc, lse_acc, r[0], r[1])
        del r
    return acc.to(out_dtype)


def _attend(qc, K, V, heads, head_chunks, transformer_options):
    """qc [1,H,c,hd]; K,V [1,H,S,hd] -> [1, c, H*hd]. Honors KJ-style head groups."""
    hd = qc.shape[-1]
    n = max(1, min(int(head_chunks or 1), heads))
    if n <= 1:
        return optimized_attention(AttentionTensorContainer(qc), AttentionTensorContainer(K),
                                   AttentionTensorContainer(V), heads, mask=None, skip_reshape=True,
                                   transformer_options=transformer_options)
    c = qc.shape[2]
    out = torch.empty((1, c, heads * hd), dtype=qc.dtype, device=qc.device)
    hs = 0
    sizes = [heads // n + (1 if i < heads % n else 0) for i in range(n)]
    for size in sizes:
        he = hs + size
        o = optimized_attention(AttentionTensorContainer(qc[:, hs:he]), AttentionTensorContainer(K[:, hs:he]),
                                AttentionTensorContainer(V[:, hs:he]), size, mask=None, skip_reshape=True,
                                transformer_options=transformer_options)
        out[:, :, hs * hd:he * hd] = o
        hs = he
    return out



# --------------------------------------------------------------------------- kvi8r: rotated int8 K/V store (A5, approximation tier)

_HAD = {}


def _hadamard(n, device, dtype):
    """Orthonormal Hadamard n x n (n power of two), cached per device/dtype."""
    key = (n, str(device), dtype)
    if key not in _HAD:
        h = torch.ones((1, 1), dtype=torch.float32)
        while h.shape[0] < n:
            h = torch.cat([torch.cat([h, h], 1), torch.cat([h, -h], 1)], 0)
        _HAD[key] = (h / (n ** 0.5)).to(device=device, dtype=dtype)
    return _HAD[key]


def _online_combine(acc, lse_acc, o, lse):
    """Online-softmax merge of a new flash partial (o bf16, lse fp32) into the
    fp32 accumulator, in place; returns (acc, lse_acc)."""
    if acc is None:
        return o.float(), lse
    new = torch.logaddexp(lse_acc, lse)
    # mixed-dtype addcmul_ promotes o inside the kernel: no fp32 copy of the partial
    acc.mul_(torch.exp(lse_acc - new).unsqueeze(-1)).addcmul_(o, torch.exp(lse - new).unsqueeze(-1))
    return acc, new


class _Int8KV:
    """kvi8r: K/V buffers stored as int8 rows with one bf16 scale per row (per
    token, per head) in a fixed orthonormal Hadamard-rotated basis of the head
    dim. Half the bytes of bf16 (S x heads x 128 + scales).

    Second cut (2026-08-18 evening): the store keeps K and V in the ROTATED basis and
    never un-rotates them. Because the rotation is orthogonal, q.k = (qH).(kH)
    and P.V = (P.(VH)).H^T, so the query chunk is rotated once (small) and the
    attention output is un-rotated once (small); dequant of a K/V block is a
    single fused int8->fp16 cast * row scale, no GEMM, no fp32 copy of the
    block. Attention runs in fp16 in the rotated basis: bf16's 8-bit mantissa
    costs a 4.8e-3 rel-rms floor there (measured, random data) because the
    rotation spreads every value to the same magnitude, fp16's 11 bits cost
    1.7e-3; the int8 rounding (absmax/127 per 128-wide row) is ~1e-2 either
    way. NOT bit-equal to stock: approximation tier, judged by the operator's
    eyes and the sensor bank."""

    def __init__(self, heads, S, hd, device, dtype=torch.float16):
        self.heads, self.S, self.hd, self.dtype = heads, S, hd, dtype
        self.q = torch.empty((1, heads, S, hd), dtype=torch.int8, device=device)
        self.s = torch.empty((1, heads, S, 1), dtype=dtype, device=device)
        self.H = _hadamard(hd, device, dtype)

    def store(self, a, b, x):        # x [1, heads, b-a, hd] bf16
        xr = x.to(self.dtype) @ self.H                              # rotate (fp16 GEMM, fp32 accumulate)
        # scale rounded UP to the store dtype so |q| <= 127 without saturating the row max
        sc = (xr.abs().amax(dim=-1, keepdim=True).float().clamp_min_(1e-8) * (1.0 / 127.0 * (1.0 + 2.0 ** -7))).to(self.dtype)
        self.q[:, :, a:b] = torch.round(xr.float() / sc.float()).clamp_(-127, 127).to(torch.int8)
        self.s[:, :, a:b] = sc
        del xr, sc

    def load_rot(self, a, b):        # -> [1, heads, b-a, hd] dtype, ROTATED basis, contiguous
        return self.q[:, :, a:b].to(self.dtype).mul_(self.s[:, :, a:b])

    def load(self, a, b, dtype):     # -> [1, heads, b-a, hd] dtype, model basis (diagnostics only)
        return (self.load_rot(a, b).float() @ self.H.float().T).to(dtype).contiguous()

    def bytes(self):
        return self.q.numel() + self.s.numel() * self.s.element_size()


def _blockwise_attention_q(qc, Kq, Vq, block, out_dtype):
    """Attention of qc [1,H,c,hd] against kvi8r stores: rotate the query chunk
    once, attend blockwise against rotated-dequantised K/V (transient = one
    bf16 K block + one V block), online-softmax combine in fp32, un-rotate the
    output once."""
    op = torch.ops.aten._scaled_dot_product_flash_attention.default
    S = Kq.S
    qr = (qc.to(Kq.dtype) @ Kq.H).contiguous()                       # rotated query, attention dtype
    acc = None
    lse_acc = None
    for a, b in _ranges(S, block):
        kb = Kq.load_rot(a, b)
        vb = Vq.load_rot(a, b)
        r = op(qr, kb, vb, 0.0, False, False)
        del kb, vb
        acc, lse_acc = _online_combine(acc, lse_acc, r[0], r[1])
        del r
    del qr
    return (acc.to(Kq.dtype) @ Kq.H.T).to(out_dtype)                 # un-rotate once, attention dtype


# --------------------------------------------------------------------------- kvi8s: Sage-native int8/fp8 K/V store (A5b, approximation tier)

class _SageKV:
    """kvi8s: K/V kept in SageAttention's kernel layout, block by block: K int8
    with one fp32 scale per (head, 64-token block) after subtracting the block's
    per-head mean (softmax-invariant, restored in the LSE), V fp8 e4m3 in Sage's
    transposed/permuted layout with one fp32 scale per (head, channel, block).
    Same bytes as kvi8r; attention runs on int8 QK^T + fp8 PV tensor cores
    straight from the store, no dequant. Q and K are Hadamard-rotated first
    (scores invariant; spreads outliers before Sage's per-block int8 rounding).
    NOT bit-equal to stock: approximation tier, one rung below kvi8r on the
    synthetic proxy, ~1.6x faster attention than the exact path."""

    def __init__(self, heads, S, hd, device):
        if not _SAGE_OK:
            raise RuntimeError("kvi8s needs the sageattention package (2.x) importable in this venv")
        self.heads, self.S, self.hd, self.device = heads, S, hd, device
        self.H = _hadamard(hd, device, torch.bfloat16)
        self.blocks = []            # (a, b, k_int8, k_scale, km, v_fp8, v_scale)

    def store(self, a, b, k, v):     # k, v [1, heads, b-a, hd] bf16, one phase-1 chunk = one block
        k = (k.to(torch.bfloat16) @ self.H).contiguous()
        km = k.mean(dim=2, keepdim=True)                       # [1,H,1,hd]
        k_int8 = torch.empty(k.shape, dtype=torch.int8, device=k.device)
        k_scale = torch.empty((1, self.heads, (b - a + 63) // 64), dtype=torch.float32, device=k.device)
        _sage_quant._fused.quant_per_block_int8_fuse_sub_mean_cuda(k, km.squeeze(2), k_int8, k_scale, 64, 1)
        v_fp8, v_scale, _ = _sage_quant.per_channel_fp8(v.to(torch.bfloat16).contiguous(), tensor_layout="HND", scale_max=2.25, smooth_v=False)
        self.blocks.append((a, b, k_int8, k_scale, km, v_fp8, v_scale))
        del k

    def bytes(self):
        return sum(k.numel() + ks.numel() * 4 + v.numel() + vs.numel() * 4 for _, _, k, ks, _, v, vs in self.blocks)


def _sage_attention_q(qc, st, out_dtype):
    """qc [1,H,c,hd] bf16 against a _SageKV store -> [1,H,c,hd] out_dtype."""
    sm_scale = qc.shape[-1] ** -0.5
    qr = (qc.to(torch.bfloat16) @ st.H).contiguous()
    q_int8 = torch.empty(qr.shape, dtype=torch.int8, device=qr.device)
    c = qr.shape[2]
    q_scale = torch.empty((1, st.heads, ((c + 127) // 128) * 4), dtype=torch.float32, device=qr.device)
    _sage_quant._fused.quant_per_warp_int8_cuda(qr, q_int8, q_scale, 128, 32, 1)
    acc = None
    lse_acc = None
    for a, b, k_int8, k_scale, km, v_fp8, v_scale in st.blocks:
        o = torch.empty(qr.shape, dtype=torch.bfloat16, device=qr.device)
        lse = _sage_sm89.qk_int8_sv_f8_accum_f16_fuse_v_scale_attn_inst_buf(
            q_int8, k_int8, v_fp8, o, q_scale, k_scale, v_scale, 1, 0, 2, sm_scale, 1)
        # the kernel's lse is log2-based and lacks the mean-subtraction term: restore both before combining
        lse = lse / 1.44269504 + torch.matmul(qr, km.transpose(2, 3)).squeeze(-1).float() * sm_scale
        acc, lse_acc = _online_combine(acc, lse_acc, o, lse)
        del o, lse
    del qr, q_int8
    return acc.to(out_dtype)                                    # V is not rotated: no un-rotation


# --------------------------------------------------------------------------- F5: trimmed forward (release the embed buffers)

_STOCK_FORWARD_SHA = "f40e52b23fb2f9c7"       # sha256[:16] of inspect.getsource(MiniMaxH3Model._forward) this copy was made from


def _stock_forward_sha():
    import hashlib
    import inspect
    try:
        return hashlib.sha256(inspect.getsource(_h3m.MiniMaxH3Model._forward).encode()).hexdigest()[:16]
    except Exception:  # noqa: BLE001
        return None


def _trimmed_forward(self, x, timestep, context, transformer_options={}, minimax_payload=None, **kwargs):
    """Stock MiniMaxH3Model._forward (ComfyUI 0.33.0, source sha256 f40e52b2...) with the
    embed/row buffers released after the sequence is assembled (F5). Same math."""
    video_x, audio_x = x[0], x[1]
    orig_t, orig_h, orig_w = video_x.shape[2], video_x.shape[3], video_x.shape[4]
    video_x = comfy.ldm.common_dit.pad_to_patch_size(video_x, self.patch_size)
    if video_x.shape[0] != 1:
        raise ValueError("MiniMax H3 supports batch size 1")
    payload = minimax_payload or {}
    device = video_x.device
    dtype = context.dtype  # compute dtype

    latent_t, lat_h, lat_w = video_x.shape[2], video_x.shape[3], video_x.shape[4]
    audio_t = audio_x.shape[-1]
    text_len = context.shape[1]
    # extra_conds prebuilds the layout once per sampling run
    layout = payload.get("layout")
    if layout is None or layout.signature != (text_len, latent_t, lat_h, lat_w, audio_t):
        layout = _h3m.PackedLayout(text_len, latent_t, lat_h, lat_w, audio_t,
                              keyframes=payload.get("keyframes"),
                              refs=payload.get("refs"))

    # model_base passes model_sampling.timestep(sigma) = sigma * 1000
    shift_v = float(transformer_options.get("minimax_h3_sigma_shift_video", self.sigma_shift_video))
    shift_a = float(transformer_options.get("minimax_h3_sigma_shift_audio", self.sigma_shift_audio))
    sigma_v = (timestep.flatten()[0] / 1000.0).float().clamp(min=1e-6)
    t_v = float(1.0 - sigma_v)
    t_a = float(1.0 - _h3m.time_shift_sigma(sigma_v, shift_v, shift_a))

    # distinct timesteps are known analytically: text/pad follow video, cond rows pin near 1
    vis_aug = float(payload.get("visual_cond_noise_aug", _h3m.VISUAL_COND_TIMESTEP))
    aud_aug = float(payload.get("audio_cond_noise_aug", _h3m.AUDIO_COND_TIMESTEP))
    has_vis_cond = any(k in ("cond", "ref_img") for _, _, k in layout.segments)
    has_aud_cond = any(k in ("cond_audio", "ref_audio") for _, _, k in layout.segments)
    seg_t = {"text": t_v, "video": t_v, "audio": t_a,
             "cond": max(t_v, vis_aug), "ref_img": max(t_v, vis_aug),
             "cond_audio": max(t_a, aud_aug), "ref_audio": max(t_a, aud_aug)}
    unique_t = sorted({t_v, t_a} | ({seg_t["cond"]} if has_vis_cond else set())
                      | ({seg_t["ref_audio"]} if has_aud_cond else set()))
    t_row = {t: i for i, t in enumerate(unique_t)}
    seg_tag = {"text": 1, "video": 0, "audio": 2, "cond": 0, "ref_img": 0, "cond_audio": 2, "ref_audio": 2}

    text_tags = payload.get("text_token_tags")
    mod_segments = []
    for a, b, kind in layout.segments:
        row_base = t_row[seg_t[kind]] * 3
        if kind == "text" and text_tags is not None:
            # the presentation text span mixes tags (vision pads carry the video modality) split into tag runs
            tags = text_tags.view(-1).tolist()
            run_start = 0
            for i in range(1, b - a + 1):
                if i == b - a or tags[i] != tags[run_start]:
                    mod_segments.append((a + run_start, a + i, row_base + int(tags[run_start])))
                    run_start = i
        else:
            mod_segments.append((a, b, row_base + seg_tag[kind]))

    # embed
    img_update = layout.img_update.to(device)
    audio_update = layout.audio_update.to(device)
    video_rows = _h3m.patchify_video(video_x.to(torch.float32), self.patch_size)
    audio_rows = _h3m.pack_audio(audio_x.to(torch.float32))
    cond_video_rows = self._cond_video_rows(payload, device)
    cond_audio_rows = self._cond_audio_rows(payload, device)

    all_video_rows = video_rows
    if cond_video_rows is not None:
        all_video_rows = torch.empty(img_update.shape[0], video_rows.shape[1], dtype=torch.float32, device=device)
        all_video_rows[~img_update] = cond_video_rows
        all_video_rows[img_update] = video_rows
    all_audio_rows = audio_rows
    if cond_audio_rows is not None:
        all_audio_rows = torch.empty(audio_update.shape[0], audio_rows.shape[1], dtype=torch.float32, device=device)
        all_audio_rows[~audio_update] = cond_audio_rows
        all_audio_rows[audio_update] = audio_rows

    video_embed = self.video_patch_proj(all_video_rows).to(dtype)
    audio_embed = self.audio_patch_proj(all_audio_rows).to(dtype)
    text_states = context[0]
    if text_states.shape[-1] != self.hidden_size:
        text_states = self.token_refiner(self.condition_proj(text_states),
                                         transformer_options=transformer_options)

    # segments are contiguous: assemble by slices, embed rows follow segment order
    h = torch.empty(layout.seq_len, self.hidden_size, dtype=dtype, device=device)
    voff = aoff = 0
    for a, b, kind in layout.segments:
        n = b - a
        if kind == "text":
            h[a:b] = text_states
        elif kind in ("cond", "ref_img", "video"):
            h[a:b] = video_embed[voff:voff + n]
            voff += n
        else:  # ref_audio / audio
            h[a:b] = audio_embed[aoff:aoff + n]
            aoff += n

    # F5: the embeds and row buffers are copied into h; stock keeps them alive for the whole
    # forward (2.14 GiB at 216k tokens, measured M0e). Release them here.
    del video_embed, audio_embed, video_rows, audio_rows, all_video_rows, all_audio_rows, cond_video_rows, cond_audio_rows

    t_vals = torch.tensor(unique_t, dtype=torch.float32, device=device)
    if self.use_adaln_curves:
        # adaln projections consume interpolated coordinates of the time-embedding curve
        table = comfy.model_management.cast_to(self.adaln_t_table, device=device)
        pos = t_vals.clamp(0.0, 1.0) * (table.shape[0] - 1)     # t in [0,1] -> fractional grid index, out-of-range t clamps to the curve ends
        i0 = pos.floor().long().clamp(max=table.shape[0] - 2)   # lower grid row, max-clamp keeps t=1.0 on the last interval instead of reading past the table
        t_emb = torch.lerp(table[i0], table[i0 + 1], (pos - i0).unsqueeze(1))  # blend the two rows by the fractional part
    else:
        t_emb = self.time_embedder(t_vals).to(dtype)

    # rotation table computed once per forward, consumed by the kitchen split-half rope
    rope_freqs = _h3m.rope_rotation_table(self.rope_freqs(layout.position_ids, device), dtype)

    # blocks
    patches_replace = transformer_options.get("patches_replace", {})
    blocks_replace = patches_replace.get("dit", {})
    prefetch_queue = comfy.model_prefetch.make_prefetch_queue(list(self.blocks), device, transformer_options)
    for i, block in enumerate(self.blocks):
        comfy.model_prefetch.prefetch_queue_pop(prefetch_queue, device, block)
        if ("double_block", i) in blocks_replace:
            def block_wrap(args):
                return {"img": block(args["img"], args["t_emb"], args["mod_segments"], args["rope_freqs"],
                                     transformer_options=args["transformer_options"])}
            h = blocks_replace[("double_block", i)](
                {"img": h, "t_emb": t_emb, "mod_segments": mod_segments, "rope_freqs": rope_freqs,
                 "transformer_options": transformer_options},
                {"original_block": block_wrap})["img"]
        else:
            h = block(h, t_emb, mod_segments, rope_freqs, transformer_options=transformer_options)
    if prefetch_queue is not None:
        comfy.model_prefetch.prefetch_queue_pop(prefetch_queue, device, None)

    # target streams are single contiguous segments (audio then video, last two)
    video_seg = next((a, b, t_row[seg_t["video"]]) for a, b, k in layout.segments if k == "video")
    audio_seg = next((a, b, t_row[seg_t["audio"]]) for a, b, k in layout.segments if k == "audio")
    v, a = self.final_layer(h, t_emb, video_seg, audio_seg)

    video_out = _h3m.unpatchify_video(v, latent_t, lat_h // 2, lat_w // 2, self.latents_dim, self.patch_size)
    video_out = video_out[:, :, :orig_t, :orig_h, :orig_w]
    audio_out = _h3m.unpack_audio(a)

    return [-video_out.to(video_x.dtype), -audio_out.to(audio_x.dtype)]


# --------------------------------------------------------------------------- A6 phase 0: precision probe (which activations need 8 bits, which are fine at 4)

class _PrecProbe:
    """Per (forward, block, projection, segment) record of the real input activation of
    each block linear and the extra output error three cheaper activation quantisers
    would add on top of what the layer does today (the shipped layers quantise the
    activation to int8 rowwise-convrot internally): NVFP4 with one activation scale
    (kitchen quantize/dequantize), NVFP4 after a 128-wide Hadamard, FP8 e4m3 per tensor.
    Plus per (forward, block) the block's residual change ||x_out - x_in|| / ||x_in|| on
    a strided row sample (report 7's router signal). Sampled 1 in `every` chunks per
    phase. Writes jsonl; the map is drawn offline (benchmarks/scripts/prec_map.py)."""

    def __init__(self, path, every=8, row_stride=64):
        self.path, self.every, self.row_stride = path, int(every), int(row_stride)
        self.fwd = -1
        self.rows = []
        self.counter = {}
        self.sigma = None
        self.H = None

    def begin_forward(self, sigma):
        self.fwd += 1
        self.sigma = sigma
        self.counter = {}

    def _take(self, key):
        c = self.counter.get(key, 0)
        self.counter[key] = c + 1
        return c % self.every == 0

    @staticmethod
    def _seg_kind(row):
        return ("cond_" if row >= 3 else "") + ("video", "text", "audio")[row % 3]

    def _fq_nvfp4(self, x2d):
        from comfy_kitchen.tensor.nvfp4 import TensorCoreNVFP4Layout
        q, prm = TensorCoreNVFP4Layout.quantize(x2d)
        return TensorCoreNVFP4Layout.dequantize(q, prm)[: x2d.shape[0], : x2d.shape[1]]

    def _fq_fp8(self, x2d):
        amax = x2d.abs().amax().float().clamp_min(1e-12)
        sc = amax / 448.0
        return (x2d.float() / sc).clamp_(-448, 448).to(torch.float8_e4m3fn).to(x2d.dtype) * sc.to(x2d.dtype)

    def _fq_nvfp4_had(self, x2d):
        n = x2d.shape[1]
        if self.H is None or self.H.shape[0] != 128 or self.H.device != x2d.device:
            self.H = _hadamard(128, x2d.device, torch.float32)
        xr = (x2d.float().view(-1, n // 128, 128) @ self.H).view(-1, n).to(x2d.dtype)
        yr = self._fq_nvfp4(xr)
        return (yr.float().view(-1, n // 128, 128) @ self.H.T).view(-1, n).to(x2d.dtype)

    @torch.no_grad()
    def projection(self, block, proj, layer, x, a, b, mod_segments):
        """x: the layer's real input for chunk [a:b] (rows x K), layer: the module. Cheap sample."""
        if not self._take((block, proj)):
            return
        if x.shape[-1] % 128:
            return
        y = layer(x)
        fq = {"nvfp4": self._fq_nvfp4, "nvfp4_had": self._fq_nvfp4_had, "fp8": self._fq_fp8}
        outs = {k: layer(f(x)) for k, f in fq.items()}
        for sa, sb, row in mod_segments:
            lo, hi = max(sa, a), min(sb, b)
            if hi - lo < 16:
                continue
            xs = x[lo - a:hi - a].float()
            ys = y[lo - a:hi - a].float()
            rms = xs.pow(2).mean().sqrt()
            rec = {"fwd": self.fwd, "sigma": self.sigma, "block": block, "proj": proj, "seg": self._seg_kind(row),
                   "rows": int(hi - lo), "x_rms": rms.item(), "x_amax": xs.abs().amax().item(),
                   "x_outlier_frac": (xs.abs() > 6 * rms).float().mean().item(),
                   "x_kurt": ((xs / rms) ** 4).mean().item()}
            yn = ys.pow(2).sum().sqrt().clamp_min(1e-12)
            for k, o in outs.items():
                rec["err_" + k] = ((o[lo - a:hi - a].float() - ys).pow(2).sum().sqrt() / yn).item()
            self.rows.append(rec)
        del y, outs

    @torch.no_grad()
    def block_in(self, x):
        return x[:: self.row_stride].detach().clone()

    @torch.no_grad()
    def block_out(self, block, x_in_sample, x):
        s = x[:: self.row_stride].float()
        d = (s - x_in_sample.float()).pow(2).sum().sqrt() / x_in_sample.float().pow(2).sum().sqrt().clamp_min(1e-12)
        self.rows.append({"fwd": self.fwd, "sigma": self.sigma, "block": block, "proj": "block", "seg": "all",
                          "rel_change": d.item()})

    def flush(self):
        if not self.rows:
            return
        import json
        with open(self.path, "a") as f:
            for r in self.rows:
                f.write(json.dumps(r) + "\n")
        self.rows = []


# --------------------------------------------------------------------------- the block

def _phase1_kv(block, x, shift_msa, scale_msa, mod_segments, rope_freqs, kv_chunk, heads, hd, inner, kv_int8=False, kv_sage=False, prec=None, block_index=0):
    """K, V for the whole sequence, chunk by chunk (Q computed and dropped).
    kv_int8: store them as _Int8KV (kvi8r, half the bytes; approximation tier).
    kv_sage: store them as one _SageKV (kvi8s, half the bytes, Sage kernels; approximation tier)."""
    S = x.shape[0]
    attn = block.attn
    if kv_sage:
        K = _SageKV(heads, S, hd, x.device)
        V = K                                                    # one store holds both
    elif kv_int8:
        K = _Int8KV(heads, S, hd, x.device)
        V = _Int8KV(heads, S, hd, x.device)
    else:
        K = torch.empty((1, heads, S, hd), dtype=x.dtype, device=x.device)
        V = torch.empty((1, heads, S, hd), dtype=x.dtype, device=x.device)
    for a, b in _ranges(S, kv_chunk):
        s = b - a
        h = _mod_scale_shift_range(block.norm1(x[a:b]), shift_msa, scale_msa, mod_segments, a, b)
        if prec is not None:
            prec.projection(block_index, "qkv", attn.qkv_proj, h, a, b, mod_segments)
        qkv = attn.qkv_proj(h)
        q, k, v = qkv.split(inner, dim=-1)
        rope_c = rope_freqs[:, a:b].contiguous() if rope_freqs is not None else None
        _, k = _norm_rope(attn, q, k, rope_c, s)
        if kv_sage:
            K.store(a, b, k.transpose(0, 1).unsqueeze(0), v.view(s, heads, hd).transpose(0, 1).unsqueeze(0))
        elif kv_int8:
            K.store(a, b, k.transpose(0, 1).unsqueeze(0))
            V.store(a, b, v.view(s, heads, hd).transpose(0, 1).unsqueeze(0))
        else:
            K[0, :, a:b] = k.transpose(0, 1)
            V[0, :, a:b] = v.view(s, heads, hd).transpose(0, 1)
        del h, qkv, q, k, v, rope_c
    return K, V


def _phase2_q_attn(block, x, K, V, shift_msa, scale_msa, gate_msa, mod_segments, rope_freqs,
                   transformer_options, q_chunk, kv_block, heads, hd, inner, head_chunks, prec=None, block_index=0):
    """Q per chunk, attention against full K/V, out_proj, gated residual in place."""
    S = x.shape[0]
    attn = block.attn
    heads_per_call = max(1, heads // max(1, min(int(head_chunks or 1), heads)))
    q_ranges = _balanced_ranges(S, q_chunk, _min_query_chunk(x.device, heads_per_call))
    for a, b in q_ranges:
        s = b - a
        h = _mod_scale_shift_range(block.norm1(x[a:b]), shift_msa, scale_msa, mod_segments, a, b)
        qkv = attn.qkv_proj(h)
        q, k, _v = qkv.split(inner, dim=-1)
        rope_c = rope_freqs[:, a:b].contiguous() if rope_freqs is not None else None
        q, _ = _norm_rope(attn, q, k, rope_c, s)
        qc = q.transpose(0, 1).unsqueeze(0).contiguous()      # [1, heads, s, hd]
        del h, qkv, q, k, _v, rope_c
        if isinstance(K, _SageKV):
            o = _sage_attention_q(qc, K, x.dtype)
            o = o.transpose(1, 2).reshape(1, s, inner)
        elif isinstance(K, _Int8KV):
            o = _blockwise_attention_q(qc, K, V, kv_block if kv_block and kv_block > 0 else 16384, x.dtype)
            o = o.transpose(1, 2).reshape(1, s, inner)
        elif kv_block and kv_block > 0:
            o = _blockwise_attention(qc, K, V, kv_block, x.dtype)          # [1, heads, s, hd]
            o = o.transpose(1, 2).reshape(1, s, inner)
        else:
            o = _attend(qc, K, V, heads, head_chunks, transformer_options)  # [1, s, inner]
        del qc
        o = o.squeeze(0)
        if prec is not None:
            prec.projection(block_index, "out", attn.out_proj, o, a, b, mod_segments)
        o = attn.out_proj(o)
        _mod_gate_range(x, gate_msa, o, mod_segments, a, b)
        del o


def _phase3_mlp(block, x, shift_mlp, scale_mlp, gate_mlp, mod_segments, mlp_chunk, prec=None, block_index=0):
    """MLP per chunk, gated residual in place."""
    S = x.shape[0]
    for a, b in _ranges(S, mlp_chunk):
        h = _mod_scale_shift_range(block.norm2(x[a:b]), shift_mlp, scale_mlp, mod_segments, a, b)
        if prec is not None and hasattr(block.mlp, "fc1") and hasattr(block.mlp, "fc2"):
            prec.projection(block_index, "fc1", block.mlp.fc1, h, a, b, mod_segments)
            gate, up = block.mlp.fc1(h).chunk(2, dim=-1)
            act = torch.nn.functional.silu(gate).mul_(up)
            prec.projection(block_index, "fc2", block.mlp.fc2, act, a, b, mod_segments)
            del gate, up, act
        o = block.mlp(h)
        _mod_gate_range(x, gate_mlp, o, mod_segments, a, b)
        del h, o


def streamed_block_forward(block, x, t_emb, mod_segments, rope_freqs, transformer_options,
                           q_chunk=16384, kv_chunk=16384, mlp_chunk=16384, kv_block=0, probe=None, index=None, kv_int8=False, kv_sage=False):
    """Exact replacement for DiTBlock.forward with chunk-bounded transients.

    The three phases are separate named functions so an allocator trace
    (torch.cuda.memory._record_memory_history / memory_viz, see H3MemoryProbe)
    labels every band by phase from the Python stack alone; `probe` (an
    H3MemoryProbe ledger, read from transformer_options["h3_memprobe"]) gets a
    zero-sync mark after each phase.
    """
    attn = block.attn
    heads, hd = attn.heads, attn.head_dim
    inner = heads * hd
    head_chunks = transformer_options.get("minimax_head_chunks", 1) if isinstance(transformer_options, dict) else 1

    shift_msa, scale_msa, gate_msa, shift_mlp, scale_mlp, gate_mlp = block.adaln_proj(t_emb)
    prec = transformer_options.get("h3_precprobe") if isinstance(transformer_options, dict) else None
    x_in_sample = prec.block_in(x) if prec is not None else None

    K, V = _phase1_kv(block, x, shift_msa, scale_msa, mod_segments, rope_freqs, kv_chunk, heads, hd, inner, kv_int8=kv_int8, kv_sage=kv_sage,
                      prec=prec, block_index=index if index is not None else 0)
    if probe is not None:
        probe.mark(index, "kv")
    _phase2_q_attn(block, x, K, V, shift_msa, scale_msa, gate_msa, mod_segments, rope_freqs,
                   transformer_options, q_chunk, kv_block, heads, hd, inner, head_chunks,
                   prec=prec, block_index=index if index is not None else 0)
    del K, V
    if probe is not None:
        probe.mark(index, "attn")
    _phase3_mlp(block, x, shift_mlp, scale_mlp, gate_mlp, mod_segments, mlp_chunk, prec=prec, block_index=index if index is not None else 0)
    if probe is not None:
        probe.mark(index, "mlp")
    if prec is not None:
        prec.block_out(index if index is not None else 0, x_in_sample, x)
        if index == 49 or index is None:
            prec.flush()
    return x


def _self_check(block, args, extra, cfg, tag):
    """Run stock and streamed on the same input and log per-phase divergence. Diagnostic only."""
    x = args["img"]
    S = x.shape[0]
    ref = extra["original_block"](dict(args, img=x.clone()))["img"]
    scale = ref.float().abs().max().item()
    ulp = 2.0 ** (math.floor(math.log2(max(scale, 1e-30))) - 7)
    variants = {"full": cfg,
                "q_only": dict(cfg, kv_chunk=S, mlp_chunk=S),
                "kv_only": dict(cfg, q_chunk=S, mlp_chunk=S),
                "mlp_only": dict(cfg, q_chunk=S, kv_chunk=S),
                "none": dict(cfg, q_chunk=S, kv_chunk=S, mlp_chunk=S)}
    parts = []
    for name, c in variants.items():
        out = streamed_block_forward(block, x.clone(), args["t_emb"], args["mod_segments"], args["rope_freqs"],
                                     args["transformer_options"], q_chunk=c["q_chunk"], kv_chunk=c["kv_chunk"],
                                     mlp_chunk=c["mlp_chunk"], kv_block=c["kv_block"], kv_int8=cfg.get("kv_int8", False), kv_sage=cfg.get("kv_sage", False))
        d = (out.float() - ref.float()).abs()
        parts.append(f"{name}: max {d.max().item():.3e} ({d.max().item() / ulp:.2f} ulp) mean {d.mean().item():.2e}")
        del out, d
    to = args["transformer_options"]
    keys = sorted(k for k in to.keys()) if isinstance(to, dict) else type(to).__name__
    log.warning("H3StreamedBlocks self_check[%s] S=%d segs=%d rope=%s x=%s/%s to_keys=%s | %s",
                tag, S, len(args["mod_segments"]), tuple(args["rope_freqs"].shape) if args["rope_freqs"] is not None else None,
                x.dtype, x.is_contiguous(), keys, " | ".join(parts))
    del ref


def _make_replacement(block, cfg, index=0):
    state = {"checked": False}

    def fn(args, extra):
        x = args["img"]
        if x.shape[0] < cfg["min_tokens"]:
            return extra["original_block"](args)
        if cfg.get("self_check") and index == 0 and not state["checked"]:
            state["checked"] = True
            _self_check(block, args, extra, cfg, f"block{index}")
        to = args["transformer_options"]
        probe = to.get("h3_memprobe") if isinstance(to, dict) else None
        x = streamed_block_forward(block, x, args["t_emb"], args["mod_segments"], args["rope_freqs"],
                                   to, q_chunk=cfg["q_chunk"], kv_chunk=cfg["kv_chunk"],
                                   mlp_chunk=cfg["mlp_chunk"], kv_block=cfg["kv_block"], probe=probe, index=index,
                                   kv_int8=cfg.get("kv_int8", False), kv_sage=cfg.get("kv_sage", False))
        return {"img": x}
    return _named(fn, f"block{index:02d}")


def _named(fn, name):
    """Return `fn` under a new code-object name so it shows as `name` in Python
    stacks (allocator traces label bands by frame name; there is no other
    per-call label channel)."""
    import types
    code = fn.__code__.replace(co_name=name)
    g = types.FunctionType(code, fn.__globals__, name, fn.__defaults__, fn.__closure__)
    g.__qualname__ = name
    return g



# --------------------------------------------------------------------------- final layer

def streamed_final_layer_forward(fl, x, t_emb, video_seg, audio_seg, chunk=16384, probe=None, exact_gemm=True):
    """Row-chunked FinalLayer.forward. Stock (comfy/ldm/minimax/model.py:295)
    builds `norm(x[span]) * (1 + scale) + shift` for the whole target span and
    the fp32 modulation promotes it to fp32 twice: 2 x 4.28 GiB at 216k tokens,
    measured as the forward's peak on a 216k-token de-rope (2026-08-18). Every op
    is per row (RMSNorm, per-element mod, per-row fp32 linear), so the same
    math per chunk yields the same [rows, out] result with ~chunk-sized
    transients. Whether the fp32 cuBLAS GEMM stays bit-equal under a different
    M is a kernel property: gated, not assumed."""
    shift, scale = fl.adaln_proj(t_emb)

    def head(a, b, row, out_mod):
        n = b - a
        if exact_gemm:
            # exact tier: chunk only the norm/mod/fp32 promotion into ONE fp32 buffer,
            # then run the head GEMM at the stock M (same cuBLAS kernel -> bit-equal).
            # Transient: one [n, hidden] fp32 (4.28 GiB at 213k rows) instead of ~10.7.
            hbuf = torch.empty((n, x.shape[1]), dtype=torch.float32, device=x.device)
            for c0, c1 in _ranges(n, chunk):
                hbuf[c0:c1] = fl.norm(x[a + c0:a + c1]) * (1.0 + scale[row]) + shift[row]
            out = out_mod(hbuf)
            del hbuf
            return out
        # numerically-equivalent tier: chunk the GEMM too (fp32 cuBLAS picks kernels by M;
        # measured max |d| ~5e-6 vs stock on random weights). Transient ~chunk-sized.
        parts = []
        for c0, c1 in _ranges(n, chunk):
            h = (fl.norm(x[a + c0:a + c1]) * (1.0 + scale[row]) + shift[row]).to(torch.float32)
            parts.append(out_mod(h))
            del h
        return parts[0] if len(parts) == 1 else torch.cat(parts, dim=0)

    va, vb, vrow = video_seg
    aa, ab, arow = audio_seg
    v = head(va, vb, vrow, fl.video_out)
    a = head(aa, ab, arow, fl.audio_out)
    if probe is not None:
        probe.mark(None, "final")
    return v, a


# --------------------------------------------------------------------------- node

class H3StreamedBlocks:
    """Run every H3 DiT block in token chunks: exact, chunk-bounded VRAM."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "q_chunk": ("INT", {"default": 16384, "min": 1024, "max": 262144, "step": 1024,
                                    "tooltip": "Query tokens per attention call. Smaller = lower transient VRAM, more calls. Exact at any value."}),
                "kv_chunk": ("INT", {"default": 16384, "min": 1024, "max": 262144, "step": 1024,
                                     "tooltip": "Tokens per K/V projection chunk while building the full K/V buffers."}),
                "mlp_chunk": ("INT", {"default": 16384, "min": 0, "max": 262144, "step": 1024,
                                      "tooltip": "Tokens per MLP chunk. 0 = leave the model's mlp.forward alone (e.g. KJNodes' chunk node)."}),
                "min_tokens": ("INT", {"default": 32768, "min": 0, "max": 1048576, "step": 1024,
                                       "tooltip": "Below this packed sequence length the stock block runs (short clips gain nothing)."}),
                "kv_block": ("INT", {"default": 0, "min": 0, "max": 262144, "step": 1024,
                                     "tooltip": "EXPERIMENTAL, leave at 0. Attends K/V in blocks with a log-sum-exp combine (1 bf16 ulp). As built it does not lower memory (K/V are still fully built; measured +1.1 GiB and ~7% slower at 216k tokens); kept for the host-staged K/V design to come."}),
            },
            "optional": {
                "final_layer_chunk": ("INT", {"default": 16384, "min": 0, "max": 262144, "step": 1024,
                                              "tooltip": "Rows per chunk through the output head's norm -> mod -> fp32 promotion. Stock promotes the whole span to fp32 twice (~10 GiB at 216k tokens, the forward's peak). 0 = stock."}),
                "final_layer_gemm": (["exact (whole GEMM, one fp32 buffer)", "streamed (chunked GEMM, ~1e-6 fp32 diffs)"],
                                     {"default": "exact (whole GEMM, one fp32 buffer)",
                                      "tooltip": "exact: same head GEMM as stock, transient = one fp32 [rows, hidden] (bit-equal). streamed: GEMM per chunk, transient ~chunk-sized, but fp32 cuBLAS is not chunk-invariant (numerically-equivalent tier)."}),
                "kv_store": (["bf16 (exact)", "kvi8r: rotated int8 K/V (approximate)", "kvi8s: Sage int8/fp8 K/V, rotated (approximate, faster attention)"],
                             {"default": "bf16 (exact)",
                              "tooltip": "kvi8r = rotated int8 K/V. K and V held as int8 with one fp16 scale per row (per token, per head) in a fixed orthonormal 128-wide Hadamard-rotated basis of the head dim; the query chunk is rotated to match and the output un-rotated once, so a K/V block dequant is a single int8->fp16 cast * scale and attention runs in fp16 blockwise (kv_block, default 16384) with an online-softmax combine. Halves the K/V bytes. NOT bit-equal to stock: a same-seed render is a sibling take (first cut 2026-08-18: operator judged the de-rope side by side 'almost perfect'). Second cut (2026-08-18 evening): standalone at 217k tokens the attention costs +16% over the exact path (first cut +24%) with a ~1 GiB transient (first cut ~3), so the K/V saving now shows in the forward peak; the live numbers are in LOWVRAM.md. kvi8s = the same K/V bytes kept in SageAttention's kernel layout (int8 K per 64-token block, fp8 V per channel, Q/K Hadamard-rotated first) and attended on int8/fp8 tensor cores straight from the store, no dequant: standalone ~1.6x faster attention than the exact path at 217k tokens, one rung more approximate than kvi8r; needs the sageattention package (2.x)."}),
                "trim_forward": ("BOOLEAN", {"default": True,
                                             "tooltip": "F5: run a copy of the stock model forward that releases the patch-embed and row buffers once the packed sequence is assembled (stock keeps them for the whole forward: 2.14 GiB at 216k tokens). Same math, exact. Applied only if the installed ComfyUI's forward matches the copy (source hash); otherwise skipped with a log line."}),
                "self_check": ("BOOLEAN", {"default": False,
                                           "tooltip": "Diagnostic: on block 0's first call, run stock and streamed on the same input and log per-phase divergence. Costs one extra block forward."}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "MAINodes/VRAM Lab"
    DESCRIPTION = ("Exact low-VRAM execution of MiniMax-H3: never materialises the full-sequence "
                   "fused QKV or SwiGLU tensors. Same math as the stock block; costs ~4% extra "
                   "projection work at long lengths. See vram_lab.py for the ledger.")

    def patch(self, model, q_chunk, kv_chunk, mlp_chunk, min_tokens, kv_block, self_check=False, final_layer_chunk=16384,
              final_layer_gemm="exact (whole GEMM, one fp32 buffer)", kv_store="bf16 (exact)", trim_forward=True):
        dm = getattr(getattr(model, "model", None), "diffusion_model", None)
        blocks = getattr(dm, "blocks", None)
        if not blocks or not hasattr(blocks[0], "attn") or not hasattr(blocks[0].attn, "qkv_proj"):
            log.warning("H3StreamedBlocks: model does not look like MiniMax H3 (no blocks[*].attn.qkv_proj); unchanged")
            return (model,)
        cfg = {"q_chunk": q_chunk, "kv_chunk": kv_chunk, "mlp_chunk": mlp_chunk,
               "min_tokens": min_tokens, "kv_block": kv_block, "self_check": bool(self_check),
               "kv_int8": str(kv_store).startswith("kvi8r"), "kv_sage": str(kv_store).startswith("kvi8s")}
        if cfg["kv_sage"] and not _SAGE_OK:
            log.warning("H3StreamedBlocks: kv_store kvi8s needs the sageattention package; falling back to bf16 (exact)")
            cfg["kv_sage"] = False
        m = model.clone()
        for i, block in enumerate(blocks):
            m.set_model_patch_replace(_make_replacement(block, cfg, i), "dit", "double_block", i)
        fl = getattr(dm, "final_layer", None)
        if final_layer_chunk and fl is not None and hasattr(fl, "video_out") and hasattr(fl, "audio_out"):
            _exact = str(final_layer_gemm).startswith("exact")

            def _fl_forward(x, t_emb, video_seg, audio_seg, _fl=fl, _c=int(final_layer_chunk), _e=_exact):
                if x.shape[0] < cfg["min_tokens"]:
                    return type(_fl).forward(_fl, x, t_emb, video_seg, audio_seg)
                return streamed_final_layer_forward(_fl, x, t_emb, video_seg, audio_seg, chunk=_c,
                                                    probe=getattr(dm, "_h3_memprobe", None), exact_gemm=_e)
            m.add_object_patch("diffusion_model.final_layer.forward", _fl_forward)
        if trim_forward:
            sha = _stock_forward_sha()
            if sha == _STOCK_FORWARD_SHA and hasattr(dm, "_forward"):
                import types
                m.add_object_patch("diffusion_model._forward", types.MethodType(_trimmed_forward, dm))
                log.info("H3StreamedBlocks: trim_forward on (stock _forward %s matches the copy)", sha)
            else:
                log.warning("H3StreamedBlocks: trim_forward skipped: installed _forward source hash %s != %s (ComfyUI changed; the copy needs refreshing)", sha, _STOCK_FORWARD_SHA)
        log.info("H3StreamedBlocks: %d blocks patched (q %d, kv %d, mlp %d, min %d, kv_block %d, final_layer_chunk %d, %s, kv_store %s)",
                 len(blocks), q_chunk, kv_chunk, mlp_chunk, min_tokens, kv_block, final_layer_chunk, final_layer_gemm, kv_store)
        return (m,)



# --------------------------------------------------------------------------- memory probe

def _rss():
    """(RssAnon, RssFile) of this process in bytes from /proc/self/status; ~µs.
    RssAnon is the host RAM the process really holds (mirrors, retained
    allocator arenas, pinned buffers); RssFile is mmap'd model files."""
    anon = file = 0
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("RssAnon:"):
                    anon = int(line.split()[1]) * 1024
                elif line.startswith("RssFile:"):
                    file = int(line.split()[1]) * 1024
    except OSError:
        pass
    return anon, file


class _MemLedger:
    """Zero-sync memory ledger: reads the caching allocator's host-side counters
    (allocated, peak since last mark, reserved) at phase boundaries. No device
    sync: allocations happen at launch time, so the counters are exact on the
    host timeline; the timestamps are launch times, not completion times."""

    def __init__(self, path, dev):
        self.path = path
        self.dev = dev
        self.fwd = -1
        self.rows = []
        self.t0 = time.perf_counter()

    def begin_forward(self, shape):
        self.fwd += 1
        torch.cuda.reset_peak_memory_stats(self.dev)
        self._base = torch.cuda.memory_allocated(self.dev)
        self.rows.append({"fwd": self.fwd, "block": None, "phase": "start", "t": time.perf_counter() - self.t0,
                          "alloc": self._base, "peak": self._base,
                          "reserved": torch.cuda.memory_reserved(self.dev), "shape": list(shape),
                          "rss_anon": _rss()[0], "rss_file": _rss()[1]})

    def mark(self, block, phase):
        st = torch.cuda.memory_stats(self.dev)
        self.rows.append({"fwd": self.fwd, "block": block, "phase": phase, "t": time.perf_counter() - self.t0,
                          "alloc": st.get("allocated_bytes.all.current", 0),
                          "peak": st.get("allocated_bytes.all.peak", 0),
                          "reserved": st.get("reserved_bytes.all.current", 0),
                          "rss_anon": _rss()[0], "rss_file": _rss()[1]})
        torch.cuda.reset_peak_memory_stats(self.dev)

    def end_forward(self):
        st = torch.cuda.memory_stats(self.dev)
        self.rows.append({"fwd": self.fwd, "block": None, "phase": "end", "t": time.perf_counter() - self.t0,
                          "alloc": st.get("allocated_bytes.all.current", 0),
                          "peak": st.get("allocated_bytes.all.peak", 0),
                          "reserved": st.get("reserved_bytes.all.current", 0),
                          "rss_anon": _rss()[0], "rss_file": _rss()[1]})
        self.flush()

    def flush(self):
        import json
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            for r in self.rows:
                f.write(json.dumps(r) + "\n")
        try:
            with open(os.path.splitext(self.path)[0] + ".html", "w") as f:
                f.write(_ledger_html(self.rows))
        except Exception as e:  # noqa: BLE001
            log.debug("ledger html failed: %s", e)

    def summary(self):
        rows = [r for r in self.rows if r["fwd"] == self.fwd]
        if not rows:
            return ""
        peak = max(r["peak"] for r in rows)
        top = max(rows, key=lambda r: r["peak"])
        return (f"fwd {self.fwd}: base {rows[0]['alloc'] / 2**30:.1f} GiB, peak {peak / 2**30:.1f} GiB "
                f"(at block {top['block']} {top['phase']}), reserved {rows[-1]['reserved'] / 2**30:.1f} GiB, "
                f"{rows[-1]['t'] - rows[0]['t']:.1f} s; RSS anon {rows[0]['rss_anon'] / 2**30:.1f} -> {rows[-1]['rss_anon'] / 2**30:.1f} GiB "
                f"(max {max(r['rss_anon'] for r in rows) / 2**30:.1f})")



_PHASE_COLOR = {"start": "#888", "kv": "#4c78a8", "attn": "#f58518", "mlp": "#54a24b", "end": "#888"}


def _ledger_html(rows):
    """Self-contained SVG timeline of the ledger (no external assets): allocated,
    per-phase peak, reserved and process RSS in GiB against wall time, one
    forward per band; hover a mark for its numbers. Deep dive = trace.html."""
    if not rows:
        return "<p>empty ledger</p>"
    G = 2.0 ** 30
    W, H, L, T, B = 1400, 520, 70, 30, 60
    t0 = rows[0]["t"]
    tmax = max(r["t"] for r in rows) - t0 or 1.0
    ymax = max(max(r["peak"], r["reserved"], r.get("rss_anon", 0)) for r in rows) / G * 1.05 or 1.0
    xs = lambda t: L + (t - t0) / tmax * (W - L - 20)
    ys = lambda v: T + (H - T - B) * (1 - v / ymax)

    def path(key):
        return " ".join(f"{'M' if i == 0 else 'L'}{xs(r['t']):.1f},{ys(r[key] / G):.1f}" for i, r in enumerate(rows))

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" style="max-width:100%;font:12px sans-serif;background:#fff">']
    for g in range(0, int(ymax) + 1, max(1, int(ymax // 10) or 1)):
        out.append(f'<line x1="{L}" x2="{W-20}" y1="{ys(g):.1f}" y2="{ys(g):.1f}" stroke="#eee"/>'
                   f'<text x="{L-6}" y="{ys(g)+4:.1f}" text-anchor="end" fill="#666">{g} GiB</text>')
    # forward bands
    fwds = sorted({r["fwd"] for r in rows})
    for fw in fwds:
        rr = [r for r in rows if r["fwd"] == fw]
        x0, x1 = xs(rr[0]["t"]), xs(rr[-1]["t"])
        out.append(f'<rect x="{x0:.1f}" y="{T}" width="{max(1.0, x1-x0):.1f}" height="{H-T-B}" fill="{"#f7f7f7" if fw % 2 else "#fff"}"/>'
                   f'<text x="{x0+3:.1f}" y="{T+12}" fill="#999">fwd {fw}</text>')
    out.append(f'<path d="{path("reserved")}" fill="none" stroke="#bbb" stroke-width="1.5"/>')
    out.append(f'<path d="{path("peak")}" fill="none" stroke="#e45756" stroke-width="1" stroke-dasharray="3,2"/>')
    out.append(f'<path d="{path("alloc")}" fill="none" stroke="#222" stroke-width="1.5"/>')
    if any(r.get("rss_anon") for r in rows):
        out.append(f'<path d="{path("rss_anon")}" fill="none" stroke="#9467bd" stroke-width="1.5"/>')
    for r in rows:
        c = _PHASE_COLOR.get(r["phase"], "#333")
        tip = (f"fwd {r['fwd']}  block {r['block']}  {r['phase']}\\nt = {r['t']-t0:.1f} s\\nallocated {r['alloc']/G:.2f} GiB\\n"
               f"peak since last mark {r['peak']/G:.2f} GiB\\nreserved {r['reserved']/G:.2f} GiB\\nRSS anon {r.get('rss_anon',0)/G:.2f} GiB, file {r.get('rss_file',0)/G:.2f} GiB")
        out.append(f'<circle cx="{xs(r["t"]):.1f}" cy="{ys(r["peak"]/G):.1f}" r="3" fill="{c}"><title>{tip}</title></circle>')
    lg = [("#222", "allocated"), ("#e45756", "peak since last mark"), ("#bbb", "reserved"), ("#9467bd", "process RSS (anon)"),
          ("#4c78a8", "mark: kv"), ("#f58518", "mark: attn"), ("#54a24b", "mark: mlp")]
    for i, (col, name) in enumerate(lg):
        x = L + i * 190
        out.append(f'<rect x="{x}" y="{H-28}" width="14" height="10" fill="{col}"/><text x="{x+18}" y="{H-19}" fill="#333">{name}</text>')
    out.append(f'<text x="{W/2:.0f}" y="{H-2}" text-anchor="middle" fill="#666">wall time, {tmax:.0f} s span; hover a mark</text></svg>')
    return ("<!doctype html><meta charset=utf-8><title>H3 memory ledger</title>"
            "<style>body{margin:12px;font-family:sans-serif}</style><h3>H3MemoryProbe ledger</h3>" + "".join(out))

class H3MemoryProbe:
    """See what holds VRAM, per block and phase, and optionally record the
    allocator trace for a hoverable timeline (torch memory_viz)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "tag": ("STRING", {"default": "probe", "tooltip": "Run label; files land in out_dir/<tag>_<time>/"}),
                "ledger": ("BOOLEAN", {"default": True,
                                       "tooltip": "Per-forward JSONL of allocator counters at every H3StreamedBlocks phase boundary (start, block i kv/attn/mlp, end). No device sync, negligible cost. Stock blocks contribute start/end only."}),
                "record_history_forwards": ("INT", {"default": 0, "min": 0, "max": 64,
                                                    "tooltip": "Record the caching allocator's alloc/free trace (with Python stacks) for this many model forwards, then dump snapshot.pickle and trace.html (standalone; hover a band for the stack that allocated it). 0 = off. ~20k events per H3 forward at 200k tokens; a few percent while recording."}),
                "max_entries": ("INT", {"default": 300000, "min": 10000, "max": 5000000, "step": 10000,
                                        "tooltip": "Ring size for the allocator trace."}),
                "out_dir": ("STRING", {"default": "output/h3_memprobe",
                                       "tooltip": "Relative to the ComfyUI working directory. Not /tmp."}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "patch"
    CATEGORY = "MAINodes/VRAM Lab"
    DESCRIPTION = ("Memory instrument for the H3 diffusion model: a per-block/per-phase ledger of PyTorch's "
                   "allocator counters (with H3StreamedBlocks upstream), and an optional allocator trace "
                   "rendered to a hoverable HTML timeline. Off = no cost; not installed at all.")

    def patch(self, model, tag, ledger, record_history_forwards, max_entries, out_dir):
        import folder_paths
        import comfy.patcher_extension as pe
        dev = comfy.model_management.get_torch_device()
        base = out_dir if os.path.isabs(out_dir) else os.path.join(os.path.dirname(folder_paths.get_output_directory()), out_dir)
        run_dir = os.path.join(base, f"{tag}_{time.strftime('%Y%m%d_%H%M%S')}")
        os.makedirs(run_dir, exist_ok=True)
        led = _MemLedger(os.path.join(run_dir, "ledger.jsonl"), dev) if ledger else None
        state = {"fwd": 0, "recording": False, "done": False, "n": int(record_history_forwards)}

        m = model.clone()
        dm = getattr(getattr(m, "model", None), "diffusion_model", None)
        if led is not None:
            to = m.model_options.setdefault("transformer_options", {})
            to["h3_memprobe"] = led

        def wrapper(executor, *args, **kwargs):
            if led is not None and dm is not None:
                dm._h3_memprobe = led   # for patched pieces that do not receive transformer_options (final layer)
            x = args[0] if args else None
            shape = tuple(x.shape) if hasattr(x, "shape") else ()
            if state["n"] > 0 and not state["done"] and not state["recording"]:
                try:
                    torch.cuda.memory._record_memory_history(enabled="all", context="all", stacks="python",
                                                             max_entries=int(max_entries), device=dev,
                                                             record_pinned_host_memory=True)
                    state["recording"] = True
                    log.info("H3MemoryProbe[%s]: allocator trace ON (fwd %d)", tag, state["fwd"])
                except RuntimeError as e:
                    # ComfyUI enables cudaMallocAsync by default; torch's recorder needs the
                    # native caching allocator. Ledger still runs.
                    state["done"] = True
                    log.warning("H3MemoryProbe[%s]: allocator trace unavailable (%s). Start ComfyUI with "
                                "--disable-cuda-malloc to record it; the ledger still runs.", tag, str(e)[:120])
            if led is not None:
                led.begin_forward(shape)
            try:
                return executor(*args, **kwargs)
            finally:
                if dm is not None and hasattr(dm, "_h3_memprobe"):
                    del dm._h3_memprobe
                if led is not None:
                    led.end_forward()
                    log.info("H3MemoryProbe[%s]: %s", tag, led.summary())
                state["fwd"] += 1
                if state["recording"] and state["fwd"] >= state["n"]:
                    _dump_trace(run_dir, dev, tag)
                    torch.cuda.memory._record_memory_history(enabled=None, device=dev)
                    state["recording"] = False
                    state["done"] = True

        m.add_wrapper_with_key(pe.WrappersMP.DIFFUSION_MODEL, "h3_memprobe", wrapper)
        rep = f"H3MemoryProbe: {run_dir} (ledger {'on' if ledger else 'off'}, trace forwards {record_history_forwards})"
        log.info(rep)
        return (m, rep)


def _dump_trace(run_dir, dev, tag):
    try:
        os.makedirs(run_dir, exist_ok=True)
        snap = torch.cuda.memory._snapshot(device=dev)
        import pickle
        with open(os.path.join(run_dir, "snapshot.pickle"), "wb") as f:
            pickle.dump(snap, f)
        try:
            from torch.cuda._memory_viz import trace_plot
            html = trace_plot(snap, device=None)
            with open(os.path.join(run_dir, "trace.html"), "w") as f:
                f.write(html)
        except Exception as e:  # noqa: BLE001
            log.warning("H3MemoryProbe[%s]: trace_plot failed (%s); snapshot.pickle kept for pytorch.org/memory_viz", tag, e)
        log.info("H3MemoryProbe[%s]: allocator trace written to %s", tag, run_dir)
    except Exception as e:  # noqa: BLE001
        log.warning("H3MemoryProbe[%s]: snapshot failed: %s", tag, e)




class H3FreeCache:
    """Passthrough that returns the allocator's cached-but-free VRAM to the
    driver before the next stage. Measured motivation (2026-08-18): the
    VAE decode after a long H3 pass grew the pool 69.6 -> 77.9 GiB while live
    tensors were LOWER than during sampling; decode-shaped blocks could not
    reuse sampling's freed ones. Costs a few ms; changes no math."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",)},
                "optional": {"also_gc": ("BOOLEAN", {"default": True, "tooltip": "gc.collect() first so dead Python refs release their tensors too."})}}

    RETURN_TYPES = ("LATENT", "STRING")
    RETURN_NAMES = ("samples", "report")
    FUNCTION = "free"
    CATEGORY = "MAINodes/VRAM Lab"
    DESCRIPTION = "Empty the CUDA caching allocator (torch.cuda.empty_cache) between stages; passthrough for a LATENT so it can sit right before VAE Decode."

    def free(self, samples, also_gc=True):
        import gc
        dev = comfy.model_management.get_torch_device()
        before = torch.cuda.memory_reserved(dev)
        if also_gc:
            gc.collect()
        comfy.model_management.soft_empty_cache(force=True)
        after = torch.cuda.memory_reserved(dev)
        rep = f"H3FreeCache: reserved {before / 2**30:.2f} -> {after / 2**30:.2f} GiB (live {torch.cuda.memory_allocated(dev) / 2**30:.2f})"
        log.info(rep)
        return (samples, rep)



class H3EvictTextEncoder:
    """Passthrough for CONDITIONING that unloads the text encoder (the CLIP
    patcher and its clones) the moment encoding is done - the same call
    ckinpdx's MMH3Tools makes inside its nodes. Under --gpu-only it is a no-op
    (offload device is the GPU); in normal mode it frees the TE's VRAM before
    the DiT loads instead of letting the planner evict it on demand. Exists to
    MEASURE whether explicit eviction matters on a small card (2026-08-18)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"conditioning": ("CONDITIONING",), "clip": ("CLIP",)}}

    RETURN_TYPES = ("CONDITIONING", "STRING")
    RETURN_NAMES = ("conditioning", "report")
    FUNCTION = "evict"
    CATEGORY = "MAINodes/VRAM Lab"
    DESCRIPTION = "Unload the text encoder right after encoding (passthrough for the conditioning)."

    def evict(self, conditioning, clip):
        dev = comfy.model_management.get_torch_device()
        before = comfy.model_management.get_free_memory(dev)
        try:
            comfy.model_management.unload_model_and_clones(clip.patcher)
        except Exception as e:  # noqa: BLE001
            log.warning("H3EvictTextEncoder: unload failed: %s", e)
        comfy.model_management.soft_empty_cache()
        after = comfy.model_management.get_free_memory(dev)
        rep = f"H3EvictTextEncoder: device free {before / 2**30:.1f} -> {after / 2**30:.1f} GiB"
        log.info(rep)
        return (conditioning, rep)

class H3PrecisionProbe:
    """A6 phase 0: record, per (forward, block, projection, segment), the real input
    activation of every block linear and the extra output error NVFP4 / NVFP4+Hadamard /
    FP8 activation quantisation would add over the shipped int8 path, plus the per-block
    residual change. Needs H3StreamedBlocks downstream (it isolates the projections).
    Cost ~1.2x at every=8. Output jsonl under out_dir; draw with benchmarks/scripts/prec_map.py."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "tag": ("STRING", {"default": "precprobe"}),
            "every": ("INT", {"default": 8, "min": 1, "max": 256, "tooltip": "sample one chunk in N per (block, projection)"}),
            "out_dir": ("STRING", {"default": "output/h3_precprobe"}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "MAINodes/VRAM Lab"

    def patch(self, model, tag, every, out_dir):
        import folder_paths
        import comfy.patcher_extension as pe
        base = out_dir if os.path.isabs(out_dir) else os.path.join(os.path.dirname(folder_paths.get_output_directory()), out_dir)
        run_dir = os.path.join(base, f"{tag}_{time.strftime('%Y%m%d_%H%M%S')}")
        os.makedirs(run_dir, exist_ok=True)
        pr = _PrecProbe(os.path.join(run_dir, "prec.jsonl"), every=every)
        m = model.clone()
        to = m.model_options.setdefault("transformer_options", {})
        to["h3_precprobe"] = pr

        def wrapper(executor, *args, **kwargs):
            sig = None
            try:
                sig = float(args[1].flatten()[0].item()) / 1000.0
            except Exception:  # noqa: BLE001
                pass
            pr.begin_forward(sig)
            out = executor(*args, **kwargs)
            pr.flush()
            return out
        m.add_wrapper_with_key(pe.WrappersMP.DIFFUSION_MODEL, "h3_precprobe", wrapper)
        log.info("H3PrecisionProbe[%s]: -> %s (every %d)", tag, run_dir, every)
        return (m,)


class H3EvictDiffusionModel:
    """Passthrough that unloads the diffusion model (the MODEL's patcher and its
    clones) right before a VAE stage, so the encode runs in dedicated VRAM
    instead of the slice ComfyUI's planner leaves beside a resident DiT.

    Why it exists (2026-08-22): before a VAE call core frees only
    `memory_used_encode + minimum_inference_memory` (~4 GB at 1.2 MP), leaving
    a lowvram-resident DiT in place; the encoder's real working set (weights,
    ~2.3 GiB of activations per 17-frame clip, cuDNN workspace) overflows that,
    and on Windows the overflow goes to shared memory silently: a community
    report measured 50 s decode vs 500 s encode on a 12 GB card. Evicting the
    DiT here costs its reload for pass 2 (seconds from RAM), not minutes.
    Under --gpu-only it is a no-op (the offload device is the GPU).
    Wire the IMAGE that feeds VAE Encode through it (or any value that has
    to exist before the encode); wire the MODEL you want gone."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "model": ("MODEL",)},
                "optional": {"everything": ("BOOLEAN", {"default": False,
                             "tooltip": "unload every loaded model (text encoder, VAEs, all), not just this MODEL"})}}
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "report")
    FUNCTION = "evict"
    CATEGORY = "MAINodes/VRAM Lab"
    DESCRIPTION = ("Unload the diffusion model (or everything) right before VAE Encode, passthrough for the IMAGE. "
                   "On small cards the encode otherwise runs in the few GB the planner leaves beside the resident DiT "
                   "and spills to shared memory (Windows) or OOMs.")
    def evict(self, images, model, everything=False):
        dev = comfy.model_management.get_torch_device()
        before = comfy.model_management.get_free_memory(dev)
        try:
            if everything:
                comfy.model_management.unload_all_models()
            else:
                comfy.model_management.unload_model_and_clones(model)
        except Exception as e:  # noqa: BLE001
            log.warning("H3EvictDiffusionModel: unload failed: %s", e)
        comfy.model_management.soft_empty_cache()
        after = comfy.model_management.get_free_memory(dev)
        rep = f"H3EvictDiffusionModel: device free {before / 2**30:.1f} -> {after / 2**30:.1f} GiB ({'everything' if everything else 'diffusion model'})"
        log.info(rep)
        return (images, rep)


NODE_CLASS_MAPPINGS = {"H3StreamedBlocks": H3StreamedBlocks, "H3MemoryProbe": H3MemoryProbe, "H3FreeCache": H3FreeCache, "H3EvictTextEncoder": H3EvictTextEncoder, "H3EvictDiffusionModel": H3EvictDiffusionModel,
                       "H3PrecisionProbe": H3PrecisionProbe}
NODE_DISPLAY_NAME_MAPPINGS = {"H3StreamedBlocks": "H3 Streamed Blocks (exact low-VRAM, alpha)",
                              "H3MemoryProbe": "H3 Memory Probe (ledger + allocator trace, alpha)",
                              "H3FreeCache": "H3 Free Cache (empty allocator between stages)",
                              "H3EvictTextEncoder": "H3 Evict Text Encoder (unload after encode)",
                              "H3EvictDiffusionModel": "H3 Evict Diffusion Model (unload before VAE Encode)",
                              "H3PrecisionProbe": "H3 Precision Probe (A6: 4-bit vs 8-bit activation map, alpha)"}
