"""The expression layer: grammar, refusals, limits, parity, Ref opacity.

No server: the evaluator is a small pure-Python module and this file is
what keeps it that way. It needs PYTHONPATH=/mnt/work/ai/apps/ComfyUI only
because importing the flow package pulls in the node layer.

    python -m pytest tests/flow/test_expr.py -q
"""
import os
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)

from flow import capabilities  # noqa: E402  (registers the v1 packs)
from flow.expr import (MAX_CALLS, MAX_DEPTH, MAX_ELEMENTS, MAX_RESULT_LENGTH,
                       MAX_SOURCE_BYTES, ExprError, Ref, evaluate, validate)


class FakeTensor:
    """Stands in for an IMAGE/MASK tensor without importing torch."""

    def __init__(self, shape, mean=0.0):
        self.shape = tuple(shape)
        self._mean = mean

    def mean(self):
        return self._mean


ACCEPTED = [
    ("1 + 2 * 3", {}, 7),
    ("(a + b) / 2", {"a": 3.0, "b": 1.0}, 2.0),
    ("7 // 2 + 7 % 2", {}, 4),
    ("2 ** 10", {}, 1024),
    ("-a", {"a": 4}, -4),
    ("not a", {"a": 0}, True),
    ("1 < a < 10", {"a": 5}, True),
    ("a and b", {"a": True, "b": False}, False),
    ("a or b", {"a": 0, "b": 3}, 3),
    ("1 if a else 2", {"a": True}, 1),
    ("a != 1.0", {"a": 1.0}, False),
    ("'draft' == a", {"a": "draft"}, True),
    ("is_none(a)", {"a": None}, True),
    ("[1, 2, 3][1]", {}, 2),
    ("(1, 2, 3)[i]", {"i": 2}, 3),
    ("sqrt(16) + floor(2.7) + ceil(0.2)", {}, 7.0),
    ("core.math.max(1, 2, 3)", {}, 3),
    ("clamp(11, 0, 10)", {}, 10),
    ("between(5, 1, 10) and near(1.0001, 1.0, 0.001)", {}, True),
    ("coalesce(a, 9)", {"a": None}, 9),
]


@pytest.mark.parametrize("source,names,expected", ACCEPTED)
def test_grammar_accepts(source, names, expected):
    assert evaluate(source, names) == expected


# spec 8.5, the expression-shaped entries (the statement forms belong to
# Safe Function in phase 3 and are not parseable as an expression at all)
REJECTED = [
    "open('/etc/passwd')",
    "__import__('requests')",
    "getattr(x, '__class__')",
    "x.__class__",
    "eval('1+1')",
    "exec('...')",
    "subprocess.run(['ls'])",
    "socket.socket()",
    "(lambda: 0)()",
    "[i for i in range(10)]",
]


@pytest.mark.parametrize("source", REJECTED)
def test_security_list_rejected(source):
    with pytest.raises(ExprError) as e:
        validate(source, {"x": 1})
    assert str(e.value), "a rejection must carry a message naming the policy"


def test_statements_are_not_expressions():
    with pytest.raises(ExprError) as e:
        validate("import os")
    assert "not a single expression" in str(e.value)


def test_rejection_messages_name_the_policy():
    with pytest.raises(ExprError) as e:
        validate("x.width", {"x": 1})
    assert str(e.value) == ("attribute access on values is not available; "
                            "use image.width(x)")
    with pytest.raises(ExprError) as e:
        validate("[i for i in (1, 2)]")
    assert "comprehensions are not available" in str(e.value)
    with pytest.raises(ExprError) as e:
        validate("f'{a}'", {"a": 1})
    assert "f-strings are not available" in str(e.value)
    with pytest.raises(ExprError) as e:
        validate("{'a': 1}")
    assert "dict literals are not available" in str(e.value)


def test_unknown_name_is_rejected_when_the_bindings_are_known():
    with pytest.raises(ExprError) as e:
        validate("a + zz", {"a": 1})
    assert "'zz' is neither a connected value nor a registered capability" in str(e.value)
    # queue time: the bindings are links, so only syntax is checked
    validate("a + zz")


# --- Gate F: limits, refused before execution ------------------------------

