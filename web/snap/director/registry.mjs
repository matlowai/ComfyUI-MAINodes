// SNAP-R3 unresolved choices stay visible · SNAP-R60 immutable versions · SNAP-R93 resolved instructions win. · SNAP-R272 native planning.
import { assertValid, clone, DirectorError, issue, orderDAG, stableJSON, validate } from "./validation.mjs";
import { DEFAULT_PARAMETERS, NATIVE_METHOD_PARAMETERS, PARAMETER_NOTE_BODY_SCHEMA, PARAMETER_SCHEMA, STRATEGY_DEFINITION_SCHEMA } from "./contracts.mjs";

export const strategyKey = (d) => `${d.id}@${d.version}`;
export function validateDefinition(definition) {
  assertValid(definition, STRATEGY_DEFINITION_SCHEMA, "strategy");
  const stages = definition.stages ?? [];
  const seen = new Set();
  for (const stage of stages) {
    if (seen.has(stage.id)) throw new DirectorError("DUPLICATE_STAGE", `duplicate stage ${stage.id}`);
    seen.add(stage.id);
    if (stage.kind !== "operations" && stage.operations) throw new DirectorError("INVALID_STAGE", `${stage.id}: operations belongs only on an operations stage`);
    if (stage.kind === "operations" && !stage.operations?.length) throw new DirectorError("EMPTY_OPERATIONS", `${stage.id}: supply at least one native operation`);
  }
  if (!definition.extends) {
    if (!stages.length) throw new DirectorError("EMPTY_STRATEGY", "A root strategy needs stages");
    orderDAG(stages);
  }
  return definition;
}
/** Input entries are {definition, ref, origin}. Never silently select between colliding aliases. */
export function createRegistry(entries) {
  const byRef = new Map(), aliases = new Map(), invalid = [];
  for (const entry of entries) {
    try {
      validateDefinition(entry.definition);
      const ref = entry.ref ?? `pack:${strategyKey(entry.definition)}`;
      if (byRef.has(ref)) throw new DirectorError("DUPLICATE_REFERENCE", `duplicate registry ref ${ref}`);
      const stored = { definition: clone(entry.definition), ref, origin: entry.origin ?? "pack" };
      byRef.set(ref, stored);
      const key = strategyKey(entry.definition);
      aliases.set(key, [...(aliases.get(key) ?? []), ref]);
    } catch (error) {
      invalid.push({ ref: entry.ref ?? null, id: entry.definition?.id ?? null, code: error.code ?? "INVALID_DEFINITION", message: error.message, details: error.details ?? [] });
    }
  }
  const lookup = (ref) => {
    if (byRef.has(ref)) return byRef.get(ref);
    const options = aliases.get(ref) ?? [];
    if (options.length > 1) throw new DirectorError("AMBIGUOUS_STRATEGY", `${ref} names ${options.length} entries; use an exact record reference`, options);
    if (options.length === 1) return byRef.get(options[0]);
    throw new DirectorError("UNKNOWN_STRATEGY", `No strategy ${ref}; use list_strategies and an exact version`);
  };
  function resolve(ref, seen = []) {
    const entry = lookup(ref);
    if (seen.includes(entry.ref)) throw new DirectorError("INHERITANCE_CYCLE", `inheritance cycle: ${[...seen, entry.ref].join(" -> ")}`);
    const d = entry.definition;
    let definition, lineage;
    if (d.extends) {
      const parent = resolve(d.extends, [...seen, entry.ref]);
      const stages = new Map(parent.definition.stages.map((s) => [s.id, clone(s)]));
      for (const stage of d.stages ?? []) stages.set(stage.id, clone(stage));
      definition = { ...clone(parent.definition), ...clone(d), parameters: { ...parent.definition.parameters, ...d.parameters }, skills: [...new Set([...(parent.definition.skills ?? []), ...(d.skills ?? [])])], stages: [...stages.values()] };
      delete definition.extends;
      lineage = [...parent.lineage, { ref: entry.ref, key: strategyKey(d), origin: entry.origin }];
    } else {
      definition = clone(d); lineage = [{ ref: entry.ref, key: strategyKey(d), origin: entry.origin }];
    }
    orderDAG(definition.stages);
    validateDefinition(definition);
    return { ref: entry.ref, definition, lineage };
  }
  function list() {
    const items = [];
    const problems = clone(invalid);
    for (const entry of byRef.values()) {
      try {
        const r = resolve(entry.ref);
        items.push({ ref: r.ref, key: strategyKey(r.definition), name: r.definition.name, summary: r.definition.summary, status: r.definition.status, origin: entry.origin, stage_count: r.definition.stages.length, lineage: r.lineage });
      } catch (error) { problems.push({ ref: entry.ref, code: error.code ?? "INVALID_STRATEGY", message: error.message }); }
    }
    return { strategies: items, count: items.length, invalid: problems, invalid_count: problems.length };
  }
  return { resolve, list };
}

