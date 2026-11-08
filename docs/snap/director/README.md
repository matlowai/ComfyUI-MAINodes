# Native production strategies

This optional extension adds three editable production planners to SNAP: Script to Film, Dialogue Director and Transform Footage. It composes existing tools and records. It does not run a parallel production engine or make SNAP depend on another application.

Open **Production strategies** in Snap's Library rail, **Strategies** in the ComfyUI action bar, or **SNAP: Production strategies** in the command palette. Select a preset, optionally enter a Book/shot or source take, and preview the plan. The open shot supplies its Book when available. Preference notes default to that Book or the narrower entered scene/shot; global scope remains an explicit choice. An authorized agent follows the plan using ordinary SNAP tools and current instructions; the existing Book, Work card, proposals, graph and critique remain authoritative.

The seven agent tools are `list_strategies`, `describe_strategy`, `plan_strategy`, `save_strategy_variant`, `strategy_parameter_note`, `pack_shots`, and `compile_reference_roles`. Read `snap-director` before using them. Exact preset references start with `pack:`; private strategies use versioned `card:` references. Five future strategies are explicitly marked draft and do not compile.

`ready` is a catalogue/planner status, not proof of model readiness or output quality. A structurally valid plan may still need inputs, creative decisions, permissions and reviews. It does not persist workflow progress or silently skip missing capability. In particular, temporal-mask/frame-range preservation is not implemented through the Transform Footage plan; anchor frames are not a frame range.

## Source ownership

- `web/snap/director/strategies.json`: one preset catalogue, exact versioned inheritance.
- `contracts.mjs`, `registry.mjs`: strict strategy data, scoped parameter folding and immutable resolution.
- `planner.mjs`, `packing.mjs`, `references.mjs`: pure planning and deterministic helpers.
- `snapshot.mjs`, `host.mjs`, `native.mjs`, `service.mjs`: read-only record projection and native adapters/tool descriptors.
- `dialog.mjs`, `web/snap_director.js`: progressive-disclosure UI using the same tools.
- `.claude/skills/snap-director/SKILL.md`: canonical operational guidance; `.agents` contains only its portable wrapper.

Saved strategies are existing versioned card records. Scoped preferences are existing instruction records. Generated assets, story state, accepted choices and execution jobs are not stored by this module. Original `compile_unit`, native model/socket wiring, partial-init behavior, voice QA, critic prompt, dependency reruns and Astrid integration remain in their current owners.

A narrowly scoped fix makes existing Book-scoped instructions match their Book's scenes. This can change which previously stored Book notes apply. Review the resolved stacks on a disposable local instance before rendering an old project.

Tool-specific previews include the selected method's native instructions. Inherited board methods follow the native view-purpose registry. Method-directed changes follow native precedence until stable; a cycle names the competing method choices. Director adds no candidate, screenplay, reference or duration ceilings beyond native capabilities and explicitly supplied helper limits.

## Local checks

From the repository root, after integration:

```sh
node --test tests/snap/director/*.test.mjs
node tests/snap/test_qwen21_graph.js
node tests/snap/test_view_init.js
git diff --check
```

The first command exercises the new CPU code. The latter two are existing experimental regression checks and must be run locally; they were not available as a complete runnable checkout in the authoring container. Follow the branch's existing full regression instructions separately. No passing CPU check certifies actual GPU output, live page ownership, encrypted-record access, native review, or browser transport.

The Director lane is included in `tests/snap/run_all.sh`; its complete output is `director.out` in the gate output folder.
See [local integration evidence](INTEGRATION_2026-11-08.md) for the source baseline, adaptations and test boundaries.
