# MAINodes Flow Control, Safe Functions, and LLM Decisions

## Technical / UX specification v0.2

Status: accepted for build, 2026-08-28. Phase 1 is in progress on the
`flow-control` branch. This document is the authority for the `flow/`
package; the earlier v0.1 draft it replaces was a design conversation, not a
build spec, and its self-assigned quality scores are dropped here.

Every claim below about what ComfyUI core does was checked against core
0.33.0 on the build machine (`execution.py`, `comfy_extras/nodes_logic.py`,
`comfy_extras/nodes_math.py`, `comfy_api/latest/_io.py`). Where a mechanism
is unproven the text says so and names the probe that settles it.

---

## 0. What core already provides (do not rebuild)

| Need | Core node / mechanism | Where |
|---|---|---|
| Two-way lazy branch on a generic type | `If/Else Switch` (`ComfySwitchNode`), `MatchType` inputs, `lazy=True`, `check_lazy_status` | `comfy_extras/nodes_logic.py` |
| Branch on "is this input connected" | `Soft Switch` (`ComfySoftSwitchNode`) | same |
| Scalar expression to BOOL / INT / FLOAT | `Math Expression` (`ComfyMathExpression`), simpleeval, Autogrow inputs `a`..`z` typed Float / Int / Boolean | `comfy_extras/nodes_math.py` |
| Boolean glue | Not / And / Or / Invert Boolean, String Compare | `nodes_logic.py`, `nodes_string.py` |
| Real laziness | `check_lazy_status` returns the input names it still needs; the executor makes those strong links and re-schedules the node; unrequested inputs' exclusive ancestors never run | `execution.py` (`make_input_strong_link`) |
| Graph-level loops | node expansion (`GraphBuilder`, `ExecutionBlocker`, `NodeOutput(expand=...)`) | `comfy_execution/graph_utils.py` |
| Per-item mapping over lists | any node fed a Comfy list runs once per item (`INPUT_IS_LIST` false) | `execution.py` |
| Regions | subgraphs are flattened by the frontend at queue time; the backend never sees a boundary | frontend |
| Cache without running skipped branches | cache keys come from prompt structure plus `IS_CHANGED`, never from outputs | `comfy_execution/caching.py` |

Consequences:

* The "resize only when scale is not 1" case is solvable in pure core today:
  `Math Expression("a != 1.0")` into `If/Else Switch` with `on_true` from
  Resize and `on_false` from the original image. Three nodes.
* The core logic nodes are `is_experimental=True`; they are hidden until the
  frontend setting for experimental nodes is on. Every example that uses them
  says so.
* This package therefore adds only what core lacks: predicates on data (image
  size, mask coverage, sequence length) rather than scalars, the fused Gate
  that makes the common case one node with passthrough by default, N-way
  lazy dispatch, list Filter / Partition, a debug probe, a restricted
  function node, and typed LLM decisions. Nothing here duplicates a core
  node.

---

## 1. Goals

The system MUST provide:

* True conditional execution: the skipped branch's exclusive producers never
  run. Selecting between two computed values does not qualify.
* One node for "process this when the condition holds, otherwise pass the
  original through".
* Predicates over Comfy values, not only widget scalars.
* Generic operation over IMAGE, MASK, LATENT, CONDITIONING, MODEL, AUDIO,
  VIDEO and any other type `MatchType` accepts.
* Headless / API execution identical to editor execution, with no MAINodes
  JavaScript loaded.
* Portable workflow JSON. Frontend sugar compiles to real nodes.
* Deterministic execution and sane caching.
* Visible reasons for why a branch ran or was skipped.
* A foundation for list control flow (Filter, Partition, For Each).
* A restricted, Python-like function node without `eval` or `exec`.
* No network, filesystem, subprocess, environment, reflection, or import
  capability reachable from workflow-authored text.

Non-goals for v1: multiple dynamic outputs on Safe Function, recursion,
per-item laziness inside one node, a general agent runtime.

---

## 2. Core principle

The editor may present imperative-looking behaviour ("run this node when
`scale != 1.0`"). The executable workflow stays declarative Comfy dataflow.
No correctness-critical behaviour depends on frontend bypass state,
queue-time patching, browser-only state, or scheduler mutation. A workflow
that branches one way in the editor branches the same way through the API.

The security boundary, stated once:

> Workflow authors compose approved computation. They never acquire new
> capabilities. Workflow JSON stays data, not code.

This package does not lower ComfyUI's existing bar (custom node packs are
arbitrary code, and that is unchanged); it refuses to lower it further.

---

## 3. Architecture

Four layers, each usable without the ones above it.

* **A. Expressions.** One allowlist evaluator over the Python `ast`,
  shared by Condition, Gate, Filter, Partition and later Safe Function.
  Syntax is a strict superset of core `Math Expression`, so an expression
  moves between the two nodes unchanged.
