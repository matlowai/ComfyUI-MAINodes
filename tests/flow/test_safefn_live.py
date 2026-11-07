"""Gate G for Safe Function: the planner against a live sandboxed ComfyUI.

    PYTHONPATH=/mnt/work/ai/apps/ComfyUI \\
        python -m pytest tests/flow/test_safefn_live.py -x -q -p no:cacheprovider

The unit tests prove the interpreter plans; only the server proves that the
plan reaches core's executor, that the socket it names becomes a strong
link, and that the producer behind the socket it does NOT name never runs.
Counts come from the Flow Probe files under the sandbox output directory,
with a fresh salt per run so the result cache cannot hide an execution.
"""
import itertools
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

from harness import FlowLab  # noqa: E402

EXAMPLES = os.path.join(REPO, "examples", "flow")
_salt = itertools.count(1000)


@pytest.fixture(scope="module")
def lab():
    server = FlowLab()
    try:
        server.start()
        if not server.fenced:
            if os.environ.get("MAINODES_FLOW_ALLOW_UNFENCED") != "1":
                raise AssertionError(
                    "the lab fell back to an UNFENCED server (systemd-run "
                    f"refused); see {server.log_path}. Set "
                    "MAINODES_FLOW_ALLOW_UNFENCED=1 to run anyway on a "
                    "machine that cannot fence.")
            print("\nWARNING: lab is UNFENCED (MAINODES_FLOW_ALLOW_UNFENCED=1); "
                  "it shares host RAM with everything else resident.")
        info = server.assert_isolated()
        assert "MAIFlowSafeFunction" in info, "Safe Function did not register"
        yield server
    finally:
        server.stop()


def probe(source, name, salt):
    return {"class_type": "MAIFlowProbe",
            "inputs": {"value": source, "name": name, "salt": salt, "delay_s": 0.0}}


