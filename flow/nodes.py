"""Flow control nodes: Gate, Condition, Lazy Select, Filter, Partition, Probe.

Phase 1 of docs/FLOW_CONTROL_SPEC.md. Nothing here duplicates a core node:
core already has If/Else Switch, Soft Switch, Math Expression and the
boolean glue. What core lacks is predicates over data rather than widget
scalars, a fused "process if" with passthrough, N-way lazy dispatch, list
Filter / Partition, and a way to count executions from outside the server.

Laziness is core's: an input marked lazy is only produced when
``check_lazy_status`` asks for it by name, and the producers that only that
input depends on never run. The trap that costs people the saving is a
second consumer (a preview, a save) on the guarded branch, which makes it
required again. Flow Probe exists so that is counted rather than guessed.
"""
from __future__ import annotations

import ast
import hashlib
import os
import string
import time

import torch

import folder_paths
from comfy_api.latest import io
from comfy_execution.graph_utils import ExecutionBlocker, is_link

from . import capabilities  # noqa: F401  (registers the v1 capability packs)
from . import policy, safefn
from .expr import (ExprError, describe, dotted_name, evaluate, validate,
                   wrap)

MISSING = object()          # not connected, as core's Soft Switch uses it
CATEGORY = "MAINodes/Flow"


def _autogrow(values, *, tuples=False, unlist=False) -> tuple[dict, dict]:
    """Normalise one Autogrow argument into {name: value}, {name: prompt_key}.

    Three shapes arrive at the same argument: the plain dict in ``execute``,
    ``(value, original_key)`` pairs in ``check_lazy_status`` (core sets
    create_dynamic_tuple so a lazy request can name the real input), and
    one-element lists on an is_input_list node.
    """
    out: dict = {}
    keys: dict = {}
    # an OPTIONAL Autogrow with nothing grown reaches check_lazy_status as the
    # dynamic tuple itself, (None, "values"), not as a dict of them
    if tuples and isinstance(values, tuple) and len(values) == 2 and isinstance(values[1], str):
        values = values[0]
    if not isinstance(values, dict):
        values = {}
    for name, value in values.items():
        key = name
        if tuples and isinstance(value, tuple) and len(value) == 2 and isinstance(value[1], str):
            value, key = value
        if unlist and isinstance(value, list):
            value = value[0] if value else None
        out[name] = value
        keys[name] = key
    return out, keys


def _first(value):
    """First item of an is_input_list argument."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _bind(values: dict, extra: dict | None = None) -> dict:
    names = {k: wrap(v) for k, v in values.items()}
    if extra:
        names.update({k: wrap(v) for k, v in extra.items()})
    return names


def _report(values: dict) -> dict:
    return {k: describe(v) for k, v in values.items()}


def _evaluate(expression, names, tree=None):
    """evaluate(), with a Python-level failure reported the way a refusal is.

    Safe Function wraps these into "failed at line N: ZeroDivisionError: ..."
    and has a test for it; these four nodes called the same evaluator bare, so
    `1 / 0` in a Gate raised ZeroDivisionError out of check_lazy_status while
    the identical expression inside a Safe Function said what happened. A
    capability's own failure was already wrapped; an operator's was not.
    """
    try:
        return evaluate(expression, names, tree=tree)
    except ExprError:
        raise
    except Exception as e:
        raise ExprError(f"{type(e).__name__}: {e}") from None


def _syntax_check(expression):
    """validate_inputs body: syntax, limits and capability names at queue time.

    Name binding is not checked here because the grown value inputs are
    links, so their names are known to the prompt but their values are not.
    """
    expression = _first(expression)
    if expression is None:
        return True
    try:
        validate(expression)
        # a transform is not a predicate: these four nodes decide a branch,
        # and a decision has to be cheap enough to make while planning
        _predicate_check(expression)
    except ExprError as e:
        return f"expression: {e}"
    return True


def _any_values_template(minimum: int = 1) -> io.Autogrow.TemplateNames:
    return io.Autogrow.TemplateNames(
        input=io.AnyType.Input("value"), names=list(string.ascii_lowercase), min=minimum)


def _is_link(value) -> bool:
    """Core's own test: [node_id, output_index]. A two-string list is a widget."""
    return is_link(value)


