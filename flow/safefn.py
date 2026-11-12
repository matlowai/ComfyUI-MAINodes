"""Safe Function: a restricted, Python-like function body (spec 8).

The body is parsed with ``ast``, checked against an allowlist, and run by
the interpreter below: no ``eval``, no ``exec``, no ``compile``, no
bytecode, and only a registered capability ever touches a value. Expressions
are the section 5 language, so this module reuses ``flow.expr``'s validator
and evaluator rather than growing a second one; what it adds is statements,
budgets, and a planning mode.

Planning is the interesting half. ``check_lazy_status`` runs the same body
with unresolved sockets bound to ``Unknown``, and every operation on an
Unknown yields an Unknown, so the interpreter only stops where a truth value
is demanded: the first branch that depends on one names the socket it needs,
core resolves it, planning is re-entered, and a socket on an untaken branch
is never named. A transform never runs while planning; its result is Unknown
too, and a branch that depends on one is a workflow error.
"""
from __future__ import annotations

import ast
from collections import deque
from typing import NamedTuple

from . import capabilities, policy
from .expr import (MAX_DEPTH, MAX_ELEMENTS, MAX_NODES, MAX_SOURCE_BYTES,
                   ExprError, Ref, _BINOPS, _Eval, _reject, _Validator,
                   dotted_name, wrap)

SOCKETS = "abcdefghijkl"          # twelve fixed lazy slots; never Autogrow
MAX_PARAMS = len(SOCKETS)

DEFAULT_SOURCE = '''def main(original: IMAGE, restored: IMAGE, enabled: BOOL = True, strength: FLOAT = 1.0) -> IMAGE:
    if not enabled:
        return original
    if strength <= 0:
        return original
    return restored
'''


class SafeFnError(ValueError):
    """A refusal or a failure inside a Safe Function. Carries the line."""

    def __init__(self, message: str, line: int | None = None):
        super().__init__(message)
        self.line = line


class NeedsInput(Exception):
    """Planning stopped: this socket has to resolve before the body can go on."""

    def __init__(self, socket: str):
        super().__init__(socket)
        self.socket = socket


def _rejected(line, message, verb="rejected") -> SafeFnError:
    return SafeFnError(f"Safe Function {verb} at line {line}: {message}", line)


def _failed(line, message) -> SafeFnError:
    return _rejected(line, message, verb="failed")


class _UnknownTruth(Exception):
    """A truth value was demanded of an Unknown. Carries it back up."""

    def __init__(self, unknown):
        super().__init__("unknown truth value")
        self.unknown = unknown


class Unknown:
    """A value planning cannot know yet: an unresolved socket, or a transform.

    Every operator yields an Unknown again, so an expression built on one is
    Unknown without the evaluator needing a special case; asking for its
    truth value raises, which is the moment control flow depends on it.
    """

    __slots__ = ("socket", "transform", "name")

    def __init__(self, socket=None, transform=False, name=None):
        self.socket = socket
        self.transform = transform
        self.name = name

    def __bool__(self):
        raise _UnknownTruth(self)

    def _keep(self, other=None):
        # an unresolved socket outranks a transform: it is the actionable one
        if isinstance(other, Unknown) and self.transform and not other.transform:
            return other
        return self

    def _self(self):
        return self

    __add__ = __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = _keep
    __truediv__ = __rtruediv__ = __floordiv__ = __rfloordiv__ = _keep
    __mod__ = __rmod__ = __pow__ = __rpow__ = _keep
    __lt__ = __le__ = __gt__ = __ge__ = __eq__ = __ne__ = _keep
    __getitem__ = _keep
    __neg__ = __pos__ = __abs__ = _self
    __hash__ = object.__hash__


def _raise_it(field: str, limit, asked) -> str:
    """The one sentence of advice that can actually work here.

    Advice has to name the limit that bound the value. "Raise max_ops on the
    node" is useless when the node already asks for more than the
    installation allows, which is exactly the case a user cannot diagnose.
    """
    if asked is None:
        return f"Raise {field} on the node."
    return (f"The node asks for {asked}, so raise the {field} ceiling of "
            f"{limit} in flow_policy.json.")