* **B. Lazy primitives.** Gate, Lazy Select, plus core's Switch nodes.
* **C. Frontend sugar.** "Run when / Skip when" on a node or a subgraph,
  compiling to exactly one Gate node plus links. Phase 2.
* **D. Programmable nodes.** Safe Function (restricted interpreter, Phase 3)
  and LLM Judge / LLM Choose (typed model decisions, Phase 4).

---

## 4. Nodes (Phase 1)

All nodes are V3 (`comfy_api.latest`, the version the rest of the pack
already imports; revisit the pin at release). Category `MAINodes/Flow`;
the LLM nodes of section 9 sit in `MAINodes/AI Decisions`. Node ids are
prefixed `MAIFlow`.

### 4.1 Gate ("process if")

```
expression   STRING   default "a != 1.0"
processed    T        MatchType, lazy
source       T        MatchType (same template), lazy, OPTIONAL
values       Autogrow a..z of AnyType, optional (values named in the expression)
hidden       DYNPROMPT, UNIQUE_ID
->  result   T
```

Semantics: `processed if expression else source`; with `source` not
connected, `processed if expression else BLOCK`.

Names in the expression resolve in this order: a connected value (`a`..`z`),
then a widget of the GUARDED NODE by its real name, then a capability. The
guarded node is the direct producer of `processed`. Its inline inputs are
read out of the hidden DYNPROMPT through the Gate's own `processed` link, so
`scale_by != 1.0` guards a Resize whose `scale_by` never leaves the Resize.

* The read is cache-correct with no fingerprint at all: the guarded node is
  an ancestor of the Gate through `processed`, and core folds every
  ancestor's literal inputs into the descendant's cache key
  (`comfy_execution/caching.py`, `get_node_signature` over
  `get_ordered_ancestry`, which walks lazy links like any other). Measured
  2026-08-28, probe 5 in section 15: four queues differing only in the
  resize's inline `scale_by` re-decided every time. `fingerprint_inputs`
  could NOT have made an arbitrary node's widget safe to read, because
  `IsChangedCache` computes fingerprints with no dynprompt
  (`execution.py`, `get_input_data(..., None)`); it is the ancestry that
  makes this one read safe, which is why the Gate reads the node on
  `processed` and never any other.
* A widget that is itself a link is refused by name: "'scale_by' is a
  widget on ImageScaleBy that arrives on a link; connect that value to the
  Gate's a, b, ... instead". Nothing is guessed.
* A name that is nothing is refused naming the node actually found and its
  widgets. The guarded node is the DIRECT producer: a probe or a reroute
  between the two is what gets read, and the message says which.
* `validate_inputs` checks syntax, limits and capability names; the prompt
  is not visible at queue time, so name binding waits for the execute path,
  exactly as it already did for `values`.

`check_lazy_status` evaluates the expression and requests exactly one of
`processed` / `source`; both are lazy so the untaken side is never
requested. This is the acceptance requirement: with the expression false,
the producer of `processed` runs zero times. With `source` unconnected and
the expression false it requests nothing, and `execute` returns core's
`ExecutionBlocker(None)`: every consumer, output nodes included, is skipped
silently (`comfy_execution/graph_utils.py:140`, whose docstring names this
exact use). Measured 2026-08-28, probe 6. That is "Skip when" on a Save or a
Preview, which passthrough cannot express.

`ui` output on every run:

```
{"flow": [{"node": "Gate", "took": "processed" | "source" | "blocked",
           "expression": "...", "values": {"a": 1.0},
           "widgets": {"scale_by": 1.0}, "guarded": "ImageScaleBy"}]}
```

Scalars are reported verbatim; tensors and opaque values as `KIND[shape]`.
`widgets` holds only the guarded node's widgets the expression named.

Input order is `expression, processed` on the required side and `source,
values` on the optional side. This REORDERED `source` and `processed`
relative to the first Phase 1 build of the same day (on the unpushed
branch, before any release): an editor-form workflow saved against that
build would load with its two same-typed links swapped. The widget-order
baseline is re-frozen here and the append-only rule binds from this point.

### 4.2 Condition

```
expression   STRING
values       Autogrow a..z of AnyType
->  BOOL, FLOAT, INT, STRING
```

For feeding core `If/Else Switch`, Lazy Select, or anything else that takes
a scalar. Same evaluator as Gate. Its `ui` report uses `result` where
Gate uses `took`: a Condition has no branch to have taken, so `took` would
be a lie. Select reports `selector`, `labels` and `cases`; Filter and
Partition report `kept_count` and `rejected_count`. Each carries what a
"why did this run" renderer needs: the decision input, the alternatives,
the outcome.

### 4.3 Lazy Select

```
selector     INT
labels       STRING  optional, comma-separated case names ("draft,normal,max")
case_0..case_7   T  MatchType, lazy, optional (eight fixed slots)
default      T  MatchType, lazy, optional
->  result   T
```

