# Flow examples (API form)

`core_logic_tour_api.json` uses nothing from this pack. It is the same job
done with core nodes only: `Math Expression("a != 1.0")` into `If/Else
Switch`, with the scale value as ONE link shared by the expression and the
resize, so a headless run branches exactly as the editor does. Read it
first; if core already covers your case, use core.

`resize_gate_api.json` is the one node version: `Gate (process if)` with
`processed` from the resize and `source` from the original image. The
expression is `scale_by != 1.0` and `scale_by` is the resize's OWN widget,
still inline on the resize: the Gate reads the widgets of the node feeding
`processed`, so nothing has to become a link. The `Flow Probe` on the
resize's input is what proves the resize did not run: each execution
appends a line to `<output>/flow_probe/resize_gate.count`. Queue it with
`scale_by` at 1.0 and the file does not grow; set 0.5 and it gains one line.

`safe_function_api.json` is the section 8 example of the spec: one
`Safe Function` whose parameters bind to sockets `a`, `b` and `c`
positionally, with a `Flow Probe` in front of socket `b`. Queue it with
`enabled` false and `<output>/flow_probe/safe_function.count` does not
grow, because the body returns `original` before it ever reaches
`restored`; set it true and the file gains one line.

`llm_choose_select_api.json` is `LLM Choose` into `Lazy Select`: three
named cases, one strict tool each, and the chosen index selecting which of
three branches is produced. The expensive branch sits behind a `Flow Probe`,
so `<output>/flow_probe/llm_choose_select.count` only grows when the model
picks `repair`. It names the provider `local` and nothing else: add a
`local` entry to `flow_policy.json` at the pack root pointing at your own
OpenAI compatible server before you queue it.

Two things to know before you queue any of these graphs:

* The core logic nodes (`Math Expression`, `If/Else Switch`, `Soft
  Switch`) are flagged experimental. They stay hidden in the node search
  until the frontend setting for experimental nodes is enabled.
* Grown value inputs are links, never inline numbers, which is why `a`
  arrives from a `Float` primitive as `values.a`.

These are API form (the `/prompt` payload shape), so they load with "Load"
in recent frontends and run unchanged through the API. Editor form
(`.json` with `nodes` and `links`) is owed for both and lands once a
browser has produced and saved it; nothing here depends on it.