const LEVEL = { pack: 0, install: 1, person: 2, book: 3, scene: 4, shot: 5, take: 6 };
const RANK = { global: 0, tool: 1, brick: 1, method: 1, cast: 2, location: 2, card: 2 };
const METHOD_JOBS = { "snap.director.edit": "edit_method", "snap.director.view": "view_method", "snap.director.upscale": "upscale_method" };
/** Fold typed parameter data *after* SNAP has resolved scopes, disabled notes and supersession.
 * Natural-language notes are returned intact for the agent, never interpreted by this function. */
export function resolveParameters(resolved, instructions = {}, request = {}, methods = []) {
  assertValid(request, PARAMETER_SCHEMA, "request parameters");
  const effective = { ...DEFAULT_PARAMETERS, ...resolved.definition.parameters };
  const provenance = Object.fromEntries(Object.keys(effective).map((k) => [k, { source: resolved.ref, level: "strategy", value: clone(effective[k]) }]));
  const errors = [], warnings = [], choices = new Map();
  // Definition defaults inherit; runtime notes do not leak from a base preset into a child.
  // Use an explicit wildcard for a deliberate cross-strategy preference.
  const acceptedKeys = new Set([strategyKey(resolved.definition)]);
  for (const row of instructions.stack ?? []) {
    let values = null;
    const data = row.source?.snap_director;
    if (data) {
      try { assertValid(data, PARAMETER_NOTE_BODY_SCHEMA, `parameter note ${row.ref}`); }
      catch (error) { errors.push(issue("INVALID_PARAMETER_NOTE", error.message, row.ref, { details: error.details })); continue; }
      if (data.strategy === "*" || acceptedKeys.has(data.strategy) || data.strategy === resolved.ref) {
        if (data.definition_sha256 && data.definition_sha256 !== resolved.digest) errors.push(issue("STRATEGY_DIGEST_CHANGED", `${row.ref}: the selected strategy definition differs from the pinned note; review and update deliberately`, row.ref));
        values = data.parameters;
      }
    }
    if (row.kind === "model_choice" && Object.hasOwn(METHOD_JOBS, String(row.job).toLowerCase())) values = { ...(values ?? {}), [METHOD_JOBS[String(row.job).toLowerCase()]]: row.choice };
    if (!values) continue;
    const level = LEVEL[row.level ?? row.layer];
    if (level === undefined) { errors.push(issue("UNKNOWN_INSTRUCTION_LEVEL", `Cannot order ${row.ref}`, row.ref)); continue; }
    const precedence = level * 10 + (RANK[String(row.scope).split(":")[0]] ?? 0);
    for (const [field, value] of Object.entries(values)) {
      const current = choices.get(field);
      if (!current || current.precedence < precedence) choices.set(field, { precedence, rows: [{ ref: row.ref, level: row.level ?? row.layer, value }] });
      else if (current.precedence === precedence) current.rows.push({ ref: row.ref, level: row.level ?? row.layer, value });
    }
  }
  for (const [field, group] of choices) {
    const distinct = new Set(group.rows.map((r) => stableJSON(r.value)));
    if (distinct.size > 1) {
      const conflict = issue("PARAMETER_CONFLICT", `Conflicting resolved notes for ${field}`, field, { choices: group.rows });
      if (Object.hasOwn(request, field)) warnings.push({ ...conflict, resolved_by_request: true }); else errors.push(conflict);
    } else {
      effective[field] = clone(group.rows[0].value);
      provenance[field] = { source: group.rows.map((r) => r.ref), level: group.rows[0].level, value: clone(effective[field]) };
    }
  }
  for (const [field, value] of Object.entries(request)) { effective[field] = clone(value); provenance[field] = { source: "current request", level: "request", value: clone(value) }; }
  for (const conflict of instructions.conflicts ?? []) errors.push(issue("INSTRUCTION_CONFLICT", "The native instruction resolver reports a conflict; inspect the named notes", "instructions", { refs: clone(conflict) }));
  errors.push(...validate(effective, PARAMETER_SCHEMA, "effective_parameters"));
  const activeKinds = new Set(resolved.definition.stages.filter((s) => s.enabled !== false).map((s) => s.kind));
  for (const [parameter, slot] of Object.entries(NATIVE_METHOD_PARAMETERS)) {
    if (parameter === "edit_method" && !activeKinds.has("transform")) continue;
    if (parameter === "view_method" && !["assets", "location", "boards"].some((k) => activeKinds.has(k))) continue;
    if (parameter === "upscale_method" && !(activeKinds.has("upscale") && effective.upscale)) continue;
    const method = effective[parameter];
    if (!method || method === "inherit") continue;
    if (parameter === "edit_method" && effective.edit_mode === "recast") continue;
    const found = methods.find((m) => m.slot === slot && m.id === method);
    if (!found) errors.push(issue("METHOD_UNRESOLVED", `No ${slot}/${method} in the current method registry`, parameter));
    else if (found.wired === false || !!found.unwired) errors.push(issue("METHOD_UNWIRED", `${slot}/${method} is declared but not wired`, parameter));
    else if (found.install_state && found.install_state !== "ready") warnings.push(issue("METHOD_NOT_READY", `${slot}/${method}: ${found.install_state}`, parameter));
  }
  return { effective, provenance, errors, warnings, instructions: clone(instructions), natural_language_requires_agent: true };
}
