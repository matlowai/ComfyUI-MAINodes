"""Safe Function: the language, the refusals, the budgets, the planner.

No server; this file is what keeps the interpreter small enough to audit.
    PYTHONPATH=/mnt/work/ai/apps/ComfyUI python -m pytest tests/flow/test_safefn.py -q
"""
import json
import os
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)

from flow import capabilities, policy, safefn  # noqa: E402
from flow.expr import ExprError, Ref  # noqa: E402
from flow.safefn import Function, SafeFnError  # noqa: E402


def body(*lines, params="x"):
    return f"def main({params}):\n" + "".join(f"    {line}\n" for line in lines)


@pytest.fixture(autouse=True, scope="module")
def transforms_enabled(tmp_path_factory):
    """The transform pack is OFF by default (spec 5.3, 8.5).

    These tests turn it on the way an installation would, with a policy file,
    so the interpreter under test is the one a user who enabled the pack gets.
    test_a_transform_is_refused_until_its_pack_is_enabled covers the default.
    """
    path = tmp_path_factory.mktemp("policy") / "flow_policy.json"
    path.write_text(json.dumps({"enable_packs": ["transforms"]}))
    old = os.environ.get(policy.POLICY_ENV)
    os.environ[policy.POLICY_ENV] = str(path)
    yield
    if old is None:
        os.environ.pop(policy.POLICY_ENV, None)
    else:
        os.environ[policy.POLICY_ENV] = old


def compile_it(source, **budgets):
    return Function(source, safefn.limits(**budgets) if budgets else safefn.limits())


# --- Gate E: the section 8.5 list, every line of it -------------------------

REFUSED = [
    ("import os", "import is not available"),
    ('open("/etc/passwd")', "'open' is not a registered capability"),
    ('__import__("requests")', "name '__import__' contains '__'"),
    ('getattr(x, "__class__")', "'getattr' is not a registered capability"),
    ("x.__class__", "attribute access on values is not available"),
    ('eval("1+1")', "'eval' is not a registered capability"),
    ('exec("...")', "'exec' is not a registered capability"),
    ("subprocess.run(x)", "'subprocess.run' is not a registered capability"),
    ("socket.socket(x)", "'socket.socket' is not a registered capability"),
    ("(lambda: 0)()", "lambda is not available"),
    ("[i for i in range(10)]", "comprehensions are not available"),
]


@pytest.mark.parametrize("statement,expected", REFUSED, ids=[r[0] for r in REFUSED])
def test_gate_e_section_8_5_is_refused_with_a_policy_message(statement, expected):
    with pytest.raises(SafeFnError) as e:
        compile_it(body(statement))
    assert str(e.value).startswith("Safe Function rejected at line 2: "), str(e.value)
    assert expected in str(e.value), str(e.value)


MORE_REFUSED = [
    ("while x:\n        return x",
     "while is not available in Safe Function; use `for _ in range(limit):` with break"),
    ("from os import path", "import is not available"),
    ("class C:\n        pass", "class is not available"),
    ("def inner():\n        return 1", "nested functions are not available"),
    ("try:\n        return x\n    except:\n        return x", "try is not available"),
    ("raise x", "raise is not available"),
    ("with x:\n        return x", "with is not available"),
    ("global x", "global is not available"),
    ("del x", "del is not available"),
    ("assert x", "assert is not available"),
    ("y: INT = 1", "annotated assignment is not available"),
    # augmented assignment is allowed (spec 8.1), but not on a name that has
    # no value yet, not with an operator outside the expression allowlist,
    # and not onto a dunder name
    ("total += 1", "name 'total' is not bound yet"),
    ("x @= x", "MatMult is not available"),
    ("x |= 1", "BitOr is not available"),
    ("y__z = 1", "name 'y__z' contains '__'"),
    ("for i__j in [1, 2]:\n        return i__j", "name 'i__j' contains '__'"),
    ("yield x", "yield is not available"),
    ('f"{x}"', "f-strings are not available"),
    ("y = {1: 2}", "dict literals are not available"),
    # recursion: only main exists, and a call to it resolves like any unknown name
    ("return main(x)", "'main' is not a registered capability"),
    ("return range(4)", "'range' is not a registered capability"),
    ("for a, b in x:\n        return a", "the loop variable is one plain name"),
    ("a, b = x", "assign to one plain name"),
    ("break", "break is only available in a for loop"),
    ("continue", "continue is only available in a for loop"),
    ("sqrt(4.0)", "a bare expression does nothing"),
]


@pytest.mark.parametrize("statement,expected", MORE_REFUSED, ids=[r[0][:24] for r in MORE_REFUSED])
def test_statements_outside_the_language_are_refused(statement, expected):
    with pytest.raises(SafeFnError) as e:
        compile_it(body(statement))
    assert expected in str(e.value), str(e.value)


def test_while_carries_the_exact_replacement_advice():
    with pytest.raises(SafeFnError) as e:
        compile_it(body("while x:", "    return x"))
    assert str(e.value) == (
        "Safe Function rejected at line 2: while is not available in Safe "
        "Function; use `for _ in range(limit):` with break")


