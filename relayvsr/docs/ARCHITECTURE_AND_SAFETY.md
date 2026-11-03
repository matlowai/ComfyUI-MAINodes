# Runtime mechanism, tuning semantics and safety limitations

## RelayVSR architecture relevant to the experiment

RelayVSR is not a normal multi-step image diffusion pipeline. The original architecture combines sparse generative **Wan** reference production with a lighter **Flash/Dual-Memory** reconstruction path that propagates detail through time. LightX2V's native X2 branch requires a different trained checkpoint pair from original X4. The experimental wrapper uses **LightX2V** for both variants and does not mix weights.

We add no new diffusion denoising steps and no new trained parameters. The experiment adds extra calls to particular existing transformer blocks inside an existing forward. Whether those extra calls are meaningful on this distilled model is an open question.

## The three execution modes

- `off`: invoke the standard `python -m lightx2v.infer`; experimental Python code is not executed in the worker. Correct control case.
- `discover`: invoke `python -m relay_looping.launch -- <original arguments>`; installs a read-only module-forward-pre-hook, logs torch ModuleList candidates and writes a report. It **does not** alter block forward functions.
- `experiment`: same isolated bootstrap; attaches wrappers to live block instances when the parent module's first real forward is observed. The configuration is a JSON file passed via environment variable. The CLI is otherwise unmodified. If any requested stage never executes an extra block call, the worker raises an error and the output is not published.

The worker is launched in the LightX2V interpreter, with this nodepack directory added to `PYTHONPATH`. On a normal run, the ComfyUI environment never imports heavyweight LightX2V model classes. Discovery/experiment modes disable compile/warmup through validation (no silent changing of user settings).

## Repeating a group vs repeating individual blocks

A contiguous group `B = B_9∘B_8∘...∘B_4` normally evaluates **once**: `h1=B(h0)`. A two-pass `group` experiment runs `h2=B(h1)`, then outputs the selected mixture (see below). At the end of the initial group, the runtime captures the non-hidden inputs for each block on the original pass, and invokes the group's blocks sequentially again with the new hidden representation.

By contrast `per_block` makes each selected block `B_i` run again immediately on its own output, before moving to the next selected block. These are not equivalent: group recurrence is `B9(...B4(B9(...B4(h))))`; per-block recurrence is `B9(B9(...B4(B4(h))))`.

**Constraints:** group mode accepts only a contiguous range of indices; `per_block` can accept disjoint indices. Original block forwards must accept a shape-compatible first tensor/`hidden_states` input and return a tensor (or tuple/list whose first value is a tensor). A result that fails those contracts produces a worker error; the wrapper does not guess a hidden-state transformation.

## Loop strengths and strategies

- `passes=1`: one normal block/group forward; no loop at all.
- `passes=2`: one normal forward + one extra pass; `passes=3` + two extras. Values 1..4 are supported, with a conservative cap to limit runaway computation.
- `strength` 0..1: `0` is inactive and `1` uses the full repeated result.
- `final_blend`: save the original group output `h1`, compute the final repeated output `hn`, return `h1 + strength * (hn - h1)`. This is a hidden-state interpolation and has not been trained/calibrated for RelayVSR.
- `damped_steps`: apply a damped partial update after each additional group pass: `h_next = h_prev + (strength / (passes-1)) * (B(h_prev)-h_prev)`. In per-block mode, the same idea applies to each selected block's own forward.
- `every_nth_call`: optionally repeat only on every Nth invocation of the selected group/block (per-module invocation count, **not** explicitly video frame number). The base pass always happens.
- `max_activations`: maximum number of selected group/block invocations receiving repeats; zero means unlimited. This is an inference-workload throttle, not a learned adaptive scheduler.
- `check_finite=true`: fail on non-finite loop outputs; incurs per-block GPU synchronization and can greatly affect timings.

**Do not overinterpret partial strength** as a clean "detail intensity" axis. Network hidden states can move in nonlinear ways.

## Actual target discovery