class Limits(dict):
    """Effective budgets, remembering which of them the ceiling cut down.

    A plain dict still works everywhere a Limits does; it simply reports no
    capped field, which is the honest answer when nobody asked for more.
    """

    def __init__(self, values: dict, capped: dict | None = None):
        super().__init__(values)
        self.capped = dict(capped or {})     # field -> what the node asked for


class Budget:
    """One serialized allowance per resource, shared across nested loops."""
    def __init__(self, limits: dict):
        self.limits = limits
        self.capped = getattr(limits, "capped", {})
        self.used = {field: 0 for field in limits}

    def spend(self, field: str, line, amount: int = 1):
        used = self.used[field] = self.used[field] + amount
        limit = self.limits[field]
        if used > limit:
            raise SafeFnError(
                f"Safe Function stopped at line {line}: the {field} budget of "
                f"{limit} is exhausted (used {used}). "
                f"{_raise_it(field, limit, self.capped.get(field))}", line)


def limits(max_iterations=None, max_ops=None, max_calls=None, max_collection=None,
           max_tensor_elements=None, *, path=None) -> Limits:
    """Node settings lowered by the installation ceiling (spec 8.2).

    All five budgets are node inputs, so the editor and the API behave the
    same; policy may lower one, never replace it. ``path`` is keyword-only:
    the fourth positional is ``max_collection`` and the fifth, appended
    rather than inserted, is ``max_tensor_elements``.
    """
    asked = {"max_iterations": max_iterations, "max_ops": max_ops,
             "max_calls": max_calls, "max_collection": max_collection,
             "max_tensor_elements": max_tensor_elements}
    ceilings = policy.ceilings(path)
    values, capped = {}, {}
    for field, requested in asked.items():
        values[field] = policy.effective(field, requested, path)
        if requested is not None and requested > ceilings[field]:
            capped[field] = requested
    return Limits(values, capped)


_IMPORT = ("import is not available. Safe Functions can only call registered "
           "capabilities.")
_ASYNC = "async is not available"
_LOCAL = "%s is not available; a Safe Function has only local names"
_STATEMENT_POLICY = {
    ast.While: ("while is not available in Safe Function; use "
                "`for _ in range(limit):` with break"),
    ast.Import: _IMPORT, ast.ImportFrom: _IMPORT,
    ast.AsyncFunctionDef: _ASYNC, ast.AsyncFor: _ASYNC, ast.AsyncWith: _ASYNC,
    ast.Global: _LOCAL % "global", ast.Nonlocal: _LOCAL % "nonlocal",
    ast.ClassDef: "class is not available; a Safe Function is one function",
    ast.FunctionDef: ("nested functions are not available; a Safe Function is "
                      "exactly one function named main"),
    ast.Try: "try is not available; a failing capability stops the function",
    ast.Raise: "raise is not available",
    ast.With: "with is not available; there is nothing to open",
    ast.Delete: "del is not available", ast.Assert: "assert is not available",
    ast.AnnAssign: "annotated assignment is not available; write x = ...",
    ast.Match: "match is not available; use if / elif / else",
}


Param = NamedTuple("Param", [("name", str), ("socket", str), ("annotation", str),
                             ("default", object), ("has_default", bool)])

_ANNOTATION_SCALARS = {
    "BOOL": (bool,), "BOOLEAN": (bool,), "INT": (int,), "FLOAT": (float, int),
    "STRING": (str,), "STR": (str,),
}
_SCALAR_NAMES = {"str": "STRING", "int": "INT", "float": "FLOAT",
                 "bool": "BOOL", "NoneType": "NONE"}


