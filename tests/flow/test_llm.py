"""LLM Judge and LLM Choose against a recording local server (spec 9).

    PYTHONPATH=/mnt/work/ai/apps/ComfyUI \\
        python -m pytest tests/flow/test_llm.py -x -q -p no:cacheprovider

No real network: every exchange goes to tests/flow/mock_llm.py on a loopback
ephemeral port, named by a policy file the test writes into its own tmp
directory and points MAINODES_FLOW_POLICY at, so nothing is written inside
the pack. The last three tests use the sandboxed ComfyUI, because only the
server proves that a selector reaches Lazy Select and that a provider
arriving on a LINK is still refused: core passes None to validate_inputs
for a linked input, so the queue-time check cannot see it at all.
"""
import base64
import io as std_io
import itertools
import json
import logging
import os
import subprocess
import sys
import time
import urllib.error

import pytest
import torch
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)
sys.path.insert(0, HERE)

from flow import llm, policy  # noqa: E402
from flow.llm import LLMError, MAIFlowLLMChoose, MAIFlowLLMJudge  # noqa: E402
from harness import FlowLab  # noqa: E402
from mock_llm import PATH, DripServer, MockLLM  # noqa: E402

EXAMPLES = os.path.join(REPO, "examples", "flow")
CASES = "case_a: the cheap pass\ncase_b: the everyday path\ncase_c: the expensive pass"
_salt = itertools.count(3000)


@pytest.fixture
def mock():
    with MockLLM() as server:
        yield server


@pytest.fixture
def local(mock, tmp_path, monkeypatch):
    """The mock server, named "local" in a policy file this test owns."""
    monkeypatch.setenv(policy.POLICY_ENV, mock.policy(str(tmp_path / "flow_policy.json")))
    monkeypatch.delenv("MAINODES_TEST_LLM_KEY", raising=False)
    return mock


judge = MAIFlowLLMJudge.execute


def choose(**kwargs):
    return MAIFlowLLMChoose.execute(cases=CASES, **kwargs)


def test_judge_request_shape_and_image_encoding(local, monkeypatch):
    monkeypatch.setenv("MAINODES_TEST_LLM_KEY", "test-key")
    images = torch.zeros(10, 200, 2048, 3)          # ten frames, cap is eight
    result = judge(prompt="is the shot dark?", provider="local", output_type="BOOL",
                   seed=7, temperature=0.0, max_tokens=64, images=images)
    body = local.last
    print(json.dumps(body)[:400])
    assert body["model"] == "mock-model"            # the provider's default_model
    assert body["seed"] == 7 and body["temperature"] == 0.0 and body["max_tokens"] == 64
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "flow_judgement", "strict": True,
                        "schema": {"type": "object",
                                   "properties": {"value": {"type": "boolean"}},
                                   "required": ["value"], "additionalProperties": False}}}
    parts = body["messages"][0]["content"]
    assert parts[0] == {"type": "text", "text": "is the shot dark?"}
    assert len(parts) == 1 + llm.MAX_IMAGES, "the frame cap did not apply"
    urls = [part["image_url"]["url"] for part in parts[1:]]
    assert all(url.startswith("data:image/png;base64,") for url in urls)
    decoded = Image.open(std_io.BytesIO(base64.b64decode(urls[0].split(",", 1)[1])))
    assert max(decoded.size) == llm.IMAGE_LONG_SIDE, decoded.size
    assert local.headers[-1].get("Authorization") == "Bearer test-key"
    assert result.result[0] is True                 # the mock echoed {"value": true}


def test_the_key_is_never_in_the_request_body(local, monkeypatch):
    monkeypatch.setenv("MAINODES_TEST_LLM_KEY", "test-key")
    judge(prompt="p", provider="local")
    assert "test-key" not in json.dumps(local.last)