When a torch `nn.Module` is called, a global forward-pre-hook checks its direct children for `nn.ModuleList` containers. It records all discovered lists, including a `transformer_like` heuristic (`block`/`transformer` in the container or class). Automatic experiments only attach to transformer-like candidates; a source-reviewed `owner_regex` can explicitly select a nonstandard container. It records:

```json
{
  "owner": "package.module.WanModel",
  "list_name": "blocks",
  "block_class": "package.module.WanBlock",
  "size": 30,
  "transformer_like": true
}
```

That object is **illustrative only**. The real class names and sizes must come from your `discover` report. If a class is missing, inspect LightX2V's current implementation and change the detector with tests; don't assume the model doesn't have blocks.

The default selector searches that combined qualified identifier for `wan` or `flash`, depending on stage. `owner_regex` replaces the simple match with a user-specified regex, and `block_class_regex` further restricts the block class. Both can be set independently for Wan and Flash. By default more than one container match causes a hard error, not a possibly incorrect multi-model patch.

## Explicit limitations / research risks

1. **Streaming KV cache mutation.** Repeating a block may update keys/values or auxiliary memory more than once. The strict code detects non-`None` named arguments whose names suggest `cache`, `memory`, etc., and aborts unless `allow_stateful_repeats=true`. But internal mutable caches and references are not intercepted or restored; the name-based guard is *not a proof of safety*. `allow_stateful_repeats=true` means the user accepts this risk, not that the problem is solved.
2. **Non-first-hidden inputs.** A block with its actual hidden state in an unexpected position cannot be looped generically; it'll fail rather than injecting a tensor into the wrong argument. Same for shape changes between successive blocks.
3. **Tuple ancillary outputs.** The replacement only changes the primary tensor (first element). Other tuple/list members from the baseline are returned unchanged; any caches produced in ancillary outputs or stateful side effects require source-specific review.
4. **Memory and kernel side effects.** The hook might repeat execution on a model using offload, SP, fused operators or compiled transforms. Single GPU with `use_compile=false`, `warmup=false` is the supported experimental starting point. Advanced modes are explicitly gated.
5. **Hook discovery is a heuristic.** Models whose forwards directly invoke `.forward(...)`, that store blocks in custom containers or that fuse layers in native kernels may not be captured. The run must not silently claim loops occurred.
6. **Extra computation cost.** Repeating Wan blocks at sparse reference points may have a different amortized cost from repeating Flash blocks every frame. `extra_block_calls` is only an operation count, not a FLOP or latency measurement.
7. **Output quality and temporal stability.** There are no trained recurrent adapters; loops can improve or degrade spatial fidelity, phase consistency, detail and color. Always review the full video and source fidelity.
8. **Offload/state-of-the-world.** This code was built from inspected public docs and the previous local integration, but the exact LightX2V model tree couldn't be cloned in this isolated environment. It has **not** yet been tested with downloaded checkpoints. Treat the discovery-first workflow as mandatory.

## File/control map

| File | Responsibility |
|---|---|
| `bridge.py` | Per-run config, worker subprocess launch, process termination, sidecars and optional audio mux |
| `nodes.py` | `RelayVSRBlockLoopLab` settings node plus original video/file/IMAGE nodes |
| `relay_looping/spec.py` | schema, validation, block selector DSL |
| `relay_looping/launch.py` | `runpy` bootstrap of unmodified `lightx2v.infer`, report-on-failure/exit |
| `relay_looping/runtime.py` | live `nn.ModuleList` discovery, group/per-block forward wrappers, counters, cache-signal guard |
| `presets/*.json` | explicitly unverified experimental definitions |
| `tools/run_experiments.py` | headless consistent-seed A/B sweep (plan-only unless `--execute`) |
| `tools/make_ab_preview.py` | side-by-side frame-synchronized preview creation |
| `tests/test_loop_lab.py` | toy Torch numerical checks and fake LightX2V subprocess integration |

This is research tooling—not a validated production inference accelerator or an implementation of Looped-DiT's trained self-modulating attention.