def _kind_name(value) -> str:
    """The annotation-side name of a value: STRING, INT, IMAGE, LATENT."""
    raw = capabilities.unref(value)
    if raw is None or isinstance(raw, (bool, int, float, str)):
        return _SCALAR_NAMES.get(type(raw).__name__, type(raw).__name__.upper())
    return wrap(raw).describe().split("[")[0]


_LITERAL_TYPES = (bool, int, float, str, type(None))


def _literal(name: str, node, line):
    """A parameter default is a LITERAL, and now actually is one.

    It used to be validated as an expression and then EVALUATED at parse
    time, so `def main(x, y = sqrt(25))` ran a capability outside every
    budget, on every parse, and the source is parsed once in validate_inputs,
    once per planning pass and once in execute. There is no user value in a
    computed default, so the capability is deleted rather than accounted for:
    a whole execution phase stops existing.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, _LITERAL_TYPES):
        return node.value
    # -1 is UnaryOp(USub, Constant(1)), not a negative constant
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)) \
            and isinstance(node.operand, ast.Constant) \
            and isinstance(node.operand.value, (int, float)) \
            and not isinstance(node.operand.value, bool):
        value = node.operand.value
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, (ast.List, ast.Tuple)):
        if len(node.elts) > MAX_ELEMENTS:
            raise _rejected(line, f"the default for '{name}' has {len(node.elts)} "
                                  f"elements, the limit is {MAX_ELEMENTS}")
        items = [_literal(name, element, line) for element in node.elts]
        return tuple(items) if isinstance(node, ast.Tuple) else items
    raise _rejected(line, f"the default for '{name}' is a literal: a number, a "
                          f"string, True, False, None, or a list or tuple of those. "
                          f"It is never computed, so nothing runs while the node "
                          f"is being parsed")


def _annotation_of(node) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


class _Body:
    """Statement allowlist. Expressions go to flow.expr's validator unchanged."""
    def __init__(self, bound):
        self.bound = set(bound)
        self.nodes = 0

    def expression(self, node):
        validator = _Validator(self.bound)
        line = getattr(node, "lineno", 0)
        try:
            validator.walk(node)
        except ExprError as e:
            raise _rejected(line, str(e)) from None
        self.nodes += validator.count
        if self.nodes > MAX_NODES:
            raise _rejected(line, f"the function has more than {MAX_NODES} syntax nodes")

    def block(self, statements, depth=0, in_loop=False):
        if depth > MAX_DEPTH:
            raise _rejected(getattr(statements[0], "lineno", 0),
                            f"statements nest deeper than {MAX_DEPTH} levels")
        for statement in statements:
            self.statement(statement, depth, in_loop)

    def statement(self, node, depth, in_loop):
        line = getattr(node, "lineno", 0)
        for cls, message in _STATEMENT_POLICY.items():
            if isinstance(node, cls):
                raise _rejected(line, message)
        if isinstance(node, ast.Pass):
            return
        if isinstance(node, ast.Expr):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                return              # a docstring
            # checked FIRST, so a refused construct reports its own policy
            self.expression(node.value)
            raise _rejected(line, "a bare expression does nothing; assign it or return it")
        if isinstance(node, ast.Assign):
            if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
                raise _rejected(line, "assign to one plain name; there is no unpacking")
            name = self._target(line, node.targets[0])
            self.expression(node.value)
            self.bound.add(name)
            return
        if isinstance(node, ast.AugAssign):
            # x += 1 is x = x + 1: the name has to exist already, and the
            # operator is the same allowlist the expression layer applies
            if not isinstance(node.target, ast.Name):
                raise _rejected(line, "augmented assignment updates one plain name")
            name = self._target(line, node.target)
            if name not in self.bound:
                raise _rejected(line, f"name '{name}' is not bound yet; augmented "
                                      f"assignment updates a name that already has a value")
            if type(node.op) not in _BINOPS:
                raise _rejected(line, _reject(node.op))
            self.expression(node.value)
            return
        if isinstance(node, ast.If):
            self.expression(node.test)
            self.block(node.body, depth + 1, in_loop)
            if node.orelse:
                self.block(node.orelse, depth + 1, in_loop)
            return
        if isinstance(node, ast.For):
            if not isinstance(node.target, ast.Name):
                raise _rejected(line, "the loop variable is one plain name; there is no unpacking")
            if node.orelse:
                raise _rejected(line, "for / else is not available")
            self.iterable(node.iter)
            self.bound.add(self._target(line, node.target))
            return self.block(node.body, depth + 1, True)
        if isinstance(node, (ast.Break, ast.Continue)):
            if not in_loop:
                raise _rejected(
                    line, f"{type(node).__name__.lower()} is only available in a for loop")
            return
        if isinstance(node, ast.Return):
            return self.expression(node.value) if node.value is not None else None
        raise _rejected(line, f"{type(node).__name__} is not available in Safe Function")

    def _target(self, line, name_node) -> str:
        """Every name a statement binds: assignment, augmented, loop variable."""
        name = name_node.id
        if "__" in name:
            raise _rejected(line, f"name '{name}' contains '__', which is never available")
        return name

    def iterable(self, node):
        # range(n) is legal here and nowhere else; it is not a capability
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "range":
            if node.keywords or not 1 <= len(node.args) <= 3:
                raise _rejected(node.lineno, "range takes one to three positional arguments")
            for argument in node.args:
                self.expression(argument)
            return
        self.expression(node)


