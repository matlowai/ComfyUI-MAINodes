"""Runtime-attached transformer block loops for an isolated LightX2V worker.

No edits to LightX2V source. Hooks discover live nn.ModuleList containers
on the first parent forward and wrap only selected block instances. The code
FAILS the run when requested loops did not actually execute. This is research
instrumentation, NOT proven safe for streaming KV caches / model offloading.
"""
from __future__ import annotations

import functools
import inspect
import json
import os
from pathlib import Path
import sys
import threading
import time
from typing import Any

from . import lightx2v_relay
from .spec import LoopSpec, StageSpec, parse_block_indices


def _qualified(module: Any) -> str:
    cls = type(module)
    return cls.__module__ + "." + cls.__qualname__


def _primary_tensor(value, torch):
    if torch.is_tensor(value):
        return value, lambda replacement: replacement
    if isinstance(value, tuple) and value and torch.is_tensor(value[0]):
        return value[0], lambda replacement: (replacement, *value[1:])
    if isinstance(value, list) and value and torch.is_tensor(value[0]):
        return value[0], lambda replacement: [replacement, *value[1:]]
    raise RuntimeError("Loop block must return a Tensor or a tuple/list with a Tensor first; refusing opaque output")


def _reinput(args, kwargs, hidden, torch):
    """Replace first tensor input. Do not infer arbitrary new model semantics."""
    if args and torch.is_tensor(args[0]):
        if args[0].shape != hidden.shape:
            raise RuntimeError("Loop block output shape differs from first tensor input; cannot replay safely")
        return (hidden, *args[1:]), kwargs
    for name in ("hidden_states", "x", "hidden", "features"):
        if name in kwargs and torch.is_tensor(kwargs[name]) and kwargs[name].shape == hidden.shape:
            return args, {**kwargs, name: hidden}
    raise RuntimeError("Cannot locate shape-compatible hidden-state input for block looping")


def _has_active_explicit_cache(forward, args, kwargs):
    try:
        bound = inspect.signature(forward).bind_partial(*args, **kwargs)
        values = bound.arguments
    except (TypeError, ValueError):
        values = kwargs
    return sorted(name for name, obj in values.items()
                  if obj is not None and any(fragment in name.lower()
                      for fragment in ("cache", "memory", "persistent_state", "past_key_value")))