def test_choose_request_shape(local):
    local.queue_tool("case_b", {"style": "noir"})
    result = choose(prompt="pick one", provider="local", seed=3, max_tokens=32,
                    args_schema='{"style": {"type": "string"}}')
    body = local.last
    print(json.dumps(body)[:600])
    assert body["tool_choice"] == "required"
    assert [tool["function"]["name"] for tool in body["tools"]] == \
        ["case_a", "case_b", "case_c"]
    first = body["tools"][0]["function"]
    assert first["strict"] is True and first["description"] == "the cheap pass"
    assert first["parameters"] == {"type": "object",
                                   "properties": {"style": {"type": "string"}},
                                   "required": ["style"], "additionalProperties": False}
    assert result.result[:3] == (1, "case_b", '{"style": "noir"}')


def test_choose_without_args_schema_sends_empty_strict_parameters(local):
    local.queue_tool("case_a")
    assert choose(prompt="pick", provider="local").result[:3] == (0, "case_a", "{}")
    assert local.last["tools"][0]["function"]["parameters"] == {
        "type": "object", "properties": {}, "required": [], "additionalProperties": False}


@pytest.mark.parametrize("output_type,content,expected", [
    ("BOOL", '{"value": true}', (True, 1, 1.0, "true")),
    ("BOOL", '{"value": false}', (False, 0, 0.0, "false")),
    ("INT", '{"value": 7}', (True, 7, 7.0, "7")),
    ("FLOAT", '{"value": 0.25}', (True, 0, 0.25, "0.25")),
    # a word with no number in it falls back to the decision: yes is 1
    ("STRING", '{"value": "yes"}', (True, 1, 1.0, "yes")),
    ("STRING", '{"value": "2.5"}', (True, 2, 2.5, "2.5")),
    ("STRING", '{"value": ""}', (False, 0, 0.0, "")),
])
def test_judge_coercions(local, output_type, content, expected):
    local.queue_content(content)
    result = judge(prompt="p", provider="local", output_type=output_type)
    assert result.result[:4] == expected
    assert result.result[4] == content, "raw is the model text, unparsed"


def test_judge_json_output_type_carries_the_authored_schema(local):
    schema = '{"type": "object", "properties": {"reason": {"type": "string"}}}'
    local.queue_content('{"reason": "too dark"}')
    result = judge(prompt="p", provider="local", output_type="JSON", json_schema=schema)
    assert local.last["response_format"]["json_schema"]["schema"] == json.loads(schema)
    assert result.result[3] == '{"reason": "too dark"}' and result.result[0] is True


def test_judge_falls_back_to_the_first_json_object_in_the_text(local):
    local.queue_content('Sure. {"value": 4} is my answer.')
    assert judge(prompt="p", provider="local", output_type="INT").result[1] == 4


def test_judge_refuses_an_answer_with_no_json(local):
    local.queue_content("definitely dark")
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local", output_type="BOOL")
    assert "did not answer with a JSON object" in str(e.value)


def test_judge_refuses_an_answer_missing_the_value_key(local):
    local.queue_content('{"verdict": true}')
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local", output_type="BOOL")
    assert "no 'value' key" in str(e.value)


def test_the_ui_payload_reports_provider_model_request_id_and_decision(local):
    local.queue_content('{"value": 3}')
    report = judge(prompt="p", provider="local", output_type="INT").ui["flow_llm"][0]
    assert report == {"provider": "local", "model": "mock-model",
                      "request_id": "mock-request-1", "decision": 3}


def test_choose_refuses_a_tool_that_is_not_a_case(local):
    local.queue_tool("case_z")
    with pytest.raises(LLMError) as e:
        choose(prompt="p", provider="local")
    assert "'case_z', which is not one of the cases (case_a, case_b, case_c)" in str(e.value)


def test_choose_refuses_an_answer_with_no_tool_call(local):
    local.queue_content("I would use case_b")
    with pytest.raises(LLMError) as e:
        choose(prompt="p", provider="local")
    assert "without calling a case" in str(e.value)
    assert "case_b" in str(e.value), "the error names the cases it would accept"