class Function:
    """A parsed, validated Safe Function body, ready to plan or to execute."""

    def __init__(self, source: str, budgets: dict | None = None):
        self.source = source
        self.limits = budgets or limits()
        self.tree = self._parse(source)
        self.params = self._signature(self.tree)
        _Body(p.name for p in self.params).block(self.tree.body)
        self._check_packs()

    def _check_packs(self):
        """A call into a pack this installation has not enabled fails at parse time.

        Parse time is queue time (validate_inputs compiles), so a shared
        workflow that needs the transforms says so before anything runs.
        _Interp._call asks the same question again at the call.
        """
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.id if isinstance(node.func, ast.Name) else dotted_name(node.func)
            cap = capabilities.resolve(name)
            problem = capabilities.unavailable(cap) if cap is not None else None
            if problem:
                raise _rejected(getattr(node, "lineno", 0), problem)

    @staticmethod
    def _parse(source) -> ast.FunctionDef:
        if not isinstance(source, str):
            raise SafeFnError("Safe Function source is text typed on the node; it "
                              "cannot arrive on a link")
        if not source.strip():
            raise SafeFnError("Safe Function source is empty")
        if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise SafeFnError(f"Safe Function source exceeds {MAX_SOURCE_BYTES} bytes")
        try:
            module = ast.parse(source)
        except SyntaxError as e:
            raise _rejected(e.lineno or 0, e.msg) from None
        if len(module.body) != 1 or not isinstance(module.body[0], ast.FunctionDef):
            raise SafeFnError("Safe Function source is exactly one function, "
                              "written `def main(...):`")
        function = module.body[0]
        if function.name != "main":
            raise _rejected(function.lineno,
                            f"the function is named 'main', not '{function.name}'")
        if function.decorator_list:
            raise _rejected(function.lineno, "decorators are not available")
        return function

    @staticmethod
    def _signature(function) -> list[Param]:
        args = function.args
        if args.vararg or args.kwarg or args.kwonlyargs or getattr(args, "posonlyargs", []):
            raise _rejected(function.lineno,
                            "parameters are plain and positional; *args, **kwargs and "
                            "keyword-only parameters are not available")
        if len(args.args) > MAX_PARAMS:
            raise _rejected(function.lineno,
                            f"a Safe Function takes at most {MAX_PARAMS} parameters "
                            f"(sockets {SOCKETS[0]}..{SOCKETS[-1]}), got {len(args.args)}")
        offset = len(args.args) - len(args.defaults)
        params = []
        for index, argument in enumerate(args.args):
            if "__" in argument.arg:
                raise _rejected(function.lineno,
                                f"name '{argument.arg}' contains '__', which is never available")
            has_default, default = index >= offset, None
            if has_default:
                node = args.defaults[index - offset]
                default = _literal(argument.arg, node,
                                   getattr(node, "lineno", function.lineno))
            params.append(Param(argument.arg, SOCKETS[index],
                                _annotation_of(argument.annotation), default, has_default))
        return params

    def bind(self, sockets: dict, check: bool = True) -> dict:
        """Sockets a..l to parameter names, POSITIONALLY (spec 8.4)."""
        names = {}
        for param in self.params:
            if param.socket in sockets:
                value = sockets[param.socket]
                if value is None:                # connected, not produced yet
                    names[param.name] = Unknown(param.socket)
                    continue
                if check:      # spec 8.4: annotations are checked where the
                    self.check_annotation(param, value)      # value is known
                names[param.name] = wrap(value)
            elif param.has_default:
                names[param.name] = wrap(param.default)
            else:
                raise SafeFnError(
                    f"Safe Function: parameter '{param.name}' has no default and "
                    f"socket {param.socket} is not connected")
        return names

    def check_annotation(self, param: Param, value) -> None:
        annotation = param.annotation
        if annotation in (None, "ANY", "any"):
            return
        allowed = _ANNOTATION_SCALARS.get(annotation)
        if allowed is not None:
            if isinstance(value, allowed) and not (isinstance(value, bool)
                                                   and bool not in allowed):
                return
        elif _kind_name(value) == annotation:
            return
        raise SafeFnError(
            f"Safe Function: parameter '{param.name}' is annotated {annotation} "
            f"but socket {param.socket} carries {_kind_name(value)}")

    def plan(self, sockets: dict) -> list[str]:
        """The sockets check_lazy_status still needs, one at a time."""
        try:
            names = self.bind(sockets, check=False)
            self._run(names, planning=True)
        except NeedsInput as need:
            return [need.socket]
        return []

    def execute(self, sockets: dict):
        return self._run(self.bind(sockets), planning=False)

    def _run(self, names, planning):
        budget = Budget(self.limits)
        evaluator = _Interp(names, budget, planning)
        outcome = _Block(evaluator).run(self.tree.body)
        value = outcome[1] if outcome and outcome[0] is _RETURN else None
        unknown = _unresolved(value)
        if unknown is not None and not (planning and unknown.transform):
            # a returned transform result is a finished plan, not a request
            _stop(unknown, self.tree.body[-1].lineno, planning)
        return value, budget


