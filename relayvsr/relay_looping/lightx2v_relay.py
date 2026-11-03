"""Block loops for LightX2V's RelayVSR, which runs its blocks as WeightModules through `run_block`, not nn.Module forwards.

Wan: `RelayWanTransformerInfer.run_block(block_idx, block, x, pre_infer_out) -> x`. Self attention writes this keyframe's
K/V into a ring-cache slot and then reads it, so a replay overwrites that slot. Flash: `FlashModelTransformerInfer.run_block
(block_idx, block, x, condition, past_key, past_value, ...) -> (x, key, value)`; the caller stores key/value as history for the
next frames of the window. Condition preparation (condition=True) and Wan's cross-KV setup are never looped.

cache_commit "base" (default) keeps what later keyframes/frames see equal to the unlooped pass: the Wan slot is restored and
Flash returns the first pass's K/V. "last" commits the final replay's K/V instead.
"""
from __future__ import annotations

from .spec import parse_block_indices


def _mix(spec, baseline, hidden, previous, final):
    """One replay step of the lab's mixing rules (runtime._attach): damped steps between passes, final blend at the end."""
    if spec.mixing == "damped_steps":
        hidden = previous + (hidden - previous) * (spec.strength / (spec.passes - 1))
    if final and spec.mixing == "final_blend" and spec.strength != 1:
        hidden = baseline + (hidden - baseline) * spec.strength
    return hidden


class _Stage:
    def __init__(self, runtime, name, spec, count, commit):
        self.runtime, self.name, self.spec, self.commit = runtime, name, spec, commit
        self.chosen = parse_block_indices(spec.indices, count)
        if spec.loop_style == "group" and self.chosen != list(range(self.chosen[0], self.chosen[-1] + 1)):
            raise ValueError("Group loop requires consecutive block indices; use per_block for sparse selections")
        self.seen = self.replayed = 0
        self.saved = {}
        runtime._installed[name].append({"owner": "lightx2v relayvsr " + name, "list_name": "run_block", "size": count,
                                         "indices": self.chosen, "passes": spec.passes, "strength": spec.strength,
                                         "mixing": spec.mixing, "loop_style": spec.loop_style, "cache_commit": commit})
        print("[RelayLoop] ATTACHED %s run_block %s indices=%s passes=%d strength=%.3f mixing=%s commit=%s" % (
            name, spec.loop_style, self.chosen, spec.passes, spec.strength, spec.mixing, commit), flush=True)

    def due(self):
        """Count one loop opportunity; True when this one should replay."""
        self.seen += 1
        self.runtime._calls[self.name] += 1
        return self.seen % self.spec.every_nth_call == 0 and not (self.spec.max_activations and self.replayed >= self.spec.max_activations)

    def replay(self, hidden, run_pass):
        """passes-1 replays of `run_pass(hidden) -> hidden` with the lab's strength/mixing; returns the mixed hidden."""
        baseline = hidden.clone() if self.spec.strength < 1 else hidden
        for step in range(self.spec.passes - 1):
            previous = hidden
            # Wan's cross attention adds into its input in place, so a replay gets its own copy.
            hidden = _mix(self.spec, baseline, run_pass(hidden.clone()), previous, step == self.spec.passes - 2)
        self.replayed += 1
        self.runtime._replays[self.name] += (self.spec.passes - 1) * (len(self.chosen) if self.spec.loop_style == "group" else 1)
        if self.runtime.spec.check_finite and not hidden.isfinite().all().item():
            raise FloatingPointError("Non-finite values after %s replay" % self.name)
        return hidden