Only the selected case is requested. An out-of-range selector takes
`default` if connected, otherwise raises at run time naming the case
(`validate_inputs` cannot see a selector that arrives on a link).

**Measured 2026-08-28: Autogrow cannot carry laziness, so the cases are
eight fixed slots.** An Autogrow template of `MatchType` resolves and
executes (core's own `CreateList` does it, `comfy_extras/nodes_toolkit.py`),
but `comfy_execution/graph.py:118` calls `get_input_info` against the
UNEXPANDED `INPUT_TYPES()`, where a grown name such as `cases.case_0` does
not exist, so `graph.py:159` reads `is_lazy` as False and every grown slot
becomes a strong link. A three-case Autogrow Select ran all three cases on
every selector value; the fixed-slot version runs exactly one.

This is a general constraint on this package, not a Select detail: **never
put a lazy input behind Autogrow.** Autogrow remains correct for eager
values (Gate and Condition use it for `values`).

### 4.4 Filter and Partition (lists)

```
Filter:     items (list of AnyType), expression, values a..z
            -> kept (list), kept_count INT
Partition:  items, expression, values
            -> kept (list), rejected (list), kept_count INT, rejected_count INT
```

`INPUT_IS_LIST` on the node; `is_output_list` on the list outputs. The
expression is evaluated once per item with `item`, `index`, `count` bound,
plus the scalar `values`.

Why Partition is the per-item primitive: `check_lazy_status` is mapped over
list inputs and its requests are unioned, so laziness is all-or-nothing per
input, never per item. Partition into `kept` / `rejected` and feed the
expensive branch only `kept`. Filtering five items to two means two
executions instead of five, and that saving is free and real.

**Measured 2026-08-28: an empty list does NOT map zero times.** The v0.2
draft claimed it did; it does not, in either of the two shapes core takes:

* a node with any other input (a widget counts) keeps `max_len_input` at 1
  (`execution.py:250`) and `slice_dict` (`execution.py:254`) indexes the
  empty list at 0, raising `IndexError` inside the node;
* a node whose only input is the empty list takes the
  `elif max_len_input == 0` path (`execution.py:311`) and is called exactly
  once with no arguments.

So the empty case must be guarded explicitly, never left to core: gate the
downstream branch on `kept_count > 0`. Filter and Partition therefore emit
counts as first-class outputs, and FLOW.md teaches the
`Partition -> Gate(kept_count > 0)` pattern as the batch idiom.

Two distinct batch notions must stay visibly distinct in the UI:

* a Comfy **list** (Python list; nodes map over it), handled by these nodes;
* a **tensor batch** (`IMAGE[B,H,W,C]`), handled by capabilities such as
  `image.select(image, mask)` inside expressions.

### 4.5 Flow Probe (debug)

```
value        AnyType   passthrough
name         STRING
salt         INT       default 0 (vary it to defeat the result cache in tests)
delay_s      FLOAT     default 0
->  value
```

On execute: appends one line to `<output_dir>/flow_probe/<name>.count`,
sleeps `delay_s`, returns `value` unchanged, and reports the running count
in `ui`. This is how the acceptance gates count executions without a
websocket client. Shipped, because users will want it for the same reason.

### 4.6 Identity fast paths (guidance, not a node)

Nodes with an obvious identity case (scale 1, rotation 0, blur radius 0,
strength 0) should return immediately. Gate handles the case where the node
cannot know that a whole branch is unnecessary.

---

## 5. Expression language and capability registry

### 5.1 Grammar (allowlist over `ast`)

Allowed: int / float / string / bool / None literals; names; unary `-`
and `not`; `+ - * / // % **` (exponent capped at 4000 as core does);
chained comparisons; `and` / `or`; conditional expression `x if c else y`;
calls to registered capabilities by bare or dotted name; subscripts with an
int literal or int name on a registered sequence result; tuple and list
literals up to 64 elements.

Rejected, with the policy in the error message: attribute access on values,
lambda, comprehensions, generator expressions, walrus, starred, f-strings,
`__` anywhere in a name, and any name that is neither a bound input nor a
registered capability.

A Python-level failure inside an evaluated expression (`1 / 0`,
`'a' + 1`, an overflow) is reported as a policy error naming the exception,
in every node, not only inside Safe Function. Safe Function wrapped these
with a line number from the start and the Phase 1 nodes called the same
evaluator bare, so the identical expression explained itself in one node and
raised a bare traceback out of `check_lazy_status` in another.

Limits: source 4 KB, 2000 AST nodes, nesting depth 32, 256 calls per
evaluation. Exceeding a limit is a validation error before execution where
the limit is statically decidable, and an evaluation error where it is not:
`2 ** 5000` is caught at queue time, `pow(2, a)` with `a` on a link cannot
be. This mirrors core, whose `_safe_pow` exists for the same reason
(`comfy_extras/nodes_math.py`).

Value size is bounded as well as program size. Sequence repetition and
concatenation refuse to build a result longer than `MAX_RESULT_LENGTH`, as
core's simpleeval does with `safe_mult` / `safe_add`. Without that guard
`'ab' * 5000000 * 200` passes every program-level limit (128 source bytes,
about 12 AST nodes) and then allocates gigabytes inside `execute`; host RAM
is this box's real ceiling, so that ends the ComfyUI process.

That guard is per operation, and the bound it gives is honest rather than
total: a chain of sub-limit allocations (`'a' * 999999 + 'a' * 999999 ...`)
can still reach a few hundred MB of transient string before the AST node
budget stops it. That is three orders of magnitude below the unguarded case
and matches how core behaves. A running total threaded through the
evaluator would close it; if Safe Function's loops make that worth doing,
do it there, where a loop can repeat an allocation.

A capability that duplicates an operator uses the OPERATOR'S guard
function, not its own. `core.math.pow` shipped as a second implementation
that capped the exponent and left the base free, so `(2 ** 4000) ** 4000`
was refused while `pow(pow(2, 4000), 4000)` built a 16-million-bit integer
and a third nesting demanded 8 GB in one uninterruptible call, reachable
from a Gate or Condition widget, which has no allocation budget at all. One
guard, one function; the spelling is a message argument, never a fork.

A bare capability name is a queue-time error, not a value: `sqrt` alone
would otherwise evaluate to the function object and silently feed a branch
`True` forever. A bound value of the same name still wins, so a connected
input may legally be called `sqrt`; the node layer cannot produce that
collision, since value names are `a`..`z` plus `item`, `index`, `count`.

Dotted names such as `image.width(x)` are resolved directly against the
registry. No Python module object is ever exposed. There is no `getattr`.

### 5.2 Value handling

Scalars cross as Python scalars. Everything else (tensors, dicts such as
LATENT, model patchers, conditioning lists) is wrapped in an opaque `Ref`
carrying its Comfy type name. The evaluator cannot inspect a `Ref`; only a
capability unwraps it. Capabilities are functional: no in-place mutation of
an input that another node may also consume.

### 5.3 Registry

```python
Capability(id, version, fn, arg_types, return_type, predicate_safe, cost)
```

v1 packs:

| Pack | Capabilities |
|---|---|
| `core.math` | the core Math Expression set, bare names: `sum min max abs round pow sqrt ceil floor log log2 log10 sin cos tan int float` |
| `core.logic` | `clamp(x, lo, hi) between(x, lo, hi) near(x, target, eps) coalesce(a, b) is_none(x)` |
| `image` | `width height megapixels batch aspect` |
| `mask` | `coverage is_empty` |
| `latent` | `frames shape` (shape as a tuple) |
| `seq` | `length` |

All v1 capabilities are `predicate_safe`. Transform capabilities
(`image.resize`, `latent.blend`, `image.select`) arrive with Safe Function
and are rejected inside a Gate or Condition expression, with the error
saying why.

Only installed extension code registers capabilities. Third-party packs
register under their own prefix and are shown separately in the UI. A
workflow cannot add to the registry.

OWED, not built (removed as a claim 2026-08-28): workflow metadata recording
the runtime and pack versions, and a load with a missing or older pack failing
validation before queueing. `Capability.version` is recorded in the registry
and has no consumer: it reaches no node input, no cache key and no validation.
The spec asserted this as shipped behaviour for a day, which is the rule about
measuring before writing the claim, broken in the document that states it.

An allocating capability MUST declare a `preflight` returning the peak it will
allocate, in elements, and `register()` refuses one without it. The check runs
in a single place before the call, not inside each transform: three of the
eight guarded themselves and five did not, while the module claimed all of
them did. Elements is the wrong unit and bytes is owed, since fp16 and fp32 do
not cost the same and `interpolate` promotes to float; the declared peak is
deliberately pessimistic in the meantime.

Optional packs (the hosting policy of section 8.5). A capability may name a
pack from `policy.OPTIONAL_PACKS`, and `register()` refuses any other name.
A pack is available only when the installation lists it under
`enable_packs` in `flow_policy.json`, and NOTHING is enabled by default.
The transforms are the only optional pack, and they are off on purpose:
every allocation budget in this package (the per-result `max_pixels`, the
running `max_tensor_elements`, the preflight declarations, the owed bytes
unit) exists because a transform can run inside workflow-authored text,
and the original request was for control flow, never for image operations
in a text box. An installation that never enables the pack has no such
surface at all. Safe Function refuses a call into a disabled pack at parse
time, which is queue time, and again at the call, with the key to set in
the message. The readers that share an id prefix (`image.width`,
`mask.coverage`, `latent.frames`) are not in the pack and stay available.

---

## 6. Frontend sugar: Run when / Skip when (Phase 2)

The frontend already ships the manual version of this feature. Bypass
(node mode 4) skips a node and routes its inputs through to its outputs by
type, with one fixed rule in `ExecutableNodeDTO._getBypassSlotIndex`
(frontend 1.49.6): the same-index input if it is type-compatible, else the
first input of exactly the output's type, else the first input compatible
both ways. "Run when" is that gesture decided at run time by data, and the
UI should say so: a Comfy user reads "Bypass when" instantly.

Right-click on a compatible node:

```
Conditional Execution
    Run always
    Run when...
    Skip when...     (reads as: bypass when)
    Edit condition...
    Show compiled flow
    Remove condition
```

"Run when" compiles to exactly ONE Gate node and nothing else: `processed`
from the guarded node's output, `source` from the guarded node's input
chosen by the bypass rule above, the expression from the editor, and the
guarded node's own widgets referenced BY NAME in the expression (section
4.1). No Primitive node is created and no widget becomes a link: the
`scale_by` widget stays on the Resize, and the dialog can offer the guarded
node's widget names as a list. The Gate takes over the guarded node's
outgoing links.

