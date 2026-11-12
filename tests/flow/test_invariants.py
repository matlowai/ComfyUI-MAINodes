"""Meta-invariants: properties the whole package must hold, tested once.

This file exists because the same defect shape appeared five times during the
build, always as a guard that bounds one operation while the total, or a
second spelling of the same operation, goes unbounded. Adding another reviewer
does not fix that. Stating the rule as a test over the REGISTRY does: an
omission becomes a construction error at import rather than a hole somebody
has to notice.

    PYTHONPATH=/mnt/work/ai/apps/ComfyUI python -m pytest tests/flow/test_invariants.py -q
"""
import os
import sys

import pytest
import torch

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)

from flow import capabilities, nodes, policy  # noqa: E402
from flow.expr import ExprError, evaluate  # noqa: E402


def test_every_allocating_capability_declares_what_it_will_allocate():
    """An allocating capability without a preflight cannot be registered.

    The module used to claim "every allocation is capped by the installation's
    max_pixels" while five of the eight transforms had no check at all.
    """
    for cap in capabilities.REGISTRY.values():
        if not cap.predicate_safe:
            assert cap.preflight is not None, cap.id
    with pytest.raises(ValueError) as e:
        capabilities.register(capabilities.Capability(
            "test.undeclared", 1, lambda x: x, (), "ANY", predicate_safe=False))
    assert "declares no preflight" in str(e.value)
    assert "test.undeclared" not in capabilities.REGISTRY


IMAGE = torch.zeros(2, 4, 8, 3)
MASK = torch.zeros(1, 4, 4)
LATENT = {"samples": torch.zeros(1, 4, 2, 8, 8)}

# every transform, with arguments small enough to actually run
CALLS = [
    ("image.resize", (IMAGE, 6, 6)),
    ("image.crop", (IMAGE, 0, 0, 2, 2)),
    ("image.flip", (IMAGE,)),
    ("image.select", (IMAGE, [0, 1])),
    ("mask.invert", (MASK,)),
    ("mask.threshold", (MASK, 0.5)),
    ("latent.blend", (LATENT, LATENT, 0.5)),
    ("seq.concat", (IMAGE, IMAGE)),
]


@pytest.mark.parametrize("cap_id,args", CALLS, ids=[c[0] for c in CALLS])
def test_a_declared_peak_is_never_smaller_than_what_the_call_produces(cap_id, args):
    """The estimator is checked against reality, not just against itself.

    A preflight that under-reports is worse than none, because it reads as a
    guard. Elements, not bytes: fp16 and fp32 do not cost the same and
    interpolate() promotes to float, so bytes is the better unit and is owed.
    """
    cap = capabilities.resolve(cap_id)
    declared = int(cap.preflight(*args))
    produced = capabilities._numel(cap.fn(*args))
    assert declared >= produced, f"{cap_id} declared {declared}, produced {produced}"


# a capability that duplicates an operator must refuse what the operator
# refuses; `pow()` shipped as a second implementation that capped the exponent
# and left the base free, so this pair disagreed by 8 GB
ALIASES = [("(2 ** 4000) ** 4000", "pow(pow(2, 4000), 4000)")]


@pytest.mark.parametrize("operator,capability", ALIASES, ids=[a[1] for a in ALIASES])
def test_an_operator_and_its_capability_spelling_refuse_the_same_thing(operator, capability):
    with pytest.raises(ExprError) as by_operator:
        evaluate(operator)
    with pytest.raises(ExprError) as by_capability:
        evaluate(capability)
    for text in (str(by_operator.value), str(by_capability.value)):
        assert "MAX_INT_BITS" in text
    # the message names the door the author used, and nothing else differs
    assert str(by_operator.value).replace("'**'", "") == \
        str(by_capability.value).replace("'pow'", "")


OPTIONAL = sorted(c.id for c in capabilities.REGISTRY.values() if c.pack)