def _stop(unknown: Unknown, line, planning):
    """An Unknown reached a place that has to know: ask for it, or refuse."""
    if unknown.transform:
        raise _rejected(line, f"transform used in a branch decision; {unknown.name}() "
                              f"does not run while the inputs are being planned")
    if planning:
        raise NeedsInput(unknown.socket)
    raise _failed(line, f"socket {unknown.socket} was never resolved")


def _unresolved(value):
    """The Unknown inside a returned value, containers and Refs included.

    A flat ``isinstance`` test on the top-level value lets ``return [a, b]``
    hand core a list of interpreter sentinels with their ``.socket``
    attribute attached, and planning then asks for nothing. Spec 8.4: the
    value handed back is fully resolved, so the check walks. An unresolved
    socket outranks a transform, since it is the actionable one, and the
    walk is breadth-first so sockets are asked for in the order they appear.

    The walk needs no depth limit: ``seen`` makes shared and repeated
    containers cost once, and every container the interpreter can build was
    charged against max_collection on the way in.
    """
    best, queue, seen = None, deque([value]), set()
    while queue:
        item = capabilities.unref(queue.popleft())
        if isinstance(item, Unknown):
            best = item if best is None else best._keep(item)
            continue
        if isinstance(item, (list, tuple)) and id(item) not in seen:
            seen.add(id(item))
            queue.extend(item)
    return best