def test_arguments_are_parsed_as_json_never_string_matched(local):
    local.queue_tool("case_c", {"note": 'case_a is "better"'})
    result = choose(prompt="p", provider="local")
    assert result.result[0] == 2 and json.loads(result.result[2]) == \
        {"note": 'case_a is "better"'}


@pytest.mark.parametrize("cases,message", [
    ("", "cases is empty"),
    ("no colon here", "one `name: description` per line"),
    ("two words: fine", "'two words' is not an identifier"),
    ("a: one\na: two", "'a' is named twice"),
    ("\n".join(f"c{i}: x" for i in range(9)), "9 cases, and Lazy Select has 8 slots"),
])
def test_cases_are_checked_before_anything_is_sent(local, cases, message):
    with pytest.raises(LLMError) as e:
        MAIFlowLLMChoose.execute(cases=cases, prompt="p", provider="local")
    assert message in str(e.value)
    assert local.requests == [], "a refused case list still reached the network"


def test_an_unknown_provider_names_the_policy_file(local, tmp_path):
    where = str(tmp_path / "flow_policy.json")
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="somewhere-else")
    assert str(e.value) == (
        "unknown LLM provider 'somewhere-else'. A workflow names a provider and "
        f"never an endpoint or a key, so add it to {where}. Known providers: local")
    assert MAIFlowLLMJudge.validate_inputs(provider="somewhere-else") == str(e.value)
    assert local.requests == []


@pytest.mark.parametrize("spec,message", [
    ({"kind": "anthropic", "base_url": "http://127.0.0.1:1/v1"},
     "kind 'anthropic'; only 'openai_compatible' is implemented"),
    ({"base_url": "file:///etc/passwd"}, "no http base_url"),
])
def test_a_provider_entry_that_cannot_be_used_says_why(tmp_path, monkeypatch,
                                                       spec, message):
    path = str(tmp_path / "flow_policy.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"llm_providers": {"named": spec}}, fh)
    monkeypatch.setenv(policy.POLICY_ENV, path)
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="named")
    assert message in str(e.value)


def test_the_shipped_policy_offers_only_a_loopback_provider(monkeypatch):
    monkeypatch.delenv(policy.POLICY_ENV, raising=False)
    monkeypatch.setattr(policy, "POLICY_PATH", "/nonexistent/flow_policy.json")
    providers = policy.llm_providers()
    assert list(providers) == ["local"]
    assert providers["local"]["base_url"].startswith("http://127.0.0.1")


def test_max_tokens_has_no_unlimited_value_and_a_ceiling_can_lower_it(mock, tmp_path,
                                                                      monkeypatch):
    monkeypatch.setenv(policy.POLICY_ENV,
                       mock.policy(str(tmp_path / "flow_policy.json"), llm_max_tokens=16))
    assert MAIFlowLLMJudge.validate_inputs(max_tokens=0).startswith(
        "max_tokens must be greater than 0")
    fields = {i.id: i for i in MAIFlowLLMJudge.define_schema().inputs}
    assert fields["max_tokens"].min == 1 and fields["max_tokens"].default == 512
    judge(prompt="p", provider="local", max_tokens=4096)
    assert mock.last["max_tokens"] == 16, "the installation ceiling did not lower it"
    assert policy.LLM_MAX_TOKENS_CEILING > 512, "a ceiling on the default is advice that lies"
    # int|float, like ceilings(): 2048.0 meant 2048 to whoever wrote the file
    monkeypatch.setenv(policy.POLICY_ENV,
                       mock.policy(str(tmp_path / "float.json"), llm_max_tokens=2048.0))
    judge(prompt="p", provider="local", max_tokens=4096)
    assert mock.last["max_tokens"] == 2048, "a float ceiling was silently ignored"