def load_example(name):
    with open(os.path.join(EXAMPLES, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


# --- the spec 8 example, both ways -----------------------------------------

def test_the_example_function_runs_the_restore_only_when_enabled(lab):
    """enabled false: the producer behind socket b never runs. True: once."""
    assert lab.probe_count("safe_function") == 0
    prompt = load_example("safe_function_api.json")
    prompt["enabled"]["inputs"]["value"] = False
    prompt["probe"]["inputs"]["salt"] = next(_salt)
    entry = lab.run(prompt)
    assert lab.probe_count("safe_function") == 0, lab.probe_text("safe_function")
    report = entry["outputs"]["safe_function"]["flow"][0]
    assert report["result"] == "IMAGE[1,32,32,3]", report
    assert report["signature"] == ["a=original:IMAGE", "b=restored:IMAGE",
                                   "c=enabled:BOOL", "d=strength:FLOAT"]
    assert report["sockets"] == ["a", "c"], "socket b resolved on the false branch"
    assert "probe" not in entry["outputs"], "the skipped probe reported a ui payload"

    prompt = load_example("safe_function_api.json")
    prompt["enabled"]["inputs"]["value"] = True
    prompt["probe"]["inputs"]["salt"] = next(_salt)
    entry = lab.run(prompt)
    assert lab.probe_count("safe_function") == 1, lab.probe_text("safe_function")
    report = entry["outputs"]["safe_function"]["flow"][0]
    assert report["result"] == "IMAGE[1,64,64,3]", report
    assert entry["outputs"]["probe"]["flow_probe"][0]["count"] == 1


# --- a for / break search that returns early --------------------------------

SEARCH = """def main(target, early, late):
    for i in range(4):
        if i == target:
            return early
    return late
"""


def search_prompt(target, salt):
    prompt = {
        "target": {"class_type": "PrimitiveInt", "inputs": {"value": target}},
        "early_image": {"class_type": "EmptyImage",
                        "inputs": {"width": 16, "height": 16, "batch_size": 1, "color": 1}},
        "late_image": {"class_type": "EmptyImage",
                       "inputs": {"width": 24, "height": 24, "batch_size": 1, "color": 2}},
        "early_probe": probe(["early_image", 0], "search_early", salt),
        "late_probe": probe(["late_image", 0], "search_late", salt),
        "fn": {"class_type": "MAIFlowSafeFunction",
               "inputs": {"source": SEARCH, "a": ["target", 0], "b": ["early_probe", 0],
                          "c": ["late_probe", 0], "max_iterations": 1000,
                          "max_ops": 50000, "max_calls": 5000,
                          "max_collection": 10000,
                          "max_tensor_elements": 100000000}},
        "out": {"class_type": "PreviewAny", "inputs": {"source": ["fn", 0]}},
    }
    return prompt


def test_a_search_that_returns_early_never_requests_socket_c(lab):
    early, late = lab.probe_count("search_early"), lab.probe_count("search_late")
    entry = lab.run(search_prompt(2, next(_salt)))
    assert lab.probe_count("search_early") == early + 1
    assert lab.probe_count("search_late") == late, "socket c ran for a search that hit"
    assert entry["outputs"]["fn"]["flow"][0]["sockets"] == ["a", "b"]
    assert entry["outputs"]["fn"]["flow"][0]["result"] == "IMAGE[1,16,16,3]"

    # a miss walks the whole loop and only then needs c
    entry = lab.run(search_prompt(9, next(_salt)))
    assert lab.probe_count("search_early") == early + 1, "socket b ran for a search that missed"
    assert lab.probe_count("search_late") == late + 1
    assert entry["outputs"]["fn"]["flow"][0]["sockets"] == ["a", "c"]
    assert entry["outputs"]["fn"]["flow"][0]["used"]["max_iterations"] == 4


# --- refusals reach the queue, not the run ---------------------------------

def refuse(lab, prompt) -> str:
    """The queue refusing a prompt: the harness turns 400 into an assertion."""
    with pytest.raises(AssertionError) as e:
        lab.post("/prompt", {"prompt": prompt})
    assert "POST /prompt -> 400" in str(e.value), str(e.value)
    return str(e.value)


def test_a_refused_body_fails_at_queue_time(lab):
    prompt = search_prompt(0, next(_salt))
    prompt["fn"]["inputs"]["source"] = "def main(x):\n    import os\n    return x\n"
    errors = refuse(lab, prompt)
    assert ("Safe Function rejected at line 2: import is not available. Safe "
            "Functions can only call registered capabilities.") in errors
    assert "MAIFlowSafeFunction" in errors


def test_a_budget_of_zero_is_refused_at_queue_time(lab):
    prompt = search_prompt(0, next(_salt))
    prompt["fn"]["inputs"]["max_ops"] = 0
    assert ("max_ops must be greater than 0, got 0; there is no unlimited "
            "setting") in refuse(lab, prompt)


def test_a_budget_exceeded_at_run_time_names_the_line_and_the_setting(lab):
    prompt = search_prompt(9, next(_salt))
    prompt["fn"]["inputs"]["source"] = (
        "def main(x, y, z):\n    total = 0\n    for i in range(100):\n"
        "        for j in range(100):\n            total = total + 1\n    return total\n")
    prompt["fn"]["inputs"]["max_iterations"] = 1000
    # both values are inside the installation ceilings, so the advice the
    # message gives is the node one and it is true
    prompt["fn"]["inputs"]["max_ops"] = 50000
    entry = lab.run(prompt, expect="error")
    error = [m for m in entry["status"]["messages"] if m[0] == "execution_error"][0][1]
    assert error["node_type"] == "MAIFlowSafeFunction"
    assert error["exception_message"].strip() == (
        "Safe Function stopped at line 4: the max_iterations budget of 1000 is "
        "exhausted (used 1001). Raise max_iterations on the node.")


def test_a_budget_the_ceiling_cut_down_points_at_the_policy_file(lab):
    """Advice has to name the limit that bound the value, or it cannot work."""
    prompt = search_prompt(9, next(_salt))
    prompt["fn"]["inputs"]["source"] = (
        "def main(x, y, z):\n    s = 'ab'\n    for i in range(1000):\n"
        "        s = 'ab' * 501\n    return s\n")
    prompt["fn"]["inputs"]["max_iterations"] = 1000
    # the shipped ceiling for max_collection is 1000000, so this node asks
    # for a value it cannot have and the node advice would be unreachable
    prompt["fn"]["inputs"]["max_collection"] = 10000000
    entry = lab.run(prompt, expect="error")
    error = [m for m in entry["status"]["messages"] if m[0] == "execution_error"][0][1]
    assert error["exception_message"].strip() == (
        "Safe Function stopped at line 4: the max_collection budget of 1000000 "
        "is exhausted (used 1000998). The node asks for 10000000, so raise the "
        "max_collection ceiling of 1000000 in flow_policy.json.")


def test_a_returned_list_requests_every_socket_it_carries(lab):
    """A buried Unknown planned nothing and left a sentinel in the output."""
    salt = next(_salt)
    early, late = lab.probe_count("search_early"), lab.probe_count("search_late")
    prompt = search_prompt(0, salt)
    prompt["fn"]["inputs"]["source"] = "def main(x, y, z):\n    return [y, z]\n"
    entry = lab.run(prompt)
    assert lab.probe_count("search_early") == early + 1
    assert lab.probe_count("search_late") == late + 1
    report = entry["outputs"]["fn"]["flow"][0]
    assert report["sockets"] == ["b", "c"], report      # a is unused, so unproduced
    assert report["result"] == "LIST[2]", report
    assert "Unknown" not in entry["outputs"]["out"]["text"][0], entry["outputs"]["out"]