BAD_SIGNATURES = [
    ("x = 1\n", "exactly one function"),
    ("def other(x):\n    return x\n", "the function is named 'main', not 'other'"),
    ("@thing\ndef main(x):\n    return x\n", "decorators are not available"),
    ("def main(x):\n    return (\n", "Safe Function rejected at line "),
    ("def main(*args):\n    return 1\n", "plain and positional"),
    ("def main(" + ", ".join(f"p{i}" for i in range(13)) + "):\n    return p0\n",
     "at most 12 parameters (sockets a..l)"),
]


@pytest.mark.parametrize("source,expected", BAD_SIGNATURES,
                         ids=[str(i) for i in range(len(BAD_SIGNATURES))])
def test_the_source_is_one_function_named_main_with_plain_parameters(source, expected):
    with pytest.raises(SafeFnError) as e:
        compile_it(source)
    assert expected in str(e.value), str(e.value)


# --- binding, defaults, annotations ----------------------------------------

def test_parameters_bind_to_sockets_positionally():
    fn = compile_it(body("return [x, y, z]", params="x, y, z"))
    value, _ = fn.execute({"a": 1, "b": 2, "c": 3})
    assert value == [1, 2, 3]
    assert [(p.name, p.socket) for p in fn.params] == [("x", "a"), ("y", "b"), ("z", "c")]


def test_defaults_apply_when_a_socket_is_not_connected():
    fn = compile_it(body("return [x, y]", params="x, y = 7"))
    assert fn.execute({"a": 1})[0] == [1, 7]
    assert fn.execute({"a": 1, "b": 2})[0] == [1, 2]
    with pytest.raises(SafeFnError) as e:
        fn.execute({})
    assert "parameter 'x' has no default and socket a is not connected" in str(e.value)
    # a default is a literal, never a computation
    with pytest.raises(SafeFnError) as e:
        compile_it("def main(x = y):\n    return x\n")
    assert "default for 'x'" in str(e.value)


def test_annotation_mismatch_names_the_parameter_and_the_socket():
    fn = compile_it("def main(flag: BOOL, image: IMAGE):\n    return flag\n")
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 3, "b": Ref(object(), "IMAGE")})
    assert str(e.value) == ("Safe Function: parameter 'flag' is annotated BOOL "
                            "but socket a carries INT")
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": True, "b": "not an image"})
    assert str(e.value) == ("Safe Function: parameter 'image' is annotated IMAGE "
                            "but socket b carries STRING")
    # the shipped default function, with values that do match
    ok = compile_it(safefn.DEFAULT_SOURCE)
    image = Ref(_FakeTensor((1, 8, 8, 3)), "IMAGE")
    assert ok.execute({"a": image, "b": image, "c": False})[0] is image


class _FakeTensor:
    def __init__(self, shape):
        self.shape = tuple(shape)


# --- planning (spec 8.3) ---------------------------------------------------

def test_planning_asks_for_the_decision_then_only_the_taken_branch():
    fn = compile_it(safefn.DEFAULT_SOURCE)
    assert fn.plan({"a": None, "b": None, "c": None, "d": None}) == ["c"]
    assert fn.plan({"a": None, "b": None, "c": False, "d": 1.0}) == ["a"]
    assert fn.plan({"a": None, "b": None, "c": True, "d": 1.0}) == ["b"]
    # both resolved: nothing left to ask for
    image = Ref(_FakeTensor((1, 8, 8, 3)), "IMAGE")
    assert fn.plan({"a": image, "b": image, "c": True, "d": 1.0}) == []
    # planning does not check annotations; execute does (spec 8.4)
    assert fn.plan({"a": 1, "b": 2, "c": True, "d": 1.0}) == []


def test_a_for_break_search_returns_early_and_never_names_the_late_socket():
    fn = compile_it(body("for i in range(8):", "    if i == target:", "        return i",
                         "return fallback", params="target, values, fallback"))
    assert fn.plan({"a": None, "b": None, "c": None}) == ["a"]
    assert fn.plan({"a": 3, "b": None, "c": None}) == []
    assert fn.execute({"a": 3, "b": None, "c": None})[0] == 3
    # only the miss reaches the fallback, and only then is c requested
    assert fn.plan({"a": 99, "b": None, "c": None}) == ["c"]


def test_a_returned_unknown_is_a_request_not_a_result():
    fn = compile_it(body("return x"))
    assert fn.plan({"a": None}) == ["a"]
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": None})
    assert "socket a was never resolved" in str(e.value)


def test_a_predicate_capability_runs_during_planning_on_resolved_values():
    fn = compile_it(body("if image.width(x) > 100:", "    return y", "return x",
                         params="x, y"))
    wide = Ref(_FakeTensor((1, 8, 256, 3)), "IMAGE")
    narrow = Ref(_FakeTensor((1, 8, 16, 3)), "IMAGE")
    assert fn.plan({"a": wide, "b": None}) == ["b"]
    assert fn.plan({"a": narrow, "b": None}) == []


@pytest.fixture
def counted_transform():
    """A transform registered from the test, counting every real call."""
    calls = []

    def fn(value):
        calls.append(value)
        return f"transformed:{value}"

    # preflight is mandatory for an allocating capability, and register()
    # refusing this fixture without one is the invariant doing its job
    capabilities.register(capabilities.Capability(
        "test.count", 1, fn, (), "ANY", predicate_safe=False, cost=1.0,
        preflight=lambda value: 0))
    try:
        yield calls
    finally:
        capabilities.REGISTRY.pop("test.count", None)