Reading a widget through the hidden prompt is safe only for the guarded
node, because it is an ancestor of the Gate and therefore already in the
Gate's cache key (section 4.1); the Gate reads no other node, and the
compile creates no Primitive because it does not need one.

Two cases take the `values` sockets instead of the widget read, and the
frontend links the SAME existing source into `values.a` rather than
creating anything:

* a referenced widget that is already a link on the guarded node;
* a region, meaning "Run when" on a subgraph node, whose promoted widgets
  live on inner nodes after flattening.

Passthrough mapping uses the bypass rule verbatim. Only where bypass would
also fail (no compatible input) does the author pick, and the choice is
stored as the Gate's `source` link, which is workflow data.

"Skip when" on a node with no passthrough (a Save, a Preview, any sink)
compiles to a Gate with `source` unconnected, which blocks (section 4.1).

The generated Gate is a real node. The frontend may collapse it; "Show
compiled flow" reveals it. Removing the condition removes the Gate and
restores the links. A badge on the guarded node (`Run when scale_by != 1.0`)
is a display property only; deleting it changes nothing, by the section 2
rule that no correctness-critical behaviour lives in frontend state.

Regions: select nodes, convert to a subgraph, apply "Run when" to the
subgraph node. Subgraph I/O types are fixed at creation and the frontend
flattens at queue time, so nothing here depends on dynamic type propagation
across a boundary.

