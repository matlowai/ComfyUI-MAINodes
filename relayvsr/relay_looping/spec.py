"""Strict, JSON-safe research settings. No torch/LightX2V dependencies."""
from __future__ import annotations
from dataclasses import asdict, dataclass, field
import re
from typing import Mapping


@dataclass(frozen=True)
class StageSpec:
    # 1 means exact baseline: no extra calls, irrespective of strength.
    indices: str = "first:4"
    passes: int = 1
    strength: float = 1.0
    mixing: str = "final_blend"  # final_blend or damped_steps
    loop_style: str = "group"  # group (B(B(h))) or per_block (each block individually)
    owner_regex: str = ""  # applies to owner class + container name + block class
    block_class_regex: str = ""  # more restrictive optional block-class filter
    every_nth_call: int = 1
    max_activations: int = 0

    def validate(self):
        if not isinstance(self.indices, str) or not self.indices.strip():
            raise ValueError("Loop indices must be a non-empty selection expression")
        # Syntax check without assuming the size of the live model.
        parse_block_indices(self.indices, 100000, validate_only=True)
        if type(self.passes) is not int or not 1 <= self.passes <= 4:
            raise ValueError("Loop passes must be an integer from 1 to 4")
        if not 0.0 <= float(self.strength) <= 1.0:
            raise ValueError("Loop strength must be between 0 and 1")
        if self.mixing not in ("final_blend", "damped_steps"):
            raise ValueError("Loop mixing must be final_blend or damped_steps")
        if self.loop_style not in ("group", "per_block"):
            raise ValueError("loop_style must be group or per_block")
        if type(self.every_nth_call) is not int or not 1 <= self.every_nth_call <= 100000:
            raise ValueError("every_nth_call must be 1..100000")
        if type(self.max_activations) is not int or not 0 <= self.max_activations <= 100000000:
            raise ValueError("max_activations must be 0..100000000")
        for value in (self.owner_regex, self.block_class_regex):
            if len(value) > 512:
                raise ValueError("Selector regex too long")
            try:
                re.compile(value)
            except re.error as exc:
                raise ValueError(f"Invalid selector regex: {exc}") from exc

    @property
    def active(self) -> bool:
        return self.passes > 1 and self.strength > 0

    @classmethod
    def from_value(cls, value):
        if isinstance(value, StageSpec):
            return value
        if not isinstance(value, Mapping):
            raise ValueError("Each loop stage must be an object")
        unknown = set(value) - set(cls.__dataclass_fields__)
        if unknown:
            raise ValueError("Unknown loop stage keys: " + ", ".join(sorted(unknown)))
        result = cls(**value)
        result.validate()
        return result