def test_planning_never_runs_a_transform(counted_transform):
    fn = compile_it(body("y = test.count(x)", "return y"))
    assert fn.plan({"a": "value"}) == []
    assert counted_transform == [], "a transform ran while planning"
    assert fn.execute({"a": "value"})[0] == "transformed:value"
    assert counted_transform == ["value"], "the transform did not run at execute"


def test_a_transform_in_a_branch_decision_is_an_error(counted_transform):
    fn = compile_it(body("if test.count(x):", "    return 1", "return 0"))
    with pytest.raises(SafeFnError) as e:
        fn.plan({"a": "value"})
    assert "transform used in a branch decision" in str(e.value)
    assert "test.count()" in str(e.value)
    assert counted_transform == []


def test_a_transform_is_refused_inside_a_condition_expression():
    from flow import nodes
    assert nodes.MAIFlowGate.validate_inputs("image.resize(a, 2, 2)") == \
        "expression: image.resize is a transform; not available in a condition"
    assert nodes.MAIFlowCondition.validate_inputs("image.width(a) > 2") is True
    with pytest.raises(ExprError):
        nodes._predicate_check("seq.concat(a, b)")


# --- budgets (spec 8.2) ----------------------------------------------------

NESTED = body("total = 0", "for i in range(100):", "    for j in range(100):",
              "        total = total + 1", "return total")


def test_nested_loops_share_one_iteration_budget():
    fn = compile_it(NESTED, max_iterations=1000, max_ops=10_000_000, max_calls=5000)
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 1})
    assert str(e.value) == ("Safe Function stopped at line 4: the max_iterations "
                            "budget of 1000 is exhausted (used 1001). "
                            "Raise max_iterations on the node.")
    assert e.value.line == 4
    # the same body inside the budget completes
    ok = compile_it(body("total = 0", "for i in range(10):", "    total = total + 1",
                         "return total"), max_iterations=1000, max_ops=100000, max_calls=5000)
    assert ok.execute({"a": 1})[0] == 10


def test_the_op_and_call_budgets_stop_a_body_the_iteration_budget_allows():
    with pytest.raises(SafeFnError) as e:
        compile_it(NESTED, max_iterations=100000, max_ops=500, max_calls=5000).execute({"a": 1})
    assert "the max_ops budget of 500 is exhausted" in str(e.value)
    calls = compile_it(body("total = 0", "for i in range(50):", "    total = total + sqrt(4.0)",
                            "return total"), max_iterations=1000, max_ops=100000, max_calls=10)
    with pytest.raises(SafeFnError) as e:
        calls.execute({"a": 1})
    assert "the max_calls budget of 10 is exhausted (used 11)" in str(e.value)


def test_a_loop_amplified_allocation_is_charged_against_a_running_total():
    """expr's per-operation guard passes each of these; the total must not."""
    fn = compile_it(body("s = 'ab'", "for i in range(1000):", "    s = 'ab' * 500",
                         "return s"), max_iterations=1000, max_ops=50000,
                    max_calls=5000, max_collection=10000)
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 1})
    assert str(e.value) == ("Safe Function stopped at line 4: the max_collection "
                            "budget of 10000 is exhausted (used 11000). "
                            "Raise max_collection on the node.")
    # and one oversized allocation still fails in the expression layer
    with pytest.raises(SafeFnError) as e:
        compile_it(body("return 'ab' * 5000000")).execute({"a": 1})
    assert "over the MAX_RESULT_LENGTH limit" in str(e.value)


def test_a_retained_transform_result_is_charged_against_the_tensor_budget():
    """Two resources, two units: a Ref never touches max_collection."""
    torch = pytest.importorskip("torch")
    image = Ref(torch.zeros(1, 8, 16, 3), "IMAGE")       # 384 elements
    fn = compile_it(body("out = x", "for i in range(30):", "    out = image.flip(x, True)",
                         "return out"), max_iterations=1000, max_ops=50000,
                    max_calls=5000, max_collection=10000, max_tensor_elements=10000)
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": image})
    assert str(e.value) == ("Safe Function stopped at line 4: the "
                            "max_tensor_elements budget of 10000 is exhausted "
                            "(used 10368). Raise max_tensor_elements on the node.")
    used = compile_it(body("return image.flip(x, True)")).execute({"a": image})[1].used
    assert (used["max_tensor_elements"], used["max_collection"]) == (384, 0), used


def test_a_transform_on_a_real_image_fits_the_shipped_defaults():
    """The product bug: a flip on a 64x64 image cost 12288 against a 10000
    collection budget, and the ceiling matched it so no node setting helped."""
    torch = pytest.importorskip("torch")
    for size, elements in ((64, 12288), (1024, 3145728)):        # 1 MP at 1024
        image = Ref(torch.zeros(1, size, size, 3), "IMAGE")
        value, budget = compile_it(body("return image.flip(x, True)")).execute({"a": image})
        assert tuple(value.value.shape) == (1, size, size, 3)
        assert budget.used["max_tensor_elements"] == elements, budget.used
        assert budget.used["max_collection"] == 0, budget.used
        assert budget.limits["max_tensor_elements"] == 100_000_000
    # and a node CAN raise the tensor budget, because the ceiling is above it
    assert policy.effective("max_tensor_elements", 500_000_000) == 500_000_000


