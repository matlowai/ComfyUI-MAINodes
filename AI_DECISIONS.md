# AI decisions

Typed decisions from a language model, for feeding `Gate` and `Lazy Select`
(see `FLOW.md`). Two nodes, `LLM Judge` and `LLM Choose`, under
`MAINodes/AI Decisions`. They are documented apart from the flow nodes on
purpose: they are the only nodes in this package that talk to a network,
and the flow nodes' promise is that a workflow file is data. The model is
never inside the safe runtime. It can only choose among branches the author
enumerated and fill arguments a schema describes; prompt injection riding in
on an image or a caption can pick the wrong branch, and cannot acquire a
capability.

**The provider is a name, never an endpoint.** `LLM Judge` and `LLM Choose`
take a `provider` input that is the NAME of an entry in `flow_policy.json`
at the pack root, and a workflow file carries nothing else: no url, no
hostname, no key. That is the whole point. A workflow you downloaded cannot
decide where your images are sent, because it can only ask for a provider
this installation already configured, and the key is read from the
environment variable that entry names.

```json
{"llm_providers": {
  "local": {"kind": "openai_compatible",
            "base_url": "http://127.0.0.1:8080/v1",
            "api_key_env": "MAINODES_LLM_KEY_LOCAL",
            "default_model": "your-model-id"}}}
```

The shipped default has one entry, `local`, pointing at a loopback OpenAI
compatible server (llama.cpp, vLLM, Ollama and the rest all speak it). An
unknown name is refused with the path of the file to add it to, both at
queue time and again when the node runs, because an input that arrives on a
link is invisible to queue-time validation. `kind` is `openai_compatible` in
this release and any other value is refused rather than guessed at. The pack
gitignores `flow_policy.json`, because it is the one file here that holds an
endpoint and the name of a key, and the pack root is a git checkout. The
file fails closed, exactly as `FLOW.md` describes for the Safe Function
budgets: a file that exists and cannot be honoured turns these nodes off
until it is fixed, and says which key is wrong.

**The transport is part of that boundary too.** A redirect is refused rather
than followed: urllib's default opener copies the `Authorization` header onto
the redirect target, so a gateway answering a single 302 would hand your key
to whatever host it names and then supply the selector that picks your
branch. The proxy environment is ignored for the same reason, so an
`http_proxy` variable cannot re-point even the loopback default.

**LLM Judge** asks for one typed answer: `output_type` BOOL, INT, FLOAT,
STRING or JSON. The request always carries a strict `response_format`
json_schema, so a well behaved server can only answer in the shape asked
for; if one answers with prose anyway, the first JSON object in the text is
used, and an answer with no JSON object in it is an error rather than a
guess. All four scalar outputs are populated from the one decided value, so
the same node feeds a Gate and a title: a number coerces the way you expect,
and a word with no number in it falls back to the truth of the decision
(`yes` is `true`, `1`, `1.0`, `"yes"`). `raw` is the model text, unparsed.

**LLM Choose** turns the cases you write, one `name: description` per line,
into one strict function tool each, forces a call with
`tool_choice: "required"`, and reports the index of the case that was called
for `Lazy Select` alongside its label and its arguments. A tool name that is
not one of the cases is an error, never a silent default. `args_schema` is a
JSON schema `properties` object shared by every case, and the arguments come
back parsed from JSON rather than string matched. `raw` is the message text,
which is usually empty when the model answered with a tool call: the parsed
arguments are on `args`.

`seed` is a node input, so changing it re-runs the node, and it is sent in
the request for servers that honour it. `temperature` defaults to 0.
`max_tokens` is a budget like the Safe Function ones: it is on the node, it
has no unlimited value, and an installation ceiling (`llm_max_tokens`) can
only lower it. Up to eight image frames are sent per request, each
downscaled to a long side of 1024 first, and the log line says so when a
longer batch is cut, and the per-frame pixel cap is the installation's
`max_pixels`. Each attempt gets 120 seconds for the WHOLE exchange, connect
to last byte, rather than per socket operation: a server sending one byte
before each timeout expires otherwise holds the node open forever, and
ComfyUI's interrupt does not reach a blocking socket read. Only a connect or
send failure is retried, once, so two attempts bound the node; an answer the
server already produced is never asked for twice.

## Owed

* Local JSON-schema validation of what the model answers; today the server
  is asked to obey the schema and the reply is parsed, not validated.
* Each socket read bounded by the REMAINING deadline rather than the whole
  one, so an exchange is bounded at 120 s rather than at about twice that.
* No automatic retry at all: a send failure can be raised after the request
  crossed the wire, and re-queueing is cheap while paying twice is not.
* Typed arguments from a Choose tool call bound to sockets; they arrive as
  one JSON string on `args` today.
* An Anthropic-native provider, which wants an SDK in the venv and is a
  deliberate decision.

## Example

`examples/flow/llm_choose_select_api.json` is `LLM Choose` into
`Lazy Select`: three named cases, one strict tool each, and the chosen index
selecting which of three branches is produced. It names the provider `local`
and nothing else; add a `local` entry to `flow_policy.json` pointing at your
own OpenAI compatible server before you queue it.