The one shape rejected, in a sentence: letting the frontend set real Bypass
at queue time when the condition names only widgets. It breaks API parity
(a headless client editing `scale_by` gets no skip) and cannot serve a
computed value. Runtime Gate, always.

---

## 7. Observability

After execution, a Gate shows `took: processed` / `took: source` /
`took: blocked` with the expression, the values and the guarded widgets it
saw, from the `ui` payload. Skipped producers are dimmed by the frontend for
the most recent run, in the vocabulary users already have: a guarded node
whose Gate took `source` or `blocked` is tinted the bypass colour until the
next queue.

The documented trap: attaching a preview or any second consumer to a lazy
branch makes that branch required, and it will run. The FLOW.md user doc
states this in its first screen and Flow Probe exists so users can count
instead of guess.

---

## 8. Safe Function (Phase 3)

A node whose body is a restricted, Python-like function:

```python
def main(original: IMAGE, restored: IMAGE, enabled: BOOL = True, strength: FLOAT = 1.0) -> IMAGE:
    if not enabled:
        return original
    if strength <= 0:
        return original
    return restored
```

"Apply Signature" refreshes the visible inputs. Inputs are lazy by default.

### 8.1 Language

Statements: assignment (plain and augmented, `x = 1` and `x += 1`),
`if / elif / else`, `for x in <bounded iterable>`, `break`, `continue`,
`return`. Augmented assignment was absent from the v0.2 list, which predated
loops; refusing it has no security value and is the first thing a user
writing a loop reaches for.

Expressions: the section 5 grammar.

Not available: `while`, `import`, `class`, `lambda`, `try`, `raise`,
`with`, `global`, `nonlocal`, `del`, decorators, comprehensions, `yield`,
`async`, dynamic code of any kind, recursion.

`for` iterates only `range(n)`, evaluator lists and tuples, and registered
sequence results. `for _ in range(limit): ... break` expresses every bounded
retry or search with the bound visible in the source. `while` is left out
for that reason, not for safety; the same design choice Starlark made, and
it can be revisited with evidence.

### 8.2 Budgets

All five are serialized on the node, so the editor and the API behave
identically and the same workflow behaves the same on two machines. A budget
that lives only in installation policy would break that, so policy may lower
a node's value but never replace it:

```
max loop iterations   default 1000      (shared across nested loops)
max interpreted ops   default 50000
max capability calls  default 5000
max collection size   default 10000     sequence elements and characters
max tensor elements   default 100000000 elements of transform results
```