def test_budgets_have_no_unlimited_value():
    for field in ("max_iterations", "max_ops", "max_calls", "max_collection",
                  "max_tensor_elements"):
        assert policy.check_positive(field, 0) == (
            f"{field} must be greater than 0, got 0; there is no unlimited setting")
        assert policy.check_positive(field, -5).startswith(f"{field} must be greater than 0")
        assert policy.check_positive(field, 1) is None
    from flow import nodes
    assert nodes.MAIFlowSafeFunction.validate_inputs(
        source=safefn.DEFAULT_SOURCE, max_iterations=0, max_ops=1, max_calls=1
    ).startswith("max_iterations must be greater than 0")
    assert nodes.MAIFlowSafeFunction.validate_inputs(
        source=safefn.DEFAULT_SOURCE, max_iterations=1, max_ops=1, max_calls=1,
        max_collection=0).startswith("max_collection must be greater than 0")
    assert nodes.MAIFlowSafeFunction.validate_inputs(
        source=safefn.DEFAULT_SOURCE, max_iterations=1, max_ops=1, max_calls=1,
        max_collection=1, max_tensor_elements=0).startswith(
            "max_tensor_elements must be greater than 0")
    # and the editor cannot offer the refused value in the first place
    fields = {i.id: i for i in nodes.MAIFlowSafeFunction.define_schema().inputs}
    for field in ("max_iterations", "max_ops", "max_calls", "max_collection",
                  "max_tensor_elements"):
        assert fields[field].min == 1, field


def test_a_shipped_ceiling_sits_above_the_node_default():
    """A ceiling equal to the default makes "raise it on the node" a lie."""
    shipped = [("max_iterations", 1000, 100_000), ("max_ops", 50000, 5_000_000),
               ("max_calls", 5000, 500_000), ("max_collection", 10000, 1_000_000),
               ("max_tensor_elements", 100_000_000, 1_000_000_000),
               ("max_pixels", 64_000_000, 64_000_000)]
    assert policy.DEFAULTS == {f: d for f, d, _ in shipped}
    assert policy.CEILINGS == {f: c for f, _, c in shipped}
    for field, default in policy.DEFAULTS.items():
        if field == "max_pixels":       # a per-result cap, not a budget to raise
            assert policy.CEILINGS[field] == default
            continue
        assert policy.CEILINGS[field] > default, field
        # so a node asking for ten times its default gets what it asked for
        assert policy.effective(field, default * 10) == default * 10, field


def test_the_installation_ceiling_lowers_a_node_setting(tmp_path):
    path = str(tmp_path / "flow_policy.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"max_iterations": 5, "max_pixels": 1024}, fh)
    assert policy.ceilings(path)["max_iterations"] == 5
    assert policy.effective("max_iterations", 1000, path) == 5
    assert policy.effective("max_iterations", 2, path) == 2
    assert policy.effective("max_ops", 50000, path) == 50000
    # no setting at all means the node default, never the ceiling
    assert policy.effective("max_ops", None, path) == policy.DEFAULTS["max_ops"]
    fn = Function(body("total = 0", "for i in range(100):", "    total = total + 1",
                       "return total"),
                  safefn.limits(1000, 50000, 5000, path=path))
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 1})
    # the advice names the limit that bound the value: raising max_iterations
    # on the node cannot work while the ceiling is what refused it
    assert str(e.value) == ("Safe Function stopped at line 3: the max_iterations "
                            "budget of 5 is exhausted (used 6). The node asks for "
                            "1000, so raise the max_iterations ceiling of 5 in "
                            "flow_policy.json.")
    # a node asking for no more than it may have is told to raise the node
    inside = Function(body("total = 0", "for i in range(100):", "    total = total + 1",
                           "return total"), safefn.limits(4, 50000, 5000, 10000, path=path))
    with pytest.raises(SafeFnError) as e:
        inside.execute({"a": 1})
    assert str(e.value).endswith("(used 5). Raise max_iterations on the node.")
    # ONLY a missing file leaves the shipped ceilings standing
    assert policy.ceilings(str(tmp_path / "absent.json")) == policy.CEILINGS


BROKEN = [
    ("{not json", "cannot be read as JSON"),
    ('{"max_iterations": "5"}', "sets max_iterations to '5'"),
    ('{"max_iteration": 5}', "'max_iteration', which is not a policy key"),
    ('{"max_pixels": 0}', "sets max_pixels to 0"),
    ('{"llm_providers": 7}', "'llm_providers' is a JSON object, got int"),
    ('["max_iterations"]', "its top level is a list"),
]


