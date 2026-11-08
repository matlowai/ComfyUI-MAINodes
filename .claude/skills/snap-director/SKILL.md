---
name: snap-director
description: Plan, customize and carry out native SNAP production strategies using existing Book, scene, Cast, reference, generation and critique tools. Use for Script to Film, Dialogue Director, Transform Footage, scoped production preferences, shot-duration packing and reference-role proposals.
scope: [tool:list_strategies, tool:describe_strategy, tool:plan_strategy, tool:save_strategy_variant, tool:strategy_parameter_note, tool:pack_shots, tool:compile_reference_roles]
rules: [SNAP-R1, SNAP-R2, SNAP-R3, SNAP-R16, SNAP-R19, SNAP-R23, SNAP-R24, SNAP-R58, SNAP-R60, SNAP-R67, SNAP-R93, SNAP-R95, SNAP-R109, SNAP-R242, SNAP-R267, SNAP-R270, SNAP-R271, SNAP-R272, SNAP-R273]
---

# Native production strategies

Read `snap-core` first and discover this server's actual tools. When reachable, `read_skill {"name":"snap-director"}` supplies the person's version. The production strategy is an editable starting approach, not a second filmmaker application, executor, queue or authority source. All final graphs are native ComfyUI; all creative state remains in the existing Book/world records.

## Choose and inspect

Call `list_strategies`, then `describe_strategy` with an exact reference such as `pack:script-to-film@1.0.0`, `pack:dialogue-director@1.0.0` or `pack:transform-footage@1.0.0`. `ready` identifies an implemented planner, not a qualification of installed models or rendered quality. Draft entries are design-only and cannot produce a plan. Never silently choose a different version when an exact one is missing or an alias is ambiguous.

Find the actual Book, scene, shot or original video take. Read the resolved instruction stack. Specify `scene` with `shot`; an explicit Book must agree with scene ownership. Do not combine a historical Book version with current mutable scene files. Call `plan_strategy` with that context and only the explicit choices the person has made. The result includes the complete plan, provenance, errors, warnings, bindings, reused assets and instruction stacks. Planning itself does not queue work, extract video frames, create missing production records or modify the graph.

An `ok` plan means its inspected structure has no reported errors. It does **not** mean operations have all their inputs, stages have satisfied their preconditions, or execution is authorized. `arguments_complete` is only a structural property. Stage checks and creator decisions remain binding. Unresolved or contradictory parameters are not excuses to pick a convenient default.

## Execute through the existing SNAP tools

The plan is an agent worklist, never a script to blindly execute from top to bottom. Before an operation, verify its stage preconditions, actual page/shot ownership, current instruction stack, native schema and upstream result. Call the ordinary tool through SNAP's existing MCP/WebMCP/snapcall interface. Do not call module internals, queue raw ComfyUI JSON, invent a second runner or pass `confirmed:true` from an agent to impersonate a human.

Bind output identities from actual tool results. A returned proposal is not an accepted story edit, candidate decision or render job. Inspect its result through native proposal tools and continue only under existing authorization. For real jobs use `wait_for`, check `reached`, inspect the terminal state and propagate failures. A timeout is not success. Work card records remain the sole activity authority.

Replan after changes to story, accepted proposals, coverage, boards, source picks, trims, method choices, references or relevant instructions. A plan SHA identifies the inspected inputs; it is not a server lock or a resume token. Check `list_activity` before submitting to avoid duplicate work. Resume from current native records rather than a remembered task number. No new durable plan-progress store exists in this version.

For Script to Film, accept/import the screenplay through the existing Book proposal route. Preserve original wording when a screenplay was supplied. Replan with real accepted beat/cut IDs. Existing selected boards and takes are reuse **candidates**, conditioned on native staleness and critique. Missing Cast pictures require primary-image creation before a turnaround method can transform them. State-specific references remain `design_state` / `save_cast_state` work. No model downloads or installs are implicit.

For boards, respect `make_board.role`: a key drawing is not an opening board. Picking a key with `approved:true` does not change that. Create/review the opening separately where needed. Do not replace a Book cut's active video with a still. Use native set/pick policies and the existing `snap-boards` and unmodified `snap-critic` skills.

Before each video run, ensure the current recipe is the actual cut, its setup is ready, and `compile_unit` / `apply_unit` have resolved story and reference lint. Initializing an empty recipe can change tab ownership: inspect it again before running. Preserve the first seed unless a choice says otherwise; subsequent candidate renders use native `new_seed` to avoid identical cached results. Do not enable random mode globally or change somebody else's recipe. Tool and method scoped notes are resolved for the actual selected method. A stable method redirection follows native precedence; a method-choice cycle is explicit. Same-camera continuation waits for the predecessor's selected trim-out. A new angle or `none` request conflicting with an existing `opens_on` needs an explicit edit and replan.

