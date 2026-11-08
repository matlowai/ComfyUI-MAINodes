// SNAP-R19 shared tool table · SNAP-R60 immutable variants · SNAP-R93 native notes · SNAP-R272 native planning.
// All integration dependencies are injected, so adapter behavior can be tested without browser or GPU mocks masquerading as product proof.
import { assertValid, clone, DirectorError, sha256 } from "./validation.mjs";
import { createRegistry, resolveParameters, validateDefinition } from "./registry.mjs";
import { PARAMETER_NOTE_SCHEMA, PARAMETER_SCHEMA, STRATEGY_DEFINITION_SCHEMA } from "./contracts.mjs";
import { compilePlan, PLAN_REQUEST_SCHEMA } from "./planner.mjs";
import { PACK_SCHEMA, packShots } from "./packing.mjs";
import { REFERENCE_REQUEST_SCHEMA, compileReferences } from "./references.mjs";

const string = { type: "string", minLength: 1 };
const SCOPE_SCHEMA = { type: "string", pattern: "^(global|book:[A-Za-z0-9][A-Za-z0-9_.-]*|scene:[A-Za-z0-9][A-Za-z0-9_.-]*|shot:[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*)$" };
const VARIANT_SCHEMA = { type: "object", required: ["base", "definition", "expected_base_sha256"], additionalProperties: false, properties: {
  base: string, expected_base_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, definition: STRATEGY_DEFINITION_SCHEMA,
  dry_run: { type: "boolean" },
} };
export const NOTE_SCHEMA = { type: "object", required: ["strategy", "scope", "parameters"], additionalProperties: false, properties: {
  strategy: string, scope: SCOPE_SCHEMA, parameters: PARAMETER_SCHEMA, instruction: string,
} };

/** host: registryEntries(), snapshot(request), instructions(snapshot), methods(), tools(),
 * saveCard(id, body), propose(tool,args,reason), who(). No scheduler/run/eval capability is accepted. */