@pytest.mark.parametrize("content,expected", BROKEN, ids=[b[0][:24] for b in BROKEN])
def test_a_policy_file_that_cannot_be_honoured_fails_closed(tmp_path, content, expected):
    """The restriction must not evaporate on a typo.

    This file used to be ignored whenever it could not be read: an
    administrator who set a ceiling of 5 and then mistyped the JSON, or quoted
    the number, or misspelled the key, silently got the shipped ceiling of
    100000 back with nothing said. That is worse than no policy, because
    nobody is watching a restriction they believe is in force. Absent is now
    the only state that means "use the shipped defaults".
    """
    path = str(tmp_path / "flow_policy.json")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    with pytest.raises(policy.PolicyError) as e:
        policy.ceilings(path)
    assert expected in str(e.value)
    # cached on the mtime, so it is refused again without re-reading
    with pytest.raises(policy.PolicyError):
        policy.ceilings(path)
    # and it turns Safe Function off at QUEUE time rather than mid-run
    from flow.nodes import MAIFlowSafeFunction
    import os as _os
    previous = _os.environ.get(policy.POLICY_ENV)
    _os.environ[policy.POLICY_ENV] = path
    try:
        message = MAIFlowSafeFunction.validate_inputs(
            source=safefn.DEFAULT_SOURCE, max_iterations=1000, max_ops=50000,
            max_calls=5000, max_collection=10000, max_tensor_elements=100_000_000)
        assert message is not True and expected in str(message)
    finally:
        if previous is None:
            _os.environ.pop(policy.POLICY_ENV, None)
        else:
            _os.environ[policy.POLICY_ENV] = previous
    # fixing the file is enough; nothing needs restarting
    with open(path, "w", encoding="utf-8") as fh:
        fh.write('{"max_iterations": 5}')
    assert policy.ceilings(path)["max_iterations"] == 5


def test_a_parameter_default_is_a_literal_and_never_runs_anything():
    """The comment said "a default is a literal"; the code evaluated one.

    A default was validated as an expression and then EVALUATED at parse time,
    so `sqrt(25)`, `'a' * 999999` and `2 ** 4000` were all accepted and all ran
    outside every budget, on each of the three parses per execution. The
    capability is deleted rather than accounted for.
    """
    for source in ("def main(x, y = sqrt(25)):\n    return y\n",
                   "def main(x, y = 'a' * 999999):\n    return y\n",
                   "def main(x, y = 2 ** 4000):\n    return y\n",
                   "def main(x, y = z):\n    return y\n"):
        with pytest.raises(SafeFnError) as e:
            compile_it(source)
        assert "is a literal: a number, a string, True, False, None" in str(e.value)
    # what a default may be, including the shapes that are not bare Constants
    for source, expected in (("def main(x, y = 5):\n    return y\n", 5),
                             ("def main(x, y = -1):\n    return y\n", -1),
                             ("def main(x, y = -2.5):\n    return y\n", -2.5),
                             ("def main(x, y = True):\n    return y\n", True),
                             ("def main(x, y = None):\n    return y\n", None),
                             ("def main(x, y = 'ok'):\n    return y\n", "ok"),
                             ("def main(x, y = [1, 2]):\n    return y\n", [1, 2]),
                             ("def main(x, y = (1, 2)):\n    return y\n", (1, 2))):
        # unref_deep: a list default is wrapped like any other non-scalar, and
        # the node boundary is what unwraps it
        value = capabilities.unref_deep(compile_it(source).execute({"a": 0})[0])
        assert value == expected, source


# --- the language, running ------------------------------------------------

def test_for_over_a_list_a_tuple_and_a_capability_result():
    fn = compile_it(body("total = 0", "for v in x:", "    total = total + v", "return total"))
    assert fn.execute({"a": [1, 2, 3]})[0] == 6
    assert fn.execute({"a": (4, 5)})[0] == 9
    latent = Ref({"samples": _FakeTensor((1, 16, 6, 32, 32))}, "LATENT")
    dims = compile_it(body("total = 0", "for v in latent.shape(x):", "    total = total + v",
                           "return total"))
    assert dims.execute({"a": latent})[0] == 1 + 16 + 6 + 32 + 32
    with pytest.raises(SafeFnError) as e:
        compile_it(body("for v in x:", "    return v")).execute({"a": 3})
    assert "for iterates range(n), a list, a tuple" in str(e.value)


def test_break_and_continue_and_elif():
    fn = compile_it(body("out = 0", "for i in range(10):", "    if i == 2:", "        continue",
                         "    elif i == 5:", "        break", "    out = out + i", "return out"))
    assert fn.execute({"a": 0})[0] == 0 + 1 + 3 + 4
    assert compile_it(body("y = x")).execute({"a": 1})[0] is None, "no return means None"


def test_a_runtime_failure_carries_the_line():
    fn = compile_it(body("y = 1", "return sqrt(x)"))
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": "not a number"})
    assert str(e.value).startswith("Safe Function failed at line 3: sqrt(): TypeError")


def test_the_expression_limits_are_inherited_from_the_expression_layer():
    with pytest.raises(SafeFnError) as e:
        compile_it(body("return 2 ** 5000"))
    assert "exponent 5000 exceeds the maximum allowed (4000)" in str(e.value)
    with pytest.raises(SafeFnError) as e:
        compile_it("def main(x):\n    return x\n" + "# padding\n" * 700)
    assert "exceeds 4096 bytes" in str(e.value)


