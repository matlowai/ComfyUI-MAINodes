"""Capability registry for flow expressions (spec 5.3).

A capability is the only thing that may unwrap a ``Ref``. Names are
resolved against this registry as strings before any value is touched, so
there is no module object, no ``getattr`` and no attribute surface reachable
from workflow text.

Bare names (``sqrt``, ``clamp``) resolve through the ``core.math`` and
``core.logic`` packs, which is what keeps an expression portable between
this evaluator and core's Math Expression node.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

from . import policy
from .expr import (MAX_DEPTH, ExprError, Ref, kind_of,
                   _safe_pow as _guarded_pow)


@dataclass(frozen=True)
class Capability:
    id: str
    version: int
    fn: Callable
    arg_types: tuple = ()
    return_type: str = "ANY"
    predicate_safe: bool = True
    cost: float = 0.0
    # An allocating capability declares its PEAK, in elements, before it runs.
    # register() refuses one without it, so "I forgot to guard this transform"
    # is a construction error rather than a runtime hole. `version` is recorded
    # and not yet consumed; see the owed note in spec 5.3.
    preflight: Callable | None = None
    # None: always available. A name from policy.OPTIONAL_PACKS: available
    # only when the installation lists it under enable_packs (spec 5.3, 8.5).
    pack: str | None = None


REGISTRY: dict[str, Capability] = {}
BARE_NAMES: dict[str, str] = {}          # bare name -> full id
_BARE_PACKS = ("core.math", "core.logic")


def register(cap: Capability) -> Capability:
    """Register by full id; ids in a bare pack also answer to a bare name."""
    if cap.id in REGISTRY:
        raise ValueError(f"capability '{cap.id}' is already registered")
    if not cap.predicate_safe and cap.preflight is None:
        raise ValueError(
            f"capability '{cap.id}' allocates and declares no preflight. A "
            f"transform states its peak in elements before it runs; the guard "
            f"is not something each one remembers on its own")
    if cap.pack is not None and cap.pack not in policy.OPTIONAL_PACKS:
        raise ValueError(
            f"capability '{cap.id}' names pack '{cap.pack}', which policy.OPTIONAL_PACKS "
            f"does not list, so no installation could ever enable it")
    REGISTRY[cap.id] = cap
    pack, _, bare = cap.id.rpartition(".")
    if pack in _BARE_PACKS:
        BARE_NAMES[bare] = cap.id
    return cap


def resolve(name: str | None) -> Capability | None:
    """Full id first, then the bare-name map. Never raises."""
    if not name:
        return None
    cap = REGISTRY.get(name)
    if cap is not None:
        return cap
    full = BARE_NAMES.get(name)
    return REGISTRY.get(full) if full else None


def _add(cid, fn, *, return_type="ANY", predicate_safe=True, cost=0.0, version=1,
         preflight=None, pack=None):
    return register(Capability(cid, version, fn, (), return_type, predicate_safe,
                               cost, preflight, pack))


def unavailable(cap: Capability, path: str | None = None) -> str | None:
    """The refusal for a capability whose pack is not enabled here, or None.

    Checked in one place at parse time and again at the call, so the answer
    cannot differ between queue time and execution. Reading the policy can
    raise PolicyError; that propagates, because a policy file that cannot be
    honoured turns Safe Function off rather than opening it.
    """
    if cap.pack is None or cap.pack in policy.enabled_packs(path):
        return None
    return (f"{cap.id} is in the '{cap.pack}' pack, which this installation has not "
            f"enabled; add {{\"enable_packs\": [\"{cap.pack}\"]}} to flow_policy.json")


def unref(value):
    """The one place a Ref is opened."""
    return value.value if isinstance(value, Ref) else value


def unref_deep(value):
    """unref() through lists and tuples: spec 8.4's fully resolved value.

    unref opens the top-level Ref only, so `return [x, y]` handed the graph a
    list of interpreter wrappers instead of images. safefn._unresolved already
    walks containers for the Unknown half of the same rule; this is the Ref
    half. Containers keep their type, and nesting deeper than an expression
    can build is returned as it is rather than recursed into.
    """
    return _unref_deep(value, 0)


def _unref_deep(value, depth: int):
    value = unref(value)
    if depth >= MAX_DEPTH or not isinstance(value, (list, tuple)):
        return value
    items = [_unref_deep(item, depth + 1) for item in value]
    return tuple(items) if isinstance(value, tuple) else items


def _tensor(value, what):
    t = unref(value)
    if getattr(t, "shape", None) is None:
        raise ExprError(f"{what} expects a tensor value, got {type(t).__name__}")
    return t


def _image(value):
    t = _tensor(value, "image.*")
    if len(t.shape) != 4:
        raise ExprError(f"image.* expects IMAGE[B,H,W,C], got a {len(t.shape)}-D tensor")
    return t


def _latent(value):
    d = unref(value)
    if not isinstance(d, dict) or "samples" not in d:
        raise ExprError("latent.* expects a LATENT dict with 'samples'")
    return d["samples"]


# core.math: the exact set core's Math Expression exposes, same semantics.
def _variadic_sum(*args):
    if len(args) == 1 and hasattr(args[0], "__iter__"):
        return sum(args[0])
    return sum(args)


# pow() is the OPERATOR's _safe_pow, deliberately: a second implementation
# here capped the exponent and nothing else, so `(2 ** 4000) ** 4000` was
# refused while `pow(pow(2, 4000), 4000)` built a 16-million-bit integer and
# a third nesting demanded 8 GB in one uninterruptible call, from a Gate
# widget, which has no allocation budget at all. One guard, one function.
_MATH = {
    "sum": _variadic_sum, "min": min, "max": max, "abs": abs, "round": round,
    "pow": lambda base, exp: _guarded_pow(base, exp, spelling="pow"),
    "sqrt": math.sqrt, "ceil": math.ceil, "floor": math.floor,
    "log": math.log, "log2": math.log2, "log10": math.log10, "sin": math.sin,
    "cos": math.cos, "tan": math.tan, "int": int, "float": float,
}
for _name, _fn in _MATH.items():
    _add(f"core.math.{_name}", _fn, return_type="FLOAT")


# core.logic
def _clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def _between(x, lo, hi):
    return lo <= x <= hi


def _near(x, target, eps):
    return abs(x - target) <= eps


def _coalesce(a, b):
    return b if a is None else a


_add("core.logic.clamp", _clamp, return_type="FLOAT")
_add("core.logic.between", _between, return_type="BOOLEAN")
_add("core.logic.near", _near, return_type="BOOLEAN")
_add("core.logic.coalesce", _coalesce)
_add("core.logic.is_none", lambda x: x is None, return_type="BOOLEAN")


# image: IMAGE is [B,H,W,C]
_add("image.width", lambda x: int(_image(x).shape[2]), return_type="INT")
_add("image.height", lambda x: int(_image(x).shape[1]), return_type="INT")
_add("image.batch", lambda x: int(_image(x).shape[0]), return_type="INT")
_add("image.megapixels",
     lambda x: float(_image(x).shape[1] * _image(x).shape[2]) / 1e6, return_type="FLOAT")
_add("image.aspect",
     lambda x: float(_image(x).shape[2]) / float(_image(x).shape[1]), return_type="FLOAT")

# mask: coverage is the mean of the mask tensor
_add("mask.coverage", lambda x: float(_tensor(x, "mask.coverage").mean()), return_type="FLOAT")
_add("mask.is_empty",
     lambda x: float(_tensor(x, "mask.is_empty").mean()) == 0.0, return_type="BOOLEAN")

# latent: 5-D samples are [B,C,T,H,W]; anything else is a single frame
_add("latent.frames",
     lambda x: int(_latent(x).shape[2]) if len(_latent(x).shape) == 5 else 1, return_type="INT")
_add("latent.shape", lambda x: tuple(int(s) for s in _latent(x).shape), return_type="LIST")


def _seq_length(x):
    v = unref(x)
    if isinstance(v, (list, tuple, str)):
        return len(v)
    shape = getattr(v, "shape", None)
    if shape is not None:
        return int(shape[0])
    raise ExprError(f"seq.length expects a sequence or a tensor, got {type(v).__name__}")


_add("seq.length", _seq_length, return_type="INT")


def pack_of(cap_id: str) -> str:
    return cap_id.rpartition(".")[0]


def ids() -> list[str]:
    return sorted(REGISTRY)


# --------------------------------------------------------------- transforms
#
# Transforms arrive with Safe Function (spec 5.3). They are NOT
# predicate_safe: a Gate, Condition, Filter or Partition refuses them,
# because those nodes decide a branch and planning must stay pure and cheap.
# All of them are functional (a new tensor, never an in-place write on a
# value another node also consumes) and every one of them declares its peak
# in elements, which check_peak() enforces against the installation's
# max_pixels before the call. register() refuses a transform without one.
import torch


def check_peak(cap: Capability, args, path: str | None = None) -> int:
    """The ONE place a transform's declared peak is enforced (spec 8.2).

    It used to sit inside three of the eight transforms, and the module said
    "every allocation is capped by the installation's max_pixels", which was
    not true: crop, flip, mask.invert, mask.threshold and latent.blend had no
    check at all. Those five cannot grow past their input, so the exposure was
    an accounting gap rather than an unbounded hole, but the sentence was
    false and a blend builds about three full-size temporaries in one call.

    Estimates are in ELEMENTS. Bytes would be the better unit, since fp32 and
    fp16 do not cost the same and interpolate() promotes to float; that is
    owed, and the peak below is deliberately the pessimistic count.
    """
    if cap.preflight is None:
        return 0
    count = int(cap.preflight(*args))
    ceiling = policy.ceilings(path)["max_pixels"]
    if count > ceiling:
        raise ExprError(f"{cap.id} would allocate {count} pixels, over the "
                        f"max_pixels limit of {ceiling}")
    return count


def _whole(value, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ExprError(f"{what} expects whole numbers, got {type(value).__name__}")
    return int(value)


def _resize(image, width, height):
    t = _image(image)
    w, h = _whole(width, "image.resize"), _whole(height, "image.resize")
    if w < 1 or h < 1:
        raise ExprError(f"image.resize needs a positive size, got {w}x{h}")
    out = torch.nn.functional.interpolate(t.movedim(-1, 1).float(), size=(h, w),
                                          mode="bilinear", align_corners=False)
    return Ref(out.movedim(1, -1), "IMAGE")


def _crop(image, x, y, width, height):
    t = _image(image)
    x0, y0 = _whole(x, "image.crop"), _whole(y, "image.crop")
    w, h = _whole(width, "image.crop"), _whole(height, "image.crop")
    if x0 < 0 or y0 < 0 or w < 1 or h < 1:
        raise ExprError(f"image.crop needs a positive box, got {w}x{h} at {x0},{y0}")
    if y0 + h > int(t.shape[1]) or x0 + w > int(t.shape[2]):
        raise ExprError(f"image.crop box {w}x{h} at {x0},{y0} leaves an image of "
                        f"{int(t.shape[2])}x{int(t.shape[1])}")
    return Ref(t[:, y0:y0 + h, x0:x0 + w, :].clone(), "IMAGE")


def _flip(image, horizontal=True):
    t = _image(image)
    return Ref(torch.flip(t, dims=[2] if horizontal else [1]), "IMAGE")


def _select(image, indices):
    t = _image(image)
    items = unref(indices)
    if isinstance(items, (int, float)) and not isinstance(items, bool):
        items = [items]
    if not isinstance(items, (list, tuple)):
        raise ExprError(f"image.select expects a list of indices, got {type(items).__name__}")
    batch = int(t.shape[0])
    picked = []
    for index in items:
        i = _whole(index, "image.select")
        if not -batch <= i < batch:
            raise ExprError(f"image.select index {i} is out of range for a batch of {batch}")
        picked.append(i % batch)
    if not picked:
        raise ExprError("image.select needs at least one index")
    return Ref(t[picked].clone(), "IMAGE")


def _mask_invert(mask):
    return Ref(1.0 - _tensor(mask, "mask.invert").float(), "MASK")


def _mask_threshold(mask, t):
    if isinstance(t, bool) or not isinstance(t, (int, float)):
        raise ExprError(f"mask.threshold expects a number, got {type(t).__name__}")
    return Ref((_tensor(mask, "mask.threshold") > float(t)).float(), "MASK")


def _latent_blend(a, b, t):
    if isinstance(t, bool) or not isinstance(t, (int, float)):
        raise ExprError(f"latent.blend expects a number, got {type(t).__name__}")
    first, second = _latent(a), _latent(b)
    if tuple(first.shape) != tuple(second.shape):
        raise ExprError(f"latent.blend needs matching shapes, got {tuple(first.shape)} "
                        f"and {tuple(second.shape)}")
    mixed = dict(unref(a))
    mixed["samples"] = first * (1.0 - float(t)) + second * float(t)
    return Ref(mixed, "LATENT")


def _seq_concat(a, b):
    first, second = unref(a), unref(b)
    if isinstance(first, (list, tuple)) and isinstance(second, (list, tuple)):
        return list(first) + list(second)
    if getattr(first, "shape", None) is not None and getattr(second, "shape", None) is not None:
        if tuple(first.shape[1:]) != tuple(second.shape[1:]):
            raise ExprError(f"seq.concat needs matching shapes after the batch dimension, "
                            f"got {tuple(first.shape)} and {tuple(second.shape)}")
        return Ref(torch.cat([first, second], dim=0), kind_of(first))
    raise ExprError(f"seq.concat joins two lists or two tensors, got "
                    f"{type(first).__name__} and {type(second).__name__}")


def _numel(value) -> int:
    raw = unref(value)
    if isinstance(raw, dict):
        raw = raw.get("samples")
    shape = getattr(raw, "shape", None)
    if shape is None:
        return len(raw) if isinstance(raw, (str, list, tuple)) else 0
    count = 1
    for size in shape:
        count *= int(size)
    return count


def _p_resize(image, width, height):
    t = _image(image)
    return int(t.shape[0]) * abs(int(width)) * abs(int(height)) * int(t.shape[3])


def _p_crop(image, x, y, width, height):
    t = _image(image)
    return int(t.shape[0]) * abs(int(width)) * abs(int(height)) * int(t.shape[3])


def _p_select(image, indices):
    t = _image(image)
    items = unref(indices)
    count = len(items) if isinstance(items, (list, tuple)) else 1
    return count * int(t.shape[1]) * int(t.shape[2]) * int(t.shape[3])


def _p_concat(a, b):
    return _numel(a) + _numel(b)


# the multipliers are the temporaries the expression builds, not just the
# result: `.float()` copies, `1.0 - t` copies, and a blend is two products
# and a sum before anything is returned
def _p_same(image, *_ignored):
    return _numel(image)


def _p_twice(value, *_ignored):
    return 2 * _numel(value)


def _p_blend(a, b, t):
    return 3 * _numel(a)


TRANSFORMS = {
    "image.resize": (_resize, _p_resize), "image.crop": (_crop, _p_crop),
    "image.flip": (_flip, _p_same), "image.select": (_select, _p_select),
    "mask.invert": (_mask_invert, _p_twice),
    "mask.threshold": (_mask_threshold, _p_twice),
    "latent.blend": (_latent_blend, _p_blend),
    "seq.concat": (_seq_concat, _p_concat),
}
for _cid, (_transform, _peak) in TRANSFORMS.items():
    _add(_cid, _transform, return_type="ANY", predicate_safe=False, cost=1.0,
         preflight=_peak, pack="transforms")
