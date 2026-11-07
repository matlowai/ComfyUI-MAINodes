"""Installation policy: Safe Function budgets (spec 8.2), LLM providers (9.4).

Budgets are serialized on the node so the editor and the API behave
identically. An installation may lower any of them, never raise them: the
effective limit is ``min(node, policy)``. There is no unlimited value; 0 or
a negative number is a validation error naming the field, because "no
setting means unlimited" is how a shared workflow takes a host down.

The ceiling sits ABOVE the node default, not on it. One dict serving as
both made every default its own ceiling, so "raise max_iterations on the
node" was advice that could not work and every budget message pointed at
this file. Ceilings ship at roughly a hundred times the defaults: the node
setting is what a user tunes, and lowering a ceiling is a deliberate act by
an administrator, which is the only case the flow_policy wording should
describe.

The optional override is a JSON object at the pack root, so an
administrator edits one file and never the code:

    {"max_iterations": 100, "llm_providers": {"local": {...}}}

It is the pack root's flow_policy.json unless MAINODES_FLOW_POLICY names
another one, which is how a sandbox gets its own without writing into a pack.

POLICY FAILS CLOSED. Absent is the only state that means "use the shipped
defaults". A file that exists but cannot be read, parsed, or understood is an
error, because the failure mode it replaces is silent: an administrator who
sets a ceiling of 5 and then makes a JSON typo, or writes "5" instead of 5,
got the shipped ceiling of 100000 back with nothing said. A restriction that
evaporates on a typo is worse than no restriction, since nobody is looking.
An unknown key is an error for the same reason: `max_iteration` is a
restriction the administrator believes is in force.

Only Safe Function and the LLM nodes read this file, so a broken policy
disables exactly those and leaves Gate, Condition, Lazy Select, Filter,
Partition and Flow Probe running, which is what spec 8.5 asks for.

Two more keys are the hosting policy spec 8.5 asks for. ``safe_function``
(true or false) turns the node off entirely. ``enable_packs`` is the list of
OPTIONAL capability packs this installation allows; nothing is enabled unless
the file says so. The transforms are the only optional pack, and they are off
by default on purpose: every allocation budget in this package exists because
a transform can run inside workflow-authored text, and an installation that
never enables them has no such surface at all.
"""
from __future__ import annotations

import json
import os

DEFAULTS = {
    "max_iterations": 1000,          # total loop steps, shared across nested loops
    "max_ops": 50000,                # interpreted operations
    "max_calls": 5000,               # capability calls
    "max_collection": 10000,         # sequence elements and characters
    "max_tensor_elements": 100_000_000,   # elements of transform results
    "max_pixels": 64_000_000,        # per transform result, see capabilities
}

CEILINGS = {
    "max_iterations": 100_000,
    "max_ops": 5_000_000,
    "max_calls": 500_000,
    "max_collection": 1_000_000,
    "max_tensor_elements": 1_000_000_000,
    # max_pixels is a per-result cap rather than a budget, and a node cannot
    # ask for more of it, so its ceiling is its default
    "max_pixels": 64_000_000,
}

POLICY_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "flow_policy.json")
POLICY_ENV = "MAINODES_FLOW_POLICY"      # a sandbox points this at its own file
# Named LLM endpoints (spec 9.4). A workflow carries the NAME, never a base
# url and never a key: that is what stops a shared workflow deciding where a
# user's images go. The key is read from the environment variable the
# provider names.
LLM_PROVIDERS = {
    "local": {"kind": "openai_compatible",
              "base_url": "http://127.0.0.1:8080/v1",
              "api_key_env": "MAINODES_LLM_KEY_LOCAL",
              "default_model": "local-model"},
}
# max_tokens is not in DEFAULTS/CEILINGS because it has no node default here
# and no effective() semantics: the node ships its own default and this is the
# only ceiling over it
LLM_MAX_TOKENS_CEILING = 32768           # above the node default of 512
# Optional capability packs (spec 5.3, 8.5). A capability in a pack that is
# not enabled is refused by Safe Function at queue time and again at the call,
# with the key to set. register() refuses a pack name that is not listed here.
OPTIONAL_PACKS = ("transforms",)

_CACHE: dict = {}


class PolicyError(ValueError):
    """The policy file exists but cannot be honoured. Never silently ignored."""


# llm_providers is an object, enable_packs a list of pack names, safe_function
# a bool; every other key is a positive number
_KNOWN_OBJECTS = ("llm_providers",)
_KNOWN_LISTS = ("enable_packs",)
_KNOWN_BOOLS = ("safe_function",)
_KNOWN = (set(CEILINGS) | set(_KNOWN_OBJECTS) | set(_KNOWN_LISTS) | set(_KNOWN_BOOLS)
          | {"llm_max_tokens"})


