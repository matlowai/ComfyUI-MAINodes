"""Allowlist expression evaluator for the flow nodes (spec 5.1-5.2).

Why not simpleeval, which core's Math Expression uses: values here are not
only scalars. A tensor, a LATENT dict or a model patcher crosses into an
expression wrapped in an opaque ``Ref``, and only a registered capability
may unwrap one. simpleeval evaluates attribute access against real Python
objects; this evaluator refuses attribute access outright and resolves
dotted names such as ``image.width`` against the capability registry as
strings, before any value is touched.

Syntax is a strict superset of core's Math Expression, so an expression
moves between the two nodes unchanged.
"""
from __future__ import annotations

import ast
import operator as _op

MAX_SOURCE_BYTES = 4096
MAX_NODES = 2000
MAX_DEPTH = 32
MAX_CALLS = 256
MAX_ELEMENTS = 64
MAX_EXPONENT = 4000          # same cap as core's Math Expression
# Program size is not value size: 'ab' * 5000000 is a dozen AST nodes and
# gigabytes of str. Core's simpleeval guards the same hole with safe_mult /
# safe_add / MAX_STRING_LENGTH; host RAM is this box's real ceiling.
MAX_RESULT_LENGTH = 1_000_000    # elements of a sequence, characters of a str
# An integer has no length, so MAX_RESULT_LENGTH never sees one: `x = x * x`
# in a loop passes every other guard and reaches 134 MB of int in 30 steps,
# 137 GB in 40, and a bigint multiply is one uninterruptible C call. A
# million bits is 125 KB, far above `2 ** 4000` and far below any real cost.
MAX_INT_BITS = 1_000_000


class ExprError(ValueError):
    """A rejection or a runtime failure inside an expression."""


class Ref:
    """Opaque handle on a non-scalar Comfy value.

    The evaluator can pass a Ref to a capability and nothing else: there is
    no attribute access and no subscript path that reaches the value.
    """

    __slots__ = ("value", "kind")

    def __init__(self, value, kind: str = "VALUE"):
        self.value = value
        self.kind = kind

    def describe(self) -> str:
        shape = getattr(self.value, "shape", None)
        if shape is not None:
            return f"{self.kind}[{','.join(str(int(s)) for s in shape)}]"
        try:
            return f"{self.kind}[{len(self.value)}]"
        except Exception:
            return self.kind

    def __repr__(self) -> str:
        return f"<Ref {self.describe()}>"


def wrap(value):
    """Scalars cross as themselves; everything else becomes a Ref."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Ref):
        return value
    return Ref(value, kind_of(value))


def kind_of(value) -> str:
    if isinstance(value, dict) and "samples" in value:
        return "LATENT"
    shape = getattr(value, "shape", None)
    if shape is not None:
        if len(shape) == 4 and int(shape[-1]) in (1, 3, 4):
            return "IMAGE"
        if len(shape) == 3:
            return "MASK"
        return "TENSOR"
    if isinstance(value, (list, tuple)):
        return "LIST"
    return type(value).__name__.upper()


def describe(value):
    """Report form used by every node's ui payload: scalars verbatim.

    Returns the scalar itself for scalars, and a ``KIND[shape]`` string for
    everything else, so the return type is deliberately not ``str``.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return wrap(value).describe()