def _value_names(tree) -> set:
    """Names an expression reads as VALUES: never the callee of a call.

    ast.walk would collect `image` out of `image.width(a)`, and `image` is a
    registry prefix, not a value; the evaluator resolves callees against the
    registry and never against the bound names (expr._check_call walks only
    node.args for the same reason).
    """
    names = set()
    def walk(node):
        if isinstance(node, ast.Name):
            names.add(node.id)
            return
        if isinstance(node, ast.Call):
            for arg in node.args:
                walk(arg)
            return
        for child in ast.iter_child_nodes(node):
            walk(child)
    walk(tree.body)
    return names


class MAIFlowGate(io.ComfyNode):
    """processed if expression else source, with the untaken side never run.

    The expression may name the guarded node's own widgets. The guarded node
    is whatever produces `processed`; its inline inputs are read out of the
    prompt by their real names (`scale_by != 1.0`), so "run Resize when scale
    is not 1" is one node and no widget has to become a link. The read is
    cache-correct with no fingerprint at all: the guarded node is an ancestor
    of this one through `processed`, and core folds every ancestor's literal
    inputs into the descendant's cache key (comfy_execution/caching.py,
    get_node_signature), walking lazy links like any other. Measured on core
    0.33.0, spec 15 probe 5.

    `source` left unconnected turns a false expression into a block: the node
    emits core's ExecutionBlocker and everything downstream, output nodes
    included, is skipped silently (execution.py, graph_utils.py:140). That is
    "Skip when" on a Save. Spec 15 probe 6.
    """

    @classmethod
    def define_schema(cls):
        t = io.MatchType.Template("gate")
        return io.Schema(
            node_id="MAIFlowGate",
            display_name="Gate (process if)",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["if", "conditional", "process if", "skip", "branch",
                            "bypass when", "run when"],
            description=("Runs the processed branch only when the expression is true, "
                         "otherwise passes source through, or blocks everything "
                         "downstream if source is not connected. Both branches are "
                         "lazy, so the untaken one never executes. The expression can "
                         "name the widgets of the node feeding processed, and any "
                         "value connected to a, b, ..."),
            inputs=[
                io.String.Input("expression", default="a != 1.0", multiline=True),
                io.MatchType.Input("processed", template=t, lazy=True),
                io.MatchType.Input("source", template=t, lazy=True, optional=True,
                                   tooltip="passed through when the expression is false; "
                                           "leave it unconnected to block everything "
                                           "downstream instead"),
                io.Autogrow.Input("values", template=_any_values_template(minimum=0),
                                  optional=True),
            ],
            outputs=[io.MatchType.Output(template=t, display_name="result")],
            hidden=[io.Hidden.dynprompt, io.Hidden.unique_id],
        )

    @classmethod
    def validate_inputs(cls, expression=None, values=None):
        # `values` must be in the signature even though it is unused: core
        # rebuilds the Autogrow dict for any node whose validate_inputs is
        # called, and an unexpected keyword is a validation exception. The
        # guarded node's widgets are not visible here (no dynprompt at queue
        # time), so name binding waits for the execute path like values do.
        return _syntax_check(expression)

    @classmethod
    def _guarded(cls):
        """(class_type, inline inputs, linked input names) of the node on `processed`.

        None when there is no prompt to read (a direct call outside a run).
        DYNPROMPT rather than PROMPT so a Gate inside an expanded subgraph
        still finds its neighbour.
        """
        hidden = getattr(cls, "hidden", None)
        dynprompt = getattr(hidden, "dynprompt", None)
        me = getattr(hidden, "unique_id", None)
        if dynprompt is None or me is None or not dynprompt.has_node(me):
            return None
        link = dynprompt.get_node(me).get("inputs", {}).get("processed")
        if not _is_link(link) or not dynprompt.has_node(link[0]):
            return None
        guarded = dynprompt.get_node(link[0])
        inputs = guarded.get("inputs", {}) or {}
        inline = {k: v for k, v in inputs.items() if not _is_link(v)}
        linked = sorted(k for k, v in inputs.items() if _is_link(v))
        return guarded.get("class_type", "?"), inline, linked

    @classmethod
    def _names(cls, expression, values: dict):
        """Bind: connected values first, then the guarded node's inline widgets.

        A widget that is itself a link cannot be read from the prompt, and
        saying so by name beats a bare "not bound": the fix is to connect the
        same source to the Gate. The guarded node is the DIRECT producer of
        `processed`; a probe or a reroute in between is what gets read, so
        the message names what it found.
        """
        wanted = _value_names(validate(expression))
        names, widgets = dict(values), {}
        guarded = cls._guarded()
        if guarded is None:
            return names, widgets, None
        class_type, inline, linked = guarded
        for name in sorted(wanted - set(names)):
            if name in inline:
                widgets[name] = inline[name]
            elif name in linked:
                raise ExprError(
                    f"'{name}' is a widget on {class_type} that arrives on a link; connect "
                    f"that value to the Gate's a, b, ... instead")
            elif capabilities.resolve(name) is None:
                raise ExprError(
                    f"name '{name}' is neither a connected value nor a widget on "
                    f"{class_type}, the node feeding processed; its widgets are "
                    f"{sorted(inline)}")
        names.update(widgets)
        return names, widgets, class_type

    @classmethod
    def _decide(cls, expression, values):
        expression = _first(expression)
        # not validate-only: an expression that arrives on a LINK reaches
        # validate_inputs as None, and check_lazy_status runs this more than
        # once per node, so a transform here runs several times per queue
        _predicate_check(expression)
        names, widgets, class_type = cls._names(expression, values)
        return bool(_evaluate(expression, _bind(names))), widgets, class_type

    @classmethod
    def check_lazy_status(cls, expression, processed=None, source=MISSING, values=None):
        resolved, _ = _autogrow(values, tuples=True)
        took, _, _ = cls._decide(expression, resolved)
        if took:
            return ["processed"] if processed is None else []
        if source is None:                 # connected and not produced yet
            return ["source"]
        return []                          # produced, or not connected at all

    @classmethod
    def execute(cls, expression, processed=None, source=MISSING, values=None) -> io.NodeOutput:
        resolved, _ = _autogrow(values)
        took, widgets, class_type = cls._decide(expression, resolved)
        if took:
            outcome, value = "processed", processed
        elif source is MISSING:
            outcome, value = "blocked", ExecutionBlocker(None)
        else:
            outcome, value = "source", source
        ui = {"flow": [{"node": "Gate", "took": outcome, "expression": expression,
                        "values": _report(resolved), "widgets": _report(widgets),
                        "guarded": class_type}]}
        return io.NodeOutput(value, ui=ui)