def _validated(loaded, path: str) -> dict:
    """Every key known, every ceiling a positive number, or PolicyError."""
    if not isinstance(loaded, dict):
        raise PolicyError(f"{path} is a JSON object of policy keys, and its top level "
                          f"is a {type(loaded).__name__}")
    for key, value in loaded.items():
        if key not in _KNOWN:
            raise PolicyError(
                f"{path} sets '{key}', which is not a policy key, so it restricts "
                f"nothing. Known keys: {', '.join(sorted(_KNOWN))}")
        if key in _KNOWN_OBJECTS:
            if not isinstance(value, dict):
                raise PolicyError(f"{path}: '{key}' is a JSON object, got "
                                  f"{type(value).__name__}")
            continue
        if key in _KNOWN_LISTS:
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                raise PolicyError(f"{path}: '{key}' is a JSON list of pack names, got "
                                  f"{value!r}")
            unknown = sorted(set(value) - set(OPTIONAL_PACKS))
            if unknown:
                raise PolicyError(
                    f"{path}: '{key}' names {unknown}, which is not an optional pack, "
                    f"so it enables nothing. Optional packs: {', '.join(OPTIONAL_PACKS)}")
            continue
        if key in _KNOWN_BOOLS:
            if not isinstance(value, bool):
                raise PolicyError(f"{path}: '{key}' is true or false, got {value!r}; "
                                  f"a quoted \"false\" would otherwise read as on")
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise PolicyError(
                f"{path} sets {key} to {value!r}. A ceiling is a positive number; "
                f"quoting it or setting it to zero would otherwise return the "
                f"shipped ceiling with nothing said")
    return loaded


def policy_path(path: str | None = None) -> str:
    """An explicit path, then the env override, then the pack root's file."""
    return path or os.environ.get(POLICY_ENV) or POLICY_PATH


def _loaded(path: str) -> dict:
    """The validated policy file, cached on its mtime. Absent means {}.

    Anything else that goes wrong raises, and the failure is cached with the
    mtime too, so a broken file is not re-read on every capability call and is
    picked up again the moment it is edited.
    """
    try:
        stamp = os.stat(path).st_mtime_ns
    except OSError:
        return {}                # NO FILE is the only "use the shipped defaults"
    cached = _CACHE.get(path)
    if cached is not None and cached[0] == stamp:
        if isinstance(cached[1], PolicyError):
            raise cached[1]
        return cached[1]
    try:
        with open(path, "r", encoding="utf-8") as fh:
            result = _validated(json.load(fh), path)
    except PolicyError as e:              # a ValueError too: catch it first
        _CACHE[path] = (stamp, e)
        raise
    except (OSError, ValueError) as e:
        error = PolicyError(f"{path} exists but cannot be read as JSON ({e}). Fix it "
                            f"or remove it; it is not ignored, because a policy that "
                            f"evaporates on a typo is a restriction nobody is watching")
        _CACHE[path] = (stamp, error)
        raise error
    _CACHE[path] = (stamp, result)
    return result


def ceilings(path: str | None = None) -> dict:
    """CEILINGS with the JSON override applied, cached on the file mtime."""
    values = dict(CEILINGS)
    for field, value in _loaded(policy_path(path)).items():
        if field in CEILINGS:            # _validated already proved it usable
            values[field] = type(CEILINGS[field])(value)
    return values


def llm_providers(path: str | None = None) -> dict:
    """The shipped providers, replaced name by name from the policy file."""
    providers = {name: dict(spec) for name, spec in LLM_PROVIDERS.items()}
    loaded = _loaded(policy_path(path)).get("llm_providers")
    for name, spec in (loaded or {}).items() if isinstance(loaded, dict) else ():
        if isinstance(spec, dict):
            providers[str(name)] = dict(spec)
    return providers


def enabled_packs(path: str | None = None) -> frozenset:
    """The optional packs this installation turned on. None unless the file says so."""
    return frozenset(_loaded(policy_path(path)).get("enable_packs", ()))


def safe_function_enabled(path: str | None = None) -> bool:
    """Spec 8.5: an administrator can turn the node off entirely."""
    return bool(_loaded(policy_path(path)).get("safe_function", True))


def llm_max_tokens(requested, path: str | None = None) -> int:
    """The node's max_tokens lowered by the installation ceiling."""
    # int|float like ceilings(): 2048.0 in a policy file meant the same thing
    # to an administrator and was silently ignored here
    ceiling = _loaded(policy_path(path)).get("llm_max_tokens")
    ok = isinstance(ceiling, (int, float)) and not isinstance(ceiling, bool) and ceiling > 0
    return min(int(ceiling) if ok else LLM_MAX_TOKENS_CEILING, int(requested))


def effective(field: str, requested=None, path: str | None = None):
    """The node's setting lowered by the installation ceiling.

    No setting at all means the node default, never the ceiling: a caller
    that omits a budget is asking for the shipped behaviour, not for the
    most an installation would tolerate.
    """
    ceiling = ceilings(path)[field]
    if requested is None:
        requested = DEFAULTS[field]
    return min(ceiling, requested)


def check_positive(field: str, value) -> str | None:
    """The message for a budget that is not a positive number, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return f"{field} must be a positive whole number, got {value!r}"
    if value <= 0:
        return (f"{field} must be greater than 0, got {value}; "
                f"there is no unlimited setting")
    return None