@pytest.mark.parametrize("cap_id", OPTIONAL)
def test_every_optional_pack_member_is_refused_until_its_pack_is_enabled(
        cap_id, tmp_path, monkeypatch):
    """Stated over the registry: a capability that names a pack is refused by
    Safe Function at parse time while that pack is off, whatever its arity."""
    from flow import safefn
    monkeypatch.setenv(policy.POLICY_ENV, str(tmp_path / "absent.json"))
    with pytest.raises(safefn.SafeFnError) as e:
        safefn.Function(f"def main(x):\n    return {cap_id}(x)\n")
    assert f"{cap_id} is in the '{capabilities.resolve(cap_id).pack}' pack" in str(e.value)
    assert "enable_packs" in str(e.value)


def test_every_transform_is_in_an_optional_pack():
    """Nothing that allocates is on by default."""
    for cap in capabilities.REGISTRY.values():
        if not cap.predicate_safe:
            assert cap.pack in policy.OPTIONAL_PACKS, cap.id


@pytest.mark.parametrize("cap_id", OPTIONAL)
def test_the_expression_evaluator_refuses_a_disabled_pack_too(cap_id, tmp_path, monkeypatch):
    """Not only Safe Function: a pack member that happened to be predicate-safe
    would otherwise be callable from a Gate on an installation that never
    enabled the pack, and the FLOW.md sentence about that would go false with
    no test failing."""
    monkeypatch.setenv(policy.POLICY_ENV, str(tmp_path / "absent.json"))
    with pytest.raises(ExprError) as e:
        evaluate(f"{cap_id}(a)", {"a": 1})
    assert "enable_packs" in str(e.value)


def test_a_pack_name_must_be_one_an_installation_can_enable():
    with pytest.raises(ValueError) as e:
        capabilities.register(capabilities.Capability(
            "test.orphan", 1, lambda x: x, (), "ANY", pack="nope"))
    assert "OPTIONAL_PACKS does not list" in str(e.value)
    assert "test.orphan" not in capabilities.REGISTRY


def test_the_hosting_keys_fail_closed_like_the_budgets(tmp_path):
    path = tmp_path / "flow_policy.json"
    for bad in ('{"enable_packs": "transforms"}', '{"enable_packs": ["nope"]}',
                '{"safe_function": "false"}', '{"safe_function": 0}'):
        path.write_text(bad)
        with pytest.raises(policy.PolicyError):
            policy.enabled_packs(str(path))
    path.write_text('{"enable_packs": ["transforms"], "safe_function": false}')
    assert policy.enabled_packs(str(path)) == {"transforms"}
    assert policy.safe_function_enabled(str(path)) is False
    assert policy.enabled_packs(str(tmp_path / "absent.json")) == frozenset()
    assert policy.safe_function_enabled(str(tmp_path / "absent.json")) is True


def test_every_bare_name_is_the_same_capability_as_its_full_id():
    for bare, full in capabilities.BARE_NAMES.items():
        assert capabilities.resolve(bare) is capabilities.resolve(full), bare


BUDGETS = [f for f in policy.DEFAULTS if f != "max_pixels"]


@pytest.mark.parametrize("field", BUDGETS)
def test_every_budget_is_serialized_bounded_and_positive(field):
    """Four properties, or the budget does not really constrain anything.

    A node input, so one workflow behaves the same on two machines. A ceiling
    ABOVE the default, or "raise it on the node" is advice that gets silently
    clamped. And no unlimited value, because that is how a shared workflow
    takes a host down.
    """
    inputs = {i.id: i for i in nodes.MAIFlowSafeFunction.define_schema().inputs}
    assert field in inputs, f"{field} is not a node input, so it is not serialized"
    assert inputs[field].min == 1, f"{field} would accept a non-positive value"
    assert policy.CEILINGS[field] >= policy.DEFAULTS[field], field
    assert policy.check_positive(field, 0), field
    assert policy.check_positive(field, -1), field
    assert policy.check_positive(field, True), f"{field} accepted a bool"
    assert policy.check_positive(field, policy.DEFAULTS[field]) is None, field


def test_only_an_absent_policy_file_means_the_shipped_defaults(tmp_path):
    """The whole point of failing closed, as one line."""
    assert policy.ceilings(str(tmp_path / "absent.json")) == policy.CEILINGS
    broken = tmp_path / "flow_policy.json"
    broken.write_text("{not json")
    with pytest.raises(policy.PolicyError):
        policy.ceilings(str(broken))