For Dialogue Director, resolve named speakers to Cast. Give a voice only to a character with a line in that cut. Reference words must not duplicate script lines. Native word/voice QA is useful but never substitutes for listening. `coverage` guides deliberate two-shots, reverses, reactions and inserts; it is not a rigid cut-per-line rule.

For Transform Footage, use the successful native source video take, leaving it intact. `frames` are painted anchors, **not** a constrained edit range. A requested frame range or temporal mask currently reports a capability gap; never replace it silently with a full-clip edit. Native edit candidates are batched at a maximum of three. Wait for painted candidates, inspect them, make an authorized native pick, then wait for propagated output and critique it. Recasting needs explicit source/replacement descriptions. Upscale only the chosen result through a compatible native method.

## Creative review remains native

Use `list_critiques`, claim the appropriate docket work and follow `snap-critic` exactly. Read every whole frame before tiles and separate observation from interpretation. Do not revise the measured critic prompt as part of a production preset. Finish relevant criticism before recommending candidate picks. Fix the earliest evidenced source and use existing dependency-rerun tools under their permissions.

Review the assembled Cut for action phase, persistent damage, prop ownership, grade/detail and sound splices; watch and listen to the actual export. Never claim listening from ASR, metadata or waveforms. The existing Astrid push controls remain the person's choice; this strategy layer neither enables them nor writes into Astrid.

## Customize without forks or instruction drift

For a durable parameter choice, inspect existing relevant notes first. `strategy_parameter_note` returns an exact `save_instruction` call but saves nothing. Review it, then invoke the native instruction tool. Supply the existing instruction reference when changing the same preference, rather than creating competing notes. Parameter data lives under `source.snap_director`; the whole human-readable text remains alongside it. Native scope resolution, supersession, off marks and render instruction pins remain authoritative.

Definition defaults inherit through `extends`. Runtime notes target the selected strategy only; a base preset's preference does not implicitly leak into a different derived preset. A deliberate `strategy:"*"` typed note is an explicit cross-strategy choice. Ordinary notes remain intact for agent interpretation. Current explicit request parameters override typed defaults; same-rank conflicts and native instruction conflicts stay visible. Notes pin a strategy digest; do not erase a mismatch to make a plan pass.

Use `describe_strategy` to obtain the full resolved definition and digest. Edit a copy with a distinct id/version, then call `save_strategy_variant` with `dry_run:true`. It must be complete and flattened, not inherit mutable data. A real save is a normal proposal for the person regardless of autonomy. Confirmed user execution stores an immutable content-addressed card. Do not change the shared strategy, install anything or claim the variant was activated automatically. These are account-owned local records, not a promise of encrypted storage or share-safe contents.

## Deterministic helpers

`pack_shots` consumes explicit beat durations, speech floors and engine limits from verified native capabilities. It proposes top-K legal partitions with integer frames, grid alignment, padding, joins and boundary costs. `preferred_seconds` concerns one generation; `target_seconds` is the whole production objective. The helper never drops speech, splits an indivisible beat or edits Book cuts. Timing estimates and objective weights are planning assumptions, not quality measurements.

`compile_reference_roles` consumes declared source identities, roles and a declared model profile. It separates generation, agent context and review; accounts for budgets; puts the required first canvas/frame first; and binds `{{ref:id}}` placeholders. Missing required inputs, raw numbered citations and conflicting geometry are errors. All exclusions are returned. Read the full result, including review-only evidence and the supplied profile's provenance.

A textured top plus genuine side/elevation is a preparation requirement for relevant scene-view work; prefer two sides. Crops are not new viewpoints. Metadata completeness does not establish actual correct geometry. Aerial-only ablation requires an explicit reason. Geometry knowledge can be used by the agent/critic without entering model conditioning. Non-speaking voices, unintended peak-pose targets and incompatible masters stay out. Native `apply_unit` / `edit_from_context` still own the actual graph and image order. Reconcile against their final returned prompts. `denoise`/encoded-target and H3 audio wiring are not modified by this helper.

## Handoff

Report exact Book/scene/shot/take identities, what was actually invoked and observed, remaining proposals/checks, selected strategy/card and instructions, current plan digest and next native action. Do not call a preview a completed film. Keep failures and limitations. Full runtime, GPU and UI qualification of this implementation remains a local integration responsibility.