class MAIFlowCondition(io.ComfyNode):
    """One expression, four scalar forms, for feeding core's logic nodes."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowCondition",
            display_name="Condition",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["predicate", "expression", "boolean", "test"],
            description=("Evaluates a flow expression over connected values and reports it as "
                         "BOOL, FLOAT, INT and STRING. Same language as Gate, and a superset "
                         "of core's Math Expression."),
            inputs=[
                io.String.Input("expression", default="a != 1.0", multiline=True),
                io.Autogrow.Input("values", template=_any_values_template()),
            ],
            outputs=[
                io.Boolean.Output(display_name="BOOL"),
                io.Float.Output(display_name="FLOAT"),
                io.Int.Output(display_name="INT"),
                io.String.Output(display_name="STRING"),
            ],
        )

    @classmethod
    def validate_inputs(cls, expression=None, values=None):
        # `values` must be in the signature even though it is unused: core
        # rebuilds the Autogrow dict for any node whose validate_inputs is
        # called, and an unexpected keyword is a validation exception.
        return _syntax_check(expression)

    @classmethod
    def execute(cls, expression, values=None) -> io.NodeOutput:
        resolved, _ = _autogrow(values)
        expression = _first(expression)
        _predicate_check(expression)        # see MAIFlowGate._decide
        result = _evaluate(expression, _bind(resolved))
        try:
            as_float = float(result)
        except (TypeError, ValueError):
            as_float = 0.0
        try:
            as_int = int(result)
        except (TypeError, ValueError):
            as_int = 0
        ui = {"flow": [{"node": "Condition", "result": describe(result),
                        "expression": expression, "values": _report(resolved)}]}
        return io.NodeOutput(bool(result), as_float, as_int, str(result), ui=ui)


class MAIFlowSelect(io.ComfyNode):
    """N-way lazy dispatch: only the selected case is ever produced.

    Fixed slots, not Autogrow. An Autogrow template does carry lazy=True
    into every grown slot, but the executor decides laziness from the
    UNEXPANDED INPUT_TYPES (comfy_execution/graph.py:118 and :159), where a
    grown name such as "cases.case_0" does not exist, so every grown slot
    would get a strong link and every case would run. Measured on core
    0.33.0; see FLOW.md. Eight fixed MatchType slots keep the laziness,
    which is the whole point of the node.
    """

    MAX_CASES = 8

    @classmethod
    def define_schema(cls):
        t = io.MatchType.Template("select")
        cases = [io.MatchType.Input(f"case_{i}", template=t, lazy=True, optional=True)
                 for i in range(cls.MAX_CASES)]
        return io.Schema(
            node_id="MAIFlowSelect",
            display_name="Lazy Select",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["switch", "case", "dispatch", "multiplex", "index"],
            description=("Picks one case by index or by label. Every case is lazy, so the "
                         "unselected cases and their exclusive producers never execute."),
            inputs=[
                io.MultiType.Input(io.Int.Input("selector", default=0, min=0,
                                                max=cls.MAX_CASES - 1), [io.String]),
                io.String.Input("labels", default="", optional=True,
                                tooltip="optional comma separated case names, in slot order"),
                *cases,
                io.MatchType.Input("default", template=t, lazy=True, optional=True),
            ],
            outputs=[io.MatchType.Output(template=t, display_name="result")],
        )

    @classmethod
    def _index(cls, selector, labels):
        names = [s.strip() for s in (labels or "").split(",") if s.strip()]
        if isinstance(selector, str):
            if selector in names:
                return names.index(selector)
            if selector.strip().lstrip("-").isdigit():
                return int(selector.strip())
            raise ValueError(
                f"Lazy Select: selector {selector!r} is not one of the labels {names}")
        return int(selector)

    @classmethod
    def _pick(cls, selector, labels, cases, default):
        """The connected case for this selector, or 'default', naming the miss."""
        name = f"case_{cls._index(selector, labels)}"
        if cases.get(name, MISSING) is not MISSING:
            return name
        if default is MISSING:
            raise ValueError(
                f"Lazy Select: selector {selector!r} selects {name}, which is not connected, "
                f"and no default is connected either")
        return "default"

    @classmethod
    def check_lazy_status(cls, selector, labels="", default=MISSING, **cases):
        name = cls._pick(selector, labels, cases, default)
        value = default if name == "default" else cases[name]
        return [name] if value is None else []

    @classmethod
    def execute(cls, selector, labels="", default=MISSING, **cases) -> io.NodeOutput:
        name = cls._pick(selector, labels, cases, default)
        value = default if name == "default" else cases[name]
        ui = {"flow": [{"node": "Select", "took": name, "selector": describe(selector),
                        "labels": labels,
                        "cases": sorted(k for k, v in cases.items() if v is not MISSING)}]}
        return io.NodeOutput(value, ui=ui)


class _ListNode(io.ComfyNode):
    """Shared per-item evaluation for Filter and Partition."""

    @classmethod
    def validate_inputs(cls, expression=None, values=None):
        # `values` must be in the signature even though it is unused: core
        # rebuilds the Autogrow dict for any node whose validate_inputs is
        # called, and an unexpected keyword is a validation exception.
        return _syntax_check(expression)

    @classmethod
    def _split(cls, items, expression, values):
        expression = _first(expression)
        _predicate_check(expression)        # see MAIFlowGate._decide: a linked
        resolved, _ = _autogrow(values, unlist=True)     # expression skips validate
        items = list(items or [])
        tree = validate(expression)
        kept, rejected = [], []
        for index, item in enumerate(items):
            names = _bind(resolved, {"item": item, "index": index, "count": len(items)})
            (kept if _evaluate(expression, names, tree=tree) else rejected).append(item)
        return kept, rejected, resolved, expression


def _list_inputs(expression_default: str):
    return [
        io.AnyType.Input("items"),
        io.String.Input("expression", default=expression_default, multiline=True),
        io.Autogrow.Input("values", template=_any_values_template(minimum=0), optional=True),
    ]


class MAIFlowFilter(_ListNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowFilter",
            display_name="Filter (list)",
            category=CATEGORY,
            is_experimental=True,
            is_input_list=True,
            search_aliases=["where", "select items", "list filter"],
            description=("Keeps the list items whose expression is true. The expression sees "
                         "item, index and count, plus any connected values."),
            inputs=_list_inputs("item > 0"),
            outputs=[
                io.AnyType.Output(display_name="kept", is_output_list=True),
                io.Int.Output(display_name="kept_count"),
            ],
        )

    @classmethod
    def execute(cls, items=None, expression=None, values=None) -> io.NodeOutput:
        kept, rejected, resolved, expression = cls._split(items, expression, values)
        ui = {"flow": [{"node": "Filter", "expression": expression,
                        "kept_count": len(kept), "rejected_count": len(rejected),
                        "values": _report(resolved)}]}
        return io.NodeOutput(kept, len(kept), ui=ui)


class MAIFlowPartition(_ListNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowPartition",
            display_name="Partition (list)",
            category=CATEGORY,
            is_experimental=True,
            is_input_list=True,
            search_aliases=["split list", "kept rejected", "list partition"],
            description=("Splits a list into kept and rejected by the expression. Feed the "
                         "expensive branch only kept, and guard that branch with a Gate on "
                         "kept_count > 0: an empty list does not map zero times."),
            inputs=_list_inputs("item > 0"),
            outputs=[
                io.AnyType.Output(display_name="kept", is_output_list=True),
                io.AnyType.Output(display_name="rejected", is_output_list=True),
                io.Int.Output(display_name="kept_count"),
                io.Int.Output(display_name="rejected_count"),
            ],
        )

    @classmethod
    def execute(cls, items=None, expression=None, values=None) -> io.NodeOutput:
        kept, rejected, resolved, expression = cls._split(items, expression, values)
        ui = {"flow": [{"node": "Partition", "expression": expression,
                        "kept_count": len(kept), "rejected_count": len(rejected),
                        "values": _report(resolved)}]}
        return io.NodeOutput(kept, rejected, len(kept), len(rejected), ui=ui)


def _digest(value) -> str:
    h = hashlib.sha1()
    if isinstance(value, torch.Tensor):
        h.update(value.detach().to("cpu").contiguous().numpy().tobytes())
    elif isinstance(value, dict) and isinstance(value.get("samples"), torch.Tensor):
        h.update(value["samples"].detach().to("cpu").contiguous().numpy().tobytes())
    else:
        h.update(repr(value).encode("utf-8", "replace"))
    return h.hexdigest()


class MAIFlowProbe(io.ComfyNode):
    """Passthrough that records one line per execution, for counting runs."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowProbe",
            display_name="Flow Probe",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["count", "debug", "instrument", "did this run"],
            description=("Passes its value through unchanged and appends one line to "
                         "<output>/flow_probe/<name>.count. Vary salt to defeat the result "
                         "cache when you want a second execution to be counted."),
            inputs=[
                io.AnyType.Input("value"),
                io.String.Input("name", default="probe"),
                io.Int.Input("salt", default=0, min=0, max=0xFFFFFFFF),
                io.Float.Input("delay_s", default=0.0, min=0.0, max=600.0, step=0.01),
            ],
            outputs=[io.AnyType.Output(display_name="value")],
        )

    @classmethod
    def execute(cls, value=None, name="probe", salt=0, delay_s=0.0) -> io.NodeOutput:
        # [:64]: the sanitizer kept every legal character, so a 500 character
        # name became a 500 character filename and NAME_MAX is 255
        safe = "".join(c for c in str(name) if c.isalnum() or c in "-_.")[:64] or "probe"
        directory = os.path.join(folder_paths.get_output_directory(), "flow_probe")
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"{safe}.count")
        digest = _digest(value)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{int(salt)}\t{digest}\n")
        with open(path, "r", encoding="utf-8") as fh:
            count = sum(1 for line in fh if line.strip())
        if delay_s:
            time.sleep(float(delay_s))
        ui = {"flow_probe": [{"name": safe, "count": count, "digest": digest}]}
        return io.NodeOutput(value, ui=ui)