class BlockLoopRuntime:
    def __init__(self, spec: LoopSpec):
        self.spec = LoopSpec.from_value(spec)
        self._hook = None
        self._adapter = False
        self._torch = None
        self._seen_containers: set[int] = set()
        self._lock = threading.RLock()
        self._candidates = []
        self._installed = {"wan": [], "flash": []}
        self._calls = {"wan": 0, "flash": 0}
        self._replays = {"wan": 0, "flash": 0}
        self._quality_calls = {}
        self._warnings = ["Experimental hooks can mutate streaming KV caches or module state. No cache-correctness guarantee."] if self.spec.active else []
        self._start = time.time()

    def activate(self):
        if self.spec.mode == "off":
            return
        import torch
        self._torch = torch
        cap = os.environ.get("RELAYVSR_VRAM_CAP_GIB")
        if cap:  # test aid: behave like a smaller card (PyTorch allocations only; the CUDA context is extra)
            torch.cuda.set_per_process_memory_fraction(float(cap) * 2**30 / torch.cuda.get_device_properties(0).total_memory)
            print("[RelayLoop] VRAM cap %s GiB" % cap, flush=True)
        self._hook = torch.nn.modules.module.register_module_forward_pre_hook(self._pre_forward)
        # LightX2V's RelayVSR runs its blocks as WeightModules through run_block, which the ModuleList scan never sees.
        self._adapter = lightx2v_relay.install(self)
        print("[RelayLoop] mode=%s; %s" % (self.spec.mode, "LightX2V RelayVSR run_block adapter" if self._adapter else
                                           "scan for live nn.ModuleList transformer blocks"), flush=True)

    def close(self):
        if self._hook is not None:
            self._hook.remove()
            self._hook = None

    def _pre_forward(self, owner, _inputs):
        # A global pre-hook is needed because the parent model has not been constructed
        # when the CLI bootstrap runs. Keep this common path inexpensive.
        torch = self._torch
        for list_name, child in owner.named_children():
            if not isinstance(child, torch.nn.ModuleList) or not child or len(child) < 2:
                continue
            if id(child) in self._seen_containers:
                continue
            # Discovery reports ALL ModuleLists (including unexpected upstream naming).
            # Automatic edits, unlike discovery, require plausible transformer blocks.
            block_type = _qualified(child[0])
            transformer_like = ("block" in (list_name + " " + block_type).lower() or
                                "transformer" in block_type.lower())
            with self._lock:
                if id(child) in self._seen_containers:
                    continue
                self._seen_containers.add(id(child))
                info = {"owner": _qualified(owner), "list_name": list_name,
                        "block_class": block_type, "size": len(child),
                        "transformer_like": transformer_like}
                if len(self._candidates) < 256:
                    self._candidates.append(info)
                print("[RelayLoop] discovery %s.%s: %d x %s" %
                      (info["owner"], list_name, len(child), block_type), flush=True)
                if self.spec.active and not self._adapter:
                    for stage in ("wan", "flash"):
                        stage_spec = getattr(self.spec, stage)
                        if stage_spec.active and (transformer_like or stage_spec.owner_regex) and self._matches(stage, stage_spec, info):
                            self._attach(stage, stage_spec, child, info)

    @staticmethod
    def _matches(stage, spec: StageSpec, info: dict):
        import re
        qualified = info["owner"] + "." + info["list_name"] + "." + info["block_class"]
        if spec.owner_regex:
            if not re.search(spec.owner_regex, qualified):
                return False
        elif stage.lower() not in qualified.lower():
            return False
        if spec.block_class_regex and not re.search(spec.block_class_regex, info["block_class"]):
            return False
        return True

    def _attach(self, stage, stage_spec, blocks, info):
        if self._installed[stage] and not self.spec.allow_multiple_containers:
            raise RuntimeError("More than one %s block container matched; use owner_regex to disambiguate: %s" %
                               (stage, info["owner"]))
        chosen = parse_block_indices(stage_spec.indices, len(blocks))
        if stage_spec.loop_style == "group":
            self._attach_group(stage, stage_spec, blocks, info, chosen)
            return
        for index in chosen:
            instance = blocks[index]
            # All selected objects must be unique. Shared block objects may have
            # multiple apparent indices and count as ambiguous unless explicitly reviewed.
            if any(instance is blocks[j] for j in chosen if j != index):
                raise RuntimeError("Block instances are shared in this container; refuse ambiguous looping")
            original = instance.forward
            call_counter = {"seen": 0, "replayed": 0}
            runtime = self

            @functools.wraps(original)
            def wrapper(*args, __original=original, __counter=call_counter, __index=index,
                        __stage=stage, __spec=stage_spec, **kwargs):
                __counter["seen"] += 1
                runtime._calls[__stage] += 1
                base = __original(*args, **kwargs)
                if (__counter["seen"] % __spec.every_nth_call != 0 or
                    (__spec.max_activations and __counter["replayed"] >= __spec.max_activations)):
                    return base
                # Enforce syntactic explicit-cache guards. They are insufficient to
                # prove absence of internal mutation; see design notes.
                if not runtime.spec.allow_stateful_repeats:
                    active_cache = _has_active_explicit_cache(__original, args, kwargs)
                    if active_cache:
                        raise RuntimeError("Loop refused live cache arguments %s in %s[%d]; explicit allow_stateful_repeats is required" %
                                           (active_cache, __stage, __index))
                baseline, build = _primary_tensor(base, runtime._torch)
                hidden = baseline
                if __spec.strength < 1:
                    # Preserve the original tensor even if another forward reuses storage.
                    baseline = baseline.clone()
                for _ in range(__spec.passes - 1):
                    replay_args, replay_kwargs = _reinput(args, kwargs, hidden, runtime._torch)
                    candidate, _ = _primary_tensor(__original(*replay_args, **replay_kwargs), runtime._torch)
                    if tuple(candidate.shape) != tuple(hidden.shape):
                        raise RuntimeError("Replay changed hidden-state shape; aborting the experiment")
                    if __spec.mixing == "damped_steps":
                        hidden = hidden + (candidate - hidden) * (__spec.strength / (__spec.passes - 1))
                    else:
                        hidden = candidate
                    if runtime.spec.check_finite and not runtime._torch.isfinite(hidden).all().item():
                        raise FloatingPointError("Non-finite values in looped transformer block")
                if __spec.mixing == "final_blend" and __spec.strength != 1:
                    hidden = baseline + (hidden - baseline) * __spec.strength
                __counter["replayed"] += 1
                runtime._replays[__stage] += __spec.passes - 1
                return build(hidden)

            instance.forward = wrapper
        self._installed[stage].append({**info, "indices": chosen,
                                       "passes": stage_spec.passes, "strength": stage_spec.strength,
                                       "mixing": stage_spec.mixing, "loop_style": "per_block"})
        print("[RelayLoop] ATTACHED %s indices=%s passes=%d strength=%.3f" %
              (stage, chosen, stage_spec.passes, stage_spec.strength), flush=True)

    def _attach_group(self, stage, stage_spec, blocks, info, chosen):
        """Loop selected CONTIGUOUS blocks as a single B(B(hidden)) group.

        Original pass flows through the upstream model unchanged. On the last
        selected block, replay the *whole* group using the captured per-block
        non-hidden inputs from the original pass, in original block order.
        This does NOT isolate mutable attention caches: research-only.
        """
        if chosen != list(range(chosen[0], chosen[-1] + 1)):
            raise ValueError("Group loop requires consecutive block indices; use per_block for sparse selections")
        if len({id(blocks[i]) for i in chosen}) != len(chosen):
            raise RuntimeError("Group loop refuses shared/tied block instances")
        original = {i: blocks[i].forward for i in chosen}
        tls = threading.local()
        call_counter = {"seen": 0, "replayed": 0}
        runtime = self

        def saved_context():
            if not hasattr(tls, "contexts"):
                tls.contexts = {}
            return tls.contexts

        for index in chosen[:-1]:
            def record(*args, __index=index, **kwargs):
                result = original[__index](*args, **kwargs)
                saved_context()[__index] = (args, kwargs)
                return result
            blocks[index].forward = record

        last_index = chosen[-1]

        def last_forward(*args, **kwargs):
            context = saved_context()
            context[last_index] = (args, kwargs)
            call_counter["seen"] += 1
            runtime._calls[stage] += 1
            try:
                base = original[last_index](*args, **kwargs)
                if (call_counter["seen"] % stage_spec.every_nth_call != 0 or
                    (stage_spec.max_activations and call_counter["replayed"] >= stage_spec.max_activations)):
                    return base
                missing = [i for i in chosen if i not in context]
                if missing:
                    raise RuntimeError("Group loop did not observe all selected blocks in a normal pass: " + str(missing))
                if not runtime.spec.allow_stateful_repeats:
                    for i in chosen:
                        args_i, kwargs_i = context[i]
                        active_cache = _has_active_explicit_cache(original[i], args_i, kwargs_i)
                        if active_cache:
                            raise RuntimeError("Group loop refused live cache arguments %s in %s[%d]; explicit allow_stateful_repeats is required" %
                                               (active_cache, stage, i))
                baseline, build = _primary_tensor(base, runtime._torch)
                hidden = baseline
                if stage_spec.strength < 1:
                    baseline = baseline.clone()
                for _ in range(stage_spec.passes - 1):
                    previous = hidden
                    for i in chosen:
                        args_i, kwargs_i = context[i]
                        next_args, next_kwargs = _reinput(args_i, kwargs_i, hidden, runtime._torch)
                        candidate, _ = _primary_tensor(original[i](*next_args, **next_kwargs), runtime._torch)
                        if tuple(candidate.shape) != tuple(hidden.shape):
                            raise RuntimeError("Group replay changed hidden-state shape")
                        hidden = candidate
                    if stage_spec.mixing == "damped_steps":
                        # Damping is between complete group passes, not individual layers.
                        hidden = previous + (hidden - previous) * (stage_spec.strength / (stage_spec.passes - 1))
                    if runtime.spec.check_finite and not runtime._torch.isfinite(hidden).all().item():
                        raise FloatingPointError("Non-finite values after group replay")
                if stage_spec.mixing == "final_blend" and stage_spec.strength != 1:
                    hidden = baseline + (hidden - baseline) * stage_spec.strength
                call_counter["replayed"] += 1
                runtime._replays[stage] += (stage_spec.passes - 1) * len(chosen)
                return build(hidden)
            finally:
                # Avoid keeping GPU tensors from old frames alive through closures.
                context.clear()

        blocks[last_index].forward = last_forward
        self._installed[stage].append({**info, "indices": chosen,
                                       "passes": stage_spec.passes, "strength": stage_spec.strength,
                                       "mixing": stage_spec.mixing, "loop_style": "group"})
        print("[RelayLoop] ATTACHED %s GROUP indices=%s passes=%d strength=%.3f" %
              (stage, chosen, stage_spec.passes, stage_spec.strength), flush=True)

    def verify(self):
        if self.spec.active:
            for stage in ("wan", "flash"):
                if getattr(self.spec, stage).active and not self._replays[stage]:
                    raise RuntimeError("Loop stage %s requested but never executed. Use discover mode and set owner_regex/indices from the actual model." % stage)
            idle = [name for name, count in self._quality_calls.items() if not count]
            if idle:
                raise RuntimeError("Quality knobs requested but never applied: " + ", ".join(idle))
        return True

    def report(self, error=""):
        return {"status": "failed" if error else "finished", "mode": self.spec.mode,
                "rank": os.environ.get("RANK", "0"), "candidates": self._candidates,
                "installed": self._installed, "base_calls": self._calls,
                "extra_block_calls": self._replays, "quality_calls": self._quality_calls, "warnings": self._warnings,
                "spec": self.spec.as_dict(), "elapsed_wall_seconds": round(time.time() - self._start, 3),
                "error": str(error)[:2000]}

    def save(self, path: str | Path, error=""):
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        suffix = str(os.environ.get("RANK", "0"))
        target = target.with_name(target.stem + "_rank" + suffix + target.suffix)
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_text(json.dumps(self.report(error=error), indent=2) + "\n", encoding="utf8")
        tmp.replace(target)
        print("[RelayLoop] report=" + str(target), flush=True)
        return target
