"""LLM Judge and LLM Choose: typed model decisions (spec 9).

The model is a predicate or a selector feeding Gate and Lazy Select, never
part of the safe runtime: it can only choose among branches the author
enumerated and fill arguments a schema validates. An injected instruction
riding in on an image can pick the wrong branch; it cannot gain a capability.

THE WORKFLOW NEVER CARRIES AN ENDPOINT OR A KEY. `provider` is a NAME
resolved through `flow_policy.json` (`flow/policy.py`), so a workflow from
anywhere cannot decide where a user's images are sent, and the key is read
from the environment variable that entry names. That check runs on the
EXECUTE path, not only in `validate_inputs`: an input arriving on a LINK is
None there, so a check living only there is bypassed by connecting a string.

THE TRANSPORT IS PART OF THAT BOUNDARY. The request must reach the host the
installation configured and no other, so nothing here uses urllib's default
opener (a test greps for its one-call shortcut by name). This package builds
its own: redirects refused, proxy environment ignored, and a deadline on the
whole exchange rather than on each socket operation (spec 9.4).

OpenAI-compatible chat completions over urllib; no SDK is imported and none
is needed. Judge sends a strict `response_format` json_schema and Choose one
strict function tool per case with `tool_choice: "required"`, so the answer
is a case from the list or an error, never a silent default.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO

from PIL import Image

from comfy_api.latest import io

from . import policy
from .nodes import MAIFlowSelect

# Their own category, not MAINodes/Flow. Flow v1's security sentence is
# "workflow JSON stays data"; these are the only nodes in the package with a
# network path, so they sit outside that sentence and carry their own doc
# (AI_DECISIONS.md). Node ids keep the MAIFlow prefix: saved graphs are data.
CATEGORY = "MAINodes/AI Decisions"

MAXIMUM_CASES = MAIFlowSelect.MAX_CASES   # one case per Lazy Select slot
MAX_IMAGES = 8                            # frames SENT, not frames given
IMAGE_LONG_SIDE = 1024                    # long side before encoding
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
READ_CHUNK = 65536                        # one deadline check per chunk
REQUEST_TIMEOUT = 120.0                   # the WHOLE exchange, not one socket op
MAX_TOKENS_DEFAULT = 512
OUTPUT_TYPES = ["BOOL", "INT", "FLOAT", "STRING", "JSON"]
SCALAR_JSON_TYPE = {"BOOL": "boolean", "INT": "integer",
                    "FLOAT": "number", "STRING": "string"}
TRUE_WORDS = {"true", "yes", "y", "1", "on"}
FALSE_WORDS = {"false", "no", "n", "0", "off", "none", "null", ""}

log = logging.getLogger(__name__)


class LLMError(ValueError):
    """A refusal or a failed exchange. The message names what to change."""


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects are refused, not followed (spec 9.4): urllib's default opener
    copies `Authorization` onto the redirect target, so a configured gateway
    answering one 302 hands the key to whatever host it names and then supplies
    the selector that drives the branch. Measured.
    """

    def __init__(self, provider: str):
        self.provider = provider

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(str(newurl))
        where = f"{parts.scheme}://{parts.netloc}" if parts.netloc else str(newurl)
        raise LLMError(f"provider {self.provider!r} answered HTTP {code} redirecting to "
                       f"{where!r}, and a redirect is refused: urllib would send the "
                       f"key with it, and only the base_url in the policy file is a "
                       f"host this installation configured. Point base_url at the "
                       f"host that answers")


def opener_for(provider: str) -> urllib.request.OpenerDirector:
    """The only opener this package uses: no redirects, no proxy environment.

    `ProxyHandler({})` rather than the default, because an `http_proxy`
    variable otherwise re-points even the loopback default, body and key
    intact. A test greps this package for the one-call shortcut by name.
    """
    return urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                       _RefuseRedirect(provider))