@dataclass(frozen=True)
class LoopSpec:
    mode: str = "off"  # off; discover (read-only); experiment
    wan: StageSpec = field(default_factory=StageSpec)
    flash: StageSpec = field(default_factory=lambda: StageSpec(indices="middle:4"))
    allow_stateful_repeats: bool = False  # never assume KV caches are safe
    allow_advanced_modes: bool = False  # allow offload / SP after local review
    allow_multiple_containers: bool = False  # fail closed if a target is ambiguous
    check_finite: bool = False  # synchronizes GPU per selected block; slow
    cache_commit: str = "base"  # LightX2V adapter: K/V later frames see; base = unlooped pass, last = final replay
    # LightX2V adapter quality knobs (1.0 / 0.0 / bicubic = stock behavior)
    noise_scale: float = 1.0  # scales Wan's random starting latent: below 1 = less invented texture
    residual_gain: float = 1.0  # scales Flash's residual over the bicubic upscale: the detail Flash adds
    back_projection: float = 0.0  # adds this much of the low-res error (input - downscaled output) back, at native scale
    downscale: str = "bicubic"  # filter when the output is resized below native scale (X4 at 2x): bicubic, bilinear, area
    kv_cache: str = "bf16"  # Wan's keyframe K/V cache storage: bf16, int8_rot (Hadamard-rotated int8), int8, fp8, int4_rot, int4
    weights: str = "bf16"  # Wan block linears (resident only): bf16, int8_convrot (W8A8), w6a8, w4a8, mixed (W4A8 + int8 where W4A8 hurts most)
    weights_int8_fraction: float = 0.5  # mixed only: share of Wan block parameters kept int8

    def validate(self):
        if self.mode not in ("off", "discover", "experiment"):
            raise ValueError("Loop mode must be off, discover or experiment")
        self.wan.validate()
        self.flash.validate()
        if not (0.0 <= self.noise_scale <= 2.0 and 0.0 <= self.residual_gain <= 3.0 and 0.0 <= self.back_projection <= 1.0):
            raise ValueError("noise_scale must be 0..2, residual_gain 0..3, back_projection 0..1")
        if self.weights not in ("bf16", "int8_convrot", "w6a8", "w4a8", "mixed"):
            raise ValueError("weights must be bf16, int8_convrot, w6a8, w4a8 or mixed")
        if not 0.0 <= self.weights_int8_fraction <= 1.0:
            raise ValueError("weights_int8_fraction must be 0..1")
        if self.kv_cache not in ("bf16", "int8_rot", "int8", "fp8", "int4_rot", "int4"):
            raise ValueError("kv_cache must be bf16, int8_rot, int8, fp8, int4_rot or int4")
        if self.downscale not in ("bicubic", "bilinear", "area"):
            raise ValueError("downscale must be bicubic, bilinear or area")
        if self.mode == "experiment" and not (self.wan.active or self.flash.active or self.quality):
            raise ValueError("Experiment mode requires a loop stage (passes>1, strength>0) or a quality knob")
        if self.cache_commit not in ("base", "last"):
            raise ValueError("cache_commit must be base or last")
        for name in ("allow_stateful_repeats", "allow_advanced_modes", "allow_multiple_containers", "check_finite"):
            if type(getattr(self, name)) is not bool:
                raise ValueError(name + " must be a bool")

    @property
    def active(self):
        return self.mode == "experiment"

    @property
    def quality(self):
        """Quality knobs that differ from stock, by name."""
        return [name for name, stock in (("noise_scale", 1.0), ("residual_gain", 1.0), ("back_projection", 0.0), ("downscale", "bicubic"), ("kv_cache", "bf16"), ("weights", "bf16"))
                if getattr(self, name) != stock]

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_value(cls, value):
        if value is None:
            return cls()
        if isinstance(value, cls):
            return value
        if not isinstance(value, Mapping):
            raise ValueError("Loop experiment must be an object")
        unknown = set(value) - set(cls.__dataclass_fields__)
        if unknown:
            raise ValueError("Unknown loop experiment keys: " + ", ".join(sorted(unknown)))
        kwargs = dict(value)
        if "wan" in kwargs:
            kwargs["wan"] = StageSpec.from_value(kwargs["wan"])
        if "flash" in kwargs:
            kwargs["flash"] = StageSpec.from_value(kwargs["flash"])
        obj = cls(**kwargs)
        obj.validate()
        return obj


def parse_block_indices(expr: str, count: int, *, validate_only: bool = False) -> list[int]:
    """Zero-based selectors: '0,2-5', 'first:6', 'middle:4', 'last:6', 'all'.

    `validate_only` checks syntax without committing to a live network depth.
    """
    if count < 1:
        raise ValueError("Expected at least one transformer block")
    text = str(expr).strip().lower()
    if not text:
        raise ValueError("Empty block selection")
    result = set()
    for item in text.split(","):
        token = item.strip()
        if token == "all":
            result.update(range(count))
            continue
        match = re.fullmatch(r"(first|middle|last):(\d+)", token)
        if match:
            width = int(match.group(2))
            if not 1 <= width <= count:
                raise ValueError(f"{token} exceeds block count ({count})")
            start = 0 if match.group(1) == "first" else (count - width if match.group(1) == "last" else (count - width) // 2)
            result.update(range(start, start + width))
            continue
        match = re.fullmatch(r"(\d+)(?:-(\d+))?", token)
        if not match:
            raise ValueError("Invalid selector '" + token + "' (try 4-9 or middle:6)")
        low, high = int(match.group(1)), int(match.group(2) or match.group(1))
        if high < low or high >= count:
            raise ValueError(f"Selector {token} is outside the 0..{count-1} block range")
        result.update(range(low, high + 1))
    if not result:
        raise ValueError("Block selection matched no indices")
    if validate_only:
        return []
    return sorted(result)