def test_limit_source_size():
    with pytest.raises(ExprError) as e:
        validate("1 + " * (MAX_SOURCE_BYTES // 2) + "1")
    assert str(MAX_SOURCE_BYTES) in str(e.value)


def test_limit_nesting_depth():
    with pytest.raises(ExprError) as e:
        validate("abs(" * (MAX_DEPTH + 4) + "1" + ")" * (MAX_DEPTH + 4))
    assert f"deeper than {MAX_DEPTH}" in str(e.value)


def test_limit_literal_elements():
    source = "[" + ",".join("1" for _ in range(MAX_ELEMENTS + 1)) + "]"
    with pytest.raises(ExprError) as e:
        validate(source)
    assert f"the limit is {MAX_ELEMENTS}" in str(e.value)


def test_limit_node_count():
    # wide and shallow, so it is the node budget that fires and not the depth
    with pytest.raises(ExprError) as e:
        validate("max(" + ",".join("1" for _ in range(2000)) + ")")
    assert "syntax nodes" in str(e.value)


def test_limit_exponent_literal_is_a_validation_error():
    with pytest.raises(ExprError) as e:
        validate("2 ** 5000")
    assert "exceeds the maximum allowed (4000)" in str(e.value)


def test_limit_exponent_call_is_caught_at_evaluation():
    # same place core catches it: pow() as a callable, not the ** operator
    validate("pow(2, 5000)")
    with pytest.raises(ExprError) as e:
        evaluate("pow(2, 5000)")
    assert "exceeds the maximum allowed (4000)" in str(e.value)


def test_the_pow_capability_carries_the_operator_s_integer_size_guard():
    """The exponent cap leaves the BASE free, and pow() is a second door to it.

    `(2 ** 4000) ** 4000` was refused while `pow(pow(2, 4000), 4000)` built a
    16-million-bit integer, because capabilities.py defined its own _safe_pow
    that capped the exponent and nothing else. A third nesting demanded 8 GB
    in one uninterruptible C call, and the reachable surface is a Gate or
    Condition widget, which has no allocation budget at all. Same guard, same
    message, whichever door is used.
    """
    expected = "would build a 16004000-bit integer, over the MAX_INT_BITS limit of 1000000"
    with pytest.raises(ExprError) as operator:
        evaluate("(2 ** 4000) ** 4000")
    with pytest.raises(ExprError) as capability:
        evaluate("pow(pow(2, 4000), 4000)")
    assert str(operator.value) == f"'**' {expected}"
    # one guard, and it names the door the author actually used
    assert str(capability.value) == f"'pow' {expected}"
    # and the legal cases still compute, through both doors
    assert evaluate("pow(2, 16)") == 65536
    assert evaluate("2 ** 16") == 65536


def test_limit_result_length_string_repeat_bomb():
    # every program-level limit passes: 15 source bytes, five AST nodes. Only
    # the value-size guard stands between this and gigabytes of str.
    validate("'ab' * 5000000")
    with pytest.raises(ExprError) as e:
        evaluate("'ab' * 5000000")
    assert str(e.value) == ("'*' would build 10000000 characters, over the "
                            f"MAX_RESULT_LENGTH limit of {MAX_RESULT_LENGTH}")


def test_limit_result_length_list_repeat_bomb():
    with pytest.raises(ExprError) as e:
        evaluate("[1, 2] * 100000000")
    assert str(e.value) == ("'*' would build 200000000 elements, over the "
                            f"MAX_RESULT_LENGTH limit of {MAX_RESULT_LENGTH}")
    # the reversed operand order is guarded too
    with pytest.raises(ExprError) as e:
        evaluate("100000000 * [1, 2]")
    assert "would build 200000000 elements" in str(e.value)


def test_limit_result_length_concat_bomb():
    # each half is legal on its own, so this cannot pass by the repeat guard
    # firing first: it is the concatenation that is refused
    assert len(evaluate("'ab' * 400000")) == 800000
    with pytest.raises(ExprError) as e:
        evaluate("'ab' * 400000 + 'ab' * 400000")
    assert str(e.value) == ("'+' would build 1600000 characters, over the "
                            f"MAX_RESULT_LENGTH limit of {MAX_RESULT_LENGTH}")


def test_result_length_guard_leaves_ordinary_arithmetic_alone():
    assert evaluate("2 * 3 + 1") == 7
    assert evaluate("'ab' * 3") == "ababab"
    assert evaluate("[1] * 3 + [2]") == [1, 1, 1, 2]
    assert evaluate("'a' + 'b'") == "ab"


def test_a_bare_capability_name_is_not_a_value():
    # returning cap.fn made a Condition on `sqrt` yield True / 0 / a heap
    # address instead of saying what was wrong
    with pytest.raises(ExprError) as e:
        validate("sqrt")          # statically decidable: refused at queue time
    assert str(e.value) == "'sqrt' is a capability and must be called, as sqrt(...)"
    with pytest.raises(ExprError) as e:
        evaluate("sqrt")          # and again in the evaluator, for a cached tree
    assert str(e.value) == "'sqrt' is a capability and must be called, as sqrt(...)"
    with pytest.raises(ExprError) as e:
        evaluate("sqrt + 1")
    assert "must be called" in str(e.value)
    # a bound value of the same name still wins
    assert evaluate("sqrt", {"sqrt": 4}) == 4


def test_limit_calls_per_evaluation():
    source = "max(" + ",".join("abs(1)" for _ in range(MAX_CALLS + 10)) + ")"
    validate(source)
    with pytest.raises(ExprError) as e:
        evaluate(source)
    assert f"more than {MAX_CALLS} capability calls" in str(e.value)


# --- parity with core's Math Expression ------------------------------------

def test_bare_names_are_a_superset_of_core_math_expression():
    sys.path.insert(0, "/mnt/work/ai/apps/ComfyUI")
    from comfy_extras.nodes_math import MATH_FUNCTIONS
    missing = sorted(set(MATH_FUNCTIONS) - set(capabilities.BARE_NAMES))
    assert missing == [], f"bare names missing from the registry: {missing}"


def test_core_math_semantics_match():
    assert evaluate("sum([1, 2, 3])") == 6
    assert evaluate("sum(1, 2, 3)") == 6          # core's variadic form
    assert evaluate("round(2.5)") == round(2.5)
    assert evaluate("int('7') + float('0.5')") == 7.5


# --- Ref opacity -----------------------------------------------------------

def test_ref_cannot_be_opened_by_an_expression():
    ref = Ref(FakeTensor((1, 8, 16, 3)), "IMAGE")
    for source in ("x.shape", "x.value", "x.mean()"):
        with pytest.raises(ExprError):
            validate(source, {"x": ref})
    assert evaluate("image.width(x)", {"x": ref}) == 16
    assert evaluate("image.height(x)", {"x": ref}) == 8
    assert evaluate("image.batch(x)", {"x": ref}) == 1
    assert evaluate("image.aspect(x)", {"x": ref}) == 2.0
    assert evaluate("image.megapixels(x)", {"x": ref}) == pytest.approx(128 / 1e6)


def test_capabilities_over_mask_latent_and_sequences():
    mask = Ref(FakeTensor((1, 4, 4), mean=0.25), "MASK")
    assert evaluate("mask.coverage(m)", {"m": mask}) == 0.25
    assert evaluate("mask.is_empty(m)", {"m": mask}) is False
    latent = Ref({"samples": FakeTensor((1, 16, 6, 32, 32))}, "LATENT")
    assert evaluate("latent.frames(l)", {"l": latent}) == 6
    assert evaluate("latent.shape(l)[2]", {"l": latent}) == 6
    assert evaluate("seq.length(s)", {"s": [1, 2, 3]}) == 3
    assert evaluate("seq.length(s)", {"s": Ref(FakeTensor((5, 8, 8, 3)), "IMAGE")}) == 5


def test_capability_type_errors_name_the_capability():
    with pytest.raises(ExprError) as e:
        evaluate("image.width(x)", {"x": Ref(FakeTensor((1, 4, 4)), "MASK")})
    assert "image.*" in str(e.value) and "3-D" in str(e.value)


def test_every_predicate_pack_capability_is_predicate_safe():
    """The transform pack arrived with Safe Function (spec 5.3); nothing else
    may be unsafe, and a transform is refused inside a Gate or Condition.

    The eight names are a literal on purpose, in two files: asserting
    against the registry constant would pass for a NEW transform, which is
    the security-relevant event this is here to catch.
    """
    unsafe = sorted(c.id for c in capabilities.REGISTRY.values() if not c.predicate_safe)
    assert unsafe == ["image.crop", "image.flip", "image.resize", "image.select",
                      "latent.blend", "mask.invert", "mask.threshold", "seq.concat"]


def test_a_bare_capability_name_is_refused_at_validation():
    # statically decidable, so it must not wait for evaluation (spec 5.1)
    with pytest.raises(ExprError) as e:
        validate("sqrt")
    assert str(e.value) == "'sqrt' is a capability and must be called, as sqrt(...)"


def test_a_called_capability_still_validates():
    validate("sqrt(a) > 1", bound_names=["a"])
    validate("image.megapixels(a) > 1.5", bound_names=["a"])
