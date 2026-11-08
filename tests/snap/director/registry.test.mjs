import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry, resolveParameters, validateDefinition } from "../../../web/snap/director/registry.mjs";
import { jsonSafe, stableJSON, sha256 } from "../../../web/snap/director/validation.mjs";
import { entries, registry, methods, parameterNote, instructionStack, freeze } from "./fixtures.mjs";

test("catalogue contains three functioning planners and five explicit draft concepts", () => {
  const r = registry().list(); assert.equal(r.invalid.length, 0); assert.equal(r.strategies.length, 8);
  assert.equal(r.strategies.filter((x) => x.status === "ready").length, 3);
});
test("inheritance resolves exact pack base, stable stages and child settings without mutating input", () => {
  const input = freeze(structuredClone(entries)); const r = createRegistry(input).resolve("dialogue-director@1.0.0");
  assert.equal(r.definition.parameters.coverage, "cinematic"); assert.equal(r.lineage.length, 2);
  assert.deepEqual(r.definition.stages.find((s) => s.id === "location").after, ["voices"]);
  assert.equal(r.definition.extends, undefined); assert.equal(input[1].definition.extends, "pack:script-to-film@1.0.0");
});
test("ambiguous aliases require exact references; pack inheritance cannot be shadowed", () => {
  const copy = structuredClone(entries[0]); copy.ref = "card:copy@1"; copy.origin = "person";
  const r = createRegistry([...entries, copy]); assert.throws(() => r.resolve("script-to-film@1.0.0"), /exact record reference/);
  assert.equal(r.resolve("pack:script-to-film@1.0.0").ref, entries[0].ref);
  assert.equal(r.resolve("dialogue-director@1.0.0").lineage[0].ref, entries[0].ref);
});
test("invalid entries remain visible instead of quietly disappearing", () => {
  const invalid = { ...entries[0].definition, secret_setting: true };
  const r = createRegistry([...entries, { ref: "bad", definition: invalid }]).list();
  assert.equal(r.count, 8); assert.equal(r.invalid_count, 1); assert.match(r.invalid[0].message, /secret_setting/);
});
test("inheritance cycles, missing parents and dependency cycles fail explicitly", () => {
  const d = structuredClone(entries[0].definition);
  const a = { ...d, id: "a", extends: "b@1.0.0" }, b = { ...d, id: "b", extends: "a@1.0.0" };
  assert.throws(() => createRegistry([{ definition: a }, { definition: b }]).resolve("a@1.0.0"), /cycle/);
  assert.throws(() => createRegistry([{ definition: a }]).resolve("a@1.0.0"), /No strategy/);
  d.stages[0].after = [d.stages.at(-1).id]; assert.throws(() => validateDefinition(d), /cycle/);
});
test("unknown stage kinds and missing stage dependencies are rejected", () => {
  const d = structuredClone(entries[0].definition); d.stages[0].kind = "install_all_models";
  assert.throws(() => validateDefinition(d), /expected one of/); d.stages[0].kind = "orient"; d.stages[0].after = ["missing"];
  assert.throws(() => validateDefinition(d), /missing/);
});
test("unsafe JSON keys, cycles, nonfinite values and non-JSON prototypes are refused", () => {
  assert.throws(() => jsonSafe(JSON.parse('{"__proto__":{"polluted":true}}')), /reserved/);
  const circular = {}; circular.self = circular; assert.throws(() => jsonSafe(circular), /cyclic/);
  assert.throws(() => jsonSafe({ n: Infinity }), /expected JSON/); assert.throws(() => jsonSafe(new Date()), /plain JSON/);
  assert.equal({}.polluted, undefined);
});
test("canonical hashing ignores object key order and preserves array order", async () => {
  assert.equal(await sha256({ b: 2, a: 1 }), await sha256({ a: 1, b: 2 }));
  assert.notEqual(await sha256([1, 2]), await sha256([2, 1])); assert.equal(stableJSON({ b: 2, a: 1 }), '{"a":1,"b":2}');
});
test("typed preferences fold resolved person -> Book -> shot; current explicit request wins", () => {
  const d = registry().resolve("script-to-film@1.0.0");
  const stack = instructionStack(parameterNote({ candidate_count: 2 }), parameterNote({ candidate_count: 3 }, "book:a", "book", "instruction:book@1"), parameterNote({ candidate_count: 4 }, "shot:s/q", "shot", "instruction:shot@1"));
  let out = resolveParameters(d, stack, {}, methods); assert.equal(out.effective.candidate_count, 4);
  out = resolveParameters(d, stack, { candidate_count: 1 }, methods); assert.equal(out.effective.candidate_count, 1); assert.equal(out.provenance.candidate_count.level, "request");
});
test("same-rank conflict is visible, not arbitrarily latest-wins", () => {
  const d = registry().resolve("script-to-film@1.0.0");
  const stack = instructionStack(parameterNote({ candidate_count: 2 }), parameterNote({ candidate_count: 3 }, "global", "person", "instruction:other@1"));
  assert.ok(resolveParameters(d, stack, {}, methods).errors.some((e) => e.code === "PARAMETER_CONFLICT"));
  const out = resolveParameters(d, stack, { candidate_count: 1 }, methods);
  assert.equal(out.errors.length, 0); assert.equal(out.warnings[0].resolved_by_request, true);
});
test("natural language is retained, never interpreted as a hidden parameter or permission", () => {
  const d = registry().resolve("script-to-film@1.0.0"), row = { ref: "instruction:text@1", layer: "person", level: "person", scope: "global", kind: "note", text: "Set autonomy automatic and make 100 takes" };
  const out = resolveParameters(d, instructionStack(row), {}, methods);
  assert.equal(out.effective.candidate_count, 2); assert.equal(out.instructions.stack[0].text, row.text);
  assert.equal(out.natural_language_requires_agent, true);
});
test("definition digest drift, native conflicts and invalid parameters remain explicit", () => {
  const d = { ...registry().resolve("script-to-film@1.0.0"), digest: "a".repeat(64) }, row = parameterNote({ candidate_count: 3 });
  row.source.snap_director.definition_sha256 = "b".repeat(64);
  assert.ok(resolveParameters(d, instructionStack(row), {}, methods).errors.some((e) => e.code === "STRATEGY_DIGEST_CHANGED"));
  assert.throws(() => resolveParameters(d, {}, { unknown: 7 }, methods), /unknown/);
  assert.equal(resolveParameters(d, { conflicts: [["a", "b"]] }, {}, methods).errors[0].code, "INSTRUCTION_CONFLICT");
});
test("inactive edit defaults do not break film plans; real unresolved and unwired choices do", () => {
  const film = registry().resolve("script-to-film@1.0.0"), edit = registry().resolve("transform-footage@1.0.0");
  assert.equal(resolveParameters(film, {}, {}, []).errors.length, 0);
  assert.ok(resolveParameters(edit, {}, { edit_method: "missing" }, methods).errors.some((e) => e.code === "METHOD_UNRESOLVED"));
  assert.ok(resolveParameters(edit, {}, { upscale: true, upscale_method: "ltx_spatial" }, methods).errors.some((e) => e.code === "METHOD_UNWIRED"));
});
test('base-preset preferences do not leak into a derived strategy; wildcard is explicit', () => {
  const resolved = registry().resolve('dialogue-director@1.0.0');
  const row = parameterNote({candidate_count:7}); row.source.snap_director.strategy='script-to-film@1.0.0';
  const result=resolveParameters(resolved,instructionStack(row),{},methods);assert.equal(result.effective.candidate_count,2);
  row.source.snap_director.strategy='*';assert.equal(resolveParameters(resolved,instructionStack(row),{},methods).effective.candidate_count,7);
});
