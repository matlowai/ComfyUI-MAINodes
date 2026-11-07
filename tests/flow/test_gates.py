"""Acceptance gates A, B, C, D and G against a live sandboxed ComfyUI.

    PYTHONPATH=/mnt/work/ai/apps/ComfyUI \\
        python -m pytest tests/flow/test_gates.py -x -q -p no:cacheprovider

One CPU server per module, started and torn down by the fixture whatever
happens in between. Execution counts come from the Flow Probe files under
the sandbox's own output directory; every run gets a fresh salt so the
result cache can never hide a second execution.
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
_salt = itertools.count(1)


@pytest.fixture(scope="module")
def lab():
    server = FlowLab()
    try:
        server.start()
        # The fence is not allowed to drop quietly: an unfenced lab shares
        # host RAM, the real ceiling on a workstation, with whatever else is
        # resident. Machines without user systemd scopes (containers, macOS)
        # cannot fence at all, so they opt out explicitly and loudly rather
        # than having the suite pass as if it had fenced.
        if not server.fenced:
            if os.environ.get("MAINODES_FLOW_ALLOW_UNFENCED") != "1":
                raise AssertionError(
                    "the lab fell back to an UNFENCED server (systemd-run "
                    f"refused); see {server.log_path}. Set "
                    "MAINODES_FLOW_ALLOW_UNFENCED=1 to run anyway on a "
                    "machine that cannot fence.")
            print("\nWARNING: lab is UNFENCED (MAINODES_FLOW_ALLOW_UNFENCED=1); "
                  "it shares host RAM with everything else resident.")
        server.assert_isolated()
        yield server
    finally:
        # unconditional: a failing assertion must not leave a server behind
        server.stop()


def probe(source, name, salt, node="probe"):
    return {"class_type": "MAIFlowProbe",
            "inputs": {"value": source, "name": name, "salt": salt, "delay_s": 0.0}}


# --- Gate A: real laziness -------------------------------------------------

def gate_a_prompt(a_value, salt):
    return {
        "src": {"class_type": "EmptyImage",
                "inputs": {"width": 32, "height": 32, "batch_size": 1, "color": 0}},
        "expensive": {"class_type": "EmptyImage",
                      "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 255}},
        "probe": probe(["expensive", 0], "expensive", salt),
        "a": {"class_type": "PrimitiveFloat", "inputs": {"value": a_value}},
        "gate": {"class_type": "MAIFlowGate",
                 "inputs": {"expression": "a != 1.0", "source": ["src", 0],
                            "processed": ["probe", 0], "values.a": ["a", 0]}},
        "out": {"class_type": "PreviewAny", "inputs": {"source": ["gate", 0]}},
    }


def test_gate_a_untaken_branch_never_runs(lab):
    assert lab.probe_count("expensive") == 0
    entry = lab.run(gate_a_prompt(1.0, next(_salt)))
    assert lab.probe_count("expensive") == 0, lab.probe_text("expensive")
    report = entry["outputs"]["gate"]["flow"][0]
    assert report["took"] == "source" and report["values"] == {"a": 1.0}
    assert "probe" not in entry["outputs"], "the skipped probe reported a ui payload"

    entry = lab.run(gate_a_prompt(0.5, next(_salt)))
    assert lab.probe_count("expensive") == 1, lab.probe_text("expensive")
    assert entry["outputs"]["gate"]["flow"][0]["took"] == "processed"
    assert entry["outputs"]["probe"]["flow_probe"][0]["count"] == 1


# --- Gate B: passthrough for every type ------------------------------------

TYPES = {
    "IMAGE": ({"class_type": "EmptyImage",
               "inputs": {"width": 24, "height": 16, "batch_size": 1, "color": 128}},
              {"class_type": "EmptyImage",
               "inputs": {"width": 48, "height": 32, "batch_size": 1, "color": 7}}),
    "MASK": ({"class_type": "SolidMask", "inputs": {"value": 0.25, "width": 8, "height": 8}},
             {"class_type": "SolidMask", "inputs": {"value": 0.75, "width": 8, "height": 8}}),
    "LATENT": ({"class_type": "EmptyLatentImage",
                "inputs": {"width": 64, "height": 64, "batch_size": 1}},
               {"class_type": "EmptyLatentImage",
                "inputs": {"width": 128, "height": 128, "batch_size": 1}}),
    "STRING": ({"class_type": "PrimitiveString", "inputs": {"value": "the original"}},
               {"class_type": "PrimitiveString", "inputs": {"value": "the processed"}}),
    "INT": ({"class_type": "PrimitiveInt", "inputs": {"value": 7}},
            {"class_type": "PrimitiveInt", "inputs": {"value": 9}}),
}


@pytest.mark.parametrize("type_name", sorted(TYPES))
def test_gate_b_passthrough_is_byte_identical(lab, type_name):
    source_node, processed_node = TYPES[type_name]
    salt = next(_salt)
    src_name, sink_name = f"src_{type_name}", f"sink_{type_name}"
    prompt = {
        "src": source_node,
        "other": processed_node,
        "src_probe": probe(["src", 0], src_name, salt),
        "other_probe": probe(["other", 0], f"unused_{type_name}", salt),
        "a": {"class_type": "PrimitiveFloat", "inputs": {"value": 1.0}},
        "gate": {"class_type": "MAIFlowGate",
                 "inputs": {"expression": "a != 1.0", "source": ["src_probe", 0],
                            "processed": ["other_probe", 0], "values.a": ["a", 0]}},
        "sink_probe": probe(["gate", 0], sink_name, salt),
        "out": {"class_type": "PreviewAny", "inputs": {"source": ["sink_probe", 0]}},
    }
    lab.run(prompt)
    assert lab.probe_count(f"unused_{type_name}") == 0
    source_digest = lab.probe_digests(src_name)
    sink_digest = lab.probe_digests(sink_name)
    assert len(source_digest) == 1 and len(sink_digest) == 1
    assert source_digest == sink_digest, f"{type_name} did not pass through unchanged"


# --- Gate C: exclusivity of Lazy Select ------------------------------------

def select_prompt(selector, salt, cases=3):
    prompt = {
        "selector": {"class_type": "PrimitiveInt", "inputs": {"value": selector}},
        "select": {"class_type": "MAIFlowSelect",
                   "inputs": {"selector": ["selector", 0], "labels": "draft,normal,max"}},
        "out": {"class_type": "PreviewAny", "inputs": {"source": ["select", 0]}},
    }
    for i in range(cases):
        prompt[f"img{i}"] = {"class_type": "EmptyImage",
                             "inputs": {"width": 16 + 8 * i, "height": 16,
                                        "batch_size": 1, "color": i}}
        prompt[f"probe{i}"] = probe([f"img{i}", 0], f"case{i}", salt)
        prompt["select"]["inputs"][f"case_{i}"] = [f"probe{i}", 0]
    return prompt


def test_gate_c_exactly_one_case_runs(lab):
    before = [lab.probe_count(f"case{i}") for i in range(3)]
    for selector in range(3):
        entry = lab.run(select_prompt(selector, next(_salt)))
        assert entry["outputs"]["select"]["flow"][0]["took"] == f"case_{selector}"
        after = [lab.probe_count(f"case{i}") for i in range(3)]
        expected = [b + (1 if i == selector else 0) for i, b in enumerate(before)]
        assert after == expected, f"selector {selector}: counts {after}, expected {expected}"
        before = after


def test_lazy_select_labels_and_missing_case(lab):
    prompt = select_prompt(0, next(_salt))
    prompt["selector"] = {"class_type": "PrimitiveString", "inputs": {"value": "max"}}
    entry = lab.run(prompt)
    assert entry["outputs"]["select"]["flow"][0]["took"] == "case_2"

    prompt = select_prompt(0, next(_salt))
    prompt["selector"] = {"class_type": "PrimitiveInt", "inputs": {"value": 5}}
    entry = lab.run(prompt, expect="error")
    messages = json.dumps(entry["status"]["messages"])
    assert "case_5, which is not connected" in messages, messages


# --- Gate D: the shipped example, headless ---------------------------------

def load_example(name):
    with open(os.path.join(EXAMPLES, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def test_gate_d_example_graph_branches_the_same_way(lab):
    for scale, expected in ((1.0, 0), (0.5, 1)):
        prompt = load_example("resize_gate_api.json")
        prompt["resize"]["inputs"]["scale_by"] = scale
        prompt["probe"]["inputs"]["salt"] = next(_salt)
        entry = lab.run(prompt)
        took = entry["outputs"]["gate"]["flow"][0]["took"]
        assert took == ("source" if scale == 1.0 else "processed")
        assert lab.probe_count("resize_gate") == expected, lab.probe_text("resize_gate")


def test_core_logic_tour_example_runs(lab):
    prompt = load_example("core_logic_tour_api.json")
    entry = lab.run(prompt)
    assert "preview" in entry["outputs"]


# --- Gate G: lists ---------------------------------------------------------

def partition_prompt(expression, salt, values=(0, 1, 2, 3, 4), through_probe=True):
    prompt = {
        "list": {"class_type": "CreateList", "inputs": {}},
        "part": {"class_type": "MAIFlowPartition",
                 "inputs": {"items": ["list", 0], "expression": expression}},
        "count_out": {"class_type": "PreviewAny", "inputs": {"source": ["part", 2]}},
    }
    for i, value in enumerate(values):
        prompt[f"n{i}"] = {"class_type": "PrimitiveInt", "inputs": {"value": value}}
        prompt["list"]["inputs"][f"inputs.input{i}"] = [f"n{i}", 0]
    if through_probe:
        prompt["kept_probe"] = probe(["part", 0], "kept", salt)
        prompt["kept_out"] = {"class_type": "PreviewAny", "inputs": {"source": ["kept_probe", 0]}}
    else:
        prompt["kept_out"] = {"class_type": "PreviewAny", "inputs": {"source": ["part", 0]}}
    return prompt


def test_gate_g_partition_counts(lab):
    entry = lab.run(partition_prompt("item > 2", next(_salt)))
    report = entry["outputs"]["part"]["flow"][0]
    assert (report["kept_count"], report["rejected_count"]) == (2, 3), report
    assert lab.probe_count("kept") == 2, lab.probe_text("kept")


def test_filter_counts(lab):
    prompt = partition_prompt("item > 2", next(_salt), through_probe=False)
    prompt["part"]["class_type"] = "MAIFlowFilter"
    prompt["count_out"]["inputs"]["source"] = ["part", 1]
    entry = lab.run(prompt)
    assert entry["outputs"]["part"]["flow"][0]["kept_count"] == 2
    assert entry["outputs"]["count_out"]["text"] == ["2"]


def test_gate_g_empty_kept_list_measured_behaviour(lab):
    """Spec probe 3. An empty Comfy list does NOT map zero times on core 0.33.0.

    Downstream of an empty list there are two measured outcomes, and the
    downstream node runs zero times in neither of them:

    * a node with any other input (a widget, a second link) sees
      max_len_input == 1 from that input and core indexes the empty list at
      0: IndexError in execution.py slice_dict, the node fails;
    * a node whose only input is the empty list takes the
      max_len_input == 0 path and is called ONCE with no arguments at all.
    """
    before = lab.probe_count("kept")
    entry = lab.run(partition_prompt("item > 100", next(_salt)), expect="error")
    assert entry["outputs"]["part"]["flow"][0]["kept_count"] == 0
    assert lab.probe_count("kept") == before, "the probe ran on an empty list"
    error = [m for m in entry["status"]["messages"] if m[0] == "execution_error"][0][1]
    assert error["node_type"] == "MAIFlowProbe"
    assert error["exception_type"] == "IndexError"
    assert "slice_dict" in json.dumps(error["traceback"])

    # different items, so the Partition itself is not served from the cache
    entry = lab.run(partition_prompt("item > 100", next(_salt), values=(0, 1, 2, 3, 5),
                                     through_probe=False))
    assert entry["outputs"]["part"]["flow"][0]["kept_count"] == 0
    assert entry["outputs"]["kept_out"]["text"] == ["None"], \
        "a node fed only an empty list is called once with defaults"


# --- widget read and the sink block (spec 4.1, probes 5 and 6) -------------

def widget_gate_prompt(scale, salt, linked=False, through_probe=False):
    """The resize's scale_by stays INLINE on the resize; the Gate reads it.

    The probe sits on the resize's INPUT, so it is exclusive to the processed
    branch and counts exactly the runs in which the resize was produced.
    """
    prompt = {
        "src": {"class_type": "EmptyImage",
                "inputs": {"width": 32, "height": 32, "batch_size": 1, "color": 0}},
        "in_probe": probe(["src", 0], "widget_gate", salt),
        "resize": {"class_type": "ImageScaleBy",
                   "inputs": {"image": ["in_probe", 0], "upscale_method": "bilinear",
                              "scale_by": scale}},
        "gate": {"class_type": "MAIFlowGate",
                 "inputs": {"expression": "scale_by != 1.0", "source": ["src", 0],
                            "processed": ["resize", 0]}},
        "out": {"class_type": "PreviewAny", "inputs": {"source": ["gate", 0]}},
    }
    if linked:
        prompt["scale"] = {"class_type": "PrimitiveFloat", "inputs": {"value": scale}}
        prompt["resize"]["inputs"]["scale_by"] = ["scale", 0]
    if through_probe:
        prompt["between"] = probe(["resize", 0], "between", salt)
        prompt["gate"]["inputs"]["processed"] = ["between", 0]
    return prompt


def test_gate_reads_the_guarded_nodes_widgets_and_the_cache_sees_them(lab):
    """One salt for every queue, deliberately: the ONLY difference between the
    first two runs is the resize's own inline widget. A Gate whose cache key
    ignored it would be served from the first run's result on the second and
    the resize would never run."""
    salt = next(_salt)
    before = lab.probe_count("widget_gate")
    entry = lab.run(widget_gate_prompt(1.0, salt))
    report = entry["outputs"]["gate"]["flow"][0]
    assert report["took"] == "source" and report["guarded"] == "ImageScaleBy"
    assert report["widgets"] == {"scale_by": 1.0} and report["values"] == {}
    assert lab.probe_count("widget_gate") == before

    entry = lab.run(widget_gate_prompt(0.5, salt))
    assert entry["outputs"]["gate"]["flow"][0]["took"] == "processed"
    assert lab.probe_count("widget_gate") == before + 1, "cache served a stale decision"

    entry = lab.run(widget_gate_prompt(1.0, salt))
    assert entry["outputs"]["gate"]["flow"][0]["took"] == "source"
    assert lab.probe_count("widget_gate") == before + 1

    # a fourth value: the decision flips again and the Gate is not served from
    # the cache. The probe upstream of the resize CAN be, since its own key has
    # not changed since the second queue, so the count is not asserted here.
    entry = lab.run(widget_gate_prompt(0.75, salt))
    assert entry["outputs"]["gate"]["flow"][0]["took"] == "processed"
    cached = [m[1]["nodes"] for m in entry["status"]["messages"] if m[0] == "execution_cached"]
    assert "gate" not in sum(cached, []) and "resize" not in sum(cached, [])


def test_a_data_predicate_still_works_on_a_gate_that_reads_widgets(lab):
    """`image.width(a)` names `image`, a registry prefix, not a value; the
    widget read must not mistake a callee for a widget it cannot find."""
    salt = next(_salt)
    prompt = widget_gate_prompt(0.5, salt)
    prompt["a"] = {"class_type": "EmptyImage",
                   "inputs": {"width": 8, "height": 8, "batch_size": 1, "color": 1}}
    prompt["gate"]["inputs"]["expression"] = "image.width(a) < 16 and scale_by != 1.0"
    prompt["gate"]["inputs"]["values.a"] = ["a", 0]
    entry = lab.run(prompt)
    report = entry["outputs"]["gate"]["flow"][0]
    assert report["took"] == "processed"
    assert report["widgets"] == {"scale_by": 0.5} and report["values"] == {"a": "IMAGE[1,8,8,3]"}


def test_a_linked_widget_is_refused_by_name(lab):
    entry = lab.run(widget_gate_prompt(0.5, next(_salt), linked=True), expect="error")
    messages = json.dumps(entry["status"]["messages"])
    assert "'scale_by' is a widget on ImageScaleBy that arrives on a link" in messages, messages


def test_the_guarded_node_is_the_direct_producer_of_processed(lab):
    entry = lab.run(widget_gate_prompt(0.5, next(_salt), through_probe=True), expect="error")
    messages = json.dumps(entry["status"]["messages"])
    assert "neither a connected value nor a widget on MAIFlowProbe" in messages, messages
    assert lab.probe_count("between") == 0


def saved_files(lab, prefix):
    return sorted(f for f in os.listdir(lab.output) if f.startswith(prefix))


def test_a_gate_with_no_source_blocks_the_sink(lab):
    """Skip when, on a Save: a false expression with source unconnected emits
    core's ExecutionBlocker, and SaveImage neither runs nor errors."""
    def prompt(a_value, salt):
        return {
            "src": {"class_type": "EmptyImage",
                    "inputs": {"width": 16, "height": 16, "batch_size": 1, "color": 0}},
            "probe": probe(["src", 0], "sink", salt),
            "a": {"class_type": "PrimitiveFloat", "inputs": {"value": a_value}},
            "gate": {"class_type": "MAIFlowGate",
                     "inputs": {"expression": "a != 1.0", "processed": ["probe", 0],
                                "values.a": ["a", 0]}},
            "save": {"class_type": "SaveImage",
                     "inputs": {"images": ["gate", 0], "filename_prefix": "sink_block"}},
        }
    assert saved_files(lab, "sink_block") == []
    entry = lab.run(prompt(1.0, next(_salt)))
    assert entry["outputs"]["gate"]["flow"][0]["took"] == "blocked"
    assert "save" not in entry["outputs"] and saved_files(lab, "sink_block") == []
    assert lab.probe_count("sink") == 0
    entry = lab.run(prompt(0.5, next(_salt)))
    assert entry["outputs"]["gate"]["flow"][0]["took"] == "processed"
    assert len(saved_files(lab, "sink_block")) == 1 and lab.probe_count("sink") == 1