def _elements(value) -> int:
    """What a sequence operation costs against max_collection.

    Characters and sequence elements only. Charging tensors here too was
    measured to make the transform pack unusable at its own default: one
    ``image.flip`` on a 64x64x3 image is 12288 elements against a collection
    ceiling of 10000. Two resources, two units, two budgets (spec 8.2).
    """
    if isinstance(value, (str, list, tuple)):
        return len(value)
    return 0


def _tensor_elements(value) -> int:
    """What a transform result costs against max_tensor_elements.

    A ``Ref`` was charged against nothing at all before this budget existed,
    so 120 retained tensors read as 120 elements while they held 1.4 GB. A
    tensor costs its ``numel()``, a sequence its length, and anything opaque
    costs nothing because nothing is known.
    """
    if not isinstance(value, Ref):
        return 0
    raw = value.value
    if isinstance(raw, dict):
        raw = raw.get("samples")
    numel = getattr(raw, "numel", None)
    if callable(numel):
        try:
            return int(numel())
        except Exception:
            return 0
    if isinstance(raw, (str, list, tuple)):
        return len(raw)
    return 0


_ALLOCATING = (ast.BinOp, ast.Call, ast.Tuple, ast.List)


def _unknown_in(values):
    for value in values:
        if isinstance(value, Unknown):
            return value
    return None


def _wrapped(value):
    """wrap(), except that an Unknown stays an Unknown.

    ``wrap`` turns anything non-scalar into a ``Ref``, so wrapping a loop
    item hid the sentinel inside one: ``for i in [a]: return i`` returned a
    Ref carrying an Unknown, and every later operation on ``i`` saw a
    truthy object instead of raising the truth-value stop.
    """
    return value if isinstance(value, Unknown) else wrap(value)


class _Interp(_Eval):
    """flow.expr's evaluator plus budgets, Unknown, and planning-mode calls."""
    def __init__(self, names, budget: Budget, planning: bool):
        super().__init__(names)
        self.budget = budget
        self.planning = planning

    def run(self, node):
        line = getattr(node, "lineno", 0)
        self.budget.spend("max_ops", line)
        if isinstance(node, ast.Call):
            value = self._call(node, line)
        elif isinstance(node, ast.Subscript):
            value = self._subscript(node)
        else:
            value = super().run(node)
        if isinstance(node, _ALLOCATING):
            # a running total per resource: a loop can repeat a sub-limit
            # allocation a thousand times and expr's per-operation guard
            # would allow every one of them
            size = _elements(value)
            if size:
                self.budget.spend("max_collection", line, size)
            size = _tensor_elements(value)
            if size:
                self.budget.spend("max_tensor_elements", line, size)
        return value

    def _call(self, node, line):
        name = node.func.id if isinstance(node.func, ast.Name) else dotted_name(node.func)
        cap = capabilities.resolve(name)
        if cap is None:
            raise ExprError(f"'{name}' is not a registered capability")
        problem = capabilities.unavailable(cap)
        if problem:
            raise ExprError(problem)
        args = [self.run(a) for a in node.args]
        unknown = _unknown_in(args)
        if unknown is not None:
            return unknown
        if self.planning and not cap.predicate_safe:
            return Unknown(transform=True, name=name)   # planning is pure
        # reserve BEFORE the allocation, not account for it after: the running
        # total below bounds accumulation, and this bounds one call
        capabilities.check_peak(cap, args)
        self.budget.spend("max_calls", line)
        try:
            return cap.fn(*args)
        except ExprError:
            raise
        except Exception as e:
            raise ExprError(f"{name}(): {type(e).__name__}: {e}") from None

    def _subscript(self, node):
        # expr's rules plus the Unknown cases: without them latent.shape(a)[0]
        # would fail planning instead of asking for a
        sequence, index = self.run(node.value), self.run(node.slice)
        unknown = _unknown_in((sequence, index))
        if unknown is not None:
            return unknown
        if not isinstance(sequence, (list, tuple)):
            raise ExprError("subscripted value is not a sequence")
        if not isinstance(index, int) or isinstance(index, bool):
            raise ExprError("subscript index must be an integer")
        try:
            return sequence[index]
        except IndexError:
            raise ExprError(
                f"index {index} is out of range for a sequence of {len(sequence)}") from None