# --- transform capabilities ------------------------------------------------

def test_the_transform_pack_is_registered_and_none_of_it_is_predicate_safe():
    expected = ["image.crop", "image.flip", "image.resize", "image.select",
                "latent.blend", "mask.invert", "mask.threshold", "seq.concat"]
    unsafe = sorted(c.id for c in capabilities.REGISTRY.values() if not c.predicate_safe)
    assert unsafe == expected


def call(expression, params="x", **sockets):
    """Run one transform through the interpreter and unwrap what comes back."""
    fn = compile_it(body(f"return {expression}", params=params))
    return capabilities.unref(fn.execute(sockets)[0])


def test_transforms_are_functional_and_capped():
    torch = pytest.importorskip("torch")
    image = Ref(torch.zeros(2, 8, 16, 3), "IMAGE")
    assert tuple(call("image.resize(x, 4, 2)", a=image).shape) == (2, 2, 4, 3)
    assert tuple(capabilities.unref(image).shape) == (2, 8, 16, 3), "the input was mutated"
    assert tuple(call("image.crop(x, 1, 2, 3, 4)", a=image).shape) == (2, 4, 3, 3)
    assert tuple(call("image.flip(x, True)", a=image).shape) == (2, 8, 16, 3)
    assert tuple(call("image.select(x, [1, 0])", a=image).shape) == (2, 8, 16, 3)
    assert tuple(call("seq.concat(x, x)", a=image).shape) == (4, 8, 16, 3)
    assert call("seq.concat(x, y)", "x, y", a=[1], b=[2, 3]) == [1, 2, 3]

    mask = Ref(torch.full((1, 4, 4), 0.25), "MASK")
    assert float(call("mask.invert(x)", a=mask).mean()) == 0.75
    assert float(call("mask.threshold(x, 0.5)", a=mask).mean()) == 0.0
    latent = {"samples": torch.zeros(1, 4, 8, 8)}
    blended = call("latent.blend(x, y, 0.25)", "x, y", a=Ref(latent, "LATENT"),
                   b=Ref({"samples": torch.ones(1, 4, 8, 8)}, "LATENT"))
    assert float(blended["samples"].mean()) == 0.25
    assert float(latent["samples"].mean()) == 0.0, "the input latent was mutated"


def test_a_transform_is_refused_until_its_pack_is_enabled(tmp_path, monkeypatch):
    """No policy file means no optional pack: the default installation has no
    transform surface at all, and the message names the key that opens it."""
    monkeypatch.setenv(policy.POLICY_ENV, str(tmp_path / "absent.json"))
    with pytest.raises(SafeFnError) as e:
        compile_it(body("return image.flip(x, True)"))
    assert str(e.value).startswith("Safe Function rejected at line 2: "), str(e.value)
    assert "image.flip is in the 'transforms' pack" in str(e.value)
    assert '{"enable_packs": ["transforms"]}' in str(e.value)
    # and the reader capabilities in the same id prefixes stay available
    assert compile_it(body("return image.width(x)")).execute(
        {"a": Ref(pytest.importorskip("torch").zeros(1, 2, 3, 3), "IMAGE")})[0] == 3


def test_safe_function_can_be_switched_off_by_policy(tmp_path, monkeypatch):
    """Spec 8.5: the off switch, at queue time, and only for this node."""
    from flow import nodes
    path = tmp_path / "flow_policy.json"
    path.write_text(json.dumps({"safe_function": False}))
    monkeypatch.setenv(policy.POLICY_ENV, str(path))
    verdict = nodes.MAIFlowSafeFunction.validate_inputs(source=safefn.DEFAULT_SOURCE)
    assert verdict == 'Safe Function is disabled by flow_policy.json ("safe_function": false)'
    with pytest.raises(SafeFnError):
        nodes.MAIFlowSafeFunction.check_lazy_status(safefn.DEFAULT_SOURCE)
    assert nodes.MAIFlowGate.validate_inputs("a != 1.0") is True, "Gate never reads it"
    path.write_text(json.dumps({"safe_function": "false"}))
    assert "true or false" in nodes.MAIFlowSafeFunction.validate_inputs(
        source=safefn.DEFAULT_SOURCE), "a quoted bool must not read as on"


def test_a_transform_over_the_pixel_ceiling_is_refused():
    torch = pytest.importorskip("torch")
    with pytest.raises(SafeFnError) as e:
        call("image.resize(x, 20000, 20000)", a=Ref(torch.zeros(1, 8, 8, 3), "IMAGE"))
    assert "over the max_pixels limit of 64000000" in str(e.value)


# --- augmented assignment (spec 8.1) ---------------------------------------

def test_augmented_assignment_runs_and_is_not_a_silent_no_op():
    """Allowing `x += 1` by policy alone would fall through to return None."""
    fn = compile_it(body("total = 0", "for i in range(5):", "    total += i",
                         "return total"))
    assert fn.execute({"a": 0})[0] == 0 + 1 + 2 + 3 + 4
    assert compile_it(body("x += 1", "return x")).execute({"a": 41})[0] == 42
    assert compile_it(body("s = 'a'", "s *= 3", "return s")).execute({"a": 0})[0] == "aaa"
    assert compile_it(body("x -= 1", "x /= 2", "return x")).execute({"a": 9})[0] == 4.0
    # the safe operators still apply: this is x = x * x, not a fresh path
    with pytest.raises(SafeFnError) as e:
        compile_it(body("s = 'ab'", "s *= 5000000", "return s")).execute({"a": 0})
    assert "over the MAX_RESULT_LENGTH limit" in str(e.value)