def provider_spec(name, path: str | None = None) -> dict:
    """The named provider from policy, or an error naming the policy file."""
    providers = policy.llm_providers(path)
    where = policy.policy_path(path)
    wanted = name.strip() if isinstance(name, str) else ""
    spec = providers.get(wanted) if wanted else None
    if spec is None:
        raise LLMError(f"unknown LLM provider {wanted or name!r}. A workflow names a "
                       f"provider and never an endpoint or a key, so add it to "
                       f"{where}. Known providers: "
                       f"{', '.join(sorted(providers)) or '(none)'}")
    kind = str(spec.get("kind") or "openai_compatible")
    if kind != "openai_compatible":
        raise LLMError(f"provider {wanted!r} has kind {kind!r}; only "
                       f"'openai_compatible' is implemented in this release")
    base_url = str(spec.get("base_url") or "").rstrip("/")
    if not base_url.startswith(("http://", "https://")):
        raise LLMError(f"provider {wanted!r} has no http base_url in {where}")
    return {"name": wanted, "kind": kind, "base_url": base_url,
            "api_key_env": str(spec.get("api_key_env") or ""),
            "default_model": str(spec.get("default_model") or "")}


def encode_images(images) -> tuple[list[str], int]:
    """Up to MAX_IMAGES frames as PNG data urls; also the count GIVEN."""
    if images is None:
        return [], 0
    # at USE time, not import: an administrator lowering max_pixels must bind
    # the node that sends images off the box, not only the Safe Function
    limit = policy.effective("max_pixels")
    frames = list(images) if getattr(images, "ndim", 3) == 4 else [images]
    return [_data_url(frame, limit) for frame in frames[:MAX_IMAGES]], len(frames)


def _data_url(frame, limit: int) -> str:
    # refused before the conversion allocates anything: the copy is the cost
    height, width = int(frame.shape[0]), int(frame.shape[1])
    if height * width > limit:
        raise LLMError(f"an image frame is {width}x{height}, over the "
                       f"{limit} pixel limit for one LLM request")
    array = frame.detach().cpu().float().clamp(0.0, 1.0).mul(255.0).round()
    picture = Image.fromarray(array.numpy().astype("uint8")[:, :, :3])
    longest = max(picture.size)
    if longest > IMAGE_LONG_SIDE:
        scale = IMAGE_LONG_SIDE / float(longest)
        picture = picture.resize((max(1, int(picture.width * scale)),
                                  max(1, int(picture.height * scale))), Image.LANCZOS)
    buffer = BytesIO()
    picture.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _schema_object(text, field: str) -> dict:
    try:
        schema = json.loads(str(text or ""))
    except ValueError as e:
        raise LLMError(f"{field} is not valid JSON: {e}") from None
    if not isinstance(schema, dict):
        raise LLMError(f"{field} is a JSON object, got {type(schema).__name__}")
    return schema


def judge_schema(output_type, json_schema=None) -> dict:
    """The strict schema Judge asks the server to honour."""
    if output_type == "JSON":
        if not str(json_schema or "").strip():
            raise LLMError("output_type JSON needs a json_schema to constrain to")
        schema = _schema_object(json_schema, "json_schema")
        if "schema" in schema and "name" in schema:
            raise LLMError('json_schema is the schema itself, not the {"name": ..., '
                           '"schema": ...} envelope around it: paste the value of '
                           '"schema", which this node wraps for you')
        return schema
    if output_type not in SCALAR_JSON_TYPE:
        raise LLMError(f"output_type is one of {OUTPUT_TYPES}, got {output_type!r}")
    return {"type": "object",
            "properties": {"value": {"type": SCALAR_JSON_TYPE[output_type]}},
            "required": ["value"], "additionalProperties": False}


def _body(prompt, model, seed, temperature, max_tokens, urls, extra) -> dict:
    # seed is sent as well as being a node input: servers that support it
    # honour it, the others ignore it, and the node input is what moves the
    # cache key, so a re-run is a re-run
    parts = [{"type": "text", "text": "" if prompt is None else str(prompt)}]
    parts += [{"type": "image_url", "image_url": {"url": url}} for url in urls]
    return {"model": str(model), "messages": [{"role": "user", "content": parts}],
            "seed": int(seed), "temperature": float(temperature),
            "max_tokens": int(max_tokens), **extra}


def judge_body(prompt, model, output_type, json_schema, seed, temperature,
               max_tokens, urls) -> dict:
    schema = {"name": "flow_judgement", "strict": True,
              "schema": judge_schema(output_type, json_schema)}
    return _body(prompt, model, seed, temperature, max_tokens, urls,
                 {"response_format": {"type": "json_schema", "json_schema": schema}})