def _whole(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _too_many_bits(operator_name: str, bits: int):
    return ExprError(
        f"'{operator_name}' would build a {bits}-bit integer, over the "
        f"MAX_INT_BITS limit of {MAX_INT_BITS}")


def _safe_pow(base, exp, *, spelling: str = "**"):
    """The ONE exponent guard. `spelling` only names the door in the message.

    The pow() capability used to be a second implementation that capped the
    exponent and left the base free; it now calls this. A keyword default
    rather than a second function, so there is no way to add a door without
    the guard.
    """
    if abs(exp) > MAX_EXPONENT:
        raise ExprError(f"exponent {exp} exceeds the maximum allowed ({MAX_EXPONENT})")
    if _whole(base) and _whole(exp) and exp > 0:
        bits = base.bit_length() * exp
        if bits > MAX_INT_BITS:
            raise _too_many_bits(spelling, bits)
    return _op.pow(base, exp)


def _units(value) -> str:
    return "characters" if isinstance(value, str) else "elements"


def _too_long(operator_name: str, size: int, sample):
    return ExprError(
        f"'{operator_name}' would build {size} {_units(sample)}, over the "
        f"MAX_RESULT_LENGTH limit of {MAX_RESULT_LENGTH}")


def _safe_mult(left, right):
    """Sequence repetition that refuses before it allocates (spec 5.1)."""
    for seq, count in ((left, right), (right, left)):
        if isinstance(seq, (str, list, tuple)) and isinstance(count, int) \
                and not isinstance(count, bool):
            size = len(seq) * count
            if size > MAX_RESULT_LENGTH:
                raise _too_long("*", size, seq)
    if _whole(left) and _whole(right):
        bits = left.bit_length() + right.bit_length()
        if bits > MAX_INT_BITS:
            raise _too_many_bits("*", bits)
    return _op.mul(left, right)


def _safe_add(left, right):
    """Sequence concatenation that refuses before it allocates (spec 5.1)."""
    if isinstance(left, (str, list, tuple)) and isinstance(right, (str, list, tuple)):
        size = len(left) + len(right)
        if size > MAX_RESULT_LENGTH:
            raise _too_long("+", size, left)
    return _op.add(left, right)


def _safe_mod(left, right):
    """Numeric remainder only. `%` on a str is printf, and printf allocates.

    `'%900000000000d' % 1` is a dozen AST nodes and takes the host down
    before any budget is consulted, and a Gate or a Condition has no
    collection budget at all. Refusing it also settles a contradiction: the
    f-string refusal already says there is no formatting capability.
    """
    if isinstance(left, str):
        raise ExprError("string formatting is not available; there is no "
                        "formatting capability")
    return _op.mod(left, right)


_BINOPS = {
    ast.Add: _safe_add, ast.Sub: _op.sub, ast.Mult: _safe_mult, ast.Div: _op.truediv,
    ast.FloorDiv: _op.floordiv, ast.Mod: _safe_mod, ast.Pow: _safe_pow,
}
_CMPOPS = {
    ast.Eq: _op.eq, ast.NotEq: _op.ne, ast.Lt: _op.lt, ast.LtE: _op.le,
    ast.Gt: _op.gt, ast.GtE: _op.ge,
}
_UNARYOPS = {ast.USub: _op.neg, ast.UAdd: _op.pos, ast.Not: _op.not_}

_POLICY = {
    ast.Attribute: "attribute access on values is not available; use image.width(x)",
    ast.Lambda: "lambda is not available; expressions call registered capabilities only",
    ast.ListComp: "comprehensions are not available; use the Filter or Partition node",
    ast.SetComp: "comprehensions are not available; use the Filter or Partition node",
    ast.DictComp: "comprehensions are not available; use the Filter or Partition node",
    ast.GeneratorExp: "generator expressions are not available; use the Filter or Partition node",
    ast.NamedExpr: "the walrus operator is not available; expressions do not bind names",
    ast.Starred: "starred arguments are not available; pass arguments positionally",
    ast.JoinedStr: "f-strings are not available; there is no formatting capability",
    ast.FormattedValue: "f-strings are not available; there is no formatting capability",
    ast.Dict: "dict literals are not available; use a list or a tuple",
    ast.Set: "set literals are not available; use a list or a tuple",
    ast.Slice: "slices are not available; subscript with a single integer",
    ast.Await: "await is not available in expressions",
    ast.Yield: "yield is not available in expressions",
}


def _reject(node) -> str:
    for cls, message in _POLICY.items():
        if isinstance(node, cls):
            return message
    return f"{type(node).__name__} is not available in expressions"


def dotted_name(node):
    """An ast.Attribute chain rooted at a Name, as a dotted string, or None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not parts or not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _resolve(name: str):
    from . import capabilities          # deferred: capabilities imports Ref
    return capabilities.resolve(name)


def _unavailable(cap):
    """The optional-pack refusal (spec 5.3), asked here as well as in Safe
    Function, so a pack member that is also predicate-safe would still be
    refused by a Gate on an installation that never enabled the pack."""
    from . import capabilities
    return capabilities.unavailable(cap)


class _Validator:
    """Structural allowlist walk. Runs without any values."""

    def __init__(self, bound_names):
        # None means "the bound names are not known yet" (queue-time
        # validation, where linked values have no value): syntax, limits and
        # capability names are still checked, name binding is not.
        self.bound = None if bound_names is None else set(bound_names)
        self.count = 0

    def walk(self, node, depth=0):
        self.count += 1
        if self.count > MAX_NODES:
            raise ExprError(f"expression has more than {MAX_NODES} syntax nodes")
        if depth > MAX_DEPTH:
            raise ExprError(f"expression nests deeper than {MAX_DEPTH} levels")

        if isinstance(node, ast.Constant):
            if not isinstance(node.value, (bool, int, float, str, type(None))):
                raise ExprError(f"{type(node.value).__name__} literals are not available")
            return
        if isinstance(node, ast.Name):
            self._check_name(node.id)
            # A bound value always wins, so a connected input may legally be
            # named after a capability (the node layer cannot produce that
            # collision: value names are a..z plus item/index/count).
            if self.bound is not None and node.id in self.bound:
                return
            # Otherwise a bare capability name is statically decidable, so it
            # is a queue-time error rather than a run-time one (spec 5.1).
            # Any Name reaching here IS bare: _check_call resolves the callee
            # itself and walks only node.args, never node.func. Without this,
            # `sqrt` reached the evaluator and the branch it fed was wrong.
            if _resolve(node.id) is not None:
                raise ExprError(
                    f"'{node.id}' is a capability and must be called, "
                    f"as {node.id}(...)")
            if self.bound is not None:
                raise ExprError(
                    f"name '{node.id}' is neither a connected value nor a registered capability")
            return
        if isinstance(node, ast.UnaryOp):
            if type(node.op) not in _UNARYOPS:
                raise ExprError(_reject(node.op))
            return self.walk(node.operand, depth + 1)
        if isinstance(node, ast.BinOp):
            if type(node.op) not in _BINOPS:
                raise ExprError(_reject(node.op))
            if isinstance(node.op, ast.Pow):
                # a literal exponent bomb is a validation error, not a runtime one
                right = node.right
                if isinstance(right, ast.Constant) and isinstance(right.value, (int, float)):
                    if abs(right.value) > MAX_EXPONENT:
                        raise ExprError(
                            f"exponent {right.value} exceeds the maximum allowed ({MAX_EXPONENT})")
            self.walk(node.left, depth + 1)
            return self.walk(node.right, depth + 1)
        if isinstance(node, ast.BoolOp):
            for v in node.values:
                self.walk(v, depth + 1)
            return
        if isinstance(node, ast.Compare):
            for op in node.ops:
                if type(op) not in _CMPOPS:
                    raise ExprError(_reject(op))
            self.walk(node.left, depth + 1)
            for c in node.comparators:
                self.walk(c, depth + 1)
            return
        if isinstance(node, ast.IfExp):
            for part in (node.test, node.body, node.orelse):
                self.walk(part, depth + 1)
            return
        if isinstance(node, (ast.Tuple, ast.List)):
            if len(node.elts) > MAX_ELEMENTS:
                raise ExprError(
                    f"literal has {len(node.elts)} elements, the limit is {MAX_ELEMENTS}")
            for e in node.elts:
                self.walk(e, depth + 1)
            return
        if isinstance(node, ast.Subscript):
            if not isinstance(node.value, (ast.Call, ast.Tuple, ast.List, ast.Name)):
                raise ExprError("subscripts apply to a capability result or a literal sequence")
            idx = node.slice
            if not (isinstance(idx, ast.Constant) and isinstance(idx.value, int)
                    and not isinstance(idx.value, bool)) and not isinstance(idx, ast.Name):
                raise ExprError("subscript index must be an integer literal or an integer name")
            self.walk(node.value, depth + 1)
            return self.walk(idx, depth + 1)
        if isinstance(node, ast.Call):
            self._check_call(node, depth)
            return
        raise ExprError(_reject(node))

    def _check_name(self, name: str):
        if "__" in name:
            raise ExprError(f"name '{name}' contains '__', which is never available")

    def _check_call(self, node, depth):
        if node.keywords:
            raise ExprError("keyword arguments are not available; pass arguments positionally")
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            name = dotted_name(node.func)
            if name is None:
                raise ExprError(_POLICY[ast.Attribute])
        if name is None:
            raise ExprError(_reject(node.func))
        self._check_name(name)
        if _resolve(name) is None:
            raise ExprError(f"'{name}' is not a registered capability")
        for a in node.args:
            self.walk(a, depth + 1)


def validate(source: str, bound_names=None) -> ast.Expression:
    """Parse and structurally check. No values are needed and none are used.

    ``bound_names=None`` skips the name-binding check, which is what
    ``validate_inputs`` needs at queue time: the grown value inputs are
    links, so their names are known but their values are not.
    """
    if not isinstance(source, str) or not source.strip():
        raise ExprError("expression is empty")
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ExprError(f"expression source exceeds {MAX_SOURCE_BYTES} bytes")
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError as e:
        raise ExprError(f"not a single expression: {e.msg}") from None
    _Validator(bound_names).walk(tree.body)
    return tree


class _Eval:
    def __init__(self, names):
        self.names = names
        self.calls = 0

    def run(self, node):
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in self.names:
                return self.names[node.id]
            if _resolve(node.id) is None:
                raise ExprError(f"name '{node.id}' is not bound")
            # a bare capability name is not a value: returning cap.fn made
            # `sqrt` evaluate to True / 0 / a heap address instead of failing
            raise ExprError(
                f"'{node.id}' is a capability and must be called, as {node.id}(...)")
        if isinstance(node, ast.UnaryOp):
            return _UNARYOPS[type(node.op)](self.run(node.operand))
        if isinstance(node, ast.BinOp):
            left, right = self.run(node.left), self.run(node.right)
            if isinstance(node.op, ast.Pow):
                return _safe_pow(left, right)
            return _BINOPS[type(node.op)](left, right)
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                out = True
                for v in node.values:
                    out = self.run(v)
                    if not out:
                        return out
                return out
            out = False
            for v in node.values:
                out = self.run(v)
                if out:
                    return out
            return out
        if isinstance(node, ast.Compare):
            left = self.run(node.left)
            for op, comp in zip(node.ops, node.comparators):
                right = self.run(comp)
                if not _CMPOPS[type(op)](left, right):
                    return False
                left = right
            return True
        if isinstance(node, ast.IfExp):
            return self.run(node.body) if self.run(node.test) else self.run(node.orelse)
        if isinstance(node, ast.Tuple):
            return tuple(self.run(e) for e in node.elts)
        if isinstance(node, ast.List):
            return [self.run(e) for e in node.elts]
        if isinstance(node, ast.Subscript):
            seq = self.run(node.value)
            index = self.run(node.slice)
            if not isinstance(seq, (list, tuple)):
                raise ExprError("subscripted value is not a sequence")
            if not isinstance(index, int) or isinstance(index, bool):
                raise ExprError("subscript index must be an integer")
            try:
                return seq[index]
            except IndexError:
                raise ExprError(f"index {index} is out of range for a sequence of {len(seq)}") from None
        if isinstance(node, ast.Call):
            self.calls += 1
            if self.calls > MAX_CALLS:
                raise ExprError(f"expression made more than {MAX_CALLS} capability calls")
            name = node.func.id if isinstance(node.func, ast.Name) else dotted_name(node.func)
            cap = _resolve(name)
            if cap is None:
                raise ExprError(f"'{name}' is not a registered capability")
            problem = _unavailable(cap)
            if problem:
                raise ExprError(problem)
            args = [self.run(a) for a in node.args]
            try:
                return cap.fn(*args)
            except ExprError:
                raise
            except Exception as e:
                raise ExprError(f"{name}(): {type(e).__name__}: {e}") from None
        raise ExprError(_reject(node))


def evaluate(source: str, names: dict | None = None, tree: ast.Expression | None = None):
    """Validate (unless a validated tree is handed in) and evaluate."""
    names = dict(names or {})
    if tree is None:
        tree = validate(source, names.keys())
    return _Eval(names).run(tree.body)