_RETURN, _BREAK, _CONTINUE = "return", ("break", None), ("continue", None)


class _Block:
    """Executes statements. Returns a signal tuple, or None to fall through."""
    def __init__(self, evaluator: _Interp):
        self.ev = evaluator

    def run(self, statements):
        for node in statements:
            signal = self.statement(node)
            if signal is not None:
                return signal
        return None

    def statement(self, node):
        line = getattr(node, "lineno", 0)
        self.ev.budget.spend("max_ops", line)
        if isinstance(node, ast.Assign):
            self.ev.names[node.targets[0].id] = self.value(node.value, line)
        elif isinstance(node, ast.AugAssign):
            self.ev.names[node.target.id] = self.combine(node, line)
        elif isinstance(node, ast.If):
            branch = node.body if self.truth(node.test, line) else node.orelse
            return self.run(branch) if branch else None
        elif isinstance(node, ast.For):
            return self.loop(node, line)
        elif isinstance(node, ast.Return):
            return (_RETURN, self.value(node.value, line) if node.value is not None else None)
        elif isinstance(node, ast.Break):
            return _BREAK
        elif isinstance(node, ast.Continue):
            return _CONTINUE
        return None                 # Pass, docstring, assignment

    def loop(self, node, line):
        items = self.iterable(node.iter, line)
        if isinstance(items, Unknown):
            _stop(items, line, self.ev.planning)
        for item in items:
            self.ev.budget.spend("max_iterations", line)
            self.ev.names[node.target.id] = _wrapped(item)
            signal = self.run(node.body)
            if signal is None or signal is _CONTINUE:
                continue
            if signal is _BREAK:
                break
            return signal
        return None

    def iterable(self, node, line):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "range":
            args = [self.value(a, line) for a in node.args]
            unknown = _unknown_in(args)
            if unknown is not None:
                return unknown
            for argument in args:
                if not isinstance(argument, int) or isinstance(argument, bool):
                    raise _failed(line, f"range takes whole numbers, got {argument!r}")
            return range(*args)
        value = self.value(node, line)
        if isinstance(value, Unknown):
            return value
        value = capabilities.unref(value)
        if isinstance(value, (list, tuple, range)):
            return value
        raise _failed(line, "for iterates range(n), a list, a tuple, or a capability "
                            f"that returns one, not {type(value).__name__}")

    def value(self, node, line):
        return self._guarded(lambda: self.ev.run(node), getattr(node, "lineno", line))

    def combine(self, node, line):
        """x += 1, through the same safe operators as x = x + 1.

        The name is known bound by the validator, and an Unknown on either
        side stays Unknown through the operator's own dunders.
        """
        left = self.ev.names[node.target.id]
        right = self.value(node.value, line)
        return self._guarded(lambda: _BINOPS[type(node.op)](left, right),
                             getattr(node, "lineno", line))

    def _guarded(self, produce, line):
        try:
            return produce()
        except _UnknownTruth as unknown:
            # a truth value inside an expression: the whole expression is Unknown
            return unknown.unknown
        except (SafeFnError, NeedsInput):
            raise                       # a budget stop and a plan request are not failures
        except ExprError as e:
            raise _failed(line, str(e)) from None
        except Exception as e:
            # `return 1 / 0` and `return 'ab' * 2.5` left as a bare
            # ZeroDivisionError / TypeError, with no line and no source
            raise _failed(line, f"{type(e).__name__}: {e}") from None

    def truth(self, node, line):
        outcome = self.value(node, line)
        if isinstance(outcome, Unknown):
            _stop(outcome, getattr(node, "lineno", line), self.ev.planning)
        return bool(outcome)