# --- Gate H / the widget-order baseline ------------------------------------

def test_no_javascript_ships_in_phase_1():
    web = os.path.join(REPO, "web")
    flow_js = [p for p in os.listdir(web) if "flow" in p.lower()] if os.path.isdir(web) else []
    assert flow_js == [], f"phase 1 ships no frontend code, found {flow_js}"


# The frozen input order of every shipped node, required side then optional
# side, exactly as /object_info reports it. A new input is APPENDED to the
# end of its own side forever after this ships: inserting one shifts every
# saved workflow's widget values by a slot. This literal is the migration
# rule's only enforcement, so it covers all six ids and both sides.
WIDGET_ORDER = {
    "MAIFlowCondition": (["expression", "values"], []),
    "MAIFlowFilter": (["items", "expression"], ["values"]),
    "MAIFlowGate": (["expression", "processed"], ["source", "values"]),
    "MAIFlowLLMChoose": (["cases", "prompt", "provider", "model", "seed",
                          "temperature", "max_tokens"], ["images", "args_schema"]),
    "MAIFlowLLMJudge": (["prompt", "provider", "model", "output_type", "json_schema",
                         "seed", "temperature", "max_tokens"], ["images"]),
    "MAIFlowPartition": (["items", "expression"], ["values"]),
    "MAIFlowProbe": (["value", "name", "salt", "delay_s"], []),
    "MAIFlowSafeFunction": (["source", "max_iterations", "max_ops", "max_calls",
                             "max_collection", "max_tensor_elements"],
                            list("abcdefghijkl")),
    "MAIFlowSelect": (["selector"],
                      ["labels"] + [f"case_{i}" for i in range(8)] + ["default"]),
}


def test_widget_order_baseline(lab):
    info = lab.object_info()
    order = {}
    for node_id in sorted(n for n in info if n.startswith("MAIFlow")):
        spec = info[node_id]["input"]
        order[node_id] = (list(spec.get("required", {})), list(spec.get("optional", {})))
    print(json.dumps(order, indent=2))
    assert sorted(order) == sorted(WIDGET_ORDER), "a MAIFlow node appeared or vanished"
    for node_id, expected in sorted(WIDGET_ORDER.items()):
        required, optional = order[node_id]
        assert required == expected[0], f"{node_id} required order changed: {required}"
        assert optional == expected[1], f"{node_id} optional order changed: {optional}"