def parse_cases(text) -> list[tuple[str, str]]:
    """`name: description` per line; the name becomes a tool name."""
    cases: list[tuple[str, str]] = []
    for number, line in enumerate(str(text or "").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, description = line.partition(":")
        name = name.strip()
        if not separator:
            raise LLMError(f"cases line {number}: one `name: description` per line")
        if not name.isidentifier():
            raise LLMError(f"cases line {number}: {name!r} is not an identifier")
        if any(name == existing for existing, _ in cases):
            raise LLMError(f"cases line {number}: {name!r} is named twice")
        cases.append((name, description.strip()))
    if not cases:
        raise LLMError("cases is empty: LLM Choose picks among the cases you name, "
                       "one `name: description` per line")
    if len(cases) > MAXIMUM_CASES:
        raise LLMError(f"{len(cases)} cases, and Lazy Select has {MAXIMUM_CASES} slots")
    return cases


def choose_tools(cases, args_schema=None) -> list[dict]:
    """One strict function tool per case, sharing the authored properties."""
    properties = {}
    if str(args_schema or "").strip():
        properties = _schema_object(args_schema, "args_schema")
        if not all(isinstance(value, dict) for value in properties.values()):
            raise LLMError('args_schema is a JSON-schema properties object, as in '
                           '{"style": {"type": "string"}}')
    return [{"type": "function",
             "function": {"name": name, "description": description, "strict": True,
                          "parameters": {"type": "object",
                                         "properties": dict(properties),
                                         "required": list(properties),
                                         "additionalProperties": False}}}
            for name, description in cases]


def choose_body(cases, prompt, model, seed, temperature, max_tokens,
                args_schema, urls) -> dict:
    # tool_choice required: a case, or an error, and never a silent default
    return _body(prompt, model, seed, temperature, max_tokens, urls,
                 {"tools": choose_tools(cases, args_schema),
                  "tool_choice": "required"})


def request(spec: dict, body: dict, timeout: float | None = None) -> tuple[dict, dict]:
    """POST the body, returning (payload, headers).

    Each attempt gets a DEADLINE for the whole exchange, connect to last byte,
    not a timeout per socket operation: one byte before each timeout otherwise
    holds the node open indefinitely (measured: 91 s for 92 bytes against a 2 s
    timeout), and interrupt does not reach a blocking read. One retry, and only
    for a connect/send failure.
    """
    timeout = REQUEST_TIMEOUT if timeout is None else float(timeout)
    url = spec["base_url"] + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    key = os.environ.get(spec["api_key_env"]) if spec["api_key_env"] else None
    if key:
        headers["Authorization"] = "Bearer " + key
    data = json.dumps(body).encode("utf-8")
    opener = opener_for(spec["name"])       # the private opener, always
    last = None
    for attempt in (1, 2):
        message = urllib.request.Request(url, data=data, headers=headers, method="POST")
        deadline = time.monotonic() + timeout
        try:
            with opener.open(message, timeout=timeout) as response:
                return (_payload(response, spec["name"], deadline, timeout),
                        dict(response.headers))
        except urllib.error.HTTPError as e:
            # never retried: an answered request may already have been billed,
            # and a 4xx is the same answer the second time
            raise LLMError(f"provider {spec['name']!r} answered HTTP {e.code}: "
                           f"{e.read(4096).decode('utf-8', 'replace')[:500]}") from None
        except urllib.error.URLError as e:      # connect/send: one retry, then out
            last = e
            log.warning("LLM provider %r not reachable (attempt %d): %s",
                        spec["name"], attempt, e.reason)
        except OSError as e:
            # getresponse() runs outside urllib's URLError wrapper: a
            # RemoteDisconnected, a reset or a read timeout arrives bare here,
            # and is not retried because the request was already sent
            raise LLMError(f"provider {spec['name']!r} broke the exchange after the "
                           f"request was sent: {type(e).__name__}: {e}") from None
    raise LLMError(f"could not reach provider {spec['name']!r}: "
                   f"{getattr(last, 'reason', last)}")


def _read_until(response, provider: str, deadline: float, timeout: float) -> bytes:
    """The body in chunks under the exchange deadline: `read1` returns what has
    arrived rather than blocking for a full buffer, so the deadline is checked
    between chunks and a drip cannot outlast it.
    """
    chunks, total = [], 0
    while True:
        if time.monotonic() > deadline:
            raise LLMError(f"provider {provider!r} did not finish its answer inside the "
                           f"{timeout:g} second deadline for one exchange ({total} bytes "
                           f"read). The deadline covers the whole exchange, because a "
                           f"timeout per socket read bounds nothing")
        chunk = response.read1(READ_CHUNK)
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > MAX_RESPONSE_BYTES:
            raise LLMError(f"the provider answer passed the {MAX_RESPONSE_BYTES} byte "
                           f"limit for one response")
        chunks.append(chunk)


def _payload(response, provider: str, deadline: float, timeout: float) -> dict:
    """Read a bounded body: the length is refused before the bytes are kept."""
    declared = response.headers.get("Content-Length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
        raise LLMError(f"the provider answered {declared} bytes, over the "
                       f"{MAX_RESPONSE_BYTES} byte limit for one response")
    raw = _read_until(response, provider, deadline, timeout)
    try:
        payload = json.loads(raw.decode("utf-8", "replace"))
    except ValueError as e:
        raise LLMError(f"the provider answer is not JSON: {e}") from None
    if not isinstance(payload, dict):
        raise LLMError(f"the answer is a {type(payload).__name__}, not an object")
    return payload


def message_of(payload: dict) -> dict:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise LLMError(f"no usable choice in the answer: {json.dumps(payload)[:300]}")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise LLMError(f"no message in the first choice: {json.dumps(choices[0])[:300]}")
    return message


def request_id(payload: dict, headers: dict) -> str:
    header = {str(k).lower(): v for k, v in (headers or {}).items()}
    return str(header.get("x-request-id") or payload.get("id") or "")


def first_json_object(text) -> dict:
    """The answer as an object: the whole text first, then a scan for one."""
    text = "" if text is None else str(text)
    try:
        loaded = json.loads(text)
        if isinstance(loaded, dict):
            return loaded
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            loaded, _ = decoder.raw_decode(text[index:])
        except ValueError:
            continue
        if isinstance(loaded, dict):
            return loaded
    raise LLMError(f"the model did not answer with a JSON object, so there is "
                   f"nothing to coerce: {text[:300]!r}")


def parse_judge(message: dict, output_type):
    """The decided value: the object for JSON, otherwise its `value` key."""
    data = first_json_object(message.get("content"))
    if output_type == "JSON":
        return data
    if "value" not in data:
        raise LLMError(f"the answer has no 'value' key, which the schema required: "
                       f"{json.dumps(data)[:300]}")
    return data["value"]


def parse_choose(message: dict, cases) -> tuple[int, str, dict]:
    """(index, name, args) for the called case, or an error naming the cases."""
    names = [name for name, _ in cases]
    calls = message.get("tool_calls")
    if not isinstance(calls, list) or not calls or not isinstance(calls[0], dict):
        raise LLMError(f"the model answered without calling a case, and a case is "
                       f"the only legal answer. Cases: {', '.join(names)}")
    function = calls[0].get("function")
    if not isinstance(function, dict):
        raise LLMError(f"the tool call carries no function: {json.dumps(calls[0])[:300]}")
    name = str(function.get("name") or "")
    if name not in names:
        raise LLMError(f"the model called {name!r}, which is not one of the cases "
                       f"({', '.join(names)}); a case is never chosen by default")
    raw = function.get("arguments")
    if raw in (None, ""):
        arguments = {}
    elif isinstance(raw, dict):
        arguments = raw
    else:
        try:            # arguments are a JSON STRING; parsed, never matched
            arguments = json.loads(str(raw))
        except ValueError as e:
            raise LLMError(f"the arguments of {name!r} are not JSON: {e}") from None
    if not isinstance(arguments, dict):
        raise LLMError(f"the arguments of {name!r} are not an object: {str(raw)[:200]}")
    return names.index(name), name, arguments


def as_text(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return "" if value is None else str(value)


def coerce(value) -> tuple[bool, int, float, str]:
    """One decided value on all four sockets; the table is in FLOW.md."""
    text = as_text(value)
    number = isinstance(value, (int, float)) and not isinstance(value, bool)
    lowered = text.strip().lower()
    if isinstance(value, bool) or number or value is None or isinstance(value, (dict, list)):
        decided = bool(value)
    else:
        decided = (True if lowered in TRUE_WORDS else
                   False if lowered in FALSE_WORDS else bool(lowered))
    try:
        as_float = float(value) if number else float(text.strip())
    except ValueError:              # a word with no number in it: see FLOW.md
        as_float = float(decided)
    except OverflowError:           # schema-legal, and not a float: say so
        raise LLMError(_UNCOERCIBLE.format(text[:120])) from None
    try:
        as_int = (value if isinstance(value, int) and not isinstance(value, bool)
                  else int(as_float))
    except (ValueError, OverflowError):        # NaN, 1e400, 400 digits
        raise LLMError(_UNCOERCIBLE.format(text[:120])) from None
    return decided, as_int, as_float, text


_UNCOERCIBLE = ("the model answered {!r}, which is schema-legal but is not a number "
                "this node can put on its INT and FLOAT sockets. Ask for a bounded "
                "number, or take output_type STRING and parse it yourself")


PROVIDER_TIP = ("the NAME of a provider in flow_policy.json; a workflow never "
                "carries an endpoint or a key")


def _common_inputs(middle: list) -> list:
    """provider, model, the shared middle, then seed / temperature / budget."""
    return [io.String.Input("provider", default="local", tooltip=PROVIDER_TIP),
            io.String.Input("model", default="",
                            tooltip="empty means the provider's default_model"),
            *middle,
            io.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                         control_after_generate=True,
                         tooltip="re-run control, and sent as seed"),
            io.Float.Input("temperature", default=0.0, min=0.0, max=2.0, step=0.01),
            # a budget is APPENDED last and has no unlimited value (spec 8.2)
            io.Int.Input("max_tokens", default=MAX_TOKENS_DEFAULT, min=1, max=1_000_000)]


def _tokens(max_tokens) -> int:
    problem = policy.check_positive("max_tokens", max_tokens)
    if problem:                          # no unlimited value, ever (spec 8.2)
        raise LLMError(problem)
    return policy.llm_max_tokens(max_tokens)


def _encode(node: str, images) -> list[str]:
    urls, given = encode_images(images)
    if given > len(urls):
        log.info("%s: %d image frames given, sending the first %d (the cap)",
                 node, given, len(urls))
    return urls


class _LLMNode(io.ComfyNode):
    """What both nodes check, and where they check it."""

    @classmethod
    def validate_inputs(cls, provider=None, max_tokens=None, **rest):
        # **rest: core re-adds arguments this method does not name after
        # filtering by argspec. A LINKED input arrives here as None, which is
        # why execute resolves the provider again rather than trusting this.
        try:
            if max_tokens is not None:
                _tokens(max_tokens)
            if provider is not None:
                provider_spec(provider)
            cls.check(**rest)
        except (LLMError, policy.PolicyError) as e:
            return str(e)          # a broken policy file turns these nodes off
        return True

    @classmethod
    def check(cls, **rest):
        """The queue-time checks that are this node's own."""

    @classmethod
    def resolve(cls, provider, max_tokens):
        """Provider and budget ON THE EXECUTE PATH; see validate_inputs."""
        return provider_spec(provider), _tokens(max_tokens)

    @classmethod
    def report(cls, spec, body, payload, headers, decision) -> dict:
        return {"flow_llm": [{"provider": spec["name"], "model": body["model"],
                              "request_id": request_id(payload, headers),
                              "decision": decision}]}


class MAIFlowLLMJudge(_LLMNode):
    """A typed judgement from a model, ready to feed a Gate."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowLLMJudge",
            display_name="LLM Judge",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["llm", "judge", "vision", "classify", "predicate"],
            description=("Asks a model for one typed answer and reports it as BOOL, INT, "
                         "FLOAT, STRING and raw text. The provider is a NAME looked up in "
                         "flow_policy.json, so a workflow never carries an endpoint or "
                         "a key."),
            inputs=[
                io.String.Input("prompt", default="", multiline=True),
                *_common_inputs([
                    io.Combo.Input("output_type", options=OUTPUT_TYPES, default="BOOL"),
                    io.String.Input("json_schema", default="", multiline=True,
                                    tooltip="used only by output_type JSON")]),
                io.Image.Input("images", optional=True,
                               tooltip=f"sampled frames or a contact sheet; the first "
                                       f"{MAX_IMAGES} are sent"),
            ],
            outputs=[io.Boolean.Output(display_name="BOOL"),
                     io.Int.Output(display_name="INT"),
                     io.Float.Output(display_name="FLOAT"),
                     io.String.Output(display_name="STRING"),
                     io.String.Output(display_name="raw")],
        )

    @classmethod
    def check(cls, output_type=None, json_schema=None, **_ignored):
        if output_type is not None and (output_type != "JSON" or json_schema is not None):
            judge_schema(output_type, json_schema)

    @classmethod
    def execute(cls, prompt="", provider="local", model="", output_type="BOOL",
                json_schema="", seed=0, temperature=0.0,
                max_tokens=MAX_TOKENS_DEFAULT, images=None) -> io.NodeOutput:
        spec, tokens = cls.resolve(provider, max_tokens)
        body = judge_body(prompt, model or spec["default_model"], output_type,
                          json_schema, seed, temperature, tokens,
                          _encode("LLM Judge", images))
        payload, headers = request(spec, body)
        message = message_of(payload)
        value = parse_judge(message, output_type)
        decided, as_int, as_float, text = coerce(value)
        return io.NodeOutput(decided, as_int, as_float, text,
                             as_text(message.get("content")),
                             ui=cls.report(spec, body, payload, headers, value))


class MAIFlowLLMChoose(_LLMNode):
    """One of N authored cases, as a selector for Lazy Select, plus typed args."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAIFlowLLMChoose",
            display_name="LLM Choose",
            category=CATEGORY,
            is_experimental=True,
            search_aliases=["llm", "choose", "route", "dispatch", "tool"],
            description=("Turns the cases you name into one strict tool each, forces the "
                         "model to call one, and reports its index for Lazy Select. The "
                         "provider is a NAME looked up in flow_policy.json, so a workflow "
                         "never carries an endpoint or a key."),
            inputs=[
                io.String.Input("cases", multiline=True,
                                default="draft: a fast, rough pass\n"
                                        "normal: the everyday path\n"
                                        "max: the expensive path",
                                tooltip="one `name: description` per line, in slot order"),
                io.String.Input("prompt", default="", multiline=True),
                *_common_inputs([]),
                io.Image.Input("images", optional=True,
                               tooltip=f"the first {MAX_IMAGES} frames are sent"),
                io.String.Input("args_schema", default="", multiline=True, optional=True,
                                tooltip="JSON-schema properties shared by every case"),
            ],
            outputs=[io.Int.Output(display_name="selector"),
                     io.String.Output(display_name="label"),
                     io.String.Output(display_name="args"),
                     io.String.Output(display_name="raw")],
        )

    @classmethod
    def check(cls, cases=None, args_schema=None, **_ignored):
        if cases is not None:
            choose_tools(parse_cases(cases), args_schema)

    @classmethod
    def execute(cls, cases="", prompt="", provider="local", model="", seed=0,
                temperature=0.0, max_tokens=MAX_TOKENS_DEFAULT, images=None,
                args_schema="") -> io.NodeOutput:
        spec, tokens = cls.resolve(provider, max_tokens)
        parsed = parse_cases(cases)
        body = choose_body(parsed, prompt, model or spec["default_model"], seed,
                           temperature, tokens, args_schema,
                           _encode("LLM Choose", images))
        payload, headers = request(spec, body)
        message = message_of(payload)
        index, label, arguments = parse_choose(message, parsed)
        decision = {"selector": index, "label": label, "args": arguments}
        return io.NodeOutput(index, label, json.dumps(arguments, ensure_ascii=False),
                             as_text(message.get("content")),
                             ui=cls.report(spec, body, payload, headers, decision))