def test_an_oversized_answer_is_refused_by_its_limit(local, monkeypatch):
    monkeypatch.setattr(llm, "MAX_RESPONSE_BYTES", 32)
    local.queue_content('{"value": true}')
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local")
    assert "over the 32 byte limit" in str(e.value)


def test_the_image_cap_is_the_installation_policy_read_at_use_time(mock, tmp_path,
                                                                   monkeypatch):
    """An administrator lowering max_pixels binds the node that SENDS images."""
    monkeypatch.setenv(policy.POLICY_ENV,
                       mock.policy(str(tmp_path / "flow_policy.json"), max_pixels=1000))
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local", images=torch.zeros(1, 64, 64, 3))
    assert "64x64, over the 1000 pixel limit" in str(e.value)
    assert mock.requests == []


def test_a_longer_batch_is_cut_to_the_frame_cap_and_the_log_line_says_so(local, caplog):
    with caplog.at_level(logging.INFO, logger="flow.llm"):
        judge(prompt="p", provider="local", images=torch.zeros(10, 8, 8, 3))
    assert "LLM Judge: 10 image frames given, sending the first 8 (the cap)" in caplog.text


def test_an_http_error_is_reported_and_never_retried(local):
    local.queue_status(429, {"error": {"message": "slow down"}})
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local")
    assert "answered HTTP 429" in str(e.value) and "slow down" in str(e.value)
    assert len(local.requests) == 1, "an answered request was sent twice"


def test_a_connection_error_is_retried_once(local, monkeypatch):
    attempts = []

    class Refusing:                       # the package's own opener, refusing
        def open(self, *args, **kwargs):
            attempts.append(1)
            raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(llm, "opener_for", lambda name: Refusing())
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local")
    assert len(attempts) == 2 and "could not reach provider 'local'" in str(e.value)


def test_a_post_send_failure_is_wrapped_and_names_the_provider(tmp_path, monkeypatch):
    """getresponse() is outside urllib's URLError wrapper: a hangup arrives bare."""
    with DripServer(hangup=True) as dead:
        monkeypatch.setenv(policy.POLICY_ENV,
                           dead.policy(str(tmp_path / "flow_policy.json")))
        with pytest.raises(LLMError) as e:
            judge(prompt="p", provider="local")
    print(str(e.value))
    assert "provider 'local' broke the exchange after the request was sent" in str(e.value)


def test_a_redirect_is_refused_and_the_key_never_reaches_the_named_host(tmp_path,
                                                                       monkeypatch):
    """One 302 from a configured gateway otherwise hands over key and branch."""
    with MockLLM() as elsewhere, \
            MockLLM(redirect_to=f"http://127.0.0.1:{elsewhere.port}{PATH}") as gateway:
        monkeypatch.setenv(policy.POLICY_ENV,
                           gateway.policy(str(tmp_path / "flow_policy.json")))
        monkeypatch.setenv("MAINODES_TEST_LLM_KEY", "test-key")
        with pytest.raises(LLMError) as e:
            judge(prompt="p", provider="local")
        print(str(e.value))
        assert f"provider 'local' answered HTTP 302 redirecting to " \
               f"'http://127.0.0.1:{elsewhere.port}', and a redirect is refused" \
               in str(e.value)
        assert elsewhere.hits == [], "the redirect was followed to another host"
        assert gateway.hits == [PATH], gateway.hits


def test_a_proxy_environment_variable_cannot_move_the_destination(local, monkeypatch):
    with MockLLM() as proxy:
        for name in ("http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"):
            monkeypatch.setenv(name, f"http://127.0.0.1:{proxy.port}")
        judge(prompt="p", provider="local")
        assert proxy.hits == [], "an environment variable re-pointed the request"
        assert len(local.requests) == 1, "the configured host did not get the request"