def test_augmented_assignment_plans_like_an_assignment():
    fn = compile_it(body("y = 0", "y += x", "if y > 2:", "    return 1", "return 0"))
    assert fn.plan({"a": None}) == ["a"]
    assert fn.execute({"a": 5})[0] == 1


# --- an Unknown must never reach the graph (spec 8.4) ----------------------

def has_unknown(value):
    """The sentinel test a downstream node cannot make for itself."""
    return safefn._unresolved(value) is not None


def test_a_returned_list_of_unresolved_sockets_asks_for_them(counted_transform):
    fn = compile_it(body("return [x, y]", params="x, y"))
    assert fn.plan({"a": None, "b": None}) == ["a"], "a buried Unknown planned nothing"
    assert fn.plan({"a": 1, "b": None}) == ["b"]
    value, _ = fn.execute({"a": 1, "b": 2})
    assert value == [1, 2] and not has_unknown(value)
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 1, "b": None})
    assert "socket b was never resolved" in str(e.value)
    # nested one level down, and mixed with a transform: the socket wins
    nested = compile_it(body("return [[1, test.count(x)], [y]]", params="x, y"))
    assert nested.plan({"a": "v", "b": None}) == ["b"]
    assert counted_transform == []


def test_a_loop_item_does_not_hide_an_unknown_inside_a_ref():
    fn = compile_it(body("for i in [x]:", "    return i"))
    assert fn.plan({"a": None}) == ["a"], "wrap() hid the sentinel in a Ref"
    assert fn.execute({"a": 7})[0] == 7
    # and a loop item that is Unknown still stops a branch that reads it
    branching = compile_it(body("for i in [x]:", "    if i:", "        return 1", "return 0"))
    assert branching.plan({"a": None}) == ["a"]


def test_the_node_layer_never_hands_core_a_sentinel():
    from flow import nodes
    with pytest.raises(SafeFnError):
        nodes.MAIFlowSafeFunction.execute(
            source=body("return [x, y]", params="x, y"), a=1, b=None)


# --- unbounded values: bits, printf ----------------------------------------

def test_a_squaring_loop_is_refused_before_it_reaches_host_ram():
    """134 MB of int in 30 iterations, with every other budget untouched."""
    fn = compile_it(body("x = 3", "for i in range(64):", "    x = x * x", "return x"),
                    max_iterations=1000, max_ops=50000, max_calls=5000,
                    max_collection=10000)
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 0})
    assert str(e.value) == ("Safe Function failed at line 4: '*' would build a "
                            "1661954-bit integer, over the MAX_INT_BITS limit of "
                            "1000000")
    # the same hole through augmented assignment
    with pytest.raises(SafeFnError) as e:
        compile_it(body("x = 3", "for i in range(64):", "    x *= x", "return x")
                   ).execute({"a": 0})
    assert "over the MAX_INT_BITS limit of 1000000" in str(e.value)


def test_a_pow_bomb_is_refused_at_the_operator():
    """The exponent cap alone leaves the base free: (2 ** 4000) ** 4000."""
    with pytest.raises(SafeFnError) as e:
        compile_it(body("b = 2 ** 4000", "return b ** 4000")).execute({"a": 0})
    assert str(e.value) == ("Safe Function failed at line 3: '**' would build a "
                            "16004000-bit integer, over the MAX_INT_BITS limit of "
                            "1000000")
    # the exponent cap still fires first where it applies
    with pytest.raises(SafeFnError) as e:
        compile_it(body("return 2 ** x")).execute({"a": 5000})
    assert "exponent 5000 exceeds the maximum allowed (4000)" in str(e.value)
    # and a legal exponent still computes
    assert compile_it(body("return 2 ** 16")).execute({"a": 0})[0] == 65536


def test_string_formatting_is_refused_and_numeric_mod_is_not():
    with pytest.raises(SafeFnError) as e:
        compile_it(body("return '%900000000000d' % x")).execute({"a": 1})
    assert str(e.value) == ("Safe Function failed at line 2: string formatting is "
                            "not available; there is no formatting capability")
    assert compile_it(body("return x % 3")).execute({"a": 10})[0] == 1
    assert compile_it(body("return x % 2.0")).execute({"a": 5})[0] == 1.0
    # the same refusal from a Gate expression, where there is no budget at all
    from flow.expr import ExprError as _ExprError, evaluate
    with pytest.raises(_ExprError) as ee:
        evaluate("'%900000000000d' % a", {"a": 1})
    assert str(ee.value) == ("string formatting is not available; there is no "
                             "formatting capability")


# --- every failure carries the line (spec 8, the module contract) ----------

RAW = [("return 1 / 0", "ZeroDivisionError: division by zero"),
       ("return 'ab' * 2.5", "TypeError: can't multiply sequence by non-int of type 'float'"),
       ("return 1 < 'a'", "TypeError: '<' not supported between instances of 'int' and 'str'")]