def _install_quality(runtime, spec):
    """Noise scale (Wan's starting latent), residual gain and back-projection (Flash's output), downscale filter (runner)."""
    import torch
    import torch.nn.functional as F
    from lightx2v.models.networks.relayvsr.flash_model_infer import FlashModelPostInfer
    from lightx2v.models.runners.relayvsr.relayvsr_runner import RelayVSRRunner
    from lightx2v.models.schedulers.relayvsr.scheduler import RelayVSRScheduler

    calls = runtime._quality_calls = {name: 0 for name in spec.quality}
    runtime._installed["quality"] = {name: getattr(spec, name) for name in spec.quality}
    print("[RelayLoop] QUALITY %s" % runtime._installed["quality"], flush=True)

    if spec.noise_scale != 1.0:
        prepare = RelayVSRScheduler.prepare_latents

        def prepare_latents(self, *args, **kwargs):
            prepare(self, *args, **kwargs)
            self.latents.mul_(spec.noise_scale)
            calls["noise_scale"] += 1

        RelayVSRScheduler.prepare_latents = prepare_latents

    if spec.residual_gain != 1.0 or spec.back_projection:
        post = FlashModelPostInfer.infer

        def post_infer(self, weights, hidden, lr):
            out = post(self, weights, hidden, lr)
            scale = self.geometry.scale
            if spec.residual_gain != 1.0:
                # Flash's output is bicubic(lr) + residual; scale only the residual.
                base = F.interpolate(lr, scale_factor=scale, mode="bicubic", align_corners=False)
                out = base + (out - base) * spec.residual_gain
                calls["residual_gain"] += 1
            if spec.back_projection:
                error = lr - F.interpolate(out, size=lr.shape[-2:], mode="bicubic", align_corners=False, antialias=True)
                out = out + spec.back_projection * F.interpolate(error, scale_factor=scale, mode="bicubic", align_corners=False)
                calls["back_projection"] += 1
            return out

        FlashModelPostInfer.infer = post_infer

    if spec.downscale != "bicubic":
        def postprocess(prediction, target):
            if prediction.shape[-2:] != target:
                x = prediction.float().clamp(-1, 1)
                prediction = F.interpolate(x, size=target, mode="area") if spec.downscale == "area" else \
                    F.interpolate(x, size=target, mode="bilinear", align_corners=False, antialias=True)
                calls["downscale"] += 1
            return prediction[0].add(1).mul_(127.5).clamp_(0, 255).to(torch.uint8).permute(1, 2, 0).contiguous()

        RelayVSRRunner.postprocess = staticmethod(postprocess)


def _hadamard(n, device):
    import torch
    h = torch.ones((1, 1), device=device)
    while h.shape[0] < n:
        h = torch.cat((torch.cat((h, h), 1), torch.cat((h, -h), 1)), 0)
    return h / n ** 0.5