def test_the_package_never_calls_urlopen():
    """The default opener follows redirects, so no file here may reach for it."""
    for name in sorted(n for n in os.listdir(os.path.join(REPO, "flow")) if n[-3:] == ".py"):
        with open(os.path.join(REPO, "flow", name), encoding="utf-8") as fh:
            assert "urlopen" not in fh.read(), f"flow/{name} calls urlopen"


def test_a_dripping_server_cannot_outlast_the_exchange_deadline(tmp_path, monkeypatch):
    """One byte per timeout resets a per-socket clock forever; a deadline ends it."""
    with DripServer(interval=0.02) as drip:
        monkeypatch.setenv(policy.POLICY_ENV,
                           drip.policy(str(tmp_path / "flow_policy.json")))
        monkeypatch.setattr(llm, "REQUEST_TIMEOUT", 1.0)
        started = time.monotonic()
        with pytest.raises(LLMError) as e:
            judge(prompt="p", provider="local")
        elapsed = time.monotonic() - started
    print(f"{elapsed:.2f}s: {e.value}")
    assert "did not finish its answer inside the 1 second deadline" in str(e.value)
    assert elapsed < 5.0, f"a 1 s deadline took {elapsed:.1f} s"


def test_the_policy_file_is_gitignored():
    """The one file guaranteed to carry an endpoint lives in a git checkout."""
    done = subprocess.run(["git", "check-ignore", "-v", "flow_policy.json"],
                          cwd=REPO, capture_output=True, text=True)
    print(done.stdout.strip() or done.stderr.strip())
    assert done.returncode == 0, "flow_policy.json is committable"


def test_neither_the_key_nor_the_resolved_url_reaches_the_ui_or_an_error(local,
                                                                        monkeypatch):
    monkeypatch.setenv("MAINODES_TEST_LLM_KEY", "test-key")
    local.queue_content('{"value": 1}')
    reported = json.dumps(judge(prompt="p", provider="local", output_type="INT").ui)
    local.queue_content("no json in this answer")
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local")
    for text in (reported, str(e.value)):
        assert "test-key" not in text and local.base_url not in text
        assert "127.0.0.1" not in text, text


@pytest.mark.parametrize("content", ['{"value": NaN}', '{"value": 1e400}',
                                     '{"value": %s}' % ("9" * 400)])
def test_a_schema_legal_number_that_is_not_one_is_an_error_not_a_crash(local, content):
    local.queue_content(content)
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local", output_type="FLOAT")
    print(str(e.value)[:160])
    assert "is schema-legal but is not a number this node can put on its INT" in str(e.value)


def test_a_pasted_json_schema_envelope_is_refused_by_name(local):
    with pytest.raises(LLMError) as e:
        judge(prompt="p", provider="local", output_type="JSON",
              json_schema='{"name": "verdict", "schema": {"type": "object"}}')
    assert 'json_schema is the schema itself, not the {"name": ...' in str(e.value)
    assert local.requests == [], "an unusable schema still reached the network"


@pytest.mark.parametrize("name", sorted(n for n in os.listdir(EXAMPLES)
                                        if n.endswith(".json")))
def test_no_example_carries_an_endpoint_or_a_key(name):
    with open(os.path.join(EXAMPLES, name), "r", encoding="utf-8") as fh:
        text = fh.read()
    for forbidden in ("http://", "https://", "api_key", "Bearer", "base_url"):
        assert forbidden not in text, f"{name} carries {forbidden!r}"


@pytest.fixture(scope="module")
def live(tmp_path_factory):
    """A lab whose policy file names a mock server on a loopback port."""
    with MockLLM() as mock:
        path = mock.policy(str(tmp_path_factory.mktemp("policy") / "flow_policy.json"))
        server = FlowLab(env={policy.POLICY_ENV: path})
        try:
            server.start()
            if not server.fenced and os.environ.get("MAINODES_FLOW_ALLOW_UNFENCED") != "1":
                raise AssertionError(
                    "the lab fell back to an UNFENCED server (systemd-run refused); "
                    f"see {server.log_path}. Set MAINODES_FLOW_ALLOW_UNFENCED=1 to "
                    "run anyway on a machine that cannot fence.")
            info = server.assert_isolated()
            assert "MAIFlowLLMChoose" in info and "MAIFlowLLMJudge" in info
            yield server, mock, path
        finally:
            server.stop()