class MAIFlowSafeFunction(io.ComfyNode):
    """A restricted Python-like function whose inputs are planned by itself.

    Twelve FIXED lazy sockets, not Autogrow: the executor reads laziness from
    the unexpanded INPUT_TYPES (comfy_execution/graph.py:118 and :159), so a
    grown slot is always a strong link and every input would resolve before
    the body ran, which is the one thing this node exists not to do.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowSafeFunction",
            display_name="Safe Function",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["python", "script", "function", "def main", "code"],
            description=("Runs a restricted Python-like function. Parameters bind to the "
                         "sockets positionally: the first parameter reads a, the second b, "
                         "and so on. Sockets are lazy, so a socket the body never reaches "
                         "is never produced."),
            inputs=[
                io.String.Input("source", default=safefn.DEFAULT_SOURCE, multiline=True),
                *[io.AnyType.Input(name, lazy=True, optional=True,
                                   tooltip=f"parameter {index + 1}")
                  for index, name in enumerate(safefn.SOCKETS)],
                # min=1: zero is refused at queue time, so the editor must not
                # offer it. A new budget is APPENDED, never inserted (spec 10),
                # or every saved workflow shifts one widget slot
                io.Int.Input("max_iterations", default=1000, min=1, max=100_000_000),
                io.Int.Input("max_ops", default=50000, min=1, max=100_000_000),
                io.Int.Input("max_calls", default=5000, min=1, max=100_000_000),
                io.Int.Input("max_collection", default=10000, min=1, max=100_000_000),
                io.Int.Input("max_tensor_elements", default=100_000_000, min=1,
                             max=1_000_000_000),
            ],
            outputs=[io.AnyType.Output(display_name="result")],
        )

    @classmethod
    def _compile(cls, source, max_iterations, max_ops, max_calls,
                 max_collection, max_tensor_elements) -> safefn.Function:
        # the hosting off switch (spec 8.5) lives where validate_inputs,
        # check_lazy_status and execute all pass, so no path is exempt
        if not policy.safe_function_enabled():
            raise safefn.SafeFnError(
                'Safe Function is disabled by flow_policy.json ("safe_function": false)')
        return safefn.Function(source, safefn.limits(max_iterations, max_ops,
                                                     max_calls, max_collection,
                                                     max_tensor_elements))

    @classmethod
    def validate_inputs(cls, source=None, max_iterations=None, max_ops=None,
                        max_calls=None, max_collection=None,
                        max_tensor_elements=None, **_ignored):
        # **_ignored: core re-adds arguments this method does not name (the
        # nested Autogrow dict among them) after filtering by argspec.
        for field, value in (("max_iterations", max_iterations), ("max_ops", max_ops),
                             ("max_calls", max_calls),
                             ("max_collection", max_collection),
                             ("max_tensor_elements", max_tensor_elements)):
            problem = policy.check_positive(field, value) if value is not None else None
            if problem:
                return problem
        try:
            function = cls._compile(source, max_iterations, max_ops, max_calls,
                                    max_collection, max_tensor_elements)
        except (safefn.SafeFnError, policy.PolicyError) as e:
            # PolicyError: the installation file exists and cannot be honoured,
            # so this node is off until it is fixed. Say so at queue time.
            return str(e)
        for param in function.params:
            value = _ignored.get(param.socket)
            if value is None or isinstance(value, (list, dict)):
                continue            # a link, or absent: checked at execute
            try:
                function.check_annotation(param, value)
            except safefn.SafeFnError as e:
                return str(e)
        return True

    @classmethod
    def check_lazy_status(cls, source, max_iterations=1000, max_ops=50000,
                          max_calls=5000, max_collection=10000,
                          max_tensor_elements=100_000_000, **sockets) -> list[str]:
        function = cls._compile(source, max_iterations, max_ops, max_calls,
                                max_collection, max_tensor_elements)
        return function.plan(sockets)

    @classmethod
    def execute(cls, source, max_iterations=1000, max_ops=50000, max_calls=5000,
                max_collection=10000, max_tensor_elements=100_000_000,
                **sockets) -> io.NodeOutput:
        function = cls._compile(source, max_iterations, max_ops, max_calls,
                                max_collection, max_tensor_elements)
        value, budget = function.execute(sockets)
        ui = {"flow": [{"node": "Safe Function",
                        "result": describe(capabilities.unref_deep(value)),
                        "signature": [f"{p.socket}={p.name}:{p.annotation or 'ANY'}"
                                      for p in function.params],
                        "used": dict(budget.used),
                        "sockets": sorted(k for k, v in sockets.items() if v is not None)}]}
        # unref_deep, not unref: `return [x, y]` otherwise hands the graph a
        # list of interpreter Ref wrappers instead of images (spec 8.4)
        return io.NodeOutput(capabilities.unref_deep(value), ui=ui)


def _predicate_check(source: str) -> None:
    """Refuse a transform inside a Gate / Condition / Filter / Partition.

    Those nodes decide a branch, and a decision has to be cheap and pure
    enough to make while planning (spec 5.3, 8.3).
    """
    if not isinstance(source, str):
        return                      # absent; evaluate() reports it as empty
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError:
        return                      # validate() reports the syntax error
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.id if isinstance(node.func, ast.Name) else dotted_name(node.func)
        cap = capabilities.resolve(name)
        if cap is not None and not cap.predicate_safe:
            raise ExprError(f"{name} is a transform; not available in a condition")