@pytest.mark.parametrize("statement,expected", RAW, ids=[r[0][7:] for r in RAW])
def test_a_python_level_failure_is_reported_as_a_safe_function_failure(statement, expected):
    with pytest.raises(SafeFnError) as e:
        compile_it(body(statement)).execute({"a": 1})
    assert str(e.value) == f"Safe Function failed at line 2: {expected}"
    assert e.value.line == 2


def test_the_same_failure_is_a_policy_error_from_a_gate_expression_too():
    """The node layer called the same evaluator bare.

    `1 / 0` inside a Safe Function said what happened, and the identical
    expression in a Gate raised a naked ZeroDivisionError out of
    check_lazy_status. A capability's own failure was already wrapped, so
    sqrt(-1) was clean and an operator's failure was not.
    """
    from flow.nodes import _evaluate
    for source, expected in (("a / 0", "ZeroDivisionError: division by zero"),
                             ("a + 1", "TypeError: can only concatenate str "
                                       '(not "int") to str'),
                             ("a ** 3", "OverflowError")):
        with pytest.raises(ExprError) as e:
            _evaluate(source, {"a": "x" if "TypeError" in expected else
                               (1e300 if "Overflow" in expected else 1)})
        assert expected in str(e.value)
    # a refusal still reads as a refusal, not as a wrapped Python error
    with pytest.raises(ExprError) as e:
        _evaluate("a.__class__", {"a": 1})
    assert "attribute access on values is not available" in str(e.value)


def test_a_returned_container_is_unwrapped_as_well_as_resolved():
    """Spec 8.4: fully resolved means containers too, for Ref as for Unknown.

    The Unknown half of this rule walks containers; the Ref half opened only
    the top-level value, so `return [x, y]` handed the graph a list of
    interpreter wrappers instead of images. The two tests that already return
    a list pass integers, which are never wrapped, which is why it survived.
    """
    image, mask = _FakeTensor((1, 8, 8, 3)), _FakeTensor((1, 4, 4))
    for source, params, sockets in (
            ("return [x, y]", "x, y", {"a": image, "b": mask}),
            ("return (x, y)", "x, y", {"a": image, "b": mask}),
            ("return [[x], y]", "x, y", {"a": image, "b": mask})):
        value, _ = compile_it(body(source, params=params)).execute(sockets)
        resolved = capabilities.unref_deep(value)
        flat = [resolved] if not isinstance(resolved, (list, tuple)) else list(resolved)
        while any(isinstance(i, (list, tuple)) for i in flat):
            flat = [x for i in flat for x in (i if isinstance(i, (list, tuple)) else [i])]
        assert not any(isinstance(item, Ref) for item in flat), source
        assert all(isinstance(item, _FakeTensor) for item in flat), source
    # the container type survives the walk
    assert isinstance(capabilities.unref_deep(
        compile_it(body("return (x, y)", params="x, y")).execute(
            {"a": image, "b": mask})[0]), tuple)
    # and a plain scalar return is untouched
    assert compile_it(body("return x")).execute({"a": 3})[0] == 3


def test_a_budget_stop_is_not_swallowed_by_the_new_catch_all():
    """SafeFnError and NeedsInput must pass through _guarded untouched."""
    fn = compile_it(body("total = 0", "for i in range(100):", "    total = total + 1",
                         "return total"), max_iterations=1000, max_ops=60,
                    max_calls=5000, max_collection=10000)
    with pytest.raises(SafeFnError) as e:
        fn.execute({"a": 0})
    assert "the max_ops budget of 60 is exhausted" in str(e.value)


# --- the source input is text on the node ----------------------------------

def test_a_linked_source_says_so():
    with pytest.raises(SafeFnError) as e:
        compile_it(["some_node", 0])
    assert str(e.value) == ("Safe Function source is text typed on the node; it "
                            "cannot arrive on a link")
    with pytest.raises(SafeFnError) as e:
        compile_it("   \n")
    assert str(e.value) == "Safe Function source is empty"


# --- the predicate refusal runs where the decision is made (spec 8.3) ------

def test_a_transform_in_a_linked_predicate_never_runs(counted_transform):
    """validate_inputs sees None for a linked expression, so it cannot help."""
    from flow import nodes
    assert nodes.MAIFlowGate.validate_inputs(expression=None) is True

    with pytest.raises(ExprError) as e:
        nodes.MAIFlowGate.check_lazy_status("test.count(a)", values={"a": (1, "values.a")})
    assert str(e.value) == "test.count is a transform; not available in a condition"
    with pytest.raises(ExprError):
        nodes.MAIFlowGate.execute("test.count(a)", values={"a": 1})
    with pytest.raises(ExprError):
        nodes.MAIFlowCondition.execute("test.count(a)", values={"a": 1})
    with pytest.raises(ExprError):
        nodes.MAIFlowFilter.execute(items=[1, 2], expression=["test.count(item)"],
                                    values={})
    with pytest.raises(ExprError):
        nodes.MAIFlowPartition.execute(items=[1, 2], expression=["test.count(item)"],
                                       values={})
    assert counted_transform == [], "a transform ran on a predicate path"