def choose_select_prompt(salt, provider="local"):
    prompt = {
        "choose": {"class_type": "MAIFlowLLMChoose",
                   "inputs": {"cases": CASES, "prompt": "pick the everyday path",
                              "provider": provider, "model": "", "seed": salt,
                              "temperature": 0.0, "max_tokens": 64}},
        "select": {"class_type": "MAIFlowSelect",
                   "inputs": {"selector": ["choose", 0],
                              "labels": "case_a,case_b,case_c"}},
        "out": {"class_type": "PreviewAny", "inputs": {"source": ["select", 0]}},
    }
    for index in range(3):
        prompt[f"img{index}"] = {"class_type": "EmptyImage",
                                 "inputs": {"width": 16 + 8 * index, "height": 16,
                                            "batch_size": 1, "color": index}}
        prompt[f"probe{index}"] = {"class_type": "MAIFlowProbe",
                                   "inputs": {"value": [f"img{index}", 0],
                                              "name": f"llm_case{index}", "salt": salt,
                                              "delay_s": 0.0}}
        prompt["select"]["inputs"][f"case_{index}"] = [f"probe{index}", 0]
    return prompt


def test_choose_drives_lazy_select_and_only_one_case_runs(live):
    server, mock, _ = live
    before = [server.probe_count(f"llm_case{i}") for i in range(3)]
    mock.queue_tool("case_b")
    entry = server.run(choose_select_prompt(next(_salt)))
    report = entry["outputs"]["choose"]["flow_llm"][0]
    assert report["decision"] == {"selector": 1, "label": "case_b", "args": {}}
    assert report["provider"] == "local" and report["model"] == "mock-model"
    assert entry["outputs"]["select"]["flow"][0]["took"] == "case_1"
    after = [server.probe_count(f"llm_case{i}") for i in range(3)]
    assert after == [before[0], before[1] + 1, before[2]], after


def test_the_shipped_example_runs_headless(live):
    server, mock, _ = live
    with open(os.path.join(EXAMPLES, "llm_choose_select_api.json"), encoding="utf-8") as fh:
        prompt = json.load(fh)
    prompt["probe"]["inputs"]["salt"] = next(_salt)
    mock.queue_tool("light")
    entry = server.run(prompt)
    assert entry["outputs"]["select"]["flow"][0]["took"] == "case_1"
    assert server.probe_count("llm_choose_select") == 0, "the expensive branch ran"


def test_a_provider_on_a_link_is_still_checked_on_the_execute_path(live):
    """Core passes None to validate_inputs for a linked input (Phase 3's hole)."""
    server, mock, path = live
    prompt = choose_select_prompt(next(_salt), provider=["provider", 0])
    prompt["provider"] = {"class_type": "PrimitiveString",
                          "inputs": {"value": "somewhere-else"}}
    sent = len(mock.requests)
    entry = server.run(prompt, expect="error")
    messages = json.dumps(entry["status"]["messages"])
    assert "unknown LLM provider 'somewhere-else'" in messages, messages
    assert path in messages, "the error does not name the policy file"
    assert len(mock.requests) == sent, "a refused provider still reached a server"

    # and the linked path still WORKS when the name is one this box configured
    mock.queue_tool("case_c")
    prompt = choose_select_prompt(next(_salt), provider=["provider", 0])
    prompt["provider"] = {"class_type": "PrimitiveString", "inputs": {"value": "local"}}
    entry = server.run(prompt)
    assert entry["outputs"]["select"]["flow"][0]["took"] == "case_2"