class _QuantSlots:
    """One layer's K or V ring slots as int8 / fp8 rows (one token x head, 128 values) with an fp16 scale per row.
    With a Hadamard rotation the row is rotated before quantizing and rotated back on read, which spreads the outlier
    channels keys carry across the row."""

    def __init__(self, rows, heads, head_dim, device, mode, rotation):
        import torch
        self.mode, self.rotation = mode, rotation
        self.limit = {"int8": 127.0, "int4": 7.0, "fp8": 448.0}[mode.split("_")[0]]
        # int4: two values per byte (low nibble = even channel), stored offset by 8
        shape, dtype = ((rows, heads, head_dim // 2), torch.uint8) if mode.startswith("int4") else \
            ((rows, heads, head_dim), torch.int8 if mode.startswith("int8") else torch.float8_e4m3fn)
        self.data = torch.empty(shape, dtype=dtype, device=device)
        self.scale = torch.empty((rows, heads, 1), dtype=torch.float16, device=device)

    def write(self, start, x):
        import torch
        x = x.float() @ self.rotation.float() if self.rotation is not None else x.float()
        scale = x.abs().amax(-1, keepdim=True).clamp_min(1e-8) / self.limit
        q = x / scale
        if self.mode.startswith("int4"):
            q = (q.round().clamp_(-7, 7) + 8).to(torch.uint8)
            q = q[..., 0::2] | (q[..., 1::2] << 4)
        else:
            q = q.round().clamp_(-127, 127).to(torch.int8) if self.mode.startswith("int8") else q.to(torch.float8_e4m3fn)
        self.data[start:start + x.shape[0]] = q
        self.scale[start:start + x.shape[0]] = scale.to(torch.float16)

    def read(self, rows, dtype):
        import torch
        data = self.data[:rows]
        if self.mode.startswith("int4"):
            data = torch.stack(((data & 15).to(dtype) - 8, (data >> 4).to(dtype) - 8), -1).flatten(-2)
        x = data.to(dtype) * self.scale[:rows].to(dtype)
        return x @ self.rotation if self.rotation is not None else x


class _QuantRingCache:
    """Stands in for LightX2V's FrameRingKVCachePool for Wan: same k_cache / v_cache / reset surface."""

    def __init__(self, layers, rows, heads, head_dim, device, mode):
        import torch
        rotation = _hadamard(head_dim, device).to(torch.bfloat16) if mode.endswith("_rot") else None
        self._k = [_QuantSlots(rows, heads, head_dim, device, mode, rotation) for _ in range(layers)]
        self._v = [_QuantSlots(rows, heads, head_dim, device, mode, rotation) for _ in range(layers)]
        self.sp_head_sharded = False

    def k_cache(self, layer):
        return self._k[layer]

    def v_cache(self, layer):
        return self._v[layer]

    def reset(self):
        pass


def _install_kv_cache(runtime, mode):
    from lightx2v.common.kvcache.manager import KVCacheManager
    from lightx2v.models.networks.relayvsr import wan_infer
    from lightx2v.models.networks.relayvsr.wan_infer import RelayWanTransformerInfer

    calls = runtime._quality_calls
    create = KVCacheManager.create_self_attn_kv_cache

    def create_self_attn_kv_cache(self, cache_name, kv_size, *, kv_cache_scheme=None, step_kv_cache=None, dtype=None, num_heads=None):
        if cache_name != "wan":
            return create(self, cache_name, kv_size, kv_cache_scheme=kv_cache_scheme, step_kv_cache=step_kv_cache, dtype=dtype, num_heads=num_heads)
        heads = self.cache_num_heads if num_heads is None else num_heads
        cache = _QuantRingCache(self.config["num_layers"], kv_size, heads, self.config["dim"] // self.config["num_heads"], self.device, mode)
        self.self_attn_kv_caches[cache_name] = self.self_attn_kv_cache = cache
        self._buffer_signature = None
        return cache

    KVCacheManager.create_self_attn_kv_cache = create_self_attn_kv_cache
    attend = RelayWanTransformerInfer.infer_self_attn

    def infer_self_attn(self, phase, x, shift_msa, scale_msa, grid_sizes=None, *, q_rope, k_rope, cache, cache_slot):
        """LightX2V's Wan self attention with the cache write/read going through the quantized slots."""
        if not isinstance(cache[0], _QuantSlots):
            return attend(self, phase, x, shift_msa, scale_msa, grid_sizes, q_rope=q_rope, k_rope=k_rope, cache=cache, cache_slot=cache_slot)
        _, height, width = grid_sizes
        normalized = self.modulate_func(phase.norm1.apply(x), scale_msa, shift_msa)
        tokens = q_rope[0].shape[0]
        query = self.parallel.to_heads(phase.self_attn_norm_q.apply(phase.self_attn_q.apply(normalized)).view(-1, self.num_heads, self.head_dim), tokens)
        key = self.parallel.to_heads(phase.self_attn_norm_k.apply(phase.self_attn_k.apply(normalized)).view(-1, self.num_heads, self.head_dim), tokens)
        value = self.parallel.to_heads(phase.self_attn_v.apply(normalized).view(-1, self.num_heads, self.head_dim), tokens)
        start = cache_slot * tokens
        cache[0].write(start, key)
        cache[1].write(start, value)
        rows = k_rope[0].shape[0]
        key, value = cache[0].read(rows, query.dtype), cache[1].read(rows, query.dtype)
        calls["kv_cache"] += 1
        query = wan_infer.apply_rope(query, q_rope)
        key = wan_infer.apply_rope(key, k_rope)
        visible = key.shape[0] // tokens
        wh, ww = self.relay_config["spatial_window_size"]
        if height > wh or width > ww:
            spec = wan_infer.SpatialAttentionSpec(1, height, width, wh, ww, self.relay_config["temporal_context_frames"], key_frames=visible, query_frame_offset=visible - 1)
            attended = self.local_attention(query[None], key[None], value[None], spec)[0]
        else:
            attended = phase.self_attn_1.apply(query, key, value).view(tokens, -1, self.head_dim)
        return phase.self_attn_o.apply(self.parallel.to_sequence(attended))

    RelayWanTransformerInfer.infer_self_attn = infer_self_attn


def _walk_linears(module):
    from lightx2v.common.ops.mm.mm_weight import MMWeight
    for child in module._modules.values():
        if isinstance(child, MMWeight):
            yield child
        elif hasattr(child, "_modules"):
            yield from _walk_linears(child)


def _attach_quant(linear, tensors, calls):
    """Make a LightX2V linear compute from comfy-kitchen quantized tensors: {qweight, qscale} = int8 ConvRot W8A8,
    {w4a8_q, w4a8_s_rel, w4a8_s_channel[, w4a8_correction, w4a8_codebook]} = grouped W6A8 / W4A8."""
    import types

    import comfy_kitchen

    if "qweight" in tensors:
        def apply(self, x):
            calls["weights"] += 1
            return comfy_kitchen.int8_linear(x, self.qweight, self.qscale, self.bias, x.dtype, convrot=True, convrot_groupsize=256)
        linear.qweight, linear.qscale = tensors["qweight"], tensors["qscale"]
    else:
        def apply(self, x):
            calls["weights"] += 1
            t = self.qw4a8
            return comfy_kitchen.w4a8_int8_linear(x, t["w4a8_q"], t["w4a8_s_rel"], t["w4a8_s_channel"], t.get("w4a8_codebook"),
                                                  t.get("w4a8_correction"), self.bias, out_dtype=x.dtype)
        linear.qw4a8 = tensors
    linear.weight = None
    linear.apply = types.MethodType(apply, linear)


def _quantize_tensors(weight, mode):
    """comfy-kitchen quantization of one [out, in] weight, as the tensors _attach_quant takes."""
    import comfy_kitchen
    from comfy_kitchen.tensor.int8 import TensorWiseINT8Layout
    if mode == "int8_convrot":
        q, params = TensorWiseINT8Layout.quantize(weight, is_weight=True, per_channel=True, convrot=True, convrot_groupsize=256)
        return {"qweight": q, "qscale": params.scale}
    q, s_rel, s_channel, correction, codebook = comfy_kitchen.quantize_w4a8_int8_weight(weight, bits=6 if mode == "w6a8" else 4)
    return {k: v for k, v in (("w4a8_q", q), ("w4a8_s_rel", s_rel), ("w4a8_s_channel", s_channel),
                              ("w4a8_correction", correction), ("w4a8_codebook", codebook)) if v is not None}


def _install_int8_weights(runtime, mode, int8_fraction):
    """Wan block linears in comfy-kitchen quantized form (resident weights only). A checkpoint made by
    tools/quantize_wan.py (metadata relayvsr_quant) loads as-is; a bf16 checkpoint is quantized right after loading.
    int8_convrot = W8A8 ConvRot; w6a8 / w4a8 = grouped W6A8 / W4A8; mixed = W4A8 except the linears with the worst
    W4A8 weight error, which stay int8 until `int8_fraction` of the parameters are int8 (on-load only)."""
    import json
    import re

    import comfy_kitchen
    import torch
    from lightx2v.models.networks.relayvsr import weights as relay_weights
    from lightx2v.models.networks.relayvsr.model import RelayVSRModel
    from lightx2v.utils.envs import GET_DTYPE

    calls = runtime._quality_calls
    load = relay_weights.load_container
    quant_key = re.compile(r"(.+)\.(qweight|qscale|w4a8_\w+)$")

    def load_container(container, handle, keys, device):
        meta = handle.metadata() or {}
        if "relayvsr_quant" not in meta:
            return load(container, handle, keys, device)
        stored = json.loads(meta["relayvsr_quant"])["mode"]
        if stored != mode:
            raise ValueError("Wan checkpoint is pre-quantized as %s but weights=%s was requested" % (stored, mode))
        if device != "cuda":
            raise ValueError("pre-quantized Wan blocks stay resident; turn block offload off")
        quant, state = {}, {}
        for key in keys:
            m = quant_key.match(key)
            if m:
                quant.setdefault(m.group(1), {})[m.group(2)] = handle.get_tensor(key).to(device)
            else:
                state[key] = handle.get_tensor(key).to(device=device, dtype=GET_DTYPE())
        for base in quant:  # the linear indexes and transposes its weight on load; the real tensors attach after
            state[base + ".weight"] = torch.empty((0, 0), device=device, dtype=GET_DTYPE())
        container.load(state)
        for linear in _walk_linears(container):
            base = linear.weight_name.removesuffix(".weight")
            if base in quant:
                _attach_quant(linear, quant.pop(base), calls)
        if quant:
            raise ValueError("pre-quantized tensors matched no Wan linear: %s" % sorted(quant)[:3])

    relay_weights.load_container = load_container
    init = RelayVSRModel.__init__

    def model_init(self, *args, **kwargs):
        init(self, *args, **kwargs)
        linears = [linear for block in self.wan_weights.blocks._modules.values() for linear in _walk_linears(block)]
        if all(linear.weight is None for linear in linears):
            runtime._installed["weights"] = {"mode": mode, "source": "pre-quantized checkpoint", "linears": len(linears)}
            print("[RelayLoop] Wan block linears loaded pre-quantized (%s): %d" % (mode, len(linears)), flush=True)
            return
        if self.wan_weights.offload:
            raise ValueError("weights=%s quantizes resident Wan blocks; turn block offload off" % mode)
        keep = set()
        if mode == "mixed":
            errors = []
            for linear in linears:
                weight = linear.weight.t().contiguous()
                t = _quantize_tensors(weight, "w4a8")
                back = comfy_kitchen.dequantize_w4a8_int8_weight(t["w4a8_q"], t["w4a8_s_rel"], t["w4a8_s_channel"], t.get("w4a8_codebook"),
                                                                 t.get("w4a8_correction"), output_dtype=torch.float32)
                errors.append(((back - weight.float()).norm() / weight.float().norm()).item())
            total, kept = sum(linear.weight.numel() for linear in linears), 0
            for i in sorted(range(len(linears)), key=lambda i: -errors[i]):
                if kept >= int8_fraction * total:
                    break
                keep.add(i)
                kept += linears[i].weight.numel()
        counts = {}
        for i, linear in enumerate(linears):
            kind = "int8_convrot" if mode == "int8_convrot" or i in keep else ("w4a8" if mode == "mixed" else mode)
            _attach_quant(linear, _quantize_tensors(linear.weight.t().contiguous(), kind), calls)  # LightX2V keeps [in, out]
            counts[kind] = counts.get(kind, 0) + 1
        torch.cuda.empty_cache()
        runtime._installed["weights"] = {"mode": mode, "source": "quantized on load", **counts}
        print("[RelayLoop] Wan block linears quantized on load: %s" % counts, flush=True)

    RelayVSRModel.__init__ = model_init


def install(runtime):
    """Patch RelayVSR's run_block methods for the runtime's spec. Returns False outside a LightX2V RelayVSR worker."""
    try:
        from lightx2v.models.networks.relayvsr.flash_model_infer import FlashModelTransformerInfer
        from lightx2v.models.networks.relayvsr.wan_infer import RelayWanTransformerInfer
    except ImportError:
        return False
    spec, commit = runtime.spec, runtime.spec.cache_commit
    runtime._candidates.append({"owner": "lightx2v.models.networks.relayvsr", "list_name": "run_block",
                                "block_class": "RelayWanTransformerInfer / FlashModelTransformerInfer", "transformer_like": True})
    if not spec.active:
        return True
    if spec.quality:
        _install_quality(runtime, spec)
    if spec.kv_cache != "bf16":
        if spec.wan.active:
            raise ValueError("Wan loops snapshot bf16 cache slots; use kv_cache=bf16 with Wan loops")
        _install_kv_cache(runtime, spec.kv_cache)
    if spec.weights != "bf16":
        _install_int8_weights(runtime, spec.weights, spec.weights_int8_fraction)
    if spec.flash.active and spec.flash.loop_style == "group" and commit == "last":
        raise ValueError("Flash group loops commit the first pass's K/V (earlier blocks' history is stored by the caller); use cache_commit=base")
    stages = {}

    if spec.wan.active:
        wan_run = RelayWanTransformerInfer.run_block

        def wan_run_block(self, block_idx, block, x, pre):
            if pre.adapter_args.get("prepare_cross_kv", False):
                return wan_run(self, block_idx, block, x, pre)
            stage = stages.get("wan") or stages.setdefault("wan", _Stage(runtime, "wan", spec.wan, self.relay_config["num_layers"], commit))
            if block_idx not in stage.chosen:
                return wan_run(self, block_idx, block, x, pre)
            out = wan_run(self, block_idx, block, x, pre)
            group = stage.spec.loop_style == "group"
            if group:
                stage.saved[block_idx] = (block, pre)
                if block_idx != stage.chosen[-1]:
                    return out
            if not stage.due():
                stage.saved.clear()
                return out
            cache, tokens = pre.adapter_args["cache"], x.shape[0]
            start = (pre.adapter_args["frame"] % self.relay_config["temporal_context_frames"]) * tokens
            indices = stage.chosen if group else [block_idx]
            snapshot = {i: (cache.k_cache(i)[start:start + tokens].clone(), cache.v_cache(i)[start:start + tokens].clone()) for i in indices} if commit == "base" else {}

            def run_pass(hidden):
                for i in indices:
                    b, p = stage.saved[i] if group else (block, pre)
                    hidden = wan_run(self, i, b, hidden, p)
                return hidden

            try:
                return stage.replay(out, run_pass)
            finally:
                for i, (k, v) in snapshot.items():
                    cache.k_cache(i)[start:start + tokens].copy_(k)
                    cache.v_cache(i)[start:start + tokens].copy_(v)
                stage.saved.clear()

        RelayWanTransformerInfer.run_block = wan_run_block

    if spec.flash.active:
        flash_run = FlashModelTransformerInfer.run_block

        def flash_run_block(self, block_idx, block, x, condition, *rest):
            if condition:
                return flash_run(self, block_idx, block, x, condition, *rest)
            stage = stages.get("flash") or stages.setdefault("flash", _Stage(runtime, "flash", spec.flash, self.config["depth"], commit))
            if block_idx not in stage.chosen:
                return flash_run(self, block_idx, block, x, condition, *rest)
            out, key, value = flash_run(self, block_idx, block, x, condition, *rest)
            group = stage.spec.loop_style == "group"
            if group:
                stage.saved[block_idx] = (block, rest)
                if block_idx != stage.chosen[-1]:
                    return out, key, value
            if not stage.due():
                stage.saved.clear()
                return out, key, value
            last = {}

            def run_pass(hidden):
                for i in (stage.chosen if group else [block_idx]):
                    b, r = stage.saved[i] if group else (block, rest)
                    hidden, last["key"], last["value"] = flash_run(self, i, b, hidden, condition, *r)
                return hidden

            try:
                hidden = stage.replay(out, run_pass)
            finally:
                stage.saved.clear()
            if commit == "last":
                key, value = last["key"], last["value"]
            return hidden, key, value

        FlashModelTransformerInfer.run_block = flash_run_block
    return True