Two resources, two units, two budgets. `max_collection` counts what a
sequence operation builds; `max_tensor_elements` counts what a transform
returns. Charging both against one number was measured to make the transform
pack unusable: one `image.flip` on a 64x64x3 image is 12288 elements against
a collection ceiling of 10000, and a 1 MP image is 3145728. The per-result
`max_pixels` cap (64 MP) still applies on top.

The installation ceiling sits ABOVE the node default, not on it. A ceiling
equal to the default means raising the node value is silently clamped, so
"raise it on the node" would be advice that cannot work. Ceilings ship at
roughly a hundred times the defaults; an administrator who wants to restrict
lowers them, and only then does a budget message point at
`flow_policy.json`.

There is NO setting that means unlimited: zero and negatives are refused at
queue time, because an unbounded budget is the thing that takes a host down.

The installation policy file FAILS CLOSED. An absent file is the only state
that means "use the shipped defaults". A file that exists and cannot be read,
parsed, or understood is an error, and so is an unknown key or a ceiling that
is not a positive number. The failure mode this replaces was silent: an
administrator who set a ceiling of 5 and then mistyped the JSON, or wrote "5"
instead of 5, or misspelled the key, got the shipped ceiling of 100000 back
with nothing said, and a restriction that evaporates on a typo is worse than
no restriction because nobody is watching it. Only Safe Function and the LLM
nodes read the file, so a broken policy disables exactly those and leaves
Gate, Condition, Lazy Select, Filter, Partition and Flow Probe running, which
is what section 8.5 already asks for.

An installation ceiling may lower any of them;
the effective limit is the minimum. Exceeding a budget stops the function
with the limit, the line, and the setting to change.

Capabilities may declare `cost`; a total-cost budget can be enforced later
without changing the registry shape.

### 8.3 Planning mode (laziness)

`check_lazy_status` runs the interpreter in planning mode: unresolved inputs
are `Unknown`; the first `Unknown` that control flow depends on stops
planning and names it (`needs: ["scale"]`). Inputs on untaken branches are
never named.