export function createDirectorService(host) {
  const registry = async () => createRegistry(await host.registryEntries());
  async function describe(strategy) {
    const resolved = (await registry()).resolve(strategy);
    return { ...resolved, definition_sha256: await sha256(resolved.definition), writable: false,
      implementation: resolved.definition.status === "ready" ? "planner implemented; live product checks pending" : "design-only", mutates: false };
  }
  async function variant(args, ctx = {}) {
    assertValid(args, VARIANT_SCHEMA, "save_strategy_variant");
    const base = await describe(args.base);
    if (base.definition_sha256 !== args.expected_base_sha256) throw new DirectorError("BASE_STRATEGY_CHANGED", "Re-read describe_strategy and reconcile the base before saving this variant");
    if (args.definition.extends) throw new DirectorError("VARIANT_MUST_BE_FLAT", "Submit the complete resolved definition, without extends; a saved variant cannot drift with upstream inheritance");
    validateDefinition(args.definition);
    if (args.definition.id === base.definition.id && args.definition.version === base.definition.version) throw new DirectorError("VARIANT_ID_REQUIRED", "Use a distinct id or version for the variant; do not impersonate the existing release");
    const origin = { ref: base.ref, sha256: base.definition_sha256, lineage: base.lineage };
    // Hash content and source, not author/time; identical concurrent saves converge without overwriting an existing record.
    const hash = await sha256({ definition: args.definition, origin });
    const id = `director-${hash}`;
    const body = { id, kind: "production_strategy", title: args.definition.name, text: args.definition.summary,
      strategy: clone(args.definition), source: { snap_director: { schema: "snap.strategy-source/v1", origin } } };
    const preview = { ref: `card:${id}`, sha256: hash, body, base: origin, changed: true, mutates: false };
    if (args.dry_run) return preview;
    if (ctx.confirmed !== true) {
      const proposed = await host.propose("save_strategy_variant", args, `Save the private production strategy “${args.definition.name}” without changing the shared preset`);
      return { proposed: proposed.id, status: "waiting for the person", preview };
    }
    const result = await host.saveCard(id, body);
    return { ref: result.ref, version: result.n, made: result.made, sha256: hash, mutates: !!result.made,
      next: "Use this exact card reference with describe_strategy/plan_strategy. It is a versioned private card, not a new execution service." };
  }
  const read = { readOnlyHint: true, untrustedContentHint: true };
  return [
    { name: "list_strategies", description: "List all native production strategies, exact versions and invalid entries without silently dropping them. Ready means planner implementation, not tested render quality. Reads only; no generation or installation.",
      inputSchema: { type: "object", properties: {} }, annotations: read,
      run: async () => ({ ...(await registry()).list(), mutates: false }) },
    { name: "describe_strategy", description: "A whole resolved production strategy with lineage and its SHA-256. Use this exact digest when proposing a private variant. Strategies guide existing SNAP tools and never grant permission.",
      inputSchema: { type: "object", properties: { strategy: string }, required: ["strategy"] }, annotations: read,
      run: ({ strategy }) => describe(strategy) },
    { name: "plan_strategy", description: "Preview a SNAP-native production plan from current records and resolved instructions. No writes, queueing, new tabs, model calls or graph edits in this planner. Returns every stage and ordinary tool call, unresolved bindings, reuse candidates and capability gaps. After any mutation, proposal decision or predecessor pick, replan. Use pack_shots for explicit engine limits. Native initialization retains its own existing legacy migration behavior.",
      inputSchema: PLAN_REQUEST_SCHEMA, annotations: read,
      run: async (request) => {
        assertValid(request, PLAN_REQUEST_SCHEMA, "plan_strategy");
        const resolved = (await registry()).resolve(request.strategy);
        const snapshot = await host.snapshot(request);
        const instructions = await host.instructions(snapshot);
        const scopedInstructions = {}, toolInstructions = {}, methods = await host.methods();
        const definition = { ...resolved, digest: await sha256(resolved.definition) };
        async function forTool(context, unit = null) {
          let stack = await host.instructions(snapshot, context), selected = null;
          if (context.tool === "upscale_take" && request.parameters?.upscale === false) return stack;
          const visited = new Set();
          while (true) {
            const parameters = resolveParameters(definition, stack, request.parameters ?? {}, methods).effective;
            const method = host.methodFor(context.tool, parameters, unit);
            if (method === selected) return stack;
            if (visited.has(method)) throw new DirectorError("METHOD_SCOPE_CYCLE", `Method instructions cycle through ${[...visited, method].join(" → ")}; reconcile the competing method choices`);
            visited.add(method); selected = method;
            stack = await host.instructions(snapshot, { ...context, ...(method ? { method } : {}) });
          }
        }
        const boards = resolved.definition.stages.some((s) => s.enabled !== false && s.kind === "boards");
        for (const unit of snapshot.units ?? []) {
          scopedInstructions[`${unit.scene}/${unit.shot}`] = await host.instructions(snapshot, { scene: unit.scene, shot: unit.shot });
          if (boards) toolInstructions[`${unit.scene}/${unit.shot}:make_board`] = await forTool({ scene: unit.scene, shot: unit.shot, tool: "make_board" }, unit);
        }
        if (resolved.definition.stages.some((s) => s.enabled !== false && s.kind === "transform")) toolInstructions.edit_take = await forTool({ tool: "edit_take" });
        if (resolved.definition.stages.some((s) => s.enabled !== false && s.kind === "upscale")) toolInstructions.upscale_take = await forTool({ tool: "upscale_take" });
        return compilePlan({ resolved, snapshot, request, tools: host.tools(), methods, instructions, scopedInstructions, toolInstructions });
      } },
    { name: "save_strategy_variant", description: "Save a complete, flattened strategy as an immutable private card in SNAP's existing versioned world store. Requires the exact base digest. dry_run writes nothing. An agent's real save always becomes a normal proposal, independent of the Book autonomy dial; only the existing confirmed user path saves. No downloads, activation, code execution or production changes.",
      inputSchema: VARIANT_SCHEMA, direct: true, run: variant },
    { name: "strategy_parameter_note", description: "Build, but do not save, the exact native save_instruction call for strategy parameters at global/Book/scene/shot scope. Reuse instruction when changing an existing note. The existing instruction resolver and render pins remain authoritative; no parallel preference store. The text and source preserve the selected strategy digest.",
      inputSchema: NOTE_SCHEMA, annotations: read,
      run: async (args) => {
        assertValid(args, NOTE_SCHEMA, "strategy_parameter_note");
        const strategy = await describe(args.strategy);
        const data = { schema: PARAMETER_NOTE_SCHEMA, strategy: strategy.ref, parameters: clone(args.parameters), definition_sha256: strategy.definition_sha256 };
        const text = `Production strategy ${strategy.definition.name} (${strategy.definition.id}@${strategy.definition.version}; ${strategy.definition_sha256}). Parameters: ${JSON.stringify(args.parameters)}. These are workflow preferences, not permissions. Read snap-director and use existing SNAP tools.`;
        return { mutates: false, tool: "save_instruction", args: { ...(args.instruction ? { id: args.instruction } : {}), scope: args.scope, kind: "note", text, source: { snap_director: data } },
          next: "Inspect the target's existing instruction stack and avoid duplicate notes. Invoke save_instruction normally; its record and scope govern future renders. Turning off a person/pack instruction still requires the normal proposal." };
      } },
    { name: "pack_shots", description: "Pure top-K duration packing of explicitly timed beats under caller-supplied engine limits and frame grid. Preserves all beats and speech floors; cannot invent engine compatibility or silently split an overlong beat. preferred_seconds is a per-generation preference, not the film's duration. No Book edits or rendering.",
      inputSchema: PACK_SCHEMA, annotations: read, run: packShots },
    { name: "compile_reference_roles", description: "Pure reference selection and semantic-tag preview with full omissions, required-budget errors, metadata-only top/side coverage and voices only for listed speakers. Input profile is caller-declared, not verified against the live graph. Context/review references stay out of conditioning. Does not replace apply_unit/edit_from_context or change partial-init wiring.",
      inputSchema: REFERENCE_REQUEST_SCHEMA, annotations: read, run: compileReferences },
  ];
}