Planning is re-entered each time an input resolves, so planning mode never
executes a transform capability: every transform call yields `Unknown`. If
control flow then depends on it, that is a validation error ("transform
used in a branch decision"). Predicate-safe capabilities on resolved values
run in planning mode; they are cheap by declaration.

### 8.4 Inputs and outputs

Signature-driven inputs do not map onto Autogrow, whose template is one
type, and the backend cannot derive sockets from widget text without
JavaScript. Decision (2026-08-28): the node has lazy `AnyType` sockets
`a`..`z` (Autogrow, or a fixed set if lazy does not survive Autogrow) and
the function's parameters bind to them POSITIONALLY: the first parameter
reads `a`, the second `b`, and so on. Parameter names are for the author;
API-form JSON always uses those socket names, so the node runs with no
frontend at all. Twelve sockets, `a`..`l`, shipped in Phase 3; the count is
a constant, not a promise of the alphabet. A later JavaScript pass renames the sockets for display only.
Defaults apply when a socket is not connected, and a default is a LITERAL:
a number, a string, `True`, `False`, `None`, or a list or tuple of those. It
was validated as an expression and then evaluated at parse time, so
`def main(x, y = sqrt(25))` ran a capability outside every budget on each of
the three parses per execution. There is no user value in a computed default,
so the capability is deleted rather than accounted for and a whole execution
phase stops existing. Annotations are checked in `validate_inputs` where the
value is known, otherwise at execute.

One declared output in v1, typed `AnyType`. The value handed back must be
fully resolved: an unresolved socket buried inside a returned list, tuple or
`Ref` is an interpreter sentinel escaping into the graph, so the check that
ends planning walks containers rather than testing the top-level value. The
UNWRAPPING walks as well, for the same reason and by the same rule: opening
only the top-level `Ref` made `return [x, y]` hand the graph a list of
interpreter wrappers instead of images. Resolved and unwrapped are two halves
of one sentence, and both walk.

The hosting policy of section 8.5 (disable the node entirely, allow a
subset of packs) is built as of 2026-08-28; see there.

### 8.5 Security acceptance (Gate E)

All of the following fail validation with a policy message:

```python
import os
open("/etc/passwd")
__import__("requests")
getattr(x, "__class__")
x.__class__
eval("1+1")
exec("...")
subprocess.run(...)
socket.socket(...)
(lambda: 0)()
[i for i in range(10)]
```

Hosting policy, all of it in `flow_policy.json` and all of it fail-closed
(section 8.2): `"safe_function": false` turns the node off at queue time,
at planning and at execution, because all three paths compile through one
place; `"enable_packs": ["transforms"]` allows an optional pack (section
5.3), and nothing is enabled without it; the ceilings lower the budgets. A
quoted `"false"` or an unknown pack name is an error, not a default. None
of it touches Condition, Gate, Select, Filter, Partition or Flow Probe,
which never read the file.

---

## 9. LLM decisions (Phase 4)

The model is a predicate / selector producer feeding Gate and Lazy Select.
It is never inside the safe runtime, and it can only choose among branches
the author enumerated and fill arguments a schema validates. Prompt
injection riding in on an image or caption can pick the wrong branch; it
cannot acquire a capability. The section 2 boundary holds unchanged.

These nodes ship under their own category, `MAINodes/AI Decisions`, with
their own user document (`AI_DECISIONS.md`), outside the Flow v1 release
boundary. Flow's security sentence is that workflow JSON stays data, and
these are the only nodes in the package with a network path, so they carry
that argument separately rather than inside Flow's. Node ids keep the
`MAIFlow` prefix, because saved graphs are data.

### 9.1 LLM Judge

```
prompt       STRING
images       IMAGE  optional (a contact sheet or sampled frames, not every frame)
schema       one of: BOOL | INT | FLOAT | STRING | JSON (schema text)
seed         INT    controls re-run only; part of the cache key
-> value (typed), raw STRING
```

Structured output is what makes this plug into Gate without a parse step:
JSON-schema constrained decoding on local OpenAI-compatible servers
(llama.cpp, vLLM, Ollama), `output_config.format` on the Anthropic API.

### 9.2 LLM Choose

Each Lazy Select case gets a name and a description on the node. They become
one strict tool per case, the model is forced to call one, and the returned
tool name is the selector. The branch subgraphs are the tools.

Shipped in Phase 4: the parsed arguments come back as one `args` STRING of
JSON. Binding them to typed sockets through the Safe Function signature
mechanism is OWED, not built.

### 9.3 Loop

Tool result back to the model, repeat: a node-expansion loop with a
max-turns bound. After Judge and Choose exist.

### 9.4 Providers and keys

OpenAI-compatible endpoint first (covers local and most hosted), Anthropic
native second (strict tools, structured outputs). Keys and endpoints are
server-side configuration; workflow JSON never carries a key. `ui` reports
model id, request id, and the parsed decision, and never the key or the
resolved URL.

The policy file that does carry endpoints and key names lives in the pack
directory, which is a git checkout, so it is gitignored and a test enforces
that. The one file guaranteed to hold an endpoint must never be committable.

The transport is part of this boundary, not just the provider name. A
workflow names a provider; the request must then reach the host the
installation configured and no other. Redirects are refused rather than
followed, because the default urllib opener copies the `Authorization`
header onto the redirect target: a gateway answering one 302 hands the key
to whatever host it names and then supplies the selector that drives the
branch. The proxy environment is ignored for the same reason. Every request
carries a deadline for the whole exchange rather than per socket operation,
because a server sending one byte before each timeout expires otherwise
holds the node forever, measured at 91 seconds for a 92 byte body against a
2 second timeout.

Core's `Anthropic Claude`, OpenAI and Gemini nodes are text-out only; this
is not a duplicate.

---

## 10. Serialization and caching

Every feature survives save / load, copy / paste, templates, API export,
execution without the MAINodes frontend, and migration. Frontend decoration
never holds the only copy of execution semantics.

Cache identity includes expression or function source, signature, budgets and
scalar inputs, all of which are ordinary inputs and therefore already in
core's signature. A Gate's identity also includes its guarded node's widgets,
through the `processed` link (section 4.1), with nothing added. Runtime and pack versions are NOT in it; see the owed note
in section 5.3. Unselected lazy branches
never run for fingerprinting; core guarantees this.

Migration rule inherited from the pack: new inputs are appended last, never
inserted, or every saved workflow shifts a slot.

---

## 11. Acceptance gates

| Gate | Test |
|---|---|
| A. Real laziness | Flow Probe behind `processed`; expression false; probe count stays 0 |
| B. Passthrough | for IMAGE, MASK, LATENT, STRING, INT: expression false returns `source` unchanged |
| C. Exclusivity | Lazy Select with a probe per case: exactly one count increments |
| D. Headless parity | the example API graph run through the harness with no frontend branches identically |
| E. Expression security | the section 8.5 list, minus statements, rejected by the evaluator |
| F. Limits | oversized source, deep nesting, huge literals, exponent bombs rejected before execution |
| G. Lists | Filter / Partition counts; an empty `kept` list reaches the downstream node as an error or a no-argument call, never as a skip, so the test asserts BOTH measured core shapes and the `kept_count > 0` guard |
| H. No frontend | Gate D is the proof; no JavaScript exists in Phase 1 |

Meta-invariants (`tests/flow/test_invariants.py`) are tested over the registry
itself rather than per feature, because the same defect shape appeared five
times and each instance was a rule that one call site was supposed to
remember: every allocating capability declares a preflight; a capability that
duplicates an operator refuses what the operator refuses; every bare name is
the same object as its full id; every budget has a node input, a ceiling above
its default, and a positive check; only an absent policy file means the
shipped defaults. Adding a reviewer does not stop the class. Stating the rule
as a test over the registry turns the next omission into an import error.

Test harness: a subprocess ComfyUI on a free localhost port with `--cpu`,
`--disable-all-custom-nodes`, an extra-model-paths file pointing
`custom_nodes` at a directory that symlinks this package under a private
name, and that name whitelisted. Results read from `/history`; run counts
from Flow Probe files. Never a production port, never the live checkout.

---

## 12. Phases

1. Expressions, registry, Gate, Condition, Lazy Select, Filter, Partition,
   Flow Probe, tests A-H, two example graphs (core-only logic tour; resize
   gate). **In progress.**
2. Run when / Skip when compiled as section 6 (one Gate, widget read, the
   bypass passthrough rule), bypass-tint dimming, compiled-flow reveal.
   **Next.** Its acceptance is the section 6 round trip (create in the UI,
   save, reload, export, run headless), which needs a browser; Gate D is
   already the headless half.
3. Safe Function: parser, validator, interpreter, planner, signature UI,
   transform capabilities, security tests.
4. LLM Judge, LLM Choose, then the bounded loop.
5. For Each over a subgraph body (node expansion), `image.select`, after
   real batch cases are collected.

---

## 13. Product principle

Beginner: "Run Resize when scale != 1". Intermediate: Condition into Gate
or Switch. Advanced: `def main(...)`. All three compile to the same idea:

> Only evaluate the part of the graph required to produce the selected
> result.

---

## 14. Style and repo rules for this package

Public repo. No community or operator names in code, docs, examples or
commit messages; describe the question, not the person. No em-dashes. No
self-assessment prose. Examples ship as API-form JSON plus editor-form JSON
once a browser has produced it; until then the README says which is which.

---

## 15. Probes, answered 2026-08-28 (Phase 1 build, live CPU sandbox)

1. Autogrow over a `MatchType` template (Lazy Select). **PARTIAL FAIL.**
   The template resolves and executes; per-slot laziness does not work
   (`comfy_execution/graph.py:118` and `:159` read laziness from the
   unexpanded `INPUT_TYPES()`). Shipped: eight fixed lazy slots. Standing
   rule: no lazy input behind Autogrow. See section 4.3.
2. Autogrow over an `AnyType` template (Gate / Condition `values`).
   **PASS.** Note the prompt key for a grown input is `values.a`, not `a`.
3. Empty Comfy list maps zero times. **FAIL**, in both core shapes. See
   section 4.4; guard with `kept_count`.
4. `NodeOutput(ui=...)` on a V3 node with a `MatchType` output reaches
   `/history`. **PASS**, and non-output nodes reach it too
   (`execution.py:563-576`).

Two further facts the build established, both load-bearing for later
phases:

* `validate_inputs` must accept the Autogrow argument even when it ignores
  it: core re-adds the nested dict after filtering by argspec
  (`execution.py:1082-1091` then `_io.build_nested_inputs`), so a signature
  without it fails at queue time.
* The test suite needs `PYTHONPATH=<ComfyUI root>`, and a `conftest.py`
  shim, because pytest 8 imports the pack root's `__init__.py` as a
  top-level module. See the Phase 1 report's REVIEW THIS item 4.

Answered 2026-08-28 (evening, post-build), same sandbox:

5. **A Gate that reads its guarded node's inline widgets out of DYNPROMPT is
   cache-correct and lazy.** PASS. Hidden `dynprompt` and `unique_id` reach
   `check_lazy_status`. Four queues of one graph differing only in the
   resize's inline `scale_by` (1.0, 0.5, 1.0, 0.75) produced resize run
   counts 0, 1, 1, 2 in the standalone probe: the second queue re-decided
   on a sibling's widget with the Gate's own inputs byte-identical, which a
   key that ignored the sibling could not have done. (In the suite the
   fourth queue's upstream probe can itself be cache-served, so the test
   asserts the decision and that neither the Gate nor the resize was
   cached, rather than a count.) A widget converted to a link is refused by
   name. See section 4.1 for why the ancestry, not a fingerprint, is what
   makes it safe. `tests/flow/test_gates.py` carries all four queues as
   `test_gate_reads_the_guarded_nodes_widgets_and_the_cache_sees_them`, and
   a dotted data predicate on the same Gate as
   `test_a_data_predicate_still_works_on_a_gate_that_reads_widgets`.
6. **A V3 node returning `ExecutionBlocker(None)` skips a downstream
   SaveImage silently.** PASS: status success, zero files, the sink absent
   from `/history` outputs; enabled, one file. A blocker WITH a message
   also completes as success and only raises an `execution_error` event on
   the socket, so the silent form is the one "Skip when" uses. Carried as
   `test_a_gate_with_no_source_blocks_the_sink`.

